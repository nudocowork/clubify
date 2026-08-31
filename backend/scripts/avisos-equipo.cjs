/**
 * Quién recibe los avisos automáticos del equipo, y cuáles.
 *
 * Es el Setting `prereg.alertPhones`. Se toca desde aquí para no tener que
 * editar JSON a mano en la base.
 *
 *   Ver:      railway run node scripts/avisos-equipo.cjs
 *   Poner:    railway run node scripts/avisos-equipo.cjs poner "Jhon" +573181666999 pago_sin_cuenta,preregistro
 *   Todos:    railway run node scripts/avisos-equipo.cjs poner "Javier" +573248088401 todos
 *   Quitar:   railway run node scripts/avisos-equipo.cjs quitar +573181666999
 *
 * Tipos: pago_sin_cuenta · nueva_compra · preregistro · trial · lab
 * `todos` = sin restricción (recibe también los avisos que se añadan mañana).
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const CLAVE = 'prereg.alertPhones';
const TIPOS = [
  'pago_sin_cuenta',
  'nueva_compra',
  'preregistro',
  'trial',
  'lab',
];

async function leer() {
  const s = await p.setting.findUnique({ where: { key: CLAVE } });
  if (!s?.value) return [];
  try {
    const v = JSON.parse(s.value);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function pintar(lista) {
  if (!lista.length) {
    console.log('  (vacío — el código cae a su lista por defecto)');
    return;
  }
  for (const d of lista) {
    const que = d.solo?.length ? d.solo.join(', ') : 'TODOS';
    console.log(`  ${String(d.name ?? '—').padEnd(10)} ${d.phone.padEnd(16)} -> ${que}`);
  }
}

(async () => {
  const [accion, ...resto] = process.argv.slice(2);
  const lista = await leer();

  if (!accion || accion === 'ver') {
    console.log(`${CLAVE}:`);
    pintar(lista);
    console.log(`\ntipos disponibles: ${TIPOS.join(' · ')}`);
    return p.$disconnect();
  }

  if (accion === 'poner') {
    const [name, phone, tiposRaw] = resto;
    if (!name || !phone) throw new Error('uso: poner "<nombre>" <telefono> <tipos|todos>');
    if (!/^\+\d{8,15}$/.test(phone)) {
      throw new Error('el teléfono va en formato +573001234567');
    }
    let solo;
    if (tiposRaw && tiposRaw !== 'todos') {
      solo = tiposRaw.split(',').map((x) => x.trim()).filter(Boolean);
      const malos = solo.filter((x) => !TIPOS.includes(x));
      if (malos.length) {
        throw new Error(`tipo(s) desconocido(s): ${malos.join(', ')}. Válidos: ${TIPOS.join(', ')}`);
      }
    }
    const otros = lista.filter((d) => d.phone !== phone);
    const nuevo = solo ? { name, phone, solo } : { name, phone };
    const final = [...otros, nuevo];
    await p.setting.upsert({
      where: { key: CLAVE },
      create: { key: CLAVE, value: JSON.stringify(final) },
      update: { value: JSON.stringify(final) },
    });
    console.log('queda así:');
    pintar(final);
    return p.$disconnect();
  }

  if (accion === 'quitar') {
    const [phone] = resto;
    if (!phone) throw new Error('uso: quitar <telefono>');
    const final = lista.filter((d) => d.phone !== phone);
    if (final.length === lista.length) {
      console.log(`${phone} no estaba en la lista — nada que hacer.`);
      return p.$disconnect();
    }
    await p.setting.upsert({
      where: { key: CLAVE },
      create: { key: CLAVE, value: JSON.stringify(final) },
      update: { value: JSON.stringify(final) },
    });
    console.log('queda así:');
    pintar(final);
    return p.$disconnect();
  }

  throw new Error(`acción desconocida "${accion}". Usa: ver | poner | quitar`);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
