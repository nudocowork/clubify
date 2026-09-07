/**
 * Arqueo SOLO LECTURA: ¿a cuántos clientes les afecta que el «geo-push» no
 * salga en Android?
 *
 * Existe porque el reporte de Primor Barber Shop («las notificaciones de
 * ubicación llegan solo a iPhone») no se puede dimensionar desde el código:
 * hay que saber cuántos pases son de Google Wallet, cuántos de Apple, y qué
 * sedes tiene configuradas ese negocio. Se ejecuta con
 * `railway run node scripts/arqueo-wallet-android-geo.cjs` desde backend/.
 *
 * No escribe nada. No imprime tokens ni secretos: solo cuentas y, de las
 * sedes, si las coordenadas son válidas (no el valor exacto).
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    console.log('\n== PASS: plataforma de wallet (toda la plataforma) ==');
    const total = await p.pass.count();
    const apple = await p.pass.count({ where: { walletPlatform: 'APPLE' } });
    const google = await p.pass.count({ where: { walletPlatform: 'GOOGLE' } });
    const sinPlat = await p.pass.count({ where: { walletPlatform: null } });
    const instalados = await p.pass.count({ where: { walletInstalledAt: { not: null } } });
    const conGoogleObj = await p.pass.count({ where: { googleObjectId: { not: null } } });
    const googleYObj = await p.pass.count({
      where: { walletPlatform: 'GOOGLE', googleObjectId: { not: null } },
    });
    const appleYObj = await p.pass.count({
      where: { walletPlatform: 'APPLE', googleObjectId: { not: null } },
    });
    const activos = await p.pass.count({ where: { status: 'ACTIVE' } });
    const activosGoogle = await p.pass.count({
      where: { status: 'ACTIVE', walletPlatform: 'GOOGLE' },
    });
    const activosApple = await p.pass.count({
      where: { status: 'ACTIVE', walletPlatform: 'APPLE' },
    });
    console.log(`total pases:                       ${total}`);
    console.log(`  walletPlatform = APPLE:          ${apple}`);
    console.log(`  walletPlatform = GOOGLE:         ${google}`);
    console.log(`  walletPlatform = null:           ${sinPlat}`);
    console.log(`  walletInstalledAt != null:       ${instalados}`);
    console.log(`  googleObjectId != null:          ${conGoogleObj}`);
    console.log(`    de ellos con platform GOOGLE:  ${googleYObj}`);
    console.log(`    de ellos con platform APPLE:   ${appleYObj}  (pidió Google y luego bajó el .pkpass)`);
    console.log(`  status ACTIVE:                   ${activos}  (APPLE ${activosApple} / GOOGLE ${activosGoogle})`);

    console.log('\n== WalletDevice (registros de push por plataforma) ==');
    const devs = await p.walletDevice.groupBy({ by: ['platform'], _count: { _all: true } });
    if (!devs.length) console.log('  (vacío)');
    for (const d of devs) console.log(`  ${d.platform}: ${d._count._all}`);
    const pasesConDevice = await p.pass.count({ where: { walletDevices: { some: {} } } });
    console.log(`  pases con al menos un WalletDevice: ${pasesConDevice}`);

    console.log('\n== SEDES con coordenadas (toda la plataforma) ==');
    const sedes = await p.location.findMany({
      select: { latitude: true, longitude: true, isActive: true, radiusMeters: true },
    });
    const valida = (l) => {
      const lat = Number(l.latitude);
      const lng = Number(l.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
    };
    const activasValidas = sedes.filter((l) => l.isActive && valida(l)).length;
    console.log(`  sedes totales: ${sedes.length} · activas con coords válidas: ${activasValidas}`);
    const tenantsConSede = await p.location.groupBy({
      by: ['tenantId'],
      where: { isActive: true },
      _count: { _all: true },
    });
    console.log(`  negocios con al menos una sede activa: ${tenantsConSede.length}`);

    console.log('\n== PRIMOR BARBER SHOP ==');
    const tenants = await p.tenant.findMany({
      where: { name: { contains: 'primor', mode: 'insensitive' } },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!tenants.length) console.log('  no se encontró ningún tenant con "primor" en el nombre');
    for (const t of tenants) {
      console.log(`\n· ${t.name} (${t.slug}) · ${t.status} · ${t.id}`);
      const locs = await p.location.findMany({
        where: { tenantId: t.id },
        select: {
          name: true,
          isActive: true,
          radiusMeters: true,
          walletRelevantText: true,
          latitude: true,
          longitude: true,
        },
      });
      console.log(`  sedes: ${locs.length}`);
      for (const l of locs) {
        console.log(
          `   - ${l.name} · ${l.isActive ? 'activa' : 'INACTIVA'} · radio ${l.radiusMeters} m · ` +
            `coords ${valida(l) ? 'válidas' : 'INVÁLIDAS (0/0 o NaN)'} · ` +
            `texto: ${l.walletRelevantText ? JSON.stringify(l.walletRelevantText) : '(por defecto)'}`,
        );
      }
      const tp = await p.pass.groupBy({
        by: ['walletPlatform', 'status'],
        where: { tenantId: t.id },
        _count: { _all: true },
      });
      console.log('  pases por plataforma/estado:');
      for (const r of tp) console.log(`   - ${r.walletPlatform ?? 'null'} / ${r.status}: ${r._count._all}`);
      const gObj = await p.pass.count({ where: { tenantId: t.id, googleObjectId: { not: null } } });
      const devsT = await p.walletDevice.count({ where: { pass: { tenantId: t.id } } });
      console.log(`  pases con googleObjectId: ${gObj} · WalletDevice (Apple) del negocio: ${devsT}`);
      const notifs = await p.notification.findMany({
        where: { tenantId: t.id },
        orderBy: { sentAt: 'desc' },
        take: 5,
        select: { sentAt: true, triggerType: true, title: true, stats: true },
      });
      console.log(`  últimas ${notifs.length} notificaciones:`);
      for (const n of notifs) {
        console.log(
          `   - ${n.sentAt?.toISOString().slice(0, 16)} ${n.triggerType} «${(n.title || '').slice(0, 40)}» stats=${JSON.stringify(n.stats)}`,
        );
      }
    }
    console.log('');
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
