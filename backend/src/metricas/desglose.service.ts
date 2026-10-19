import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { MetricasService } from './metricas.service';
import {
  ZONA,
  contieneDia,
  diaBogotaDe,
  diasDelRango,
  limitesUtc,
  periodoAnterior,
  rangoDePreset,
  type Preset,
  type Rango,
} from './rango';
import type { NegocioBase } from './negocios';
import {
  armarTabla,
  canjesPorTipoDelNegocio,
  diaDeFila,
  porcentaje,
  repartirPorNegocio,
  resumirCanjes,
  type Columna,
  type EntradaNegocio,
  type FilaCanje,
  type MetricaDesglose,
  type ResumenCanjes,
  type ValorCelda,
} from './desglose';

/** Mismos estados cobrables que `generales` (un PENDING no factura). */
const COBRABLES = ['CONFIRMED', 'READY', 'DELIVERED'];

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

type Resumen = Array<{ etiqueta: string; valor: string }>;

interface Bloque {
  titulo: string;
  ayuda: string;
  /** Qué es `valor` en cada fila (la columna principal). */
  etiquetaValor: string;
  columnas: Columna[];
  columnasDetalle?: Columna[];
  datos: Map<string, EntradaNegocio>;
  negocios: NegocioBase[];
  incluirTodos?: boolean;
  mostrar?: (d: EntradaNegocio) => boolean;
  resumen?: Resumen;
  canjes?: ResumenCanjes;
  porMoneda?: Array<{ moneda: string; pedidos: number; cobrados: number; valor: number; valorAnterior: number }>;
}

const num = (x: number) => x.toLocaleString('es-CO');

/**
 * GET /admin/metricas/desglose — el detalle por negocio de cada tarjeta de
 * «Métricas generales».
 *
 * Alcance: EXACTAMENTE `MetricasService.negociosDelAlcance`, el mismo de la
 * tarjeta y del ranking. Si el desglose mirara otros negocios, su suma no
 * cuadraría con la tarjeta y no serviría para lo que se pidió: confirmar el
 * número.
 *
 * SQL crudo con `"tenantId" = ANY(ids)` explícito en cada consulta: el
 * middleware de tenantId no toca el SQL crudo, y sin ese filtro se verían los
 * negocios de todas las marcas.
 *
 * Las series se agrupan por (negocio, día de Bogotá) y se reparten en JS con
 * `repartirPorNegocio` (ver `desglose.ts`): mismo corte de día que `generales`,
 * así la suma de las filas da la tarjeta al peso.
 */
@Injectable()
export class MetricasDesgloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricas: MetricasService,
  ) {}

  async desglose(
    user: AuthUser | undefined,
    opts: { metrica: MetricaDesglose; preset: Preset; desde?: string; hasta?: string },
    ahora = new Date(),
  ) {
    const rango = rangoDePreset(opts.preset, ahora, opts.desde, opts.hasta);
    const anterior = periodoAnterior(rango, opts.preset);
    const cur = limitesUtc(rango);
    const prev = limitesUtc(anterior);
    const ventana = { gte: prev.gte, lt: cur.lt };
    const negocios = await this.metricas.negociosDelAlcance(user);
    const ids = negocios.map((x) => x.id);

    const ctx = { rango, anterior, cur, prev, ventana, negocios, ids };
    const b = await this.bloque(opts.metrica, ctx);
    const tabla = armarTabla(b.negocios, b.datos, b.columnas, { incluirTodos: b.incluirTodos, mostrar: b.mostrar });

    return {
      zonaHoraria: ZONA,
      generadoEn: ahora.toISOString(),
      metrica: opts.metrica,
      preset: opts.preset,
      rango: { ...rango, dias: diasDelRango(rango) },
      anterior: { ...anterior, dias: diasDelRango(anterior) },
      titulo: b.titulo,
      ayuda: b.ayuda,
      etiquetaValor: b.etiquetaValor,
      columnas: b.columnas,
      columnasDetalle: b.columnasDetalle ?? null,
      negociosEnAlcance: b.negocios.length,
      ...tabla,
      resumen: b.resumen ?? [],
      canjes: b.canjes ?? null,
      porMoneda: b.porMoneda ?? null,
    };
  }

  private async bloque(
    metrica: MetricaDesglose,
    c: {
      rango: Rango;
      anterior: Rango;
      cur: { gte: Date; lt: Date };
      prev: { gte: Date; lt: Date };
      ventana: { gte: Date; lt: Date };
      negocios: NegocioBase[];
      ids: string[];
    },
  ): Promise<Bloque> {
    const { rango, anterior, cur, prev, ventana, negocios, ids } = c;

    switch (metrica) {
      case 'pases': {
        const filas = await this.prisma.$queryRaw<
          Array<{ tenantId: string; dia: Date; emitidos: bigint; apple: bigint; google: bigint; sinPlataforma: bigint }>
        >`
          SELECT "tenantId", ("issuedAt" - interval '5 hours')::date AS dia,
                 COUNT(*)::bigint AS emitidos,
                 COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" = 'APPLE')::bigint AS apple,
                 COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" = 'GOOGLE')::bigint AS google,
                 COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" IS NULL)::bigint AS "sinPlataforma"
          FROM "Pass"
          WHERE "tenantId" = ANY(${ids}::text[])
            AND "issuedAt" >= ${ventana.gte} AND "issuedAt" < ${ventana.lt}
          GROUP BY 1, 2`;
        const rep = repartirPorNegocio(filas, ['emitidos', 'apple', 'google', 'sinPlataforma'] as const, rango, anterior);
        const datos = new Map<string, EntradaNegocio>();
        for (const [id, a] of rep) {
          const guardados = a.actual.apple + a.actual.google + a.actual.sinPlataforma;
          datos.set(id, {
            valor: a.actual.emitidos,
            anterior: a.anterior.emitidos,
            extra: {
              guardados,
              apple: a.actual.apple,
              google: a.actual.google,
              porcentaje: porcentaje(guardados, a.actual.emitidos),
            },
          });
        }
        return {
          titulo: 'Pases emitidos por negocio',
          ayuda: 'Pases (tarjetas de clientes) emitidos en el rango. «Guardados» son los de ese rango que el cliente añadió a Apple o Google Wallet.',
          etiquetaValor: 'Pases',
          columnas: [
            { clave: 'guardados', etiqueta: 'Guardados', tipo: 'numero' },
            { clave: 'apple', etiqueta: 'Apple', tipo: 'numero' },
            { clave: 'google', etiqueta: 'Google', tipo: 'numero' },
            { clave: 'porcentaje', etiqueta: '% guardados', tipo: 'porcentaje', sumable: false },
          ],
          datos,
          negocios,
        };
      }

      case 'clientes': {
        const [filas, totales] = await Promise.all([
          this.prisma.$queryRaw<Array<{ tenantId: string; dia: Date; nuevos: bigint }>>`
            SELECT "tenantId", ("createdAt" - interval '5 hours')::date AS dia, COUNT(*)::bigint AS nuevos
            FROM "Customer"
            WHERE "tenantId" = ANY(${ids}::text[])
              AND "createdAt" >= ${ventana.gte} AND "createdAt" < ${ventana.lt}
            GROUP BY 1, 2`,
          this.prisma.$queryRaw<Array<{ tenantId: string; total: bigint; ultimo: Date | null }>>`
            SELECT "tenantId", COUNT(*)::bigint AS total, MAX("createdAt") AS ultimo
            FROM "Customer"
            WHERE "tenantId" = ANY(${ids}::text[])
            GROUP BY 1`,
        ]);
        const rep = repartirPorNegocio(filas, ['nuevos'] as const, rango, anterior);
        const tot = new Map(totales.map((f) => [f.tenantId, f]));
        const datos = new Map<string, EntradaNegocio>();
        for (const neg of negocios) {
          const a = rep.get(neg.id);
          const t = tot.get(neg.id);
          datos.set(neg.id, {
            valor: a?.actual.nuevos ?? 0,
            anterior: a?.anterior.nuevos ?? 0,
            extra: { totalClientes: n(t?.total), ultimo: iso(t?.ultimo) },
          });
        }
        return {
          titulo: 'Clientes nuevos por negocio',
          ayuda: 'Clientes registrados en el rango. «Total» es todo su histórico.',
          etiquetaValor: 'Nuevos',
          columnas: [
            { clave: 'totalClientes', etiqueta: 'Total de clientes', tipo: 'numero' },
            { clave: 'ultimo', etiqueta: 'Último cliente nuevo', tipo: 'fecha' },
          ],
          datos,
          negocios,
        };
      }

      case 'sellos': {
        // Sellos = SUMA de `amount` (un pedido puede dar 2 en una fila), igual
        // que la tarjeta. «Movimientos» = filas, para ver cuántas veces se selló.
        const filas = await this.prisma.$queryRaw<
          Array<{ tenantId: string; dia: Date; sellos: unknown; movimientos: bigint; regalados: unknown }>
        >`
          SELECT "tenantId", ("createdAt" - interval '5 hours')::date AS dia,
                 COALESCE(SUM("amount"), 0) AS sellos,
                 COUNT(*)::bigint AS movimientos,
                 COALESCE(SUM("amount") FILTER (WHERE "giftReason" IS NOT NULL), 0) AS regalados
          FROM "Stamp"
          WHERE "tenantId" = ANY(${ids}::text[])
            AND "createdAt" >= ${ventana.gte} AND "createdAt" < ${ventana.lt}
            AND "action" = 'STAMP'
          GROUP BY 1, 2`;
        const rep = repartirPorNegocio(filas, ['sellos', 'movimientos', 'regalados'] as const, rango, anterior);
        const datos = new Map<string, EntradaNegocio>();
        for (const [id, a] of rep) {
          datos.set(id, {
            valor: r2(a.actual.sellos),
            anterior: r2(a.anterior.sellos),
            extra: { movimientos: a.actual.movimientos, regalados: r2(a.actual.regalados) },
          });
        }
        return {
          titulo: 'Sellos otorgados por negocio',
          ayuda: 'Suma de sellos dados en el rango (un movimiento puede dar más de uno). «Regalados» son cortesías y fechas especiales, sin compra detrás.',
          etiquetaValor: 'Sellos',
          columnas: [
            { clave: 'movimientos', etiqueta: 'Movimientos', tipo: 'numero' },
            { clave: 'regalados', etiqueta: 'Regalados', tipo: 'numero' },
          ],
          datos,
          negocios,
        };
      }

      case 'canjes': {
        // Quién escribe REDEEM en "Stamp": SOLO `StampsService.record`
        // (POST /stamps: el escáner, la ficha del cliente y la de la tarjeta),
        // y el duplicador de negocios, que copia el historial. La cuponera
        // escribe sus canjes en "StampEvent" (otra tabla) y el Club/convenios
        // consumen cupo sin crear Stamp: ninguno de esos entra en esta cuenta.
        // Ver la nota de `tipoDeCanje` sobre por qué manda `redeemKind`.
        const filas = await this.prisma.$queryRaw<
          Array<{
            tenantId: string;
            dia: Date;
            redeemKind: string | null;
            cardId: string | null;
            cardName: string | null;
            cardType: string | null;
            canjes: bigint;
          }>
        >`
          SELECT s."tenantId", (s."createdAt" - interval '5 hours')::date AS dia,
                 s."redeemKind", c."id" AS "cardId", c."name" AS "cardName", c."type"::text AS "cardType",
                 COUNT(*)::bigint AS canjes
          FROM "Stamp" s
          LEFT JOIN "Pass" p ON p."id" = s."passId"
          LEFT JOIN "Card" c ON c."id" = p."cardId"
          WHERE s."tenantId" = ANY(${ids}::text[])
            AND s."createdAt" >= ${ventana.gte} AND s."createdAt" < ${ventana.lt}
            AND s."action" = 'REDEEM'
          GROUP BY 1, 2, 3, 4, 5, 6`;
        const rep = repartirPorNegocio(filas, ['canjes'] as const, rango, anterior);
        const delRango: FilaCanje[] = filas
          .filter((f) => contieneDia(rango, diaDeFila(f.dia)))
          .map((f) => ({
            tenantId: f.tenantId,
            redeemKind: f.redeemKind,
            cardId: f.cardId,
            cardName: f.cardName,
            cardType: f.cardType,
            canjes: n(f.canjes),
          }));
        const resumen = resumirCanjes(delRango);
        const tipos = canjesPorTipoDelNegocio(delRango);
        const tarjetasDe = new Map<string, Array<Record<string, ValorCelda>>>();
        for (const t of resumen.porTarjeta) {
          const l = tarjetasDe.get(t.tenantId) ?? [];
          l.push({
            tarjeta: t.tarjetaTransformada ? `Cupón (hoy el pase está en «${t.tarjeta}»)` : t.tarjeta,
            tipo: t.tipo,
            canjes: t.canjes,
          });
          tarjetasDe.set(t.tenantId, l);
        }
        const datos = new Map<string, EntradaNegocio>();
        for (const [id, a] of rep) {
          const t = tipos.get(id);
          datos.set(id, {
            valor: a.actual.canjes,
            anterior: a.anterior.canjes,
            extra: {
              premiosSellos: t?.STAMPS ?? 0,
              premiosVisitas: t?.VISITS ?? 0,
              cupones: t?.COUPON ?? 0,
              otros: t ? t.POINTS + t.CASHBACK + t.MEMBERSHIP + t.OTRO : 0,
            },
            ...(tarjetasDe.has(id) ? { detalle: tarjetasDe.get(id) } : {}),
          });
        }
        return {
          titulo: 'Premios canjeados por negocio',
          ayuda:
            'Cada canje registrado en el escáner o en el panel. Incluye los cupones: separa «premio de tarjeta de sellos completada» (el cliente juntó todos los sellos) de un cupón canjeado.',
          etiquetaValor: 'Canjes',
          columnas: [
            { clave: 'premiosSellos', etiqueta: 'Sellos completados', tipo: 'numero' },
            { clave: 'premiosVisitas', etiqueta: 'Visitas completadas', tipo: 'numero' },
            { clave: 'cupones', etiqueta: 'Cupones', tipo: 'numero' },
            { clave: 'otros', etiqueta: 'Otros', tipo: 'numero' },
          ],
          columnasDetalle: [
            { clave: 'tarjeta', etiqueta: 'Tarjeta', tipo: 'texto' },
            { clave: 'tipo', etiqueta: 'Tipo', tipo: 'texto' },
            { clave: 'canjes', etiqueta: 'Canjes', tipo: 'numero' },
          ],
          datos,
          negocios,
          canjes: resumen,
        };
      }

      case 'pedidos': {
        const filas = await this.prisma.$queryRaw<
          Array<{ tenantId: string; dia: Date; moneda: string | null; pedidos: bigint; cancelados: bigint; cobrables: bigint; valor: unknown }>
        >`
          SELECT o."tenantId", (o."createdAt" - interval '5 hours')::date AS dia,
                 UPPER(t."currency") AS moneda,
                 COUNT(*) FILTER (WHERE o."status" <> 'CANCELLED')::bigint AS pedidos,
                 COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')::bigint AS cancelados,
                 COUNT(*) FILTER (WHERE o."status"::text = ANY(${COBRABLES}::text[]))::bigint AS cobrables,
                 COALESCE(SUM(o."total") FILTER (WHERE o."status"::text = ANY(${COBRABLES}::text[])), 0) AS valor
          FROM "Order" o
          JOIN "Tenant" t ON t."id" = o."tenantId"
          WHERE o."tenantId" = ANY(${ids}::text[])
            AND o."createdAt" >= ${ventana.gte} AND o."createdAt" < ${ventana.lt}
          GROUP BY 1, 2, 3`;
        const rep = repartirPorNegocio(filas, ['pedidos', 'cancelados', 'cobrables', 'valor'] as const, rango, anterior);
        const monedaDe = new Map(filas.map((f) => [f.tenantId, f.moneda || '—']));
        const datos = new Map<string, EntradaNegocio>();
        const porMoneda = new Map<string, { pedidos: number; cobrados: number; valor: number; valorAnterior: number }>();
        for (const [id, a] of rep) {
          const moneda = monedaDe.get(id) ?? '—';
          // Un negocio sin pedidos vivos pero con cancelados también sale: la
          // tarjeta dice «N cancelados aparte» y hay que poder ver de quién.
          datos.set(id, {
            valor: a.actual.pedidos,
            anterior: a.anterior.pedidos,
            extra: {
              cancelados: a.actual.cancelados,
              cobrados: a.actual.cobrables,
              moneda,
              valor: r2(a.actual.valor),
              valorAnterior: r2(a.anterior.valor),
            },
          });
          const m = porMoneda.get(moneda) ?? { pedidos: 0, cobrados: 0, valor: 0, valorAnterior: 0 };
          m.pedidos += a.actual.pedidos;
          m.cobrados += a.actual.cobrables;
          m.valor += a.actual.valor;
          m.valorAnterior += a.anterior.valor;
          porMoneda.set(moneda, m);
        }
        return {
          titulo: 'Pedidos por el menú, por negocio',
          ayuda:
            'Pedidos del rango sin contar los cancelados (van aparte). El valor suma solo los confirmados, listos o entregados, en la moneda de cada negocio: no hay tasas de cambio en el sistema.',
          etiquetaValor: 'Pedidos',
          columnas: [
            { clave: 'cancelados', etiqueta: 'Cancelados', tipo: 'numero' },
            { clave: 'cobrados', etiqueta: 'Cobrados', tipo: 'numero' },
            { clave: 'valor', etiqueta: 'Valor cobrado', tipo: 'dinero', sumable: false },
            { clave: 'moneda', etiqueta: 'Moneda', tipo: 'texto' },
          ],
          datos,
          negocios,
          mostrar: (d) => d.valor > 0 || d.anterior > 0 || n(d.extra?.cancelados) > 0,
          porMoneda: [...porMoneda.entries()]
            .filter(([, v]) => v.pedidos > 0 || v.valor > 0 || v.valorAnterior > 0)
            .map(([moneda, v]) => ({ moneda, ...v, valor: r2(v.valor), valorAnterior: r2(v.valorAnterior) }))
            .sort((a, b) => b.pedidos - a.pedidos),
        };
      }

      case 'tarjetas': {
        const [creadas, totales] = await Promise.all([
          this.prisma.$queryRaw<
            Array<{ id: string; tenantId: string; name: string; type: string; isActive: boolean; createdAt: Date }>
          >`
            SELECT "id", "tenantId", "name", "type"::text AS type, "isActive", "createdAt"
            FROM "Card"
            WHERE "tenantId" = ANY(${ids}::text[])
              AND "createdAt" >= ${ventana.gte} AND "createdAt" < ${ventana.lt}
            ORDER BY "createdAt" DESC`,
          this.prisma.$queryRaw<Array<{ tenantId: string; total: bigint }>>`
            SELECT "tenantId", COUNT(*)::bigint AS total
            FROM "Card"
            WHERE "tenantId" = ANY(${ids}::text[])
            GROUP BY 1`,
        ]);
        const tot = new Map(totales.map((f) => [f.tenantId, n(f.total)]));
        const datos = new Map<string, EntradaNegocio>();
        for (const neg of negocios) {
          datos.set(neg.id, { valor: 0, anterior: 0, extra: { total: tot.get(neg.id) ?? 0 } });
        }
        // La tarjeta de `generales` cuenta con `card.count` sobre los mismos
        // instantes [gte, lt): se compara el instante, no el día, igual que ella.
        for (const card of creadas) {
          const d = datos.get(card.tenantId);
          if (!d) continue;
          const t = new Date(card.createdAt).getTime();
          if (t >= cur.gte.getTime() && t < cur.lt.getTime()) {
            d.valor += 1;
            (d.detalle ??= []).push({
              tarjeta: card.name,
              tipo: card.type,
              creadaEn: diaBogotaDe(new Date(card.createdAt)),
              activa: card.isActive ? 'Sí' : 'No',
            });
          } else if (t >= prev.gte.getTime() && t < prev.lt.getTime()) {
            d.anterior += 1;
          }
        }
        return {
          titulo: 'Tarjetas creadas por negocio',
          ayuda:
            'Tarjetas (programas) creadas en el rango, con su nombre y tipo. Incluye las plantillas que crean solos los convenios y el Club.',
          etiquetaValor: 'Creadas',
          columnas: [{ clave: 'total', etiqueta: 'Total en el negocio', tipo: 'numero' }],
          columnasDetalle: [
            { clave: 'tarjeta', etiqueta: 'Tarjeta', tipo: 'texto' },
            { clave: 'tipo', etiqueta: 'Tipo', tipo: 'texto' },
            { clave: 'creadaEn', etiqueta: 'Creada', tipo: 'texto' },
            { clave: 'activa', etiqueta: 'Activa', tipo: 'texto' },
          ],
          datos,
          negocios,
        };
      }

      case 'push': {
        const filas = await this.prisma.$queryRaw<
          Array<{ tenantId: string; dia: Date; envios: bigint; entregados: unknown; destinatarios: unknown; conStats: bigint }>
        >`
          SELECT "tenantId", ("sentAt" - interval '5 hours')::date AS dia,
                 COUNT(*)::bigint AS envios,
                 COALESCE(SUM(CASE WHEN jsonb_typeof("stats"::jsonb -> 'delivered') = 'number'
                                   THEN ("stats"::jsonb ->> 'delivered')::numeric END), 0) AS entregados,
                 COALESCE(SUM(CASE WHEN jsonb_typeof("stats"::jsonb -> 'targeted') = 'number'
                                   THEN ("stats"::jsonb ->> 'targeted')::numeric END), 0) AS destinatarios,
                 COUNT(*) FILTER (WHERE jsonb_typeof("stats"::jsonb -> 'delivered') = 'number')::bigint AS "conStats"
          FROM "Notification"
          WHERE "tenantId" = ANY(${ids}::text[])
            AND "sentAt" >= ${ventana.gte} AND "sentAt" < ${ventana.lt}
          GROUP BY 1, 2`;
        const rep = repartirPorNegocio(filas, ['envios', 'entregados', 'destinatarios', 'conStats'] as const, rango, anterior);
        const datos = new Map<string, EntradaNegocio>();
        for (const [id, a] of rep) {
          datos.set(id, {
            valor: a.actual.envios,
            anterior: a.anterior.envios,
            extra: { destinatarios: a.actual.destinatarios, entregados: a.actual.entregados, conStats: a.actual.conStats },
          });
        }
        return {
          titulo: 'Push enviados por negocio',
          ayuda:
            'Un envío es una notificación (a uno o a muchos clientes). Las entregas solo cuentan en los envíos que las registraron; los viejos o fallidos no las traen.',
          etiquetaValor: 'Envíos',
          columnas: [
            { clave: 'destinatarios', etiqueta: 'Destinatarios', tipo: 'numero' },
            { clave: 'entregados', etiqueta: 'Entregados', tipo: 'numero' },
            { clave: 'conStats', etiqueta: 'Envíos con entregas', tipo: 'numero' },
          ],
          datos,
          negocios,
        };
      }

      case 'wallet': {
        const filas = await this.prisma.$queryRaw<
          Array<{ tenantId: string; dia: Date; emitidos: bigint; apple: bigint; google: bigint; sinPlataforma: bigint }>
        >`
          SELECT "tenantId", ("issuedAt" - interval '5 hours')::date AS dia,
                 COUNT(*)::bigint AS emitidos,
                 COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" = 'APPLE')::bigint AS apple,
                 COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" = 'GOOGLE')::bigint AS google,
                 COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" IS NULL)::bigint AS "sinPlataforma"
          FROM "Pass"
          WHERE "tenantId" = ANY(${ids}::text[])
            AND "issuedAt" >= ${ventana.gte} AND "issuedAt" < ${ventana.lt}
          GROUP BY 1, 2`;
        const rep = repartirPorNegocio(filas, ['emitidos', 'apple', 'google', 'sinPlataforma'] as const, rango, anterior);
        const datos = new Map<string, EntradaNegocio>();
        let emitidos = 0;
        let guardadosTot = 0;
        let emitidosAnt = 0;
        let guardadosAnt = 0;
        for (const [id, a] of rep) {
          const g = a.actual.apple + a.actual.google + a.actual.sinPlataforma;
          const gA = a.anterior.apple + a.anterior.google + a.anterior.sinPlataforma;
          emitidos += a.actual.emitidos;
          guardadosTot += g;
          emitidosAnt += a.anterior.emitidos;
          guardadosAnt += gA;
          datos.set(id, {
            valor: g,
            anterior: gA,
            extra: {
              emitidos: a.actual.emitidos,
              apple: a.actual.apple,
              google: a.actual.google,
              sinPlataforma: a.actual.sinPlataforma,
              porcentaje: porcentaje(g, a.actual.emitidos),
            },
          });
        }
        const pct = porcentaje(guardadosTot, emitidos);
        const pctAnt = porcentaje(guardadosAnt, emitidosAnt);
        return {
          titulo: 'Pases guardados en Wallet, por negocio',
          ayuda: 'De los pases emitidos en el rango, cuántos guardó el cliente en el teléfono, y en qué billetera.',
          etiquetaValor: 'Guardados',
          columnas: [
            { clave: 'emitidos', etiqueta: 'Emitidos', tipo: 'numero' },
            { clave: 'apple', etiqueta: 'Apple', tipo: 'numero' },
            { clave: 'google', etiqueta: 'Google', tipo: 'numero' },
            { clave: 'sinPlataforma', etiqueta: 'Sin plataforma', tipo: 'numero' },
            { clave: 'porcentaje', etiqueta: '% guardados', tipo: 'porcentaje', sumable: false },
          ],
          datos,
          negocios,
          resumen: [
            { etiqueta: 'Guardados en el rango', valor: pct == null ? '—' : `${pct.toLocaleString('es-CO')} %` },
            { etiqueta: 'Período anterior', valor: pctAnt == null ? '—' : `${pctAnt.toLocaleString('es-CO')} %` },
          ],
        };
      }

      case 'uso': {
        // Solo ACTIVOS, como la tarjeta (`clasificarUso`). «Usa» = al menos un
        // movimiento del escáner (cualquier acción) o un pedido no cancelado en
        // el rango: contar >0 es lo mismo que el EXISTS de `generales`.
        const activos = negocios.filter((x) => x.estado === 'ACTIVE');
        const idsActivos = activos.map((x) => x.id);
        const filas = await this.prisma.$queryRaw<
          Array<{
            id: string;
            movimientos: bigint;
            movimientosAnt: bigint;
            pedidos: bigint;
            pedidosAnt: bigint;
            ultimoMovimiento: Date | null;
            ultimoPedido: Date | null;
          }>
        >`
          SELECT t.id,
                 (SELECT COUNT(*) FROM "Stamp" s WHERE s."tenantId" = t.id
                    AND s."createdAt" >= ${cur.gte} AND s."createdAt" < ${cur.lt})::bigint AS movimientos,
                 (SELECT COUNT(*) FROM "Stamp" s WHERE s."tenantId" = t.id
                    AND s."createdAt" >= ${prev.gte} AND s."createdAt" < ${prev.lt})::bigint AS "movimientosAnt",
                 (SELECT COUNT(*) FROM "Order" o WHERE o."tenantId" = t.id AND o."status" <> 'CANCELLED'
                    AND o."createdAt" >= ${cur.gte} AND o."createdAt" < ${cur.lt})::bigint AS pedidos,
                 (SELECT COUNT(*) FROM "Order" o WHERE o."tenantId" = t.id AND o."status" <> 'CANCELLED'
                    AND o."createdAt" >= ${prev.gte} AND o."createdAt" < ${prev.lt})::bigint AS "pedidosAnt",
                 (SELECT MAX(s."createdAt") FROM "Stamp" s WHERE s."tenantId" = t.id) AS "ultimoMovimiento",
                 (SELECT MAX(o."createdAt") FROM "Order" o WHERE o."tenantId" = t.id) AS "ultimoPedido"
          FROM unnest(${idsActivos}::text[]) AS t(id)`;
        const datos = new Map<string, EntradaNegocio>();
        let usan = 0;
        for (const f of filas) {
          const mov = n(f.movimientos);
          const ped = n(f.pedidos);
          const usa = mov > 0 || ped > 0;
          if (usa) usan += 1;
          datos.set(f.id, {
            valor: mov + ped,
            anterior: n(f.movimientosAnt) + n(f.pedidosAnt),
            extra: {
              usa: usa ? 'Sí' : 'No',
              movimientos: mov,
              pedidos: ped,
              ultimoMovimiento: iso(f.ultimoMovimiento),
              ultimoPedido: iso(f.ultimoPedido),
            },
          });
        }
        return {
          titulo: 'Uso del sistema por negocio activo',
          ayuda:
            'Movimientos del escáner (sellos, puntos, visitas, canjes…) y pedidos no cancelados en el rango. Un negocio «usa» el sistema si tiene al menos uno. Solo activos: los de prueba y los suspendidos no entran.',
          etiquetaValor: 'Movimientos + pedidos',
          columnas: [
            { clave: 'usa', etiqueta: 'Usa el sistema', tipo: 'texto' },
            { clave: 'movimientos', etiqueta: 'Movimientos', tipo: 'numero' },
            { clave: 'pedidos', etiqueta: 'Pedidos', tipo: 'numero' },
            { clave: 'ultimoMovimiento', etiqueta: 'Último movimiento', tipo: 'fecha' },
            { clave: 'ultimoPedido', etiqueta: 'Último pedido', tipo: 'fecha' },
          ],
          datos,
          negocios: activos,
          incluirTodos: true,
          resumen: [
            { etiqueta: 'Usan el sistema', valor: `${num(usan)} de ${num(activos.length)} activos` },
            { etiqueta: 'Sin uso', valor: num(activos.length - usan) },
          ],
        };
      }
    }
  }
}
