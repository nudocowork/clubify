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
        } else if (pass.card.type === 'COUPON') {
          // COUPON es single-use: al redimir, el pass queda COMPLETED y
          // no se vuelve a poder redimir. La transformación a stamps
          // card se hace después de la transacción (auto-promote).
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
    const completed =
      (pass.card.type === 'STAMPS' && newStamps >= required) ||
      (pass.card.type === 'VISITS' && newVisits >= visitsReq) ||
      // COUPON al REDEEM queda COMPLETED inmediatamente (single-use).
      (pass.card.type === 'COUPON' && dto.action === 'REDEEM');

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
          note: dto.note,
        },
      }),
      this.prisma.pass.update({
        where: { id: pass.id },
        data: {
          stampsCount: newStamps,
          pointsBalance: newPoints,
          cashbackBalance: newCashback,
          visitsCount: newVisits,
          currentTier: newCurrentTier,
          tierProgress: newTierProgress,
          lastActivityAt: new Date(),
          status: completed ? 'COMPLETED' : pass.status,
        },
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

    // Auto-promote: si se redimió un COUPON, el cliente arranca su
    // fidelización automáticamente — le creamos una stamps card pass.
    // No bloqueamos la respuesta del scanner: si la promoción falla
    // (no hay stamps card configurada, error de Prisma, etc), el
    // REDEEM del cupón ya quedó persistido y devolvemos el resultado.
    let promotedPass: any = null;
    if (dto.action === 'REDEEM' && pass.card.type === 'COUPON') {
      promotedPass = await this.autoPromoteCouponToStamps(
        user,
        pass.tenantId,
        pass.customerId,
        pass.cardId,
      ).catch((e) => {
        this.logger.warn(
          `Auto-promote falló para pass ${pass.id}: ${e?.message ?? e}`,
        );
        return null;
      });

      // Automation event: el dueño puede engancharle una regla SEND_PUSH
      // o SEND_WHATSAPP_LINK para mensajear al cliente "tu cupón fue
      // usado, agregá tu nueva tarjeta de sellos: <link>".
      this.automations
        .emit('COUPON_REDEEMED', {
          tenantId: pass.tenantId,
          customerId: pass.customerId,
          couponCardId: pass.cardId,
          couponPassId: pass.id,
          couponName: pass.card.name,
          rewardText: pass.card.rewardText || '',
          // Datos del stamps pass auto-creado (puede ser null si el
          // tenant no tiene stamps card configurada).
          stampsPassId: promotedPass?.id ?? null,
          stampsCardId: promotedPass?.cardId ?? null,
          stampsPassUrl: promotedPass
            ? `https://soyclubify.com/p/${promotedPass.id}`
            : null,
        })
        .catch(() => null);
    }

    return { stamp, pass: updatedPass, promotedPass };
  }

  /** Busca la stamps card "principal" del tenant y emite una nueva
   *  Pass para el cliente. Si no hay stamps card activa, devuelve
   *  null sin error (el frontend lo maneja con un mensaje neutro).
   *
   *  Estrategia de selección:
   *  - Si la card COUPON tiene `autoPromoteToCardId` seteado (futuro
   *    campo) → usar esa. Por ahora no existe → fallback a auto.
   *  - Auto: primera card STAMPS activa del tenant ordenada por
   *    createdAt ascendente (la más vieja, asumida como "principal").
   */
  private async autoPromoteCouponToStamps(
    user: AuthUser,
    tenantId: string,
    customerId: string,
    sourceCouponCardId: string,
  ): Promise<any> {
    const stampsCard = await this.prisma.card.findFirst({
      where: { tenantId, type: 'STAMPS', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!stampsCard) {
      this.logger.log(
        `Tenant ${tenantId} no tiene stamps card activa — skip auto-promote del cupón ${sourceCouponCardId}`,
      );
      return null;
    }
    // passes.issue() es idempotente: si el customer ya tiene un pass
    // en esa card (porque ya estaba fidelizado antes del cupón),
    // devuelve el existente sin duplicar.
    const newPass = await this.passes.issue(user, stampsCard.id, customerId);
    this.logger.log(
      `Auto-promote OK: customer ${customerId} → stamps pass ${newPass.id}`,
    );
    return newPass;
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
