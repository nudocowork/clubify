// Punto 1 SELLEALA: activar el ÚNICO preset admin_* de WhatsApp que faltaba en
// Sellea — `admin_charge_date_moved` (aviso "mover próximo cobro"). Los otros 4
// (protest/refunded/chargeback/cancellation) ya estaban ON; los correos vienen
// ON por defecto. Escribe el Setting de activación por marca:
//   sms.enabled.wl.<selleaId>.admin_charge_date_moved = 'true'
// (formato de brandMsgEnabledKey, integrations/brand-message-templates.ts).
//
// Event-driven: no manda nada al correr; dispara al negocio (no al cliente
// final) cuando se mueva una fecha de cobro. Idempotente (upsert). Reversible
// borrando el Setting o poniéndolo en 'false'.
//
// Uso: railway run --service Postgres-Nq8w node scripts/enable-sellea-admin-charge-date-moved.cjs
const { PrismaClient } = require('@prisma/client');

const TEMPLATE_ID = 'admin_charge_date_moved';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({
    where: { slug: 'sellea' },
    select: { id: true, name: true, growBusinessLocationId: true },
  });
  if (!wl) { console.error('No existe la marca sellea'); process.exit(1); }
  if (!wl.growBusinessLocationId) {
    console.log('⚠ Sellea NO tiene subcuenta Grow Business — el preset se activa igual pero no saldrá hasta conectarla.');
  }

  const key = `sms.enabled.wl.${wl.id}.${TEMPLATE_ID}`;
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: 'true' },
    update: { value: 'true' },
  });
  console.log(`• ${key} = 'true' ✓`);

  // Verificación: los 5 admin_* de Sellea
  const ids = ['admin_protest','admin_refunded','admin_chargeback','admin_cancellation','admin_charge_date_moved'];
  const rows = await prisma.setting.findMany({
    where: { key: { in: ids.map((id) => `sms.enabled.wl.${wl.id}.${id}`) } },
    select: { key: true, value: true },
  });
  const on = new Set(rows.filter((r) => r.value?.trim() === 'true').map((r) => r.key.split('.').pop()));
  console.log('Estado admin_* Sellea:', JSON.stringify(ids.map((id) => ({ [id]: on.has(id) }))));

  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
