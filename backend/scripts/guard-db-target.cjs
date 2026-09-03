#!/usr/bin/env node
/**
 * Freno de mano: aborta si `DATABASE_URL` NO apunta a una base local.
 *
 * Va delante de todo comando de Prisma que MUTA el esquema (`db push`,
 * `migrate dev`, `migrate reset`). Esos comandos sincronizan la base con el
 * schema: borran lo que no esté declarado. Contra producción eso significa
 * perder tablas y datos.
 *
 * No alcanza con documentarlo. En este proyecto ya pasó que producción tuviera
 * tablas que el schema no conocía (el motor de Email Marketing, tablas `Mkt*`)
 * y un `db push` las habría borrado con todo adentro. Documentar el peligro no
 * evita el accidente; esto sí.
 *
 * Para cambiar el esquema en PRODUCCIÓN, el camino correcto es un script
 * aditivo de SQL crudo, idempotente y con `IF NOT EXISTS`. Ejemplo a copiar:
 * `scripts/apply-email-config-migration.cjs`.
 */
const LOCALES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'postgres', // nombre del servicio en docker-compose
  'db',
]);

const url = process.env.DATABASE_URL;

if (!url) {
  console.error('\n  ⛔ No hay DATABASE_URL. No se ejecuta nada.\n');
  process.exit(1);
}

let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error('\n  ⛔ DATABASE_URL no se puede interpretar. No se ejecuta nada.\n');
  process.exit(1);
}

if (!LOCALES.has(host)) {
  console.error(
    [
      '',
      '  ⛔ ABORTADO: este comando MUTA el esquema y la base NO es local.',
      '',
      `     Host: ${host}`,
      '',
      '     Comandos como `prisma db push` o `migrate dev` sincronizan la base',
      '     con el schema: BORRAN lo que no esté declarado. Contra producción',
      '     eso es perder tablas y datos.',
      '',
      '     Producción tiene tablas que este schema no controla del todo (las',
      '     `Mkt*` del motor de Email Marketing) y dos índices únicos parciales',
      '     que Prisma no sabe expresar. Un push los borra igual.',
      '',
      '     ¿Necesitas cambiar el esquema en producción?',
      '     → Script aditivo de SQL crudo, con IF NOT EXISTS e idempotente.',
      '       Copia scripts/apply-email-config-migration.cjs',
      '',
      '     ¿Solo querías mirar qué hay en producción?',
      '     → railway run node scripts/diag-email-marketing.cjs  (solo lectura)',
      '',
      '     Ver docs/ESTADO-PRODUCCION.md',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`  ✔ Base local (${host}) — adelante.`);
