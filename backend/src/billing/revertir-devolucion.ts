/**
 * REVERTIR LAS COMISIONES DE UN PAGO DEVUELTO — reembolso, contracargo o disputa.
 *
 * Javier, 2026-11-23: cuando una venta o una renovación termina en devolución,
 * TODAS sus comisiones se revierten —closer, influencer, Project Manager,
 * socio—, cada una según si ya se pagó:
 *
 *   · No pagada  → se anula (closer/afiliado) o deja de contar en el total que
 *                  se le debe (PM y socio: su comisión se recalcula sola sobre
 *                  Contabilidad, y el ingreso devuelto ya no suma).
 *   · Ya pagada  → queda un AJUSTE negativo «por recuperar» que se descuenta
 *                  solo del siguiente corte de esa persona (`cutoff.service.ts`).
 *
 * Nada se borra: la comisión original queda, y el ajuste lleva en la nota de
 * qué comisión y de qué transacción sale.
 *
 * UNA SOLA VEZ POR TRANSACCIÓN, aunque llegue el mismo aviso tres veces, el
 * conciliador lo repase cada noche y un colaborador pulse «Registrar
 * devolución»:
 *   · anular es idempotente (lo anulado ya no es anulable);
 *   · cada ajuste tiene una clave fija, `DEVOL-<tx>-<comisión>`, con un índice
 *     ÚNICO parcial en la base (`apply-cancelacion-y-devoluciones-migration`):
 *     el segundo intento choca y se cuenta como «ya existía».
 *
 * Caso real que lo destapó (Protein Station, 2026-11-23): renovación del
 * 23-oct, disputa el 23-nov, y la comisión de $7,50 del influencer se PAGÓ ese
 * mismo día en el corte del 15-nov. Sin el ajuste, ese dinero salía y nadie lo
 * recuperaba.
 */
import { CommissionStatus } from '@prisma/client';
import {
  anularComisionesDeTransaccion,
  type ResultadoDeAnulacion,
} from './anular-comisiones-de-reembolso';
import { alcanceDeMarca, combinar } from '../finance/alcance-de-marca';
import { baseDelSocio, parteDelSocio, porcentajeDelSocio } from '../finance/socio';
import { mesContable } from '../common/periodo-contable';
import { bogotaYmd, nextCutoffYmd } from '../referrals/cutoff-calendar';
import {
  CLAVE_CODIGO,
  CLAVE_DESDE,
  CLAVE_PORCENTAJE,
  DESDE_POR_DEFECTO,
  PORCENTAJE_POR_DEFECTO,
  PREFIJO,
  comisionDeLaQuincena,
} from '../referrals/comision-de-equipo.service';
import {
  CLAVE_CODIGO_SOCIO,
  CLAVE_DESDE_SOCIO,
  DESDE_SOCIO_POR_DEFECTO,
  PREFIJO_SOCIO,
} from '../referrals/comision-del-socio.service';

/** Prefijo del `periodKey` de un ajuste de devolución (índice único parcial). */
export const PREFIJO_AJUSTE = 'DEVOL-';

/** La clave del ajuste: una por transacción devuelta y comisión recuperada. */
export function claveDelAjuste(tx: string, comisionId: string): string {
  return `${PREFIJO_AJUSTE}${tx}-${comisionId}`;
}

export type TipoDeDevolucion = 'REEMBOLSO' | 'CONTRACARGO' | 'DISPUTA';

const NOMBRE: Record<TipoDeDevolucion, string> = {
  REEMBOLSO: 'reembolso',
  CONTRACARGO: 'contracargo',
  DISPUTA: 'disputa',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AjusteCreado = {
  /** La comisión que se pagó y se recupera. */
  comisionId: string;
  recipientCodeId: string;
  /** Lo que se recupera (positivo; el ajuste guarda el negativo). */
  montoUsd: number;
  origen: 'VENTA' | 'EQUIPO' | 'SOCIO';
  /** `creado` ahora, o `yaExistia` de una pasada anterior (idempotencia). */
  resultado: 'creado' | 'yaExistia' | 'simulado';
};

export type ResultadoDeDevolucion = {
  anulacion: ResultadoDeAnulacion;
  ajustes: AjusteCreado[];
  /** Pagadas a nadie (sin destinatario): no hay de quién descontar. Se informa. */
  pagadasSinDestinatario: string[];
  /** Lo que se hizo con la comisión de equipo (PM) y la del socio. */
  equipo: string;
  socio: string;
};

type Db = any;

/** Nota del ajuste: qué se recupera, de qué comisión y por qué. */
export function notaDelAjuste(
  tipo: TipoDeDevolucion,
  tx: string,
  comisionId: string,
  montoUsd: number,
  cuando: Date,
  detalle?: string,
): string {
  return (
    `Ajuste por recuperar: ${NOMBRE[tipo]} del pago ${tx} (${cuando.toISOString().slice(0, 10)}). ` +
    `La comisión ${comisionId.slice(0, 8)} de $${montoUsd.toFixed(2)} ya se había pagado` +
    (detalle ? ` (${detalle})` : '') +
    '; se descuenta del siguiente corte de este colaborador.'
  );
}

/**
 * Crea el ajuste negativo, o reconoce que ya existía. El índice único parcial
 * sobre `periodKey` es lo que lo hace seguro ante dos pasadas simultáneas: no
 * se lee antes de escribir, se escribe y se mira si chocó.
 */
async function crearAjuste(
  db: Db,
  datos: {
    tx: string;
    comisionId: string;
    recipientCodeId: string;
    referralUseId?: string | null;
    businessGroupId?: string | null;
    montoUsd: number;
    nota: string;
    cuando: Date;
  },
): Promise<'creado' | 'yaExistia'> {
  try {
    await db.commission.create({
      data: {
        recipientCodeId: datos.recipientCodeId,
        referralUseId: datos.referralUseId ?? null,
        businessGroupId: datos.businessGroupId ?? null,
        amount: -round2(datos.montoUsd),
        currency: 'USD',
        status: CommissionStatus.ADJUSTMENT,
        paymentStatus: 'PENDING',
        amountPaid: 0,
        periodKey: claveDelAjuste(datos.tx, datos.comisionId),
        externalTxId: datos.tx,
        businessDate: datos.cuando,
        availableAt: datos.cuando,
        notes: datos.nota,
      },
    });
    return 'creado';
  } catch (e: any) {
    if (e?.code === 'P2002') return 'yaExistia';
    throw e;
  }
}

async function ajuste(db: Db, key: string): Promise<string | null> {
  const r = await db.setting.findUnique({ where: { key } }).catch(() => null);
  return r?.value?.trim() || null;
}

/** ¿Pagada (o con abono)? Mismo criterio que los crons de equipo y socio. */
function estaPagada(c: { paymentStatus: string; amountPaid: unknown }): boolean {
  return c.paymentStatus !== 'PENDING' || Number(c.amountPaid) > 0;
}

/**
 * PM (2 % de la quincena) y socio (10 % del mes): sus comisiones se calculan
 * sobre lo COBRADO en Contabilidad y se recalculan solas cada hora mientras no
 * se paguen. Con el ingreso ya marcado como devuelto, la NO pagada baja sola en
 * la siguiente pasada: no hay nada que hacer aquí. Solo la YA PAGADA necesita
 * un ajuste, por la parte que le correspondía a este ingreso.
 */
async function ajustesDeEquipoYSocio(
  db: Db,
  args: { tx: string; tipo: TipoDeDevolucion; cuando: Date; simular: boolean },
): Promise<{ ajustes: AjusteCreado[]; equipo: string; socio: string }> {
  const ajustes: AjusteCreado[] = [];
  const ingresos = await db.incomeRecord.findMany({
    where: { externalTxId: args.tx },
    select: { id: true, saleDate: true, grossUsd: true, netExpectedUsd: true },
  });
  if (!ingresos.length) {
    return { ajustes, equipo: 'sin ingreso en Contabilidad', socio: 'sin ingreso en Contabilidad' };
  }
  const marca = await alcanceDeMarca(db, true);

  // ── Equipo (Project Manager) ──
  let equipo = 'no configurada';
  const codigoEquipo = await ajuste(db, CLAVE_CODIGO);
  if (codigoEquipo) {
    const pctCrudo = Number(String((await ajuste(db, CLAVE_PORCENTAJE)) ?? PORCENTAJE_POR_DEFECTO).replace(',', '.'));
    const pct = Number.isFinite(pctCrudo) && pctCrudo > 0 && pctCrudo <= 100 ? pctCrudo : PORCENTAJE_POR_DEFECTO;
    const desde = (await ajuste(db, CLAVE_DESDE)) ?? DESDE_POR_DEFECTO;
    const partes: string[] = [];
    for (const ing of ingresos) {
      const dia = bogotaYmd(ing.saleDate);
      if (dia < desde) {
        partes.push('venta anterior a la comisión de equipo');
        continue;
      }
      // ¿Entraba en la base del 2 %? (mismo filtro que el cron: Clubify, sin
      // lo que pagan las marcas blancas). Sin el estado: ya no está PAGADO.
      const cuenta = await db.incomeRecord.count({ where: combinar({ id: ing.id, payerWhiteLabelId: null }, marca) });
      if (!cuenta) {
        partes.push('el ingreso no entra en la base del 2 %');
        continue;
      }
      const fila = await db.commission.findFirst({
        where: { recipientCodeId: codigoEquipo, periodKey: `${PREFIJO}${nextCutoffYmd(dia)}` },
        select: { id: true, paymentStatus: true, amountPaid: true },
      });
      if (!fila || !estaPagada(fila)) {
        partes.push('quincena sin pagar: se recalcula sola sin este ingreso');
        continue;
      }
      const monto = comisionDeLaQuincena(Number(ing.grossUsd), pct);
      if (monto <= 0) continue;
      const resultado = args.simular
        ? 'simulado'
        : await crearAjuste(db, {
            tx: args.tx,
            comisionId: fila.id,
            recipientCodeId: codigoEquipo,
            montoUsd: monto,
            cuando: args.cuando,
            nota: notaDelAjuste(args.tipo, args.tx, fila.id, monto, args.cuando, `${pct} % de equipo sobre $${Number(ing.grossUsd).toFixed(2)}`),
          });
      ajustes.push({ comisionId: fila.id, recipientCodeId: codigoEquipo, montoUsd: monto, origen: 'EQUIPO', resultado });
      partes.push(`quincena ya pagada: ajuste de -$${monto.toFixed(2)}`);
    }
    equipo = partes.join('; ') || 'sin cambios';
  }

  // ── Socio ──
  let socio = 'no configurada';
  const codigoSocio = await ajuste(db, CLAVE_CODIGO_SOCIO);
  const desdeSocioCrudo = await ajuste(db, CLAVE_DESDE_SOCIO);
  const desdeSocio = desdeSocioCrudo && /^\d{4}-(0[1-9]|1[0-2])$/.test(desdeSocioCrudo) ? desdeSocioCrudo : DESDE_SOCIO_POR_DEFECTO;
  if (codigoSocio) {
    const pct = await porcentajeDelSocio(db);
    const partes: string[] = [];
    for (const ing of ingresos) {
      const mes = bogotaYmd(ing.saleDate).slice(0, 7);
      if (mes < desdeSocio) {
        partes.push('mes anterior a la comisión del socio en el reporte');
        continue;
      }
      const cuenta = await db.incomeRecord.count({ where: combinar({ id: ing.id }, marca) });
      if (!cuenta) {
        partes.push('el ingreso no entra en la base del socio');
        continue;
      }
      const fila = await db.commission.findFirst({
        where: { recipientCodeId: codigoSocio, periodKey: `${PREFIJO_SOCIO}${mes}` },
        select: { id: true, paymentStatus: true, amountPaid: true },
      });
      if (!fila || !estaPagada(fila)) {
        partes.push('mes sin pagar: se recalcula solo sin este ingreso');
        continue;
      }
      const base = baseDelSocio(mesContable(ing.saleDate), Number(ing.grossUsd), Number(ing.netExpectedUsd));
      const monto = parteDelSocio(base, pct);
      if (monto <= 0) continue;
      const resultado = args.simular
        ? 'simulado'
        : await crearAjuste(db, {
            tx: args.tx,
            comisionId: fila.id,
            recipientCodeId: codigoSocio,
            montoUsd: monto,
            cuando: args.cuando,
            nota: notaDelAjuste(args.tipo, args.tx, fila.id, monto, args.cuando, `${pct} % del socio sobre $${base.toFixed(2)}`),
          });
      ajustes.push({ comisionId: fila.id, recipientCodeId: codigoSocio, montoUsd: monto, origen: 'SOCIO', resultado });
      partes.push(`mes ya pagado: ajuste de -$${monto.toFixed(2)}`);
    }
    socio = partes.join('; ') || 'sin cambios';
  }
  return { ajustes, equipo, socio };
}

/**
 * Revierte TODO lo que generó el pago `tx`. Llamarlo antes debe haberse
 * marcado el ingreso como devuelto (`IncomeRecordService.marcarDevuelto`): de
 * eso depende que PM y socio dejen de contarlo.
 *
 * `simular`: no escribe nada; dice lo que haría.
 */
export async function revertirComisionesDeDevolucion(
  db: Db,
  args: {
    tx: string;
    tipo: TipoDeDevolucion;
    motivo: string;
    tenantId?: string | null;
    fechaDelCobro?: Date | null;
    cuando?: Date;
    simular?: boolean;
  },
): Promise<ResultadoDeDevolucion> {
  const cuando = args.cuando ?? new Date();
  const simular = !!args.simular;

  // 1) Closers, influencers, embajadores, vendedores: por transacción.
  const anulacion = await anularComisionesDeTransaccion(db, args.tx, args.motivo, {
    tenantId: args.tenantId,
    fechaDelCobro: args.fechaDelCobro,
    simular,
  });

  // 2) Las que ya se habían pagado: ajuste por recuperar.
  const ajustes: AjusteCreado[] = [];
  const pagadasSinDestinatario: string[] = [];
  for (const d of anulacion.detalle) {
    if (d.que !== 'pagada') continue;
    const monto = round2(d.pagado ?? d.monto);
    if (monto <= 0) continue;
    if (!d.recipientCodeId) {
      pagadasSinDestinatario.push(d.id);
      continue;
    }
    const resultado = simular
      ? 'simulado'
      : await crearAjuste(db, {
          tx: args.tx,
          comisionId: d.id,
          recipientCodeId: d.recipientCodeId,
          referralUseId: d.referralUseId,
          businessGroupId: d.businessGroupId,
          montoUsd: monto,
          cuando,
          nota: notaDelAjuste(args.tipo, args.tx, d.id, monto, cuando),
        });
    ajustes.push({ comisionId: d.id, recipientCodeId: d.recipientCodeId, montoUsd: monto, origen: 'VENTA', resultado });
  }

  // 3) PM y socio.
  const es = await ajustesDeEquipoYSocio(db, { tx: args.tx, tipo: args.tipo, cuando, simular });

  return {
    anulacion,
    ajustes: [...ajustes, ...es.ajustes],
    pagadasSinDestinatario,
    equipo: es.equipo,
    socio: es.socio,
  };
}

/** Una línea para el log y la auditoría. */
export function resumenDeDevolucion(tx: string, r: ResultadoDeDevolucion): string {
  // En simulación cuentan los que se CREARÍAN.
  const creados = r.ajustes.filter((a) => a.resultado !== 'yaExistia');
  const existian = r.ajustes.filter((a) => a.resultado === 'yaExistia');
  const partes = [
    `${r.anulacion.anuladas} comisión(es) anulada(s)`,
    `${creados.length} ajuste(s) por recuperar ($${round2(creados.reduce((a, x) => a + x.montoUsd, 0)).toFixed(2)})`,
  ];
  if (existian.length) partes.push(`${existian.length} ajuste(s) ya existían`);
  if (r.anulacion.reactivadas) partes.push(`${r.anulacion.reactivadas} reactivada(s) a mano que se respetan`);
  if (r.anulacion.deOtroCiclo) partes.push(`${r.anulacion.deOtroCiclo} de otro ciclo sin tocar (revisar)`);
  if (r.pagadasSinDestinatario.length) partes.push(`${r.pagadasSinDestinatario.length} pagada(s) sin destinatario: recuperar a mano`);
  partes.push(`equipo: ${r.equipo}`, `socio: ${r.socio}`);
  return `Devolución ${tx}: ${partes.join(' · ')}.`;
}
