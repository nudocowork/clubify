/**
 * Prueba REAL del envío de correo por Grow Business, con las credenciales de
 * una marca de producción. Hace exactamente lo mismo que
 * `GrowBusinessService.sendEmailWithCreds`: upsert del contacto por correo y
 * POST /conversations/messages con `type: 'Email'`.
 *
 * Sirve para confirmar el contrato de la API ANTES de desplegar, en vez de
 * descubrirlo cuando un cliente no recibe su aviso de cobro.
 *
 * Uso:
 *   railway run npx ts-node scripts/probar-correo-ghl.ts <slugMarca> <correo>
 *
 * Manda UN correo real a la dirección que le pases. No toca la base.
 */
import { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../src/common/crypto/secret-box';

const API = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

const [slug, destino] = process.argv.slice(2);
const prisma = new PrismaClient();

async function main() {
  if (!slug || !destino) {
    console.error('Uso: probar-correo-ghl.ts <slugMarca> <correo>');
    process.exit(1);
  }

  const wl = await prisma.whiteLabel.findFirst({
    where: { slug },
    select: {
      name: true,
      growBusinessLocationId: true,
      growBusinessApiKey: true,
    },
  });
  if (!wl?.growBusinessLocationId || !wl.growBusinessApiKey) {
    console.error(`La marca "${slug}" no tiene subcuenta de Grow Business.`);
    process.exit(1);
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(wl.growBusinessApiKey);
  } catch (e) {
    console.error('No se pudo descifrar la API key:', (e as Error).message);
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Version: VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  console.log(`Marca: ${wl.name} · location ${wl.growBusinessLocationId}`);
  console.log(`Destino: ${destino}\n`);

  // 1. Upsert del contacto por correo (igual que el envío real).
  console.log('1) contacts/upsert por correo…');
  const up = await fetch(`${API}/contacts/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      locationId: wl.growBusinessLocationId,
      email: destino.trim().toLowerCase(),
    }),
  });
  const upBody = await up.text();
  console.log(`   status ${up.status}`);
  if (!up.ok) {
    console.error('   ✗ falló:', upBody.slice(0, 400));
    process.exit(1);
  }
  const upJson = JSON.parse(upBody);
  const contactId = upJson?.contact?.id ?? upJson?.id ?? upJson?.contactId;
  if (!contactId) {
    console.error('   ✗ sin contactId en la respuesta:', upBody.slice(0, 300));
    process.exit(1);
  }
  console.log(`   ✔ contactId ${contactId}\n`);

  // 2. El envío. Mismo payload exacto que sendEmailWithCreds.
  console.log("2) conversations/messages type 'Email'…");
  const payload = {
    type: 'Email',
    contactId,
    message: 'Prueba del canal de correo del ciclo de cobro.',
    subject: `Prueba de correo automático (${wl.name})`,
    html:
      '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">' +
      `<p>Esta es una prueba del canal de correo de <b>${wl.name}</b>.</p>` +
      '<p>Si te llegó, los avisos automáticos de cobro pueden salir por ' +
      'la subcuenta de Grow Business de la marca, igual que el SMS.</p>' +
      '</div>',
  };
  const res = await fetch(`${API}/conversations/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log(`   status ${res.status}`);
  console.log(`   respuesta: ${body.slice(0, 500)}\n`);

  if (res.ok) {
    console.log('✔ ENVIADO. Revisa la bandeja (y el spam).');
  } else {
    console.error('✗ El envío falló. El cuerpo de arriba dice por qué.');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
