import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';

/**
 * Trials service — cron diario de recordatorios SMS internos a Javier+Jhon
 * y endpoints de listado + métricas para el panel /admin/trials.
 *
 * Los SMS NO van al dueño del trial — el equipo comercial hace seguimiento
 * manual al recibir el aviso. Idempotente por `Tenant.trialReminderLastSent`:
 * cada threshold (5, 3, 1, h12, expired) se envía 1 vez.
 */
@Injectable()
export class TrialsService {
  private logger = new Logger(TrialsService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
  ) {}

  /**
   * Cada hora (en lugar de daily) para alcanzar el threshold de 12h con
   * resolución decente. El check de threshold ya garantiza que cada SMS
   * se manda 1 sola vez por trial.
   */
  @Cron('0 0 * * * *', { name: 'trials.send-reminders' })
  async sendTrialReminders(): Promise<void> {
    const trials = await this.prisma.tenant.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { not: null },
        suspendedAt: null,
        // Solo trials con trialSource (= signups vía /prueba). Los signups
        // legacy de Hotmart NO necesitan estos recordatorios — esos tienen
        // su propia secuencia SMS en billing.
        trialSource: { not: null },
      },
      select: {
        id: true,
        brandName: true,
        email: true,
        whatsappPhone: true,
        trialEndsAt: true,
        trialReminderLastSent: true,
        trialSource: true,
        trialCompany: true,
        trialCity: true,
      },
    });
    if (trials.length === 0) return;

    const now = Date.now();
    const HOUR_MS = 60 * 60 * 1000;

    for (const t of trials) {
      if (!t.trialEndsAt) continue;
      const hoursLeft = (t.trialEndsAt.getTime() - now) / HOUR_MS;
      const threshold = this.pickThreshold(
        hoursLeft,
        t.trialReminderLastSent ?? null,
      );
      if (!threshold) continue;
      const body = this.buildBody(t, threshold);
      const res = await this.alerts.sendTeamAlert(body);
      if (res.ok || res.total === 0) {
        // Si total=0 (sin teléfonos configurados) también marcamos para
        // no loop infinito; el logger.warn ya advirtió.
        await this.prisma.tenant
          .update({
            where: { id: t.id },
            data: { trialReminderLastSent: threshold },
          })
          .catch(() => null);
        this.logger.log(
          `Trial reminder ${threshold} enviado para ${t.brandName} (${t.id})`,
        );
      }
    }
  }

  /**
   * Devuelve el threshold a enviar AHORA o null si no toca. La progresión
   * es estricta — cada threshold se envía 1 vez y nunca un threshold más
   * "lejano" después de uno más cercano (no duplicar el d-5 después del
   * d-3 si por alguna razón el reloj retrocede).
   *
   * Buckets:
   *  - hoursLeft > 120 (5d+): no recordatorio aún.
   *  - 96 < hoursLeft ≤ 120 (entre 4 y 5 días): threshold "5".
   *  - 48 < hoursLeft ≤ 72 (entre 2 y 3 días): threshold "3".
   *  - 12 < hoursLeft ≤ 24 (entre 12h y 1 día): threshold "1".
   *  - 0 < hoursLeft ≤ 12: threshold "h12".
   *  - hoursLeft ≤ 0 (expirado): threshold "expired".
   */
  private pickThreshold(
    hoursLeft: number,
    lastSent: string | null,
  ): '5' | '3' | '1' | 'h12' | 'expired' | null {
    const order = ['5', '3', '1', 'h12', 'expired'];
    const lastIdx = lastSent ? order.indexOf(lastSent) : -1;

    let target: '5' | '3' | '1' | 'h12' | 'expired' | null = null;
    if (hoursLeft <= 0) target = 'expired';
    else if (hoursLeft <= 12) target = 'h12';
    else if (hoursLeft > 12 && hoursLeft <= 24) target = '1';
    else if (hoursLeft > 48 && hoursLeft <= 72) target = '3';
    else if (hoursLeft > 96 && hoursLeft <= 120) target = '5';

    if (!target) return null;
    const targetIdx = order.indexOf(target);
    // Si ya enviamos un threshold más cercano (mayor idx) no retrocedemos.
    if (lastIdx >= targetIdx) return null;
    return target;
  }

  private buildBody(
    t: {
      brandName: string;
      email: string;
      whatsappPhone: string | null;
      trialSource: string | null;
      trialCompany: string | null;
      trialCity: string | null;
    },
    threshold: '5' | '3' | '1' | 'h12' | 'expired',
  ): string {
    const heading =
      threshold === 'expired'
        ? '🔴 Trial Clubify VENCIDO'
        : threshold === 'h12'
          ? '⏰ Trial Clubify · 12h restantes'
          : threshold === '1'
            ? '⏰ Trial Clubify · 1 día restante'
            : threshold === '3'
              ? '🟡 Trial Clubify · 3 días restantes'
              : '🟢 Trial Clubify · 5 días restantes';

    const lines = [
      heading,
      '',
      `Negocio: ${t.brandName}`,
      `Email: ${t.email}`,
    ];
    if (t.whatsappPhone) lines.push(`Tel: ${t.whatsappPhone}`);
    if (t.trialCompany && t.trialCompany !== t.brandName) {
      lines.push(`Empresa: ${t.trialCompany}`);
    }
    if (t.trialCity) lines.push(`Ciudad: ${t.trialCity}`);
    lines.push(`Origen: ${t.trialSource ?? 'DIRECT'}`);
    lines.push('', 'Hacer seguimiento en /admin/trials.');
    return lines.join('\n');
  }

  /**
   * Lista de trials para el panel /admin/trials. Incluye conversión
   * inferida del estado actual del tenant. Ordena por más recientes
   * primero (los que recién empiezan arriba). Incluye atribución a
   * embajador/influencer via ReferralUse.
   */
  async list(filter?: 'active' | 'expired' | 'converted' | 'all') {
    const where: any = {
      OR: [
        // Trials reales (via /prueba): tienen trialSource set.
        { trialSource: { not: null } },
        // O hicieron conversion (status ACTIVE) y antes tuvieron trial
        // — esos los incluimos en el "convertidos" para métricas.
      ],
    };

    const trials = await this.prisma.tenant.findMany({
      where: { trialSource: { not: null } },
      select: {
        id: true,
        brandName: true,
        email: true,
        whatsappPhone: true,
        status: true,
        trialStartedAt: true,
        trialEndsAt: true,
        trialSource: true,
        trialCompany: true,
        trialCity: true,
        hotmartSubscriberCode: true,
        suspendedAt: true,
        createdAt: true,
        referralUses: {
          select: {
            referralCode: {
              select: { code: true, ownerName: true, role: true },
            },
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = Date.now();
    const mapped = trials.map((t) => {
      const trialEnd = t.trialEndsAt?.getTime() ?? null;
      const expired = trialEnd !== null && trialEnd < now;
      const converted = !!t.hotmartSubscriberCode;
      const daysLeft =
        trialEnd !== null
          ? Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)))
          : null;
      let derivedStatus: 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED' | 'CONVERTED' | 'SUSPENDED';
      if (t.suspendedAt) derivedStatus = 'SUSPENDED';
      else if (converted) derivedStatus = 'CONVERTED';
      else if (expired) derivedStatus = 'TRIAL_EXPIRED';
      else derivedStatus = 'TRIAL_ACTIVE';

      const referrer = t.referralUses[0]?.referralCode ?? null;
      return {
        id: t.id,
        brandName: t.brandName,
        email: t.email,
        phone: t.whatsappPhone,
        company: t.trialCompany,
        city: t.trialCity,
        source: t.trialSource,
        status: derivedStatus,
        trialStartedAt: t.trialStartedAt,
        trialEndsAt: t.trialEndsAt,
        daysLeft,
        createdAt: t.createdAt,
        referrer: referrer
          ? {
              code: referrer.code,
              name: referrer.ownerName,
              role: referrer.role,
            }
          : null,
      };
    });

    if (!filter || filter === 'all') return mapped;
    if (filter === 'active') {
      return mapped.filter((m) => m.status === 'TRIAL_ACTIVE');
    }
    if (filter === 'expired') {
      return mapped.filter((m) => m.status === 'TRIAL_EXPIRED');
    }
    if (filter === 'converted') {
      return mapped.filter((m) => m.status === 'CONVERTED');
    }
    return mapped;
  }

  /**
   * Métricas para los KPIs del panel /admin/trials. Calculados desde la
   * tabla Tenant en una sola query — no hay vista materializada. El
   * volumen de trials es bajo (cientos, no millones), OK para count
   * inline. % conversión = convertidos / (convertidos + expirados).
   * Per-source breakdown para ver qué canal trae más prospects que
   * realmente pagan.
   */
  async metrics() {
    const all = await this.list('all');
    const active = all.filter((t) => t.status === 'TRIAL_ACTIVE');
    const expired = all.filter((t) => t.status === 'TRIAL_EXPIRED');
    const converted = all.filter((t) => t.status === 'CONVERTED');
    const suspended = all.filter((t) => t.status === 'SUSPENDED');
    const decided = converted.length + expired.length + suspended.length;
    const conversionPct =
      decided > 0 ? Math.round((converted.length / decided) * 100) : null;

    // Breakdown por source (LANDING/AMBASSADOR/INFLUENCER/CAMPAIGN/DIRECT).
    const bySource: Record<
      string,
      { total: number; active: number; converted: number; expired: number; conversionPct: number | null }
    > = {};
    for (const t of all) {
      const k = t.source ?? 'DIRECT';
      if (!bySource[k]) {
        bySource[k] = {
          total: 0,
          active: 0,
          converted: 0,
          expired: 0,
          conversionPct: null,
        };
      }
      bySource[k].total += 1;
      if (t.status === 'TRIAL_ACTIVE') bySource[k].active += 1;
      if (t.status === 'CONVERTED') bySource[k].converted += 1;
      if (t.status === 'TRIAL_EXPIRED' || t.status === 'SUSPENDED') {
        bySource[k].expired += 1;
      }
    }
    for (const k of Object.keys(bySource)) {
      const s = bySource[k];
      const d = s.converted + s.expired;
      s.conversionPct = d > 0 ? Math.round((s.converted / d) * 100) : null;
    }

    // Breakdown por embajador/influencer (por código de referido).
    const byReferrer: Record<
      string,
      { code: string; name: string; role: string; total: number; converted: number; conversionPct: number | null }
    > = {};
    for (const t of all) {
      if (!t.referrer) continue;
      const k = t.referrer.code;
      if (!byReferrer[k]) {
        byReferrer[k] = {
          code: t.referrer.code,
          name: t.referrer.name,
          role: t.referrer.role,
          total: 0,
          converted: 0,
          conversionPct: null,
        };
      }
      byReferrer[k].total += 1;
      if (t.status === 'CONVERTED') byReferrer[k].converted += 1;
    }
    for (const k of Object.keys(byReferrer)) {
      const r = byReferrer[k];
      r.conversionPct =
        r.total > 0 ? Math.round((r.converted / r.total) * 100) : null;
    }

    return {
      counts: {
        total: all.length,
        active: active.length,
        expired: expired.length,
        converted: converted.length,
        suspended: suspended.length,
      },
      conversionPct,
      bySource,
      byReferrer: Object.values(byReferrer).sort(
        (a, b) => b.total - a.total,
      ),
    };
  }
}
