import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Limpieza periódica de tablas "calientes" cuyo volumen crece sin techo:
 *   - Event       (analytics sink)        — retén 90d por default
 *   - AuditLog    (acciones del usuario)  — retén 365d (compliance)
 *   - Notification(envíos completados)    — retén 30d post-sent
 *   - RefreshToken (revoked/expired)      — retén 7d post-expiry
 *
 * Comportamiento:
 *   - Default OFF. Solo corre si `RETENTION_ENABLED=true`. Esto evita
 *     borrar data por accidente en entornos nuevos.
 *   - Cada threshold configurable vía env (RETENTION_DAYS_EVENT, etc).
 *   - Se ejecuta dentro de `TenantContext.runWithoutTenant()` para que el
 *     middleware multi-tenant no agregue `where.tenantId` (necesitamos
 *     borrar global).
 *   - Idempotente: si no hay nada que borrar, no falla.
 *
 * Estrategia de borrado: usamos `deleteMany` simple. Para tablas muy
 * grandes (>1M rows a borrar), conviene migrar a Postgres partitioning +
 * `DROP PARTITION` (futuro). Para el stage actual de Clubify, deleteMany
 * con índice en `createdAt`/`expiresAt` es suficiente.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private prisma: PrismaService) {}

  private get enabled(): boolean {
    return process.env.RETENTION_ENABLED === 'true';
  }

  private days(envKey: string, def: number): number {
    const raw = process.env[envKey];
    if (!raw) return def;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : def;
  }

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * 86_400_000);
  }

  /**
   * Cron diario a las 3:15 AM (UTC). Offset 15min respecto a otros crons
   * (billing 3:00, referrals 4:00) para no saturar la DB al mismo tiempo.
   */
  @Cron('15 3 * * *', { name: 'retention.daily-cleanup' })
  async runDaily() {
    if (!this.enabled) {
      this.logger.debug('Retention OFF (RETENTION_ENABLED!=true) — skip');
      return;
    }
    await TenantContext.runWithoutTenant(() => this.cleanupAll());
  }

  /** Punto de entry público para correr manualmente desde super admin. */
  async runNow() {
    return TenantContext.runWithoutTenant(() => this.cleanupAll());
  }

  private async cleanupAll() {
    const summary = {
      events: 0,
      auditLogs: 0,
      notifications: 0,
      refreshTokens: 0,
    };

    const eventDays = this.days('RETENTION_DAYS_EVENT', 90);
    const auditDays = this.days('RETENTION_DAYS_AUDIT', 365);
    const notifDays = this.days('RETENTION_DAYS_NOTIFICATION', 30);
    const refreshDays = this.days('RETENTION_DAYS_REFRESH_TOKEN', 7);

    try {
      const r1 = await this.prisma.event.deleteMany({
        where: { createdAt: { lt: this.cutoff(eventDays) } },
      });
      summary.events = r1.count;
    } catch (e: any) {
      this.logger.error(`Retention Event failed: ${e?.message ?? e}`);
    }

    try {
      const r2 = await this.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: this.cutoff(auditDays) } },
      });
      summary.auditLogs = r2.count;
    } catch (e: any) {
      this.logger.error(`Retention AuditLog failed: ${e?.message ?? e}`);
    }

    try {
      // Solo notificaciones YA enviadas (sentAt no null) y viejas. Las
      // pendientes (scheduledAt futuro, sentAt null) NUNCA se borran.
      const r3 = await this.prisma.notification.deleteMany({
        where: {
          sentAt: { not: null, lt: this.cutoff(notifDays) },
        },
      });
      summary.notifications = r3.count;
    } catch (e: any) {
      this.logger.error(`Retention Notification failed: ${e?.message ?? e}`);
    }

    try {
      // RefreshToken: borrar los que ya pasaron su expiración hace más de
      // N días. Mantenemos 7d por default para forensics post-incidente.
      const r4 = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: this.cutoff(refreshDays) } },
      });
      summary.refreshTokens = r4.count;
    } catch (e: any) {
      this.logger.error(`Retention RefreshToken failed: ${e?.message ?? e}`);
    }

    this.logger.log(
      `Retention OK · events=${summary.events} auditLogs=${summary.auditLogs} ` +
        `notifications=${summary.notifications} refreshTokens=${summary.refreshTokens}`,
    );
    return summary;
  }
}
