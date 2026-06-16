import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CommissionStatus,
  PaymentMethodKind,
  PaymentProfileStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

// Reglas de negocio Fase D — 2026-06-07.
export const MIN_PAYOUT_USD = 50;
export const PAYOUT_DAY_OF_MONTH = 15; // día oficial de pago

// Costo de retiro (spec 2026-06-15): si el retiro es >= 50 USD es gratis; si
// es menor, se descuenta una comisión fija de 3 USD del monto a pagar.
export const FREE_WITHDRAWAL_MIN_USD = 50;
export const WITHDRAWAL_FEE_USD = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Costo de retiro aplicable a un monto bruto: 0 si >= 50, sino 3.
function withdrawalFeeFor(grossUsd: number): number {
  return grossUsd >= FREE_WITHDRAWAL_MIN_USD ? 0 : WITHDRAWAL_FEE_USD;
}

// Próxima fecha de pago: día 15 o último día del mes, la primera >= hoy.
// Los pagos solo se liquidan en esas dos fechas (spec 2026-06-15).
function nextPayoutDate(from: Date = new Date()): Date {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  const c: Date[] = [];
  for (let m = 0; m <= 1; m++) {
    c.push(new Date(base.getFullYear(), base.getMonth() + m, 15));
    c.push(new Date(base.getFullYear(), base.getMonth() + m + 1, 0));
  }
  c.sort((a, b) => a.getTime() - b.getTime());
  return c.find((d) => d.getTime() >= base.getTime()) ?? c[c.length - 1];
}

type PaymentMethodSnapshot = {
  method: PaymentMethodKind;
  firstName: string | null;
  lastName: string | null;
  phoneCountry: string | null;
  phone: string | null;
  binance?: { email: string | null; phone: string | null; note: string | null };
  bank?: {
    country: string | null;
    bankName: string | null;
    accountType: string | null;
    accountNo: string | null;
    holderName: string | null;
    holderDoc: string | null;
    note: string | null;
  };
};

@Injectable()
export class PayoutsService {
  private logger = new Logger(PayoutsService.name);

  constructor(private prisma: PrismaService) {}

  // ============================================================
  //                       AFFILIATE (self)
  // ============================================================

  /**
   * Resumen del estado de pago del afiliado:
   * - monto disponible (commissions APPROVED no payouted)
   * - perfil status
   * - days until next 15 (countdown)
   * - canRequestPayout (>= 50 + perfil APPROVED)
   */
  async summary(user: AuthUser) {
    const codes = await this.prisma.referralCode.findMany({
      where: { ownerUserId: user.id },
      select: { id: true },
    });
    const myCodeIds = codes.map((c) => c.id);

    let availableUsd = 0;
    if (myCodeIds.length) {
      const rows = await this.prisma.commission.findMany({
        where: {
          recipientCodeId: { in: myCodeIds },
          status: CommissionStatus.APPROVED,
          payoutItem: null,
        },
        select: { amount: true },
      });
      availableUsd = rows.reduce((s, r) => s + Number(r.amount), 0);
    }

    const pendingUsd = await this.sumOfStatus(myCodeIds, CommissionStatus.PENDING);

    const profile = await this.prisma.paymentProfile.findUnique({
      where: { userId: user.id },
    });
    const profileStatus: PaymentProfileStatus = profile?.status ?? 'NONE';

    const fee = withdrawalFeeFor(availableUsd);
    const next = nextPayoutDate();
    return {
      availableUsd: round2(availableUsd),
      pendingUsd: round2(pendingUsd),
      minimumPayoutUsd: MIN_PAYOUT_USD,
      reachedMinimum: availableUsd >= MIN_PAYOUT_USD,
      // Costo de retiro: gratis si >= 50, sino 3 USD. netUsd = lo que recibe.
      freeWithdrawalMinUsd: FREE_WITHDRAWAL_MIN_USD,
      withdrawalFeeUsd: round2(fee),
      netUsd: round2(Math.max(0, availableUsd - fee)),
      profileStatus,
      profileRejectionReason: profile?.rejectionReason ?? null,
      payoutDayOfMonth: PAYOUT_DAY_OF_MONTH,
      daysUntilPayout: daysUntilNext(PAYOUT_DAY_OF_MONTH),
      // Próxima fecha posible de pago (día 15 o último del mes).
      nextPayoutDate: next,
      canRequestPayout: availableUsd > 0 && profileStatus === 'APPROVED',
    };
  }

  async getProfile(user: AuthUser) {
    return (
      (await this.prisma.paymentProfile.findUnique({
        where: { userId: user.id },
      })) ?? null
    );
  }

  async upsertProfile(
    user: AuthUser,
    dto: {
      firstName?: string;
      lastName?: string;
      phoneCountry?: string;
      phone?: string;
      method?: PaymentMethodKind;
      binanceEmail?: string;
      binancePhone?: string;
      binanceNote?: string;
      bankCountry?: string;
      bankName?: string;
      bankAccountType?: string;
      bankAccountNo?: string;
      bankHolderName?: string;
      bankHolderDoc?: string;
      bankNote?: string;
    },
  ) {
    const existing = await this.prisma.paymentProfile.findUnique({
      where: { userId: user.id },
    });

    const next = { ...(existing ?? {}), ...dto };
    this.assertCompleteProfile(next as any);

    // Cualquier cambio del afiliado vuelve a PENDING_REVIEW (salvo que el
    // perfil ya estaba APPROVED y no cambió ningún dato relevante — en
    // ese caso no tocamos el status). Para simplificar siempre marcamos
    // PENDING_REVIEW si hay diff vs lo aprobado; el admin re-aprueba.
    const status: PaymentProfileStatus = 'PENDING_REVIEW';
    const trim = (v?: string | null) =>
      v == null ? null : v.trim() || null;
    // Fix 2026-06-08: usar `next.*` (merge de existing + dto) en lugar
    // de `dto.*` directo. Si el afiliado guarda solo el bloque de su
    // método activo (ej. BINANCE), antes `trim(undefined) = null`
    // wipeaba silenciosamente bankCountry/bankAccountNo/etc. Ahora se
    // preservan los datos previos del otro método y el afiliado puede
    // alternar sin reingresar todo.
    const data = {
      firstName: trim(next.firstName),
      lastName: trim(next.lastName),
      phoneCountry: trim(next.phoneCountry),
      phone: trim(next.phone),
      method: next.method ?? null,
      binanceEmail: trim(next.binanceEmail),
      binancePhone: trim(next.binancePhone),
      binanceNote: trim(next.binanceNote),
      bankCountry: trim(next.bankCountry),
      bankName: trim(next.bankName),
      bankAccountType: trim(next.bankAccountType),
      bankAccountNo: trim(next.bankAccountNo),
      bankHolderName: trim(next.bankHolderName),
      bankHolderDoc: trim(next.bankHolderDoc),
      bankNote: trim(next.bankNote),
      status,
      rejectionReason: null,
    };

    if (existing) {
      return this.prisma.paymentProfile.update({
        where: { userId: user.id },
        data,
      });
    }
    return this.prisma.paymentProfile.create({
      data: { userId: user.id, ...data },
    });
  }

  async myPayouts(user: AuthUser) {
    const rows = await this.prisma.commissionPayout.findMany({
      where: { recipientUserId: user.id },
      include: {
        items: {
          include: {
            commission: {
              select: {
                id: true,
                amount: true,
                createdAt: true,
                referralUse: {
                  select: { tenant: { select: { brandName: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      feeUsd: Number(p.feeUsd ?? 0),
      // Fallback a amount para payouts viejos sin netUsd.
      netUsd: p.netUsd != null ? Number(p.netUsd) : Number(p.amount),
      currency: p.currency,
      status: p.status,
      methodSnapshot: p.methodSnapshot,
      proofUrl: p.proofUrl,
      proofMimeType: p.proofMimeType,
      paidAt: p.paidAt,
      notes: p.notes,
      createdAt: p.createdAt,
      itemsCount: p.items.length,
      items: p.items.map((it) => ({
        id: it.id,
        commissionId: it.commissionId,
        amount: Number(it.amount),
        commission: {
          createdAt: it.commission.createdAt,
          tenantName:
            it.commission.referralUse?.tenant?.brandName ?? '—',
        },
      })),
    }));
  }

  // ============================================================
  //                       ADMIN
  // ============================================================

  /**
   * Lista de afiliados "Listo por pagar": tienen >= MIN_PAYOUT_USD de
   * APPROVED no-payouted, perfil APPROVED, y NO tienen un payout
   * PROCESSING ya abierto.
   */
  async adminReadyToPay(user: AuthUser) {
    this.assertAdmin(user);
    const profiles = await this.prisma.paymentProfile.findMany({
      where: { status: 'APPROVED' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            phone: true,
            referralCodes: { select: { id: true, code: true, role: true } },
          },
        },
      },
    });

    const rows: Array<{
      userId: string;
      fullName: string;
      email: string;
      role: string;
      method: PaymentMethodKind;
      availableUsd: number;
      withdrawalFeeUsd: number;
      netUsd: number;
      codes: Array<{ id: string; code: string; role: string }>;
      profile: any;
      hasOpenPayout: boolean;
    }> = [];

    for (const p of profiles) {
      const codeIds = p.user.referralCodes.map((c) => c.id);
      if (!codeIds.length || !p.method) continue;
      const sumRows = await this.prisma.commission.findMany({
        where: {
          recipientCodeId: { in: codeIds },
          status: CommissionStatus.APPROVED,
          payoutItem: null,
        },
        select: { amount: true },
      });
      const available = sumRows.reduce((s, r) => s + Number(r.amount), 0);
      // Spec 2026-06-15: ya no se bloquea < 50; esos se pagan con costo de
      // retiro de 3 USD. Solo se omiten los que no tienen nada disponible.
      if (available <= 0) continue;
      const fee = withdrawalFeeFor(available);
      const openPayout = await this.prisma.commissionPayout.findFirst({
        where: { recipientUserId: p.userId, status: 'PROCESSING' },
        select: { id: true },
      });
      rows.push({
        userId: p.userId,
        fullName: p.user.fullName,
        email: p.user.email,
        role: p.user.role,
        method: p.method,
        availableUsd: round2(available),
        withdrawalFeeUsd: round2(fee),
        netUsd: round2(Math.max(0, available - fee)),
        codes: p.user.referralCodes,
        profile: this.maskProfile(p),
        hasOpenPayout: !!openPayout,
      });
    }

    rows.sort((a, b) => b.availableUsd - a.availableUsd);
    return {
      items: rows,
      total: rows.length,
      grandTotalUsd: round2(rows.reduce((s, r) => s + r.availableUsd, 0)),
      grandTotalNetUsd: round2(rows.reduce((s, r) => s + r.netUsd, 0)),
    };
  }

  /**
   * Lista de perfiles para revisar (status PENDING_REVIEW por default;
   * con filtro 'all' devuelve todos). El admin aprueba/rechaza.
   */
  async adminListProfiles(user: AuthUser, filter?: 'all' | 'pending') {
    this.assertAdmin(user);
    const profiles = await this.prisma.paymentProfile.findMany({
      where: filter === 'all' ? {} : { status: 'PENDING_REVIEW' },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, role: true },
        },
        reviewedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return profiles.map((p) => this.maskProfile(p));
  }

  async adminApproveProfile(
    user: AuthUser,
    userId: string,
    approve: boolean,
    rejectionReason?: string | null,
  ) {
    this.assertAdmin(user);
    const profile = await this.prisma.paymentProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    return this.prisma.paymentProfile.update({
      where: { userId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        rejectionReason: approve
          ? null
          : rejectionReason?.trim()?.slice(0, 500) ?? null,
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
      },
    });
  }

  /**
   * Crea el CommissionPayout para un afiliado: agarra TODAS sus
   * commissions APPROVED no-payouted, crea el payout (PROCESSING) y
   * los items. Las commissions quedan vinculadas pero todavía status
   * APPROVED — pasan a PAID cuando el admin sube el comprobante.
   */
  async adminCreatePayout(user: AuthUser, recipientUserId: string) {
    this.assertAdmin(user);
    const profile = await this.prisma.paymentProfile.findUnique({
      where: { userId: recipientUserId },
    });
    if (!profile || profile.status !== 'APPROVED' || !profile.method) {
      throw new BadRequestException(
        'El afiliado no tiene un perfil de pago aprobado',
      );
    }
    const open = await this.prisma.commissionPayout.findFirst({
      where: { recipientUserId, status: 'PROCESSING' },
      select: { id: true },
    });
    if (open) {
      throw new BadRequestException(
        'Ya existe un payout abierto para este afiliado',
      );
    }
    const codes = await this.prisma.referralCode.findMany({
      where: { ownerUserId: recipientUserId },
      select: { id: true },
    });
    const codeIds = codes.map((c) => c.id);
    if (!codeIds.length) {
      throw new BadRequestException('El afiliado no tiene códigos asociados');
    }
    const commissions = await this.prisma.commission.findMany({
      where: {
        recipientCodeId: { in: codeIds },
        status: CommissionStatus.APPROVED,
        payoutItem: null,
      },
      select: { id: true, amount: true },
    });
    const total = commissions.reduce((s, c) => s + Number(c.amount), 0);
    if (total <= 0) {
      throw new BadRequestException('El afiliado no tiene comisiones disponibles');
    }
    // Costo de retiro: gratis si >= 50, sino 3 USD. amount = bruto, netUsd =
    // lo que efectivamente se transfiere (bruto − fee). Si el bruto no cubre
    // ni el costo de retiro, no tiene sentido pagar (neto ≤ 0).
    const fee = withdrawalFeeFor(total);
    if (total <= fee) {
      throw new BadRequestException(
        `El monto disponible (${round2(total)} USD) no cubre el costo de retiro de ${fee} USD. Espera a acumular más.`,
      );
    }
    const net = round2(Math.max(0, total - fee));

    const snapshot: PaymentMethodSnapshot = {
      method: profile.method,
      firstName: profile.firstName,
      lastName: profile.lastName,
      phoneCountry: profile.phoneCountry,
      phone: profile.phone,
      binance:
        profile.method === 'BINANCE'
          ? {
              email: profile.binanceEmail,
              phone: profile.binancePhone,
              note: profile.binanceNote,
            }
          : undefined,
      bank:
        profile.method === 'BANK'
          ? {
              country: profile.bankCountry,
              bankName: profile.bankName,
              accountType: profile.bankAccountType,
              accountNo: profile.bankAccountNo,
              holderName: profile.bankHolderName,
              holderDoc: profile.bankHolderDoc,
              note: profile.bankNote,
            }
          : undefined,
    };

    const payout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.commissionPayout.create({
        data: {
          recipientUserId,
          amount: total,
          feeUsd: fee,
          netUsd: net,
          methodSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          notes:
            fee > 0
              ? `Costo de retiro ${WITHDRAWAL_FEE_USD} USD (monto < ${FREE_WITHDRAWAL_MIN_USD}). Neto: ${net} USD.`
              : null,
        },
      });
      await tx.commissionPayoutItem.createMany({
        data: commissions.map((c) => ({
          payoutId: created.id,
          commissionId: c.id,
          amount: c.amount,
        })),
      });
      return created;
    });

    return {
      id: payout.id,
      amount: Number(payout.amount),
      feeUsd: fee,
      netUsd: net,
      itemsCount: commissions.length,
    };
  }

  /**
   * Marca el payout como PAID y sube el comprobante (URL ya subida vía
   * /media/upload). Las commissions linked pasan a status PAID.
   */
  async adminMarkPayoutPaid(
    user: AuthUser,
    payoutId: string,
    dto: { proofUrl: string; proofMimeType?: string; notes?: string },
  ) {
    this.assertAdmin(user);
    const payout = await this.prisma.commissionPayout.findUnique({
      where: { id: payoutId },
      include: { items: { select: { commissionId: true } } },
    });
    if (!payout) throw new NotFoundException('Payout no encontrado');
    if (payout.status !== 'PROCESSING') {
      throw new BadRequestException(
        'El payout ya no está en estado PROCESSING',
      );
    }
    if (!dto.proofUrl?.trim()) {
      throw new BadRequestException('El comprobante es requerido');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.commissionPayout.update({
        where: { id: payoutId },
        data: {
          status: 'PAID',
          proofUrl: dto.proofUrl,
          proofMimeType: dto.proofMimeType ?? null,
          notes: dto.notes?.slice(0, 1000) ?? null,
          paidByUserId: user.id,
          paidAt: new Date(),
        },
      });
      const ids = payout.items.map((it) => it.commissionId);
      if (ids.length) {
        // FIX 2026-06-16 (review #4): además de status/paymentStatus, setear
        // amountPaid = amount. La definición canónica "pagado = Σ amountPaid"
        // (paneles + contabilidad) mostraba $0 para comisiones liquidadas vía
        // payout porque este flujo nunca seteaba amountPaid. updateMany no
        // puede referenciar la columna `amount` de la misma fila → raw UPDATE.
        await tx.$executeRawUnsafe(
          `UPDATE "Commission" SET "status" = 'PAID', "paymentStatus" = 'PAID', "amountPaid" = "amount", "paidAt" = now() WHERE id = ANY($1::text[])`,
          ids,
        );
      }
      return updated;
    });
  }

  /**
   * Reversar un payout (ALTO #9 — 2026-06-12). Casos de uso:
   *  - El pago Binance/banco falló o se devolvió.
   *  - El admin se equivocó al marcar como PAID.
   *  - Disputa: el afiliado dice que no recibió, hay que reabrir.
   *
   * Acciones (atómicas en $transaction):
   *  1. Payout pasa a status='REVERSED' con notes del motivo.
   *  2. Cada Commission del payout vuelve a APPROVED + paymentStatus
   *     se resetea a PENDING + paidAt=null.
   *  3. **Los CommissionPayoutItem se BORRAN** — antes quedaban
   *     "ocupando" la commission via UNIQUE(commissionId), impidiendo
   *     que un futuro payout la incluya. Sin esta liberación, el
   *     afiliado nunca podría cobrar esa commission de nuevo.
   *
   * Solo se puede reversar payouts en status PAID (sentido contable).
   */
  async adminReversePayout(
    user: AuthUser,
    payoutId: string,
    dto: { reason: string },
  ) {
    this.assertAdmin(user);
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('Motivo requerido');

    const payout = await this.prisma.commissionPayout.findUnique({
      where: { id: payoutId },
      include: { items: { select: { id: true, commissionId: true } } },
    });
    if (!payout) throw new NotFoundException('Payout no encontrado');
    if (payout.status !== 'PAID') {
      throw new BadRequestException(
        `Solo se pueden reversar payouts en estado PAID (este es ${payout.status})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const commissionIds = payout.items.map((it) => it.commissionId);
      const itemIds = payout.items.map((it) => it.id);

      // 1) Marcar payout como REVERSED + preservar notas + proof.
      const reversedPayout = await tx.commissionPayout.update({
        where: { id: payoutId },
        data: {
          status: 'REVERSED',
          notes:
            (payout.notes ? `${payout.notes}\n\n` : '') +
            `[REVERSED ${new Date().toISOString()}] ${reason}`,
        },
      });

      // 2) Commissions vuelven a APPROVED (pueden re-incluirse en
      //    futuros payouts). PaymentStatus a PENDING + paidAt=null.
      if (commissionIds.length) {
        await tx.commission.updateMany({
          where: { id: { in: commissionIds } },
          data: {
            status: CommissionStatus.APPROVED,
            paymentStatus: 'PENDING',
            paidAt: null,
            amountPaid: 0,
          },
        });
      }

      // 3) Liberar los CommissionPayoutItem. UNIQUE(commissionId) impide
      //    re-incluir las commissions en otro payout si no borramos.
      if (itemIds.length) {
        await tx.commissionPayoutItem.deleteMany({
          where: { id: { in: itemIds } },
        });
      }

      return reversedPayout;
    });
  }

  // ============================================================
  //                       Helpers
  // ============================================================

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }
  }

  private assertCompleteProfile(p: {
    firstName?: string | null;
    lastName?: string | null;
    phoneCountry?: string | null;
    phone?: string | null;
    method?: PaymentMethodKind | null;
    binanceEmail?: string | null;
    bankCountry?: string | null;
    bankName?: string | null;
    bankAccountType?: string | null;
    bankAccountNo?: string | null;
    bankHolderName?: string | null;
  }) {
    const missing: string[] = [];
    if (!p.firstName?.trim()) missing.push('Nombre');
    if (!p.lastName?.trim()) missing.push('Apellido');
    if (!p.phoneCountry?.trim()) missing.push('Código de país del teléfono');
    if (!p.phone?.trim()) missing.push('Teléfono');
    if (!p.method) missing.push('Método de pago');
    if (p.method === 'BINANCE') {
      if (!p.binanceEmail?.trim()) missing.push('Correo de Binance');
    } else if (p.method === 'BANK') {
      if (!p.bankCountry?.trim()) missing.push('País del banco');
      if (!p.bankName?.trim()) missing.push('Banco');
      if (!p.bankAccountType?.trim()) missing.push('Tipo de cuenta');
      if (!p.bankAccountNo?.trim()) missing.push('Número de cuenta');
      if (!p.bankHolderName?.trim()) missing.push('Titular de la cuenta');
    }
    if (missing.length) {
      throw new BadRequestException(
        `Faltan datos: ${missing.join(', ')}`,
      );
    }
  }

  /** Devuelve un perfil con campos sensibles enmascarados parcialmente
   *  (solo los últimos 4 dígitos del número de cuenta). */
  private maskProfile(p: any) {
    return {
      id: p.id,
      userId: p.userId,
      status: p.status,
      firstName: p.firstName,
      lastName: p.lastName,
      phoneCountry: p.phoneCountry,
      phone: p.phone,
      method: p.method,
      binanceEmail: p.binanceEmail,
      binancePhone: p.binancePhone,
      binanceNote: p.binanceNote,
      bankCountry: p.bankCountry,
      bankName: p.bankName,
      bankAccountType: p.bankAccountType,
      bankAccountNo: p.bankAccountNo,
      bankHolderName: p.bankHolderName,
      bankHolderDoc: p.bankHolderDoc,
      bankNote: p.bankNote,
      rejectionReason: p.rejectionReason,
      reviewedAt: p.reviewedAt,
      updatedAt: p.updatedAt,
      user: p.user,
      reviewedBy: p.reviewedBy,
    };
  }

  private async sumOfStatus(
    codeIds: string[],
    status: CommissionStatus,
  ): Promise<number> {
    if (!codeIds.length) return 0;
    const rows = await this.prisma.commission.findMany({
      where: { recipientCodeId: { in: codeIds }, status },
      select: { amount: true },
    });
    return rows.reduce((s, r) => s + Number(r.amount), 0);
  }

  // ============================================================
  //              RECONCILE CRON (refund/cancellation)
  // ============================================================

  /**
   * Defense-in-depth: cada hora rechaza commissions PENDING/APPROVED no
   * pagadas que pertenecen a tenants suspendidos por refund/chargeback /
   * subscription cancellation en los últimos 30 días.
   *
   * El webhook Hotmart (`hotmart.service.ts → churnReferral`) ya rechaza
   * la ÚLTIMA commission PENDING/APPROVED de cada use en el momento del
   * refund. Este cron cubre los casos que el webhook se pierde, llega
   * tarde, o donde se generaron commissions adicionales DESPUÉS del
   * suspendedAt (race entre cron generator + churn webhook).
   *
   * Filtro `paymentStatus: 'PENDING'`: NO tocamos commissions que ya
   * tuvieron algún pago parcial. Esas requieren reverso contable manual.
   * Solo prevenimos pagos futuros que aún no se hayan iniciado.
   *
   * Idempotente: rejected ya está fuera del filtro, así que correr el
   * cron 100 veces no cambia nada después de la primera pasada.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reconcileSuspendedTenantsCommissions() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const suspendedTenants = await this.prisma.tenant.findMany({
      where: {
        status: 'SUSPENDED',
        suspendedAt: { gte: cutoff },
      },
      select: { id: true, brandName: true, suspendedAt: true },
    });
    if (!suspendedTenants.length) return;

    let totalRejected = 0;
    for (const t of suspendedTenants) {
      const result = await this.prisma.commission.updateMany({
        where: {
          referralUse: { tenantId: t.id },
          status: { in: ['PENDING', 'APPROVED'] },
          paymentStatus: 'PENDING',
        },
        data: { status: 'REJECTED' },
      });
      if (result.count > 0) {
        this.logger.log(
          `Commission reconcile: ${result.count} rechazadas para tenant ${t.brandName} (${t.id}) — suspendido ${t.suspendedAt?.toISOString()}`,
        );
        totalRejected += result.count;
      }
    }
    if (totalRejected > 0) {
      this.logger.log(
        `Commission reconcile cron: ${totalRejected} commissions rechazadas en total (${suspendedTenants.length} tenants suspendidos revisados)`,
      );
    }
  }
}

/**
 * Días hasta el próximo día N del mes. Si hoy ES el día N, devuelve 0.
 * Si ya pasó este mes, calcula al N del próximo mes.
 */
function daysUntilNext(dayOfMonth: number): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  let target = new Date(year, month, dayOfMonth);
  if (today > dayOfMonth) {
    target = new Date(year, month + 1, dayOfMonth);
  }
  const diff = Math.ceil(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.max(0, diff);
}
