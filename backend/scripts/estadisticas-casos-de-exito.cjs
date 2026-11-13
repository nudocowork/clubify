// SOLO LECTURA. Cifras reales para casos de éxito: recompra, frecuencia, días
// entre visitas e ingresos registrados, por negocio y agregado. Encargo
// «MODIFICACIÓN ESTADÍSTICAS CLUBIFY» (2026-11-13).
//
// PRIVACIDAD: solo conteos y promedios por NEGOCIO. Ninguna consulta devuelve
// nombre, teléfono, correo ni id de un cliente final.
//
// Definiciones (las del encargo, con lo que hubo que concretar, ver Paso 0):
//  - «Sello / visita» = un registro de compra en el escáner: acción STAMP,
//    VISIT, POINTS_ADD o CASHBACK_ADD, SIN `giftReason` (los regalados no son
//    una compra). Un escaneo = un sello.
//  - «Tarjeta activa» = pase ACTIVE o COMPLETED (completó el cartón; no es un
//    cliente perdido). Se excluyen los REVOKED.
//  - Histórico: clientes únicos = clientes con tarjeta activa; recurrentes =
//    los que tienen 2+ sellos en toda su vida.
//  - 90 días: clientes únicos = clientes con tarjeta activa y AL MENOS 1 sello
//    en los 90 días; recurrentes = 2+ sellos en esos 90 días.
//  - Días entre visitas: por cliente con 2+ sellos, el promedio de los saltos
//    entre sellos consecutivos; luego el promedio de esos promedios.
//  - Ingresos registrados: suma de `purchaseAmount` (monto que el cajero
//    escribe al sellar, obligatorio desde 2026-05-10), en la moneda del negocio.
//
//   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
//     node scripts/estadisticas-casos-de-exito.cjs > estadisticas.txt
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

const COMPRA = `s.action IN ('STAMP','VISIT','POINTS_ADD','CASHBACK_ADD') AND s."giftReason" IS NULL`;
const PRIORIZADOS = ['nudo', 'motilart', 'wok', 'konys', 'cocoa', 'gloriosa', 'drive', 'quipao'];
const DESDE_MONTO_OBLIGATORIO = '2026-05-10';
const n = (v) => (v == null ? null : Number(v));
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const f1 = (v) => (v == null || Number.isNaN(v) ? '—' : (Math.round(v * 10) / 10).toString().replace('.', ','));
const dinero = (v) => (v == null ? '—' : Math.round(v).toLocaleString('es-CO'));

async function ventana(desde) {
  // Una fila por negocio con todo lo de esa ventana. `desde` null = histórico.
  const filtro = desde ? `AND s."createdAt" >= now() - interval '${desde} days'` : '';
  return p.$queryRawUnsafe(`
    WITH activos AS (
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
    -- Una VISITA = los sellos del mismo cliente con menos de 2 h entre sí. Sin
    -- esto, el cliente que tiene dos tarjetas del negocio y recibe un sello en
    -- cada una en la misma compra cuenta como «recompra»: Momento salía con
    -- 97 % por eso (30 clientes, 2 sellos cada uno a minutos de distancia).
    -- El monto de la visita es el MAYOR, no la suma, por la misma razón.
    compras AS (
      SELECT "tenantId", "customerId", min("createdAt") "createdAt", max("purchaseAmount") "purchaseAmount"
        FROM numeradas GROUP BY "tenantId", "customerId", visita
    ),
    por_cliente AS (
      SELECT "tenantId", "customerId", count(*) sellos FROM compras GROUP BY 1, 2
    ),
    saltos AS (
      SELECT "tenantId", "customerId",
             EXTRACT(EPOCH FROM ("createdAt" - lag("createdAt") OVER (PARTITION BY "tenantId", "customerId" ORDER BY "createdAt"))) / 86400.0 dias
        FROM compras
    ),
    por_cliente_saltos AS (
      SELECT "tenantId", "customerId", avg(dias) dias FROM saltos WHERE dias IS NOT NULL GROUP BY 1, 2
    ),
    base AS (
      ${desde
        ? `SELECT "tenantId", count(*) unicos FROM por_cliente GROUP BY 1`
        : `SELECT "tenantId", count(*) unicos FROM activos GROUP BY 1`}
    )
    SELECT b."tenantId",
           b.unicos::int AS unicos,
           coalesce((SELECT count(*) FROM por_cliente pc WHERE pc."tenantId" = b."tenantId" AND pc.sellos >= 2), 0)::int AS recurrentes,
           coalesce((SELECT sum(sellos) FROM por_cliente pc WHERE pc."tenantId" = b."tenantId"), 0)::int AS sellos,
           (SELECT avg(dias) FROM por_cliente_saltos x WHERE x."tenantId" = b."tenantId") AS dias_entre,
           (SELECT sum("purchaseAmount") FROM compras c WHERE c."tenantId" = b."tenantId" AND c."purchaseAmount" > 0) AS ingresos,
           (SELECT count(*) FROM compras c WHERE c."tenantId" = b."tenantId" AND c."purchaseAmount" > 0)::int AS con_monto
      FROM base b`);
}

(async () => {
  const negocios = await p.$queryRawUnsafe(`
    SELECT t.id, t.slug, coalesce(t."brandName", t.name) nombre, t."createdAt", t.currency, t.status,
           w.name AS marca,
           (SELECT min(s."createdAt") FROM "Stamp" s WHERE s."tenantId" = t.id) primer_sello
      FROM "Tenant" t LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
     WHERE t."deletedAt" IS NULL AND t."isCampaignHost" = false`);
  const porId = new Map(negocios.map((t) => [t.id, t]));

  // ── PASO 0 ──────────────────────────────────────────────────────────────
  console.log('############ PASO 0 — VALIDACIÓN');
  const [g] = await p.$queryRawUnsafe(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE "purchaseAmount" > 0)::int con_monto,
           count(*) FILTER (WHERE "createdAt" >= '${DESDE_MONTO_OBLIGATORIO}')::int total_desde,
           count(*) FILTER (WHERE "createdAt" >= '${DESDE_MONTO_OBLIGATORIO}' AND "purchaseAmount" > 0)::int con_monto_desde,
           count(*) FILTER (WHERE "orderId" IS NOT NULL)::int de_pedidos,
           min("createdAt") primero
      FROM "Stamp" s WHERE ${COMPRA}`);
  console.log(`Sellos de compra: ${g.total} (primero ${String(g.primero).slice(0, 10)}). Con monto de compra: ${g.con_monto} (${pct(g.con_monto, g.total)} %).`);
  console.log(`Desde ${DESDE_MONTO_OBLIGATORIO} (monto obligatorio en el escáner): ${g.total_desde} sellos, con monto ${g.con_monto_desde} (${pct(g.con_monto_desde, g.total_desde)} %). Sellos que vienen de un pedido en línea: ${g.de_pedidos}.`);
  const [regalos] = await p.$queryRawUnsafe(`SELECT count(*)::int c FROM "Stamp" s WHERE s."giftReason" IS NOT NULL`);
  console.log(`Sellos regalados (cortesía / fecha especial), fuera del cálculo: ${regalos.c}.`);

  // Por negocio: qué % de sus sellos tiene monto y si el monto parece real.
  const uso = await p.$queryRawUnsafe(`
    SELECT s."tenantId",
           count(*)::int sellos,
           count(*) FILTER (WHERE "purchaseAmount" > 0)::int con_monto,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY "purchaseAmount") FILTER (WHERE "purchaseAmount" > 0) mediana,
           count(*) FILTER (WHERE "purchaseAmount" > 0 AND "purchaseAmount" < 1000)::int montos_bajos
      FROM "Stamp" s WHERE ${COMPRA} AND s."createdAt" >= '${DESDE_MONTO_OBLIGATORIO}'
     GROUP BY 1`);
  const conSellos = uso.filter((u) => u.sellos >= 20);
  const lleno = conSellos.filter((u) => u.con_monto / u.sellos >= 0.8);
  console.log(`Negocios con 20+ sellos desde ${DESDE_MONTO_OBLIGATORIO}: ${conSellos.length}. Con monto en el 80 %+ de sus sellos: ${lleno.length} (${pct(lleno.length, conSellos.length)} %).`);
  console.log('Detalle por negocio (sellos desde el monto obligatorio · % con monto · mediana del monto · % de montos < 1.000 en su moneda):');
  for (const u of conSellos.sort((a, b) => b.sellos - a.sellos)) {
    const t = porId.get(u.tenantId);
    if (!t) continue;
    console.log(`  ${t.nombre} [${t.marca ?? '—'}, ${t.currency}] · ${u.sellos} · ${pct(u.con_monto, u.sellos)} % · mediana ${dinero(n(u.mediana))} · bajos ${pct(u.montos_bajos, u.con_monto)} %`);
  }
  const [ped] = await p.$queryRawUnsafe(`
    SELECT count(DISTINCT "tenantId")::int negocios, count(*)::int pedidos
      FROM "Order" WHERE status NOT IN ('CANCELLED') `).catch(() => [{ negocios: '?', pedidos: '?' }]);
  console.log(`Pedidos en línea (carta/tienda de Clubify, con total en dinero): ${ped.pedidos} en ${ped.negocios} negocios.`);

  // ── REPORTE ─────────────────────────────────────────────────────────────
  const [hist, d90] = [await ventana(null), await ventana(90)];
  const h = new Map(hist.map((r) => [r.tenantId, r]));
  const r90 = new Map(d90.map((r) => [r.tenantId, r]));
  const hoy = Date.now();
  const fila = (t) => {
    const a = h.get(t.id) ?? { unicos: 0, recurrentes: 0, sellos: 0 };
    const b = r90.get(t.id) ?? { unicos: 0, recurrentes: 0, sellos: 0 };
    const dias = Math.floor((hoy - new Date(t.createdAt).getTime()) / 86400000);
    return { t, a, b, dias, entra: a.unicos >= 30 && dias >= 60 };
  };
  const filas = negocios.map(fila);
  const linea = ({ t, a, b, dias, entra }) =>
    [
      t.nombre, t.marca ?? '—', String(t.createdAt).slice(0, 10) + ` (${dias} d)`, t.status,
      `${a.unicos} / ${b.unicos}`,
      `${a.recurrentes} / ${b.recurrentes}`,
      `${f1(pct(a.recurrentes, a.unicos))} % / ${f1(pct(b.recurrentes, b.unicos))} %`,
      `${f1(a.unicos ? a.sellos / a.unicos : null)} / ${f1(b.unicos ? b.sellos / b.unicos : null)}`,
      `${f1(n(a.dias_entre))} / ${f1(n(b.dias_entre))}`,
      `${dinero(n(a.ingresos))} / ${dinero(n(b.ingresos))} ${t.currency} (sellos con monto ${a.con_monto ?? 0}/${a.sellos})`,
      entra ? '' : 'FUERA (<30 clientes o <60 días)',
    ].join(' | ');
  const cab = 'Negocio | Marca | Alta | Estado | Únicos H/90 | Recurrentes H/90 | % recompra H/90 | Frecuencia H/90 | Días entre visitas H/90 | Ingresos registrados H/90 | Nota';

  console.log('\n############ 1. LOS 8 CASOS NOMBRADOS');
  console.log(cab);
  for (const k of PRIORIZADOS) {
    const hits = filas.filter((x) => (x.t.nombre + ' ' + x.t.slug).toLowerCase().includes(k));
    if (!hits.length) console.log(`${k}: NO SE ENCONTRÓ en la base`);
    for (const x of hits) console.log(linea(x));
  }

  const elegibles = filas.filter((x) => x.entra);
  console.log(`\n############ 2. TOP 10 POR CLIENTES ÚNICOS (elegibles: ${elegibles.length})`);
  console.log(cab);
  for (const x of [...elegibles].sort((a, b) => b.a.unicos - a.a.unicos).slice(0, 10)) console.log(linea(x));
  console.log('\n############ 2b. TOP 10 POR SELLOS ENTREGADOS (histórico)');
  console.log(cab);
  for (const x of [...elegibles].sort((a, b) => b.a.sellos - a.a.sellos).slice(0, 10)) console.log(linea(x));
  console.log('\n############ 2c. TOP 10 POR % DE RECOMPRA (histórico, elegibles)');
  console.log(cab);
  for (const x of [...elegibles].sort((a, b) => b.a.recurrentes / b.a.unicos - a.a.recurrentes / a.a.unicos).slice(0, 10)) console.log(linea(x));

  console.log('\n############ 3. AGREGADO — negocios ACTIVOS y en PRUEBA, elegibles');
  for (const grupo of [['Todas las marcas', () => true], ['Solo marca Clubify', (x) => (x.t.marca ?? 'Clubify') === 'Clubify']]) {
    const xs = elegibles.filter((x) => x.t.status !== 'SUSPENDED').filter(grupo[1]);
    const suma = (k, w) => xs.reduce((s, x) => s + (x[w][k] ?? 0), 0);
    const media = (fn) => { const v = xs.map(fn).filter((y) => y != null && !Number.isNaN(y)); return v.length ? v.reduce((s, y) => s + y, 0) / v.length : null; };
    console.log(`${grupo[0]}: ${xs.length} negocios`);
    console.log(`  Únicos H/90: ${suma('unicos', 'a')} / ${suma('unicos', 'b')} · Recurrentes H/90: ${suma('recurrentes', 'a')} / ${suma('recurrentes', 'b')}`);
    console.log(`  % recompra (todos los clientes juntos) H/90: ${f1(pct(suma('recurrentes', 'a'), suma('unicos', 'a')))} % / ${f1(pct(suma('recurrentes', 'b'), suma('unicos', 'b')))} %`);
    console.log(`  % recompra (promedio de negocios) H/90: ${f1(media((x) => pct(x.a.recurrentes, x.a.unicos)))} % / ${f1(media((x) => pct(x.b.recurrentes, x.b.unicos)))} %`);
    console.log(`  Frecuencia (todos juntos) H/90: ${f1(suma('sellos', 'a') / suma('unicos', 'a'))} / ${f1(suma('sellos', 'b') / suma('unicos', 'b'))}`);
    console.log(`  Días entre visitas (promedio de negocios) H/90: ${f1(media((x) => n(x.a.dias_entre)))} / ${f1(media((x) => n(x.b.dias_entre)))}`);
    console.log('  Ingresos agregados: no se suman entre monedas distintas; ver por negocio.');
  }

  // ── REVISIÓN DE MOMENTO ─────────────────────────────────────────────────
  // 97 % de recompra con 31 clientes salió demasiado alto (2026-11-13). Se
  // mira si los sellos parecen compras reales o escaneos repetidos.
  const momento = [];
  for (const t of negocios.filter((x) => (x.nombre + ' ' + x.slug).toLowerCase().includes('momento'))) {
    const q = (sql) => p.$queryRawUnsafe(sql, t.id);
    const [pases] = await q(`SELECT count(*)::int total,
        count(*) FILTER (WHERE status IN ('ACTIVE','COMPLETED'))::int activos,
        count(*) FILTER (WHERE status = 'REVOKED')::int revocados,
        count(DISTINCT "customerId")::int clientes FROM "Pass" WHERE "tenantId" = $1`);
    const hist = await q(`WITH c AS (SELECT s."customerId", count(*) n FROM "Stamp" s WHERE s."tenantId" = $1 AND ${COMPRA} GROUP BY 1)
        SELECT CASE WHEN n = 1 THEN '1' WHEN n <= 4 THEN '2-4' WHEN n <= 9 THEN '5-9' WHEN n <= 19 THEN '10-19' ELSE '20+' END b, count(*)::int c
          FROM c GROUP BY 1 ORDER BY min(n)`);
    const [saltos] = await q(`WITH x AS (SELECT s."createdAt" - lag(s."createdAt") OVER (PARTITION BY s."customerId" ORDER BY s."createdAt") d
          FROM "Stamp" s WHERE s."tenantId" = $1 AND ${COMPRA})
        SELECT count(d)::int saltos,
               count(*) FILTER (WHERE d < interval '10 minutes')::int menos_10min,
               count(*) FILTER (WHERE d < interval '1 hour')::int menos_1h,
               count(*) FILTER (WHERE d < interval '20 hours')::int mismo_dia,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM d)/86400.0) mediana_dias FROM x WHERE d IS NOT NULL`);
    const [sellos] = await q(`SELECT count(*)::int total, count(*) FILTER (WHERE "purchaseAmount" > 0)::int con_monto,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "purchaseAmount") FILTER (WHERE "purchaseAmount" > 0) mediana,
        count(DISTINCT "operatorId")::int operadores, count(*) FILTER (WHERE note IS NOT NULL)::int con_nota,
        count(DISTINCT date_trunc('day', "createdAt"))::int dias_con_sellos,
        min("createdAt") primero, max("createdAt") ultimo
        FROM "Stamp" s WHERE s."tenantId" = $1 AND ${COMPRA}`);
    const [topOp] = await q(`SELECT max(c)::int c FROM (SELECT count(*) c FROM "Stamp" s WHERE s."tenantId" = $1 AND ${COMPRA} GROUP BY "operatorId") z`);
    const [topDia] = await q(`SELECT max(c)::int c FROM (SELECT count(*) c FROM "Stamp" s WHERE s."tenantId" = $1 AND ${COMPRA} GROUP BY date_trunc('day', "createdAt")) z`);
    const [cliDia] = await q(`SELECT max(c)::int c FROM (SELECT count(*) c FROM "Stamp" s WHERE s."tenantId" = $1 AND ${COMPRA} GROUP BY "customerId", date_trunc('day', "createdAt")) z`);
    const [ajustes] = await q(`SELECT count(*)::int c FROM "Stamp" s WHERE s."tenantId" = $1 AND s.action = 'STAMP' AND s.amount < 0`);
    const [regalados] = await q(`SELECT count(*)::int c FROM "Stamp" s WHERE s."tenantId" = $1 AND s."giftReason" IS NOT NULL`);
    const [canjes] = await q(`SELECT count(*)::int c FROM "Stamp" s WHERE s."tenantId" = $1 AND s.action = 'REDEEM'`);
    const [tarjetas] = await q(`SELECT string_agg(DISTINCT c.type::text, ',') tipos, count(DISTINCT c.id)::int n FROM "Card" c WHERE c."tenantId" = $1`);
    momento.push({ nombre: t.nombre, status: t.status, alta: t.createdAt, currency: t.currency, pases, hist, saltos, sellos, topOp: topOp.c, topDia: topDia.c, maxClienteDia: cliDia.c, ajustes: ajustes.c, regalados: regalados.c, canjes: canjes.c, tarjetas });
  }

  // ── SALIDA PARA EL INFORME (JSON) ───────────────────────────────────────
  const u = new Map(uso.map((x) => [x.tenantId, x]));
  const [tickets, tickets90] = await Promise.all([null, 90].map((d) => p.$queryRawUnsafe(`
    SELECT s."tenantId", avg(s."purchaseAmount") prom, percentile_cont(0.5) WITHIN GROUP (ORDER BY s."purchaseAmount") mediana
      FROM "Stamp" s WHERE ${COMPRA} AND s."purchaseAmount" > 0 ${d ? `AND s."createdAt" >= now() - interval '${d} days'` : ''} GROUP BY 1`)));
  const tk = new Map(tickets.map((x) => [x.tenantId, x]));
  const tk90 = new Map(tickets90.map((x) => [x.tenantId, x]));
  const vista = (w, mapaT) => (x) => {
    const r = x[w]; const k = mapaT.get(x.t.id);
    return { unicos: r.unicos, recurrentes: r.recurrentes, sellos: r.sellos, recompra: pct(r.recurrentes, r.unicos),
      frecuencia: r.unicos ? Math.round((100 * r.sellos) / r.unicos) / 100 : null,
      diasEntre: r.dias_entre == null ? null : Math.round(10 * n(r.dias_entre)) / 10,
      ingresos: r.ingresos == null ? null : Math.round(n(r.ingresos)), conMonto: r.con_monto ?? 0,
      ticketProm: k ? Math.round(n(k.prom)) : null, ticketMediana: k ? Math.round(n(k.mediana)) : null };
  };
  const salida = filas.filter((x) => x.a.unicos > 0).map((x) => {
    const m = u.get(x.t.id);
    return { nombre: x.t.nombre, marca: x.t.marca ?? 'Clubify', status: x.t.status, currency: x.t.currency, alta: String(x.t.createdAt).slice(0, 10), dias: x.dias, elegible: x.entra,
      nombrado: PRIORIZADOS.some((k) => (x.t.nombre + ' ' + x.t.slug).toLowerCase().includes(k)),
      pctMontoBajo: m ? pct(m.montos_bajos, m.con_monto) : null, pctConMonto: m ? pct(m.con_monto, m.sellos) : null,
      h: vista('a', tk)(x), d90: vista('b', tk90)(x) };
  });
  console.log('\n@@JSON@@' + JSON.stringify({ generado: new Date().toISOString(), paso0: g, regalos: regalos.c, pedidos: ped, negocios: salida, momento }));
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
