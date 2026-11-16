import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReferralsService } from './referrals.service';

/**
 * EL PAGO POR FUERA DEJA SU COMISIÓN AL MOMENTO, LO REGISTRE QUIEN LO REGISTRE.
 *
 * El fallo (Motilart, 2026-11-16): el pago por transferencia del 7-nov se
 * registró el 8-nov con `scripts/pasar-a-pago-por-fuera.cjs`. Ese script anota
 * el pago pero no crea la comisión: dependía de que alguien pulsara «Generar
 * comisión ahora». Nadie lo hizo hasta el 16-nov, y el aviso de «📣 Renovación»
 * a Jhon y a los afiliados llegó nueve días tarde (el aviso cuelga de la
 * comisión, no del pago: `AffiliateSaleAlertsService`).
 *
 * «Registrar pago manual» del panel sí la crea al instante
 * (`registerManualPayment` → `backfillCommissionForCurrentAssignment`), pero en
 * modo «dispara y olvida»: si falla, tampoco se entera nadie.
 *
 * Este repaso mira los pagos por fuera de las últimas `VENTANA_MS` y, si el
 * cobro sigue siendo el vigente del negocio y tiene afiliado, pide la comisión
 * por el MISMO camino que el botón. No inventa ningún cobro: solo actúa sobre un
 * `ManualPayment` que alguien registró. Y no duplica: la defensa de
 * `backfillCommissionForAssignment` frena cualquier comisión del use fechada
 * desde 25 días antes del cobro, en cualquier estado (también RECHAZADA).
 *
 * La ventana es corta a propósito: un pago viejo sin comisión es una decisión o
 * un caso para mirar a mano, no algo que el sistema deba revivir solo.
 */

/** Hasta cuánto después de registrado un pago se sigue intentando. */
export const VENTANA_MS = 48 * 60 * 60 * 1000;

/** Margen entre la fecha del pago y el `lastChargeAt` del negocio. */
const MARGEN_MS = 24 * 60 * 60 * 1000;

export type PagoPorFuera = { tenantId: string; paidAt: Date };
export type NegocioDelPago = {
  status: string;
  suspendedAt: Date | null;
  lastChargeAt: Date | null;
  currentPeriodEnd: Date | null;
  tieneAfiliado: boolean;
};

/**
 * ¿A este pago le toca pedir su comisión ahora? Solo si el negocio está activo,
 * su ciclo pagado sigue vigente, tiene afiliado y su cobro vigente ES este pago
 * (si el negocio ya tiene otro cobro más nuevo, la comisión saldría fechada con
 * ese otro: no es asunto de este pago).
 */
export function pagoQuePideComision(
  pago: PagoPorFuera,
  t: NegocioDelPago,
  ahora: Date,
): boolean {
  if (t.status !== 'ACTIVE' || t.suspendedAt) return false;
  if (!t.tieneAfiliado) return false;
  if (!t.currentPeriodEnd || t.currentPeriodEnd.getTime() <= ahora.getTime()) return false;
  if (!t.lastChargeAt) return false;
  return Math.abs(t.lastChargeAt.getTime() - pago.paidAt.getTime()) <= MARGEN_MS;
}

@Injectable()
export class ComisionDePagosPorFueraService {
  private readonly logger = new Logger(ComisionDePagosPorFueraService.name);

  constructor(
    private prisma: PrismaService,
    private referrals: ReferralsService,
  ) {}

  @Cron('*/10 * * * *', { name: 'comisiones.pagos-por-fuera' })
  async tick() {
    await this.repasar().catch((e) =>
      this.logger.error(`comisión de pagos por fuera falló: ${(e as Error).message}`),
    );
  }

  /** Devuelve los negocios a los que se les creó comisión (para pruebas y logs). */
  async repasar(ahora = new Date()) {
    const pagos = await this.prisma.manualPayment.findMany({
      where: { createdAt: { gte: new Date(ahora.getTime() - VENTANA_MS) } },
      select: { tenantId: true, paidAt: true },
      orderBy: { paidAt: 'desc' },
    });
    // Un negocio, una vez por pasada: el pago más reciente es el que cuenta.
    const porNegocio = new Map<string, PagoPorFuera>();
    for (const p of pagos) if (!porNegocio.has(p.tenantId)) porNegocio.set(p.tenantId, p);

    const creadas: string[] = [];
    for (const pago of porNegocio.values()) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: pago.tenantId },
        select: {
          brandName: true,
          status: true,
          suspendedAt: true,
          lastChargeAt: true,
          currentPeriodEnd: true,
        },
      });
      if (!t) continue;
      const afiliados = await this.prisma.referralUse.count({
        where: {
          tenantId: pago.tenantId,
          referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] } },
        },
      });
      if (!pagoQuePideComision(pago, { ...t, tieneAfiliado: afiliados > 0 }, ahora)) continue;
      try {
        const r = await this.referrals.backfillCommissionForCurrentAssignment(
          pago.tenantId,
          false,
        );
        if (r.creadas > 0) {
          creadas.push(pago.tenantId);
          this.logger.log(
            `pago por fuera de ${t.brandName}: ${r.creadas} comisión(es) creada(s) sin esperar al botón`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `pago por fuera de ${t.brandName}: no se pudo crear la comisión: ${(e as Error).message}`,
        );
      }
    }
    return creadas;
  }
}
