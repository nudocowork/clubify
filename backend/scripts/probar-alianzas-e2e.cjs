/**
 * Prueba de punta a punta del módulo de ALIANZAS contra la API LOCAL.
 *
 * Recorre lo mismo que hará el dueño: encender el módulo, crear la alianza con
 * su beneficio, sacar los dos enlaces, activar la tarjeta como empleado,
 * generar el pase, verlo en el portal del aliado, escanearlo en caja, canjear,
 * anular dos veces y probar el doble interruptor.
 *
 * Existe porque los 164 tests unitarios corren contra un doble de Prisma en
 * memoria: prueban la lógica, no el cableado. Este script fue el que encontró
 * que `GET /public/alianzas/portal/:token` lo capturaba la ruta comodín
 * `:tenantSlug/:convenioSlug` y el portal del aliado respondía 404 SIEMPRE —
 * un fallo que ningún test de servicio podía ver.
 *
 * Cómo correrlo (todo en LOCAL, nunca contra producción):
 *   docker compose -f docker/docker-compose.yml up -d
 *   cd backend
 *   npx prisma db push && npm run seed
 *   npx nest start -b swc            (en otra ventana)
 *   node scripts/probar-alianzas-e2e.cjs
 *
 * Deja datos en la base local: para repetirlo desde cero, vuelve a sembrar.
 */
const API = 'http://localhost:4949/api';

if (!/localhost|127\.0\.0\.1/.test(API)) {
  console.error('ABORTA: este script solo corre contra la API local.');
  process.exit(1);
}

let fallos = 0;
function ok(nombre, cond, extra = '') {
  if (cond) console.log(`  ✓ ${nombre}`);
  else {
    fallos++;
    console.log(`  ✗ ${nombre} ${extra}`);
  }
}

async function pedir(ruta, { metodo = 'GET', token, cuerpo } = {}) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const texto = await r.text();
  let datos = null;
  try {
    datos = JSON.parse(texto);
  } catch {
    datos = texto;
  }
  return { estado: r.status, datos };
}

(async () => {
  console.log('\n── 1. Sesiones ──');
  const admin = await pedir('/auth/login', {
    metodo: 'POST',
    cuerpo: { email: 'admin@clubify.local', password: 'Clubify123!' },
  });
  ok('login super admin', admin.estado === 200 || admin.estado === 201, JSON.stringify(admin.datos).slice(0, 200));
  const tokenAdmin = admin.datos?.accessToken ?? admin.datos?.token ?? admin.datos?.access_token;

  const duenio = await pedir('/auth/login', {
    metodo: 'POST',
    cuerpo: { email: 'demo@clubify.local', password: 'Demo123!' },
  });
  ok('login dueño del negocio', duenio.estado === 200 || duenio.estado === 201);
  const tokenDuenio = duenio.datos?.accessToken ?? duenio.datos?.token ?? duenio.datos?.access_token;

  const yo = await pedir('/tenants/me', { token: tokenDuenio });
  ok('GET /tenants/me responde (el panel entero cuelga de aquí)', yo.estado === 200);
  const tenantId = yo.datos?.id;
  const tenantSlug = yo.datos?.slug;
  console.log(`     negocio: ${yo.datos?.brandName} · slug ${tenantSlug}`);

  console.log('\n── 2. El módulo apagado NO deja hacer nada ──');
  const apagado = await pedir('/convenios', { token: tokenDuenio });
  ok('con el módulo apagado, la lista dice habilitado:false', apagado.datos?.habilitado === false);
  const crearApagado = await pedir('/convenios', {
    metodo: 'POST',
    token: tokenDuenio,
    cuerpo: { name: 'No debería crearse' },
  });
  ok('crear con el módulo apagado se rechaza', crearApagado.estado === 403, `estado ${crearApagado.estado}`);

  console.log('\n── 3. Encender el módulo desde el panel de admin ──');
  const encender = await pedir(`/tenants/${tenantId}`, {
    metodo: 'PATCH',
    token: tokenAdmin,
    cuerpo: { conveniosEnabled: true, maxConvenios: 3 },
  });
  ok('PATCH conveniosEnabled acepta el campo nuevo', encender.estado === 200, JSON.stringify(encender.datos).slice(0, 250));

  console.log('\n── 4. Crear la alianza con su primer beneficio ──');
  const creado = await pedir('/convenios', {
    metodo: 'POST',
    token: tokenDuenio,
    cuerpo: {
      name: 'Confenalco',
      verificacion: 'CODIGO',
      codigo: 'CONFE2026',
      endsAt: null,
      beneficio: {
        name: 'Almuerzo ejecutivo',
        tipo: 'PERCENT_OFF',
        valor: 15,
        maxPorPersona: 1,
        periodo: 'DIA',
      },
    },
  });
  ok('se crea la alianza', creado.estado === 201 || creado.estado === 200, JSON.stringify(creado.datos).slice(0, 250));
  const convenioId = creado.datos?.id;
  const convenioSlug = creado.datos?.slug;
  ok('nace con vigencia ILIMITADA', creado.datos?.endsAt === null);
  ok('nace con aliadoToken', !!creado.datos?.aliadoToken);

  const ficha = await pedir(`/convenios/${convenioId}`, { token: tokenDuenio });
  ok('el beneficio se creó en la misma llamada', ficha.datos?.cupones?.length === 1);
  ok('el beneficio nace con las DOS llaves encendidas',
    ficha.datos?.cupones?.[0]?.isActive === true && ficha.datos?.cupones?.[0]?.activoAliado === true);

  const enlaces = await pedir(`/convenios/${convenioId}/enlaces`, { token: tokenDuenio });
  ok('devuelve los dos enlaces', !!enlaces.datos?.activacion && !!enlaces.datos?.portal);
  console.log(`     empleados: ${enlaces.datos?.activacion}`);
  console.log(`     aliado:    ${enlaces.datos?.portal}`);
  const tokenAliado = (enlaces.datos?.portal ?? '').split('/aliado/')[1];

  console.log('\n── 5. La página que ve el empleado ──');
  const info = await pedir(`/public/alianzas/${tenantSlug}/${convenioSlug}`);
  ok('la página pública carga', info.estado === 200, JSON.stringify(info.datos).slice(0, 200));
  ok('no está cerrada', info.datos?.cerrado === null);
  ok('pide código', info.datos?.pide?.codigo === true);
  ok('el beneficio se describe SIN imperativo de caja',
    info.datos?.beneficios?.[0]?.resumen === '15% de descuento',
    `dice «${info.datos?.beneficios?.[0]?.resumen}»`);
  ok('NO se filtra ninguna marca por defecto',
    !JSON.stringify(info.datos).includes('Clubify') || yo.datos?.brandName?.includes('Clubify'));

  console.log('\n── 6. Activar: los rechazos primero ──');
  const sinCodigo = await pedir(`/public/alianzas/${tenantSlug}/${convenioSlug}/activar`, {
    metodo: 'POST',
    cuerpo: {
      fullName: 'Ana Pérez', phone: '+573001112233', documento: '1020304050',
      dataPolicyAccepted: true,
    },
  });
  ok('sin código se rechaza', sinCodigo.estado >= 400, `estado ${sinCodigo.estado}`);

  const sinPolitica = await pedir(`/public/alianzas/${tenantSlug}/${convenioSlug}/activar`, {
    metodo: 'POST',
    cuerpo: {
      fullName: 'Ana Pérez', phone: '+573001112233', documento: '1020304050',
      codigo: 'CONFE2026',
    },
  });
  ok('sin aceptar la política de datos se rechaza', sinPolitica.estado >= 400);

  console.log('\n── 7. Activar de verdad ──');
  const activa = await pedir(`/public/alianzas/${tenantSlug}/${convenioSlug}/activar`, {
    metodo: 'POST',
    cuerpo: {
      fullName: 'Ana Pérez', phone: '+573001112233', documento: '1.020.304-050',
      codigo: '  confe2026 ', dataPolicyAccepted: true, via: 'whatsapp',
    },
  });
  ok('activa con el código en minúsculas y con espacios',
    activa.estado === 201 || activa.estado === 200, JSON.stringify(activa.datos).slice(0, 250));
  ok('es nueva', activa.datos?.isNew === true);
  const passId = activa.datos?.passId;

  const otraVez = await pedir(`/public/alianzas/${tenantSlug}/${convenioSlug}/activar`, {
    metodo: 'POST',
    cuerpo: {
      fullName: 'Ana Pérez', phone: '+573001112233', documento: '1020304050',
      codigo: 'CONFE2026', dataPolicyAccepted: true,
    },
  });
  ok('volver al enlace devuelve LA MISMA tarjeta', otraVez.datos?.passId === passId && otraVez.datos?.isNew === false);

  const suplanta = await pedir(`/public/alianzas/${tenantSlug}/${convenioSlug}/activar`, {
    metodo: 'POST',
    cuerpo: {
      fullName: 'Otro', phone: '+573001112233', documento: '99999999',
      codigo: 'CONFE2026', dataPolicyAccepted: true,
    },
  });
  ok('con el teléfono de otro y documento distinto NO se entrega el pase',
    suplanta.estado >= 400 && !JSON.stringify(suplanta.datos).includes(passId),
    `estado ${suplanta.estado}`);

  console.log('\n── 8. El pase en la billetera ──');
  const pkpass = await fetch(`${API}/passes/${passId}/apple.pkpass`);
  ok('el .pkpass se genera', pkpass.status === 200, `estado ${pkpass.status}`);
  const google = await pedir(`/passes/${passId}/google`);
  ok('Google devuelve saveUrl (el botón hace fetch + redirect)', !!google.datos?.saveUrl);

  console.log('\n── 9. Portal del aliado ──');
  const portal = await pedir(`/public/aliado/${tokenAliado}`);
  ok('el portal carga', portal.estado === 200);
  ok('ve 1 tarjeta activa', portal.datos?.informe?.tarjetasActivas === 1);
  ok('NO ve datos personales',
    !JSON.stringify(portal.datos).includes('Ana') && !JSON.stringify(portal.datos).includes('3001112233'));
  ok('el beneficio se le describe en corto', portal.datos?.cupones?.[0]?.resumen === '15% de descuento');

  console.log('\n── 10. Caja: escanear y canjear ──');
  const pase = await pedir(`/passes/${passId}/public`);
  const qr = pase.datos?.qrToken;
  const escaneo = await pedir('/scanner/verify', {
    metodo: 'POST', token: tokenDuenio, cuerpo: { qrToken: qr },
  });
  ok('el escáner lo reconoce como CONVENIO', escaneo.datos?.kind === 'convenio', JSON.stringify(escaneo.datos).slice(0, 200));
  ok('manda tarjetaId (lo que necesita el botón)', !!escaneo.datos?.tarjetaId);
  ok('el beneficio sale disponible', escaneo.datos?.cupones?.[0]?.disponible === true);
  ok('al cajero le habla en imperativo', escaneo.datos?.cupones?.[0]?.aplicar === 'Aplicar 15% de descuento');

  const canje = await pedir('/convenios/caja/canjear', {
    metodo: 'POST', token: tokenDuenio,
    cuerpo: { tarjetaId: escaneo.datos?.tarjetaId, cuponId: escaneo.datos?.cupones?.[0]?.id, compraMonto: 50000 },
  });
  ok('se registra el canje', canje.datos?.ok === true, JSON.stringify(canje.datos).slice(0, 250));
  ok('calcula el descuento en el servidor', canje.datos?.descuentoMonto === 7500,
    `dice ${canje.datos?.descuentoMonto}`);

  const otra = await pedir('/scanner/verify', {
    metodo: 'POST', token: tokenDuenio, cuerpo: { qrToken: qr },
  });
  ok('el tope «1 al día» ya muerde', otra.datos?.cupones?.[0]?.disponible === false,
    `motivo: ${otra.datos?.cupones?.[0]?.motivo}`);

  console.log('\n── 11. Anular: el doble clic ──');
  const a1 = await pedir(`/convenios/caja/anular/${canje.datos?.canjeId}`, { metodo: 'POST', token: tokenDuenio });
  const a2 = await pedir(`/convenios/caja/anular/${canje.datos?.canjeId}`, { metodo: 'POST', token: tokenDuenio });
  ok('la primera anula', a1.datos?.ok === true);
  ok('la segunda se rechaza', a2.estado >= 400);
  const trasAnular = await pedir(`/convenios/${convenioId}`, { token: tokenDuenio });
  ok('el contador vuelve a 0, no a -1', trasAnular.datos?.cupones?.[0]?.canjesCount === 0,
    `dice ${trasAnular.datos?.cupones?.[0]?.canjesCount}`);

  console.log('\n── 12. El doble interruptor ──');
  await pedir(`/public/aliado/${tokenAliado}/cupones/${escaneo.datos?.cupones?.[0]?.id}`, {
    metodo: 'PATCH', cuerpo: { activo: false },
  });
  const conAliadoApagado = await pedir('/scanner/verify', {
    metodo: 'POST', token: tokenDuenio, cuerpo: { qrToken: qr },
  });
  ok('si el aliado apaga, la caja lo dice con SU mensaje',
    conAliadoApagado.datos?.cupones?.[0]?.motivo === 'Beneficio apagado por la empresa aliada.',
    `dice «${conAliadoApagado.datos?.cupones?.[0]?.motivo}»`);
  const fichaTrasApagar = await pedir(`/convenios/${convenioId}`, { token: tokenDuenio });
  ok('el negocio NO puede encender lo que apagó el aliado',
    fichaTrasApagar.datos?.cupones?.[0]?.isActive === true &&
    fichaTrasApagar.datos?.cupones?.[0]?.activoAliado === false);

  console.log(`\n${fallos === 0 ? '✅ TODO EN VERDE' : `❌ ${fallos} FALLO(S)`}\n`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
