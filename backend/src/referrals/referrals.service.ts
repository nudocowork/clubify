import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { customAlphabet } from 'nanoid';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  resolveBrandScope,
  brandWhiteLabelWhere,
} from '../common/white-label/brand-scope.util';
import { AuthService } from '../auth/auth.service';
import { CommissionExceptionsService } from '../admin/commission-exceptions.service';
import { CommissionRecalcService } from './commission-recalc.service';
import { AuditService } from '../audit/audit.service';
import { monthKey } from '../common/period-key';
import { COMMISSION_DEFAULTS } from '../common/commission-defaults';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);

// Días de "hold" antes de que una comisión PENDING (pendiente por aprobar)
// pase a APPROVED (disponible para pagar). Protege contra reembolsos del
// cliente dentro de la ventana. Single source of truth: lo usa el cron de
// promoción y el cálculo de "disponible el" en el listado admin.
// 2026-06-15: 30 → 15 días (spec bloqueo/desbloqueo de comisiones).
const COMMISSION_HOLD_DAYS = 15;

// Redondeo a 2 decimales para montos monetarios (nivel módulo: lo usa el
// cron recurrente; algunas funciones definen su propio `round2` local).
const round2mod = (n: number) => Math.round(n * 100) / 100;

// Fecha efectiva de desbloqueo de una comisión: la almacenada `availableAt`
// (= pago Hotmart + 15 días, P3 2026-07-02) o, para comisiones legacy sin ese
// campo, el fallback histórico createdAt + COMMISSION_HOLD_DAYS.
function effectiveAvailableAt(c: {
  availableAt?: Date | null;
  createdAt: Date;
}): Date {
  if (c.availableAt) return new Date(c.availableAt);
  return new Date(new Date(c.createdAt).getTime() + COMMISSION_HOLD_DAYS * 86400000);
}

// Días restantes hasta que una comisión se desbloquee (0 si ya está
// disponible). Para status APPROVED/PAID = 0; para PENDING = lo que falte
// para su fecha efectiva de disponibilidad.
function daysRemainingUntilAvailable(
  c: { availableAt?: Date | null; createdAt: Date },
  status: string,
): number {
  if (status !== 'PENDING') return 0;
  const diffMs = effectiveAvailableAt(c).getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 86400000);
}

// Próxima fecha de pago: los pagos se liquidan el día 15 y el último día de
// cada mes. Devuelve la primera de esas fechas >= `from`. Si una comisión
// recién se desbloquea, su próxima fecha posible de cobro es esta.
function nextPayoutDate(from: Date = new Date()): Date {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  const candidates: Date[] = [];
  for (let m = 0; m <= 1; m++) {
    const y = base.getFullYear();
    const mo = base.getMonth() + m;
    candidates.push(new Date(y, mo, 15));
    candidates.push(new Date(y, mo + 1, 0)); // último día del mes mo
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  const next = candidates.find((d) => d.getTime() >= base.getTime());
  return next ?? candidates[candidates.length - 1];
}

export type CreateReferralDto = {
  fullName: string;
  email: string;
  whatsapp: string;
  commissionPercent?: number;
  source?: string;
  // Si está presente, auto-creamos User con role=AFFILIATE_INFLUENCER
  // y esta password, así el aplicante puede entrar a /login → /app/referrals
  // sin esperar al admin.
  password?: string;
};

@Injectable()
export class ReferralsService {
  private logger = new Logger(ReferralsService.name);

  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private jwt: JwtService,
    private commissionExceptions: CommissionExceptionsService,
    private recalc: CommissionRecalcService,
    private audit: AuditService,
  ) {}

  /**
   * SUPER_ADMIN entra al panel /affiliate de un influencer/embajador como
   * si fuera el dueño. Mismo patrón que `tenants.impersonate`: firma un
   * JWT con `impersonatedBy` y devuelve el user para que el frontend lo
   * guarde en sesión. El acceso queda registrado en logs por ese campo.
   */
  async impersonateAffiliate(codeId: string, superAdminId: string) {
    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: {
        id: true,
        code: true,
        ownerName: true,
        ownerEmail: true,
        ownerUserId: true,
        role: true,
      },
    });
    if (!code) throw new NotFoundException('Código no encontrado');
    if (!code.ownerUserId) {
      throw new BadRequestException(
        'Este código no tiene un usuario afiliado vinculado todavía.',
      );
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: code.ownerUserId },
      select: { id: true, email: true, fullName: true, role: true, tenantId: true, isActive: true },
    });
    if (!owner || !owner.isActive) {
      throw new BadRequestException('El usuario del afiliado no está activo.');
    }
    if (!owner.role.startsWith('AFFILIATE_')) {
      throw new BadRequestException(
        'El usuario vinculado al código no es un afiliado.',
      );
    }

    const payload = {
      sub: owner.id,
      email: owner.email,
      role: owner.role,
      tenantId: owner.tenantId,
      impersonatedBy: superAdminId,
    };
    const accessToken = this.jwt.sign(payload);

    return {
      accessToken,
      user: {
        id: owner.id,
        email: owner.email,
        fullName: owner.fullName,
        role: owner.role,
        tenantId: owner.tenantId,
      },
      affiliate: {
        codeId: code.id,
        code: code.code,
        ownerName: code.ownerName,
        ownerEmail: code.ownerEmail,
        role: code.role,
      },
    };
  }

  /**
   * Slugify del nombre del afiliado para link corto `/ref/<slug>`.
   * Cae al `code` lowercase si el slug ideal está tomado o queda vacío.
   */
  private slugify(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  private async allocateSlug(ownerName: string, fallbackCode: string): Promise<string> {
    const base = this.slugify(ownerName) || fallbackCode.toLowerCase();
    let candidate = base;
    let suffix = 2;
    // Probamos hasta 50 variantes: nombre, nombre-2, nombre-3, ...
    // Si todas chocan, caemos al lowercase del código (siempre único).
    while (await this.prisma.referralCode.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix++}`;
      if (suffix > 50) {
        candidate = fallbackCode.toLowerCase();
        if (!(await this.prisma.referralCode.findUnique({ where: { slug: candidate } }))) {
          return candidate;
        }
        candidate = `${fallbackCode.toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
        break;
      }
    }
    return candidate;
  }

  /**
   * Resuelve `/ref/<slug>` → ReferralCode + loguea visita (UTM, referer,
   * país, IP). Si el slug no matchea, igual loguea con referralCodeId=null
   * para análisis de slugs rotos / phishing-like.
   */
  async resolveBySlug(
    slug: string,
    ctx: {
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      userAgent?: string;
      referer?: string;
      country?: string;
      ip?: string;
    },
  ) {
    const clean = (slug || '').toLowerCase().trim().slice(0, 80);
    if (!clean) throw new BadRequestException('slug required');

    const select = {
      id: true,
      code: true,
      slug: true,
      ownerName: true,
      isActive: true,
      approvedAt: true,
      role: true,
      campaign: { select: { id: true, name: true, status: true } },
    } as const;

    // 1) Buscar por slug (el caso normal).
    let code = await this.prisma.referralCode.findUnique({
      where: { slug: clean },
      select,
    });

    // 2) Fallback: si alguien comparte el código (uppercase) como URL en vez
    // del slug, lo aceptamos. También cubre registros legacy sin slug seteado.
    if (!code) {
      code = await this.prisma.referralCode.findUnique({
        where: { code: clean.toUpperCase() },
        select,
      });
    }

    // Loguear visita siempre (incluso si slug no existe) — fire-and-forget.
    this.prisma.referralVisit
      .create({
        data: {
          slug: clean,
          referralCodeId: code?.id ?? null,
          ip: ctx.ip?.slice(0, 60) ?? null,
          userAgent: ctx.userAgent?.slice(0, 500) ?? null,
          country: ctx.country?.slice(0, 8) ?? null,
          referer: ctx.referer?.slice(0, 1000) ?? null,
          utmSource: ctx.utmSource?.slice(0, 80) ?? null,
          utmMedium: ctx.utmMedium?.slice(0, 80) ?? null,
          utmCampaign: ctx.utmCampaign?.slice(0, 80) ?? null,
        },
      })
      .catch((err) => {
        this.logger.warn(`Failed to log ReferralVisit for slug=${clean}: ${err.message}`);
      });

    if (!code) throw new NotFoundException('slug not found');
    return code;
  }

  /**
   * Setea o limpia el slug custom del código. SUPER_ADMIN only.
   * Si slug = null, vuelve a lowercase(code) para mantener invariante
   * "todo código tiene slug usable".
   */
  async setSlug(id: string, newSlug: string | null) {
    const target = await this.prisma.referralCode.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('code not found');

    const clean = (newSlug ?? '').toLowerCase().trim();
    const finalSlug = clean
      ? this.slugify(clean) || target.code.toLowerCase()
      : target.code.toLowerCase();

    if (finalSlug === target.slug) return target;

    const taken = await this.prisma.referralCode.findUnique({ where: { slug: finalSlug } });
    if (taken && taken.id !== id) {
      throw new BadRequestException(`slug "${finalSlug}" ya está en uso`);
    }

    return this.prisma.referralCode.update({
      where: { id },
      data: { slug: finalSlug },
    });
  }

  /**
   * Cron diario que reconcilia comisiones recurrentes. Defensa en
   * profundidad por si el webhook Hotmart no llegó en algún ciclo
   * (problemas de red, payload distinto, etc).
   *
   * 2026-06-06 (bug item 7): la lógica anterior asumía que toda renovación
   * era mensual (cutoff de 28 días sobre priceMonthly). Con los 4 planes
   * de periodicidad (Mensual / Trimestral / Semestral / Anual) eso
   * generaba comisiones falsas mes a mes para clientes con plan trimestral
   * o más largo, aunque Hotmart NO había confirmado un nuevo pago.
   *
   * Nueva lógica:
   *   1. ReferralUse PAYING/ACTIVE con tenant ACTIVE.
   *   2. Disparamos SOLO si `tenant.currentPeriodEnd` AVANZÓ después de la
   *      última Commission — eso señala que Hotmart confirmó una nueva
   *      renovación (cualquiera sea la periodicidad).
   *   3. Si Hotmart NO mandó el webhook (la razón de existir este cron),
   *      `currentPeriodEnd` igual avanzó porque la reconciliación de
   *      Hotmart o un PATCH manual la movió.
   *   4. La comisión se calcula sobre `priceMonthly` como fallback — el
   *      monto real lo pondría el webhook directo. Documentado abajo.
   */
  /**
   * Cron diario que promueve commissions PENDING → APPROVED después
   * de 30 días de hold. Antes solo se promovía cuando un SUPER_ADMIN
   * abría `/admin/commissions` (única call-site de `payouts()`). Sin
   * esto, el panel del afiliado siempre mostraba $0 disponible y
   * `/admin/payouts/ready-to-pay` nunca tenía a nadie.
   *
   * Fix audit 2026-06-07.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async promotePendingToApproved() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - COMMISSION_HOLD_DAYS * 86400000);
    const res = await this.prisma.commission.updateMany({
      where: {
        status: 'PENDING',
        // P3 2026-07-02: desbloquea por availableAt (= pago Hotmart + 15d).
        // Fallback legacy (availableAt null): createdAt + 15d.
        OR: [
          { availableAt: { lte: now } },
          { availableAt: null, createdAt: { lte: cutoff } },
        ],
      },
      data: { status: 'APPROVED' as CommissionStatus },
    });
    if (res.count > 0) {
      this.logger.log(
        `promotePendingToApproved: ${res.count} commissions PENDING → APPROVED`,
      );
    }
  }

  // DESACTIVADO 2026-07-16 (comisiones fantasma / dinero): este cron creaba
  // comisiones de RENOVACIÓN por CALENDARIO — solo miraba `currentPeriodEnd > now`
  // + una ventana de meses, SIN verificar un pago real de Hotmart. Cuando
  // `currentPeriodEnd` se empujaba al futuro sin cobro (healStaleCharge, acciones
  // manuales de admin, drift de la fecha de próximo cobro de Hotmart), fabricaba
  // comisiones de renovaciones que nunca se cobraron (Birria Leon, Buenos Diaz,
  // Mykoz, &N Coffee, Cocoa...). El webhook de Hotmart YA genera la comisión de
  // renovación en cada cobro VERIFICADO (activatePurchase → generateCommissions*,
  // dedup por transacción), así que este reconciliador de calendario es redundante
  // y solo introducía falsos positivos. Regla del negocio: comisión SOLO con pago
  // validado por Hotmart. Se quita el @Cron (ya no se agenda). NO reactivar sin
  // gating por transacción Hotmart real del ciclo.
  async reconcileRecurringCommissions() {
    const now = new Date();

    const candidates = await this.prisma.referralUse.findMany({
      where: {
        status: { in: ['PAYING', 'ACTIVE'] },
        tenantId: { not: null },
        tenant: {
          status: 'ACTIVE',
          currentPeriodEnd: { gt: now },
        },
        // Un código de afiliado DESACTIVADO no debe seguir devengando
        // comisiones nuevas. Esto sostiene el borrado-con-anulación: al
        // desactivar el código, el cron deja de generarle comisiones.
        referralCode: { isActive: true },
      },
      include: {
        referralCode: {
          select: {
            id: true,
            commissionPercent: true,
            role: true,
            parentCodeId: true,
          },
        },
        tenant: {
          select: {
            currentPeriodEnd: true,
            planPeriodicity: true,
            subscriptionPriceUsd: true,
            lastChargeAt: true,
            plan: { select: { priceMonthly: true } },
          },
        },
      },
    });

    // % indirecto del influencer parent (Setting, default 5). Se lee una vez.
    const indirectRow = await this.prisma.setting.findUnique({
      where: { key: 'referrals.indirectPercent' },
    });
    const indirectPct = indirectRow?.value ? Number(indirectRow.value) : 5;

    let created = 0;
    for (const use of candidates) {
      const cpeDate = use.tenant?.currentPeriodEnd;
      if (!cpeDate) continue;
      if (!use.tenantId) continue;
      const months = bundleMonths(use.tenant?.planPeriodicity ?? null);
      // Base = precio REAL pagado en Hotmart (subscriptionPriceUsd) si lo
      // tenemos, sino el canónico del bundle (68/150/278/500). NUNCA
      // priceMonthly × meses. Fuente única: getCommissionBase.
      const price = await this.recalc.getCommissionBase(
        use.tenant?.subscriptionPriceUsd ?? null,
        use.tenant?.planPeriodicity ?? null,
      );
      if (price <= 0) continue;

      // FIX 2026-06-15 (bug comisiones diarias): el guard viejo comparaba
      // currentPeriodEnd (una fecha FUTURA) contra last.createdAt (reciente).
      // La condición casi nunca se cumplía mientras la suscripción seguía
      // activa → este cron diario creaba UNA comisión POR DÍA. El UNIQUE
      // constraint no lo frena en prod (no aplicado / periodKey insuficiente
      // para bundles multi-mes).
      //
      // Dedup correcto: por CICLO DE FACTURACIÓN. Si ya existe cualquier
      // comisión para este (use, recipient) creada dentro del ciclo actual
      // [currentPeriodEnd − bundleMonths, currentPeriodEnd] — incluida la del
      // webhook — NO generamos otra. Cubre Mensual/Trimestral/Semestral/Anual
      // y no depende del UNIQUE constraint.
      const periodStart = new Date(cpeDate);
      periodStart.setMonth(periodStart.getMonth() - months);

      // Helper: crea una comisión para `recipientCodeId` en este ciclo si no
      // existe ya (dedup por ciclo de facturación + UNIQUE constraint).
      const ensureCommission = async (recipientCodeId: string, amount: number) => {
        if (amount <= 0) return;
        const existing = await this.prisma.commission.findFirst({
          where: {
            referralUseId: use.id,
            recipientCodeId,
            createdAt: { gte: periodStart },
          },
          select: { id: true },
        });
        if (existing) return;
        try {
          await this.prisma.commission.create({
            data: {
              referralUseId: use.id,
              amount,
              status: 'PENDING',
              recipientCodeId,
              periodKey: monthKey(),
              // P3 2026-07-02: desbloqueo 15d después del pago real en Hotmart.
              availableAt: new Date(
                (use.tenant?.lastChargeAt ?? new Date()).getTime() +
                  COMMISSION_HOLD_DAYS * 86400000,
              ),
            },
          });
          created += 1;
        } catch (e: any) {
          if (e?.code === 'P2002') {
            this.logger.warn(
              `reconcileRecurringCommissions: skip dup (useId=${use.id}, recipientCodeId=${recipientCodeId}, periodKey=${monthKey()})`,
            );
            return;
          }
          throw e;
        }
      };

      // DIRECTA: el % del embajador/influencer (con excepción por cliente si
      // existe). Base = precio del BUNDLE según periodicidad.
      const pct = await this.resolveExceptionPercent(
        use.tenantId,
        use.referralCode.id,
        Number(use.referralCode.commissionPercent ?? COMMISSION_DEFAULTS.ambassadorPct),
      );
      await ensureCommission(use.referralCode.id, round2mod((price * pct) / 100));

      // INDIRECTA: si el code es AMBASSADOR con un influencer parent, ese
      // influencer cobra el % indirecto (5%) sobre el MISMO referido — NO su
      // % propio. Antes el cron procesaba un "parent-use" del influencer y le
      // pagaba su 25% completo en cada renovación (bug Birria León 2026-06-15).
      if (
        use.referralCode.role === 'AMBASSADOR' &&
        use.referralCode.parentCodeId
      ) {
        const indirectAmount = round2mod((price * indirectPct) / 100);
        if (indirectAmount > 0) {
          // DEDUP CROSS-USE (fix 2026-06-16): el webhook Hotmart guarda el
          // indirecto en un "parent-use" APARTE (referralUseId distinto al del
          // embajador). El dedup de `ensureCommission` es por use.id → no lo
          // ve → doble-pago del 5% en cada renovación. Acá buscamos CUALQUIER
          // comisión del influencer parent para ESTE tenant dentro del ciclo,
          // sin importar el referralUseId, y solo creamos si no existe.
          const existingIndirect = await this.prisma.commission.findFirst({
            where: {
              recipientCodeId: use.referralCode.parentCodeId,
              status: { not: 'REJECTED' },
              createdAt: { gte: periodStart },
              referralUse: { tenantId: use.tenantId },
            },
            select: { id: true },
          });
          if (!existingIndirect) {
            await ensureCommission(
              use.referralCode.parentCodeId,
              indirectAmount,
            );
          }
        }
      }
    }

    if (created > 0) {
      this.logger.log(`Reconciled recurring commissions: created=${created}`);
    }
  }

  /** Resuelve la marca blanca dueña de un afiliado nuevo: prioridad al padre
   *  (sub-afiliado hereda la marca de su embajador/influencer), luego al admin
   *  que lo crea (user.whiteLabelId), y por último cae a "Clubify" (registro
   *  público sin contexto de marca). Mantiene los referidos aislados por marca. */
  private async resolveAffiliateWhiteLabelId(opts: {
    user?: AuthUser;
    parentWhiteLabelId?: string | null;
  }): Promise<string | null> {
    if (opts.parentWhiteLabelId) return opts.parentWhiteLabelId;
    if (opts.user?.whiteLabelId) return opts.user.whiteLabelId;
    const clubify = await this.prisma.whiteLabel.findFirst({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    return clubify?.id ?? null;
  }

  async createCode(dto: CreateReferralDto) {
    if (!dto.fullName || !dto.email || !dto.whatsapp) {
      throw new BadRequestException('fullName, email and whatsapp required');
    }
    // Email único global a través de todos los roles de afiliado.
    // Si ya existe en ReferralCode (cualquier role) o en User
    // con role AFFILIATE_*, lanza 409. Permite que 2 personas
    // con el mismo nombre se registren, pero no con el mismo correo.
    await this.assertUniqueAffiliateEmail(dto.email);
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    const cleanSource = dto.source?.trim().slice(0, 60) || null;
    const slug = await this.allocateSlug(dto.fullName, code);
    const referral = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.whatsapp,
        commissionPercent: dto.commissionPercent ?? COMMISSION_DEFAULTS.ambassadorPct,
        source: cleanSource,
        whiteLabelId: await this.resolveAffiliateWhiteLabelId({}),
      },
    });

    // Si el aplicante tipeó password, auto-creamos cuenta AFFILIATE_INFLUENCER
    // así puede entrar inmediatamente a /login. Si falla (email duplicado,
    // etc), no rompemos la creación del referralCode — admin lo arregla.
    let createdAccount = false;
    if (dto.password && dto.password.trim().length >= 8) {
      const inviteResult = await this.auth
        .inviteAffiliate({
          email: dto.email,
          fullName: dto.fullName,
          role: 'AFFILIATE_INFLUENCER',
          referralCodeId: referral.id,
          phone: dto.whatsapp,
          presetPassword: dto.password.trim(),
        })
        .catch(() => null);
      createdAccount = !!inviteResult?.password;
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return {
      ...referral,
      shareLink: `${appUrl}/ref/${slug}`,
      legacyShareLink: `${appUrl}/?ref=${code}`,
      // Si creamos cuenta, el frontend muestra el CTA "Entrar al panel".
      accountReady: createdAccount,
    };
  }

  async list(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.referralCode.findMany({
      // Aislamiento por marca.
      where: user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {},
      include: {
        uses: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            commissions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Devuelve los códigos del usuario autenticado (matcheando por email),
   * sus usos y comisiones, listos para el panel /app/referrals.
   */
  async listMine(user: AuthUser) {
    if (!user.email) return { codes: [], totals: { signedUp: 0, converted: 0, paidUsd: 0, pendingUsd: 0 } };

    const codes = await this.prisma.referralCode.findMany({
      where: { ownerEmail: user.email },
      include: {
        uses: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            commissions: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';

    let signedUp = 0;
    let converted = 0;
    let paidUsd = 0;
    let pendingUsd = 0;

    const enriched = codes.map((c) => {
      const uses = c.uses ?? [];
      signedUp += uses.length;
      converted += uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length;
      for (const u of uses) {
        for (const com of u.commissions ?? []) {
          // FIX 2026-06-16 (#14/#37): definición canónica única —
          // pending = (PENDING+APPROVED) con amount − amountPaid;
          // paid = amountPaid real (cubre pagos parciales). RETAINED y
          // REJECTED quedan fuera de ambos totales.
          if (com.status === 'REJECTED' || com.status === 'RETAINED') continue;
          const amount = Number(com.amount);
          const paid = Number(com.amountPaid);
          paidUsd += paid;
          if (com.status === 'PENDING' || com.status === 'APPROVED') {
            pendingUsd += Math.max(0, amount - paid);
          }
        }
      }
      return {
        id: c.id,
        code: c.code,
        commissionPercent: Number(c.commissionPercent),
        isActive: c.isActive,
        createdAt: c.createdAt,
        shareLink: `${appUrl}/?ref=${c.code}`,
        usesCount: uses.length,
        convertedCount: uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length,
        uses: uses.map((u) => ({
          id: u.id,
          status: u.status,
          createdAt: u.createdAt,
          convertedAt: u.convertedAt,
          tenantBrand: u.tenant?.brandName ?? null,
          tenantStatus: u.tenant?.status ?? null,
          commissionsTotal: (u.commissions ?? []).reduce((s, x) => s + Number(x.amount), 0),
        })),
      };
    });

    return {
      codes: enriched,
      totals: {
        signedUp,
        converted,
        paidUsd: Math.round(paidUsd * 100) / 100,
        pendingUsd: Math.round(pendingUsd * 100) / 100,
      },
    };
  }

  async getByCode(code: string) {
    const r = await this.prisma.referralCode.findUnique({
      where: { code },
      include: {
        uses: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            commissions: true,
          },
        },
      },
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  async createCommission(useId: string, amount: number) {
    // SUPER_ADMIN manual create. Necesitamos resolver el recipientCodeId
    // del use para que el UNIQUE constraint funcione. Sin él, la
    // commission queda con (null, null, null) y no dedupa.
    const use = await this.prisma.referralUse.findUnique({
      where: { id: useId },
      select: { referralCodeId: true },
    });
    return this.prisma.commission.create({
      data: {
        referralUseId: useId,
        amount,
        status: 'PENDING',
        recipientCodeId: use?.referralCodeId ?? null,
        periodKey: monthKey(),
      },
    });
  }

  async setCommissionStatus(
    id: string,
    status: CommissionStatus,
    opts: { cascade?: boolean } = {},
  ) {
    const updated = await this.prisma.commission.update({
      where: { id },
      data: {
        status,
        paidAt: status === 'PAID' ? new Date() : null,
        // FIX 2026-06-16 (review #4): marcar PAID también sincroniza
        // paymentStatus. amountPaid=amount se setea abajo (no se puede
        // auto-referenciar la columna en un update). Sin esto, "pagado"
        // (= Σ amountPaid) y la contabilidad mostraban $0.
        ...(status === 'PAID' ? { paymentStatus: 'PAID' as const } : {}),
      },
      select: { id: true, status: true, referralUseId: true, periodKey: true },
    });
    if (status === 'PAID') {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "Commission" SET "amountPaid" = "amount" WHERE id = $1`,
        id,
      );
    }

    // #4 (2026-06-16) CASCADA POR VENTA: al rechazar, anulamos también las
    // comisiones hermanas del MISMO cobro (mismo referralUse + periodKey →
    // influencer/embajador/5% indirecto/vendedor). Una venta cancelada no
    // debe dejar comisiones colgadas de los otros actores. Solo cuando
    // periodKey != null (las legacy se rechazan individualmente para no
    // barrer ciclos distintos del mismo use). PAID nunca se toca.
    let cascaded = 0;
    if (
      opts.cascade !== false &&
      status === 'REJECTED' &&
      updated.periodKey != null
    ) {
      const res = await this.prisma.commission.updateMany({
        where: {
          referralUseId: updated.referralUseId,
          periodKey: updated.periodKey,
          id: { not: updated.id },
          status: { in: ['PENDING', 'APPROVED'] },
        },
        data: { status: 'REJECTED' },
      });
      cascaded = res.count;
    }

    return { ...updated, cascaded };
  }

  async setCommissionNotes(
    id: string,
    patch: { notes?: string | null; markContacted?: boolean },
  ) {
    return this.prisma.commission.update({
      where: { id },
      data: {
        notes: patch.notes ?? undefined,
        clientContactedAt:
          patch.markContacted === true ? new Date() : patch.markContacted === false ? null : undefined,
      },
    });
  }

  /**
   * Leaderboard: agrega por afiliado (matcheado por email del code), suma
   * inscritos / conversiones / revenue generado / comisiones pagadas y
   * pendientes. Ordenado por conversiones desc.
   */
  async leaderboard(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const codes = await this.prisma.referralCode.findMany({
      // #7/#38 (2026-06-16): excluir afiliados eliminados (soft-delete
      // isActive=false) del ranking. Antes el leaderboard los seguía
      // mostrando y los seguía rankeando.
      // Aislamiento por marca.
      where: {
        isActive: true,
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      include: {
        uses: {
          include: { commissions: true },
        },
      },
    });

    type Row = {
      ownerName: string;
      ownerEmail: string;
      ownerWhatsapp: string;
      codes: string[];
      totalReferrals: number;
      paidConversions: number;
      commissionsPaidUsd: number;
      commissionsPendingUsd: number;
      revenueGeneratedUsd: number;
    };

    const map = new Map<string, Row>();
    for (const c of codes) {
      const key = c.ownerEmail.toLowerCase();
      const row = map.get(key) ?? {
        ownerName: c.ownerName,
        ownerEmail: c.ownerEmail,
        ownerWhatsapp: c.ownerWhatsapp,
        codes: [],
        totalReferrals: 0,
        paidConversions: 0,
        commissionsPaidUsd: 0,
        commissionsPendingUsd: 0,
        revenueGeneratedUsd: 0,
      };
      row.codes.push(c.code);
      row.totalReferrals += c.uses.length;
      for (const u of c.uses) {
        if (u.status === 'PAYING' || u.status === 'ACTIVE') row.paidConversions++;
        for (const com of u.commissions) {
          const amt = Number(com.amount);
          row.revenueGeneratedUsd += amt;
          if (com.status === 'PAID') row.commissionsPaidUsd += amt;
          else if (com.status === 'PENDING' || com.status === 'APPROVED')
            row.commissionsPendingUsd += amt;
        }
      }
      map.set(key, row);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        commissionsPaidUsd: round(r.commissionsPaidUsd),
        commissionsPendingUsd: round(r.commissionsPendingUsd),
        revenueGeneratedUsd: round(r.revenueGeneratedUsd),
      }))
      .sort((a, b) => {
        if (b.paidConversions !== a.paidConversions)
          return b.paidConversions - a.paidConversions;
        if (b.totalReferrals !== a.totalReferrals)
          return b.totalReferrals - a.totalReferrals;
        return b.commissionsPaidUsd - a.commissionsPaidUsd;
      });
  }

  // ============================================================
  //              FASE 4 — Admin: dashboard + listas
  // ============================================================

  /**
   * Resumen global del módulo. Agrega TODO lo que necesita el tab
   * "Resumen" del admin: KPIs, top campañas, top influencers, top
   * embajadores, breakdown por estado de comisiones.
   */
  async adminSummary(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    // Agregados de comisiones — los hacemos en SQL (groupBy + aggregate)
    // en lugar de cargar TODA la tabla a memoria. A 100k+ commissions el
    // findMany() previo bloqueaba el dashboard.
    const oneMonthAgo = new Date(Date.now() - 30 * 86400_000);
    const oneMonthAgoMs = oneMonthAgo.getTime();
    // Aislamiento por marca: códigos por whiteLabelId, comisiones/uses vía el
    // tenant del referido, campañas vía su influencer dueño. Sin marca en
    // sesión → default Clubify (NO "ver todo": antes con wlId null este panel
    // mostraba campañas/códigos de TODAS las marcas → Clubify veía Sellea).
    const scope = await resolveBrandScope(this.prisma, user.whiteLabelId);
    const brand = brandWhiteLabelWhere(scope);
    const hasBrand = Object.keys(brand).length > 0;
    const codeWhere = hasBrand ? brand : {};
    const commWhere = hasBrand ? { referralUse: { tenant: brand } } : {};
    const useWhere = hasBrand ? { tenant: brand } : {};
    const campWhere = hasBrand ? { ownerCode: brand } : {};
    const [campaigns, codes, uses, commByStatus, mrrAgg] = await Promise.all([
      this.prisma.campaign.findMany({
        where: campWhere,
        include: {
          ownerCode: { include: { uses: { include: { commissions: true } } } },
          codes: { include: { uses: { include: { commissions: true } } } },
        },
      }),
      this.prisma.referralCode.findMany({ where: { isActive: true, ...codeWhere } }),
      // Incluimos commissions embebidas en el use para evitar un segundo
      // findMany() sobre toda la tabla — los agregados por code/socio se
      // calculan en memoria sobre estas listas locales.
      this.prisma.referralUse.findMany({
        where: useWhere,
        include: {
          referralCode: { select: { role: true, ownerName: true, code: true } },
          commissions: {
            select: { amount: true, status: true, referralUseId: true },
          },
        },
      }),
      this.prisma.commission.groupBy({
        by: ['status'],
        where: commWhere,
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: {
          createdAt: { gte: oneMonthAgo },
          status: { not: 'REJECTED' },
          ...commWhere,
        },
        _sum: { amount: true },
      }),
    ]);

    const round = (n: number) => Math.round(n * 100) / 100;
    const sumFor = (status: string) =>
      Number(commByStatus.find((r) => r.status === status)?._sum.amount ?? 0);
    const commPaidUsd = sumFor('PAID');
    const commApprovedUsd = sumFor('APPROVED');
    const commPendingUsd = sumFor('PENDING');
    const commRejectedUsd = sumFor('REJECTED');
    const mrrUsd = Number(mrrAgg._sum.amount ?? 0);

    const activeUses = uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE');
    const churnedUses = uses.filter((u) => u.status === 'CHURNED');
    const trialUses = uses.filter((u) => u.status === 'SIGNED_UP');

    const influencerCount = codes.filter((c) => c.role === 'INFLUENCER').length;
    const ambassadorCount = codes.filter((c) => c.role === 'AMBASSADOR').length;

    // Top campañas por MRR generado (últimos 30d).
    const campaignRows = campaigns.map((camp) => {
      const allUses = [
        ...camp.ownerCode.uses,
        ...camp.codes.flatMap((c) => c.uses),
      ];
      const recentMrr = allUses
        .flatMap((u) => u.commissions)
        .filter(
          (c) =>
            c.status !== 'REJECTED' &&
            new Date(c.createdAt).getTime() >= oneMonthAgoMs,
        )
        .reduce((s, c) => s + Number(c.amount), 0);
      return {
        id: camp.id,
        name: camp.name,
        ownerCode: camp.ownerCode.code,
        ownerName: camp.ownerCode.ownerName,
        status: camp.status,
        ambassadors: camp.codes.length,
        activeClients: allUses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length,
        mrrUsd: round(recentMrr),
      };
    });

    // Top influencers/embajadores por revenue total generado.
    type CodeAgg = {
      code: string;
      ownerName: string;
      role: string;
      activeClients: number;
      totalClients: number;
      revenueUsd: number;
    };
    const codeAggMap = new Map<string, CodeAgg>();
    for (const u of uses) {
      if (u.referralCode.role === 'SOCIO') continue;
      const key = u.referralCode.code;
      const row = codeAggMap.get(key) ?? {
        code: u.referralCode.code,
        ownerName: u.referralCode.ownerName,
        role: u.referralCode.role,
        activeClients: 0,
        totalClients: 0,
        revenueUsd: 0,
      };
      row.totalClients += 1;
      if (u.status === 'PAYING' || u.status === 'ACTIVE') row.activeClients += 1;
      // Las commissions vienen embebidas en el include de `uses`.
      const revenue = u.commissions
        .filter((c) => c.status !== 'REJECTED')
        .reduce((s, c) => s + Number(c.amount), 0);
      row.revenueUsd += revenue;
      codeAggMap.set(key, row);
    }
    const codeAgg = Array.from(codeAggMap.values()).map((r) => ({
      ...r,
      revenueUsd: round(r.revenueUsd),
      // Conversión: % de inscritos que terminaron pagando.
      conversionRate:
        r.totalClients > 0 ? Math.round((r.activeClients / r.totalClients) * 1000) / 10 : 0,
    }));
    const topInfluencers = codeAgg
      .filter((r) => r.role === 'INFLUENCER')
      .sort((a, b) => b.revenueUsd - a.revenueUsd)
      .slice(0, 5);
    const topAmbassadors = codeAgg
      .filter((r) => r.role === 'AMBASSADOR')
      .sort((a, b) => b.revenueUsd - a.revenueUsd)
      .slice(0, 5);

    // Comisión socio: suma de comisiones del use cuyo code tiene role=SOCIO.
    const socioRows = uses.filter((u) => u.referralCode.role === 'SOCIO');
    let socioPaidUsd = 0;
    let socioPendingUsd = 0;
    for (const u of socioRows) {
      for (const c of u.commissions) {
        const a = Number(c.amount);
        if (c.status === 'PAID') socioPaidUsd += a;
        else if (c.status === 'PENDING' || c.status === 'APPROVED') socioPendingUsd += a;
      }
    }

    return {
      kpis: {
        activeCampaigns: campaigns.filter((c) => c.status === 'ACTIVE').length,
        totalCampaigns: campaigns.length,
        influencerCount,
        ambassadorCount,
        totalReferredClients: uses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        activeClients: activeUses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        churnedClients: churnedUses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        trialClients: trialUses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        mrrUsd: round(mrrUsd),
        commPaidUsd: round(commPaidUsd),
        commPendingUsd: round(commPendingUsd + commApprovedUsd),
        commRejectedUsd: round(commRejectedUsd),
        socioPaidUsd: round(socioPaidUsd),
        socioPendingUsd: round(socioPendingUsd),
        netoEmpresaUsd: 0, // placeholder; F5 calcula real
      },
      topCampaigns: campaignRows
        .sort((a, b) => b.mrrUsd - a.mrrUsd)
        .slice(0, 5),
      topInfluencers,
      topAmbassadors,
    };
  }

  async listInfluencers(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const codes = await this.prisma.referralCode.findMany({
      // #7 (2026-06-16): no listar influencers eliminados (isActive=false).
      // Aislamiento por marca: cada Master Admin ve solo los suyos.
      where: {
        role: 'INFLUENCER',
        isActive: true,
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      include: {
        ownerOfCampaign: true,
        ambassadors: { select: { id: true, isActive: true } },
        uses: { include: { commissions: true } },
        // FIX 2026-06-16 (review): paid/pending del influencer deben incluir
        // su 5% INDIRECTO (comisiones cuyo recipientCodeId = este influencer
        // pero el use pertenece al embajador). Antes solo sumábamos las de
        // sus clientes directos (c.uses) → sub-reportaba.
        receivedCommissions: {
          select: { id: true, status: true, amount: true, amountPaid: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return codes.map((c) => {
      const directUses = c.uses;
      const directActive = directUses.filter(
        (u) => u.status === 'PAYING' || u.status === 'ACTIVE',
      ).length;
      // Unión por id: directas (de c.uses — captura las legacy con
      // recipientCodeId=null) + indirectas/directas-con-recipient (de
      // receivedCommissions). Dedup por id para no doble-contar las directas
      // que aparecen en ambas.
      const byId = new Map<string, { status: string; amount: any; amountPaid: any }>();
      for (const u of directUses) for (const com of u.commissions) byId.set(com.id, com);
      for (const com of c.receivedCommissions) byId.set(com.id, com);
      const allComm = Array.from(byId.values());
      // FIX 2026-06-16 (#14/#37): definición canónica — paid = amountPaid
      // real; pending = (PENDING+APPROVED) con amount − amountPaid.
      const paid = allComm
        .filter((x) => x.status !== 'REJECTED')
        .reduce((s, x) => s + Number(x.amountPaid), 0);
      const pending = allComm
        .filter((x) => x.status === 'PENDING' || x.status === 'APPROVED')
        .reduce((s, x) => s + Math.max(0, Number(x.amount) - Number(x.amountPaid)), 0);
      return {
        id: c.id,
        code: c.code,
        ownerName: c.ownerName,
        ownerEmail: c.ownerEmail,
        ownerWhatsapp: c.ownerWhatsapp,
        commissionPercent: Number(c.commissionPercent),
        isActive: c.isActive,
        campaignName: c.ownerOfCampaign?.name ?? null,
        ambassadorsCount: c.ambassadors.filter((a) => a.isActive).length,
        directClients: directUses.length,
        directActiveClients: directActive,
        paidUsd: Math.round(paid * 100) / 100,
        pendingUsd: Math.round(pending * 100) / 100,
        createdAt: c.createdAt,
      };
    });
  }

  /**
   * Summary de visitas en /ref/<slug> (últimos N días). Agrega por slug
   * (matcheado o no a un ReferralCode) con conteos de visitas y unique
   * UAs aproximadas (proxy de "clicks únicos"). El conversion rate se
   * calcula contra ReferralUses cuyo viaSlug coincide.
   */
  async visitsSummary(user: AuthUser, days = 30) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const since = new Date(Date.now() - days * 86400_000);

    const [visits, uses] = await Promise.all([
      this.prisma.referralVisit.findMany({
        where: { createdAt: { gte: since } },
        include: {
          referralCode: { select: { code: true, ownerName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referralUse.findMany({
        where: { createdAt: { gte: since }, viaSlug: { not: null } },
        select: { viaSlug: true, status: true },
      }),
    ]);

    type Row = {
      slug: string;
      code: string | null;
      ownerName: string | null;
      visits: number;
      uniqueUAs: number;
      signups: number;
      conversions: number;
    };
    const map = new Map<string, Row & { uaSet: Set<string> }>();
    for (const v of visits) {
      const row =
        map.get(v.slug) ??
        ({
          slug: v.slug,
          code: v.referralCode?.code ?? null,
          ownerName: v.referralCode?.ownerName ?? null,
          visits: 0,
          uniqueUAs: 0,
          signups: 0,
          conversions: 0,
          uaSet: new Set<string>(),
        } satisfies Row & { uaSet: Set<string> });
      row.visits += 1;
      if (v.userAgent) row.uaSet.add(v.userAgent.slice(0, 100));
      map.set(v.slug, row);
    }
    for (const u of uses) {
      if (!u.viaSlug) continue;
      const row = map.get(u.viaSlug);
      if (!row) continue;
      row.signups += 1;
      if (u.status === 'PAYING' || u.status === 'ACTIVE') row.conversions += 1;
    }
    const rows = Array.from(map.values())
      .map(({ uaSet, ...rest }) => ({ ...rest, uniqueUAs: uaSet.size }))
      .sort((a, b) => b.visits - a.visits);

    return {
      days,
      totals: {
        visits: rows.reduce((s, r) => s + r.visits, 0),
        signups: rows.reduce((s, r) => s + r.signups, 0),
        conversions: rows.reduce((s, r) => s + r.conversions, 0),
      },
      rows,
    };
  }

  async listAmbassadors(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const codes = await this.prisma.referralCode.findMany({
      // #7 (2026-06-16): no listar embajadores eliminados (isActive=false).
      // Aislamiento por marca: cada Master Admin ve solo los suyos.
      where: {
        role: 'AMBASSADOR',
        isActive: true,
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      include: {
        parentCode: { select: { code: true, ownerName: true } },
        campaign: { select: { name: true } },
        uses: { include: { commissions: true } },
        // FASE B1: counters de vendedores activos por embajador, para
        // la columna "Vendedores" del tab AmbassadorsTab.
        childVendors: { select: { id: true, isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return codes.map((c) => {
      const allComm = c.uses.flatMap((u) => u.commissions);
      // FIX 2026-06-16 (#14/#37): definición canónica — paid = amountPaid
      // real; pending = (PENDING+APPROVED) con amount − amountPaid.
      const paid = allComm
        .filter((x) => x.status !== 'REJECTED')
        .reduce((s, x) => s + Number(x.amountPaid), 0);
      const pending = allComm
        .filter((x) => x.status === 'PENDING' || x.status === 'APPROVED')
        .reduce((s, x) => s + Math.max(0, Number(x.amount) - Number(x.amountPaid)), 0);
      // Si AMBASSADOR no tiene parentCode (parentCodeId=null) → es un
      // "Embajador Directo Empresa" — reporta a la empresa, no a un
      // influencer. Mismo % de comisión que un embajador normal pero el
      // 5% indirecto no va a nadie (queda en la empresa).
      const isCompanyDirect = c.parentCodeId == null;
      const activeVendorsCount = c.childVendors.filter((v) => v.isActive).length;
      return {
        id: c.id,
        code: c.code,
        slug: c.slug ?? c.code.toLowerCase(),
        ownerName: c.ownerName,
        ownerEmail: c.ownerEmail,
        ownerWhatsapp: c.ownerWhatsapp,
        commissionPercent: Number(c.commissionPercent),
        isActive: c.isActive,
        approvedAt: c.approvedAt,
        parentCode: c.parentCode?.code ?? null,
        parentName: c.parentCode?.ownerName ?? null,
        campaignName: c.campaign?.name ?? null,
        isCompanyDirect,
        clients: c.uses.length,
        activeClients: c.uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length,
        paidUsd: Math.round(paid * 100) / 100,
        pendingUsd: Math.round(pending * 100) / 100,
        createdAt: c.createdAt,
        // FASE B1 — vendor module flags
        allowVendors: Boolean(c.allowVendors),
        maxCommissionPercent: c.maxCommissionPercent
          ? Number(c.maxCommissionPercent)
          : 25,
        vendorsCount: c.childVendors.length,
        activeVendorsCount,
      };
    });
  }

  /**
   * #12 (2026-06-16): admin modifica/resetea la contraseña de un afiliado
   * (influencer / embajador / vendedor / socio) ya existente. Devuelve las
   * credenciales para compartir. Delega en auth (fuente única del hashing).
   */
  async setAffiliatePassword(
    user: AuthUser,
    codeId: string,
    newPassword: string,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.auth.setAffiliatePasswordByCode(codeId, newPassword);
  }

  /**
   * #3 (2026-06-16): lista de VENDEDORES activos para el selector de
   * "Asignación a Embajador / Influencer". Un vendedor cuelga de un embajador
   * (o influencer) vía parentEmbajadorCodeId; lo incluimos como contexto para
   * que el admin sepa de quién depende cada vendedor.
   */
  async listVendors(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const codes = await this.prisma.referralCode.findMany({
      // Aislamiento por marca: cada Master Admin ve solo los suyos.
      where: {
        role: 'VENDOR',
        isActive: true,
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      include: {
        parentEmbajadorCode: { select: { code: true, ownerName: true, role: true } },
        campaign: { select: { name: true } },
        uses: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      slug: c.slug ?? c.code.toLowerCase(),
      ownerName: c.ownerName,
      ownerEmail: c.ownerEmail,
      ownerWhatsapp: c.ownerWhatsapp,
      commissionPercent: Number(c.commissionPercent),
      isActive: c.isActive,
      // De quién depende el vendedor (embajador o influencer padre).
      parentCode: c.parentEmbajadorCode?.code ?? null,
      parentName: c.parentEmbajadorCode?.ownerName ?? null,
      parentRole: c.parentEmbajadorCode?.role ?? null,
      campaignName: c.campaign?.name ?? null,
      clients: c.uses.length,
      activeClients: c.uses.filter(
        (u) => u.status === 'PAYING' || u.status === 'ACTIVE',
      ).length,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Crea o invita un "Embajador Directo Empresa" — un AMBASSADOR sin
   * influencer parent (parentCodeId=null, campaignId=null). Gana
   * comisión sobre sus propios referidos (igual que un embajador normal),
   * pero el 5% indirecto no va a nadie porque no tiene parent — queda
   * en la empresa.
   *
   * Diferencia con SOCIO: el SOCIO gana 10% sobre TODA venta del sistema
   * sin importar qué código se use. El Embajador Directo Empresa solo
   * gana sobre los clientes que él mismo refirió.
   */
  async createCompanyDirectAmbassador(
    user: AuthUser,
    dto: {
      fullName: string;
      email: string;
      whatsapp: string;
      commissionPercent?: number;
      customCode?: string;
      // #37 (2026-06-16): password directo opcional (ver createInfluencer).
      password?: string;
      country?: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!dto.fullName?.trim() || !dto.email?.trim() || !dto.whatsapp?.trim()) {
      throw new BadRequestException('fullName, email y whatsapp son requeridos');
    }
    const presetPassword = dto.password?.trim() || undefined;
    if (presetPassword && presetPassword.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const email = dto.email.trim().toLowerCase();

    // Email único global: no permite ningún ReferralCode (cualquier role)
    // ni User AFFILIATE_* con el mismo email.
    await this.assertUniqueAffiliateEmail(email);

    // Generar código único + slug a partir del nombre
    let code = dto.customCode?.trim().toUpperCase();
    if (code) {
      if (!/^[A-Z0-9]{4,16}$/.test(code)) {
        throw new BadRequestException(
          'customCode debe tener 4-16 caracteres A-Z 0-9',
        );
      }
      const codeDup = await this.prisma.referralCode.findUnique({
        where: { code },
      });
      if (codeDup) throw new BadRequestException(`Código "${code}" ya está en uso`);
    } else {
      code = codeGen();
      while (await this.prisma.referralCode.findUnique({ where: { code } })) {
        code = codeGen();
      }
    }

    const slug = await this.allocateSlug(dto.fullName, code);
    const created = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName.trim(),
        ownerEmail: email,
        ownerWhatsapp: dto.whatsapp.trim(),
        country: dto.country?.trim() || null,
        commissionPercent: dto.commissionPercent ?? COMMISSION_DEFAULTS.ambassadorPct,
        role: 'AMBASSADOR',
        whiteLabelId: await this.resolveAffiliateWhiteLabelId({ user }),
        parentCodeId: null,
        campaignId: null,
        approvedAt: new Date(), // pre-aprobado (no requiere flow de approval)
        source: 'company_direct',
      },
    });

    // Invitar al embajador con su panel propio (mismo flujo que un embajador
    // normal, pero scoped a sus propios datos sin parent influencer).
    const invite = await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName.trim(),
        role: 'AFFILIATE_AMBASSADOR',
        referralCodeId: created.id,
        phone: dto.whatsapp.trim(),
        presetPassword,
      })
      .catch((err) => {
        this.logger.warn(
          `inviteAffiliate falló para ${email}: ${(err as Error).message}`,
        );
        return null;
      });

    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    const credentials = invite?.password
      ? { email, password: invite.password, loginUrl: '/login' }
      : null;
    return {
      ...created,
      shareLink: `${appUrl}/ref/${slug}`,
      isCompanyDirect: true,
      credentials,
    };
  }

  /**
   * #36 (2026-06-16): crear un INFLUENCER directamente desde la empresa.
   * Antes los influencers se creaban como titulares de una Campaña; ahora
   * que se eliminó esa sección (#10), el super admin los crea directo acá.
   * Mismo patrón que createCompanyDirectAmbassador pero role=INFLUENCER y
   * usuario AFFILIATE_INFLUENCER. Sin campaña.
   */
  async createInfluencer(
    user: AuthUser,
    dto: {
      fullName: string;
      email: string;
      whatsapp: string;
      commissionPercent?: number;
      customCode?: string;
      // #37 (2026-06-16): el admin puede fijar la contraseña al crear, así
      // el influencer entra de inmediato sin esperar el email de invitación.
      // Si viene vacía, se cae al flow tradicional (email de reset).
      password?: string;
      country?: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!dto.fullName?.trim() || !dto.email?.trim() || !dto.whatsapp?.trim()) {
      throw new BadRequestException('fullName, email y whatsapp son requeridos');
    }
    const presetPassword = dto.password?.trim() || undefined;
    if (presetPassword && presetPassword.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const email = dto.email.trim().toLowerCase();
    await this.assertUniqueAffiliateEmail(email);

    let code = dto.customCode?.trim().toUpperCase();
    if (code) {
      if (!/^[A-Z0-9]{4,16}$/.test(code)) {
        throw new BadRequestException(
          'customCode debe tener 4-16 caracteres A-Z 0-9',
        );
      }
      const codeDup = await this.prisma.referralCode.findUnique({
        where: { code },
      });
      if (codeDup) throw new BadRequestException(`Código "${code}" ya está en uso`);
    } else {
      code = codeGen();
      while (await this.prisma.referralCode.findUnique({ where: { code } })) {
        code = codeGen();
      }
    }

    const slug = await this.allocateSlug(dto.fullName, code);
    const created = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName.trim(),
        ownerEmail: email,
        ownerWhatsapp: dto.whatsapp.trim(),
        country: dto.country?.trim() || null,
        commissionPercent: dto.commissionPercent ?? COMMISSION_DEFAULTS.influencerPct,
        role: 'INFLUENCER',
        whiteLabelId: await this.resolveAffiliateWhiteLabelId({ user }),
        parentCodeId: null,
        campaignId: null,
        approvedAt: new Date(),
        source: 'company_direct',
      },
    });

    const invite = await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName.trim(),
        role: 'AFFILIATE_INFLUENCER',
        referralCodeId: created.id,
        phone: dto.whatsapp.trim(),
        presetPassword,
      })
      .catch((err) => {
        this.logger.warn(
          `inviteAffiliate (influencer) falló para ${email}: ${(err as Error).message}`,
        );
        return null;
      });

    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    // Si el admin fijó password, devolvemos las credenciales para que las
    // copie/comparta una sola vez (no se guardan en plain text).
    const credentials = invite?.password
      ? { email, password: invite.password, loginUrl: '/login' }
      : null;
    return { ...created, shareLink: `${appUrl}/ref/${slug}`, credentials };
  }

  async listClients(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const uses = await this.prisma.referralUse.findMany({
      // Aislamiento por marca: clientes de los negocios de la marca activa.
      where: {
        tenantId: { not: null },
        ...(user.whiteLabelId
          ? { tenant: { whiteLabelId: user.whiteLabelId } }
          : {}),
      },
      include: {
        tenant: {
          select: {
            brandName: true,
            status: true,
            currentPeriodEnd: true,
            plan: { select: { name: true } },
          },
        },
        referralCode: {
          select: { code: true, ownerName: true, role: true, parentCode: { select: { code: true, ownerName: true } } },
        },
        commissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return uses
      .filter((u) => u.referralCode.role !== 'SOCIO')
      .map((u) => ({
        id: u.id,
        tenantBrand: u.tenant?.brandName ?? '—',
        tenantStatus: u.tenant?.status ?? '—',
        plan: u.tenant?.plan?.name ?? '—',
        currentPeriodEnd: u.tenant?.currentPeriodEnd ?? null,
        attribution: {
          role: u.referralCode.role,
          code: u.referralCode.code,
          ownerName: u.referralCode.ownerName,
          parentCode: u.referralCode.parentCode?.code ?? null,
          parentName: u.referralCode.parentCode?.ownerName ?? null,
        },
        status: u.status,
        signedUpAt: u.createdAt,
        convertedAt: u.convertedAt,
        commissionsCount: u.commissions.length,
        commissionsTotalUsd:
          Math.round(
            u.commissions.reduce((s, c) => s + Number(c.amount), 0) * 100,
          ) / 100,
      }));
  }

  /**
   * GET configuración del módulo. Lee los Setting keys
   * `referrals.*` y los devuelve con defaults.
   */
  async getConfig(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const keys = [
      'referrals.socioCodeId',
      'referrals.indirectPercent',
      'referrals.defaultInfluencerPercent',
      'referrals.defaultAmbassadorPercent',
      'referrals.holdDays',
      'referrals.minPayoutUsd',
      'referrals.notifyPaymentFailed',
      'referrals.notifyChurn',
      'referrals.allowInfluencerCreatesAmbassadors',
      'referrals.requireAmbassadorApproval',
      'referrals.notifyChannel',
    ];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const socioId = map.get('referrals.socioCodeId') ?? '';
    const socio = socioId
      ? await this.prisma.referralCode.findUnique({
          where: { id: socioId },
          select: { id: true, code: true, ownerName: true, commissionPercent: true, role: true },
        })
      : null;
    return {
      socioCodeId: socioId,
      socio,
      indirectPercent: Number(
        map.get('referrals.indirectPercent') ?? COMMISSION_DEFAULTS.indirectPct,
      ),
      defaultInfluencerPercent: Number(
        map.get('referrals.defaultInfluencerPercent') ?? COMMISSION_DEFAULTS.influencerPct,
      ),
      defaultAmbassadorPercent: Number(
        map.get('referrals.defaultAmbassadorPercent') ?? COMMISSION_DEFAULTS.ambassadorPct,
      ),
      holdDays: Number(map.get('referrals.holdDays') ?? COMMISSION_HOLD_DAYS),
      minPayoutUsd: Number(map.get('referrals.minPayoutUsd') ?? 0),
      notifyPaymentFailed: map.get('referrals.notifyPaymentFailed') !== 'false',
      notifyChurn: map.get('referrals.notifyChurn') !== 'false',
      allowInfluencerCreatesAmbassadors:
        map.get('referrals.allowInfluencerCreatesAmbassadors') === 'true',
      requireAmbassadorApproval:
        map.get('referrals.requireAmbassadorApproval') === 'true',
      notifyChannel: (map.get('referrals.notifyChannel') ?? 'SMS') as 'SMS' | 'EMAIL' | 'BOTH',
    };
  }

  async setConfig(
    user: AuthUser,
    patch: Partial<{
      socioCodeId: string | null;
      indirectPercent: number;
      defaultInfluencerPercent: number;
      defaultAmbassadorPercent: number;
      holdDays: number;
      minPayoutUsd: number;
      notifyPaymentFailed: boolean;
      notifyChurn: boolean;
      allowInfluencerCreatesAmbassadors: boolean;
      requireAmbassadorApproval: boolean;
      notifyChannel: 'SMS' | 'EMAIL' | 'BOTH';
    }>,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const upserts: Array<Promise<any>> = [];
    const writeKey = (key: string, value: string | null) => {
      if (value === null) {
        upserts.push(this.prisma.setting.delete({ where: { key } }).catch(() => null));
      } else {
        upserts.push(
          this.prisma.setting.upsert({
            where: { key },
            create: { key, value },
            update: { value },
          }),
        );
      }
    };
    if ('socioCodeId' in patch) writeKey('referrals.socioCodeId', patch.socioCodeId ?? null);
    if ('indirectPercent' in patch)
      writeKey('referrals.indirectPercent', String(patch.indirectPercent ?? COMMISSION_DEFAULTS.indirectPct));
    if ('defaultInfluencerPercent' in patch)
      writeKey('referrals.defaultInfluencerPercent', String(patch.defaultInfluencerPercent ?? COMMISSION_DEFAULTS.influencerPct));
    if ('defaultAmbassadorPercent' in patch)
      writeKey('referrals.defaultAmbassadorPercent', String(patch.defaultAmbassadorPercent ?? COMMISSION_DEFAULTS.ambassadorPct));
    if ('holdDays' in patch) writeKey('referrals.holdDays', String(patch.holdDays ?? COMMISSION_HOLD_DAYS));
    if ('minPayoutUsd' in patch)
      writeKey('referrals.minPayoutUsd', String(patch.minPayoutUsd ?? 0));
    if ('notifyPaymentFailed' in patch)
      writeKey('referrals.notifyPaymentFailed', patch.notifyPaymentFailed ? 'true' : 'false');
    if ('notifyChurn' in patch)
      writeKey('referrals.notifyChurn', patch.notifyChurn ? 'true' : 'false');
    if ('allowInfluencerCreatesAmbassadors' in patch)
      writeKey(
        'referrals.allowInfluencerCreatesAmbassadors',
        patch.allowInfluencerCreatesAmbassadors ? 'true' : 'false',
      );
    if ('requireAmbassadorApproval' in patch)
      writeKey(
        'referrals.requireAmbassadorApproval',
        patch.requireAmbassadorApproval ? 'true' : 'false',
      );
    if ('notifyChannel' in patch)
      writeKey('referrals.notifyChannel', patch.notifyChannel ?? 'SMS');
    await Promise.all(upserts);
    return this.getConfig(user);
  }

  /**
   * Crea o reutiliza el código del Socio (role=SOCIO, 10% global) y le
   * envía la invitación al panel de afiliado. Si ya existe un código
   * SOCIO con ese email, se reutiliza y solo se reenvía el invite.
   */
  async createOrInviteSocio(
    user: AuthUser,
    dto: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const email = dto.email.trim().toLowerCase();
    let code = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'SOCIO' },
    });
    if (!code) {
      // Si NO hay un SOCIO con ese email, validar email único global
      // antes de crear uno nuevo. Si ya existe como INFLUENCER/AMBASSADOR
      // o User AFFILIATE_*, lanza 409.
      await this.assertUniqueAffiliateEmail(email);
      const codeText =
        dto.customCode?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') ||
        codeGen();
      code = await this.prisma.referralCode.create({
        data: {
          code: codeText,
          slug: codeText.toLowerCase(),
          ownerName: dto.fullName,
          ownerEmail: email,
          ownerWhatsapp: dto.whatsapp,
          commissionPercent: dto.commissionPercent ?? COMMISSION_DEFAULTS.socioPct,
          role: 'SOCIO',
          whiteLabelId: await this.resolveAffiliateWhiteLabelId({ user }),
          approvedAt: new Date(),
        },
      });
    }
    // Setear como socio global activo.
    await this.prisma.setting.upsert({
      where: { key: 'referrals.socioCodeId' },
      create: { key: 'referrals.socioCodeId', value: code.id },
      update: { value: code.id },
    });
    // Invitar
    await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName,
        role: 'AFFILIATE_SOCIO',
        referralCodeId: code.id,
        phone: dto.whatsapp,
      })
      .catch(() => null);
    return code;
  }

  /**
   * Lista embajadores pendientes de aprobación (creados por un influencer
   * con `referrals.requireAmbassadorApproval` = true).
   */
  async listPendingAmbassadors(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.referralCode.findMany({
      // Aislamiento por marca: solo pendientes de la marca activa.
      where: {
        role: 'AMBASSADOR',
        approvedAt: null,
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      include: {
        parentCode: { select: { code: true, ownerName: true } },
        campaign: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveAmbassador(user: AuthUser, id: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.referralCode.update({
      where: { id },
      data: { approvedAt: new Date() },
    });
  }

  async rejectAmbassador(user: AuthUser, id: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    // Soft-delete: desactivamos para preservar historial.
    return this.prisma.referralCode.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Promueve un embajador a influencer. Solo SUPER_ADMIN. Preserva
   * historial, referidos y comisiones — solo cambia el rol del code +
   * el rol del User vinculado (si existe), y desvincula el parentCode
   * (un influencer no tiene parent — es independiente).
   *
   * Caso de uso: al crear una campaña, el admin elige convertir a un
   * embajador existente en influencer en vez de crear uno desde cero
   * (mantiene los referidos que ya trajo + le da el panel de influencer
   * con permiso para crear embajadores debajo suyo).
   *
   * Idempotente: si ya es influencer, devuelve OK sin tocar nada.
   */
  async promoteAmbassadorToInfluencer(user: AuthUser, codeId: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { id: true, role: true, ownerUserId: true, ownerName: true },
    });
    if (!code) throw new NotFoundException('Afiliado no encontrado');
    if (code.role === 'INFLUENCER') {
      return { ok: true, alreadyInfluencer: true, code };
    }
    // Se puede promover un EMBAJADOR o un VENDEDOR a INFLUENCER de la empresa
    // (influencer titular: panel completo, puede crear sus propios embajadores).
    // 2026-06-15: antes solo AMBASSADOR — ahora también VENDOR (a pedido).
    if (code.role !== 'AMBASSADOR' && code.role !== 'VENDOR') {
      throw new BadRequestException(
        `Solo se pueden promover códigos EMBAJADOR o VENDEDOR (este es ${code.role})`,
      );
    }
    // Transacción: cambiar role del code + desvincular de TODO padre
    // (parentCode del influencer y parentEmbajador del vendedor) + actualizar
    // role del User. Queda como INFLUENCER independiente (de la empresa).
    const updated = await this.prisma.$transaction(async (tx) => {
      const newCode = await tx.referralCode.update({
        where: { id: codeId },
        data: {
          role: 'INFLUENCER',
          parentCodeId: null,
          parentEmbajadorCodeId: null,
        },
      });
      if (code.ownerUserId) {
        await tx.user.update({
          where: { id: code.ownerUserId },
          data: { role: 'AFFILIATE_INFLUENCER' },
        });
      }
      return newCode;
    });
    this.logger.log(
      `${code.role} promoted to INFLUENCER: codeId=${codeId} ownerName="${code.ownerName}" by ${user.email}`,
    );
    return { ok: true, alreadyInfluencer: false, code: updated };
  }

  /**
   * Demote: convierte un INFLUENCER en AMBASSADOR colgándolo de otro
   * INFLUENCER. Preserva los ReferralUse (clientes) del code — siguen
   * apuntando al mismo referralCodeId. Lo que cambia: role del code,
   * parentCodeId, campaignId (al de la campaña del nuevo parent si la
   * tiene) y rol del User vinculado.
   *
   * Validaciones:
   *   - code existe y es INFLUENCER.
   *   - newParentId existe, es INFLUENCER y ≠ codeId.
   *   - code no tiene embajadores hijos activos (sino quedarían colgando
   *     de un AMBASSADOR — modelo inválido).
   *   - code no es titular de Campaign activa (sino quedaría huérfana).
   *
   * Comisiones futuras: el siguiente pago de cada cliente va a generar
   * la indirecta 5% al newParent (antes no había indirecta porque era
   * INFLUENCER independiente).
   */
  async demoteInfluencerToAmbassador(
    user: AuthUser,
    codeId: string,
    newParentId: string,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!newParentId) throw new BadRequestException('newParentId requerido');
    if (codeId === newParentId) {
      throw new BadRequestException('codeId y newParentId no pueden ser iguales');
    }

    const [code, parent] = await Promise.all([
      this.prisma.referralCode.findUnique({
        where: { id: codeId },
        select: {
          id: true,
          role: true,
          ownerUserId: true,
          ownerName: true,
          ownerOfCampaign: { select: { id: true, name: true, status: true } },
        },
      }),
      this.prisma.referralCode.findUnique({
        where: { id: newParentId },
        select: {
          id: true,
          role: true,
          ownerName: true,
          campaignId: true,
          ownerOfCampaign: { select: { id: true } },
        },
      }),
    ]);
    if (!code) throw new NotFoundException('Code a demote no encontrado');
    if (!parent) throw new NotFoundException('Influencer parent no encontrado');
    if (code.role !== 'INFLUENCER') {
      throw new BadRequestException(
        `Solo se puede demote desde INFLUENCER (este es ${code.role})`,
      );
    }
    if (parent.role !== 'INFLUENCER') {
      throw new BadRequestException(
        `newParent debe ser INFLUENCER (este es ${parent.role})`,
      );
    }
    if (code.ownerOfCampaign && code.ownerOfCampaign.status !== 'FINISHED') {
      throw new BadRequestException(
        `Este influencer es titular de la campaña "${code.ownerOfCampaign.name}" (${code.ownerOfCampaign.status}). ` +
          `Finalizá o transferí la campaña antes de demote.`,
      );
    }
    const childAmbassadors = await this.prisma.referralCode.count({
      where: { parentCodeId: codeId, isActive: true },
    });
    if (childAmbassadors > 0) {
      throw new BadRequestException(
        `Este influencer tiene ${childAmbassadors} embajadores hijos activos. ` +
          `Reasignalos a otro influencer antes de demote.`,
      );
    }

    const targetCampaignId =
      parent.campaignId ?? parent.ownerOfCampaign?.id ?? null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const newCode = await tx.referralCode.update({
        where: { id: codeId },
        data: {
          role: 'AMBASSADOR',
          parentCodeId: newParentId,
          campaignId: targetCampaignId,
        },
      });
      if (code.ownerUserId) {
        await tx.user.update({
          where: { id: code.ownerUserId },
          data: { role: 'AFFILIATE_AMBASSADOR' },
        });
      }
      return newCode;
    });

    this.logger.log(
      `Influencer demoted to AMBASSADOR: codeId=${codeId} ownerName="${code.ownerName}" ` +
        `newParent=${newParentId} (${parent.ownerName}) by ${user.email}`,
    );
    return { ok: true, code: updated };
  }

  /**
   * Reassign: cambia el parentCodeId de un AMBASSADOR a otro INFLUENCER.
   * Preserva los clientes (ReferralUse). Las futuras comisiones indirectas
   * van al nuevo parent. Las históricas (en uses separados del antiguo
   * parent) quedan como están — son pasado consolidado.
   */
  /**
   * Reasignación de un CLIENTE (ReferralUse) a otro código de afiliado.
   * Bloque 4 (2026-06-12). El SUPER_ADMIN puede:
   *   - Mover un ReferralUse de un embajador/influencer a otro.
   *   - Opcionalmente borrar las comisiones futuras PENDING/APPROVED
   *     del afiliado anterior (deleteFuturePending). PAID intacta.
   *   - Las próximas comisiones que se generen lo harán con el nuevo
   *     referralCodeId (cron de reconciliación o webhook Hotmart).
   *
   * Atómica via $transaction. Loggea a AuditLog con metadata completa
   * para trazabilidad regulatoria.
   */
  async reassignReferralUseToCode(
    user: AuthUser,
    referralUseId: string,
    opts: {
      newReferralCodeId: string;
      deleteFuturePending: boolean;
      reason?: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!opts.newReferralCodeId) {
      throw new BadRequestException('newReferralCodeId requerido');
    }

    const use = await this.prisma.referralUse.findUnique({
      where: { id: referralUseId },
      select: {
        id: true,
        referralCodeId: true,
        tenantId: true,
        status: true,
        tenant: { select: { brandName: true } },
        referralCode: {
          select: { code: true, ownerName: true, role: true },
        },
      },
    });
    if (!use) throw new NotFoundException('ReferralUse no encontrado');

    const newCode = await this.prisma.referralCode.findUnique({
      where: { id: opts.newReferralCodeId },
      select: { id: true, code: true, ownerName: true, role: true },
    });
    if (!newCode) {
      throw new NotFoundException('Código destino no encontrado');
    }
    if (use.referralCodeId === opts.newReferralCodeId) {
      return { ok: true, alreadyAssigned: true };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Reasignar el ReferralUse al nuevo código.
      await tx.referralUse.update({
        where: { id: referralUseId },
        data: { referralCodeId: opts.newReferralCodeId },
      });

      let deletedCount = 0;
      if (opts.deleteFuturePending) {
        // Borrar comisiones PENDING/APPROVED del use. PAID se mantiene
        // (histórico cerrado — no se toca). Las próximas comisiones
        // que genere el cron / webhook Hotmart usarán el nuevo
        // referralCodeId vía el path normal de generation.
        const del = await tx.commission.deleteMany({
          where: {
            referralUseId,
            status: { in: ['PENDING', 'APPROVED'] },
            paidAt: null,
          },
        });
        deletedCount = del.count;
      }

      return { deletedCount };
    });

    this.audit.log({
      actorId: user.id,
      tenantId: use.tenantId,
      action: 'referral_use.reassigned',
      resource: `referral_use:${referralUseId}`,
      metadata: {
        tenantBrandName: use.tenant?.brandName ?? null,
        fromCodeId: use.referralCodeId,
        fromCode: use.referralCode?.code ?? null,
        fromOwner: use.referralCode?.ownerName ?? null,
        fromRole: use.referralCode?.role ?? null,
        toCodeId: opts.newReferralCodeId,
        toCode: newCode.code,
        toOwner: newCode.ownerName,
        toRole: newCode.role,
        deletedFutureCommissions: result.deletedCount,
        deletedFuturePending: opts.deleteFuturePending,
        reason: opts.reason?.trim() || null,
      },
    });

    this.logger.log(
      `ReferralUse reassigned: use=${referralUseId} tenant=${use.tenantId} ` +
        `from=${use.referralCode?.code ?? '—'} to=${newCode.code} ` +
        `deletedFuture=${result.deletedCount} by ${user.email}`,
    );

    return {
      ok: true,
      from: use.referralCode,
      to: newCode,
      deletedFutureCommissions: result.deletedCount,
    };
  }

  async reassignAmbassadorParent(
    user: AuthUser,
    codeId: string,
    newParentId: string,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!newParentId) throw new BadRequestException('newParentId requerido');
    if (codeId === newParentId) {
      throw new BadRequestException('codeId y newParentId no pueden ser iguales');
    }

    const [code, parent] = await Promise.all([
      this.prisma.referralCode.findUnique({
        where: { id: codeId },
        select: { id: true, role: true, ownerName: true, parentCodeId: true },
      }),
      this.prisma.referralCode.findUnique({
        where: { id: newParentId },
        select: {
          id: true,
          role: true,
          ownerName: true,
          campaignId: true,
          ownerOfCampaign: { select: { id: true } },
        },
      }),
    ]);
    if (!code) throw new NotFoundException('Embajador no encontrado');
    if (!parent) throw new NotFoundException('Influencer parent no encontrado');
    if (code.role !== 'AMBASSADOR') {
      throw new BadRequestException(
        `Solo se puede reasignar parent de AMBASSADOR (este es ${code.role})`,
      );
    }
    if (parent.role !== 'INFLUENCER') {
      throw new BadRequestException(
        `newParent debe ser INFLUENCER (este es ${parent.role})`,
      );
    }
    if (code.parentCodeId === newParentId) {
      return { ok: true, alreadyAssigned: true };
    }

    const targetCampaignId =
      parent.campaignId ?? parent.ownerOfCampaign?.id ?? null;

    const updated = await this.prisma.referralCode.update({
      where: { id: codeId },
      data: {
        parentCodeId: newParentId,
        campaignId: targetCampaignId,
      },
    });

    this.logger.log(
      `Ambassador reassigned: codeId=${codeId} ownerName="${code.ownerName}" ` +
        `oldParent=${code.parentCodeId} newParent=${newParentId} (${parent.ownerName}) by ${user.email}`,
    );
    return { ok: true, code: updated };
  }

  /**
   * Payouts: comisiones con regla de 30 días de hold.
   * - Si una comisión PENDING ya cumplió 30 días desde createdAt, se
   *   auto-promueve a APPROVED ("disponible para pagar") antes de devolver.
   * - Filtros: status, dateFrom/dateTo (sobre createdAt), q (busca por
   *   nombre/email del owner o brand del tenant).
   * - Devuelve los items más totales agregados.
   */
  async payouts(
    user: AuthUser,
    opts: {
      status?: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'AVAILABLE_OR_PENDING';
      dateFrom?: string;
      dateTo?: string;
      q?: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const HOLD_DAYS = COMMISSION_HOLD_DAYS;
    const now = new Date();
    const cutoff = new Date(now.getTime() - HOLD_DAYS * 86400000);

    // Auto-promover PENDING → APPROVED cuando cumplió el hold. P3 2026-07-02:
    // por availableAt (pago Hotmart + 15d); fallback legacy a createdAt + 15d.
    await this.prisma.commission.updateMany({
      where: {
        status: 'PENDING',
        OR: [
          { availableAt: { lte: now } },
          { availableAt: null, createdAt: { lte: cutoff } },
        ],
      },
      data: { status: 'APPROVED' },
    });

    // Aislamiento por marca: comisiones de los negocios de la marca activa.
    const commWhere = user.whiteLabelId
      ? { referralUse: { tenant: { whiteLabelId: user.whiteLabelId } } }
      : {};
    const where: any = { ...commWhere };
    if (opts.status === 'AVAILABLE_OR_PENDING') {
      where.status = { in: ['PENDING', 'APPROVED'] };
    } else if (opts.status) {
      where.status = opts.status;
    }
    if (opts.dateFrom || opts.dateTo) {
      where.createdAt = {};
      if (opts.dateFrom) where.createdAt.gte = new Date(opts.dateFrom);
      if (opts.dateTo) where.createdAt.lte = new Date(opts.dateTo);
    }

    const all = await this.prisma.commission.findMany({
      where,
      include: {
        referralUse: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            referralCode: {
              select: { ownerName: true, ownerEmail: true, ownerWhatsapp: true, code: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filtro por texto en server (sobre los joins)
    const term = opts.q?.trim().toLowerCase();
    const filtered = term
      ? all.filter((c) => {
          const r = c.referralUse?.referralCode;
          const t = c.referralUse?.tenant;
          const hay = `${r?.ownerName ?? ''} ${r?.ownerEmail ?? ''} ${r?.code ?? ''} ${t?.brandName ?? ''}`.toLowerCase();
          return hay.includes(term);
        })
      : all;

    const items = filtered.map((c) => {
      const r = c.referralUse?.referralCode;
      const t = c.referralUse?.tenant;
      const availableAt = effectiveAvailableAt(c);
      return {
        id: c.id,
        amount: Number(c.amount),
        currency: c.currency,
        status: c.status,
        createdAt: c.createdAt,
        availableAt,
        paidAt: c.paidAt,
        ownerName: r?.ownerName ?? '—',
        ownerEmail: r?.ownerEmail ?? '',
        ownerWhatsapp: r?.ownerWhatsapp ?? '',
        codeText: r?.code ?? '',
        tenantBrand: t?.brandName ?? '—',
        notes: c.notes,
        clientContactedAt: c.clientContactedAt,
      };
    });

    // Agregados sobre TODA la base (no filtrada) para que los KPIs no
    // dependan del filtro actual del UI. groupBy en SQL — antes
    // cargabamos TODA la tabla a memoria para sumar 3 estados.
    const totalsByStatus = await this.prisma.commission.groupBy({
      by: ['status'],
      where: commWhere,
      _sum: { amount: true, amountPaid: true },
    });
    const round = (n: number) => Math.round(n * 100) / 100;
    // FIX 2026-06-16 (#14/#37): definición canónica — available/pending =
    // outstanding (amount − amountPaid) del estado; paid = amountPaid real
    // de todo lo no rechazado (cubre pagos parciales).
    const outstandingByStatus = (s: string) => {
      const row = totalsByStatus.find((r) => r.status === s);
      return Math.max(0, Number(row?._sum.amount ?? 0) - Number(row?._sum.amountPaid ?? 0));
    };
    const availableUsd = outstandingByStatus('APPROVED');
    const pendingUsd = outstandingByStatus('PENDING');
    const paidUsd = totalsByStatus
      .filter((r) => r.status !== 'REJECTED')
      .reduce((s, r) => s + Number(r._sum.amountPaid ?? 0), 0);

    return {
      items,
      totals: {
        availableUsd: round(availableUsd),
        pendingUsd: round(pendingUsd),
        paidUsd: round(paidUsd),
        count: items.length,
      },
      holdDays: HOLD_DAYS,
    };
  }

  /**
   * Devuelve la asignación referral actual de un tenant.
   * Retornamos el ReferralUse más reciente vinculado a un INFLUENCER/
   * AMBASSADOR. Los de role SOCIO son atribuciones globales internas,
   * no la asignación "del dueño del negocio".
   */
  async getTenantAssignment(tenantId: string) {
    const use = await this.prisma.referralUse.findFirst({
      where: {
        tenantId,
        // #3 (2026-06-16): VENDOR también es una asignación "del dueño del
        // negocio" (vendedor directo). SOCIO sigue excluido (atribución global).
        referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] } },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        referralCode: {
          select: {
            id: true,
            code: true,
            ownerName: true,
            ownerEmail: true,
            role: true,
            campaignId: true,
            campaign: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!use) return { assignment: null };
    return {
      assignment: {
        referralUseId: use.id,
        code: use.referralCode,
        status: use.status,
        createdAt: use.createdAt,
      },
    };
  }

  /**
   * Asigna un tenant a un ReferralCode. Si `codeId` es null, desasigna.
   * Si ya hay una asignación, la borramos primero (1:1).
   * No-op si ya está asignado a ese mismo code.
   * Las Commissions históricas viven aparte — no las tocamos.
   */
  async setTenantAssignment(tenantId: string, codeId: string | null) {
    // FIX 2026-06-15: antes tomaba solo la asignación MÁS RECIENTE (findFirst)
    // y borraba esa. Si quedaban varias atribuciones colgadas (ej por
    // parent-uses viejos o reasignaciones previas), las demás sobrevivían →
    // "aparece asignado a ambos y no se actualiza". Ahora limpiamos TODAS las
    // atribuciones directas que no sean el código objetivo.
    const existingAll = await this.prisma.referralUse.findMany({
      where: {
        tenantId,
        // #3 (2026-06-16): incluimos VENDOR para que reasignar entre
        // influencer/embajador/vendedor limpie la atribución previa (1:1).
        referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Borra los uses indicados (cascade comisiones) SALVO los que tengan
    // comisiones PAID — esos se preservan para no romper el historial contable.
    const deleteUses = async (ids: string[]) => {
      for (const id of ids) {
        const paid = await this.prisma.commission.count({
          where: { referralUseId: id, status: 'PAID' },
        });
        if (paid > 0) {
          this.logger.warn(
            `setTenantAssignment: use ${id} tiene comisiones PAID — no se borra (se preserva historial)`,
          );
          continue;
        }
        await this.prisma.referralUse.delete({ where: { id } });
      }
    };

    if (codeId === null) {
      await deleteUses(existingAll.map((u) => u.id));
      return { ok: true, assigned: null };
    }

    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { id: true, role: true, isActive: true },
    });
    if (!code) throw new NotFoundException('Código referral no encontrado');
    if (
      code.role !== 'INFLUENCER' &&
      code.role !== 'AMBASSADOR' &&
      code.role !== 'VENDOR'
    ) {
      throw new BadRequestException(
        'Solo se pueden asignar códigos de tipo INFLUENCER, EMBAJADOR o VENDEDOR',
      );
    }

    // Limpiar TODAS las atribuciones que NO sean el código objetivo.
    await deleteUses(
      existingAll.filter((u) => u.referralCodeId !== codeId).map((u) => u.id),
    );

    const sameCode = existingAll.find((u) => u.referralCodeId === codeId);
    if (sameCode) {
      // Ya estaba asignado a este código: idempotente. Disparamos backfill por
      // si la asignación se hizo antes del fix de comisión retroactiva (no-op
      // si ya hay commission reciente).
      await this.backfillCommissionForAssignment(
        sameCode.id,
        tenantId,
        codeId,
      ).catch(() => null);
      return { ok: true, assigned: sameCode.id };
    }
    const created = await this.prisma.referralUse.create({
      data: {
        referralCodeId: codeId,
        tenantId,
        status: 'PAYING', // asignación manual del super admin = ya cliente
        convertedAt: new Date(),
      },
    });

    // Backfill de comisión retroactiva: si el tenant tiene un ciclo de
    // pago vigente (currentPeriodEnd en el futuro = ya pagó este mes),
    // generamos la Commission inmediatamente para que el afiliado vea su
    // % desde ya. Sin esto la comisión recién aparecería en el próximo
    // pago (~30 días). Idempotente: el patrón de hotmart "skip si última
    // commission < 25 días" se mantiene por separado en el webhook.
    await this.backfillCommissionForAssignment(created.id, tenantId, codeId).catch(
      (e) => {
        // No bloqueamos la asignación si falla el backfill — el admin
        // puede generar manualmente la comisión desde /admin/referrals.
        // eslint-disable-next-line no-console
        console.warn(
          `backfillCommissionForAssignment falló tenant=${tenantId}: ${(e as Error).message}`,
        );
      },
    );

    return { ok: true, assigned: created.id };
  }

  /**
   * Endpoint público admin: fuerza el backfill para la asignación
   * actual del tenant. Útil cuando se asignó antes del fix y la
   * comisión nunca se generó.
   *
   * `force=true` saltea el chequeo de `currentPeriodEnd` (tenants
   * creados manualmente sin billing tracking). El precio del plan
   * sigue siendo obligatorio.
   */
  async backfillCommissionForCurrentAssignment(
    tenantId: string,
    force = false,
  ) {
    const use = await this.prisma.referralUse.findFirst({
      where: {
        tenantId,
        referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR'] } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!use) {
      throw new NotFoundException(
        'Este tenant no tiene asignación a INFLUENCER o AMBASSADOR',
      );
    }
    await this.backfillCommissionForAssignment(
      use.id,
      tenantId,
      use.referralCodeId,
      force,
    );
    const commissions = await this.prisma.commission.findMany({
      where: { referralUseId: use.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      ok: true,
      referralUseId: use.id,
      commissions: commissions.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        status: c.status,
        createdAt: c.createdAt,
      })),
    };
  }

  /**
   * Crea Commission(s) PENDING para una asignación recién hecha si el
   * tenant ya está pagando este ciclo. Replica la lógica del webhook
   * Hotmart pero sólo para el caso de asignación manual.
   *
   * - Directa: el código asignado (INFLUENCER o AMBASSADOR) cobra su
   *   commissionPercent del priceMonthly del plan.
   * - Indirecta: si es AMBASSADOR con parentCode (un influencer), el
   *   influencer cobra el `referrals.indirectPercent` (default 5%).
   *   Upsert del ReferralUse del parent si no existe todavía.
   *
   * Skip si:
   * - El tenant no tiene plan o priceMonthly <= 0
   * - El tenant no tiene currentPeriodEnd o ya venció (no está pagando)
   * - Ya existe una Commission del último ciclo (<25 días) para este use
   *   (defensa contra doble asignación si el admin re-asigna mismo code)
   */
  private async backfillCommissionForAssignment(
    useId: string,
    tenantId: string,
    codeId: string,
    force = false,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        currentPeriodEnd: true,
        suspendedAt: true,
        planPeriodicity: true,
        subscriptionPriceUsd: true,
        plan: { select: { priceMonthly: true } },
      },
    });
    if (!tenant) return;
    // Si el tenant está suspendido, NO generar comisión incluso con force.
    if (tenant.suspendedAt) return;
    // Sin force: requerir ciclo de pago vigente (currentPeriodEnd futuro).
    if (!force) {
      if (!tenant.currentPeriodEnd) return;
      if (new Date(tenant.currentPeriodEnd) <= new Date()) return;
    }
    // Base = precio REAL pagado en Hotmart si lo tenemos, sino canónico del
    // bundle (68/150/278/500). NO priceMonthly. Fuente única: getCommissionBase.
    const price = await this.recalc.getCommissionBase(
      tenant.subscriptionPriceUsd ?? null,
      tenant.planPeriodicity,
    );
    if (!price || price <= 0) return;

    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      include: { parentCode: true },
    });
    if (!code) return;
    if (
      code.role !== 'INFLUENCER' &&
      code.role !== 'AMBASSADOR' &&
      code.role !== 'VENDOR'
    )
      return;

    // Defensa: si ya hay commission reciente para este use, skip.
    const last = await this.prisma.commission.findFirst({
      where: { referralUseId: useId },
      orderBy: { createdAt: 'desc' },
    });
    const recent =
      last &&
      (Date.now() - new Date(last.createdAt).getTime()) / 86400_000 < 25;
    if (recent) return;

    // #3 (2026-06-16): VENDEDOR asignado directo a una empresa. El split
    // 3-way (influencer / embajador − vendedor / vendedor) ya lo resuelve
    // generateCommissionsForPayment vía getAttributionChain + excepciones por
    // tenant + clamp del vendor al slice del embajador. Reusamos esa fuente
    // única en vez de duplicar la fórmula. Idempotente por
    // UNIQUE(referralUseId, recipientCodeId, periodKey) → no duplica este mes.
    if (code.role === 'VENDOR') {
      await this.generateCommissionsForPayment({
        tenantId,
        paymentAmountUsd: price,
        hotmartTransactionId: null,
      });
      return;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const pct = Number(code.commissionPercent ?? COMMISSION_DEFAULTS.ambassadorPct);
    const direct = round2((price * pct) / 100);

    await this.prisma.commission
      .create({
        data: {
          referralUseId: useId,
          amount: direct,
          status: 'PENDING',
          recipientCodeId: code.id,
          periodKey: monthKey(),
        },
      })
      .catch((e: any) => {
        if (e?.code === 'P2002') {
          this.logger.warn(
            `awardCommissionForReferral: skip dup direct (useId=${useId}, code=${code.id}, periodKey=${monthKey()})`,
          );
          return null;
        }
        throw e;
      });

    // Indirecta: AMBASSADOR con parent INFLUENCER → el influencer cobra el %
    // indirecto (5%) sobre el MISMO referido. Se registra en el use del
    // embajador (recipient = influencer), NO en un "parent-use" aparte. Así
    // la atribución del tenant queda 1:1 (un solo use) y el cron recurrente
    // no sobre-paga al influencer su % propio en cada renovación
    // (bug Birria León 2026-06-15). El UNIQUE (referralUseId, recipientCodeId,
    // periodKey) dedupea: misma use, distinto recipient → fila aparte.
    if (code.role === 'AMBASSADOR' && code.parentCode) {
      const indirectPctRow = await this.prisma.setting.findUnique({
        where: { key: 'referrals.indirectPercent' },
      });
      const indirectPct = indirectPctRow?.value
        ? Number(indirectPctRow.value)
        : 5;
      const indirect = round2((price * indirectPct) / 100);
      if (indirect > 0) {
        const parentCodeId = code.parentCode.id;
        await this.prisma.commission
          .create({
            data: {
              referralUseId: useId,
              amount: indirect,
              status: 'PENDING',
              recipientCodeId: parentCodeId,
              periodKey: monthKey(),
            },
          })
          .catch((e: any) => {
            if (e?.code === 'P2002') {
              this.logger.warn(
                `awardCommissionForReferral: skip dup indirect (useId=${useId}, code=${parentCodeId}, periodKey=${monthKey()})`,
              );
              return null;
            }
            throw e;
          });
      }
    }
  }

  /**
   * Email único global a través de afiliados (cualquier ReferralCode con
   * role INFLUENCER/AMBASSADOR/SOCIO) Y users con cualquier role
   * AFFILIATE_*. Se llama antes de crear un afiliado nuevo desde
   * cualquier endpoint (`createCode`, `createOrInviteSocio`,
   * `createCompanyDirectAmbassador`, campañas).
   *
   * Si `ignoreCodeId` viene, se permite que coincida ese mismo registro
   * (útil al editar, no implementado todavía pero deja la puerta abierta).
   *
   * Lanza ConflictException con mensaje uniforme cuando hay colisión.
   */
  async assertUniqueAffiliateEmail(
    rawEmail: string,
    opts: { ignoreCodeId?: string; ignoreUserId?: string } = {},
  ) {
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!email) return;
    // HOTFIX 2026-06-05 (bug #1 CRÍTICO): incluimos VENDOR + AFFILIATE_VENDOR.
    // Antes faltaban → 2 vendedores podían crearse con mismo email Y peor:
    // si el email coincidía con un TENANT_OWNER existente, el inviteAffiliate
    // posterior re-hasheaba silenciosamente su password (account takeover).
    // También bloqueamos cualquier User existente cuyo email coincida — sin
    // importar el role — porque el flujo de invite SIEMPRE re-asigna password
    // y romper a un user inocente es peor que un 409.
    const dupCode = await this.prisma.referralCode.findFirst({
      where: {
        ownerEmail: email,
        role: { in: ['INFLUENCER', 'AMBASSADOR', 'SOCIO', 'VENDOR'] },
        ...(opts.ignoreCodeId ? { id: { not: opts.ignoreCodeId } } : {}),
      },
      select: { id: true, role: true },
    });
    if (dupCode) {
      throw new ConflictException(
        'Este correo ya se encuentra registrado.',
      );
    }
    const dupUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (dupUser && dupUser.id !== opts.ignoreUserId) {
      throw new ConflictException(
        'Este correo ya se encuentra registrado.',
      );
    }
  }

  /**
   * Eliminación de un ReferralCode (influencer/embajador/socio) con
   * validación de dependencias activas. Si tiene `ReferralUse` con tenant
   * en estado ACTIVE/PAYING → 409 Conflict (no se puede eliminar). Si es
   * INFLUENCER y tiene embajadores hijos activos → también 409. Si es
   * INFLUENCER titular de una Campaign activa → 409.
   *
   * Si pasa todas las validaciones: hard-delete del row. Esto cascadea
   * ReferralUse SIGNED_UP / CHURNED y sus Commission (FK Cascade). El
   * Campaign en el caso INFLUENCER también cascadea por `ownerCodeId`.
   *
   * Para preservar historial en el caso edge "tiene CHURNED but no
   * tenant activo" devolvemos el row "soft-deleted" (isActive=false)
   * en vez de hard-delete. Patrón mismo que `rejectAmbassador`.
   */
  async deleteCode(
    user: AuthUser,
    codeId: string,
    opts: { voidCommissions?: boolean } = {},
  ): Promise<{
    ok: true;
    mode: 'soft' | 'hard';
    voided?: number;
    preservedPaid?: number;
  }> {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      include: {
        uses: { select: { id: true, status: true, tenantId: true } },
        ambassadors: { select: { id: true, isActive: true } },
        ownerOfCampaign: { select: { id: true, status: true } },
      },
    });
    if (!code) throw new NotFoundException('Código no encontrado');

    // Modo "anular y eliminar": para cuentas creadas/atribuidas por error.
    // Salta el bloqueo por tenants activos, anula las comisiones NO pagadas
    // (las marca REJECTED para que no sumen a nada) y desactiva el código
    // (queda la fila como registro histórico de que existió).
    const force = opts.voidCommissions === true;

    const activeUses = code.uses.filter(
      (u) =>
        u.tenantId &&
        (u.status === 'ACTIVE' || u.status === 'PAYING'),
    );
    if (activeUses.length > 0 && !force) {
      throw new ConflictException(
        `No se puede eliminar: tiene ${activeUses.length} tenant${activeUses.length === 1 ? '' : 's'} asociado${activeUses.length === 1 ? '' : 's'} activo${activeUses.length === 1 ? '' : 's'}. Si fue una atribución por error, usá "Anular comisiones y eliminar".`,
      );
    }

    if (force) {
      // Comisiones que RECIBE este código (incluye filas legacy sin
      // recipientCodeId que cuelgan del use atribuido a este código).
      const comms = await this.prisma.commission.findMany({
        where: {
          OR: [
            { recipientCodeId: codeId },
            { recipientCodeId: null, referralUse: { referralCodeId: codeId } },
          ],
        },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          payoutItem: { select: { id: true } },
        },
      });
      let preservedPaid = 0;
      const voidableIds: string[] = [];
      for (const c of comms) {
        // No tocamos plata ya desembolsada: si está pagada, parcialmente
        // pagada o enganchada a un payout, se preserva para no romper la caja.
        const alreadyPaid =
          c.status === 'PAID' ||
          c.paymentStatus === 'PAID' ||
          c.paymentStatus === 'PARTIAL' ||
          !!c.payoutItem;
        if (alreadyPaid) {
          preservedPaid += 1;
          continue;
        }
        if (c.status === 'REJECTED') continue; // ya anulada
        voidableIds.push(c.id);
      }
      if (voidableIds.length > 0) {
        await this.prisma.commission.updateMany({
          where: { id: { in: voidableIds } },
          data: {
            status: 'REJECTED' as CommissionStatus,
            notes: `Anulada al eliminar afiliado por error (${user.email})`,
          },
        });
      }
      // Desactivar (soft) — preserva la fila como registro de que existió y,
      // gracias al filtro isActive en reconcileRecurringCommissions, deja de
      // generar comisiones nuevas.
      await this.prisma.referralCode.update({
        where: { id: codeId },
        data: { isActive: false },
      });
      this.logger.log(
        `Force-delete(void) ReferralCode id=${codeId} role=${code.role} voided=${voidableIds.length} preservedPaid=${preservedPaid} by ${user.email}`,
      );
      return {
        ok: true,
        mode: 'soft',
        voided: voidableIds.length,
        preservedPaid,
      };
    }

    if (code.role === 'INFLUENCER') {
      const activeAmbassadors = code.ambassadors.filter((a) => a.isActive);
      if (activeAmbassadors.length > 0) {
        throw new ConflictException(
          `No se puede eliminar: tiene ${activeAmbassadors.length} embajador${activeAmbassadors.length === 1 ? '' : 'es'} activo${activeAmbassadors.length === 1 ? '' : 's'} debajo. Reasignalos o desactivalos primero.`,
        );
      }
      if (
        code.ownerOfCampaign &&
        code.ownerOfCampaign.status === 'ACTIVE'
      ) {
        throw new ConflictException(
          'No se puede eliminar: este influencer es titular de una campaña activa. Finalizá o eliminá la campaña primero.',
        );
      }
    }

    // Si tiene history (uses CHURNED/SIGNED_UP o ambassadors inactivos),
    // soft-delete para preservar atribución histórica. Si está limpio,
    // hard-delete.
    const hasHistory =
      code.uses.length > 0 ||
      code.ambassadors.length > 0 ||
      !!code.ownerOfCampaign;
    if (hasHistory) {
      await this.prisma.referralCode.update({
        where: { id: codeId },
        data: { isActive: false },
      });
      this.logger.log(
        `Soft-delete ReferralCode id=${codeId} role=${code.role} by ${user.email}`,
      );
      return { ok: true, mode: 'soft' };
    }
    await this.prisma.referralCode.delete({ where: { id: codeId } });
    this.logger.log(
      `Hard-delete ReferralCode id=${codeId} role=${code.role} by ${user.email}`,
    );
    return { ok: true, mode: 'hard' };
  }

  /**
   * Buscador inteligente de afiliados para asignar a un tenant nuevo.
   * Matchea por nombre, email o whatsapp (substring, case-insensitive)
   * contra cualquier ReferralCode con role INFLUENCER o AMBASSADOR
   * activo. Limitado a 30 resultados para mantener latency baja.
   *
   * Devuelve estructura plana lista para el dropdown del frontend
   * (id, ownerName, code, role, campaignName).
   */
  async searchAffiliates(user: AuthUser, q: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const query = (q ?? '').trim();
    const where: any = {
      role: { in: ['INFLUENCER', 'AMBASSADOR'] },
      isActive: true,
      ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
    };
    if (query) {
      where.OR = [
        { ownerName: { contains: query, mode: 'insensitive' } },
        { ownerEmail: { contains: query, mode: 'insensitive' } },
        { ownerWhatsapp: { contains: query } },
        { code: { contains: query.toUpperCase() } },
      ];
    }
    const codes = await this.prisma.referralCode.findMany({
      where,
      include: {
        ownerOfCampaign: { select: { name: true } },
        campaign: { select: { name: true } },
        parentCode: { select: { ownerName: true } },
      },
      orderBy: [{ role: 'asc' }, { ownerName: 'asc' }],
      take: 30,
    });
    return codes.map((c) => ({
      id: c.id,
      ownerName: c.ownerName,
      ownerEmail: c.ownerEmail,
      ownerWhatsapp: c.ownerWhatsapp,
      code: c.code,
      role: c.role,
      campaignName:
        c.ownerOfCampaign?.name ?? c.campaign?.name ?? null,
      parentName: c.parentCode?.ownerName ?? null,
    }));
  }

  // ============================================================
  // VENDOR HIERARCHY (FASE FOUNDATION 2026-06-05)
  // ============================================================

  /**
   * SUPER_ADMIN: cambia la config del módulo de vendedores de un
   * embajador (AMBASSADOR). Permite togglear `allowVendors` y setear
   * `maxCommissionPercent`. Solo aplica para AMBASSADOR — para otros
   * roles no tiene sentido y rechazamos.
   *
   * Validaciones:
   *  - El code tiene que ser role=AMBASSADOR.
   *  - maxCommissionPercent (si viene) debe ser > 0 y <= 100.
   *  - Si se quiere bajar el max por debajo de lo ya repartido entre
   *    vendedores activos, rechazamos para evitar inconsistencia.
   *  - Si se desactiva allowVendors cuando hay vendedores activos,
   *    pasa pero NO los desactiva (el admin puede re-habilitar sin
   *    perder data). La UI muestra warning.
   */
  /**
   * Tope REAL que un embajador/influencer le puede asignar a un vendedor.
   *
   * El vendedor cobra de la PROPIA tajada del padre: en el 3-way split
   * (ver `buildSplitRows`) el embajador recibe `commissionPercent -
   * vendorPercent`. Por eso el vendedor jamás puede exceder lo que el
   * padre mismo gana — si lo hiciera, el `Math.max(0, …)` del split deja
   * al embajador en 0% pero el vendedor igual cobra de más y la EMPRESA
   * sobrepaga la rama. El tope correcto es `min(% propio, maxConfig)`:
   * el `% propio` es el techo duro y `maxCommissionPercent` solo puede
   * bajarlo más, nunca subirlo por encima del propio.
   */
  private effectiveVendorCap(parent: {
    commissionPercent: unknown;
    maxCommissionPercent: unknown;
  }): number {
    const ownPct = Number(parent.commissionPercent ?? 0);
    const configuredMax =
      parent.maxCommissionPercent != null
        ? Number(parent.maxCommissionPercent)
        : ownPct;
    return Math.min(ownPct, configuredMax);
  }

  async setEmbajadorVendorConfig(
    user: AuthUser,
    embajadorCodeId: string,
    patch: { allowVendors?: boolean; maxCommissionPercent?: number },
  ) {
    const code = await this.prisma.referralCode.findUnique({
      where: { id: embajadorCodeId },
      include: { childVendors: true },
    });
    if (!code) throw new NotFoundException('Afiliado no encontrado');
    // 2026-06-16: embajadores E influencers pueden habilitar vendedores. El
    // dueño del código puede auto-configurarlo (no solo el super admin).
    if (code.role !== 'AMBASSADOR' && code.role !== 'INFLUENCER') {
      throw new BadRequestException(
        'Solo embajadores o influencers pueden tener módulo de vendedores.',
      );
    }
    const isAuthorized =
      user.role === 'SUPER_ADMIN' ||
      (await this.isUserOwnerOfCode(user, embajadorCodeId));
    if (!isAuthorized) throw new ForbiddenException();
    const data: { allowVendors?: boolean; maxCommissionPercent?: number } = {};
    if (typeof patch.allowVendors === 'boolean') {
      data.allowVendors = patch.allowVendors;
    }
    if (typeof patch.maxCommissionPercent === 'number') {
      const m = patch.maxCommissionPercent;
      const ownPct = Number(code.commissionPercent ?? 0);
      if (m <= 0 || m > 100) {
        throw new BadRequestException(
          'La comisión máxima debe ser > 0 y <= 100.',
        );
      }
      // CORRECCIÓN LÓGICA 2026-06-16: el tope no puede superar el % propio
      // del embajador/influencer — los vendedores cobran de su tajada.
      if (m > ownPct) {
        throw new BadRequestException(
          `La comisión máxima para vendedores (${m}%) no puede superar tu propia comisión (${ownPct}%), porque los vendedores cobran de ahí.`,
        );
      }
      // La comisión es INDIVIDUAL por vendedor (no acumulada): ningún
      // vendedor activo puede quedar por encima del nuevo tope.
      const maxActive = code.childVendors
        .filter((v) => v.isActive)
        .reduce((s, v) => Math.max(s, Number(v.commissionPercent ?? 0)), 0);
      if (m < maxActive) {
        throw new BadRequestException(
          `No se puede bajar la comisión máxima a ${m}% — ya tenés un vendedor activo con ${maxActive}%.`,
        );
      }
      data.maxCommissionPercent = m;
    }
    return this.prisma.referralCode.update({
      where: { id: embajadorCodeId },
      data,
      select: {
        id: true,
        allowVendors: true,
        maxCommissionPercent: true,
      },
    });
  }

  /**
   * El embajador (no el super admin) preconfigura el % por defecto que se
   * aplicará automáticamente cuando un vendedor se autoregistra desde
   * `/seller/register/<ambassadorCode>`. Tiene que ser > 0 y caber dentro
   * de su comisión disponible (max - usadoActivo). Si pasa null, vuelve a
   * usar el fallback de 10% (o el disponible si es menor).
   */
  async setEmbajadorDefaultVendorCommission(
    user: AuthUser,
    embajadorCodeId: string,
    pct: number | null,
  ) {
    const code = await this.prisma.referralCode.findUnique({
      where: { id: embajadorCodeId },
      include: { childVendors: true },
    });
    if (!code) throw new NotFoundException('Afiliado no encontrado');
    if (code.role !== 'AMBASSADOR' && code.role !== 'INFLUENCER') {
      throw new BadRequestException(
        'Solo embajadores o influencers pueden configurar el % por defecto.',
      );
    }
    const isAuthorized =
      user.role === 'SUPER_ADMIN' ||
      (await this.isUserOwnerOfCode(user, embajadorCodeId));
    if (!isAuthorized) throw new ForbiddenException();
    if (!code.allowVendors) {
      throw new BadRequestException(
        'Tu cuenta no tiene activado el módulo de vendedores.',
      );
    }
    if (pct !== null) {
      if (typeof pct !== 'number' || isNaN(pct) || pct <= 0) {
        throw new BadRequestException('El % debe ser mayor a 0.');
      }
      // CORRECCIÓN LÓGICA 2026-06-16: la comisión es INDIVIDUAL por venta,
      // no un pool acumulado. El % por defecto solo tiene que caber dentro
      // del tope real (% propio del padre, acotado por maxCommissionPercent).
      const max = this.effectiveVendorCap(code);
      if (pct > max) {
        throw new BadRequestException(
          `El % por defecto (${pct}%) no puede superar tu comisión (${max}%), porque los vendedores cobran de ella.`,
        );
      }
    }
    const updated = await this.prisma.referralCode.update({
      where: { id: embajadorCodeId },
      data: { defaultVendorCommissionPercent: pct },
      select: { id: true, defaultVendorCommissionPercent: true },
    });
    return {
      id: updated.id,
      defaultVendorCommissionPercent:
        updated.defaultVendorCommissionPercent !== null
          ? Number(updated.defaultVendorCommissionPercent)
          : null,
    };
  }

  /**
   * Lookup público (sin auth) usado por la página `/seller/register/<code>`
   * del frontend. Valida que el code exista, sea un embajador activo y
   * tenga el módulo de vendedores activo. Si no, retorna `valid: false`
   * con motivo. NO expone PII sensible — solo nombre + slug + % default.
   */
  async lookupSelfRegisterAmbassador(code: string) {
    const norm = code.trim();
    if (!norm) {
      return { valid: false, reason: 'INVALID_CODE' as const };
    }
    const amb = await this.prisma.referralCode.findUnique({
      where: { code: norm },
      include: { childVendors: true },
    });
    // 2026-06-16: un VENDEDOR puede colgar de un EMBAJADOR o de un INFLUENCER
    // directamente. Ambos roles pueden habilitar vendedores (allowVendors) y
    // setear su % por defecto. El parent se guarda igual en
    // parentEmbajadorCodeId (FK genérica a ReferralCode).
    if (!amb || (amb.role !== 'AMBASSADOR' && amb.role !== 'INFLUENCER')) {
      return { valid: false, reason: 'NOT_FOUND' as const };
    }
    if (!amb.isActive) {
      return { valid: false, reason: 'INACTIVE' as const };
    }
    if (!amb.allowVendors) {
      return { valid: false, reason: 'NOT_ALLOWED' as const };
    }
    // CORRECCIÓN LÓGICA 2026-06-05: la comisión es INDIVIDUAL por venta,
    // NO acumulada entre vendedores. Cada vendedor cobra SU % en SUS
    // ventas. Por eso `hasAvailableCommission` depende sólo de `max > 0`
    // y `effectivePct` se capa al máximo absoluto (no a un "disponible").
    // CORRECCIÓN LÓGICA 2026-06-16: tope real = % propio del padre (acotado
    // por maxCommissionPercent), no un flat 25. Ver effectiveVendorCap.
    const max = this.effectiveVendorCap(amb);
    const defaultPct = amb.defaultVendorCommissionPercent
      ? Number(amb.defaultVendorCommissionPercent)
      : 10;
    const effectivePct = Math.min(defaultPct, max);
    return {
      valid: true as const,
      ambassador: {
        code: amb.code,
        ownerName: amb.ownerName,
        slug: amb.slug ?? amb.code.toLowerCase(),
      },
      hasAvailableCommission: max > 0,
      defaultVendorCommissionPercent: effectivePct,
    };
  }

  /**
   * Autoregistro público de un vendedor desde `/seller/register/<code>`.
   * Reutiliza createVendor por dentro (saltando el auth gate del embajador
   * porque acá el "actor" es el propio vendedor que está creando su cuenta)
   * y al éxito emite JWT + refresh para auto-login.
   */
  async selfRegisterVendor(
    dto: {
      ambassadorCode: string;
      fullName: string;
      email: string;
      phone: string;
      password: string;
    },
    ip?: string,
  ) {
    const lookup = await this.lookupSelfRegisterAmbassador(dto.ambassadorCode);
    if (!lookup.valid) {
      throw new BadRequestException(
        'Este embajador no tiene habilitado el registro de vendedores.',
      );
    }
    if (!lookup.hasAvailableCommission) {
      throw new BadRequestException(
        'El embajador no tiene comisión disponible para sumar vendedores en este momento.',
      );
    }

    const amb = await this.prisma.referralCode.findUnique({
      where: { code: lookup.ambassador.code },
    });
    if (!amb) {
      throw new NotFoundException('Embajador no encontrado');
    }

    await this.assertUniqueAffiliateEmail(dto.email);

    // CORRECCIÓN LÓGICA 2026-06-05: % final = default del embajador
    // (??10) capado al tope. La comisión es INDIVIDUAL por venta — cada
    // vendedor cobra SU % en SUS ventas, no se acumula.
    // CORRECCIÓN LÓGICA 2026-06-16: tope = % propio del padre (acotado por
    // maxCommissionPercent), no un flat 25. Ver effectiveVendorCap.
    const max = this.effectiveVendorCap(amb);
    const defaultPct = amb.defaultVendorCommissionPercent
      ? Number(amb.defaultVendorCommissionPercent)
      : 10;
    const commissionPercent = Math.min(defaultPct, max);
    if (commissionPercent <= 0) {
      throw new BadRequestException(
        'Este embajador no tiene comisión configurada para vendedores.',
      );
    }

    // Creamos el ReferralCode role=VENDOR + User AFFILIATE_VENDOR.
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    const slug = await this.allocateSlug(dto.fullName, code);

    const created = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.phone,
        role: 'VENDOR',
        commissionPercent,
        whiteLabelId: await this.resolveAffiliateWhiteLabelId({
          parentWhiteLabelId: amb.whiteLabelId,
        }),
        parentEmbajadorCodeId: amb.id,
        isActive: true,
      },
    });

    const inviteResult = await this.auth
      .inviteAffiliate({
        email: dto.email,
        fullName: dto.fullName,
        role: 'AFFILIATE_VENDOR',
        referralCodeId: created.id,
        phone: dto.phone,
        presetPassword: dto.password,
      })
      .catch((err) => {
        this.logger.warn(
          `inviteAffiliate falló para self-register ${dto.email}: ${(err as Error).message}`,
        );
        return null;
      });
    if (!inviteResult) {
      throw new BadRequestException(
        'No se pudo crear la cuenta. Intentá de nuevo en unos minutos.',
      );
    }

    // Auto-login: emitimos JWT + refresh apuntando al user recién creado.
    const tokens = await this.auth.issueAuthTokensForUserId(
      inviteResult.userId,
      ip ?? null,
    );

    return {
      ...tokens,
      vendor: {
        codeId: created.id,
        code: created.code,
        ownerName: created.ownerName,
        commissionPercent,
      },
      ambassador: {
        code: amb.code,
        ownerName: amb.ownerName,
      },
    };
  }

  /**
   * Lookup público para `/ambassador/register/<influencerCode>`: ¿existe el
   * influencer y está activo? Devuelve el % por defecto del embajador para
   * mostrarlo antes de registrarse. (2026-06-16: el influencer comparte este
   * link para que la gente se autoregistre como embajador bajo él.)
   */
  async lookupSelfRegisterInfluencer(code: string) {
    const norm = code.trim();
    if (!norm) return { valid: false, reason: 'INVALID_CODE' as const };
    const inf = await this.prisma.referralCode.findUnique({
      where: { code: norm },
    });
    if (!inf || inf.role !== 'INFLUENCER') {
      return { valid: false, reason: 'NOT_FOUND' as const };
    }
    if (!inf.isActive) {
      return { valid: false, reason: 'INACTIVE' as const };
    }
    const row = await this.prisma.setting.findUnique({
      where: { key: 'referrals.defaultAmbassadorPercent' },
    });
    const defaultPct = row?.value ? Number(row.value) : COMMISSION_DEFAULTS.ambassadorPct;
    return {
      valid: true as const,
      influencer: {
        code: inf.code,
        ownerName: inf.ownerName,
        slug: inf.slug ?? inf.code.toLowerCase(),
      },
      defaultAmbassadorPercent: defaultPct,
    };
  }

  /**
   * Autoregistro público de un EMBAJADOR bajo un influencer desde
   * `/ambassador/register/<influencerCode>`. Crea ReferralCode role=AMBASSADOR
   * (parentCodeId = influencer) + User AFFILIATE_AMBASSADOR y devuelve tokens
   * para auto-login. Auto-aprobado (el influencer compartió el link a quien
   * confía).
   */
  async selfRegisterAmbassador(
    dto: {
      influencerCode: string;
      fullName: string;
      email: string;
      phone: string;
      password: string;
    },
    ip?: string,
  ) {
    const lookup = await this.lookupSelfRegisterInfluencer(dto.influencerCode);
    if (!lookup.valid) {
      throw new BadRequestException('El link de registro no es válido o está inactivo.');
    }
    const inf = await this.prisma.referralCode.findUnique({
      where: { code: dto.influencerCode.trim() },
    });
    if (!inf || inf.role !== 'INFLUENCER') {
      throw new NotFoundException('Influencer no encontrado');
    }

    await this.assertUniqueAffiliateEmail(dto.email);

    const commissionPercent = lookup.defaultAmbassadorPercent;
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    const slug = await this.allocateSlug(dto.fullName, code);

    const created = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.phone,
        role: 'AMBASSADOR',
        commissionPercent,
        whiteLabelId: await this.resolveAffiliateWhiteLabelId({
          parentWhiteLabelId: inf.whiteLabelId,
        }),
        parentCodeId: inf.id,
        campaignId: inf.campaignId ?? null,
        approvedAt: new Date(),
        source: 'influencer_self_register',
        isActive: true,
      },
    });

    const inviteResult = await this.auth
      .inviteAffiliate({
        email: dto.email,
        fullName: dto.fullName,
        role: 'AFFILIATE_AMBASSADOR',
        referralCodeId: created.id,
        phone: dto.phone,
        presetPassword: dto.password,
      })
      .catch((err) => {
        this.logger.warn(
          `inviteAffiliate falló para ambassador self-register ${dto.email}: ${(err as Error).message}`,
        );
        return null;
      });
    if (!inviteResult) {
      throw new BadRequestException(
        'No se pudo crear la cuenta. Intentá de nuevo en unos minutos.',
      );
    }

    const tokens = await this.auth.issueAuthTokensForUserId(
      inviteResult.userId,
      ip ?? null,
    );

    return {
      ...tokens,
      ambassador: {
        codeId: created.id,
        code: created.code,
        ownerName: created.ownerName,
        commissionPercent,
      },
      influencer: {
        code: inf.code,
        ownerName: inf.ownerName,
      },
    };
  }

  // ============================================================
  //         AUTORREGISTRO PÚBLICO INFLUENCER / EMBAJADOR
  // ============================================================
  //
  // Permite que cualquier persona se registre como afiliado top-level
  // (sin padre) si el SUPER_ADMIN habilitó la feature desde Settings.
  // Diferente de selfRegisterVendor (que requiere ambassadorCode).
  //
  // Settings:
  //  - affiliate.publicRegistration.enabled                — master toggle
  //  - affiliate.publicRegistration.allowInfluencer        — solo INF
  //  - affiliate.publicRegistration.allowAmbassador        — solo AMB
  //  - affiliate.publicRegistration.influencerCommissionPct
  //  - affiliate.publicRegistration.ambassadorCommissionPct

  private static readonly PUBLIC_REG_SETTING_KEYS = [
    'affiliate.publicRegistration.enabled',
    'affiliate.publicRegistration.allowInfluencer',
    'affiliate.publicRegistration.allowAmbassador',
    'affiliate.publicRegistration.influencerCommissionPct',
    'affiliate.publicRegistration.ambassadorCommissionPct',
  ];

  async getPublicAffiliateRegistrationConfig() {
    const settings = await this.prisma.setting.findMany({
      where: { key: { in: ReferralsService.PUBLIC_REG_SETTING_KEYS } },
    });
    const map = new Map(settings.map((s) => [s.key, s.value]));
    const enabled = map.get('affiliate.publicRegistration.enabled') === 'true';
    const allowInfluencer =
      map.get('affiliate.publicRegistration.allowInfluencer') !== 'false';
    const allowAmbassador =
      map.get('affiliate.publicRegistration.allowAmbassador') !== 'false';
    const influencerCommissionPct = Number(
      map.get('affiliate.publicRegistration.influencerCommissionPct') ?? '10',
    );
    const ambassadorCommissionPct = Number(
      map.get('affiliate.publicRegistration.ambassadorCommissionPct') ?? '15',
    );
    return {
      enabled,
      allowInfluencer: enabled && allowInfluencer,
      allowAmbassador: enabled && allowAmbassador,
      influencerCommissionPct,
      ambassadorCommissionPct,
    };
  }

  async updatePublicAffiliateRegistrationConfig(patch: {
    enabled?: boolean;
    allowInfluencer?: boolean;
    allowAmbassador?: boolean;
    influencerCommissionPct?: number;
    ambassadorCommissionPct?: number;
  }) {
    const writes: Array<[string, string]> = [];
    if (patch.enabled !== undefined) {
      writes.push(['affiliate.publicRegistration.enabled', String(patch.enabled)]);
    }
    if (patch.allowInfluencer !== undefined) {
      writes.push(['affiliate.publicRegistration.allowInfluencer', String(patch.allowInfluencer)]);
    }
    if (patch.allowAmbassador !== undefined) {
      writes.push(['affiliate.publicRegistration.allowAmbassador', String(patch.allowAmbassador)]);
    }
    if (patch.influencerCommissionPct !== undefined) {
      writes.push([
        'affiliate.publicRegistration.influencerCommissionPct',
        String(Math.max(0, Math.min(100, patch.influencerCommissionPct))),
      ]);
    }
    if (patch.ambassadorCommissionPct !== undefined) {
      writes.push([
        'affiliate.publicRegistration.ambassadorCommissionPct',
        String(Math.max(0, Math.min(100, patch.ambassadorCommissionPct))),
      ]);
    }
    for (const [key, value] of writes) {
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    return this.getPublicAffiliateRegistrationConfig();
  }

  async selfRegisterAffiliate(
    dto: {
      role: 'INFLUENCER' | 'AMBASSADOR';
      fullName: string;
      email: string;
      phone: string;
      password: string;
      country?: string;
    },
    ip?: string,
  ) {
    const config = await this.getPublicAffiliateRegistrationConfig();
    if (!config.enabled) {
      throw new BadRequestException('El registro público de afiliados no está habilitado.');
    }
    if (dto.role === 'INFLUENCER' && !config.allowInfluencer) {
      throw new BadRequestException('El registro de influencers no está habilitado.');
    }
    if (dto.role === 'AMBASSADOR' && !config.allowAmbassador) {
      throw new BadRequestException('El registro de embajadores no está habilitado.');
    }

    await this.assertUniqueAffiliateEmail(dto.email);

    const commissionPercent =
      dto.role === 'INFLUENCER'
        ? config.influencerCommissionPct
        : config.ambassadorCommissionPct;
    if (commissionPercent <= 0) {
      throw new BadRequestException('Comisión no configurada para este rol.');
    }

    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    const slug = await this.allocateSlug(dto.fullName, code);

    const created = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.phone,
        country: dto.country?.trim() || null,
        role: dto.role,
        commissionPercent,
        whiteLabelId: await this.resolveAffiliateWhiteLabelId({}),
        isActive: true,
      },
    });

    // inviteAffiliate puede fallar (email pertenece a otro role, error
    // transitorio, etc). Si falla, eliminamos la ReferralCode recién
    // creada para no dejarla huérfana — sino el próximo intento del
    // mismo email choca con `assertUniqueAffiliateEmail` y bloquea
    // permanentemente al usuario público.
    const inviteResult = await this.auth
      .inviteAffiliate({
        email: dto.email,
        fullName: dto.fullName,
        role: dto.role === 'INFLUENCER' ? 'AFFILIATE_INFLUENCER' : 'AFFILIATE_AMBASSADOR',
        referralCodeId: created.id,
        phone: dto.phone,
        presetPassword: dto.password,
      })
      .catch((err) => {
        this.logger.warn(
          `inviteAffiliate falló para self-register ${dto.email}: ${(err as Error).message}`,
        );
        return null;
      });
    if (!inviteResult) {
      await this.prisma.referralCode
        .delete({ where: { id: created.id } })
        .catch((e) =>
          this.logger.error(
            `Cleanup de ReferralCode ${created.id} falló: ${(e as Error).message}`,
          ),
        );
      throw new BadRequestException(
        'No se pudo crear la cuenta. Intenta de nuevo en unos minutos.',
      );
    }

    const tokens = await this.auth.issueAuthTokensForUserId(
      inviteResult.userId,
      ip ?? null,
    );

    return {
      ...tokens,
      affiliate: {
        codeId: created.id,
        code: created.code,
        slug: created.slug,
        role: dto.role,
        commissionPercent,
      },
    };
  }

  /**
   * Crea un vendedor bajo un embajador. Sólo el SUPER_ADMIN o el dueño
   * del embajador (acting como AFFILIATE con referralCodeId = embajador)
   * pueden crear.
   *
   * Validaciones:
   *  - Embajador debe ser role=AMBASSADOR y tener allowVendors=true.
   *  - Email único global (asertUniqueAffiliateEmail).
   *  - sum(vendoresExistentes.commissionPercent) + nuevo <= max permitido.
   *    El max es embajador.maxCommissionPercent ?? 25.
   *  - commissionPercent > 0 y <= max.
   */
  async createVendor(
    user: AuthUser,
    dto: {
      embajadorCodeId: string;
      fullName: string;
      email: string;
      whatsapp: string;
      commissionPercent: number;
      /** Si viene, se setea como password del User auto-creado en vez de
       *  un email de reset. El embajador la comparte por WhatsApp/SMS. */
      password?: string;
    },
  ) {
    const embajador = await this.prisma.referralCode.findUnique({
      where: { id: dto.embajadorCodeId },
      include: { childVendors: true },
    });
    if (!embajador) throw new NotFoundException('Afiliado no encontrado');
    if (embajador.role !== 'AMBASSADOR' && embajador.role !== 'INFLUENCER') {
      throw new BadRequestException(
        'Solo embajadores o influencers pueden tener vendedores asociados.',
      );
    }
    if (!embajador.allowVendors) {
      throw new BadRequestException(
        'No tenés activado el módulo de vendedores. Activalo desde tu panel de equipo.',
      );
    }

    // Auth: SUPER_ADMIN o el embajador mismo (via affiliate user
    // linkeado a este ReferralCode).
    const isAuthorized =
      user.role === 'SUPER_ADMIN' ||
      (await this.isUserOwnerOfCode(user, embajador.id));
    if (!isAuthorized) throw new ForbiddenException();

    await this.assertUniqueAffiliateEmail(dto.email);

    // CORRECCIÓN LÓGICA 2026-06-05: la validación es INDIVIDUAL — cada
    // vendedor tiene su propia comisión que se aplica SOLO en sus propias
    // ventas, NO se suma entre vendedores.
    // CORRECCIÓN LÓGICA 2026-06-16: el tope NO es un flat 25%, es el % que
    // el embajador/influencer gana él mismo (acotado por maxCommissionPercent
    // si lo seteó más bajo). El vendedor cobra de la tajada del padre — si
    // recibe más de lo que el padre gana, la empresa sobrepaga. Ver
    // effectiveVendorCap.
    const max = this.effectiveVendorCap(embajador);
    if (dto.commissionPercent <= 0) {
      throw new BadRequestException('La comisión debe ser mayor a 0.');
    }
    if (dto.commissionPercent > max) {
      throw new BadRequestException(
        `La comisión del vendedor (${dto.commissionPercent}%) no puede superar la comisión del embajador/influencer (${max}%), porque sale de su propia comisión.`,
      );
    }

    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    const slug = await this.allocateSlug(dto.fullName, code);

    const created = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.whatsapp,
        role: 'VENDOR',
        commissionPercent: dto.commissionPercent,
        whiteLabelId: await this.resolveAffiliateWhiteLabelId({
          user,
          parentWhiteLabelId: embajador.whiteLabelId,
        }),
        parentEmbajadorCodeId: embajador.id,
        isActive: true,
      },
    });

    // Auto-creamos la cuenta AFFILIATE_VENDOR para que el vendedor pueda
    // entrar a /login y ver su panel. Mismo patrón que createVendor del
    // embajador via inviteAffiliate. Si la creación falla (email duplicado
    // que se coló por race, etc), no rompemos — el ReferralCode ya está
    // creado y el admin puede arreglarlo manualmente.
    const presetPassword =
      dto.password?.trim() || this.auth.generateReadablePassword();
    const inviteResult = await this.auth
      .inviteAffiliate({
        email: dto.email,
        fullName: dto.fullName,
        role: 'AFFILIATE_VENDOR',
        referralCodeId: created.id,
        phone: dto.whatsapp,
        presetPassword,
      })
      .catch((err) => {
        this.logger.warn(
          `inviteAffiliate falló para vendor ${dto.email}: ${(err as Error).message}`,
        );
        return null;
      });

    return {
      ...created,
      affiliateCredentials: inviteResult?.password
        ? { email: dto.email, password: inviteResult.password, loginUrl: '/login' }
        : null,
    };
  }

  /** Lista vendedores de un embajador específico. */
  async listVendorsForEmbajador(user: AuthUser, embajadorCodeId: string) {
    const embajador = await this.prisma.referralCode.findUnique({
      where: { id: embajadorCodeId },
      select: {
        id: true,
        role: true,
        maxCommissionPercent: true,
        commissionPercent: true,
      },
    });
    if (!embajador) throw new NotFoundException();
    if (embajador.role !== 'AMBASSADOR' && embajador.role !== 'INFLUENCER') {
      throw new BadRequestException(
        'Solo embajadores o influencers tienen vendedores.',
      );
    }
    const isAuthorized =
      user.role === 'SUPER_ADMIN' ||
      (await this.isUserOwnerOfCode(user, embajador.id));
    if (!isAuthorized) throw new ForbiddenException();

    const vendors = await this.prisma.referralCode.findMany({
      where: { parentEmbajadorCodeId: embajadorCodeId },
      include: {
        _count: { select: { uses: true, receivedCommissions: true } },
      },
      orderBy: [{ isActive: 'desc' }, { ownerName: 'asc' }],
    });
    // CORRECCIÓN LÓGICA 2026-06-16: el tope real es el % propio del padre
    // (acotado por maxCommissionPercent), no un flat 25. Ver effectiveVendorCap.
    const max = this.effectiveVendorCap(embajador);
    // CORRECCIÓN LÓGICA 2026-06-05: ya NO retornamos "available" porque
    // ese concepto era erróneo. Cada vendor tiene su comisión individual
    // que sale del % del embajador en SU venta. No hay "pool" compartido.
    // `vendorCommissionMax` reemplaza el viejo "available" como el tope
    // por vendedor (igual al max del embajador).
    return {
      max,
      vendorCommissionMax: max,
      vendors: vendors.map((v) => ({
        id: v.id,
        code: v.code,
        ownerName: v.ownerName,
        ownerEmail: v.ownerEmail,
        ownerWhatsapp: v.ownerWhatsapp,
        commissionPercent: Number(v.commissionPercent ?? 0),
        isActive: v.isActive,
        createdAt: v.createdAt,
        salesCount: v._count.uses,
        commissionsCount: v._count.receivedCommissions,
      })),
    };
  }

  /** Edita vendedor. */
  async updateVendor(
    user: AuthUser,
    vendorCodeId: string,
    patch: Partial<{
      fullName: string;
      email: string;
      whatsapp: string;
      commissionPercent: number;
    }>,
  ) {
    const vendor = await this.prisma.referralCode.findUnique({
      where: { id: vendorCodeId },
      include: {
        parentEmbajadorCode: { include: { childVendors: true } },
      },
    });
    if (!vendor || vendor.role !== 'VENDOR' || !vendor.parentEmbajadorCode) {
      throw new NotFoundException('Vendedor no encontrado');
    }
    const isAuthorized =
      user.role === 'SUPER_ADMIN' ||
      (await this.isUserOwnerOfCode(user, vendor.parentEmbajadorCode.id));
    if (!isAuthorized) throw new ForbiddenException();

    if (patch.email && patch.email.toLowerCase() !== vendor.ownerEmail.toLowerCase()) {
      await this.assertUniqueAffiliateEmail(patch.email);
    }

    // CORRECCIÓN LÓGICA 2026-06-05: validación INDIVIDUAL del vendor,
    // no suma acumulada. Cada vendedor tiene su propia comisión y se
    // aplica solo en sus propias ventas. Ver createVendor.
    if (typeof patch.commissionPercent === 'number') {
      // CORRECCIÓN LÓGICA 2026-06-16: tope = % propio del padre (acotado
      // por maxCommissionPercent), no un flat 25. Ver effectiveVendorCap.
      const max = this.effectiveVendorCap(vendor.parentEmbajadorCode);
      if (patch.commissionPercent <= 0 || patch.commissionPercent > max) {
        throw new BadRequestException(
          `Comisión inválida. La comisión del vendedor (1-${max}%) no puede superar la comisión del embajador/influencer (${max}%), porque sale de su propia comisión.`,
        );
      }
    }

    const updated = await this.prisma.referralCode.update({
      where: { id: vendor.id },
      data: {
        ownerName: patch.fullName ?? undefined,
        ownerEmail: patch.email ?? undefined,
        ownerWhatsapp: patch.whatsapp ?? undefined,
        commissionPercent:
          patch.commissionPercent !== undefined
            ? patch.commissionPercent
            : undefined,
      },
    });

    // Fase E 2026-06-07: si cambió el %, recalcular comisiones
    // PENDING/APPROVED para que el cambio se refleje inmediato.
    if (
      patch.commissionPercent !== undefined &&
      Number(vendor.commissionPercent ?? 0) !== patch.commissionPercent
    ) {
      await this.audit.log({
        actorId: user.id,
        action: 'vendor.percent.updated',
        resource: `ReferralCode:${vendor.id}`,
        metadata: {
          previousPercent: Number(vendor.commissionPercent ?? 0),
          newPercent: patch.commissionPercent,
        },
      });
      await this.recalc.recalcForRecipientCode({
        recipientCodeId: vendor.id,
        actorId: user.id,
        reason: `Vendedor ${vendor.code} — % actualizado`,
      });
    }
    return updated;
  }

  /** Desactiva vendedor (soft). Sus commissions históricas se mantienen. */
  async deactivateVendor(user: AuthUser, vendorCodeId: string) {
    return this.toggleVendorActive(user, vendorCodeId, false);
  }

  async reactivateVendor(user: AuthUser, vendorCodeId: string) {
    return this.toggleVendorActive(user, vendorCodeId, true);
  }

  private async toggleVendorActive(
    user: AuthUser,
    vendorCodeId: string,
    active: boolean,
  ) {
    const vendor = await this.prisma.referralCode.findUnique({
      where: { id: vendorCodeId },
      include: { parentEmbajadorCode: true },
    });
    if (!vendor || vendor.role !== 'VENDOR' || !vendor.parentEmbajadorCode) {
      throw new NotFoundException('Vendedor no encontrado');
    }
    const isAuthorized =
      user.role === 'SUPER_ADMIN' ||
      (await this.isUserOwnerOfCode(user, vendor.parentEmbajadorCode.id));
    if (!isAuthorized) throw new ForbiddenException();
    // HOTFIX 2026-06-05 (bug #2 CRÍTICO): también flipeamos User.isActive
    // del vendor logueado. Antes solo se tocaba ReferralCode.isActive →
    // el vendor desactivado seguía pudiendo loguear y ver su panel.
    // Tx para que ambos cambios sean atómicos.
    const [updatedCode] = await this.prisma.$transaction([
      this.prisma.referralCode.update({
        where: { id: vendorCodeId },
        data: { isActive: active },
      }),
      ...(vendor.ownerUserId
        ? [
            this.prisma.user.update({
              where: { id: vendor.ownerUserId },
              data: { isActive: active },
            }),
          ]
        : []),
    ]);
    return updatedCode;
  }

  /**
   * Elimina vendedor. Hard delete sólo si NO tiene commissions pendientes.
   * Si tiene, devuelve 409 con mensaje claro y sugerencia de desactivar.
   */
  async deleteVendor(
    user: AuthUser,
    vendorCodeId: string,
    opts: { voidCommissions?: boolean } = {},
  ) {
    const vendor = await this.prisma.referralCode.findUnique({
      where: { id: vendorCodeId },
      include: {
        parentEmbajadorCode: true,
        receivedCommissions: {
          where: { paymentStatus: { in: ['PENDING', 'PARTIAL'] } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!vendor || vendor.role !== 'VENDOR' || !vendor.parentEmbajadorCode) {
      throw new NotFoundException('Vendedor no encontrado');
    }
    const isAuthorized =
      user.role === 'SUPER_ADMIN' ||
      (await this.isUserOwnerOfCode(user, vendor.parentEmbajadorCode.id));
    if (!isAuthorized) throw new ForbiddenException();

    // Modo "anular y eliminar" (vendedor creado por error): anula las
    // comisiones NO pagadas y desactiva el vendedor. Las pagadas se preservan.
    if (opts.voidCommissions === true) {
      const comms = await this.prisma.commission.findMany({
        where: { recipientCodeId: vendorCodeId },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          payoutItem: { select: { id: true } },
        },
      });
      let preservedPaid = 0;
      const voidableIds: string[] = [];
      for (const c of comms) {
        const alreadyPaid =
          c.status === 'PAID' ||
          c.paymentStatus === 'PAID' ||
          c.paymentStatus === 'PARTIAL' ||
          !!c.payoutItem;
        if (alreadyPaid) {
          preservedPaid += 1;
          continue;
        }
        if (c.status === 'REJECTED') continue;
        voidableIds.push(c.id);
      }
      if (voidableIds.length > 0) {
        await this.prisma.commission.updateMany({
          where: { id: { in: voidableIds } },
          data: {
            status: 'REJECTED' as CommissionStatus,
            notes: `Anulada al eliminar vendedor por error (${user.email})`,
          },
        });
      }
      await this.prisma.referralCode.update({
        where: { id: vendorCodeId },
        data: { isActive: false },
      });
      this.logger.log(
        `Force-delete(void) Vendor id=${vendorCodeId} voided=${voidableIds.length} preservedPaid=${preservedPaid} by ${user.email}`,
      );
      return {
        ok: true,
        mode: 'soft' as const,
        voided: voidableIds.length,
        preservedPaid,
      };
    }

    if (vendor.receivedCommissions.length > 0) {
      throw new ConflictException(
        'Este vendedor tiene comisiones pendientes — no se puede eliminar. Puedes desactivarlo en su lugar.',
      );
    }
    // HOTFIX 2026-06-05 (bug #11): si tiene CUALQUIER commission histórica
    // (incluyendo PAID), no borramos hard — la cascade SetNull rompería la
    // auditoría ("¿a quién le pagamos esos $200?"). Forzamos soft-delete
    // vía deactivate. El admin puede limpiar manual con SQL si necesita.
    const anyHistoricCommission = await this.prisma.commission.findFirst({
      where: { recipientCodeId: vendorCodeId },
      select: { id: true },
    });
    if (anyHistoricCommission) {
      throw new ConflictException(
        'Este vendedor tiene comisiones históricas pagadas — no se puede eliminar para preservar el rastro contable. Desactivalo en su lugar.',
      );
    }
    await this.prisma.referralCode.delete({ where: { id: vendorCodeId } });
    return { ok: true };
  }

  /**
   * Helper: chequea si el `user` logueado es el dueño del ReferralCode
   * `codeId`. El link existe via ReferralCode.ownerUserId (set en
   * inviteAffiliate cuando se crea la cuenta affiliate). Usado para los
   * gates "el embajador puede gestionar SUS vendedores".
   */
  private async isUserOwnerOfCode(
    user: AuthUser,
    codeId: string,
  ): Promise<boolean> {
    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { ownerUserId: true },
    });
    return code?.ownerUserId === user.id;
  }

  // ============================================================
  // 3-WAY COMMISSION SPLIT (usado por Hotmart webhook + manual)
  // ============================================================

  /**
   * Resuelve la cadena de atribución para un tenant.
   * Retorna {influencer?, embajador?, vendor?} en base al ReferralUse
   * activo del tenant + parentEmbajadorCodeId si el code es VENDOR.
   *
   * Reglas:
   *  - El tenant tiene N ReferralUse (uno por código que lo refirió).
   *    Tomamos el de status SIGNED_UP/ACTIVE/PAYING más reciente.
   *  - Si el code es role=VENDOR → walking parentEmbajadorCode para
   *    encontrar al embajador, luego embajador.parentCode (si existe)
   *    para encontrar al influencer.
   *  - Si el code es role=AMBASSADOR → embajador directo, sin vendor.
   *    El influencer se resuelve via parentCode.
   *  - Si el code es role=INFLUENCER → solo influencer, sin embajador
   *    ni vendor.
   */
  async getAttributionChain(tenantId: string): Promise<{
    influencer: { id: string; commissionPercent: number } | null;
    embajador: { id: string; commissionPercent: number; maxCommissionPercent: number } | null;
    vendor: { id: string; commissionPercent: number } | null;
    sourceCodeId: string | null;
  }> {
    // PDF 925 (2026-06-27): un negocio puede tener MÁS DE UNA atribución viva
    // (ej. Licores El Amanecer tiene el use del EMBAJADOR Santiago→Juan Y, además,
    // un use del INFLUENCER Juan directo). Tomar la más reciente a secas hacía que
    // a veces ganara el influencer-directo → el arqueo esperaba el % completo del
    // influencer (25%) en vez del 5% indirecto, y el embajador quedaba fuera de la
    // cadena (fantasma). Ahora preferimos el rol que representa al VENDEDOR REAL:
    // VENDOR > AMBASSADOR > INFLUENCER, y a igualdad la más reciente. Así la
    // cadena es la del embajador y el influencer queda como indirecto (5%).
    const uses = await this.prisma.referralUse.findMany({
      where: {
        tenantId,
        status: { in: ['SIGNED_UP', 'ACTIVE', 'PAYING'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        referralCode: {
          include: {
            parentEmbajadorCode: { include: { parentCode: true } },
            parentCode: true,
          },
        },
      },
    });
    const ROLE_RANK: Record<string, number> = {
      VENDOR: 3,
      AMBASSADOR: 2,
      INFLUENCER: 1,
    };
    const use = uses
      .slice()
      .sort((a, b) => {
        const ra = ROLE_RANK[a.referralCode.role] ?? 0;
        const rb = ROLE_RANK[b.referralCode.role] ?? 0;
        if (rb !== ra) return rb - ra;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })[0];
    if (!use) {
      return { influencer: null, embajador: null, vendor: null, sourceCodeId: null };
    }
    const code = use.referralCode;
    const sourceCodeId = code.id;

    if (code.role === 'VENDOR' && code.parentEmbajadorCode) {
      const parent = code.parentEmbajadorCode;
      // 2026-06-16: el vendedor puede colgar de un EMBAJADOR (3 niveles) o
      // directo de un INFLUENCER (2 niveles). En el caso directo, el
      // influencer ocupa el slot "embajador" (el que COMPARTE su % con su
      // vendedor) para que el split le reste el % del vendedor — mismo modelo
      // que embajador→vendedor, sin tocar la matemática del split.
      if (parent.role === 'INFLUENCER') {
        return {
          influencer: null,
          embajador: {
            id: parent.id,
            commissionPercent: Number(parent.commissionPercent ?? 0),
            maxCommissionPercent: parent.maxCommissionPercent
              ? Number(parent.maxCommissionPercent)
              : 25,
          },
          vendor: {
            id: code.id,
            commissionPercent: Number(code.commissionPercent ?? 0),
          },
          sourceCodeId,
        };
      }
      const embajador = parent;
      const influencerSource = embajador.parentCode;
      return {
        influencer: influencerSource
          ? {
              id: influencerSource.id,
              commissionPercent: Number(influencerSource.commissionPercent ?? 0),
            }
          : null,
        embajador: {
          id: embajador.id,
          commissionPercent: Number(embajador.commissionPercent ?? 0),
          maxCommissionPercent: embajador.maxCommissionPercent
            ? Number(embajador.maxCommissionPercent)
            : 25,
        },
        vendor: {
          id: code.id,
          commissionPercent: Number(code.commissionPercent ?? 0),
        },
        sourceCodeId,
      };
    }
    if (code.role === 'AMBASSADOR') {
      const influencerSource = code.parentCode;
      return {
        influencer: influencerSource
          ? {
              id: influencerSource.id,
              commissionPercent: Number(influencerSource.commissionPercent ?? 0),
            }
          : null,
        embajador: {
          id: code.id,
          commissionPercent: Number(code.commissionPercent ?? 0),
          maxCommissionPercent: code.maxCommissionPercent
            ? Number(code.maxCommissionPercent)
            : 25,
        },
        vendor: null,
        sourceCodeId,
      };
    }
    // INFLUENCER directo
    return {
      influencer: {
        id: code.id,
        commissionPercent: Number(code.commissionPercent ?? 0),
      },
      embajador: null,
      vendor: null,
      sourceCodeId,
    };
  }

  /**
   * Delega al helper compartido en CommissionExceptionsService.
   * Antes vivía duplicado entre referrals + hotmart — riesgo de drift.
   */
  private resolveExceptionPercent(
    tenantId: string,
    recipientCodeId: string,
    fallbackPercent: number,
  ): Promise<number> {
    return this.commissionExceptions.resolvePercent(
      tenantId,
      recipientCodeId,
      fallbackPercent,
    );
  }

  /**
   * % indirecto del influencer (Setting `referrals.indirectPercent`, default 5).
   * Es lo que cobra el influencer cuando la venta NO la hizo él directo sino
   * un EMBAJADOR (o un vendedor bajo su embajador). Fuente única para que el
   * arqueo y la generación real coincidan (PDF 752 #3).
   */
  private async resolveIndirectPercent(): Promise<number> {
    const row = await this.prisma.setting.findUnique({
      where: { key: 'referrals.indirectPercent' },
    });
    const n = row?.value != null ? Number(row.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }

  /**
   * Genera las commission rows para un pago efectivo de un tenant.
   * 3-way split: hasta 3 rows (influencer / embajador / vendor). Si la
   * chain no tiene alguna persona, se omite esa row.
   *
   * Idempotencia: si ya existen commissions con el mismo
   * hotmartTransactionId + recipientCodeId, no las recrea (silent skip).
   *
   * La regla del embajador-vendor: cuando hay vendor, el embajador recibe
   * SU porcentaje MENOS el del vendor. Vendor recibe SU porcentaje
   * completo. Total pagado a la chain = embajador.commissionPercent
   * (vendor sale de ahí, no adicional).
   *
   * Si NO hay atribución para el tenant, retorna [] silencioso.
   */
  /**
   * #11 (2026-06-16): FUENTE ÚNICA del split de comisiones. Devuelve las filas
   * esperadas (influencer / embajador − vendedor / vendedor) para un tenant y
   * un monto base, aplicando las excepciones por-tenant y clampeando el vendor
   * al slice del embajador. La usan TANTO la generación real
   * (generateCommissionsForPayment) COMO la auditoría (auditCommissions), para
   * que el "esperado" nunca se desincronice del cálculo en vivo.
   */
  private async computeExpectedCommissionRows(
    tenantId: string,
    amount: number,
  ) {
    const chain = await this.getAttributionChain(tenantId);
    const rows: Array<{
      recipientCodeId: string;
      vendorCodeId: string | null;
      amount: number;
      appliedPercent: number;
    }> = [];
    // Modo de reparto del negocio (Fase 3). Default histórico = descuento del
    // upline. Se devuelve para congelarlo (snapshot) en cada comisión.
    const tRow = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { commissionDistributionMode: true },
    });
    const mode = tRow?.commissionDistributionMode ?? 'DISCOUNT_FROM_INFLUENCER';
    if (!chain.sourceCodeId) return { chain, rows, mode };

    // Cada nivel puede tener su propia excepción por tenant. Si no hay, cae al
    // % normal del ReferralCode (que vino en `chain`).
    //
    // PDF 752 #3 (2026-06-26): el influencer cobra su % COMPLETO solo cuando la
    // venta la hizo ÉL directo (su code === source de la venta). Si la venta
    // entró por un EMBAJADOR (o un vendedor bajo su embajador), el influencer es
    // INDIRECTO → cobra `referrals.indirectPercent` (5%), no su 10%. Antes el
    // arqueo aplicaba el % completo siempre → "esperaba 10%" en ventas de
    // embajador y marcaba como mal la comisión correcta al 5% (caso Juan Camilo
    // / MOTILART). La excepción por-tenant, si existe, sigue teniendo prioridad.
    const influencerIsIndirect =
      !!chain.influencer && chain.influencer.id !== chain.sourceCodeId;
    const influencerFallbackPct = influencerIsIndirect
      ? await this.resolveIndirectPercent()
      : chain.influencer?.commissionPercent ?? 0;
    const influencerPct = chain.influencer
      ? await this.resolveExceptionPercent(
          tenantId,
          chain.influencer.id,
          influencerFallbackPct,
        )
      : 0;
    const embajadorPct = chain.embajador
      ? await this.resolveExceptionPercent(
          tenantId,
          chain.embajador.id,
          chain.embajador.commissionPercent,
        )
      : 0;
    const vendorPctRaw = chain.vendor
      ? await this.resolveExceptionPercent(
          tenantId,
          chain.vendor.id,
          chain.vendor.commissionPercent,
        )
      : 0;

    const additional = mode === 'ADDITIONAL_COMPANY_COMMISSION';
    // DISCOUNT (default): el % del vendedor SALE de la tajada del embajador →
    // NUNCA puede excederla (clamp 2026-06-16) y el embajador recibe su % MENOS
    // el del vendedor. Total a la chain = % del embajador (no sube el costo).
    // ADDITIONAL: el vendedor es un costo ADICIONAL de la empresa → el embajador
    // conserva su % completo y el vendedor cobra su % aparte (sube el total).
    const vendorPct =
      chain.embajador && !additional
        ? Math.min(vendorPctRaw, embajadorPct)
        : vendorPctRaw;

    if (chain.influencer && influencerPct > 0) {
      rows.push({
        recipientCodeId: chain.influencer.id,
        vendorCodeId: null,
        amount: Math.round(amount * influencerPct) / 100,
        appliedPercent: influencerPct,
      });
    }
    if (chain.embajador) {
      const embajadorEffectivePct = additional
        ? embajadorPct
        : Math.max(0, embajadorPct - vendorPct);
      if (embajadorEffectivePct > 0) {
        rows.push({
          recipientCodeId: chain.embajador.id,
          vendorCodeId: null,
          amount: Math.round(amount * embajadorEffectivePct) / 100,
          appliedPercent: embajadorEffectivePct,
        });
      }
    }
    if (chain.vendor && vendorPct > 0) {
      rows.push({
        recipientCodeId: chain.vendor.id,
        vendorCodeId: chain.vendor.id,
        amount: Math.round(amount * vendorPct) / 100,
        appliedPercent: vendorPct,
      });
    }
    return { chain, rows, mode };
  }

  /**
   * Recalcula las comisiones PENDING/APPROVED de un negocio aplicando el SPLIT
   * actual (respeta el commissionDistributionMode + excepciones), usando la
   * fuente única computeExpectedCommissionRows. Las PAGADAS NO se tocan
   * (histórico). Se dispara al cambiar el modo de reparto del negocio para que
   * las comisiones aún no pagadas reflejen el nuevo reparto.
   */
  async recalcTenantSplit(
    tenantId: string,
    actorId?: string | null,
    reason?: string,
  ): Promise<{ updated: number }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { subscriptionPriceUsd: true, planPeriodicity: true },
    });
    if (!tenant) return { updated: 0 };
    const base = await this.recalc.getCommissionBase(
      tenant.subscriptionPriceUsd,
      tenant.planPeriodicity ?? '',
    );
    if (base <= 0) return { updated: 0 };

    const { rows, mode } = await this.computeExpectedCommissionRows(tenantId, base);
    const expected = new Map(rows.map((r) => [r.recipientCodeId, r]));

    const comms = await this.prisma.commission.findMany({
      where: {
        referralUse: { tenantId },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      select: {
        id: true,
        amount: true,
        recipientCodeId: true,
        referralUse: { select: { referralCodeId: true } },
      },
    });

    let updated = 0;
    for (const c of comms) {
      const rid = c.recipientCodeId ?? c.referralUse?.referralCodeId ?? null;
      if (!rid) continue;
      const exp = expected.get(rid);
      if (!exp) continue; // recipient fuera de la cadena actual → no tocar
      const newAmount = exp.amount;
      if (Number(c.amount) === newAmount && c.recipientCodeId === rid) continue;
      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          amount: newAmount,
          recipientCodeId: rid,
          distributionMode: mode,
          appliedPercent: exp.appliedPercent,
        },
      });
      updated += 1;
      await this.audit
        .log({
          actorId: actorId ?? null,
          tenantId,
          action: 'commission.recalculated',
          resource: `Commission:${c.id}`,
          metadata: {
            reason: reason ?? 'distribution_mode_change',
            recipientCodeId: rid,
            newAmount,
            mode,
          },
        })
        .catch(() => null);
    }
    if (updated > 0) {
      this.logger.log(
        `recalcTenantSplit tenant=${tenantId} mode=${mode} → ${updated} comisiones actualizadas`,
      );
    }
    return { updated };
  }

  async generateCommissionsForPayment(args: {
    tenantId: string;
    paymentAmountUsd: number;
    hotmartTransactionId?: string | null;
  }): Promise<{ generated: number; skipped: number }> {
    const { chain, rows, mode } = await this.computeExpectedCommissionRows(
      args.tenantId,
      args.paymentAmountUsd,
    );
    if (!chain.sourceCodeId) return { generated: 0, skipped: 0 };

    // El ReferralUse que vamos a usar como FK del Commission. Tomamos el
    // más reciente del tenant para el código fuente.
    const use = await this.prisma.referralUse.findFirst({
      where: { tenantId: args.tenantId, referralCodeId: chain.sourceCodeId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!use) return { generated: 0, skipped: 0 };

    // P3 2026-07-02: la comisión se desbloquea 15 días DESPUÉS del pago real en
    // Hotmart (Tenant.lastChargeAt), no desde su createdAt. En el flujo webhook
    // lastChargeAt ya quedó seteado a la fecha del cobro justo antes de esto.
    const tPay = await this.prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { lastChargeAt: true },
    });
    const availableAt = new Date(
      (tPay?.lastChargeAt ?? new Date()).getTime() + COMMISSION_HOLD_DAYS * 86400000,
    );

    const txId = args.hotmartTransactionId ?? null;

    let generated = 0;
    let skipped = 0;

    // HOTFIX 2026-06-05 (bug #20): wrap en $transaction para que las
    // 3 creates (influencer + embajador + vendor) sean atómicas. Antes,
    // si fallaba a mitad, una segunda invocación con el mismo tx solo
    // dedupeaba las creadas y creaba las faltantes — pero la chain
    // pudo haber cambiado entre invocaciones (% diferentes) → state
    // inconsistente con plata mal calculada. Atómico = todo o nada.
    const periodKey = monthKey();
    try {
      const counts = await this.prisma.$transaction(async (tx) => {
        let g = 0;
        let s = 0;
        for (const row of rows) {
          if (txId) {
            const existing = await tx.commission.findFirst({
              where: {
                hotmartTransactionId: txId,
                recipientCodeId: row.recipientCodeId,
              },
              select: { id: true },
            });
            if (existing) {
              s++;
              continue;
            }
          }
          try {
            await tx.commission.create({
              data: {
                referralUseId: use.id,
                amount: row.amount,
                status: 'PENDING',
                paymentStatus: 'PENDING',
                amountPaid: 0,
                recipientCodeId: row.recipientCodeId,
                vendorCodeId: row.vendorCodeId,
                hotmartTransactionId: txId,
                externalTxId: txId,
                periodKey,
                availableAt,
                // Snapshot contable congelado (Fase 4).
                distributionMode: mode,
                baseAmountUsd: args.paymentAmountUsd,
                appliedPercent: row.appliedPercent,
              },
            });
            g++;
          } catch (e: any) {
            if (e?.code === 'P2002') {
              // UNIQUE(referralUseId, recipientCodeId, periodKey) hit —
              // ya existe esa commission para este mes. Skip silente.
              s++;
              continue;
            }
            throw e;
          }
        }
        return { generated: g, skipped: s };
      });
      generated = counts.generated;
      skipped = counts.skipped;
    } catch (e: any) {
      this.logger.warn(
        `generateCommissionsForPayment falló: ${e?.message}. Sin estado parcial creado.`,
      );
    }
    return { generated, skipped };
  }

  /**
   * Punto 2 (2026-07-01): genera la comisión de un GRUPO EMPRESARIAL cuando entra
   * su cobro recurrente. UNA comisión por el BRUTO del grupo (precio canónico de
   * su periodicidad) al recipiente elegido = %_de_su_código × bruto. Misma regla
   * única del Punto 1. Idempotente por (grupo, recipiente, período) o txId.
   */
  async generateGroupCommission(args: {
    groupId: string;
    hotmartTransactionId?: string | null;
  }): Promise<{ generated: boolean; reason?: string }> {
    const group = await this.prisma.businessGroup.findUnique({
      where: { id: args.groupId },
      select: { id: true, name: true, referralCodeId: true, planPeriodicity: true, priceUsd: true, lastChargeAt: true },
    });
    if (!group?.referralCodeId) return { generated: false, reason: 'grupo-sin-recipiente' };
    const code = await this.prisma.referralCode.findUnique({
      where: { id: group.referralCodeId },
      select: { id: true, commissionPercent: true, isActive: true },
    });
    if (!code || code.isActive === false) return { generated: false, reason: 'code-inactivo' };
    // BRUTO = precio REAL del grupo (priceUsd, ej: 3×$50=$150) si está seteado;
    // sino cae al canónico de la periodicidad.
    const base =
      group.priceUsd != null && Number(group.priceUsd) > 0
        ? Number(group.priceUsd)
        : await this.recalc.getCommissionBase(null, group.planPeriodicity ?? null);
    const pct = Number(code.commissionPercent ?? 0);
    if (!(base > 0) || !(pct > 0)) return { generated: false, reason: 'base-o-pct-0' };
    const amount = Math.round(base * pct) / 100;
    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    // Dedup: 1 por (grupo, recipiente, período) o por txId repetido.
    const existing = await this.prisma.commission.findFirst({
      where: {
        businessGroupId: group.id,
        recipientCodeId: code.id,
        OR: [
          { periodKey },
          ...(args.hotmartTransactionId
            ? [{ hotmartTransactionId: args.hotmartTransactionId }]
            : []),
        ],
      },
      select: { id: true },
    });
    if (existing) return { generated: false, reason: 'dedup' };
    await this.prisma.commission.create({
      data: {
        businessGroupId: group.id,
        referralUseId: null,
        recipientCodeId: code.id,
        amount,
        baseAmountUsd: base,
        appliedPercent: pct,
        currency: 'USD',
        status: 'PENDING',
        periodKey,
        // P3 2026-07-02: desbloqueo 15d después del cobro del grupo en Hotmart.
        availableAt: new Date(
          (group.lastChargeAt ?? now).getTime() + COMMISSION_HOLD_DAYS * 86400000,
        ),
        hotmartTransactionId: args.hotmartTransactionId ?? null,
      },
    });
    this.logger.log(
      `Comisión de grupo "${group.name}": $${amount} (${pct}% de $${base}) → code ${code.id}`,
    );
    return { generated: true };
  }

  /**
   * #11 (2026-06-16): AUDITORÍA AVANZADA de comisiones (read-only). Recalcula
   * el split esperado DESDE LA FUENTE ORIGINAL (computeExpectedCommissionRows +
   * getCommissionBase, los mismos que usa el webhook de Hotmart) y lo compara
   * contra las comisiones vivas (PENDING/APPROVED). Cubre influencers,
   * embajadores y vendedores, y detecta:
   *   - WRONG_AMOUNT : monto ≠ base × % esperado (incluye el slice del vendedor
   *                    y la tajada reducida del embajador, que la auditoría
   *                    vieja marcaba como falso positivo)
   *   - DUPLICATE    : >1 fila viva con mismo recipient + periodo
   *   - PHANTOM      : recipiente que ya no está en la cadena de atribución,
   *                    code inactivo, o tenant borrado (comisión fantasma)
   * No modifica nada — devuelve hallazgos para revisión/acción manual.
   */
  async auditCommissions(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const TOL = 0.01;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    // SOCIO se genera aparte (10% global): lo incluimos como "esperado" para
    // no marcarlo como fantasma.
    const socioRow = await this.prisma.setting.findUnique({
      where: { key: 'referrals.socioCodeId' },
    });
    const socioCodeId = socioRow?.value || null;
    let socioPct: number = COMMISSION_DEFAULTS.socioPct;
    if (socioCodeId) {
      const s = await this.prisma.referralCode.findUnique({
        where: { id: socioCodeId },
        select: { commissionPercent: true },
      });
      if (s) {
        socioPct = Number(s.commissionPercent ?? COMMISSION_DEFAULTS.socioPct);
      }
    }

    // PDF 752 #2 (2026-06-26): arqueo COMPLETO. Antes solo {PENDING,APPROVED}
    // ("vivas") → dejaba fuera PAGADAS, BLOQUEADAS y RETENIDAS, mostrando solo
    // unas pocas. Ahora recorre el 100% de las comisiones reales SIN importar
    // estado (PENDING=bloqueada, APPROVED=disponible, PAID=pagada, RETAINED=
    // retenida). Excluimos REJECTED (cancelada/anulada, nunca suma) y ADJUSTMENT
    // (asiento negativo de clawback, no es una comisión a validar contra base×%).
    const live = await this.prisma.commission.findMany({
      where: {
        status: { in: ['PENDING', 'APPROVED', 'PAID', 'RETAINED'] },
        // Punto 2: las comisiones de GRUPO no son por-tenant → se excluyen de
        // este arqueo (sino saldrían como PHANTOM "sin-tenant").
        businessGroupId: null,
        ...(user.whiteLabelId
          ? { referralUse: { tenant: { whiteLabelId: user.whiteLabelId } } }
          : {}),
      },
      select: {
        id: true,
        amount: true,
        baseAmountUsd: true,
        status: true,
        periodKey: true,
        recipientCodeId: true,
        createdAt: true,
        recipientCode: {
          select: { ownerName: true, role: true, isActive: true },
        },
        referralUse: {
          select: {
            referralCodeId: true,
            tenant: {
              select: {
                id: true,
                brandName: true,
                deletedAt: true,
                planPeriodicity: true,
                subscriptionPriceUsd: true,
              },
            },
          },
        },
      },
    });

    type Finding = {
      type: 'WRONG_AMOUNT' | 'DUPLICATE' | 'PHANTOM';
      reason?: string;
      tenant: string | null;
      recipient: string;
      role: string | null;
      status?: string;
      periodKey: string | null;
      actual: number;
      expected?: number;
      commissionId: string;
    };
    const findings: Finding[] = [];
    const push = (f: Finding) => findings.push(f);

    // Agrupar comisiones vivas por tenant para una sola pasada de cálculo.
    const byTenant = new Map<string, typeof live>();
    for (const c of live) {
      const tid = c.referralUse?.tenant?.id;
      if (!tid) {
        push({
          type: 'PHANTOM',
          reason: 'sin-tenant',
          tenant: null,
          recipient: c.recipientCode?.ownerName ?? '(?)',
          role: c.recipientCode?.role ?? null,
          periodKey: c.periodKey,
          actual: Number(c.amount),
          commissionId: c.id,
        });
        continue;
      }
      const arr = byTenant.get(tid) ?? [];
      arr.push(c);
      byTenant.set(tid, arr);
    }

    for (const [tid, rows] of byTenant) {
      const t = rows[0].referralUse!.tenant!;
      if (t.deletedAt) {
        for (const c of rows) {
          push({
            type: 'PHANTOM',
            reason: 'tenant-borrado',
            tenant: t.brandName,
            recipient: c.recipientCode?.ownerName ?? '(?)',
            role: c.recipientCode?.role ?? null,
            periodKey: c.periodKey,
            actual: Number(c.amount),
            commissionId: c.id,
          });
        }
        continue;
      }
      // PDF 2026-06-30: la base ESPERADA es el MONTO BRUTO REAL de la compra,
      // congelado en cada comisión (baseAmountUsd). NO recalcular desde el
      // subscriptionPriceUsd actual del negocio, que puede haber quedado en NETO
      // (ej. Valmont $148.6 → esperaba $14.86) o haber cambiado. Fallback al
      // precio real/canónico solo para filas legacy sin baseAmountUsd.
      const snapBases = rows
        .map((c) => Number(c.baseAmountUsd))
        .filter((v) => Number.isFinite(v) && v > 0);
      const base = snapBases.length
        ? Math.max(...snapBases)
        : await this.recalc.getCommissionBase(
            t.subscriptionPriceUsd ?? null,
            t.planPeriodicity,
          );
      const { rows: expRows } = await this.computeExpectedCommissionRows(
        tid,
        base,
      );
      const expected = new Map<string, number>();
      for (const er of expRows) expected.set(er.recipientCodeId, er.amount);
      if (socioCodeId && base > 0) {
        expected.set(socioCodeId, r2((base * socioPct) / 100));
      }

      const seen = new Set<string>();
      for (const c of rows) {
        const key = `${c.recipientCodeId ?? 'null'}|${c.periodKey ?? 'null'}`;
        if (seen.has(key)) {
          push({
            type: 'DUPLICATE',
            tenant: t.brandName,
            recipient: c.recipientCode?.ownerName ?? '(?)',
            role: c.recipientCode?.role ?? null,
            periodKey: c.periodKey,
            actual: Number(c.amount),
            commissionId: c.id,
          });
          continue;
        }
        seen.add(key);

        if (c.recipientCode?.isActive === false) {
          push({
            type: 'PHANTOM',
            reason: 'code-inactivo',
            tenant: t.brandName,
            recipient: c.recipientCode?.ownerName ?? '(?)',
            role: c.recipientCode?.role ?? null,
            periodKey: c.periodKey,
            actual: Number(c.amount),
            commissionId: c.id,
          });
          continue;
        }
        const exp = c.recipientCodeId
          ? expected.get(c.recipientCodeId)
          : undefined;
        if (exp === undefined) {
          push({
            type: 'PHANTOM',
            reason: 'fuera-de-cadena',
            tenant: t.brandName,
            recipient: c.recipientCode?.ownerName ?? '(?)',
            role: c.recipientCode?.role ?? null,
            periodKey: c.periodKey,
            actual: Number(c.amount),
            commissionId: c.id,
          });
        } else if (Math.abs(Number(c.amount) - exp) > TOL) {
          push({
            type: 'WRONG_AMOUNT',
            tenant: t.brandName,
            recipient: c.recipientCode?.ownerName ?? '(?)',
            role: c.recipientCode?.role ?? null,
            status: c.status,
            periodKey: c.periodKey,
            actual: Number(c.amount),
            expected: exp,
            commissionId: c.id,
          });
        }
      }
    }

    const summary = {
      auditedTenants: byTenant.size,
      liveCommissions: live.length,
      wrongAmount: findings.filter((f) => f.type === 'WRONG_AMOUNT').length,
      duplicates: findings.filter((f) => f.type === 'DUPLICATE').length,
      phantom: findings.filter((f) => f.type === 'PHANTOM').length,
      deltaUsd: r2(
        findings
          .filter((f) => f.type === 'WRONG_AMOUNT')
          .reduce((s, f) => s + (f.actual - (f.expected ?? 0)), 0),
      ),
    };
    return { summary, findings };
  }

  /**
   * PDF 752 #2.2 (2026-06-26): corrige UNA comisión al monto ESPERADO del arqueo.
   * Acción individual y explícita por fila (nunca automática). Recalcula
   * base × % correcto con la MISMA fuente que el arqueo
   * (computeExpectedCommissionRows → incluye la regla 5% influencer-vía-embajador
   * y el corte del socio) y actualiza el `amount`. Si la comisión ya estaba
   * PAGADA, alinea también `amountPaid` (invariante de pago). Audita el cambio.
   * NUNCA toca REJECTED/ADJUSTMENT ni comisiones fantasma (sin tenant/recipiente
   * o fuera de la cadena) — esas se revisan a mano.
   */
  async recalcCommissionToExpected(user: AuthUser, commissionId: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const c = await this.prisma.commission.findUnique({
      where: { id: commissionId },
      select: {
        id: true,
        amount: true,
        amountPaid: true,
        baseAmountUsd: true,
        status: true,
        recipientCodeId: true,
        referralUse: {
          select: {
            tenant: {
              select: {
                id: true,
                brandName: true,
                whiteLabelId: true,
                planPeriodicity: true,
                subscriptionPriceUsd: true,
              },
            },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Comisión no encontrada');
    // Aislamiento por marca (igual que el arqueo).
    if (
      user.whiteLabelId &&
      c.referralUse?.tenant?.whiteLabelId !== user.whiteLabelId
    ) {
      throw new ForbiddenException('Esta comisión no pertenece a tu marca.');
    }
    if (c.status === 'REJECTED' || c.status === 'ADJUSTMENT') {
      throw new BadRequestException(
        'Las comisiones canceladas o de ajuste no se recalculan.',
      );
    }
    const tenant = c.referralUse?.tenant;
    if (!tenant) {
      throw new BadRequestException(
        'La comisión no tiene negocio asociado (fantasma): revísala manualmente.',
      );
    }
    if (!c.recipientCodeId) {
      throw new BadRequestException(
        'La comisión no tiene destinatario: revísala manualmente.',
      );
    }
    // PDF 2026-06-30: usar el MONTO BRUTO congelado de esta comisión
    // (baseAmountUsd) — misma regla que el arqueo. Nunca el subscriptionPriceUsd
    // actual (puede ser neto/haber cambiado). Fallback canónico solo si falta.
    const base =
      c.baseAmountUsd != null && Number(c.baseAmountUsd) > 0
        ? Number(c.baseAmountUsd)
        : await this.recalc.getCommissionBase(
            tenant.subscriptionPriceUsd ?? null,
            tenant.planPeriodicity,
          );
    const { rows } = await this.computeExpectedCommissionRows(tenant.id, base);
    const expectedMap = new Map<string, number>();
    for (const r of rows) expectedMap.set(r.recipientCodeId, r.amount);
    // SOCIO (10% global) — mismo "esperado" que el arqueo.
    const socioRow = await this.prisma.setting.findUnique({
      where: { key: 'referrals.socioCodeId' },
    });
    const socioCodeId = socioRow?.value || null;
    if (socioCodeId && base > 0) {
      let socioPct: number = COMMISSION_DEFAULTS.socioPct;
      const s = await this.prisma.referralCode.findUnique({
        where: { id: socioCodeId },
        select: { commissionPercent: true },
      });
      if (s) socioPct = Number(s.commissionPercent ?? COMMISSION_DEFAULTS.socioPct);
      expectedMap.set(socioCodeId, Math.round(base * socioPct) / 100);
    }
    const expected = expectedMap.get(c.recipientCodeId);
    if (expected === undefined) {
      throw new BadRequestException(
        'Esta comisión no corresponde a la cadena de atribución actual (fantasma). Revísala manualmente.',
      );
    }
    const previousAmount = Number(c.amount);
    // PDF 2026-06-30: "Actualizar" NUNCA degrada un valor ya correcto. Si el
    // monto actual ya coincide con el esperado (regla base × %), no tocamos nada.
    if (Math.abs(previousAmount - expected) <= 0.01) {
      return {
        ok: true as const,
        unchanged: true as const,
        brandName: tenant.brandName,
        amount: previousAmount,
        expected,
        base,
      };
    }
    const data: { amount: number; amountPaid?: number } = { amount: expected };
    // Invariante de pago: si ya estaba pagada, el amountPaid debe seguir = amount.
    if (c.status === 'PAID') data.amountPaid = expected;
    await this.prisma.commission.update({ where: { id: c.id }, data });

    await this.audit.log({
      actorId: user.id,
      tenantId: tenant.id,
      action: 'commission.recalc_to_expected',
      resource: `commission:${c.id}`,
      metadata: {
        brandName: tenant.brandName,
        base,
        previousAmount,
        newAmount: expected,
        status: c.status,
      },
    });

    return {
      ok: true,
      commissionId: c.id,
      previousAmount,
      newAmount: expected,
      base,
    };
  }

  /**
   * #5 (2026-06-16): IMPLEMENTACIÓN PAGADA. Genera comisiones sobre un monto
   * libre (lo que el negocio pagó por la implementación, ej $100/$200/$500/
   * $1000) usando EXACTAMENTE el mismo split que una venta normal
   * (influencer / embajador − vendedor / vendedor, con excepciones por
   * tenant). NO es recurrente: es un cargo único. Usa un periodKey único
   * `IMPL-...` para no colisionar con la comisión de suscripción del mes ni
   * deduplicarse contra ella, y para permitir varias implementaciones.
   */
  async generateImplementationCommission(
    user: AuthUser,
    tenantId: string,
    amountUsd: number,
  ): Promise<{ generated: number; total: number }> {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('El valor de implementación debe ser > 0');
    }

    const chain = await this.getAttributionChain(tenantId);
    if (!chain.sourceCodeId) {
      throw new BadRequestException(
        'Este negocio no tiene un afiliado asignado — asigná influencer/embajador antes de generar la implementación.',
      );
    }
    const use = await this.prisma.referralUse.findFirst({
      where: { tenantId, referralCodeId: chain.sourceCodeId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!use) {
      throw new BadRequestException('No se encontró el referralUse del negocio.');
    }

    // Mismo cálculo de % efectivo (con excepciones) que el split de ventas.
    const influencerPct = chain.influencer
      ? await this.resolveExceptionPercent(
          tenantId,
          chain.influencer.id,
          chain.influencer.commissionPercent,
        )
      : 0;
    const embajadorPct = chain.embajador
      ? await this.resolveExceptionPercent(
          tenantId,
          chain.embajador.id,
          chain.embajador.commissionPercent,
        )
      : 0;
    const vendorPctRaw = chain.vendor
      ? await this.resolveExceptionPercent(
          tenantId,
          chain.vendor.id,
          chain.vendor.commissionPercent,
        )
      : 0;
    // #8 (review): el vendor no puede exceder el slice del embajador.
    const vendorPct = chain.embajador
      ? Math.min(vendorPctRaw, embajadorPct)
      : vendorPctRaw;

    const rows: Array<{ recipientCodeId: string; vendorCodeId: string | null; amount: number }> = [];
    if (chain.influencer && influencerPct > 0) {
      rows.push({
        recipientCodeId: chain.influencer.id,
        vendorCodeId: null,
        amount: Math.round(amount * influencerPct) / 100,
      });
    }
    if (chain.embajador) {
      const embajadorEffectivePct = Math.max(0, embajadorPct - vendorPct);
      if (embajadorEffectivePct > 0) {
        rows.push({
          recipientCodeId: chain.embajador.id,
          vendorCodeId: null,
          amount: Math.round(amount * embajadorEffectivePct) / 100,
        });
      }
    }
    if (chain.vendor && vendorPct > 0) {
      rows.push({
        recipientCodeId: chain.vendor.id,
        vendorCodeId: chain.vendor.id,
        amount: Math.round(amount * vendorPct) / 100,
      });
    }

    // periodKey único por implementación (no se deduplica con la suscripción
    // ni entre implementaciones distintas).
    const periodKey = `IMPL-${monthKey()}-${Date.now().toString(36)}`;
    const externalTxId = `impl:${tenantId}:${Date.now()}`;
    let generated = 0;
    let total = 0;
    // Socio de plataforma: 10% sobre TODA venta (modelo contable), incluida
    // la implementación pagada. Resolvemos el code SOCIO (Setting
    // referrals.socioCodeId) y le creamos su comisión con el MISMO periodKey
    // IMPL-... (sin el dedup de 25d del webhook → cada implementación lo
    // genera). Sobre su propio ReferralUse del tenant (lo creamos si falta).
    const socioRow = await this.prisma.setting.findUnique({
      where: { key: 'referrals.socioCodeId' },
    });
    let socioCode: { id: string; commissionPercent: unknown } | null = null;
    if (socioRow?.value) {
      const s = await this.prisma.referralCode.findUnique({
        where: { id: socioRow.value },
        select: { id: true, role: true, isActive: true, commissionPercent: true },
      });
      if (s && s.role === 'SOCIO' && s.isActive) {
        socioCode = { id: s.id, commissionPercent: s.commissionPercent };
      }
    }
    let socioUseId: string | null = null;
    if (socioCode) {
      const socioUse =
        (await this.prisma.referralUse.findFirst({
          where: { referralCodeId: socioCode.id, tenantId },
          select: { id: true },
        })) ??
        (await this.prisma.referralUse.create({
          data: {
            referralCodeId: socioCode.id,
            tenantId,
            status: 'PAYING',
            convertedAt: new Date(),
          },
          select: { id: true },
        }));
      socioUseId = socioUse.id;
    }

    let socioGenerated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.commission.create({
          data: {
            referralUseId: use.id,
            amount: row.amount,
            status: 'PENDING',
            paymentStatus: 'PENDING',
            amountPaid: 0,
            recipientCodeId: row.recipientCodeId,
            vendorCodeId: row.vendorCodeId,
            externalTxId,
            periodKey,
            notes: `Implementación pagada · base $${amount.toFixed(2)}`,
          },
        });
        generated++;
        total += row.amount;
      }
      if (socioCode && socioUseId) {
        const socioPct = Number(socioCode.commissionPercent ?? COMMISSION_DEFAULTS.socioPct);
        const socioAmount = Math.round(amount * socioPct) / 100;
        if (socioAmount > 0) {
          await tx.commission.create({
            data: {
              referralUseId: socioUseId,
              amount: socioAmount,
              status: 'PENDING',
              paymentStatus: 'PENDING',
              amountPaid: 0,
              recipientCodeId: socioCode.id,
              externalTxId,
              periodKey,
              notes: `Implementación pagada (socio) · base $${amount.toFixed(2)}`,
            },
          });
          socioGenerated = 1;
          total += socioAmount;
        }
      }
    });
    generated += socioGenerated;

    this.audit.log({
      actorId: user.id,
      tenantId,
      action: 'commission.implementation_generated',
      resource: `tenant:${tenantId}`,
      metadata: { amountUsd: amount, rows: generated, totalCommissionUsd: total },
    });

    return { generated, total: Math.round(total * 100) / 100 };
  }

  // ============================================================
  // ADMIN COMMISSIONS PANEL — FASE B2
  // ============================================================

  /**
   * Listado avanzado de commissions para el panel /admin/commissions.
   * Soporta filtros por fecha, estado de pago, rol del recipient,
   * tenant y código recipient. Incluye agregados totales para los KPIs
   * (Total, Pendiente, Pagado).
   *
   * Por cada commission devolvemos:
   * - Datos de la commission (amount, amountPaid, paymentStatus, etc.)
   * - Datos del tenant (brandName, planPeriodicity, currentPeriodEnd)
   * - Datos del recipient (ownerName, code, role)
   *
   * Para la columna "comisión influencer/embajador/vendedor" agrupamos
   * por transactionId del lado del consumidor (frontend) — esta API
   * devuelve un row por persona/commission y el frontend decide cómo
   * presentar el 3-way split.
   */
  async listAdminCommissions(
    user: AuthUser,
    opts: {
      dateFrom?: string;
      dateTo?: string;
      status?: 'PENDING' | 'PARTIAL' | 'PAID';
      // Bucket del CICLO DE VIDA de la comisión (≠ estado de pago):
      //  pending_approval = en hold (PENDING) · available = disponible para
      //  pagar a los 30d (APPROVED) · paid = PAID · rejected = anulada.
      bucket?: 'pending_approval' | 'available' | 'paid' | 'rejected';
      role?: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR' | 'SOCIO';
      tenantId?: string;
      codeId?: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    // Filtros base (fecha / rol / negocio / código), SIN estado — se
    // reutilizan para el desglose por bucket (los KPIs muestran los 4
    // buckets sin importar cuál esté seleccionado en el filtro).
    const baseWhere: any = {};
    if (opts.dateFrom || opts.dateTo) {
      baseWhere.createdAt = {};
      if (opts.dateFrom) baseWhere.createdAt.gte = new Date(opts.dateFrom);
      if (opts.dateTo) baseWhere.createdAt.lte = new Date(opts.dateTo);
    }
    if (opts.codeId) baseWhere.recipientCodeId = opts.codeId;
    if (opts.tenantId) baseWhere.referralUse = { tenantId: opts.tenantId };
    if (opts.role) baseWhere.recipientCode = { role: opts.role };

    const BUCKET_STATUS: Record<string, CommissionStatus> = {
      pending_approval: CommissionStatus.PENDING,
      available: CommissionStatus.APPROVED,
      paid: CommissionStatus.PAID,
      rejected: CommissionStatus.REJECTED,
    };

    const where: any = { ...baseWhere };
    if (opts.bucket && BUCKET_STATUS[opts.bucket]) {
      // Filtro explícito por bucket (incluye ver las REJECTED si se pide).
      where.status = BUCKET_STATUS[opts.bucket];
    } else {
      // Vista activa por defecto: excluye las anuladas. Para auditarlas está
      // /admin/commissions/audit (o el bucket 'rejected'). Sin esto, los
      // duplicados anulados inflaban el total (ej $1.597 vs $315 legítimos).
      where.status = { not: CommissionStatus.REJECTED };
    }
    if (opts.status) where.paymentStatus = opts.status;

    const rows = await this.prisma.commission.findMany({
      where,
      include: {
        referralUse: {
          include: {
            tenant: {
              select: {
                id: true,
                brandName: true,
                planPeriodicity: true,
                currentPeriodEnd: true,
                plan: { select: { name: true } },
              },
            },
            referralCode: {
              select: { id: true, code: true, ownerName: true, role: true },
            },
          },
        },
        recipientCode: {
          select: {
            id: true,
            code: true,
            ownerName: true,
            ownerEmail: true,
            role: true,
          },
        },
        vendorCode: {
          select: { id: true, code: true, ownerName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const items = rows.map((c) => {
      const amount = Number(c.amount);
      const amountPaid = Number(c.amountPaid);
      const outstanding = Math.max(0, amount - amountPaid);
      return {
        id: c.id,
        amount,
        amountPaid,
        outstanding: Math.round(outstanding * 100) / 100,
        currency: c.currency,
        paymentStatus: c.paymentStatus,
        status: c.status,
        createdAt: c.createdAt,
        // Fecha en que una comisión PENDING pasa a APPROVED (disponible para
        // pagar) = pago Hotmart + 15d (availableAt), fallback createdAt+15d.
        availableAt: effectiveAvailableAt(c),
        // Días que faltan para desbloquear (0 si ya disponible/pagada).
        daysRemaining: daysRemainingUntilAvailable(c, c.status),
        // Próxima fecha posible de cobro (día 15 o último del mes), contada
        // desde que la comisión esté disponible.
        nextPayoutDate: nextPayoutDate(
          new Date(Math.max(Date.now(), effectiveAvailableAt(c).getTime())),
        ),
        paidAt: c.paidAt,
        notes: c.notes,
        hotmartTransactionId: c.hotmartTransactionId,
        tenant: c.referralUse?.tenant
          ? {
              id: c.referralUse.tenant.id,
              brandName: c.referralUse.tenant.brandName,
              planName: c.referralUse.tenant.plan?.name ?? null,
              planPeriodicity: c.referralUse.tenant.planPeriodicity ?? null,
              currentPeriodEnd: c.referralUse.tenant.currentPeriodEnd,
            }
          : null,
        recipient: c.recipientCode
          ? {
              id: c.recipientCode.id,
              code: c.recipientCode.code,
              ownerName: c.recipientCode.ownerName,
              ownerEmail: c.recipientCode.ownerEmail,
              role: c.recipientCode.role,
            }
          : null,
        vendor: c.vendorCode
          ? {
              id: c.vendorCode.id,
              code: c.vendorCode.code,
              ownerName: c.vendorCode.ownerName,
            }
          : null,
      };
    });

    // HOTFIX 2026-06-05 (bug #14 ALTA): los totales se calculan con
    // aggregate aparte para que NO dependan del cap de 500 rows. Antes
    // sumábamos items.amount → si había >500 filas, los KPIs eran
    // incorrectos (mostraba menos plata de la real). Ahora la tabla
    // visible queda capada (paginación pendiente como follow-up) pero
    // los totals son del dataset completo según los filtros.
    const totalAgg = await this.prisma.commission.aggregate({
      where,
      _count: { _all: true },
      _sum: { amount: true, amountPaid: true },
    });
    const round = (n: number) => Math.round(n * 100) / 100;
    const totalAmount = Number(totalAgg._sum.amount ?? 0);
    const totalPaid = Number(totalAgg._sum.amountPaid ?? 0);
    const totalOutstanding = Math.max(0, totalAmount - totalPaid);
    const realCount = totalAgg._count._all;
    const truncated = items.length < realCount;

    // Desglose por bucket del ciclo de vida (siempre sobre los filtros base,
    // sin el filtro de bucket, para que los 4 KPIs se vean completos).
    const bucketAgg = await this.prisma.commission.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
      _sum: { amount: true },
    });
    const emptyBucket = () => ({ count: 0, amount: 0 });
    const byBucket = {
      pendingApproval: emptyBucket(), // PENDING — en hold
      available: emptyBucket(), // APPROVED — disponible para pagar
      paid: emptyBucket(), // PAID
      rejected: emptyBucket(), // REJECTED — anuladas
    };
    const STATUS_TO_BUCKET: Record<string, keyof typeof byBucket> = {
      PENDING: 'pendingApproval',
      APPROVED: 'available',
      PAID: 'paid',
      REJECTED: 'rejected',
    };
    for (const g of bucketAgg) {
      const k = STATUS_TO_BUCKET[g.status];
      if (!k) continue; // RETAINED u otros: no se muestran como bucket
      byBucket[k].count += g._count._all;
      byBucket[k].amount = round(byBucket[k].amount + Number(g._sum.amount ?? 0));
    }

    return {
      items,
      totals: {
        count: realCount,
        totalAmount: round(totalAmount),
        totalPaid: round(totalPaid),
        totalOutstanding: round(totalOutstanding),
      },
      byBucket,
      holdDays: COMMISSION_HOLD_DAYS,
      truncated,
      shown: items.length,
    };
  }

  /**
   * HABILITAR manual (SUPER_ADMIN): adelanta el desbloqueo de una comisión
   * PENDING (en hold de 15 días) → APPROVED (disponible para pagar). Elimina
   * los "días restantes" y la deja lista para el próximo ciclo de pago.
   * Queda auditado: quién, cuándo, días restantes eliminados y motivo
   * opcional. (Spec bloqueo/desbloqueo 2026-06-15.)
   */
  async enableCommission(
    user: AuthUser,
    commissionId: string,
    reason?: string,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const c = await this.prisma.commission.findUnique({
      where: { id: commissionId },
      select: { id: true, status: true, createdAt: true, availableAt: true, amount: true },
    });
    if (!c) throw new NotFoundException('Comisión no encontrada');

    if (c.status !== 'PENDING') {
      // Solo tiene sentido habilitar lo que está en hold. Si ya está
      // APPROVED/PAID/REJECTED/RETAINED, devolvemos sin cambios (idempotente).
      return {
        ok: true,
        alreadyAvailable: c.status === 'APPROVED' || c.status === 'PAID',
        status: c.status,
      };
    }

    const daysEliminated = daysRemainingUntilAvailable(c, c.status);

    const updated = await this.prisma.commission.update({
      where: { id: commissionId },
      data: { status: 'APPROVED' as CommissionStatus },
      select: { id: true, status: true },
    });

    await this.audit.log({
      actorId: user.id,
      action: 'commission.manually_enabled',
      resource: `Commission:${commissionId}`,
      metadata: {
        previousStatus: 'PENDING',
        newStatus: 'APPROVED',
        daysRemainingEliminated: daysEliminated,
        amount: Number(c.amount),
        reason: reason?.trim() || null,
      },
    });

    return {
      ok: true,
      status: updated.status,
      daysRemainingEliminated: daysEliminated,
    };
  }

  /**
   * REPORTE CONTABLE POR EMPRESA (2026-06-15) — "el contador dentro del
   * sistema". Para cada negocio con atribución de afiliado devuelve, sobre
   * la base = precio canónico del bundle (lo que el cliente paga por ciclo):
   *
   *   pago del cliente
   *   − comisión directa (embajador/influencer/vendor, con excepción por cliente)
   *   − comisión indirecta (5% del influencer parent, solo si el directo es embajador)
   *   − 10% del socio de plataforma (sobre TODA venta, venga de donde venga)
   *   = neto a la empresa (aprox)
   *
   * Es un cálculo POR CICLO (económica esperada de una renovación). Además
   * trae las comisiones REGISTRADAS reales (lifetime, no anuladas) por empresa
   * para que el admin reconcilie esperado vs registrado y detecte descuadres.
   *
   * % indirecto y % socio salen de Settings (referrals.indirectPercent=5,
   * referrals.socioPercent=10) para no hardcodear la regla de negocio.
   */
  async companyAccountingReport(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const [indirectRow, socioRow] = await Promise.all([
      this.prisma.setting.findUnique({
        where: { key: 'referrals.indirectPercent' },
      }),
      this.prisma.setting.findUnique({
        where: { key: 'referrals.socioPercent' },
      }),
    ]);
    const indirectPct = indirectRow?.value ? Number(indirectRow.value) : 5;
    const socioPct = socioRow?.value ? Number(socioRow.value) : COMMISSION_DEFAULTS.socioPct;

    // Atribuciones DIRECTAS: un ReferralUse por tenant cuyo code es un
    // afiliado directo (embajador/influencer/vendor). Tras el fix 1:1 cada
    // tenant tiene una; si por legacy hubiera varias, nos quedamos con la
    // más reciente.
    const uses = await this.prisma.referralUse.findMany({
      where: {
        tenantId: { not: null },
        referralCode: { role: { in: ['AMBASSADOR', 'INFLUENCER', 'VENDOR'] } },
      },
      include: {
        referralCode: {
          select: {
            id: true,
            code: true,
            ownerName: true,
            role: true,
            commissionPercent: true,
            parentCodeId: true,
            parentCode: {
              select: { id: true, code: true, ownerName: true, role: true },
            },
          },
        },
        tenant: {
          select: {
            id: true,
            brandName: true,
            status: true,
            planPeriodicity: true,
            subscriptionPriceUsd: true,
            currentPeriodEnd: true,
            hotmartSubscriberCode: true,
            plan: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // El reporte por empresa muestra SOLO negocios con suscripción REAL de
    // Hotmart (tienen identificador de suscripción). Excluimos los códigos
    // manuales/cortesía/marca/simulación (comp-/trial-/manual-/wl-/sim-) que no
    // representan un cobro real de Hotmart.
    const isRealHotmartCode = (code: string | null | undefined) =>
      !!code && !/^(comp-|trial-|manual-|wl-|sim-)/i.test(code);

    // Dedup: una atribución (la más reciente) por tenant. Solo tenants con
    // suscripción Hotmart real.
    const byTenant = new Map<string, (typeof uses)[number]>();
    for (const u of uses) {
      if (!u.tenantId || !u.tenant) continue;
      if (!isRealHotmartCode(u.tenant.hotmartSubscriberCode)) continue;
      if (!byTenant.has(u.tenantId)) byTenant.set(u.tenantId, u);
    }
    const tenantIds = [...byTenant.keys()];

    // Comisiones REGISTRADAS reales por tenant (lifetime, sin anuladas) para
    // reconciliar esperado vs registrado. Una sola query, reduce en JS.
    const recordedRows = await this.prisma.commission.findMany({
      where: {
        status: { not: CommissionStatus.REJECTED },
        referralUse: { tenantId: { in: tenantIds } },
      },
      select: {
        amount: true,
        referralUse: { select: { tenantId: true } },
      },
    });
    const recordedByTenant = new Map<string, { sum: number; count: number }>();
    for (const r of recordedRows) {
      const tid = r.referralUse?.tenantId;
      if (!tid) continue;
      const cur = recordedByTenant.get(tid) ?? { sum: 0, count: 0 };
      cur.sum += Number(r.amount);
      cur.count += 1;
      recordedByTenant.set(tid, cur);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const rows = [];
    for (const tid of tenantIds) {
      const u = byTenant.get(tid)!;
      const t = u.tenant!;
      const code = u.referralCode;
      // Base real (subscriptionPriceUsd) si la tenemos, sino canónica.
      const base = await this.recalc.getCommissionBase(
        t.subscriptionPriceUsd ?? null,
        t.planPeriodicity ?? null,
      );
      const baseIsReal =
        Number.isFinite(Number(t.subscriptionPriceUsd)) &&
        Number(t.subscriptionPriceUsd) > 0;

      const directPct = await this.resolveExceptionPercent(
        tid,
        code.id,
        Number(code.commissionPercent ?? 0),
      );
      const comisionDirecta = round((base * directPct) / 100);

      const hasIndirect = code.role === 'AMBASSADOR' && !!code.parentCode;
      const comisionIndirecta = hasIndirect
        ? round((base * indirectPct) / 100)
        : 0;

      const socio = round((base * socioPct) / 100);
      const totalComisiones = round(comisionDirecta + comisionIndirecta);
      const neto = round(base - totalComisiones - socio);

      const recorded = recordedByTenant.get(tid) ?? { sum: 0, count: 0 };

      rows.push({
        tenantId: tid,
        brandName: t.brandName,
        status: t.status,
        planName: t.plan?.name ?? null,
        planPeriodicity: t.planPeriodicity ?? null,
        currentPeriodEnd: t.currentPeriodEnd,
        base,
        // true = base = precio REAL pagado en Hotmart; false = canónico
        // del bundle (estimado, marca "aprox" en la UI).
        baseIsReal,
        afiliado: {
          id: code.id,
          code: code.code,
          ownerName: code.ownerName,
          role: code.role,
          percent: directPct,
        },
        influencer: hasIndirect
          ? {
              id: code.parentCode!.id,
              code: code.parentCode!.code,
              ownerName: code.parentCode!.ownerName,
              percent: indirectPct,
            }
          : null,
        comisionDirecta,
        comisionIndirecta,
        socioPercent: socioPct,
        socio,
        totalComisiones,
        neto,
        // Reconciliación: lo realmente registrado (no anulado) lifetime.
        registradas: round(recorded.sum),
        registradasCount: recorded.count,
      });
    }

    // Orden: por base desc (las que más facturan arriba).
    rows.sort((a, b) => b.base - a.base);

    const totals = rows.reduce(
      (acc, r) => {
        acc.base += r.base;
        acc.comisionDirecta += r.comisionDirecta;
        acc.comisionIndirecta += r.comisionIndirecta;
        acc.socio += r.socio;
        acc.neto += r.neto;
        acc.registradas += r.registradas;
        return acc;
      },
      {
        base: 0,
        comisionDirecta: 0,
        comisionIndirecta: 0,
        socio: 0,
        neto: 0,
        registradas: 0,
      },
    );

    return {
      rows,
      totals: {
        companies: rows.length,
        base: round(totals.base),
        comisionDirecta: round(totals.comisionDirecta),
        comisionIndirecta: round(totals.comisionIndirecta),
        comisiones: round(totals.comisionDirecta + totals.comisionIndirecta),
        socio: round(totals.socio),
        neto: round(totals.neto),
        registradas: round(totals.registradas),
      },
      indirectPercent: indirectPct,
      socioPercent: socioPct,
    };
  }

  /**
   * Marca una commission como pagada (total o parcial).
   * - Si amount >= commission.amount - amountPaid → paymentStatus PAID
   *   (y status = PAID + paidAt = now).
   * - Si amount < outstanding → paymentStatus PARTIAL, amountPaid += amount.
   *
   * `note` es opcional y se concatena al campo `notes` con marca de fecha.
   */
  async payCommission(
    user: AuthUser,
    commissionId: string,
    body: { amount: number; note?: string },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Monto inválido');
    }

    // HOTFIX 2026-06-05 (bugs #3+#4 CRÍTICOS): toda la lectura+cálculo+update
    // dentro de $transaction para evitar la race (2 admins paganrand al
    // mismo tiempo perdían un pago). Además rechazamos overpago en vez de
    // hacer Math.min silencioso — el admin debe ver el error si su input
    // excede el outstanding. Slack de 0.01 (1 centavo) para tolerar floats.
    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.commission.findUnique({
        where: { id: commissionId },
        select: {
          id: true,
          amount: true,
          amountPaid: true,
          paymentStatus: true,
          status: true,
          notes: true,
          payoutItem: { select: { id: true } },
        },
      });
      if (!c) throw new NotFoundException('Comisión no encontrada');

      // FIX 2026-06-16 (review #5): guards que faltaban.
      // (a) Solo se puede pagar lo APPROVED (disponible). PENDING está en
      //     hold anti-reembolso, RETAINED está congelada, REJECTED cancelada.
      if (c.status !== 'APPROVED') {
        throw new BadRequestException(
          `Solo se pueden pagar comisiones APPROVED (esta está ${c.status}).`,
        );
      }
      // (b) Si ya está en un payout (batch de liquidación abierto), no se
      //     paga por acá → evita doble-pago. Reversar el payout libera la
      //     comisión (borra el payoutItem).
      if (c.payoutItem) {
        throw new BadRequestException(
          'Esta comisión ya está en un pago (payout). Reversá ese pago antes de liquidarla manualmente.',
        );
      }

      const currentPaid = Number(c.amountPaid);
      const total = Number(c.amount);
      const outstanding = Math.max(0, total - currentPaid);

      if (outstanding <= 0) {
        throw new BadRequestException('La comisión ya está pagada por completo');
      }
      if (amount > outstanding + 0.01) {
        throw new BadRequestException(
          `El monto (${amount}) excede el pendiente (${outstanding.toFixed(2)}). Ingresa un monto menor o igual.`,
        );
      }

      const newPaid = currentPaid + amount;
      const isFullPaid = newPaid >= total - 0.001;
      const newPaymentStatus: 'PAID' | 'PARTIAL' = isFullPaid ? 'PAID' : 'PARTIAL';

      const stampedNote = body.note?.trim()
        ? `[${new Date().toISOString().slice(0, 10)}] Pago ${amount}: ${body.note.trim()}`
        : null;
      const nextNotes = stampedNote
        ? c.notes
          ? `${c.notes}\n${stampedNote}`
          : stampedNote
        : c.notes;

      // updateMany con where:{amountPaid: c.amountPaid} = optimistic lock.
      // Si el row cambió entre el findUnique y aquí (otra tx paralela), el
      // update no matchea → count=0 → tiramos error de race y el admin
      // reintenta con datos frescos.
      const result = await tx.commission.updateMany({
        where: { id: commissionId, amountPaid: c.amountPaid },
        data: {
          amountPaid: newPaid,
          paymentStatus: newPaymentStatus,
          ...(isFullPaid
            ? { status: 'PAID' as CommissionStatus, paidAt: new Date() }
            : {}),
          notes: nextNotes,
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Otra operación modificó esta comisión justo ahora. Recargá la página y volvé a intentar.',
        );
      }
      return tx.commission.findUnique({ where: { id: commissionId } });
    });
    if (!updated) {
      throw new NotFoundException('Comisión no encontrada después del pago');
    }
    return {
      ok: true,
      commission: {
        id: updated.id,
        amount: Number(updated.amount),
        amountPaid: Number(updated.amountPaid),
        paymentStatus: updated.paymentStatus,
        status: updated.status,
        paidAt: updated.paidAt,
        notes: updated.notes,
      },
    };
  }

  /**
   * Listado de personas con saldo pendiente, agrupado por recipientCodeId.
   * Para la vista /admin/commissions/payments. Por cada persona devolvemos:
   * - Total commissions con saldo (PENDING + PARTIAL).
   * - Suma del outstanding total.
   * - Datos básicos del recipient (nombre, email, role, código).
   */
  async listPendingPayouts(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const rows = await this.prisma.commission.findMany({
      where: {
        paymentStatus: { in: ['PENDING', 'PARTIAL'] },
        recipientCodeId: { not: null },
        ...(user.whiteLabelId
          ? { referralUse: { tenant: { whiteLabelId: user.whiteLabelId } } }
          : {}),
      },
      include: {
        recipientCode: {
          select: {
            id: true,
            code: true,
            ownerName: true,
            ownerEmail: true,
            ownerWhatsapp: true,
            role: true,
          },
        },
      },
    });

    // Agrupar por recipientCodeId
    const byRecipient = new Map<
      string,
      {
        code: {
          id: string;
          code: string;
          ownerName: string;
          ownerEmail: string;
          ownerWhatsapp: string;
          role: string;
        };
        commissionsCount: number;
        totalOutstanding: number;
        totalPaid: number;
        oldestPending: Date | null;
      }
    >();

    for (const c of rows) {
      if (!c.recipientCode) continue;
      const key = c.recipientCode.id;
      const amount = Number(c.amount);
      const paid = Number(c.amountPaid);
      const outstanding = Math.max(0, amount - paid);

      const cur = byRecipient.get(key);
      if (cur) {
        cur.commissionsCount += 1;
        cur.totalOutstanding += outstanding;
        cur.totalPaid += paid;
        if (!cur.oldestPending || c.createdAt < cur.oldestPending) {
          cur.oldestPending = c.createdAt;
        }
      } else {
        byRecipient.set(key, {
          code: {
            id: c.recipientCode.id,
            code: c.recipientCode.code,
            ownerName: c.recipientCode.ownerName,
            ownerEmail: c.recipientCode.ownerEmail,
            ownerWhatsapp: c.recipientCode.ownerWhatsapp,
            role: c.recipientCode.role,
          },
          commissionsCount: 1,
          totalOutstanding: outstanding,
          totalPaid: paid,
          oldestPending: c.createdAt,
        });
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const items = Array.from(byRecipient.values())
      .map((it) => ({
        codeId: it.code.id,
        code: it.code.code,
        ownerName: it.code.ownerName,
        ownerEmail: it.code.ownerEmail,
        ownerWhatsapp: it.code.ownerWhatsapp,
        role: it.code.role,
        commissionsCount: it.commissionsCount,
        totalOutstanding: round(it.totalOutstanding),
        totalPaid: round(it.totalPaid),
        oldestPending: it.oldestPending,
      }))
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    const grandTotal = items.reduce((acc, it) => acc + it.totalOutstanding, 0);

    return {
      items,
      totals: {
        count: items.length,
        grandTotalOutstanding: round(grandTotal),
      },
    };
  }

  /**
   * Marca TODAS las commissions pendientes (PENDING + PARTIAL) de una
   * persona como pagadas. Útil cuando el admin acaba de transferir el
   * acumulado y quiere conciliar en bulk.
   *
   * Implementación: para cada commission outstanding, setea
   * amountPaid = amount, paymentStatus = PAID, status = PAID, paidAt = now.
   * Agrega una nota con marca de bulk para auditoría.
   */
  async payAllForPerson(
    user: AuthUser,
    codeId: string,
    note?: string,
  ): Promise<{ ok: true; paidCount: number; totalPaid: number }> {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { id: true, ownerName: true },
    });
    if (!code) throw new NotFoundException('Código no encontrado');

    const pending = await this.prisma.commission.findMany({
      where: {
        recipientCodeId: codeId,
        paymentStatus: { in: ['PENDING', 'PARTIAL'] },
        // Respeta el bloqueo de 15 días: solo se pagan las DESBLOQUEADAS
        // (APPROVED — por cron a los 15d o por "Habilitar" manual). Las que
        // siguen en hold (PENDING) no entran al pago. Spec 2026-06-15.
        status: CommissionStatus.APPROVED,
      },
      select: {
        id: true,
        amount: true,
        amountPaid: true,
        notes: true,
      },
    });

    if (pending.length === 0) {
      return { ok: true, paidCount: 0, totalPaid: 0 };
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const noteTxt = note?.trim()
      ? `[${stamp}] Pago bulk: ${note.trim()}`
      : `[${stamp}] Pago bulk a ${code.ownerName}`;

    let totalPaid = 0;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const c of pending) {
        const amount = Number(c.amount);
        const already = Number(c.amountPaid);
        const outstanding = Math.max(0, amount - already);
        if (outstanding <= 0) continue;
        totalPaid += outstanding;

        const nextNotes = c.notes ? `${c.notes}\n${noteTxt}` : noteTxt;

        await tx.commission.update({
          where: { id: c.id },
          data: {
            amountPaid: amount,
            paymentStatus: 'PAID',
            status: 'PAID' as CommissionStatus,
            paidAt: now,
            notes: nextNotes,
          },
        });
      }
    });

    return {
      ok: true,
      paidCount: pending.length,
      totalPaid: Math.round(totalPaid * 100) / 100,
    };
  }
}

/**
 * Meses cubiertos por una periodicidad del bundle de Hotmart.
 * Usado por reconcileRecurringCommissions para aproximar el monto pagado
 * cuando el webhook directo no llegó. NO refleja el descuento del bundle.
 */
function bundleMonths(periodicity: string | null): number {
  switch ((periodicity ?? '').toUpperCase()) {
    case 'TRIMESTRAL':
      return 3;
    case 'SEMESTRAL':
      return 6;
    case 'ANUAL':
      return 12;
    default:
      return 1;
  }
}
