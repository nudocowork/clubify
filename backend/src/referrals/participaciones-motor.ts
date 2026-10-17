/**
 * MOTOR DE PARTICIPACIONES GLOBALES — la parte que habla con la base.
 *
 * ── POR QUÉ SE ANCLA AL LIBRO DE INGRESOS ───────────────────────────────
 *
 * Una comisión de vendedor nace en SEIS caminos distintos (webhook de Hotmart
 * primer cobro y renovación, Stripe, Cross, pago manual, pendientes de
 * aprobación, upgrade), cada uno con su dedup y sus fechas. Enganchar la
 * participación en cada uno era repetir seis veces lo mismo y equivocarse en
 * alguno —es exactamente lo que pasó con el reparto embajador/influencer
 * (bitácora 134)—.
 *
 * Todos esos caminos SÍ coinciden en una cosa: escriben el cobro en
 * `IncomeRecord` (Contabilidad), una fila por transacción, con estado
 * PAGADO/REEMBOLSADO, marca, categoría (NUEVA/RENOVACION/UPGRADE) y fecha.
 * Ese es el «cobro confirmado» del que habla el dueño, así que la
 * participación nace de ahí: UNA fila de comisión por (regla, ingreso), con la
 * UNIQUE de la base como candado. Da igual cuántas veces llegue el webhook,
 * cuántas pase el cron o cuántas se corra el backfill.
 *
 * Este archivo NO importa nada de Nest: lo usan igual el servicio (con el
 * PrismaService), el cron y `scripts/backfill-participaciones.cjs` (con un
 * PrismaClient suelto, vía ts-node). Una sola cuenta para los tres.
 */
import {
  basePactadaDelCobro,
  comisionesDeParticipaciones,
  exclusionDeLaVenta,
  PREFIJO_PARTICIPACION,
  tipoDeVentaDeLaCategoria,
  type FilaDeParticipacion,
  type MotivoDeExclusion,
  type ReglaDeParticipacion,
  type VentaParaParticipar,
} from './reglas-de-comision';
import { DIAS_DE_HOLD } from './rango-de-fechas';

/** Lo mínimo del cliente de Prisma que usa el motor (el real o uno falso). */
export type DbDelMotor = any;

const DIA = 86_400_000;
/** Holgura para casar un cobro con la comisión del vendedor por fecha. Ver `clave-del-periodo.ts`. */
const MARGEN_MISMO_COBRO = 3 * DIA;

/** Marca escrita en la nota de una participación anulada por devolución. */
export const MARCA_ANULADA_POR_DEVOLUCION = 'Participación anulada: el cobro quedó';

// ── Precios canónicos ──────────────────────────────────────────────────────
/**
 * Los mismos ajustes y defaults que `SettingsService.getLandingPlans` (68 /
 * 150 / 278 / 500, editables en /admin/branding). Se repiten aquí porque el
 * backfill corre sin Nest; `participaciones-motor.spec.ts` comprueba que no
 * se separen.
 */
export const PRECIOS_CANONICOS_POR_DEFECTO: Record<string, number> = {
  MENSUAL: 68,
  TRIMESTRAL: 150,
  SEMESTRAL: 278,
  ANUAL: 500,
};

export async function preciosCanonicos(db: DbDelMotor): Promise<(per: string | null) => number> {
  const claves = Object.keys(PRECIOS_CANONICOS_POR_DEFECTO).map(
    (p) => `landing.plans.${p.toLowerCase()}.price`,
  );
  const filas: Array<{ key: string; value: string }> = await db.setting
    .findMany({ where: { key: { in: claves } } })
    .catch(() => []);
  const mapa = new Map(filas.map((f) => [f.key, f.value]));
  const tabla: Record<string, number> = {};
  for (const [per, def] of Object.entries(PRECIOS_CANONICOS_POR_DEFECTO)) {
    const n = Number(mapa.get(`landing.plans.${per.toLowerCase()}.price`));
    tabla[per] = Number.isFinite(n) && n > 0 ? n : def;
  }
  return (per) => (per ? tabla[per.toUpperCase()] ?? 0 : 0);
}

/** Id de la marca Clubify (o null en entornos sin la fila). */
export async function idDeClubify(db: DbDelMotor): Promise<string | null> {
  const wl = await db.whiteLabel
    .findFirst({ where: { slug: 'clubify' }, select: { id: true } })
    .catch(() => null);
  return wl?.id ?? null;
}

const esDeLaPlataforma = (wl: string | null | undefined, clubify: string | null) =>
  wl == null || (clubify != null && wl === clubify);

/** Mes contable en Bogotá (UTC−5, sin horario de verano). */
function mesBogota(d: Date): string {
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 7);
}

// ── Reglas ───────────────────────────────────────────────────────────────
export async function cargarReglas(db: DbDelMotor, opts: { soloActivas?: boolean } = {}): Promise<ReglaDeParticipacion[]> {
  const filas = await db.participacionGlobal.findMany({
    where: opts.soloActivas === false ? {} : { activo: true },
    orderBy: { createdAt: 'asc' },
  });
  return filas.map((r: any) => ({ ...r, valor: Number(r.valor) }));
}

// ── Evaluación ───────────────────────────────────────────────────────────
export type IngresoParaEvaluar = {
  id: string;
  externalTxId: string;
  gateway: string;
  tenantId: string | null;
  businessGroupId: string | null;
  whiteLabelId: string | null;
  payerWhiteLabelId: string | null;
  brandName: string | null;
  planId: string | null;
  planPeriodicity: string | null;
  category: string | null;
  isFirstPayment: boolean;
  status: string;
  grossUsd: unknown;
  periodKey: string | null;
  saleDate: Date;
  createdAt: Date;
};

export const SELECT_INGRESO = {
  id: true,
  externalTxId: true,
  gateway: true,
  tenantId: true,
  businessGroupId: true,
  whiteLabelId: true,
  payerWhiteLabelId: true,
  brandName: true,
  planId: true,
  planPeriodicity: true,
  category: true,
  isFirstPayment: true,
  status: true,
  grossUsd: true,
  periodKey: true,
  saleDate: true,
  createdAt: true,
} as const;

export type Evaluacion = {
  ingreso: IngresoParaEvaluar;
  venta: VentaParaParticipar;
  filas: FilaDeParticipacion[];
  exclusion: MotivoDeExclusion | null;
};

/**
 * Convierte cada ingreso en una venta (base pactada, marca, tipo) y le aplica
 * las reglas. No escribe nada. Carga negocios, grupos y comisiones del cobro
 * en tres consultas por tanda, no tres por ingreso.
 */
export async function evaluarIngresos(
  db: DbDelMotor,
  ingresos: readonly IngresoParaEvaluar[],
  reglas: readonly ReglaDeParticipacion[],
  opts: { enVivo: boolean },
): Promise<Evaluacion[]> {
  if (!ingresos.length) return [];
  const clubify = await idDeClubify(db);
  const canonico = await preciosCanonicos(db);

  const tenantIds = [...new Set(ingresos.map((i) => i.tenantId).filter((x): x is string => !!x))];
  const grupoIds = [...new Set(ingresos.map((i) => i.businessGroupId).filter((x): x is string => !!x))];
  const txs = [...new Set(ingresos.map((i) => i.externalTxId).filter(Boolean))];

  const negocios: Array<{ id: string; whiteLabelId: string | null; subscriptionPriceUsd: unknown; planPeriodicity: string | null }> =
    tenantIds.length
      ? await db.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, whiteLabelId: true, subscriptionPriceUsd: true, planPeriodicity: true },
        })
      : [];
  const grupos: Array<{ id: string; whiteLabelId: string | null; priceUsd: unknown; planPeriodicity: string | null }> =
    grupoIds.length
      ? await db.businessGroup.findMany({
          where: { id: { in: grupoIds } },
          select: { id: true, whiteLabelId: true, priceUsd: true, planPeriodicity: true },
        })
      : [];
  // Las comisiones de VENDEDOR de estos cobros (no participaciones, no equipo):
  // su `baseAmountUsd` es el precio pactado con el que ya nació la venta.
  const comisiones: Array<{
    externalTxId: string | null;
    hotmartTransactionId: string | null;
    baseAmountUsd: unknown;
    businessDate: Date | null;
    businessGroupId: string | null;
    periodKey: string | null;
    referralUse: { tenantId: string | null } | null;
  }> = await db.commission.findMany({
    where: {
      participacionId: null,
      status: { not: 'REJECTED' },
      baseAmountUsd: { gt: 0 },
      OR: [
        ...(txs.length ? [{ externalTxId: { in: txs } }, { hotmartTransactionId: { in: txs } }] : []),
        ...(tenantIds.length ? [{ referralUse: { tenantId: { in: tenantIds } } }] : []),
        ...(grupoIds.length ? [{ businessGroupId: { in: grupoIds } }] : []),
      ],
    },
    select: {
      externalTxId: true,
      hotmartTransactionId: true,
      baseAmountUsd: true,
      businessDate: true,
      businessGroupId: true,
      periodKey: true,
      referralUse: { select: { tenantId: true } },
    },
  });
  const negocioPorId = new Map(negocios.map((n) => [n.id, n]));
  const grupoPorId = new Map(grupos.map((g) => [g.id, g]));

  const baseDeLaComision = (i: IngresoParaEvaluar): number | null => {
    // EQUIPO no es de un cobro; IMPL no es de un plan.
    const utiles = comisiones.filter((c) => !/^(EQUIPO|IMPL)-/.test(c.periodKey ?? ''));
    const porTx = utiles.find((c) => c.externalTxId === i.externalTxId || c.hotmartTransactionId === i.externalTxId);
    const delDueño =
      porTx ??
      utiles.find(
        (c) =>
          (i.businessGroupId
            ? c.businessGroupId === i.businessGroupId
            : !!i.tenantId && c.referralUse?.tenantId === i.tenantId) &&
          !!c.businessDate &&
          Math.abs(new Date(c.businessDate).getTime() - i.saleDate.getTime()) <= MARGEN_MISMO_COBRO,
      );
    const n = delDueño ? Number(delDueño.baseAmountUsd) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return ingresos.map((i) => {
    const negocio = i.tenantId ? negocioPorId.get(i.tenantId) ?? null : null;
    const grupo = i.businessGroupId ? grupoPorId.get(i.businessGroupId) ?? null : null;
    const tipo = tipoDeVentaDeLaCategoria(i.category, i.isFirstPayment);
    // El dinero es de Clubify si el ingreso, el negocio (o grupo) son de la
    // plataforma y no lo pagó una marca blanca. Lo que paga una marca blanca
    // (créditos, rebranding) SÍ es ingreso de Clubify, pero no es una venta de
    // plan: queda fuera y se informa (ver el resumen del backfill).
    const esDeClubify =
      esDeLaPlataforma(i.whiteLabelId, clubify) &&
      !i.payerWhiteLabelId &&
      (!negocio || esDeLaPlataforma(negocio.whiteLabelId, clubify)) &&
      (!grupo || esDeLaPlataforma(grupo.whiteLabelId, clubify));
    const venta: VentaParaParticipar = {
      ingresoId: i.id,
      estado: i.status,
      tipo,
      esDeClubify,
      tenantId: i.tenantId,
      businessGroupId: i.businessGroupId,
      fecha: new Date(i.saleDate),
      periodicidad: i.planPeriodicity ?? grupo?.planPeriodicity ?? negocio?.planPeriodicity ?? null,
      planId: i.planId,
      baseUsd: null,
    };
    // La base solo se busca si la venta podría participar: no hace falta
    // explicar «sin precio» de algo que ya está fuera por reembolso.
    if (!exclusionDeLaVenta({ ...venta, baseUsd: 1 })) {
      venta.baseUsd = basePactadaDelCobro({
        baseDeLaComisionDelCobro: baseDeLaComision(i),
        tipo,
        grossUsd: Number(i.grossUsd),
        periodicidadDelCobro: i.planPeriodicity,
        grupo: grupo ? { priceUsd: Number(grupo.priceUsd ?? 0), planPeriodicity: grupo.planPeriodicity } : null,
        negocio: negocio
          ? { subscriptionPriceUsd: Number(negocio.subscriptionPriceUsd ?? 0), planPeriodicity: negocio.planPeriodicity }
          : null,
        canonico,
      });
    }
    const { filas, exclusion } = comisionesDeParticipaciones(
      venta,
      reglas,
      opts.enVivo ? { soloVigentesEnVivo: { ingresoCreadoEl: new Date(i.createdAt) } } : {},
    );
    return { ingreso: i, venta, filas, exclusion };
  });
}

// ── Escritura ────────────────────────────────────────────────────────────
export type OpcionesDeEscritura = {
  /** PENDING (por defecto) o RETAINED (frenada hasta que alguien la apruebe). */
  estado?: 'PENDING' | 'RETAINED';
  /** Texto que se antepone a la nota (el backfill marca las suyas). */
  prefijoDeNota?: string;
};

/**
 * Escribe las filas evaluadas. `createMany` con `skipDuplicates` = `ON CONFLICT
 * DO NOTHING` sobre la UNIQUE (participacionId, ingresoId): una fila que ya
 * existe —viva, pagada o anulada— no se vuelve a crear. Por eso una
 * participación anulada por un reembolso no «revive» si el cron la evalúa otra
 * vez, y el backfill corrido dos veces escribe cero la segunda.
 */
export async function escribirParticipaciones(
  db: DbDelMotor,
  evaluaciones: readonly Evaluacion[],
  reglas: readonly ReglaDeParticipacion[],
  opts: OpcionesDeEscritura = {},
): Promise<{ intentadas: number; creadas: number }> {
  const reglaPorId = new Map(reglas.map((r) => [r.id, r]));
  const data = evaluaciones.flatMap((e) =>
    e.filas.map((f) => {
      const regla = reglaPorId.get(f.participacionId);
      const fecha = e.venta.fecha;
      const cuanto =
        f.appliedPercent != null
          ? `${f.appliedPercent}% del precio del plan ($${f.baseAmountUsd.toFixed(2)})`
          : `$${f.amount.toFixed(2)} fijos`;
      const nota =
        (opts.prefijoDeNota ? `${opts.prefijoDeNota} ` : '') +
        `Participación «${regla?.nombre ?? f.participacionId}»: ${cuanto} — ` +
        `${e.ingreso.brandName ?? 'negocio'}, ${e.venta.tipo === 'RENOVACION' ? 'renovación' : e.venta.tipo === 'UPGRADE' ? 'upgrade' : 'venta nueva'} ` +
        `del ${fecha.toISOString().slice(0, 10)} (${e.ingreso.gateway} ${e.ingreso.externalTxId}).`;
      return {
        referralUseId: null,
        recipientCodeId: f.recipientCodeId,
        amount: f.amount,
        currency: 'USD',
        status: opts.estado ?? 'PENDING',
        paymentStatus: 'PENDING',
        amountPaid: 0,
        // PART-<mes del cobro>: prefijo de «monto libre» (ver
        // comisiones-de-monto-libre.ts) para que ningún recálculo la toque.
        periodKey: `${PREFIJO_PARTICIPACION}${e.ingreso.periodKey ?? mesBogota(fecha)}`,
        businessDate: fecha,
        // Misma retención que cualquier comisión de la casa, desde el cobro.
        availableAt: new Date(fecha.getTime() + DIAS_DE_HOLD * DIA),
        baseAmountUsd: f.baseAmountUsd,
        appliedPercent: f.appliedPercent,
        // La transacción del cobro: con ella la anulación por reembolso de
        // Hotmart (`anular-comisiones-de-reembolso.ts`) también la encuentra.
        // NO se pone `hotmartTransactionId`: el motor del vendedor deduplica
        // por ese campo + destinatario, y si la beneficiaria vendiera ese mismo
        // negocio, su comisión de venta se daría por «ya creada».
        externalTxId: e.ingreso.externalTxId,
        participacionId: f.participacionId,
        ingresoId: f.ingresoId,
        ventaTenantId: e.ingreso.tenantId,
        notes: nota,
      };
    }),
  );
  if (!data.length) return { intentadas: 0, creadas: 0 };
  let creadas = 0;
  // Tandas: un backfill de todo el histórico no cabe en una sola sentencia.
  for (let i = 0; i < data.length; i += 500) {
    const r = await db.commission.createMany({ data: data.slice(i, i + 500), skipDuplicates: true });
    creadas += r?.count ?? 0;
  }
  return { intentadas: data.length, creadas };
}

/**
 * Anula (REJECTED con nota) las participaciones VIVAS y SIN PAGAR de cobros que
 * quedaron REEMBOLSADO o CANCELADO, por cualquier pasarela. Lo pagado no se
 * retracta (regla de Javier y Sara, 2026-09-18).
 *
 * Una que ya se anuló por esto y alguien reactivó a mano no se vuelve a anular:
 * se reconoce por la nota (mismo criterio que `fueReactivada`).
 */
export async function anularParticipacionesDevueltas(
  db: DbDelMotor,
  opts: { simular?: boolean; ahora?: Date } = {},
): Promise<Array<{ id: string; ingresoId: string; estado: string; amount: number }>> {
  const vivas: Array<{ id: string; ingresoId: string | null; amount: unknown; notes: string | null }> =
    await db.commission.findMany({
      where: {
        participacionId: { not: null },
        status: { in: ['PENDING', 'APPROVED', 'RETAINED'] },
        paymentStatus: 'PENDING',
        amountPaid: { lte: 0 },
        payoutItem: { is: null },
      },
      select: { id: true, ingresoId: true, amount: true, notes: true },
    });
  const ids = [...new Set(vivas.map((v) => v.ingresoId).filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const devueltos: Array<{ id: string; status: string }> = await db.incomeRecord.findMany({
    where: { id: { in: ids }, status: { in: ['REEMBOLSADO', 'CANCELADO'] } },
    select: { id: true, status: true },
  });
  const estadoPorId = new Map(devueltos.map((d) => [d.id, d.status]));
  const hoy = (opts.ahora ?? new Date()).toISOString().slice(0, 10);
  const anuladas: Array<{ id: string; ingresoId: string; estado: string; amount: number }> = [];
  for (const v of vivas) {
    const estado = v.ingresoId ? estadoPorId.get(v.ingresoId) : undefined;
    if (!estado) continue;
    if (v.notes?.includes(MARCA_ANULADA_POR_DEVOLUCION)) continue; // reactivada a mano
    anuladas.push({ id: v.id, ingresoId: v.ingresoId as string, estado, amount: Number(v.amount) });
    if (opts.simular) continue;
    // Condicional: si alguien la pagó entre la lectura y aquí, no se toca.
    await db.commission.updateMany({
      where: { id: v.id, status: { in: ['PENDING', 'APPROVED', 'RETAINED'] }, paymentStatus: 'PENDING', amountPaid: { lte: 0 } },
      data: {
        status: 'REJECTED',
        notes: `${v.notes ? `${v.notes}\n` : ''}${MARCA_ANULADA_POR_DEVOLUCION} ${estado} el ${hoy}. No se había pagado.`,
      },
    });
  }
  return anuladas;
}
