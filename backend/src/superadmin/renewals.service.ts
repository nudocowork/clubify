import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';

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

  constructor(private prisma: PrismaService) {}

  /** Corre a las 02:00 UTC cada día. UTC-5 LATAM = 21:00 hora local. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async dailyRenewals() {
    try {
      const result = await this.run({ dryRun: false });
      this.logger.log(
        `Renewals cron: renewed=${result.renewed} grace=${result.grace} suspended=${result.suspended} skipped=${result.skipped}`,
      );
    } catch (e) {
      this.logger.error(`Renewals cron falló: ${(e as Error).message}`);
    }
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
        select: { id: true, name: true, creditsAvailable: true, creditsUsed: true, status: true },
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

      if (wl.creditsAvailable >= 1) {
        // Renovar: consume 1 crédito + extiende currentPeriodEnd 30d
        if (!opts.dryRun) {
          const newPeriodEnd = new Date(periodEnd.getTime() + RenewalsService.CYCLE_DAYS * RenewalsService.DAY_MS);
          // Race-safe: extender solo si nadie más lo modificó
          const updateTenant = await this.prisma.tenant.updateMany({
            where: { id: t.id, currentPeriodEnd: periodEnd },
            data: { currentPeriodEnd: newPeriodEnd },
          });
          if (updateTenant.count === 0) {
            // Otro worker ya lo renovó
            summary.skipped++;
            summary.details.push({
              tenantId: t.id,
              brandName: t.brandName,
              action: 'SKIPPED',
              reason: 'Race — otro worker ya lo renovó',
            });
            continue;
          }
          await this.prisma.$transaction([
            this.prisma.whiteLabel.update({
              where: { id: wl.id },
              data: {
                creditsAvailable: wl.creditsAvailable - 1,
                creditsUsed: wl.creditsUsed + 1,
              },
            }),
            this.prisma.creditTransaction.create({
              data: {
                whiteLabelId: wl.id,
                type: 'CONSUME',
                amount: -1,
                tenantId: t.id,
                note: `Auto-renovación · ${t.brandName} · +30d`,
              },
            }),
          ]);
        }
        summary.renewed++;
        summary.details.push({
          tenantId: t.id,
          brandName: t.brandName,
          action: 'RENEWED',
        });
        continue;
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
