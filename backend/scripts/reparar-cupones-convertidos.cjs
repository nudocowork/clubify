/**
 * Repara los pases que se convirtieron de cupon a sellos y siguen enseñando el
 * cupon en la billetera del cliente.
 *
 * EL FALLO (arreglado en `google-wallet.service.ts` el 2026-09-10)
 * ---------------------------------------------------------------
 * Las clases de Google solo nacian dentro del JWT de `generateSaveUrl`. Al
 * canjear un cupon, el pase pasa a la tarjeta de sellos y el codigo pide
 * `card_<nuevo cardId>` — una clase que nadie creo nunca. El patch del objeto
 * daba 404 y NO escribia nada. El cliente seguia viendo su cupon.
 *
 * El arreglo crea la clase que falta, pero **solo cuando algo empuja el pase**.
 * Los ya rotos siguen rotos hasta que alguien los toca. Esto los toca.
 *
 * NO reinstala nada: el objeto de Google es el mismo y el cliente no hace nada.
 *
 *   railway run node scripts/reparar-cupones-convertidos.cjs            (ensayo)
 *   railway run node scripts/reparar-cupones-convertidos.cjs --aplicar
 *   railway run node scripts/reparar-cupones-convertidos.cjs --aplicar --negocio limorada
 *
 * Usa el endpoint REAL del panel (`POST /passes/:id/push-update`) con un token
 * de super admin firmado al vuelo, para pasar por el mismo camino que usa el
 * boton «Refrescar wallet». En modo `silent`: actualiza el pase sin mandarle
 * una notificacion al cliente, que no tiene por que enterarse de un arreglo.
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const APLICAR = process.argv.includes('--aplicar');
const iNeg = process.argv.indexOf('--negocio');
const SOLO = iNeg > -1 ? process.argv[iNeg + 1] : null;
const API = process.env.API_URL || 'https://api.soyclubify.com';
/** Entre empujon y empujon: la API de Google tiene cuota y 85 de golpe se ganan un 429. */
const PAUSA_MS = 400;

(async () => {
  const p = new PrismaClient();
  try {
    // Los convertidos: tienen un canje de CUPON en su historial y hoy su
    // tarjeta es de SELLOS. Solo importan los que llegaron a Google.
    const canjes = await p.stamp.findMany({
      where: { action: 'REDEEM', redeemKind: 'COUPON' },
      select: { passId: true },
    });
    const ids = [...new Set(canjes.map((c) => c.passId))];

    const pases = await p.pass.findMany({
      where: { id: { in: ids }, googleObjectId: { not: null }, status: 'ACTIVE' },
      select: {
        id: true,
        serialNumber: true,
        card: { select: { type: true, name: true } },
        customer: { select: { fullName: true } },
        tenant: { select: { slug: true, brandName: true, whiteLabelId: true } },
      },
    });
    let rotos = pases.filter((x) => x.card?.type === 'STAMPS');
    if (SOLO) rotos = rotos.filter((x) => x.tenant?.slug === SOLO);

    console.log(`Canjes de cupon: ${canjes.length} · pases distintos: ${ids.length}`);
    console.log(`Convertidos, con objeto en Google y activos: ${rotos.length}${SOLO ? ` (filtrado: ${SOLO})` : ''}\n`);

    const porNegocio = {};
    for (const x of rotos) porNegocio[x.tenant.slug] = (porNegocio[x.tenant.slug] ?? 0) + 1;
    for (const [k, v] of Object.entries(porNegocio).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${k.padEnd(26)} ${v}`);
    }

    if (!APLICAR) {
      console.log('\nENSAYO. Nada empujado. Repite con --aplicar.');
      return;
    }

    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET no esta en el entorno');

    // UN TOKEN POR MARCA, no uno global: el endpoint aisla los pases por la
    // marca del admin. Firmar con un admin de Sellea y pedir un pase de
    // Clubify devuelve `pass_not_found` — correcto, y es justo lo que paso en
    // el primer intento de esta reparacion.
    const tokens = new Map();
    async function credencialDeMarca(wlId) {
      const clave = wlId ?? 'sin-marca';
      if (tokens.has(clave)) return tokens.get(clave);
      let admin = await p.user.findFirst({
        where: { role: 'SUPER_ADMIN', isActive: true, whiteLabelId: wlId ?? null },
        select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true },
      });
      // Un negocio sin `whiteLabelId` pertenece de hecho a Clubify — misma
      // regla que `resolveBrandScope`. No hay NINGUN SUPER_ADMIN con
      // whiteLabelId nulo, asi que sin esto ni se intentaba.
      //
      // Aviso: con el respaldo puesto, el unico caso real (panama-smashpoint)
      // siguio dando `pass_not_found`. Los 6 negocios sin marca estan todos
      // SUSPENDED — son pruebas y bajas, no clientes. No se persiguio mas.
      if (!admin && wlId == null) {
        const clubify = await p.whiteLabel.findFirst({
          where: { slug: 'clubify' },
          select: { id: true },
        });
        if (clubify) {
          admin = await p.user.findFirst({
            where: { role: 'SUPER_ADMIN', isActive: true, whiteLabelId: clubify.id },
            select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true },
          });
        }
      }
      const par = admin
        ? {
            email: admin.email,
            token: jwt.sign(
              {
                sub: admin.id,
                email: admin.email,
                role: admin.role,
                tenantId: admin.tenantId,
                whiteLabelId: admin.whiteLabelId,
              },
              process.env.JWT_SECRET,
              { expiresIn: '60m' },
            ),
          }
        : null;
      tokens.set(clave, par);
      return par;
    }

    console.log(`
Empujando ${rotos.length} pases...
`);
    let ok = 0;
    const fallos = [];
    for (const x of rotos) {
      const cred = await credencialDeMarca(x.tenant?.whiteLabelId ?? null);
      if (!cred) {
        fallos.push({ pase: x.serialNumber, negocio: x.tenant.slug, motivo: 'sin admin de esa marca' });
        console.log(`  FALLO  ${x.tenant.slug.padEnd(24)} ${x.serialNumber.padEnd(16)} sin admin de esa marca`);
        continue;
      }
      const r = await fetch(`${API}/api/passes/${x.id}/push-update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cred.token}`, 'Content-Type': 'application/json' },
      })
        .then((res) => res.json())
        .catch((e) => ({ ok: false, status: e.message }));

      const etiqueta = `${x.tenant.slug.padEnd(24)} ${x.serialNumber.padEnd(16)}`;
      // La respuesta es `{sent, skipped, google:{ok,status}}` — NO trae un `ok`
      // arriba. Mirarlo ahi daba «fallo» en pases que se habian reparado bien.
      const exito = (r?.sent ?? 0) > 0 || r?.google?.ok === true;
      if (exito) {
        ok++;
        console.log(`  ok     ${etiqueta} ${r?.google?.status ?? ''}`);
      } else {
        const motivo = r?.google?.status ?? r?.error ?? r?.message ?? r?.status ?? '?';
        fallos.push({ pase: x.serialNumber, negocio: x.tenant.slug, motivo });
        console.log(`  FALLO  ${etiqueta} ${motivo}`);
      }
      await new Promise((res) => setTimeout(res, PAUSA_MS));
    }

    console.log(`\nlisto · reparados=${ok}  fallos=${fallos.length}`);
    if (fallos.length) {
      const motivos = {};
      for (const f of fallos) motivos[f.motivo] = (motivos[f.motivo] ?? 0) + 1;
      console.log('Motivos:');
      for (const [k, v] of Object.entries(motivos)) console.log(`   ${k}: ${v}`);
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
