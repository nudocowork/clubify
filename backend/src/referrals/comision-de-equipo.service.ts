import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { alcanceDeMarca, combinar } from '../finance/alcance-de-marca';
import { recalcBatchTotal } from './payout-batch.util';
import {
  bogotaDayEndUtc,
  bogotaDayStartUtc,
  bogotaNoonUtc,
  bogotaYmd,
  cutoffCode,
  cutoffDaysInRange,
  cutoffPeriod,
  nextCutoffYmd,
} from './cutoff-calendar';

/**
 * COMISIÓN DE EQUIPO: un % de TODAS las ventas de cada quincena.
 *
 * Javier (2026-10-02): Sara Plata, la Project Manager, comisiona el 2 % del
 * total de las ventas. Lo calcula el sistema solo, sale en Comisiones, toma el
 * total de los ingresos de CONTABILIDAD (no de otra cuenta) y se paga cada 15
 * días — la quincena del 16 al 30 de septiembre paga el 2 % de lo ingresado
 * del 16 al 30 —, sin los 15 días de espera de las comisiones de venta: queda
 * disponible al cierre de su quincena.
 *
 * Nada de esto lleva nombres escritos: quién cobra, cuánto y desde cuándo son
 * ajustes (`comisiones.equipo.*`). Sin código configurado, no hace nada.
 *
 * Se RECALCULA cada hora mientras la comisión no esté pagada: si se añade o se
 * corrige un ingreso de la quincena (un pago que llegó tarde, uno que el
 * conciliador recupera), la comisión lo refleja sola. Una ya pagada no se
 * toca: el dinero salió, y el libro manda.
 */

export const CLAVE_CODIGO = 'comisiones.equipo.codeId';
export const CLAVE_PORCENTAJE = 'comisiones.equipo.porcentaje';
export const CLAVE_DESDE = 'comisiones.equipo.desde';
export const PORCENTAJE_POR_DEFECTO = 2;
/** Primera quincena que paga (su día de inicio). */
export const DESDE_POR_DEFECTO = '2026-09-16';
/** Prefijo del `periodKey`: una fila por quincena y por persona. */
export const PREFIJO = 'EQUIPO-';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que le toca de una quincena. Nunca negativo. */
export function comisionDeLaQuincena(ventasUsd: number, porcentaje: number): number {
  return round2((Math.max(ventasUsd, 0) * porcentaje) / 100);
}

@Injectable()
export class ComisionDeEquipoService {
  private readonly logger = new Logger(ComisionDeEquipoService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('15 * * * *', { name: 'comisiones.equipo' })
  async tick() {
    await this.recalcular().catch((e) =>
      this.logger.error(`comisión de equipo falló: ${(e as Error).message}`),
    );
  }

  /**
   * Crea o actualiza la comisión de cada quincena desde la configurada hasta la
   * EN CURSO. Devuelve qué hizo, para el script y las pruebas.
   */
  async recalcular(ahora = new Date()) {
    const ajuste = async (key: string) =>
      (await this.prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value?.trim() || null;
    const codeId = await ajuste(CLAVE_CODIGO);
    if (!codeId) return { activa: false as const, quincenas: [] };
    const pctCrudo = Number(String((await ajuste(CLAVE_PORCENTAJE)) ?? PORCENTAJE_POR_DEFECTO).replace(',', '.'));
    const porcentaje = Number.isFinite(pctCrudo) && pctCrudo > 0 && pctCrudo <= 100 ? pctCrudo : PORCENTAJE_POR_DEFECTO;
    const desde = (await ajuste(CLAVE_DESDE)) ?? DESDE_POR_DEFECTO;

    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { id: true, ownerName: true, isActive: true },
    });
    if (!code || code.isActive === false) return { activa: false as const, quincenas: [] };

    const hoy = bogotaYmd(ahora);
    // Desde el corte de la quincena configurada hasta el de la que corre hoy.
    const cortes = cutoffDaysInRange(nextCutoffYmd(desde), nextCutoffYmd(hoy));
    const marca = await alcanceDeMarca(this.prisma, true);
    const quincenas: Array<{ corte: string; ventasUsd: number; comisionUsd: number; accion: string }> = [];

    for (const corte of cortes) {
      const { start, end } = cutoffPeriod(corte);
      const inicio = start < desde ? desde : start;
      const agg = await this.prisma.incomeRecord.aggregate({
        where: combinar(
          // `bogotaDayEndUtc` es la medianoche SIGUIENTE: ya no es de la quincena.
          // Sin lo que pagan las marcas blancas (créditos, rebranding): Sara
          // (2026-10-03) no tiene decidido si su 2 % los incluye; se verá en el
          // apartado de Marcas blancas.
          {
            status: 'PAGADO',
            payerWhiteLabelId: null,
            saleDate: { gte: bogotaDayStartUtc(inicio), lt: bogotaDayEndUtc(end) },
          },
          marca,
        ),
        _sum: { grossUsd: true },
      });
      const ventas = round2(Number(agg._sum.grossUsd ?? 0));
      const monto = comisionDeLaQuincena(ventas, porcentaje);
      const periodKey = `${PREFIJO}${corte}`;
      const nota = `Comisión de equipo: ${porcentaje}% de las ventas del ${inicio} al ${end} ($${ventas.toFixed(2)}, de Contabilidad).`;
      const lote = await this.prisma.payoutBatch.findUnique({
        where: { code: cutoffCode(corte) },
        select: { id: true, status: true },
      });
      // La quincena EN CURSO todavía no se paga: queda en espera hasta el día
      // de su corte. Nacía aprobada con disponibilidad futura, y el repaso
      // nocturno de cortes pasados la tomaba por «habilitada a mano» y la metía
      // en el corte anterior: la del 1–15 de octubre apareció en el del 30 de
      // septiembre (Sara, 2026-10-03). Desde el día del corte: aprobada, sin
      // los 15 días de espera de las comisiones de venta.
      const cerrada = hoy >= corte;
      const estado = cerrada ? CommissionStatus.APPROVED : CommissionStatus.PENDING;

      const existente = await this.prisma.commission.findFirst({
        where: { recipientCodeId: code.id, periodKey },
        select: { id: true, amount: true, status: true, paymentStatus: true, amountPaid: true, payoutBatchId: true },
      });
      if (existente) {
        // Pagada (o con un abono): el dinero salió, no se reescribe.
        if (existente.paymentStatus !== 'PENDING' || Number(existente.amountPaid) > 0) {
          quincenas.push({ corte, ventasUsd: ventas, comisionUsd: Number(existente.amount), accion: 'pagada, sin tocar' });
          continue;
        }
        const cambia = Math.abs(Number(existente.amount) - monto) >= 0.01;
        const sinCorte = cerrada && !existente.payoutBatchId && lote?.status === 'OPEN';
        // En un corte que no es el suyo (o antes de que su quincena cierre).
        const corteAjeno = !!existente.payoutBatchId && (!cerrada || existente.payoutBatchId !== lote?.id);
        const cambiaEstado = existente.status !== estado;
        const corteAnterior = existente.payoutBatchId;
        if (!cambia && !sinCorte && !corteAjeno && !cambiaEstado) {
          quincenas.push({ corte, ventasUsd: ventas, comisionUsd: monto, accion: 'al día' });
          continue;
        }
        // Condicional: si alguien la pagó en este instante, no se pisa.
        await this.prisma.commission.updateMany({
          where: { id: existente.id, paymentStatus: 'PENDING', amountPaid: 0 },
          data: {
            amount: monto,
            baseAmountUsd: ventas,
            appliedPercent: porcentaje,
            notes: nota,
            status: estado,
            ...(sinCorte ? { payoutBatchId: lote!.id } : {}),
            ...(corteAjeno ? { payoutBatchId: cerrada && lote?.status === 'OPEN' ? lote.id : null } : {}),
          },
        });
        // Los dos cortes tocados recalculan su total: el que la soltó y el que la tomó.
        const tocados = new Set([corteAnterior, sinCorte || (corteAjeno && cerrada) ? lote?.id : null]);
        for (const id of tocados) if (id) await recalcBatchTotal(this.prisma, id);
        quincenas.push({
          corte,
          ventasUsd: ventas,
          comisionUsd: monto,
          accion: corteAjeno ? 'sacada de un corte ajeno' : cambia ? 'recalculada' : sinCorte ? 'enganchada al corte' : 'estado al día',
        });
        continue;
      }
      if (monto <= 0) {
        quincenas.push({ corte, ventasUsd: ventas, comisionUsd: 0, accion: 'sin ventas' });
        continue;
      }
      await this.prisma.commission.create({
        data: {
          recipientCodeId: code.id,
          referralUseId: null,
          amount: monto,
          currency: 'USD',
          // Sin espera de 15 días: disponible el día de su corte.
          status: estado,
          paymentStatus: 'PENDING',
          amountPaid: 0,
          periodKey,
          businessDate: bogotaNoonUtc(end),
          availableAt: bogotaNoonUtc(end),
          baseAmountUsd: ventas,
          appliedPercent: porcentaje,
          notes: nota,
          ...(cerrada && lote?.status === 'OPEN' ? { payoutBatchId: lote.id } : {}),
        },
      });
      if (cerrada && lote?.status === 'OPEN') await recalcBatchTotal(this.prisma, lote.id);
      quincenas.push({ corte, ventasUsd: ventas, comisionUsd: monto, accion: 'creada' });
    }
    if (quincenas.some((q) => q.accion !== 'al día' && q.accion !== 'pagada, sin tocar' && q.accion !== 'sin ventas')) {
      this.logger.log(
        `Comisión de equipo (${code.ownerName}): ` +
          quincenas.map((q) => `${q.corte} $${q.comisionUsd} (${q.accion})`).join(' · '),
      );
    }
    return { activa: true as const, porcentaje, quincenas };
  }
}
