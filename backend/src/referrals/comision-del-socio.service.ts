import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { alcanceDeMarca, combinar } from '../finance/alcance-de-marca';
import { SOLO_LO_COBRADO } from '../finance/categorias-de-ingreso';
import { baseDelSocio, parteDelSocio, porcentajeDelSocio } from '../finance/socio';
import { mesContable } from '../common/periodo-contable';
import { recalcBatchTotal } from './payout-batch.util';
import { bogotaDayEndUtc, bogotaDayStartUtc, bogotaNoonUtc, bogotaYmd, cutoffCode, lastDayOfMonth } from './cutoff-calendar';

/**
 * COMISIÓN DEL SOCIO en el reporte de comisiones, UNA por mes.
 *
 * Javier (2026-11-03): el 10 % del socio sale en el reporte de comisiones desde
 * el corte de fin de octubre en adelante, y SOLO en el corte de fin de mes,
 * porque se le hace un único pago al mes. Ve el 10 % de la facturación GLOBAL:
 * pagos manuales, abonos, Hotmart, todo lo que Contabilidad tenga como cobrado.
 *
 * El monto es EXACTAMENTE la línea «Socio» de la cascada de utilidad
 * (`finance/socio.ts`: neto desde octubre de 2026, ventas de Clubify, todas
 * las pasarelas). Si se calculara aparte, el reporte y Contabilidad dirían dos
 * cifras distintas para el mismo pago.
 *
 * No se resta dos veces: el código del socio tiene rol SOCIO y la cascada saca
 * esas comisiones de «Comisiones pagadas» (`NO_ES_COMISION_DEL_SOCIO`); el
 * socio se sigue restando una sola vez, en su propia línea.
 *
 * Usa su propio ajuste (`comisiones.socio.codeId`), NO `referrals.socioCodeId`:
 * ese enciende la comisión de socio VENTA A VENTA del motor y, sumada a esta,
 * le pagaría dos veces.
 *
 * Como la de equipo, se recalcula cada hora mientras no esté pagada (un ingreso
 * que llega tarde o se corrige se refleja solo) y una pagada no se toca.
 */

export const CLAVE_CODIGO_SOCIO = 'comisiones.socio.codeId';
export const CLAVE_DESDE_SOCIO = 'comisiones.socio.desde';
/** Primer mes que paga por el reporte: octubre de 2026 (corte del 31-oct). */
export const DESDE_SOCIO_POR_DEFECTO = '2026-10';
export const PREFIJO_SOCIO = 'SOCIO-';

const ES_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Meses "YYYY-MM" de `desde` a `hasta`, incluidos. */
export function mesesDelSocio(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let [y, m] = desde.split('-').map(Number);
  for (let i = 0; i < 240; i++) {
    const mes = `${y}-${String(m).padStart(2, '0')}`;
    if (mes > hasta) break;
    out.push(mes);
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  return out;
}

/** Último día del mes, "YYYY-MM-DD": el día de su corte. */
export function corteDelMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
}

@Injectable()
export class ComisionDelSocioService {
  private readonly logger = new Logger(ComisionDelSocioService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('20 * * * *', { name: 'comisiones.socio' })
  async tick() {
    await this.recalcular().catch((e) =>
      this.logger.error(`comisión del socio falló: ${(e as Error).message}`),
    );
  }

  async recalcular(ahora = new Date()) {
    const ajuste = async (key: string) =>
      (await this.prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value?.trim() || null;
    const codeId = await ajuste(CLAVE_CODIGO_SOCIO);
    if (!codeId) return { activa: false as const, meses: [] };
    const desdeCrudo = await ajuste(CLAVE_DESDE_SOCIO);
    const desde = desdeCrudo && ES_MES.test(desdeCrudo) ? desdeCrudo : DESDE_SOCIO_POR_DEFECTO;

    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { id: true, ownerName: true, isActive: true, role: true },
    });
    // Sin rol SOCIO la cascada la contaría en «Comisiones pagadas» Y en
    // «Socio»: mejor no generar nada que pagarle dos veces.
    if (!code || code.isActive === false || code.role !== 'SOCIO') {
      return { activa: false as const, meses: [] };
    }

    const porcentaje = await porcentajeDelSocio(this.prisma);
    const hoy = bogotaYmd(ahora);
    const marca = await alcanceDeMarca(this.prisma, true);
    const meses: Array<{ mes: string; baseUsd: number; comisionUsd: number; accion: string }> = [];

    for (const mes of mesesDelSocio(desde, hoy.slice(0, 7))) {
      const corte = corteDelMes(mes);
      const filas = await this.prisma.incomeRecord.findMany({
        // Mismo alcance que la línea «Socio»: todo lo cobrado de Clubify en el
        // mes, venga de la pasarela que venga (manual, abono, Hotmart…).
        where: combinar(marca, SOLO_LO_COBRADO, {
          saleDate: { gte: bogotaDayStartUtc(`${mes}-01`), lt: bogotaDayEndUtc(corte) },
        }),
        select: { saleDate: true, grossUsd: true, netExpectedUsd: true },
      });
      const base =
        Math.round(
          filas.reduce(
            (a, f) => a + baseDelSocio(mesContable(f.saleDate), Number(f.grossUsd), Number(f.netExpectedUsd)),
            0,
          ) * 100,
        ) / 100;
      const monto = parteDelSocio(base, porcentaje);
      const periodKey = `${PREFIJO_SOCIO}${mes}`;
      const nota = `Comisión del socio: ${porcentaje}% de la facturación de ${mes} ($${base.toFixed(2)} de base, la misma de la línea «Socio» de Contabilidad).`;
      const lote = await this.prisma.payoutBatch.findUnique({
        where: { code: cutoffCode(corte) },
        select: { id: true, status: true },
      });
      // El mes en curso no se paga hasta su último día: no entra a ningún corte.
      const cerrado = hoy >= corte;
      const estado = cerrado ? CommissionStatus.APPROVED : CommissionStatus.PENDING;
      const engancha = cerrado && lote?.status === 'OPEN';

      const existente = await this.prisma.commission.findFirst({
        where: { recipientCodeId: code.id, periodKey },
        select: { id: true, amount: true, status: true, paymentStatus: true, amountPaid: true, payoutBatchId: true },
      });
      if (existente) {
        if (existente.paymentStatus !== 'PENDING' || Number(existente.amountPaid) > 0) {
          meses.push({ mes, baseUsd: base, comisionUsd: Number(existente.amount), accion: 'pagada, sin tocar' });
          continue;
        }
        const cambia = Math.abs(Number(existente.amount) - monto) >= 0.01;
        const sinCorte = engancha && !existente.payoutBatchId;
        // Solo puede estar en el corte de SU fin de mes, nunca en uno quincenal.
        const corteAjeno = !!existente.payoutBatchId && (!cerrado || existente.payoutBatchId !== lote?.id);
        const cambiaEstado = existente.status !== estado;
        if (!cambia && !sinCorte && !corteAjeno && !cambiaEstado) {
          meses.push({ mes, baseUsd: base, comisionUsd: monto, accion: 'al día' });
          continue;
        }
        const anterior = existente.payoutBatchId;
        await this.prisma.commission.updateMany({
          where: { id: existente.id, paymentStatus: 'PENDING', amountPaid: 0 },
          data: {
            amount: monto,
            baseAmountUsd: base,
            appliedPercent: porcentaje,
            notes: nota,
            status: estado,
            ...(sinCorte ? { payoutBatchId: lote!.id } : {}),
            ...(corteAjeno ? { payoutBatchId: engancha ? lote!.id : null } : {}),
          },
        });
        for (const id of new Set([anterior, sinCorte || (corteAjeno && engancha) ? lote?.id : null])) {
          if (id) await recalcBatchTotal(this.prisma, id);
        }
        meses.push({ mes, baseUsd: base, comisionUsd: monto, accion: cambia ? 'recalculada' : 'enganchada o al día' });
        continue;
      }
      if (monto <= 0) {
        meses.push({ mes, baseUsd: base, comisionUsd: 0, accion: 'sin ventas' });
        continue;
      }
      await this.prisma.commission.create({
        data: {
          recipientCodeId: code.id,
          referralUseId: null,
          amount: monto,
          currency: 'USD',
          status: estado,
          paymentStatus: 'PENDING',
          amountPaid: 0,
          periodKey,
          businessDate: bogotaNoonUtc(corte),
          availableAt: bogotaNoonUtc(corte),
          baseAmountUsd: base,
          appliedPercent: porcentaje,
          notes: nota,
          ...(engancha ? { payoutBatchId: lote!.id } : {}),
        },
      });
      if (engancha) await recalcBatchTotal(this.prisma, lote!.id);
      meses.push({ mes, baseUsd: base, comisionUsd: monto, accion: 'creada' });
    }
    if (meses.some((m) => !['al día', 'pagada, sin tocar', 'sin ventas'].includes(m.accion))) {
      this.logger.log(
        `Comisión del socio (${code.ownerName}): ` + meses.map((m) => `${m.mes} $${m.comisionUsd} (${m.accion})`).join(' · '),
      );
    }
    return { activa: true as const, porcentaje, meses };
  }
}
