import { CommissionStatus } from '@prisma/client';
import { alcanceDeMarca, combinar, marcaClubify } from './alcance-de-marca';

/**
 * CONSISTENCIA DEL DINERO: una misma operación debe decir lo mismo en todos
 * lados (Javier, 2026-10-02).
 *
 * Cobro → ingreso → comisión → historial → corte → utilidad. Cada eslabón lo
 * escribe un proceso distinto (el webhook, el conciliador, el pago manual, la
 * asignación de un afiliado), y cuando uno se salta nadie se entera: no hay
 * error, solo un número que falta. Así aparecieron en septiembre una comisión
 * de grupo de $150 contra un ingreso de $68, tres ingresos sin nombre de
 * negocios que pagaron antes de registrarse, y un negocio activo con su pago
 * sin enlazar.
 *
 * Esto NO arregla nada: señala, para que llegue en la revisión diaria y no el
 * día que la contadora cuadra contra el banco. Los arreglos están en el código
 * que escribe cada eslabón; esto es la red debajo.
 *
 * Mira solo lo reciente y desde septiembre de 2026: lo anterior es la época de
 * las reconstrucciones a mano y dispararía avisos sin arreglo posible.
 *
 * Y solo CLUBIFY (su marca y los registros sin marca), como la vista por
 * defecto de Contabilidad: las ventas de una marca blanca —Sellea cobra por
 * Stripe— son de esa marca, no de Clubify (Javier, 2026-10-02). Sus comisiones
 * son además terreno de Jhon.
 */

export type TipoDeInconsistencia =
  | 'COMISION_SIN_INGRESO'
  | 'INGRESO_SIN_COMISION'
  | 'PAGO_SIN_NEGOCIO'
  | 'MONTO_DISTINTO'
  | 'COBRO_DE_GRUPO_EN_UN_NEGOCIO';

export type Inconsistencia = { tipo: TipoDeInconsistencia; quien: string; detalle: string };

export const ETIQUETA: Record<TipoDeInconsistencia, { titulo: string; queHacer: string }> = {
  COMISION_SIN_INGRESO: {
    titulo: 'Comisión sin ingreso contable',
    queHacer: 'La comisión existe y su cobro no está en Contabilidad: correr «Conciliar ingresos»',
  },
  INGRESO_SIN_COMISION: {
    titulo: 'Ingreso sin comisión',
    queHacer: 'El negocio tiene afiliado y su cobro no generó comisión: «Generar comisión ahora» en su ficha',
  },
  PAGO_SIN_NEGOCIO: {
    titulo: 'Pago confirmado sin negocio',
    queHacer: 'Hotmart cobró y el ingreso no tiene dueño: asignarlo en «Pagos sin activar»',
  },
  MONTO_DISTINTO: {
    titulo: 'Inconsistencia de monto',
    queHacer: 'La comisión se calculó sobre otra cifra que la de Contabilidad para el mismo cobro',
  },
  COBRO_DE_GRUPO_EN_UN_NEGOCIO: {
    titulo: 'Inconsistencia de grupo empresarial',
    queHacer: 'El cobro del grupo está apuntado a uno de sus negocios: correr «Conciliar ingresos»',
  },
};

/** Desde cuándo se mira (inclusive). */
export const DESDE_SEPTIEMBRE = new Date('2026-09-01T05:00:00.000Z');
const DIA = 86_400_000;
/** Distancia entre la fecha de una comisión y la de su cobro. */
const MARGEN = 5 * DIA;

type Db = any;

/** Comisiones de negocios o grupos de Clubify (su marca o sin marca). */
async function soloDeClubify(prisma: Db) {
  const id = await marcaClubify(prisma);
  const marcas = id ? [id, null] : [null];
  const deMarca = (m: string | null) => ({ whiteLabelId: m });
  return {
    AND: [
      {
        OR: [
          { referralUse: { is: { tenant: { is: { OR: marcas.map(deMarca) } } } } },
          { businessGroup: { is: { OR: marcas.map(deMarca) } } },
        ],
      },
    ],
  };
}

export async function revisarConsistencia(
  prisma: Db,
  ahora = new Date(),
): Promise<Inconsistencia[]> {
  const desde = new Date(Math.max(DESDE_SEPTIEMBRE.getTime(), ahora.getTime() - 60 * DIA));
  // Un cobro de hace menos de 2 días puede estar todavía en camino (el webhook
  // y el conciliador nocturno aún no han pasado): no es inconsistencia.
  const hasta = new Date(ahora.getTime() - 2 * DIA);
  const out: Inconsistencia[] = [];

  const ingresos: Array<{
    externalTxId: string;
    tenantId: string | null;
    businessGroupId: string | null;
    brandName: string | null;
    grossUsd: unknown;
    saleDate: Date;
    category: string | null;
    payerWhiteLabelId?: string | null;
  }> = await prisma.incomeRecord.findMany({
    where: combinar(
      { status: 'PAGADO', saleDate: { gte: new Date(desde.getTime() - MARGEN), lte: ahora } },
      await alcanceDeMarca(prisma, true),
    ),
    select: {
      externalTxId: true, tenantId: true, businessGroupId: true, brandName: true,
      grossUsd: true, saleDate: true, category: true, payerWhiteLabelId: true,
    },
  });
  const ingresoPorTx = new Map(ingresos.map((i) => [i.externalTxId, i]));

  const comisiones: Array<{
    id: string;
    hotmartTransactionId: string | null;
    businessDate: Date | null;
    createdAt: Date;
    baseAmountUsd: unknown;
    businessGroupId: string | null;
    periodKey: string | null;
    referralUse: { tenantId: string | null; tenant: { brandName: string } | null } | null;
    businessGroup: { name: string } | null;
  }> = await prisma.commission.findMany({
    where: {
      status: { not: CommissionStatus.REJECTED },
      ...(await soloDeClubify(prisma)),
      OR: [{ businessDate: { gte: desde, lte: hasta } }, { businessDate: null, createdAt: { gte: desde, lte: hasta } }],
    },
    select: {
      id: true, hotmartTransactionId: true, businessDate: true, createdAt: true,
      baseAmountUsd: true, businessGroupId: true, periodKey: true,
      referralUse: { select: { tenantId: true, tenant: { select: { brandName: true } } } },
      businessGroup: { select: { name: true } },
    },
  });

  const cerca = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) <= MARGEN;

  // A + D: cada comisión, contra el ingreso de SU cobro.
  for (const c of comisiones) {
    // Implementación, upgrade y equipo tienen su propio dinero (no un cobro de plan).
    if (c.periodKey && /^(UPG|IMPL|ONCE|EQUIPO)/.test(c.periodKey)) continue;
    const fecha = c.businessDate ?? c.createdAt;
    const quien = c.businessGroup?.name ?? c.referralUse?.tenant?.brandName ?? '—';
    const porTx = c.hotmartTransactionId ? ingresoPorTx.get(c.hotmartTransactionId) : undefined;
    const delDueño = ingresos.find((i) =>
      (c.businessGroupId ? i.businessGroupId === c.businessGroupId : i.tenantId && i.tenantId === c.referralUse?.tenantId) &&
      cerca(i.saleDate, fecha),
    );
    const ingreso = porTx ?? delDueño;
    if (!ingreso) {
      out.push({ tipo: 'COMISION_SIN_INGRESO', quien, detalle: `comisión del ${fecha.toISOString().slice(0, 10)}` });
      continue;
    }
    const base = c.baseAmountUsd != null ? Number(c.baseAmountUsd) : null;
    if (base != null && Math.abs(base - Number(ingreso.grossUsd)) > 1) {
      out.push({ tipo: 'MONTO_DISTINTO', quien, detalle: `comisión sobre $${base}, ingreso de $${Number(ingreso.grossUsd)}` });
    }
  }

  // B: ingresos de negocios con afiliado sin comisión de ese cobro.
  const conAfiliado: Array<{ tenantId: string; createdAt: Date; id: string }> = await prisma.referralUse.findMany({
    where: {
      tenantId: { in: [...new Set(ingresos.map((i) => i.tenantId).filter(Boolean))] as string[] },
      status: { in: ['PAYING', 'ACTIVE'] },
    },
    select: { id: true, tenantId: true, createdAt: true },
  });
  for (const i of ingresos) {
    if (!i.tenantId || i.saleDate < desde || i.saleDate > hasta) continue;
    const uses = conAfiliado.filter((u) => u.tenantId === i.tenantId && u.createdAt.getTime() <= i.saleDate.getTime() + 2 * DIA);
    if (!uses.length) continue;
    const tiene = comisiones.some(
      (c) => c.referralUse?.tenantId === i.tenantId &&
        (c.hotmartTransactionId === i.externalTxId || cerca(c.businessDate ?? c.createdAt, i.saleDate)),
    );
    if (!tiene) {
      out.push({ tipo: 'INGRESO_SIN_COMISION', quien: i.brandName ?? i.tenantId, detalle: `cobro del ${i.saleDate.toISOString().slice(0, 10)}` });
    }
  }

  // C: cobros apuntados SIN dueño (ni negocio ni grupo). Un pack de créditos
  // es sin negocio a propósito: va con categoría OTRO. Lo que paga una marca
  // blanca (rebranding, servicios) tampoco es de un negocio: su dueño es ella.
  for (const i of ingresos) {
    if (i.tenantId || i.businessGroupId || i.category === 'OTRO' || i.payerWhiteLabelId) continue;
    if (i.saleDate < desde || i.saleDate > hasta) continue;
    out.push({ tipo: 'PAGO_SIN_NEGOCIO', quien: i.externalTxId, detalle: `$${Number(i.grossUsd)} del ${i.saleDate.toISOString().slice(0, 10)}` });
  }

  // E: cobro apuntado a un negocio cuyo código de suscripción es el de un grupo.
  const grupos: Array<{ hotmartSubscriberCode: string | null; name: string }> = await prisma.businessGroup.findMany({
    where: { deletedAt: null, hotmartSubscriberCode: { not: null } },
    select: { hotmartSubscriberCode: true, name: true },
  });
  if (grupos.length) {
    const codigos = new Map(grupos.map((g) => [g.hotmartSubscriberCode, g.name]));
    const negocios: Array<{ id: string; hotmartSubscriberCode: string | null }> = await prisma.tenant.findMany({
      where: { hotmartSubscriberCode: { in: [...codigos.keys()] } },
      select: { id: true, hotmartSubscriberCode: true },
    });
    const deGrupo = new Map(negocios.map((t) => [t.id, codigos.get(t.hotmartSubscriberCode)]));
    for (const i of ingresos) {
      if (i.tenantId && deGrupo.has(i.tenantId) && i.saleDate >= desde) {
        out.push({ tipo: 'COBRO_DE_GRUPO_EN_UN_NEGOCIO', quien: `${deGrupo.get(i.tenantId)}`, detalle: `apuntado a ${i.brandName}` });
      }
    }
  }
  return out;
}
