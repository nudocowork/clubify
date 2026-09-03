/**
 * Manda una notificación de prueba a los dispositivos de un usuario.
 *
 * Existe porque el endpoint /devices/prueba exige sesión y desde consola no
 * hay uno: esto entra por la base y usa el mismo servicio de envío.
 *
 * Uso:  railway run node scripts/send-test-push.cjs correo@ejemplo.com
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const email = process.argv[2];
  if (!email) {
    console.error('Falta el correo. Uso: node scripts/send-test-push.cjs correo@ejemplo.com');
    process.exit(1);
  }

  const user = await p.user.findUnique({ where: { email }, select: { id: true, fullName: true } });
  if (!user) {
    console.error(`No existe ningún usuario con el correo ${email}`);
    process.exit(1);
  }

  const dispositivos = await p.deviceToken.findMany({
    where: { userId: user.id },
    select: { platform: true, token: true, createdAt: true, lastSeenAt: true },
  });

  console.log(`Usuario: ${user.fullName} (${email})`);
  console.log(`Dispositivos registrados: ${dispositivos.length}`);
  for (const d of dispositivos) {
    console.log(`  ${d.platform.padEnd(8)} …${d.token.slice(-12)}  registrado ${d.createdAt.toISOString().slice(0, 16)}`);
  }
  if (dispositivos.length === 0) {
    console.log('\nNada que enviar. Abre la app, inicia sesión y acepta el permiso de notificaciones.');
    return p.$disconnect();
  }

  const ios = dispositivos.filter((d) => d.platform === 'ios').map((d) => d.token);
  if (ios.length === 0) {
    console.log('\nSolo hay dispositivos Android y FCM todavía no está configurado.');
    return p.$disconnect();
  }

  const key = Buffer.from(process.env.APP_PUSH_KEY_BASE64 || '', 'base64').toString('utf8');
  const keyId = process.env.APP_PUSH_KEY_ID;
  const teamId = process.env.APP_PUSH_TEAM_ID;
  const topic = process.env.APP_PUSH_BUNDLE_ID || 'com.soyclubify.app';
  if (!key || !keyId || !teamId) {
    console.error('Faltan las variables APP_PUSH_*. ¿Estás corriendo con `railway run`?');
    process.exit(1);
  }
  console.log(`\nAPNs: keyId=${keyId} team=${teamId} topic=${topic}`);

  const apn = require('apn');
  const enviar = async (production) => {
    const prov = new apn.Provider({ token: { key, keyId, teamId }, production });
    try {
      return await prov.send(
        Object.assign(new apn.Notification(), {
          topic,
          alert: { title: 'Clubify', body: 'Las notificaciones están funcionando 🎉' },
          sound: 'default',
          pushType: 'alert',
          payload: { ruta: '/hub' },
        }),
        ios,
      );
    } finally {
      prov.shutdown();
    }
  };

  let r = await enviar(true);
  console.log(`production → enviados ${r.sent.length}, fallidos ${r.failed.length}`);
  if (r.failed.length) {
    console.log('  motivos:', r.failed.map((f) => f.response?.reason || f.error?.message).join(', '));
  }

  // Un build instalado por cable tiene token de SANDBOX: production lo
  // rechaza con BadDeviceToken. Se reintenta ahí antes de dar por roto nada.
  if (r.sent.length === 0 && r.failed.every((f) => f.response?.reason === 'BadDeviceToken')) {
    console.log('\nTokens de sandbox (build por cable) — reintentando en APNs de desarrollo…');
    r = await enviar(false);
    console.log(`sandbox → enviados ${r.sent.length}, fallidos ${r.failed.length}`);
    if (r.failed.length) {
      console.log('  motivos:', r.failed.map((f) => f.response?.reason || f.error?.message).join(', '));
    }
  }

  console.log(r.sent.length > 0 ? '\n✅ Enviado. Mira el teléfono.' : '\n❌ No se pudo entregar.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
