/**
 * Por qué un cliente ve su tarjeta con menos sellos de los que dice el panel.
 *
 * Nace del caso Cocoa Beauty (Javier, 2026-09-11): «no se reflejan los sellos
 * en la tarjeta, pero en el sistema sí aparecen». Contrastado contra la API de
 * Google: de los objetos que EXISTEN, el contador coincidía en el 100% — o sea
 * que el motor de actualización no era el problema. Lo que hay son dos cosas
 * distintas que se ven igual desde el panel:
 *
 *  · GOOGLE — `walletPlatform='GOOGLE'` significa que el cliente PULSÓ el
 *    botón, no que Google guardara la tarjeta (lo dice el propio endpoint
 *    `/passes/:id/google/guardado`). Si no completó el guardado, el objeto no
 *    existe en Google y no hay nada que actualizar.
 *
 *  · APPLE — el pase está instalado pero ya no hay ningún `WalletDevice`
 *    registrado. Sin registro, APNs no tiene a quién avisar y el pase se queda
 *    congelado como el día que se instaló. Pasa cuando Apple devuelve
 *    `Unregistered`/`BadDeviceToken` y se purga el registro.
 *
 * En los dos casos el arreglo es del lado del cliente: volver a guardar la
 * tarjeta (Google) o abrirla y deslizar hacia abajo para que se refresque
 * (Apple). Por eso conviene poder listar a quién le pasa.
 *
 *   railway run --service backend node scripts/diagnostico-tarjetas-mudas.cjs <slug>
 *   railway run --service backend node scripts/diagnostico-tarjetas-mudas.cjs <slug> --detalle
 *
 * Sin slug mira todo el sistema (sin consultar Google: solo el lado Apple).
 */
const { PrismaClient } = require('@prisma/client');

const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const DETALLE = process.argv.includes('--detalle');
// Consultar Google es una llamada por pase: se limita para no tardar una vida.
const TOPE_GOOGLE = 60;

(async () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
  });

  const filtro = slug ? `AND t.slug = '${slug.replace(/'/g, "''")}'` : '';
  const resumen = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(p."walletPlatform"::text, 'sin elegir') plataforma,
           count(*) total,
           count(*) FILTER (
             WHERE (SELECT count(*) FROM "WalletDevice" wd
                     WHERE wd."passId" = p.id AND wd.platform = 'APPLE') = 0
           ) sin_dispositivo_apple
      FROM "Pass" p JOIN "Tenant" t ON t.id = p."tenantId"
     WHERE p.status = 'ACTIVE' ${filtro}
     GROUP BY 1 ORDER BY 2 DESC`);

  console.log(slug ? `Negocio: ${slug}` : 'Todo el sistema');
  console.log('\nPases activos:');
  for (const r of resumen) {
    console.log(
      `  ${String(r.plataforma).padEnd(10)} ${String(Number(r.total)).padStart(5)} pases` +
        `  · sin dispositivo Apple: ${Number(r.sin_dispositivo_apple)}`,
    );
  }

  const mudosApple = await prisma.$queryRawUnsafe(`
    SELECT c."fullName", c.phone, p."stampsCount", p."walletInstalledAt"
      FROM "Pass" p JOIN "Tenant" t ON t.id = p."tenantId"
      JOIN "Customer" c ON c.id = p."customerId"
     WHERE p.status = 'ACTIVE' AND p."walletPlatform" = 'APPLE' ${filtro}
       AND (SELECT count(*) FROM "WalletDevice" wd
             WHERE wd."passId" = p.id AND wd.platform = 'APPLE') = 0
     ORDER BY p."stampsCount" DESC`);
  console.log(
    `\nAPPLE instalado y SIN dispositivo registrado (no se les puede avisar): ${mudosApple.length}`,
  );
  if (DETALLE) {
    for (const r of mudosApple.slice(0, 40)) {
      console.log(
        `   ${String(r.fullName).slice(0, 26).padEnd(26)} ${String(r.stampsCount).padStart(3)} sellos  ${r.phone ?? 'sin teléfono'}`,
      );
    }
  }

  if (!slug) {
    console.log('\n(sin slug no se consulta Google: sería una llamada por pase)');
    await prisma.$disconnect();
    return;
  }

  const deGoogle = await prisma.$queryRawUnsafe(`
    SELECT p.id, p."googleObjectId", p."stampsCount", c."fullName", ca."stampsRequired"
      FROM "Pass" p JOIN "Tenant" t ON t.id = p."tenantId"
      JOIN "Customer" c ON c.id = p."customerId"
      JOIN "Card" ca ON ca.id = p."cardId"
     WHERE p.status = 'ACTIVE' AND p."walletPlatform" = 'GOOGLE'
       AND p."googleObjectId" IS NOT NULL ${filtro}
     ORDER BY p."stampsCount" DESC LIMIT ${TOPE_GOOGLE}`);
  await prisma.$disconnect();

  const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
  if (!b64) {
    console.log('\n(sin GOOGLE_WALLET_SA_BASE64 no se puede mirar el lado de Google)');
    return;
  }
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const wallet = google.walletobjects({ version: 'v1', auth });

  let existe = 0;
  const noGuardaron = [];
  const desfasados = [];
  for (const r of deGoogle) {
    try {
      const o = await wallet.loyaltyobject.get({ resourceId: r.googleObjectId });
      existe++;
      const enGoogle = o.data.loyaltyPoints?.balance?.string ?? '';
      const enLaBase = `${r.stampsCount}/${r.stampsRequired}`;
      if (enGoogle !== enLaBase) desfasados.push(`${r.fullName}: base ${enLaBase}, Google "${enGoogle}"`);
    } catch {
      noGuardaron.push(`${r.fullName} (${r.stampsCount} sellos)`);
    }
  }
  console.log(`\nGOOGLE (muestra de ${deGoogle.length}):`);
  console.log(`  la tarjeta está de verdad en Google: ${existe}`);
  console.log(`  pulsaron guardar pero no completaron: ${noGuardaron.length}`);
  console.log(`  *** contador desfasado (esto SÍ sería un fallo nuestro): ${desfasados.length}`);
  for (const d of desfasados.slice(0, 15)) console.log('    -', d);
  if (DETALLE) for (const n of noGuardaron.slice(0, 40)) console.log('    ·', n);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
