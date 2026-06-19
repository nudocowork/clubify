import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

// Anti-fraude: máximo 1 sello por cliente por día. El staff no puede
// agregar otro sello al mismo pass hasta que pasen 24h del anterior.
// SUPER_ADMIN bypasses esta regla (para corregir errores manualmente)
// y el operador con PIN puede usar amount > 1 si necesita batch
// excepcional (cumpleaños, evento, etc).
const MIN_SECONDS_BETWEEN_STAMPS = 24 * 60 * 60; // 24h

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
    //
    // M4 (2026-06-04): el límite es Tenant.maxStampsPerDay (default 1).
    // El admin puede subirlo a 2/3/etc para campañas promocionales sin
    // tocar código. Si null, mantiene el comportamiento histórico de
    // 1 sello / 24h.
    if (
      (dto.action === 'STAMP' || dto.action === 'VISIT') &&
      user.role !== 'SUPER_ADMIN'
    ) {
      const tenantConfig = await this.prisma.tenant.findUnique({
        where: { id: pass.tenantId },
        select: { maxStampsPerDay: true },
      });
      const maxPerDay = Math.max(1, tenantConfig?.maxStampsPerDay ?? 1);
      const sinceWindow = new Date(
        Date.now() - MIN_SECONDS_BETWEEN_STAMPS * 1000,
      );
      const recentCount = await this.prisma.stamp.count({
        where: {
          passId: pass.id,
          action: { in: ['STAMP', 'VISIT'] },
          createdAt: { gte: sinceWindow },
        },
      });
      if (recentCount >= maxPerDay) {
        // Calcular cuándo expira el sello más viejo del batch para
        // darle al staff un ETA preciso del próximo sello disponible.
        const oldest = await this.prisma.stamp.findFirst({
          where: {
            passId: pass.id,
            action: { in: ['STAMP', 'VISIT'] },
            createdAt: { gte: sinceWindow },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        const remainingHours = oldest
          ? Math.max(
              1,
              Math.ceil(
                (MIN_SECONDS_BETWEEN_STAMPS -
                  (Date.now() - oldest.createdAt.getTime()) / 1000) /
                  3600,
              ),
            )
          : 24;
        throw new BadRequestException(
          maxPerDay === 1
            ? `Este cliente ya recibió un sello hoy. Próximo sello disponible en ~${remainingHours}h.`
            : `Este cliente ya recibió el máximo de ${maxPerDay} sellos del día. Próximo disponible en ~${remainingHours}h.`,
        );
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

    // Monto mínimo por sello: si la tarjeta lo tiene configurado, el
    // purchaseAmount debe ser >= ese mínimo. Mensaje claro al staff
    // del scanner para que sepa por qué no se otorga el sello.
    if (
      requiresPurchase &&
      user.role !== 'SUPER_ADMIN' &&
      pass.card.minAmountPerStamp &&
      dto.purchaseAmount !== undefined &&
      dto.purchaseAmount !== null &&
      Number(dto.purchaseAmount) < Number(pass.card.minAmountPerStamp)
    ) {
      throw new BadRequestException(
        `Monto mínimo por sello: $${Number(pass.card.minAmountPerStamp)}. La compra de $${Number(dto.purchaseAmount)} no alcanza.`,
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
          // Single-use: COUPON oficial + DISCOUNT/GIFT legacy. El pass
          // se transforma in-place a stamps card debajo (cambio de
          // cardId + stampsCount=0 + status='ACTIVE'). El guard
          // `pass.status === 'COMPLETED'` previene re-redención de
          // cupones legacy que quedaron en estado COMPLETED por la
          // versión pre-transform del flow (antes del commit 4ce5cbf).
          // En el flow nuevo, post-transform el pass es STAMPS → cae
          // al case STAMPS arriba, no a este.
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

    // HOTFIX 2026-06-05 (bug E): `completed` ahora excluye explícitamente
    // isCouponRedeem para que el evento PASS_COMPLETED NO se dispare
    // cuando un COUPON/DISCOUNT/GIFT se canjea. Antes la flag se calculaba
    // por type==='STAMPS' (false durante el redeem porque el type es
    // COUPON), pero si una STAMPS card tuviera stampsRequired=0 quedaba
    // verdadera y la línea 449 emit `PASS_COMPLETED` igual. Defensa
    // explícita.
    const completed =
      !isCouponRedeem &&
      ((pass.card.type === 'STAMPS' && newStamps >= required) ||
        (pass.card.type === 'VISITS' && newVisits >= visitsReq));
    // COUPON/DISCOUNT/GIFT al REDEEM ya no quedan COMPLETED — se
    // transforman al toque en una tarjeta de sellos in-place (mismo
    // passId / serial / wallet pass). El cliente NO recibe link nuevo:
    // su wallet pass instalado se actualiza solo vía push APNs/Google.

    // Resolver stamps card target ANTES de la transacción si vamos a
    // transformar. La query es read-only (resolveOrCreateStampsCard puede
    // hacer un upsert pero ahora la metemos al tx por consistencia).
    let stampsCardForTransform: { id: string } | null = null;
    if (isCouponRedeem) {
      stampsCardForTransform = await this.resolveOrCreateStampsCard(
        pass.tenantId,
        pass.cardId,
      );
    }

    // FIX 2026-06-16 (review #11): escrituras RELATIVAS (increment por delta)
    // en vez de absolutas, para no perder sellos/puntos bajo escaneos
    // concurrentes (dos scans leían el mismo saldo viejo y escribían el mismo
    // absoluto → un sello perdido). El delta = nuevoSaldo − saldoLeído.
    const stampsDelta = newStamps - pass.stampsCount;
    const pointsDelta = Number(newPoints) - Number(pass.pointsBalance);
    const cashbackDelta = Number(newCashback) - Number(pass.cashbackBalance);
    const visitsDelta = newVisits - pass.visitsCount;
    const passUpdateData: any = {
      stampsCount: { increment: stampsDelta },
      pointsBalance: { increment: pointsDelta },
      cashbackBalance: { increment: cashbackDelta },
      visitsCount: { increment: visitsDelta },
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

    // HOTFIX 2026-06-05 (bug C): cleanupOrphanStampsPass debe correr
    // DENTRO del $transaction junto con el update del pass. Antes corría
    // fuera → si la tx fallaba (P2025, P2002 por race), el pass huérfano
    // ya estaba borrado sin posibilidad de rollback (data loss). Ahora
    // todo es atómico: o se borra el huérfano + crea stamp + update pass,
    // o ninguna de las 3.
    const [stamp, updatedPass] = await this.prisma.$transaction(async (tx) => {
      // FIX 2026-06-16 (review #11): advisory lock por pass → serializa los
      // escaneos concurrentes del mismo pase. Con el lock tomado, releemos el
      // saldo FRESCO y, si esta operación CONSUME saldo (redención de premio,
      // débito de puntos, redención de cashback), revalidamos contra el saldo
      // fresco para evitar la DOBLE-REDENCIÓN (dos scans pasaban el check
      // sobre el saldo viejo y ambos consumían).
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        pass.id,
      );
      const fresh = await tx.pass.findUnique({
        where: { id: pass.id },
        select: { stampsCount: true, pointsBalance: true, cashbackBalance: true },
      });
      if (fresh) {
        const stampsConsumed = isCouponRedeem ? 0 : Math.max(0, -stampsDelta);
        const pointsConsumed = Math.max(0, -pointsDelta);
        const cashbackConsumed = Math.max(0, -cashbackDelta);
        if (
          stampsConsumed > fresh.stampsCount ||
          pointsConsumed > Number(fresh.pointsBalance) + 0.001 ||
          cashbackConsumed > Number(fresh.cashbackBalance) + 0.001
        ) {
          throw new ConflictException(
            'El saldo cambió (otra operación lo usó). Volvé a escanear.',
          );
        }
      }
      if (isCouponRedeem && stampsCardForTransform && pass.customerId) {
        // FIX 2026-06-16 (review): NO borrar a ciegas. El transform del cupón
        // mueve este pase a la stamps card target; si el cliente YA tiene ahí
        // un pase de sellos REAL (con progreso, historial o agregado al
        // wallet) el deleteMany ciego lo destruía. Replicamos las guardas de
        // cleanupOrphanStampsPass: solo borramos un pase HUÉRFANO (0 sellos,
        // 0 historial, 0 devices); si no, abortamos el transform.
        const existing = await tx.pass.findUnique({
          where: {
            cardId_customerId: {
              cardId: stampsCardForTransform.id,
              customerId: pass.customerId,
            },
          },
          select: { id: true, stampsCount: true },
        });
        if (existing && existing.id !== pass.id) {
          if (existing.stampsCount > 0) {
            throw new BadRequestException(
              'El cliente ya tiene una tarjeta de sellos con progreso. No se puede transformar el cupón sin perderlo.',
            );
          }
          const [devices, history] = await Promise.all([
            tx.walletDevice.count({ where: { passId: existing.id } }),
            tx.stamp.count({ where: { passId: existing.id } }),
          ]);
          if (devices > 0 || history > 0) {
            throw new BadRequestException(
              'El cliente ya tiene una tarjeta de sellos activa (con historial o en el wallet). No se puede transformar el cupón.',
            );
          }
          await tx.pass.delete({ where: { id: existing.id } });
        }
      }
      const newStampRow = await tx.stamp.create({
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
      });
      const updated = await tx.pass.update({
        where: { id: pass.id },
        data: passUpdateData,
      });
      return [newStampRow, updated] as const;
    });

    // #7/#8: cada sello de COMPRA (STAMP/VISIT con monto) cuenta como un pedido
    // (para recibir el sello necesariamente hubo una compra) → alimenta
    // facturación / ticket / total gastado / historial del cliente.
    // ⚠️ CRÍTICO: esto va DESPUÉS de la transacción del sello y es best-effort
    // (try/catch). Si va dentro de la tx y el customer.update falla (cliente
    // mergeado/borrado → P2025), Postgres aborta TODA la tx y el sello NO se
    // guarda (bug Valmont: clientes no podían sumar sellos). Una métrica nunca
    // debe romper el sello. Guard orderId implícito (este path no setea orderId).
    if (
      (dto.action === 'STAMP' || dto.action === 'VISIT') &&
      dto.purchaseAmount !== undefined &&
      dto.purchaseAmount !== null &&
      Number(dto.purchaseAmount) > 0 &&
      pass.customerId
    ) {
      try {
        const now = new Date();
        await this.prisma.customer.update({
          where: { id: pass.customerId },
          data: {
            totalOrdersCount: { increment: 1 },
            totalOrdersAmount: { increment: new Prisma.Decimal(dto.purchaseAmount) },
            lastOrderAt: now,
          },
        });
        await this.prisma.customer.updateMany({
          where: { id: pass.customerId, firstOrderAt: null },
          data: { firstOrderAt: now },
        });
      } catch (e) {
        this.logger.warn(
          `Customer metrics update falló para pass=${pass.id} customer=${pass.customerId}: ${(e as Error)?.message} — el sello SÍ se registró.`,
        );
      }
    }

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
    //     pero no disparado aquí; lo añadimos ahora)
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
    // mandarle un mensaje "tu cupón fue usado, ahora suma sellos".
    if (isCouponRedeem) {
      this.automations
        .emit('COUPON_REDEEMED', {
          tenantId: pass.tenantId,
          customerId: pass.customerId,
          // pass.cardId aquí todavía es el del cupón ORIGINAL (no
          // refetcheamos antes de emit) — informativo histórico
          couponCardId: pass.cardId,
          couponPassId: pass.id,
          couponName: pass.card.name,
          rewardText: pass.card.rewardText || '',
          // El pass se transformó in-place — apunta a la stamps card
          // del tenant pero mantiene su passId. Los templates que
          // usaban {{stampsPassUrl}} y {{stampsPassId}} siguen
          // funcionando: apuntan al MISMO pass, que ahora muestra
          // la tarjeta de sellos. backwards compat con automations.
          stampsCardId: stampsCardForTransform?.id ?? null,
          stampsPassId: pass.id,
          stampsPassUrl: `https://soyclubify.com/w/${pass.id}`,
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
    // Prioridad 1: el dueño eligió explícitamente la stamps card destino
    // al crear el cupón (Card.transformIntoCardId). Si la card destino
    // todavía existe + es STAMPS activa + del mismo tenant, usarla.
    const sourceCoupon = await this.prisma.card.findUnique({
      where: { id: sourceCouponCardId },
      select: { transformIntoCardId: true },
    });
    if (sourceCoupon?.transformIntoCardId) {
      const explicit = await this.prisma.card.findFirst({
        where: {
          id: sourceCoupon.transformIntoCardId,
          tenantId,
          type: 'STAMPS',
          isActive: true,
        },
        select: { id: true },
      });
      if (explicit) return explicit;
      // Si fue seteada pero ya no califica (eliminada/desactivada/tipo
      // cambió), caemos al fallback auto y loggeamos.
      this.logger.warn(
        `Coupon ${sourceCouponCardId} tenía transformIntoCardId=${sourceCoupon.transformIntoCardId} pero ya no es válida — fallback auto`,
      );
    }

    // Prioridad 2: usar la primera STAMPS card activa del tenant
    // (comportamiento histórico).
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
   * liberar la unique constraint (cardId, customerId). Reglas:
   *
   * - Si el customer NO tiene un pass en esa stamps card → nada que
   *   limpiar, return.
   * - Si tiene un pass pero tiene sellos > 0 → fidelización legítima
   *   previa al cupón. Tirar error (no perder progreso).
   * - Si tiene devices walletDevice registrados → ya lo agregó al
   *   wallet. Tirar error (no romper su wallet pass).
   * - Si tiene Stamp records → tuvo actividad histórica. Tirar error.
   * - Solo si es 0/0/0 totalmente vacío → safe to delete (huérfano
   *   real del backfill v1).
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
        `Customer ${customerId} ya tiene stamps pass ${existingStampsPass.id} con ${existingStampsPass.stampsCount} sellos — abort transform para no perder progreso`,
      );
      throw new BadRequestException(
        'El cliente ya tiene una tarjeta de sellos con sellos acumulados. No se puede transformar el cupón sin perder su progreso.',
      );
    }

    const [walletDevices, stampHistory] = await Promise.all([
      this.prisma.walletDevice.count({ where: { passId: existingStampsPass.id } }),
      this.prisma.stamp.count({ where: { passId: existingStampsPass.id } }),
    ]);

    if (walletDevices > 0 || stampHistory > 0) {
      this.logger.warn(
        `Stamps pass ${existingStampsPass.id} no es huérfano (devices=${walletDevices}, stampHistory=${stampHistory}) — abort transform`,
      );
      throw new BadRequestException(
        'El cliente ya tiene una tarjeta de sellos activa con historial o agregada al wallet. No se puede transformar el cupón.',
      );
    }

    await this.prisma.pass.delete({ where: { id: existingStampsPass.id } });
    this.logger.log(
      `Eliminé pass huérfano ${existingStampsPass.id} (customer ${customerId}, stamps card ${stampsCardId}, 0 devices, 0 stamps) antes de transformar cupón`,
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
