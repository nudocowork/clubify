/**
 * Migración ADITIVA: `BrandWorkflowLog.recipient` (texto, nullable).
 *
 * A quién salió cada envío de un flujo de marca. Sin ella, el registro decía
 * «enviado» y no había manera de saber a qué correo o teléfono (Javier,
 * 2026-09-23). Las filas viejas se quedan en NULL y la pantalla enseña «—».
 *
 * Aditiva e idempotente. Aplicar ANTES de desplegar el backend: el cliente
 * nuevo pide la columna en cada lectura del registro.
 *
 * Uso:  railway run --service backend --environment production node scripts/apply-brand-workflow-log-recipient.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "BrandWorkflowLog" ADD COLUMN IF NOT EXISTS "recipient" TEXT`,
  );
  const hay = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'BrandWorkflowLog'
       AND column_name = 'recipient'
  `);
  if (!hay.length) throw new Error('La columna no quedó creada');
  console.log('Resultado:', hay[0]);
  console.log('Migración aplicada.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
