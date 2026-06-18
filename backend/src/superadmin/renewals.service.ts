import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { WhiteLabelNotificationsService } from '../white-label-notifications/white-label-notifications.service';
import { addPlanPeriod, bundleMonths } from '../common/plan-period';

/**
 * Cron de renovaciones automáticas (Fase 2 del Master Admin).
 *
 * Regla de negocio:
 *   1 crédito = 30 días de servicio para UN tenant.
 *   Cuando un tenant cumple `currentPeriodEnd`, intentamos renovarlo
 *   consumiendo 1 crédito de su WhiteLabel.
 *
 *   - Tenant ACTIVE con currentPeriodEnd ≤ ahora:
 *     · Si WhiteLabel.creditsAvailable >= 1 → consume y extiende 30d
 *     · Si NO hay créditos:
 *       · Si vence dentro de los últimos 5d → queda EN GRACIA (sigue
 *         ACTIVE, pero sin extender)
 *       · Si vence hace más de 5d → SUSPENDED
 *
 * Idempotencia: extender currentPeriodEnd hace que re-runs del cron
 * mismo día no vuelvan a procesar el mismo tenant. Para evitar race
 * entre runs concurrentes usamos una transacción optimistic:
 * UPDATE WHERE currentPeriodEnd = X → si nadie lo modificó, gana.
 */
@Injectable()
export class RenewalsService {
  private readonly logger = new Logger(RenewalsService.name);
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;
  private static readonly GRACE_DAYS = 5;
  private static readonly CYCLE_DAYS = 30;

  constructor(
    private prisma: PrismaService,
    private wlNotifications: WhiteLabelNotificationsService,
  ) {}

  /** Corre a las 02:00 UTC cada día. UTC-5 LATAM = 21:00 hora local. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async dailyRenewals() {
    try {
      const result = await this.run({ dryRun: false });
      this.logger.log(
        `Renewals cron: renewed=${result.renewed} grace=${result.grace} suspended=${result.suspended} skipped=${result.skipped}`,
      );
      const committed = await this.refreshCommittedCredits();
      this.logger.log(`Committed credits refreshed: ${committed.total} en ${committed.whiteLabels} marcas`);
      await this.notifyBrandsCreditState();
    } catch (e) {
      this.logger.error(`Renewals cron falló: ${(e as Error).message}`);
    }
  }

  /**
   * Post-pass diario: por cada marca blanca con créditos (no ilimitada),
   * avisa por SMS si quedó con saldo bajo (≤2) o si tiene negocios pendientes
   * de activación por falta de créditos. Dedupe lo maneja el servicio
   * (flags lowCreditsNotifiedAt / pendingClientsNotifiedAt). Best-effort.
   */
  async notifyBrandsCreditState() {
    const now = new Date();
    const brands = await this.prisma.whiteLabel.findMany({
      where: { creditsUnlimited: false },
      select: { id: true, creditsAvailable: true },
    });
    for (const b of brands) {
      const pending = await this.prisma.tenant.count({
        where: {
          whiteLabelId: b.id,
          OR: [
            { status: 'SUSPENDED' },
            { status: 'TRIAL', trialEndsAt: { lt: now } },
            { status: 'ACTIVE', currentPeriodEnd: { lt: now } },
          ],
        },
      });
      await this.wlNotifications.onCreditsConsumed(b.id, b.creditsAvailable).catch(() => null);
      await this.wlNotifications.onPendingClients(b.id, pending).catch(() => null);
    }
  }

  /** Recalcula `creditsCommitted` por marca: cuántos créditos van a
   *  necesitarse en los próximos 30 días para renovar a los tenants
   *  ACTIVE. 1 tenant = 1 crédito por ciclo. Idempotente. */
  async refreshCommittedCredits() {
    const now = new Date();
    const horizon = new Date(now.getTime() + RenewalsService.CYCLE_DAYS * RenewalsService.DAY_MS);

    const grouped = await this.prisma.tenant.groupBy({
      by: ['whiteLabelId'],
      where: {
        status: 'ACTIVE',
        whiteLabelId: { not: null },
        currentPeriodEnd: { not: null, lte: horizon },
      },
      _count: { _all: true },
    });

    const byWl = new Map<string, number>();
    for (const g of grouped) {
      if (g.whiteLabelId) byWl.set(g.whiteLabelId, g._count._all);
    }

    const allWhiteLabels = await this.prisma.whiteLabel.findMany({
      select: { id: true },
    });

    let totalCommitted = 0;
    for (const wl of allWhiteLabels) {
      const count = byWl.get(wl.id) ?? 0;
      totalCommitted += count;
      await this.prisma.whiteLabel.update({
        where: { id: wl.id },
        data: { creditsCommitted: count },
      });
    }

    await this.prisma.setting.upsert({
      where: { key: 'platform.creditsCommittedRefreshedAt' },
      create: { key: 'platform.creditsCommittedRefreshedAt', value: now.toISOString() },
      update: { value: now.toISOString() },
    });

    return { whiteLabels: allWhiteLabels.length, total: totalCommitted, refreshedAt: now };
  }

  /** Ejecuta el barrido de renovaciones. `dryRun` no aplica cambios. */
  async run(opts: { dryRun: boolean }) {
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - RenewalsService.GRACE_DAYS * RenewalsService.DAY_MS);

    // Candidatos: ACTIVE con currentPeriodEnd vencido
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: { lte: now },
      },
      select: {
        id: true,
        brandName: true,
        whiteLabelId: true,
        currentPeriodEnd: true,
        planPeriodicity: true,
      },
      take: 1000,
    });

    const summary = {
      considered: candidates.length,
      renewed: 0,
      grace: 0,
      suspended: 0,
      skipped: 0,
      details: [] as Array<{
        tenantId: string;
        brandName: string;
        action: 'RENEWED' | 'GRACE' | 'SUSPENDED' | 'SKIPPED';
        reason?: string;
      }>,
    };

    for (const t of candidates) {
      const periodEnd = t.currentPeriodEnd!;
      const inGraceWindow = periodEnd >= graceCutoff;

      if (!t.whiteLabelId) {
        summary.skipped++;
        summary.details.push({
          tenantId: t.id,
          brandName: t.brandName,
          action: 'SKIPPED',
          reason: 'Sin whiteLabelId — backfill faltante',
        });
        continue;
      }

      // Refresca créditos disponibles inline para reflejar consumos
      // de iteraciones previas del mismo run.
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: t.whiteLabelId },
        select: { id: true, name: true, creditsAvailable: true, creditsUsed: true, status: true, creditsUnlimited: true },
      });
      if (!wl || wl.status === 'SUSPENDED') {
        // Si la marca está suspendida, no consumimos sus créditos —
        // pero el tenant también queda en gracia hasta que el dueño
        // decida.
        if (!inGraceWindow) {
          if (!opts.dryRun) {
            await this.prisma.tenant.update({
              where: { id: t.id },
              data: { status: 'SUSPENDED' },
            });
          }
          summary.suspended++;
          summary.details.push({
            tenantId: t.id,
            brandName: t.brandName,
            action: 'SUSPENDED',
            reason: `Marca ${wl?.name ?? '?'} suspendida + fuera de gracia`,
          });
        } else {
          summary.grace++;
          summary.details.push({
            tenantId: t.id,
            brandName: t.brandName,
            action: 'GRACE',
            reason: 'Marca suspendida, esperando reactivación',
          });
        }
        continue;
      }

      // Marcas con créditos ilimitados: siempre renovamos, sin consumir.
      if (wl.creditsUnlimited) {
        if (!opts.dryRun) {
          // Bug #1: extiende por la periodicidad real del plan (Trimestral
          // = +3 meses), no +30 días fijos.
          const newPeriodEnd = addPlanPeriod(periodEnd, t.planPeriodicity);
          await this.prisma.tenant.updateMany({
            where: { id: t.id, currentPeriodEnd: periodEnd },
            data: { currentPeriodEnd: newPeriodEnd },
          });
        }
        summary.renewed++;
        summary.details.push({
          tenantId: t.id,
          brandName: t.brandName,
          action: 'RENEWED',
          reason: `Marca ${wl.name} con créditos ilimitados`,
        });
        continue;
      }

      if (wl.creditsAvailable >= 1) {
        // Renovar: consume 1 crédito + extiende currentPeriodEnd 30d.
        // Race-safe en dos niveles:
        //  1) Crédito: updateMany con guard `creditsAvailable >= 1` —
        //     si un adjustCredits concurrente bajó a 0, no decrementa.
        //  2) Tenant: updateMany con guard `currentPeriodEnd = periodEnd`
        //     — si otro worker ya renovó, no extiende.
        // Si el tenant ya estaba renovado, rollback del crédito.
        if (!opts.dryRun) {
          // Bug #1: extiende por la periodicidad real del plan (Trimestral
          // = +3 meses), no +30 días fijos.
          const newPeriodEnd = addPlanPeriod(periodEnd, t.planPeriodicity);
          const debit = await this.prisma.whiteLabel.updateMany({
            where: { id: wl.id, creditsAvailable: { gte: 1 } },
            data: {
              creditsAvailable: { decrement: 1 },
              creditsUsed: { increment: 1 },
            },
          });
          if (debit.count === 0) {
            // Race: otra operación bajó los créditos a 0. Caemos a la
            // rama "sin créditos" abajo, simulando que nunca tuvimos.
            wl.creditsAvailable = 0;
          } else {
            const updateTenant = await this.prisma.tenant.updateMany({
              where: { id: t.id, currentPeriodEnd: periodEnd },
              data: { currentPeriodEnd: newPeriodEnd },
            });
            if (updateTenant.count === 0) {
              // Otro worker ya lo renovó — rollback del crédito
              await this.prisma.whiteLabel.update({
                where: { id: wl.id },
                data: {
                  creditsAvailable: { increment: 1 },
                  creditsUsed: { decrement: 1 },
                },
              });
              summary.skipped++;
              summary.details.push({
                tenantId: t.id,
                brandName: t.brandName,
                action: 'SKIPPED',
                reason: 'Race — otro worker ya lo renovó',
              });
              continue;
            }
            await this.prisma.creditTransaction.create({
              data: {
                whiteLabelId: wl.id,
                type: 'CONSUME',
                amount: -1,
                tenantId: t.id,
                note: `Auto-renovación · ${t.brandName} · +${bundleMonths(t.planPeriodicity)}m`,
              },
            });
            summary.renewed++;
            summary.details.push({
              tenantId: t.id,
              brandName: t.brandName,
              action: 'RENEWED',
            });
            continue;
          }
        } else {
          summary.renewed++;
          summary.details.push({
            tenantId: t.id,
            brandName: t.brandName,
            action: 'RENEWED',
          });
          continue;
        }
      }

      // Sin créditos
      if (inGraceWindow) {
        summary.grace++;
        summary.details.push({
          tenantId: t.id,
          brandName: t.brandName,
          action: 'GRACE',
          reason: `Sin créditos · vence hace ${Math.floor((now.getTime() - periodEnd.getTime()) / RenewalsService.DAY_MS)}d`,
        });
      } else {
        // Suspender
        if (!opts.dryRun) {
          await this.prisma.tenant.update({
            where: { id: t.id },
            data: { status: 'SUSPENDED' },
          });
        }
        summary.suspended++;
        summary.details.push({
          tenantId: t.id,
          brandName: t.brandName,
          action: 'SUSPENDED',
          reason: `Sin créditos + más de ${RenewalsService.GRACE_DAYS} días vencido`,
        });
      }
    }

    return summary;
  }
}
