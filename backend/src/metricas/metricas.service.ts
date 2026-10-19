import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { brandWhiteLabelWhere, resolveBrandScope } from '../common/white-label/brand-scope.util';
import {
  ZONA,
  contieneDia,
  diasDelRango,
  granularidadDe,
  limitesUtc,
  periodoAnterior,
  rangoDePreset,
  sumaEnRango,
  tramosDeSerie,
  variacion,
  type Preset,
  type Rango,
} from './rango';
import {
  clasificarUso,
  negociosSinClientesNuevos,
  topCrecimiento,
  type ClientesDelNegocio,
  type EstadoNegocio,
  type NegocioBase,
} from './negocios';

/** Estados de pedido que ya son plata (regla 2026-08-20: un PENDING no factura). */
const COBRABLES = ['CONFIRMED', 'READY', 'DELIVERED'];

const n = (v: unknown) => (v == null ? 0 : Number(v));

function serie(filas: Array<{ dia: Date | string }>, campo: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of filas) {
    const dia = typeof f.dia === 'string' ? f.dia.slice(0, 10) : new Date(f.dia).toISOString().slice(0, 10);
    m.set(dia, (m.get(dia) ?? 0) + n((f as Record<string, unknown>)[campo]));
  }
  return m;
}

/**
 * Métricas globales de /admin/metricas.
 *
 * ALCANCE: el mismo que el ranking de Negocios (`TenantsService.rankingByPasses`):
 * los negocios no borrados de la marca de la sesión, y sin marca → Clubify
 * (+ los legacy sin marca), NUNCA «ver todo». Se calcula UNA vez la lista de
 * ids y todas las consultas van atadas a ella.
 *
 * Por qué SQL crudo en las series: Prisma no agrupa por día, y agrupar por día
 * en JS obligaría a traer cada fila. El SQL crudo NO pasa por el middleware de
 * `tenantId` (ver memoria «middleware tenantid»), así que cada consulta lleva
 * el `"tenantId" = ANY(ids)` explícito: sin él vería los negocios de TODAS las
 * marcas.
 *
 * El día se corta en hora Bogotá restando 5 h a la columna (las columnas son
 * `timestamp` sin zona, guardadas en UTC). Colombia no tiene horario de verano.
 */
@Injectable()
export class MetricasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Negocios del alcance. `tenantId` acota a uno (filtro futuro por negocio).
   * Público porque el desglose por negocio (`desglose.service.ts`) TIENE que
   * mirar exactamente los mismos negocios que la tarjeta que explica.
   */
  async negociosDelAlcance(user: AuthUser | undefined, tenantId?: string) {
    const scope = await resolveBrandScope(this.prisma, user?.whiteLabelId ?? null);
    const filas = await this.prisma.tenant.findMany({
      where: {
        deletedAt: null,
        isCampaignHost: false,
        ...brandWhiteLabelWhere(scope),
        ...(tenantId ? { id: tenantId } : {}),
      },
      select: { id: true, brandName: true, name: true, status: true, createdAt: true },
    });
    // Un id fuera de la marca responde igual que uno inexistente: no se
    // confirma a otra marca que ese negocio existe.
    if (tenantId && filas.length === 0) throw new NotFoundException('Negocio no encontrado.');
    return filas.map<NegocioBase>((t) => ({
      id: t.id,
      nombre: t.brandName || t.name,
      estado: t.status as EstadoNegocio,
      creadoEn: t.createdAt,
    }));
  }

  async generales(
    user: AuthUser | undefined,
    opts: { preset: Preset; desde?: string; hasta?: string; tenantId?: string },
    ahora = new Date(),
  ) {
    const rango = rangoDePreset(opts.preset, ahora, opts.desde, opts.hasta);
    const anterior = periodoAnterior(rango, opts.preset);
    const gran = granularidadDe(rango);
    const cur = limitesUtc(rango);
    const prev = limitesUtc(anterior);
    // Una sola consulta por tabla cubre los dos períodos; luego se reparte por
    // día. Con «este mes» queda un hueco entre ambos (del 20 al 30 del mes
    // anterior) que se lee y se descarta: más barato que dos viajes.
    const ventana = { gte: prev.gte, lt: cur.lt };

    const negocios = await this.negociosDelAlcance(user, opts.tenantId);
    const ids = negocios.map((x) => x.id);
    const vigentes = negocios.filter((x) => x.estado === 'ACTIVE' || x.estado === 'TRIAL');
    const idsVigentes = vigentes.map((x) => x.id);
    const idsActivos = negocios.filter((x) => x.estado === 'ACTIVE').map((x) => x.id);

    const cabecera = {
      zonaHoraria: ZONA,
      generadoEn: ahora.toISOString(),
      preset: opts.preset,
      rango: { ...rango, dias: diasDelRango(rango) },
      anterior: { ...anterior, dias: diasDelRango(anterior) },
      granularidad: gran,
      tenantId: opts.tenantId ?? null,
    };

    const [
      pasesDia,
      sellosDia,
      pedidosDia,
      clientesDia,
      pushDia,
      pasesPorNegocio,
      actividadPorNegocio,
      clientesPorNegocio,
      ultimoSelloPorNegocio,
      tarjetasTotal,
      tarjetasCreadas,
      tarjetasAnterior,
      pasesHistoricoActivos,
    ] = await Promise.all([
      this.prisma.$queryRaw<Array<{ dia: Date; emitidos: bigint; apple: bigint; google: bigint; sinPlataforma: bigint }>>`
        SELECT ("issuedAt" - interval '5 hours')::date AS dia,
               COUNT(*)::bigint AS emitidos,
               COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" = 'APPLE')::bigint AS apple,
               COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" = 'GOOGLE')::bigint AS google,
               COUNT(*) FILTER (WHERE "walletInstalledAt" IS NOT NULL AND "walletPlatform" IS NULL)::bigint AS "sinPlataforma"
        FROM "Pass"
        WHERE "tenantId" = ANY(${ids}::text[])
          AND "issuedAt" >= ${ventana.gte} AND "issuedAt" < ${ventana.lt}
        GROUP BY 1`,
      // Sellos = SUMA de `amount` de las filas STAMP (un pedido puede dar 2
      // sellos en una fila: autoStampAmount). Canjes = filas REDEEM.
      this.prisma.$queryRaw<Array<{ dia: Date; sellos: unknown; canjes: bigint }>>`
        SELECT ("createdAt" - interval '5 hours')::date AS dia,
               COALESCE(SUM("amount") FILTER (WHERE "action" = 'STAMP'), 0) AS sellos,
               COUNT(*) FILTER (WHERE "action" = 'REDEEM')::bigint AS canjes
        FROM "Stamp"
        WHERE "tenantId" = ANY(${ids}::text[])
          AND "createdAt" >= ${ventana.gte} AND "createdAt" < ${ventana.lt}
          AND "action" IN ('STAMP', 'REDEEM')
        GROUP BY 1`,
      // Pedidos: se cuentan todos menos los cancelados (mismo criterio que la
      // serie del panel del negocio); el VALOR solo con los ya cobrables. La
      // moneda es la del negocio: no hay tasa de cambio en el sistema, así que
      // se suma por moneda y no se convierte nada.
      this.prisma.$queryRaw<
        Array<{ dia: Date; moneda: string; pedidos: bigint; cancelados: bigint; cobrables: bigint; valor: unknown }>
      >`
        SELECT (o."createdAt" - interval '5 hours')::date AS dia,
               UPPER(t."currency") AS moneda,
               COUNT(*) FILTER (WHERE o."status" <> 'CANCELLED')::bigint AS pedidos,
               COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')::bigint AS cancelados,
               COUNT(*) FILTER (WHERE o."status"::text = ANY(${COBRABLES}::text[]))::bigint AS cobrables,
               COALESCE(SUM(o."total") FILTER (WHERE o."status"::text = ANY(${COBRABLES}::text[])), 0) AS valor
        FROM "Order" o
        JOIN "Tenant" t ON t."id" = o."tenantId"
        WHERE o."tenantId" = ANY(${ids}::text[])
          AND o."createdAt" >= ${ventana.gte} AND o."createdAt" < ${ventana.lt}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ dia: Date; nuevos: bigint }>>`
        SELECT ("createdAt" - interval '5 hours')::date AS dia, COUNT(*)::bigint AS nuevos
        FROM "Customer"
        WHERE "tenantId" = ANY(${ids}::text[])
          AND "createdAt" >= ${ventana.gte} AND "createdAt" < ${ventana.lt}
        GROUP BY 1`,
      // Push: una fila de Notification es un ENVÍO (a uno o a muchos). Los
      // entregados salen de `stats.delivered` cuando el envío lo registró;
      // los envíos viejos o fallidos no lo traen y no suman.
      this.prisma.$queryRaw<Array<{ dia: Date; envios: bigint; entregados: unknown; destinatarios: unknown; conStats: bigint }>>`
        SELECT ("sentAt" - interval '5 hours')::date AS dia,
               COUNT(*)::bigint AS envios,
               COALESCE(SUM(CASE WHEN jsonb_typeof("stats"::jsonb -> 'delivered') = 'number'
                                 THEN ("stats"::jsonb ->> 'delivered')::numeric END), 0) AS entregados,
               COALESCE(SUM(CASE WHEN jsonb_typeof("stats"::jsonb -> 'targeted') = 'number'
                                 THEN ("stats"::jsonb ->> 'targeted')::numeric END), 0) AS destinatarios,
               COUNT(*) FILTER (WHERE jsonb_typeof("stats"::jsonb -> 'delivered') = 'number')::bigint AS "conStats"
        FROM "Notification"
        WHERE "tenantId" = ANY(${ids}::text[])
          AND "sentAt" >= ${ventana.gte} AND "sentAt" < ${ventana.lt}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ tenantId: string; enRango: bigint; anterior: bigint }>>`
        SELECT "tenantId",
               COUNT(*) FILTER (WHERE "issuedAt" >= ${cur.gte})::bigint AS "enRango",
               COUNT(*) FILTER (WHERE "issuedAt" >= ${prev.gte} AND "issuedAt" < ${prev.lt})::bigint AS anterior
        FROM "Pass"
        WHERE "tenantId" = ANY(${ids}::text[])
          AND "issuedAt" >= ${ventana.gte} AND "issuedAt" < ${ventana.lt}
        GROUP BY 1`,
      // «Usa el sistema» = cualquier movimiento del escáner (sello, puntos,
      // visita, canje…) o un pedido no cancelado en el rango. Basta con saber
      // si hay alguno: EXISTS por negocio, que corta en la primera fila por el
      // índice (tenantId, createdAt) en vez de contar todo.
      this.prisma.$queryRaw<Array<{ id: string; ultimoMovimiento: Date | null; ultimoPedido: Date | null; activo: boolean }>>`
        SELECT t.id,
               (EXISTS (SELECT 1 FROM "Stamp" s WHERE s."tenantId" = t.id
                          AND s."createdAt" >= ${cur.gte} AND s."createdAt" < ${cur.lt})
                OR EXISTS (SELECT 1 FROM "Order" o WHERE o."tenantId" = t.id AND o."status" <> 'CANCELLED'
                          AND o."createdAt" >= ${cur.gte} AND o."createdAt" < ${cur.lt})) AS activo,
               (SELECT MAX(s."createdAt") FROM "Stamp" s WHERE s."tenantId" = t.id) AS "ultimoMovimiento",
               (SELECT MAX(o."createdAt") FROM "Order" o WHERE o."tenantId" = t.id) AS "ultimoPedido"
        FROM unnest(${idsActivos}::text[]) AS t(id)`,
      this.prisma.$queryRaw<Array<{ tenantId: string; total: bigint; nuevos: bigint; ultimo: Date | null }>>`
        SELECT "tenantId",
               COUNT(*)::bigint AS total,
               COUNT(*) FILTER (WHERE "createdAt" >= ${cur.gte} AND "createdAt" < ${cur.lt})::bigint AS nuevos,
               MAX("createdAt") AS ultimo
        FROM "Customer"
        WHERE "tenantId" = ANY(${idsVigentes}::text[])
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ id: string; ultimo: Date | null }>>`
        SELECT t.id,
               (SELECT MAX(s."createdAt") FROM "Stamp" s
                 WHERE s."tenantId" = t.id AND s."action" = 'STAMP') AS ultimo
        FROM unnest(${idsVigentes}::text[]) AS t(id)`,
      this.prisma.card.count({ where: { tenantId: { in: ids } } }),
      this.prisma.card.count({ where: { tenantId: { in: ids }, createdAt: { gte: cur.gte, lt: cur.lt } } }),
      this.prisma.card.count({ where: { tenantId: { in: ids }, createdAt: { gte: prev.gte, lt: prev.lt } } }),
      this.prisma.pass.count({ where: { tenantId: { in: idsActivos } } }),
    ]);

    // ── Series diarias ──────────────────────────────────────────────────────
    const sPases = serie(pasesDia, 'emitidos');
    const sApple = serie(pasesDia, 'apple');
    const sGoogle = serie(pasesDia, 'google');
    const sSinPlat = serie(pasesDia, 'sinPlataforma');
    const sSellos = serie(sellosDia, 'sellos');
    const sCanjes = serie(sellosDia, 'canjes');
    const sPedidos = serie(pedidosDia, 'pedidos');
    const sCancelados = serie(pedidosDia, 'cancelados');
    const sClientes = serie(clientesDia, 'nuevos');
    const sEnvios = serie(pushDia, 'envios');
    const sEntregados = serie(pushDia, 'entregados');
    const sDestinatarios = serie(pushDia, 'destinatarios');
    const sConStats = serie(pushDia, 'conStats');

    const total = (s: Map<string, number>, r: Rango) => sumaEnRango(s, r);
    const kpi = (s: Map<string, number>) => {
      const a = total(s, rango);
      const b = total(s, anterior);
      return { valor: a, anterior: b, variacion: variacion(a, b) };
    };

    const tramos = tramosDeSerie(rango, gran, {
      pases: sPases,
      sellos: sSellos,
      pedidos: sPedidos,
      clientes: sClientes,
    }).map((t) => ({
      desde: t.desde,
      hasta: t.hasta,
      pases: t.valores.pases,
      sellos: Math.round(t.valores.sellos),
      pedidos: t.valores.pedidos,
      clientes: t.valores.clientes,
    }));

    // ── Pedidos por moneda ──────────────────────────────────────────────────
    const porMoneda = new Map<string, { valor: number; cobrables: number; pedidos: number; valorAnterior: number }>();
    for (const f of pedidosDia) {
      const dia = new Date(f.dia).toISOString().slice(0, 10);
      const moneda = f.moneda || '—';
      const acc = porMoneda.get(moneda) ?? { valor: 0, cobrables: 0, pedidos: 0, valorAnterior: 0 };
      if (contieneDia(rango, dia)) {
        acc.valor += n(f.valor);
        acc.cobrables += n(f.cobrables);
        acc.pedidos += n(f.pedidos);
      } else if (contieneDia(anterior, dia)) {
        acc.valorAnterior += n(f.valor);
      }
      porMoneda.set(moneda, acc);
    }
    const monedas = [...porMoneda.entries()]
      .filter(([, v]) => v.pedidos > 0 || v.valor > 0 || v.valorAnterior > 0)
      .map(([moneda, v]) => ({
        moneda,
        pedidos: v.pedidos,
        cobrados: v.cobrables,
        valor: Math.round(v.valor * 100) / 100,
        ticketPromedio: v.cobrables > 0 ? Math.round((v.valor / v.cobrables) * 100) / 100 : null,
        valorAnterior: Math.round(v.valorAnterior * 100) / 100,
        variacion: variacion(v.valor, v.valorAnterior),
      }))
      .sort((a, b) => b.pedidos - a.pedidos);
    // Total en USD SOLO si todo ya está en USD: no hay tasa de cambio guardada
    // en el sistema y una conversión inventada sería un número falso.
    const totalUsd =
      monedas.length > 0 && monedas.every((m) => m.moneda === 'USD')
        ? monedas.reduce((s, m) => s + m.valor, 0)
        : null;

    // ── Wallet ──────────────────────────────────────────────────────────────
    const emitidos = total(sPases, rango);
    const apple = total(sApple, rango);
    const google = total(sGoogle, rango);
    const sinPlataforma = total(sSinPlat, rango);
    const guardados = apple + google + sinPlataforma;
    const guardadosAnt = total(sApple, anterior) + total(sGoogle, anterior) + total(sSinPlat, anterior);
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

    // ── Negocios ────────────────────────────────────────────────────────────
    const mapaPases = new Map(pasesPorNegocio.map((f) => [f.tenantId, n(f.enRango)]));
    const mapaPasesAnt = new Map(pasesPorNegocio.map((f) => [f.tenantId, n(f.anterior)]));
    const actividad = new Map(actividadPorNegocio.map((f) => [f.id, f]));
    const conActividad = new Set(actividadPorNegocio.filter((f) => f.activo).map((f) => f.id));
    const uso = clasificarUso(negocios, conActividad);

    const clientes = new Map<string, ClientesDelNegocio>(
      clientesPorNegocio.map((f) => [
        f.tenantId,
        { nuevosEnRango: n(f.nuevos), total: n(f.total), ultimoClienteEn: f.ultimo ? new Date(f.ultimo) : null },
      ]),
    );
    const ultimoSello = new Map(ultimoSelloPorNegocio.map((f) => [f.id, f.ultimo ? new Date(f.ultimo) : null]));

    const activos = idsActivos.length;
    const pasesActivosEnRango = idsActivos.reduce((s, id) => s + (mapaPases.get(id) ?? 0), 0);

    return {
      ...cabecera,
      serie: tramos,
      pases: { ...kpi(sPases) },
      tarjetas: {
        total: tarjetasTotal,
        creadas: tarjetasCreadas,
        anterior: tarjetasAnterior,
        variacion: variacion(tarjetasCreadas, tarjetasAnterior),
      },
      pedidos: {
        ...kpi(sPedidos),
        cancelados: total(sCancelados, rango),
        porMoneda: monedas,
        totalUsd,
        // No hay tabla de tasas: se dice explícitamente para que el panel no
        // insinúe una conversión.
        tasaDeCambio: null as null,
      },
      clientes: { ...kpi(sClientes) },
      sellos: { ...kpi(sSellos), canjes: kpi(sCanjes) },
      wallet: {
        emitidos,
        guardados,
        apple,
        google,
        sinPlataforma,
        porcentajeGuardados: pct(guardados, emitidos),
        porcentajeAnterior: pct(guardadosAnt, total(sPases, anterior)),
      },
      push: {
        envios: kpi(sEnvios),
        entregados: total(sEntregados, rango),
        destinatarios: total(sDestinatarios, rango),
        enviosConEstadisticas: total(sConStats, rango),
      },
      negocios: {
        enAlcance: negocios.length,
        activos,
        enPrueba: negocios.filter((x) => x.estado === 'TRIAL').length,
        suspendidos: negocios.filter((x) => x.estado === 'SUSPENDED').length,
        usan: uso.usan,
        sinUso: uso.sinUso.map((x) => {
          const a = actividad.get(x.id);
          return {
            id: x.id,
            nombre: x.nombre,
            estado: x.estado,
            ultimoMovimientoEn: a?.ultimoMovimiento ?? null,
            ultimoPedidoEn: a?.ultimoPedido ?? null,
          };
        }),
        promedioPasesEnRango: activos > 0 ? Math.round((pasesActivosEnRango / activos) * 10) / 10 : 0,
        promedioPasesHistorico: activos > 0 ? Math.round((pasesHistoricoActivos / activos) * 10) / 10 : 0,
        topCrecimiento: topCrecimiento(negocios, mapaPases, mapaPasesAnt).map((x) => ({
          ...x,
          variacion: variacion(x.enRango, x.anterior),
        })),
      },
      sinClientesNuevos: negociosSinClientesNuevos(vigentes, clientes, ultimoSello, ahora),
    };
  }
}

