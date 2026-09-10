/**
 * Manda UN SMS interno por la subcuenta de una marca.
 *
 * Replica exactamente lo que hace `GrowBusinessService.sendSmsWithCreds`:
 * prefijo `#switch_unique|N|`, upsert del contacto en Grow Business (el
 * endpoint de mensajes ya no acepta el numero suelto: exige contactId) y POST
 * a /conversations/messages.
 *
 * Es para avisos internos al equipo, no para clientes. Un aviso a un cliente
 * sale del producto, no de un script.
 *
 *   railway run node scripts/enviar-aviso-interno.cjs <marca> <telefono> "<texto>"
 *   railway run node scripts/enviar-aviso-interno.cjs sellea +573248088401 "..." --enviar
 *
 * Sin `--enviar` solo ENSAYA: resuelve credenciales y enseña el mensaje tal
 * como saldria, sin mandar nada.
 */
const { PrismaClient } = require('@prisma/client');

const crypto = require('node:crypto');

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const SWITCH_POR_DEFECTO = 7;
const PREFIJO_CIFRADO = 'enc:v1:';

/**
 * La clave de Grow Business esta CIFRADA en la base (AES-256-GCM). Leerla en
 * crudo y mandarla a GHL devuelve «Invalid JWT» — que es lo que pasa si uno se
 * salta este paso. Espejo de `decryptSecret` en common/crypto/secret-box.ts.
 */
function descifrar(valor) {
  if (!valor || !valor.startsWith(PREFIJO_CIFRADO)) return valor;
  const bruta = process.env.SECRETS_ENC_KEY;
  if (!bruta) throw new Error('SECRETS_ENC_KEY no esta en el entorno');
  const clave = Buffer.from(bruta, 'base64');
  const [iv, tag, ct] = valor.slice(PREFIJO_CIFRADO.length).split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const [, , marcaSlug, telefonoRaw, textoArgv] = process.argv;
const ENVIAR = process.argv.includes('--enviar');

/**
 * El texto puede venir de un ARCHIVO en vez del argumento.
 *
 * Por qué: `railway run` corta el argumento en el primer salto de línea. El
 * 2026-09-10 mandé un aviso de 6 líneas y salió SOLO la primera — sin error,
 * sin aviso, y el script imprimió tan campante «699 caracteres» de lo que le
 * llegó. Un mensaje a medias no se distingue de uno completo. Para cualquier
 * texto con saltos de línea: escribirlo a un archivo UTF-8 y pasar --archivo.
 */
const iArch = process.argv.indexOf('--archivo');
const texto =
  iArch > -1
    ? require('node:fs').readFileSync(process.argv[iArch + 1], 'utf8').trim()
    : textoArgv;

if (!marcaSlug || !telefonoRaw || !texto) {
  console.error(
    'Uso: node scripts/enviar-aviso-interno.cjs <marca> <telefono> "<texto>" [--enviar]\n' +
      '     node scripts/enviar-aviso-interno.cjs <marca> <telefono> --archivo <ruta.txt> [--enviar]',
  );
  process.exit(1);
}

(async () => {
  const p = new PrismaClient();
  try {
    const wl = await p.whiteLabel.findFirst({
      where: { slug: marcaSlug },
      select: {
        id: true,
        name: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
      },
    });
    if (!wl) throw new Error(`no existe la marca "${marcaSlug}"`);
    if (!wl.growBusinessLocationId || !wl.growBusinessApiKey) {
      throw new Error(
        `la marca ${wl.name} no tiene subcuenta de Grow Business configurada — ` +
          'no puede mandar SMS',
      );
    }

    const telefono = telefonoRaw.trim().startsWith('+')
      ? telefonoRaw.trim()
      : `+${telefonoRaw.replace(/\D/g, '')}`;
    const sw =
      wl.growBusinessSwitchNumber != null
        ? wl.growBusinessSwitchNumber
        : SWITCH_POR_DEFECTO;
    const cuerpo = `#switch_unique|${sw}|${texto}`;

    console.log(`Marca:    ${wl.name} (${marcaSlug})`);
    const cifrada = String(wl.growBusinessApiKey).startsWith(PREFIJO_CIFRADO);
    console.log(`Subcuenta:${wl.growBusinessLocationId}   switch=${sw}   clave ${cifrada ? 'cifrada (se descifra)' : 'en claro'}`);
    console.log(`Para:     ${telefono}`);
    console.log(`\n--- el mensaje ---\n${texto}\n------------------`);
    console.log(`(${texto.length} caracteres)`);

    // CANDADO DE MARCA.
    //
    // El 2026-09-10 mandé un aviso por el número de Sellea firmado
    // «- Clubify». Sale del número de la marca, así que TODO lo que salga de
    // ahí es de esa marca: es la fuga de marca de siempre, esta vez hecha a
    // mano en el texto. Si el mensaje nombra a OTRA marca, no sale.
    const otras = await p.whiteLabel.findMany({
      where: { slug: { not: marcaSlug } },
      select: { name: true },
    });
    const intrusas = otras
      .map((o) => o.name)
      .filter((n) => n && texto.toLowerCase().includes(n.toLowerCase()));
    if (intrusas.length && !process.argv.includes('--igual')) {
      console.log(
        `\nBLOQUEADO · el texto nombra a ${intrusas.join(', ')} pero sale por el ` +
          `número de ${wl.name}.`,
      );
      console.log(
        '  Quien lo reciba verá el remitente de ' +
          wl.name +
          '. Quita esa marca del texto, o repite con --igual si de verdad es lo que quieres.',
      );
      return;
    }

    if (!ENVIAR) {
      console.log('\nENSAYO. Nada enviado. Repite con --enviar.');
      return;
    }

    const cabeceras = {
      Authorization: `Bearer ${descifrar(wl.growBusinessApiKey)}`,
      Version: API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const up = await fetch(`${API_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify({ locationId: wl.growBusinessLocationId, phone: telefono }),
    });
    if (!up.ok) {
      throw new Error(`upsert del contacto falló (${up.status}): ${(await up.text()).slice(0, 200)}`);
    }
    const datos = await up.json();
    const contactId = datos?.contact?.id ?? datos?.id;
    if (!contactId) throw new Error('el upsert no devolvió contactId');
    console.log(`\ncontacto: ${contactId}`);

    const env = await fetch(`${API_BASE}/conversations/messages`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify({ type: 'SMS', contactId, message: cuerpo }),
    });
    const respuesta = await env.text();
    if (!env.ok) {
      throw new Error(`el envío falló (${env.status}): ${respuesta.slice(0, 300)}`);
    }
    console.log(`ENVIADO · ${respuesta.slice(0, 200)}`);
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
