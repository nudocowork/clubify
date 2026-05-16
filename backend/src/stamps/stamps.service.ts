import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, StampAction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { QueueService } from '../jobs/queue.service';
import { computePassExpiry } from '../cards/expiry.util';
import { GamificationService } from '../badges/gamification.service';
import { AutomationsService } from '../automations/automations.service';
import { PassesService } from '../passes/passes.service';

export type StampDto = {
  passId: string;
  action: StampAction;
  amount?: number;
  note?: string;
  locationId?: string;
  pin?: string;
  // Monto que el cliente pagó por la compra que motivó el scan.
  // Solo informativo — no cambia cuántos sellos se otorgan.
  purchaseAmount?: number;
};

// Anti-fraude: tiempo mínimo entre dos STAMP/VISIT consecutivos al mismo pass.
// Evita que el staff abuse del scanner agregando múltiples sellos en una sola
// compra. 30 segundos es suficiente para que un cliente legítimo vuelva a
// comprar (Apple Pay tap → comprar otro café → tap de nuevo) sin frustrar.
const MIN_SECONDS_BETWEEN_STAMPS = 30;

@Injectable()
export class StampsService {
  private readonly logger = new Logger(StampsService.name);

  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private jobs: QueueService,
    private gamification: GamificationService,
    private automations: AutomationsService,
    private passes: PassesService,
  ) {}

  async record(user: AuthUser, dto: StampDto) {
    const pass = await this.prisma.pass.findUnique({
      where: { id: dto.passId },
      include: { card: true },
    });
    if (!pass) throw new NotFoundException('Pass');
    if (user.role !== 'SUPER_ADMIN' && pass.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    if (pass.status === 'REVOKED') throw new BadRequestException('Pass is revoked');

    // Enforcement de fecha de vencimiento de la tarjeta. Bloqueamos
    // STAMP/POINTS_ADD/POINTS_DEDUCT/REDEEM cuando el pass está vencido,
    // pero permitimos REFUND/VISIT (admin puede arreglar saldos).
    const expiry = computePassExpiry(pass);
    if (expiry && expiry.getTime() < Date.now()) {
      const blocking = [
        'STAMP',
        'POINTS_ADD',
        'POINTS_DEDUCT',
        'REDEEM',
        'CASHBACK_ADD',
        'CASHBACK_REDEEM',
        'VISIT',
      ];
      if (blocking.includes(dto.action)) {
        throw new BadRequestException(
          `La tarjeta está vencida desde ${expiry.toLocaleDateString('es-CO')}`,
        );
      }
    }

    const amount = new Prisma.Decimal(dto.amount ?? 1);

    // Anti-abuso: si STAMP con amount > 1, exigir PIN configurado por
    // super admin (Setting key scanner.staffPin). Si no hay PIN seteado,
    // se permite (backwards compat hasta que el admin lo configure).
    if (dto.action === 'STAMP' && Number(amount) > 1) {
      const pinRow = await this.prisma.setting.findUnique({
        where: { key: 'scanner.staffPin' },
      });
      const expected = pinRow?.value?.trim();
      if (expected && (dto.pin ?? '').trim() !== expected) {
        throw new ForbiddenException('PIN del escáner inválido');
      }
    }

    // Anti-fraude: rate-limit STAMP/VISIT al mismo pass. Bypass solo si
    // el operator es SUPER_ADMIN (puede arreglar errores manualmente).
    if (
      (dto.action === 'STAMP' || dto.action === 'VISIT') &&
      user.role !== 'SUPER_ADMIN'
    ) {
      const recent = await this.prisma.stamp.findFirst({
        where: {
          passId: pass.id,
          action: { in: ['STAMP', 'VISIT'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (recent) {
        const elapsedSec = (Date.now() - recent.createdAt.getTime()) / 1000;
        if (elapsedSec < MIN_SECONDS_BETWEEN_STAMPS) {
          throw new BadRequestException(
            `Esperá ${Math.ceil(
              MIN_SECONDS_BETWEEN_STAMPS - elapsedSec,
            )}s antes del próximo sello (anti-fraude).`,
          );
        }
      }
    }

    // Para STAMP/VISIT en cards de fidelización, el frontend exige
    // monto de compra (regla de negocio). Validamos que esté presente
    // y > 0 — pero solo para tipos de cards que lo requieren.
    const requiresPurchase =
      (dto.action === 'STAMP' || dto.action === 'VISIT') &&
      ['STAMPS', 'VISITS', 'HYBRID'].includes(pass.card.type);
    if (
      requiresPurchase &&
      user.role !== 'SUPER_ADMIN' &&
      (dto.purchaseAmount === undefined ||
        dto.purchaseAmount === null ||
        Number(dto.purchaseAmount) <= 0)
    ) {
      throw new BadRequestException(
        'Monto de compra requerido para registrar el sello.',
      );
    }

    let newStamps = pass.stampsCount;
    let newPoints = pass.pointsBalance;
    let newCashback = pass.cashbackBalance;
    let newVisits = pass.visitsCount;

    switch (dto.action) {
      case 'STAMP':
        newStamps = pass.stampsCount + Number(amount);
        break;
      case 'POINTS_ADD':
        newPoints = new Prisma.Decimal(pass.pointsBalance).add(amount);
        break;
      case 'POINTS_DEDUCT':
        newPoints = new Prisma.Decimal(pass.pointsBalance).sub(amount);
        if (Number(newPoints) < 0) throw new BadRequestException('Insufficient points');
        break;
      case 'REDEEM':
        if (pass.card.type === 'STAMPS') {
          const required = pass.card.stampsRequired ?? 10;
          if (pass.stampsCount < required) throw new BadRequestException('Not enough stamps to redeem');
          newStamps = pass.stampsCount - required;
        } else if (pass.card.type === 'VISITS') {
          const required = pass.card.visitsRequired ?? 10;
          if (pass.visitsCount < required) throw new BadRequestException('Not enough visits to redeem');
          newVisits = pass.visitsCount - required;
        } else if (
          pass.card.type === 'COUPON' ||
          pass.card.type === 'DISCOUNT' ||
          pass.card.type === 'GIFT'
        ) {
          // Single-use legacy: COUPON (oficial) + DISCOUNT/GIFT (legacy
          // antes de la simplificación 2026-05-15). Al redimir, el pass
          // queda COMPLETED y no se vuelve a poder redimir. La
          // transformación a stamps card se hace después de la
          // transacción (auto-promote).
          if (pass.status === 'COMPLETED') {
            throw new BadRequestException(
              'Este cupón ya fue redimido. No se puede usar de nuevo.',
            );
          }
        }
        break;
      case 'REFUND':
        if (pass.card.type === 'VISITS') {
          newVisits = Math.max(0, pass.visitsCount - Number(amount));
        } else {
          newStamps = Math.max(0, pass.stampsCount - Number(amount));
        }
        break;
      case 'VISIT':
        // VISITS card type: incrementa visitsCount. Otros tipos: sólo registra.
        if (pass.card.type === 'VISITS') {
          newVisits = pass.visitsCount + Number(amount);
        }
        break;
      case 'CASHBACK_ADD':
        newCashback = new Prisma.Decimal(pass.cashbackBalance).add(amount);
        break;
      case 'CASHBACK_REDEEM':
        newCashback = new Prisma.Decimal(pass.cashbackBalance).sub(amount);
        if (Number(newCashback) < 0) throw new BadRequestException('Insufficient cashback');
        break;
    }

    // Recalcular tier para tarjetas con tiers configurados (MEMBERSHIP).
    // tierMetric: spend|visits|stamps. Acumulamos en pass.tierProgress.
    let newTierProgress = new Prisma.Decimal(pass.tierProgress);
    let newCurrentTier = pass.currentTier;
    const tiers: Array<{ name: string; threshold: number }> = Array.isArray(
      pass.card.tiers as any,
    )
      ? (pass.card.tiers as any)
      : [];
    if (tiers.length > 0) {
      const metric = pass.card.tierMetric || 'spend';
      // Sumar contribución a tierProgress según métrica + acción.
      let delta = new Prisma.Decimal(0);
      if (metric === 'spend' && (dto.action === 'POINTS_ADD' || dto.action === 'CASHBACK_ADD')) {
        delta = new Prisma.Decimal(amount);
      } else if (metric === 'visits' && (dto.action === 'VISIT' || dto.action === 'STAMP')) {
        delta = new Prisma.Decimal(amount);
      } else if (metric === 'stamps' && dto.action === 'STAMP') {
        delta = new Prisma.Decimal(amount);
      }
      newTierProgress = newTierProgress.add(delta);
      const sortedTiers = [...tiers].sort((a, b) => b.threshold - a.threshold);
      const matched = sortedTiers.find((t) => Number(newTierProgress) >= t.threshold);
      if (matched) newCurrentTier = matched.name;
    }

    const required = pass.card.stampsRequired ?? Number.MAX_SAFE_INTEGER;
    const visitsReq = pass.card.visitsRequired ?? Number.MAX_SAFE_INTEGER;
    const isCouponRedeem =
      (pass.card.type === 'COUPON' ||
        pass.card.type === 'DISCOUNT' ||
        pass.card.type === 'GIFT') &&
      dto.action === 'REDEEM';

    const completed =
      (pass.card.type === 'STAMPS' && newStamps >= required) ||
      (pass.card.type === 'VISITS' && newVisits >= visitsReq);
    // COUPON/DISCOUNT/GIFT al REDEEM ya no quedan COMPLETED — se
    // transforman al toque en una tarjeta de sellos in-place (mismo
    // passId / serial / wallet pass). El cliente NO recibe link nuevo:
    // su wallet pass instalado se actualiza solo vía push APNs/Google.

    // Resolver stamps card target ANTES de la transacción si vamos a
    // transformar. Si el customer ya tiene un stamps pass orfano (de
    // backfill anterior), lo borramos para liberar la constraint
    // composite unique (cardId, customerId) antes del update.
    let stampsCardForTransform: { id: string } | null = null;
    if (isCouponRedeem) {
      stampsCardForTransform = await this.resolveOrCreateStampsCard(
        pass.tenantId,
        pass.cardId,
      );
      await this.cleanupOrphanStampsPass(
        pass.customerId,
        stampsCardForTransform.id,
      );
    }

    const passUpdateData: any = {
      stampsCount: newStamps,
      pointsBalance: newPoints,
      cashbackBalance: newCashback,
      visitsCount: newVisits,
      currentTier: newCurrentTier,
      tierProgress: newTierProgress,
      lastActivityAt: new Date(),
      status: completed ? 'COMPLETED' : pass.status,
    };
    if (isCouponRedeem && stampsCardForTransform) {
      // Transformación in-place: el coupon "evoluciona" a stamps card.
      // Mismo passId, serial, qrToken, authToken, wallet pass del
      // cliente. Solo cambia cardId + reset contador + status ACTIVE.
      passUpdateData.cardId = stampsCardForTransform.id;
      passUpdateData.stampsCount = 0;
      passUpdateData.status = 'ACTIVE';
    }

    const [stamp, updatedPass] = await this.prisma.$transaction([
      this.prisma.stamp.create({
        data: {
          tenantId: pass.tenantId,
          passId: pass.id,
          customerId: pass.customerId,
          locationId: dto.locationId,
          operatorId: user.id,
          action: dto.action,
          amount,
          purchaseAmount:
            dto.purchaseAmount !== undefined && dto.purchaseAmount !== null
              ? new Prisma.Decimal(dto.purchaseAmount)
              : undefined,
          note: isCouponRedeem
            ? (dto.note ?? 'Cupón redimido — transformado a tarjeta de sellos')
            : dto.note,
        },
      }),
      this.prisma.pass.update({
        where: { id: pass.id },
        data: passUpdateData,
      }),
    ]);

    // Encolar push al wallet. Si BullMQ tiene Redis, el worker lo consume
    // y llama wallet.pushPassUpdate(). Si Redis está offline, enqueue
    // rechaza y caemos al call directo in-process como fallback. Antes
    // se llamaban AMBOS siempre → push doble al iPhone (2 fetches del
    // .pkpass innecesarios).
    this.jobs
      .enqueue('wallet.push', { passId: pass.id, reason: dto.action })
      .catch(() => {
        // Fallback: queue no disponible, push directo in-process
        this.wallet.pushPassUpdate(pass.id).catch(() => null);
      });

    // Hito de multiRewards alcanzado → push de "ganaste X". Solo cuando
    // sumamos sellos (STAMP), no en REFUND/REDEEM. Disparamos cuando
    // newStamps cruza un hito que pass.stampsCount no había alcanzado.
    if (dto.action === 'STAMP' && pass.card.type === 'STAMPS') {
      const milestones: Array<{ at: number; reward: string }> =
        Array.isArray(pass.card.multiRewards as any)
          ? (pass.card.multiRewards as any)
          : [];
      const just = milestones.find(
        (m) =>
          typeof m.at === 'number' &&
          m.at > 0 &&
          pass.stampsCount < m.at &&
          newStamps >= m.at,
      );
      if (just) {
        const message = `🎉 ¡Ganaste ${just.reward}! Acumulaste ${just.at} sellos.`;
        // Push silencioso por canal wallet — el cliente lo ve al abrir
        // el .pkpass actualizado. La notif programada formal se podrá
        // enviar después por SMS/Push si el dueño lo configura en
        // automations.
        this.jobs
          .enqueue('wallet.push', {
            passId: pass.id,
            reason: 'milestone',
            message,
          })
          .catch(() => null);
      }
    }

    // Hook de gamificación: XP, level up, streak, badges automáticos.
    // Disparado fire-and-forget para no bloquear la respuesta del scanner.
    this.gamification
      .processStamp({
        customerId: pass.customerId,
        tenantId: pass.tenantId,
        action: dto.action,
        cardId: pass.cardId,
      })
      .catch(() => null);

    // Hook automations:
    //   STAMP_ADDED — cualquier scan registrado (ofrece feedback / cross-sell)
    //   NEAR_REWARD — al cliente le faltan 1-2 sellos para canjear (regla
    //     anti-churn que lo empuja a volver pronto)
    //   PASS_COMPLETED — alcanzó el target de la card (ya estaba contemplado
    //     pero no disparado acá; lo añadimos ahora)
    //   REWARD_REDEEMED — canjeó el premio
    if (dto.action === 'STAMP' || dto.action === 'VISIT') {
      const required =
        pass.card.type === 'VISITS'
          ? pass.card.visitsRequired ?? Number.MAX_SAFE_INTEGER
          : pass.card.stampsRequired ?? Number.MAX_SAFE_INTEGER;
      const current = pass.card.type === 'VISITS' ? newVisits : newStamps;
      const remaining = Math.max(0, required - current);
      this.automations
        .emit('STAMP_ADDED', {
          tenantId: pass.tenantId,
          customerId: pass.customerId,
          cardId: pass.cardId,
          passId: pass.id,
          stampsCount: newStamps,
          visitsCount: newVisits,
          remaining,
          action: dto.action,
        })
        .catch(() => null);
      // NEAR_REWARD: 1 o 2 unidades antes del premio. Solo cuando crossed
      // (la stamp anterior no estaba en este rango), evita spam.
      const previousRemaining = Math.max(
        0,
        required - (pass.card.type === 'VISITS' ? pass.visitsCount : pass.stampsCount),
      );
      if (remaining > 0 && remaining <= 2 && previousRemaining > remaining) {
        this.automations
          .emit('NEAR_REWARD', {
            tenantId: pass.tenantId,
            customerId: pass.customerId,
            cardId: pass.cardId,
            passId: pass.id,
            remaining,
            rewardText: pass.card.rewardText || 'tu premio',
          })
          .catch(() => null);
      }
    }
    if (completed && pass.status !== 'COMPLETED') {
      this.automations
        .emit('PASS_COMPLETED', {
          tenantId: pass.tenantId,
          customerId: pass.customerId,
          cardId: pass.cardId,
          passId: pass.id,
          rewardText: pass.card.rewardText || '',
        })
        .catch(() => null);
    }
    if (dto.action === 'REDEEM') {
      this.automations
        .emit('REWARD_REDEEMED', {
          tenantId: pass.tenantId,
          customerId: pass.customerId,
          cardId: pass.cardId,
          passId: pass.id,
        })
        .catch(() => null);
    }

    // Si fue una redención de cupón, el pass ya quedó transformado a
    // STAMPS arriba. Disparamos el automation event para que el dueño
    // pueda engancharle reglas SEND_PUSH / SEND_WHATSAPP si quiere
    // mandarle un mensaje "tu cupón fue usado, ahora sumá sellos".
    if (isCouponRedeem) {
      this.automations
        .emit('COUPON_REDEEMED', {
          tenantId: pass.tenantId,
          customerId: pass.customerId,
          couponCardId: pass.cardId,
          couponPassId: pass.id,
          couponName: pass.card.name,
          rewardText: pass.card.rewardText || '',
          // El pass ahora apunta al stamps card del tenant. No hay
          // link nuevo — la misma wallet pass del cliente se
          // actualizó automáticamente vía push.
          stampsCardId: stampsCardForTransform?.id ?? null,
          transformedInPlace: true,
        })
        .catch(() => null);
    }

    // Si transformamos cupón → stamps card, devolvemos el pass con la
    // nueva card incluida para que el scanner re-renderice la UI de
    // sellos al instante (sin necesidad de re-scanear el QR).
    if (isCouponRedeem) {
      const fullPass = await this.prisma.pass.findUnique({
        where: { id: pass.id },
        include: { card: true, customer: true },
      });
      return {
        stamp,
        pass: fullPass ?? updatedPass,
        transformedToStamps: true,
      };
    }
    return { stamp, pass: updatedPass, transformedToStamps: false };
  }

  /**
   * Devuelve el stamps card "principal" del tenant. Si no existe uno
   * activo, lo auto-crea con defaults sensatos. Esto garantiza que la
   * transformación cupón→sellos siempre tenga un destino válido.
   * El dueño puede editar el diseño de la card luego desde /app/cards.
   */
  private async resolveOrCreateStampsCard(
    tenantId: string,
    sourceCouponCardId: string,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.card.findFirst({
      where: { tenantId, type: 'STAMPS', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) return existing;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { brandName: true, primaryColor: true, logoUrl: true },
    });
    const created = await this.prisma.card.create({
      data: {
        tenantId,
        type: 'STAMPS',
        name: 'Tarjeta de Fidelización',
        description: 'Acumulá sellos en cada compra y canjeá la recompensa.',
        stampsRequired: 10,
        rewardText: 'Recompensa especial',
        primaryColor: tenant?.primaryColor ?? '#22C55E',
        secondaryColor: '#15803D',
        businessName: tenant?.brandName ?? '',
        logoUrl: tenant?.logoUrl ?? null,
        isActive: true,
      },
      select: { id: true },
    });
    this.logger.log(
      `Auto-created STAMPS card ${created.id} for tenant ${tenantId} (triggered by transform of coupon ${sourceCouponCardId})`,
    );
    return created;
  }

  /**
   * Antes de transformar un pass cupón → stamps card target, hay que
   * liberar la unique constraint (cardId, customerId). Si el customer
   * ya tiene un pass huérfano en esa stamps card (creado por el
   * backfill anterior o por una versión previa del auto-promote, sin
   * sellos acumulados aún), lo eliminamos. Si el pass huérfano tiene
   * sellos = customer ya estaba fidelizado pre-cupón, NO tocamos.
   */
  private async cleanupOrphanStampsPass(
    customerId: string,
    stampsCardId: string,
  ): Promise<void> {
    const existingStampsPass = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId: stampsCardId, customerId } },
      select: { id: true, stampsCount: true },
    });
    if (!existingStampsPass) return;
    if (existingStampsPass.stampsCount > 0) {
      this.logger.warn(
        `Customer ${customerId} ya tiene stamps pass ${existingStampsPass.id} con sellos — skip transform para no perder progreso`,
      );
      // Throw para que el caller decida — alternativa: dejar el coupon
      // como COMPLETED sin transformar. Por ahora, lo dejamos sin
      // transformar tirando un error de constraint en el caller.
      throw new BadRequestException(
        'El cliente ya tiene una tarjeta de sellos con progreso. No se puede transformar el cupón sin perder los sellos acumulados. Redimí el cupón manualmente y eliminalo desde el panel.',
      );
    }
    // Pass huérfano sin sellos — seguro eliminar (no tiene historia
    // de stamps records, no fue agregado al wallet aún en general).
    await this.prisma.stamp.deleteMany({
      where: { passId: existingStampsPass.id },
    });
    await this.prisma.walletDevice.deleteMany({
      where: { passId: existingStampsPass.id },
    });
    await this.prisma.pass.delete({ where: { id: existingStampsPass.id } });
    this.logger.log(
      `Eliminé pass huérfano ${existingStampsPass.id} (customer ${customerId}, stamps card ${stampsCardId}) antes de transformar cupón in-place`,
    );
  }

  /**
   * Backfill: para coupon passes COMPLETED pre-fix del 2026-05-15
   * (commit 158d7c0) que no auto-crearon stamps card, dispara el
   * auto-promote retroactivamente. Idempotente — passes existentes no
   * se duplican.
   */
  async backfillCouponPromotion(user: AuthUser, tenantSlug?: string) {
    const where: any = {
      status: 'COMPLETED',
      card: { type: { in: ['COUPON', 'DISCOUNT', 'GIFT'] } },
    };
    if (tenantSlug) {
      const t = await this.prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true },
      });
      if (!t) throw new BadRequestException(`Tenant slug "${tenantSlug}" no existe`);
      where.tenantId = t.id;
    }

    const couponPasses = await this.prisma.pass.findMany({
      where,
      include: {
        card: { select: { id: true, name: true, type: true } },
        customer: { select: { id: true, fullName: true } },
        tenant: { select: { id: true, slug: true, brandName: true } },
      },
    });

    const results: Array<{
      customer: string;
      tenant: string;
      couponName: string;
      passId: string;
      passUrl: string;
      transformed: boolean;
      error?: string;
    }> = [];

    for (const p of couponPasses) {
      try {
        const stampsCard = await this.resolveOrCreateStampsCard(
          p.tenantId,
          p.cardId,
        );
        // Limpiar pass orfano del backfill anterior si existe
        await this.cleanupOrphanStampsPass(p.customerId, stampsCard.id);
        // Transformar el coupon pass in-place → mismo wallet pass del
        // cliente, ahora apuntando a la stamps card con 0/10 sellos.
        await this.prisma.pass.update({
          where: { id: p.id },
          data: {
            cardId: stampsCard.id,
            stampsCount: 0,
            status: 'ACTIVE',
            lastActivityAt: new Date(),
          },
        });
        // Push update al wallet del cliente (Apple APNs + Google PATCH)
        // para que reciba el nuevo .pkpass con diseño de stamps.
        this.wallet.pushPassUpdate(p.id).catch((e) => {
          this.logger.warn(
            `Backfill push failed for pass ${p.id}: ${e?.message ?? e}`,
          );
        });
        results.push({
          customer: p.customer.fullName,
          tenant: p.tenant.brandName,
          couponName: p.card.name,
          passId: p.id,
          passUrl: `https://soyclubify.com/w/${p.id}`,
          transformed: true,
        });
        this.logger.log(
          `Backfill OK: pass ${p.id} transformado de ${p.card.type} → STAMPS (customer ${p.customer.fullName})`,
        );
      } catch (e: any) {
        results.push({
          customer: p.customer.fullName,
          tenant: p.tenant.brandName,
          couponName: p.card.name,
          passId: p.id,
          passUrl: `https://soyclubify.com/w/${p.id}`,
          transformed: false,
          error: e?.message ?? String(e),
        });
        this.logger.warn(
          `Backfill: transform falló para pass ${p.id}: ${e?.message ?? e}`,
        );
      }
    }

    return {
      scanned: couponPasses.length,
      transformed: results.filter((r) => r.transformed).length,
      failed: results.filter((r) => !r.transformed).length,
      tenantSlug: tenantSlug ?? '(all)',
      results,
    };
  }

  history(user: AuthUser, passId: string) {
    return this.prisma.stamp.findMany({
      where: {
        passId,
        ...(user.role !== 'SUPER_ADMIN' ? { tenantId: user.tenantId ?? '' } : {}),
      },
      include: { operator: { select: { fullName: true } }, location: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
