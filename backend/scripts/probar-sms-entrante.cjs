/**
 * SOLO LECTURA: ¿un SMS entrante encontraría a quien escribe?
 *
 * Cierra la mitad que no se puede comprobar desde fuera. El webhook ya se
 * probó por HTTP —entra, se clasifica como respuesta y lee el teléfono—, pero
 * con un número inventado, para no reanudarle el workflow a nadie.
 *
 * Esto hace la MISMA consulta que hace el controlador (`contactIdByPhone`:
 * por `phoneKey`, los últimos 10 dígitos) contra los contactos reales de una
 * marca, y enseña cuántos serían localizables y cuántos no.
 *
 * Uso: railway run node scripts/probar-sms-entrante.cjs [slugMarca]
 */
const { PrismaClient } = require('@prisma/client');

const SLUG = process.argv[2] || 'sellea';

/** El mismo criterio que `identity.ts`: últimos 10 dígitos, mínimo 7. */
const phoneKeyOf = (raw) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-10) : null;
};

(async () => {
  const p = new PrismaClient();
  try {
    const wl = await p.whiteLabel.findUnique({
      where: { slug: SLUG },
      select: { id: true, name: true },
    });
    if (!wl) return console.log(`no existe la marca «${SLUG}»`);

    const contactos = await p.mktContact.findMany({
      where: { whiteLabelId: wl.id, deleted: false },
      select: { id: true, name: true, phone: true, phoneKey: true, email: true },
    });

    const conTel = contactos.filter((c) => c.phone);
    const conClave = contactos.filter((c) => c.phoneKey);
    const soloCorreo = contactos.filter((c) => !c.phoneKey && c.email);

    console.log(`${wl.name} · ${contactos.length} contactos`);
    console.log(`  con teléfono ................ ${conTel.length}`);
    console.log(`  con clave de búsqueda ....... ${conClave.length}   ← localizables por SMS`);
    console.log(`  solo correo ................. ${soloCorreo.length}   ← si escriben por SMS, no se les reconoce`);

    if (!conClave.length) {
      console.log('\n  Ningún contacto tiene teléfono normalizado: por SMS no se');
      console.log('  reconocería a nadie. Hay que importar los teléfonos.');
      return;
    }

    // La consulta EXACTA del controlador, sobre un contacto real, escribiendo
    // su número de las formas en que puede llegar desde GoHighLevel.
    const muestra = conClave[0];
    console.log(`\nprueba con «${muestra.name ?? muestra.id}» (clave ${muestra.phoneKey}):`);
    const digitos = String(muestra.phone ?? '').replace(/\D/g, '');
    const formas = [
      muestra.phone,
      `+${digitos}`,
      digitos,
      digitos.slice(-10),
      digitos.slice(-10).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3'),
      digitos.slice(-10).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3'),
    ];

    let bien = 0;
    for (const forma of formas) {
      const key = phoneKeyOf(forma);
      const hallado = key
        ? await p.mktContact.findFirst({
            where: { whiteLabelId: wl.id, phoneKey: key, deleted: false },
            select: { id: true },
          })
        : null;
      const ok = hallado?.id === muestra.id;
      if (ok) bien++;
      console.log(`  ${ok ? '✓' : '✗'} «${forma}»  →  ${ok ? 'lo encuentra' : 'NO lo encuentra'}`);
    }
    console.log(`\n  ${bien} de ${formas.length} formas de escribir el mismo número lo encuentran.`);
  } finally {
    await p.$disconnect();
  }
})();
