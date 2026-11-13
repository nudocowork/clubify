import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  exclusion,
  montoDudoso,
  motivoFuera,
  porcentaje,
  promedio,
  type FilaVentana,
  type NegocioCrudo,
} from './recompra-calculo';

// SOLO LECTURA y solo agregados POR NEGOCIO: ninguna consulta devuelve nombre,
// teléfono, correo ni id de un cliente final.
//
// Definiciones (las del informe de casos de éxito, 2026-11-13):
//  - Compra = sello STAMP/VISIT/POINTS_ADD/CASHBACK_ADD sin `giftReason`.
//  - Visita = los sellos del mismo cliente con menos de 2 h entre sí. Sin esto,
//    quien tiene dos tarjetas del negocio y recibe un sello en cada una en la
//    misma compra cuenta como «recompra». El monto de la visita es el MAYOR.
//  - Histórico: clientes = con tarjeta activa; recurrentes = 2+ visitas.
//  - 90 días: clientes = con tarjeta activa y 1+ visita en la ventana;
//    recurrentes = 2+ visitas en la ventana.

const COMPRA = `s.action IN ('STAMP','VISIT','POINTS_ADD','CASHBACK_ADD') AND s."giftReason" IS NULL`;
const DESDE_MONTO_OBLIGATORIO = '2026-05-10';
// El cálculo recorre todos los sellos de la plataforma: decenas de segundos
// por el proxy público de la base. Se guarda unas horas; «Recalcular» lo fuerza.
const VIGENCIA_MS = 6 * 60 * 60 * 1000;
const MESES_SERIE = 12;

const VISITAS_CTE = (filtro: string) => `
  activos AS (
    SELECT DISTINCT ps."tenantId", ps."customerId" FROM "Pass" ps WHERE ps.status IN ('ACTIVE','COMPLETED')
  ),
  sellos_crudos AS (
    SELECT s."tenantId", s."customerId", s."createdAt", s."purchaseAmount",
           CASE WHEN s."createdAt" - lag(s."createdAt") OVER (PARTITION BY s."tenantId", s."customerId" ORDER BY s."createdAt") < interval '2 hours'
                THEN 0 ELSE 1 END AS nueva
      FROM "Stamp" s JOIN activos a ON a."tenantId" = s."tenantId" AND a."customerId" = s."customerId"
     WHERE ${COMPRA} ${filtro}
  ),
  numeradas AS (
    SELECT *, sum(nueva) OVER (PARTITION BY "tenantId", "customerId" ORDER BY "createdAt") AS visita FROM sellos_crudos
  ),
  compras AS (
    SELECT "tenantId", "customerId", min("createdAt") "createdAt", max("purchaseAmount") "purchaseAmount"
      FROM numeradas GROUP BY "tenantId", "customerId", visita
  )`;

type FilaSql = {
  tenantId: string;
  unicos: number;
  recurrentes: number;
  visitas: number;
  dias_entre: unknown;
  ingresos: unknown;
  con_monto: number;
};

export type MesSerie = { mes: string; clientes: number; regresan: number; visitas: number };

export type NegocioRecompra = {
  id: string;
  nombre: string;
  marca: string;
  status: string;
  currency: string;
  alta: string;
  fuera: string | null;
  montoDudoso: boolean;
  historico: (FilaVentana & { recompra: number | null; frecuencia: number | null }) | null;
  ultimos90: (FilaVentana & { recompra: number | null; frecuencia: number | null }) | null;
  serie: MesSerie[];
};

export type ResumenRecompra = {
  generado: string;
  definiciones: { minClientes: number; minDias: number; visitaHoras: number };
  promedio: { historico: ReturnType<typeof promedio>; ultimos90: ReturnType<typeof promedio> };
  serie: Array<MesSerie & { tasa: number | null }>;
  negocios: NegocioRecompra[];
};

const num = (v: unknown) => (v == null ? null : Number(v));

@Injectable()
export class EstadisticasRecompraService {
  private readonly log = new Logger(EstadisticasRecompraService.name);
  private cache: { en: number; datos: Promise<ResumenRecompra> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  resumen(refrescar = false): Promise<ResumenRecompra> {
    if (!refrescar && this.cache && Date.now() - this.cache.en < VIGENCIA_MS) return this.cache.datos;
    const datos = this.calcular();
    this.cache = { en: Date.now(), datos };
    // Si falla, no dejar el error guardado 6 horas.
    datos.catch((e) => {
      this.log.error(`recompra: ${e?.message ?? e}`);
      this.cache = null;
    });
    return datos;
  }

  private ventana(dias: number | null) {
    const filtro = dias ? `AND s."createdAt" >= now() - interval '${dias} days'` : '';
    return this.prisma.$queryRawUnsafe<FilaSql[]>(`
      WITH ${VISITAS_CTE(filtro)},
      por_cliente AS (SELECT "tenantId", "customerId", count(*) n FROM compras GROUP BY 1, 2),
      saltos AS (
        SELECT "tenantId", "customerId",
               EXTRACT(EPOCH FROM ("createdAt" - lag("createdAt") OVER (PARTITION BY "tenantId", "customerId" ORDER BY "createdAt"))) / 86400.0 dias
          FROM compras
      ),
      por_cliente_saltos AS (SELECT "tenantId", avg(dias) dias FROM saltos WHERE dias IS NOT NULL GROUP BY "tenantId", "customerId"),
      base AS (
        ${dias ? `SELECT "tenantId", count(*) unicos FROM por_cliente GROUP BY 1` : `SELECT "tenantId", count(*) unicos FROM activos GROUP BY 1`}
      )
      SELECT b."tenantId",
             b.unicos::int AS unicos,
             coalesce((SELECT count(*) FROM por_cliente pc WHERE pc."tenantId" = b."tenantId" AND pc.n >= 2), 0)::int AS recurrentes,
             coalesce((SELECT sum(n) FROM por_cliente pc WHERE pc."tenantId" = b."tenantId"), 0)::int AS visitas,
             (SELECT avg(dias) FROM por_cliente_saltos x WHERE x."tenantId" = b."tenantId") AS dias_entre,
             (SELECT sum("purchaseAmount") FROM compras c WHERE c."tenantId" = b."tenantId" AND c."purchaseAmount" > 0) AS ingresos,
             (SELECT count(*) FROM compras c WHERE c."tenantId" = b."tenantId" AND c."purchaseAmount" > 0)::int AS con_monto
        FROM base b`);
  }

  /** Por negocio y mes: clientes con alguna visita y cuántos de ellos ya
   *  habían venido antes (su visita no es la primera de su vida). */
  private serieMensual() {
    return this.prisma.$queryRawUnsafe<Array<{ tenantId: string; mes: string; clientes: number; regresan: number; visitas: number }>>(`
      WITH ${VISITAS_CTE('')},
      ordenadas AS (
        SELECT "tenantId", "customerId", "createdAt",
               row_number() OVER (PARTITION BY "tenantId", "customerId" ORDER BY "createdAt") n
          FROM compras
      )
      SELECT "tenantId",
             to_char(date_trunc('month', "createdAt" AT TIME ZONE 'America/Bogota'), 'YYYY-MM') mes,
             count(DISTINCT "customerId")::int clientes,
             count(DISTINCT "customerId") FILTER (WHERE n > 1)::int regresan,
             count(*)::int visitas
        FROM ordenadas
       WHERE "createdAt" >= date_trunc('month', now() AT TIME ZONE 'America/Bogota') - interval '${MESES_SERIE - 1} months'
       GROUP BY 1, 2`);
  }

  private async calcular(): Promise<ResumenRecompra> {
    const inicio = Date.now();
    const [tenants, hist, d90, uso, serie] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ id: string; slug: string; nombre: string; createdAt: Date; currency: string; status: string; marca: string | null }>>(`
        SELECT t.id, t.slug, coalesce(t."brandName", t.name) nombre, t."createdAt", t.currency, t.status, w.name AS marca
          FROM "Tenant" t LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
         WHERE t."deletedAt" IS NULL AND t."isCampaignHost" = false`),
      this.ventana(null),
      this.ventana(90),
      this.prisma.$queryRawUnsafe<Array<{ tenantId: string; con_monto: number; mediana: unknown; montos_bajos: number }>>(`
        SELECT s."tenantId",
               count(*) FILTER (WHERE "purchaseAmount" > 0)::int con_monto,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "purchaseAmount") FILTER (WHERE "purchaseAmount" > 0) mediana,
               count(*) FILTER (WHERE "purchaseAmount" > 0 AND "purchaseAmount" < 1000)::int montos_bajos
          FROM "Stamp" s WHERE ${COMPRA} AND s."createdAt" >= '${DESDE_MONTO_OBLIGATORIO}'
         GROUP BY 1`),
      this.serieMensual(),
    ]);

    const aFila = (r: FilaSql | undefined): FilaVentana | null =>
      r
        ? { unicos: r.unicos, recurrentes: r.recurrentes, visitas: r.visitas, diasEntre: num(r.dias_entre), ingresos: num(r.ingresos), conMonto: r.con_monto }
        : null;
    const conTasas = (f: FilaVentana | null) =>
      f
        ? {
            ...f,
            diasEntre: f.diasEntre == null ? null : Math.round(10 * f.diasEntre) / 10,
            ingresos: f.ingresos == null ? null : Math.round(f.ingresos),
            recompra: porcentaje(f.recurrentes, f.unicos),
            frecuencia: f.unicos ? Math.round((100 * f.visitas) / f.unicos) / 100 : null,
          }
        : null;
    const h = new Map(hist.map((r) => [r.tenantId, r]));
    const r90 = new Map(d90.map((r) => [r.tenantId, r]));
    const u = new Map(uso.map((r) => [r.tenantId, r]));
    const seriePorNegocio = new Map<string, MesSerie[]>();
    for (const s of serie) {
      const xs = seriePorNegocio.get(s.tenantId) ?? [];
      xs.push({ mes: s.mes, clientes: s.clientes, regresan: s.regresan, visitas: s.visitas });
      seriePorNegocio.set(s.tenantId, xs);
    }

    const hoy = new Date();
    const negocios: NegocioRecompra[] = [];
    for (const t of tenants) {
      const m = u.get(t.id);
      const crudo: NegocioCrudo = {
        id: t.id,
        nombre: t.nombre,
        marca: t.marca ?? 'Clubify',
        status: t.status,
        currency: t.currency,
        alta: new Date(t.createdAt),
        historico: aFila(h.get(t.id)),
        ultimos90: aFila(r90.get(t.id)),
        medianaMonto: m ? num(m.mediana) : null,
        pctMontoBajo: m ? porcentaje(m.montos_bajos, m.con_monto) : null,
      };
      if (!crudo.historico?.unicos) continue; // sin clientes: nada que mostrar
      negocios.push({
        id: t.id,
        nombre: crudo.nombre,
        marca: crudo.marca,
        status: crudo.status,
        currency: crudo.currency,
        alta: crudo.alta.toISOString().slice(0, 10),
        fuera: motivoFuera(crudo, exclusion(t.nombre, t.slug), hoy),
        montoDudoso: montoDudoso(crudo),
        historico: conTasas(crudo.historico),
        ultimos90: conTasas(crudo.ultimos90),
        serie: (seriePorNegocio.get(t.id) ?? []).sort((a, b) => a.mes.localeCompare(b.mes)),
      });
    }

    const dentro = negocios.filter((n) => !n.fuera);
    // Serie de la plataforma: solo negocios que entran al promedio, para que
    // la curva cuente lo mismo que las cifras de arriba.
    const meses = new Map<string, MesSerie>();
    for (const n of dentro)
      for (const s of n.serie) {
        const acc = meses.get(s.mes) ?? { mes: s.mes, clientes: 0, regresan: 0, visitas: 0 };
        acc.clientes += s.clientes;
        acc.regresan += s.regresan;
        acc.visitas += s.visitas;
        meses.set(s.mes, acc);
      }

    this.log.log(`recompra calculada en ${Math.round((Date.now() - inicio) / 1000)} s (${negocios.length} negocios)`);
    return {
      generado: new Date().toISOString(),
      definiciones: { minClientes: 30, minDias: 60, visitaHoras: 2 },
      promedio: {
        historico: promedio(dentro.map((n) => n.historico)),
        ultimos90: promedio(dentro.map((n) => n.ultimos90)),
      },
      serie: [...meses.values()]
        .sort((a, b) => a.mes.localeCompare(b.mes))
        .map((s) => ({ ...s, tasa: porcentaje(s.regresan, s.clientes) })),
      negocios,
    };
  }
}
