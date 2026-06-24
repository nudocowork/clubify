import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Loop de auditoría/consistencia SaaS por marca blanca (cada 2h).
 *
 * Compara el estado REAL contra la config de cada marca (fuente de verdad) y:
 *  - AUTO-CORRIGE solo desviaciones 100% DETERMINISTAS con valor correcto
 *    conocido. Hoy: `planPeriodicities` de una marca debe ser superconjunto de
 *    las periodicidades de sus links de pago ACTIVOS (si la marca cobra Anual,
 *    debe ofrecer Anual). Eso se puede inferir sin ambigüedad y se repara.
 *  - SOLO REPORTA/ALERTA lo ambiguo o sin valor esperado claro (no modifica a
 *    ciegas): tenants ACTIVE sin periodicidad, marcas activas sin links de
 *    pago, periodicidades ofrecidas sin link asociado, etc.
 *
 * Idempotente, con log de cada cambio, modo DRY-RUN (env BRAND_AUDIT_DRY_RUN=1)
 * y resumen final. NUNCA mezcla datos entre marcas: cada chequeo está scopeado
 * a una sola marca / sus propios tenants.
 *
 * Nota de diseño: el panel ya lee TODO en vivo desde la config de cada marca
 * (planes, beneficios, contacto, OG image), así que no hay datos denormalizados
 * que se desincronicen en runtime — por eso la superficie de auto-corrección es
 * pequeña a propósito y el job es mayormente un verificador/alertador.
 */
@Injectable()
export class BrandAuditService {
  private readonly logger = new Logger(BrandAuditService.name);
  private readonly PERIODS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

  constructor(private prisma: PrismaService) {}

  // Cada 2 horas en punto.
  @Cron('0 */2 * * *', { name: 'brand-audit.consistency' })
  async run(): Promise<{
    dryRun: boolean;
    checked: number;
    fixed: string[];
    warnings: string[];
  }> {
    const dryRun = process.env.BRAND_AUDIT_DRY_RUN === '1';
    const fixed: string[] = [];
    const warnings: string[] = [];

    try {
      const brands = await this.prisma.whiteLabel.findMany({
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          paymentGateway: true,
          planPeriodicities: true,
          paymentLinks: {
            where: { active: true },
            select: { periodicity: true, amountUsd: true, url: true },
          },
        },
      });

      for (const b of brands) {
        const linkPeriods: string[] = Array.from(
          new Set(
            b.paymentLinks
              .map((l) => String(l.periodicity))
              .filter((p) => this.PERIODS.includes(p)),
          ),
        );
        const offered = new Set(b.planPeriodicities ?? []);

        // — AUTO-FIX determinista: la marca cobra una periodicidad que NO ofrece.
        //   Debe ofrecerla (tiene link de pago activo). Reparable sin ambigüedad.
        const missingOffered = linkPeriods.filter((p) => !offered.has(p));
        if (missingOffered.length) {
          const next = this.PERIODS.filter(
            (p) => offered.has(p) || missingOffered.includes(p),
          );
          if (dryRun) {
            warnings.push(
              `[DRY-RUN] ${b.slug}: agregaría periodicidades ${missingOffered.join(',')} a planPeriodicities`,
            );
          } else {
            await this.prisma.whiteLabel.update({
              where: { id: b.id },
              data: { planPeriodicities: next },
            });
            fixed.push(
              `${b.slug}: planPeriodicities += ${missingOffered.join(',')} (tenía links de pago activos)`,
            );
          }
        }

        // — REPORTE: marca ACTIVA que cobra automático pero sin links de pago.
        if (
          b.status === 'ACTIVE' &&
          b.paymentGateway !== 'MANUAL' &&
          b.paymentLinks.length === 0
        ) {
          warnings.push(
            `${b.slug}: marca ACTIVE con gateway ${b.paymentGateway} pero SIN links de pago activos (su modal/precios saldrían vacíos).`,
          );
        }

        // — REPORTE: periodicidad ofrecida sin link de pago asociado (ambiguo:
        //   no sabemos el precio/URL, no se auto-crea).
        const offeredWithoutLink = (b.planPeriodicities ?? []).filter(
          (p) => !linkPeriods.includes(p),
        );
        if (
          b.paymentGateway !== 'MANUAL' &&
          b.paymentLinks.length > 0 &&
          offeredWithoutLink.length
        ) {
          warnings.push(
            `${b.slug}: ofrece ${offeredWithoutLink.join(',')} sin link de pago (revisar manualmente).`,
          );
        }
      }

      // — REPORTE cross-marca (cada uno scopeado a su marca): tenants ACTIVE sin
      //   periodicidad → el billing no puede mostrar "Suscripción activa · X".
      const activeNoPeriod = await this.prisma.tenant.groupBy({
        by: ['whiteLabelId'],
        where: { status: 'ACTIVE', planPeriodicity: null },
        _count: { _all: true },
      });
      for (const row of activeNoPeriod) {
        warnings.push(
          `marca=${row.whiteLabelId ?? 'clubify(legacy)'}: ${row._count._all} tenant(s) ACTIVE sin planPeriodicity (billing muestra 'Mensual' por defecto).`,
        );
      }

      if (fixed.length) {
        this.logger.log(
          `Brand audit: ${fixed.length} auto-corrección(es): ${fixed.join(' · ')}`,
        );
      }
      if (warnings.length) {
        this.logger.warn(
          `Brand audit: ${warnings.length} alerta(s): ${warnings.join(' · ')}`,
        );
      }
      if (!fixed.length && !warnings.length) {
        this.logger.log(`Brand audit: ${brands.length} marcas OK, sin desviaciones.`);
      }

      return { dryRun, checked: brands.length, fixed, warnings };
    } catch (e: any) {
      this.logger.error(`Brand audit falló: ${e?.message ?? e}`);
      return { dryRun, checked: 0, fixed, warnings };
    }
  }
}
