import { describe, it, expect, beforeAll } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AlianzasPublicoService } from './alianzas-publico.service';
import { escenario, formulario, type Fila } from './alianzas-prisma-falso';

/**
 * El alta del empleado desde el enlace único: `AlianzasPublicoService`.
 *
 * Estos tests importan el SERVICIO REAL y lo corren contra un doble de Prisma
 * en memoria. No hay ni una línea de lógica reimplementada aquí: si
 * `activar()` cambia de criterio, esto se pone rojo. Los 31 tests viejos del
 * módulo probaban copias y por eso no protegían nada.
 *
 * Lo que no se puede romper, en una frase: **la puerta**. El formulario nunca
 * es la autorización, un documento no entra dos veces, y quien ya demostró que
 * pertenece a la empresa no tiene que volver a demostrarlo.
 */

beforeAll(() => {
  // El servicio loguea con Logger de Nest; sin esto la salida del test es ruido.
  Logger.overrideLogger([]);
});

function montar(op: Parameters<typeof escenario>[0] = {}) {
  const e = escenario(op);
  return { ...e, svc: new AlianzasPublicoService(e.prisma) };
}

describe('los tres modos de verificación', () => {
  it('ABIERTO deja pasar sin pedir nada más', async () => {
    const { svc, db } = montar({ verificacion: 'ABIERTO' });

    const r = await svc.activar('cafe-luna', 'confenalco', formulario());

    expect(r.isNew).toBe(true);
    expect(r.passId).toBeTruthy();
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
  });

  it('CODIGO rechaza el código equivocado y no emite nada', async () => {
    const { svc, db } = montar({ verificacion: 'CODIGO', codigo: 'CONFE2026' });

    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario({ codigo: 'OTRO' })),
    ).rejects.toThrow(BadRequestException);

    // Ni tarjeta ni pase: la verificación va ANTES de emitir. Un pase suelto de
    // alguien que no pertenece a la empresa sería una tarjeta regalada.
    expect(db.tabla('convenioTarjeta')).toHaveLength(0);
    expect(db.tabla('pass')).toHaveLength(0);
    // Ni rastro en el CRM del negocio: crear el cliente antes de verificar
    // escribía datos personales en la ficha de un negocio ajeno desde un
    // endpoint sin sesión, con solo mandar el formulario con el código malo.
    expect(db.tabla('customer')).toHaveLength(0);
  });

  it('CODIGO acepta el correcto ignorando mayúsculas y espacios', async () => {
    // La gente lo copia de un WhatsApp: llega con espacios y en minúsculas.
    const { svc } = montar({ verificacion: 'CODIGO', codigo: 'CONFE2026' });

    const r = await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ codigo: '  confe 2026 ' }),
    );

    expect(r.isNew).toBe(true);
  });

  it('un convenio en modo CODIGO SIN código cierra la puerta, no la abre', async () => {
    // Es el fallo peligroso: sin este gate, un convenio a medio configurar
    // tendría la puerta abierta de par en par sin que nadie se enterara.
    const { svc, db } = montar({ verificacion: 'CODIGO', codigo: null });

    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario({ codigo: 'LOQUESEA' })),
    ).rejects.toThrow(/no está listo todavía/);
    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario({ codigo: null })),
    ).rejects.toThrow(BadRequestException);

    expect(db.tabla('convenioTarjeta')).toHaveLength(0);
  });

  it('CODIGO se cansa: tras 5 intentos fallidos cierra la puerta un rato', async () => {
    const { svc } = montar({ verificacion: 'CODIGO', codigo: 'CONFE2026' });
    const malo = formulario({ codigo: 'NOPE' });

    for (let i = 0; i < 5; i++) {
      await expect(svc.activar('cafe-luna', 'confenalco', malo)).rejects.toThrow(
        /Ese código no corresponde/,
      );
    }
    // El sexto ya no compara: rechaza por intentos, no por código.
    await expect(svc.activar('cafe-luna', 'confenalco', malo)).rejects.toThrow(
      /Demasiados intentos/,
    );
  });

  it('LISTA rechaza a quien no está, sin decir si el documento existe', async () => {
    const { svc, db } = montar({ verificacion: 'LISTA' });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '9999999',
    });

    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario({ documento: '1020304' })),
    ).rejects.toThrow(ForbiddenException);
    expect(db.tabla('convenioTarjeta')).toHaveLength(0);
  });

  it('LISTA acepta a quien sí está y marca su fila como usada', async () => {
    const { svc, db } = montar({ verificacion: 'LISTA' });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '1020304',
    });

    const r = await svc.activar('cafe-luna', 'confenalco', formulario());

    expect(r.isNew).toBe(true);
    expect(db.tabla('convenioListaBlanca')[0].usedAt).toBeInstanceOf(Date);
  });

  it('LISTA también casa por correo cuando el aliado cargó correos', async () => {
    const { svc, db } = montar({ verificacion: 'LISTA' });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      email: 'ana@confenalco.co',
    });

    const r = await svc.activar(
      'cafe-luna',
      'confenalco',
      // Con mayúsculas y espacios: el correo se normaliza antes de comparar.
      formulario({ email: '  Ana@Confenalco.CO ' }),
    );

    expect(r.isNew).toBe(true);
    expect(db.tabla('convenioListaBlanca')[0].usedAt).toBeInstanceOf(Date);
  });

  it('en LISTA, el cupo usado no sirve dos veces', async () => {
    const { svc, db } = montar({ verificacion: 'LISTA' });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '1020304',
    });
    await svc.activar('cafe-luna', 'confenalco', formulario());

    // Otra persona, otro teléfono, el mismo documento de la lista.
    await expect(
      svc.activar(
        'cafe-luna',
        'confenalco',
        formulario({ phone: '+573009998877', fullName: 'Luis Gómez' }),
      ),
    ).rejects.toThrow(/Ese cupo ya fue utilizado/);
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
  });

  it('si la emisión falla, el cupo de la lista NO se gasta', async () => {
    // La marca de `usedAt` va DENTRO de la transacción y DESPUÉS de crear la
    // tarjeta. Este test es el guardián de ese orden: si alguien marcara la
    // lista antes de emitir —o fuera de la transacción—, una emisión que
    // fracasa dejaría a esa persona sin cupo y sin tarjeta, lo peor de los dos
    // mundos, y sin forma de volver a entrar.
    const { svc, db } = montar({ verificacion: 'LISTA' });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '1020304',
    });
    // Otra persona ya se llevó ese documento: la creación morirá con P2002 y
    // el mensaje humano no se llega a dar porque la carrera la gana el índice.
    db.sembrar('customer', {
      id: 'customer-otro',
      tenantId: 'tenant-cafe',
      phone: '+573000000000',
    });
    db.sembrar('convenioTarjeta', {
      convenioId: 'convenio-confe',
      customerId: 'customer-otro',
      documento: '1020304',
      passId: 'pass-viejo',
    });

    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario()),
    ).rejects.toThrow(BadRequestException);

    expect(db.tabla('convenioListaBlanca')[0].usedAt).toBeNull();
  });
});

describe('idempotencia — volver al enlace no vuelve a preguntar', () => {
  it('activar dos veces con el mismo teléfono devuelve la MISMA tarjeta y el MISMO pase', async () => {
    const { svc, db } = montar({ verificacion: 'CODIGO', codigo: 'CONFE2026' });
    const primera = await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ codigo: 'CONFE2026' }),
    );

    // La segunda vez ya no trae el código: lo perdió, o borró el pase del móvil.
    const segunda = await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ codigo: null }),
    );

    expect(segunda.isNew).toBe(false);
    expect(segunda.passId).toBe(primera.passId);
    expect(segunda.customerId).toBe(primera.customerId);
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
    expect(db.tabla('pass')).toHaveLength(1);
  });

  it('el mismo teléfono en otro formato es la misma persona', async () => {
    // Vuelve escribiendo el número sin indicativo. Sin el match por los
    // últimos 10 dígitos se duplicaría el cliente y con él la tarjeta.
    const { svc, db } = montar();
    const primera = await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ phone: '+573001112233' }),
    );

    const segunda = await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ phone: '3001112233' }),
    );

    expect(segunda.passId).toBe(primera.passId);
    expect(db.tabla('customer')).toHaveLength(1);
  });

  it('el teléfono solo NO basta: con otro documento no se entrega la tarjeta ajena', async () => {
    // El atajo de idempotencia va delante de la verificación a propósito, y por
    // eso tiene que pedir el MISMO documento: si no, cualquiera que supiera el
    // teléfono de un compañero recibiría su `passId` sin código y sin estar en
    // la lista — y el `.pkpass` se descarga con solo ese id.
    const { svc, db } = montar({ verificacion: 'CODIGO', codigo: 'CONFE2026' });
    const suya = await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ documento: '10203045', codigo: 'CONFE2026' }),
    );

    await expect(
      svc.activar(
        'cafe-luna',
        'confenalco',
        // Mismo teléfono, documento inventado y sin código.
        formulario({ documento: '99999999', codigo: null }),
      ),
    ).rejects.toThrow(/Los datos no coinciden/);

    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
    expect(db.tabla('convenioTarjeta')[0].passId).toBe(suya.passId);
  });

  it('una tarjeta BLOQUEADA no se reactiva volviendo al enlace', async () => {
    const { svc, db } = montar();
    const cliente = db.sembrar('customer', {
      tenantId: 'tenant-cafe',
      fullName: 'Ana Pérez',
      phone: '+573001112233',
    });
    const tarjeta = db.sembrar('convenioTarjeta', {
      convenioId: 'convenio-confe',
      customerId: cliente.id,
      documento: '1020304',
      passId: 'pass-bloqueado',
      status: 'BLOCKED',
      blockedBy: 'aliado',
    });

    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario()),
    ).rejects.toThrow(ForbiddenException);

    // La puerta de atrás que anularía el bloqueo del negocio sigue cerrada.
    expect(db.tabla('convenioTarjeta')[0].status).toBe('BLOCKED');
    expect(db.tabla('convenioTarjeta')[0].id).toBe(tarjeta.id);
  });

  it('una tarjeta que se quedó sin pase recibe uno nuevo, no un 500', async () => {
    const { svc, db } = montar();
    const cliente = db.sembrar('customer', {
      tenantId: 'tenant-cafe',
      fullName: 'Ana Pérez',
      phone: '+573001112233',
    });
    db.sembrar('convenioTarjeta', {
      convenioId: 'convenio-confe',
      customerId: cliente.id,
      documento: '1020304',
      passId: null,
    });

    const r = await svc.activar('cafe-luna', 'confenalco', formulario());

    expect(r.isNew).toBe(false);
    expect(r.passId).toBeTruthy();
    expect(db.tabla('convenioTarjeta')[0].passId).toBe(r.passId);
  });
});

describe('el documento manda: uno por convenio', () => {
  it('otro teléfono con el mismo documento se rechaza', async () => {
    const { svc, db } = montar();
    await svc.activar('cafe-luna', 'confenalco', formulario());

    await expect(
      svc.activar(
        'cafe-luna',
        'confenalco',
        formulario({ phone: '+573009998877', fullName: 'Luis Gómez' }),
      ),
    ).rejects.toThrow(/Ya existe una tarjeta de este convenio con ese documento/);
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
  });

  it('«1.020.304-5» y «10203045» son la MISMA cédula', async () => {
    // Sin normalizar, la misma persona activaría el convenio tantas veces como
    // formas tenga de escribir su número.
    const { svc, db } = montar();
    await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ documento: '10203045' }),
    );

    await expect(
      svc.activar(
        'cafe-luna',
        'confenalco',
        formulario({
          phone: '+573009998877',
          fullName: 'Luis Gómez',
          documento: '1.020.304-5',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
    expect(db.tabla('convenioTarjeta')[0].documento).toBe('10203045');
  });

  it('dos envíos SIMULTÁNEOS del mismo formulario dejan una sola tarjeta', async () => {
    // El doble clic del móvil. Aquí manda el índice único, no el `findFirst`
    // previo: la comprobación de arriba es leer-decidir-escribir y dos envíos
    // a la vez la atraviesan. El servicio tiene que atrapar el P2002 y
    // devolver lo que creó el ganador, no un 500 en la cara del cliente.
    const { svc, db } = montar();

    const [a, b] = await Promise.all([
      svc.activar('cafe-luna', 'confenalco', formulario()),
      svc.activar('cafe-luna', 'confenalco', formulario()),
    ]);

    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
    expect(a.passId).toBe(b.passId);
    expect(db.tabla('convenioTarjeta')[0].passId).toBe(a.passId);
    // El mismo P2002 se atrapa también al crear el cliente: una sola persona.
    expect(db.tabla('customer')).toHaveLength(1);
    // El pase del perdedor queda suelto, y es deliberado: es el que esa misma
    // persona reutilizaría al reintentar, y sin `ConvenioTarjeta` no se puede
    // escanear como convenio.
    expect(db.tabla('pass').map((p) => p.id)).toContain(a.passId);
  });
});

describe('lo que hay que traer para entrar', () => {
  it('sin aceptar la política de datos no se emite nada', async () => {
    // Aquí no es opcional como en el alta normal: se guarda documento de
    // identidad.
    const { svc, db } = montar();

    await expect(
      svc.activar(
        'cafe-luna',
        'confenalco',
        formulario({ dataPolicyAccepted: false }),
      ),
    ).rejects.toThrow(/política de tratamiento de datos/);
    expect(db.tabla('convenioTarjeta')).toHaveLength(0);
  });

  it('la aceptación se guarda como evidencia, con la URL que se le mostró', async () => {
    const { svc, db } = montar();
    await svc.activar('cafe-luna', 'confenalco', formulario());

    const t = db.tabla('convenioTarjeta')[0];
    expect(t.dataPolicyAcceptedAt).toBeInstanceOf(Date);
    expect(t.dataPolicyUrl).toBe('https://cafeluna.co/datos');
  });

  it('sin documento no hay tarjeta', async () => {
    const { svc } = montar();
    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario({ documento: '..-' })),
    ).rejects.toThrow(/documento de identidad/);
  });

  it('un nombre de una letra y un teléfono corto se rechazan', async () => {
    const { svc } = montar();
    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario({ fullName: 'A' })),
    ).rejects.toThrow(/nombre completo/);
    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario({ phone: '300' })),
    ).rejects.toThrow(/teléfono válido/);
  });
});

describe('cuándo el convenio no admite activaciones', () => {
  const casos: { nombre: string; op: Fila; mensaje: RegExp }[] = [
    { nombre: 'en pausa', op: { status: 'PAUSED' }, mensaje: /en pausa/ },
    { nombre: 'finalizado', op: { status: 'FINISHED' }, mensaje: /finalizado/ },
    {
      nombre: 'vencido por fecha',
      op: { endsAt: new Date('2020-01-01T00:00:00Z') },
      mensaje: /fecha de fin/,
    },
  ];

  for (const c of casos) {
    it(`con el convenio ${c.nombre} no se puede activar`, async () => {
      const { svc, db } = montar(c.op);
      await expect(
        svc.activar('cafe-luna', 'confenalco', formulario()),
      ).rejects.toThrow(c.mensaje);
      expect(db.tabla('convenioTarjeta')).toHaveLength(0);
    });
  }

  it('sin ningún cupón no se puede activar', async () => {
    // Con todos los cupones apagados SÍ se puede —la tarjeta nace y comunica
    // «en pausa»—, pero sin ninguno el enlace se repartió antes de tiempo.
    const { svc, db } = montar({ conCupon: false });

    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario()),
    ).rejects.toThrow(/aún no está disponible/);
    expect(db.tabla('convenioTarjeta')).toHaveLength(0);
  });

  it('con todos los cupones apagados la tarjeta SÍ nace', async () => {
    const { svc, db } = montar({ cupon: { isActive: false } });

    const r = await svc.activar('cafe-luna', 'confenalco', formulario());

    expect(r.isNew).toBe(true);
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
  });

  it('con el módulo de convenios apagado el enlace no existe', async () => {
    const { svc } = montar({ conveniosEnabled: false });
    await expect(svc.info('cafe-luna', 'confenalco')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      svc.activar('cafe-luna', 'confenalco', formulario()),
    ).rejects.toThrow(/no está disponible/);
  });

  it('con el negocio suspendido el enlace no existe', async () => {
    const { svc } = montar({ tenantStatus: 'SUSPENDED' });
    await expect(svc.info('cafe-luna', 'confenalco')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('un convenio que no es de ese negocio no se resuelve', async () => {
    const { svc } = montar();
    await expect(svc.info('cafe-luna', 'otro-aliado')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('lo que se emite', () => {
  it('la Card se marca con convenioId y hereda el logo del ALIADO', async () => {
    const { svc, db } = montar();
    await svc.activar('cafe-luna', 'confenalco', formulario());

    const cards = db.tabla('card');
    expect(cards).toHaveLength(1);
    expect(cards[0].convenioId).toBe('convenio-confe');
    expect(cards[0].type).toBe('STAMPS');
    // 1 y no null: el render de sellos cae al default 10 con null, y «0 / 10»
    // encima de un descuento del 10% no significa nada.
    expect(cards[0].stampsRequired).toBe(1);
    expect(cards[0].logoUrl).toBe('https://cdn.ejemplo/confenalco.png');
    expect(cards[0].businessName).toBe('Café Luna');
  });

  it('la segunda persona reutiliza la MISMA Card del convenio', async () => {
    const { svc, db } = montar();
    await svc.activar('cafe-luna', 'confenalco', formulario());
    await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({
        phone: '+573009998877',
        fullName: 'Luis Gómez',
        documento: '7654321',
      }),
    );

    expect(db.tabla('card')).toHaveLength(1);
    expect(db.tabla('pass')).toHaveLength(2);
    expect(db.tabla('convenioTarjeta')).toHaveLength(2);
  });

  it('el pase queda enganchado a la tarjeta del convenio y al cliente', async () => {
    const { svc, db } = montar();
    const r = await svc.activar('cafe-luna', 'confenalco', formulario());

    const pass = db.tabla('pass')[0];
    expect(pass.id).toBe(r.passId);
    expect(pass.tenantId).toBe('tenant-cafe');
    expect(pass.cardId).toBe(db.tabla('card')[0].id);
    expect(pass.customerId).toBe(r.customerId);
    expect(pass.qrToken).toMatch(/^QR-/);
    expect(db.tabla('convenioTarjeta')[0].origen).toBe('qr');
  });

  it('si ya era cliente del negocio, es el MISMO Customer', async () => {
    // Lo que va aparte son la Card y el Pass, nunca la persona.
    const { svc, db } = montar();
    const cliente = db.sembrar('customer', {
      tenantId: 'tenant-cafe',
      fullName: 'Ana Pérez',
      phone: '+573001112233',
      email: null,
    });

    const r = await svc.activar(
      'cafe-luna',
      'confenalco',
      formulario({ email: 'ana@confenalco.co' }),
    );

    expect(r.customerId).toBe(cliente.id);
    expect(db.tabla('customer')).toHaveLength(1);
    // Y de paso se le completa el correo que faltaba.
    expect(db.tabla('customer')[0].email).toBe('ana@confenalco.co');
  });
});

describe('la página del enlace (info)', () => {
  it('pinta la marca del NEGOCIO y el logo del aliado, nunca la plataforma', async () => {
    const { svc } = montar();
    const info = await svc.info('cafe-luna', 'confenalco');

    expect(info.negocio.nombre).toBe('Café Luna');
    expect(info.negocio.logoUrl).toBe('https://cdn.ejemplo/cafe-luna.png');
    expect(info.aliado.nombre).toBe('Confenalco');
    expect(JSON.stringify(info)).not.toMatch(/Clubify/i);
  });

  it('pide el código solo en modo CODIGO, y la política SIEMPRE', async () => {
    const abierto = await montar({ verificacion: 'ABIERTO' }).svc.info(
      'cafe-luna',
      'confenalco',
    );
    expect(abierto.pide.codigo).toBe(false);
    expect(abierto.pide.politicaDatos).toBe(true);
    expect(abierto.pide.documento).toBe(true);

    const conCodigo = await montar({
      verificacion: 'CODIGO',
      codigo: 'CONFE2026',
    }).svc.info('cafe-luna', 'confenalco');
    expect(conCodigo.pide.codigo).toBe(true);
    // La página nunca enseña el código: lo reparte el aliado.
    expect(JSON.stringify(conCodigo)).not.toContain('CONFE2026');
  });

  it('lista los beneficios vivos y esconde los apagados, sin cerrar la página', async () => {
    const { svc, db } = montar();
    db.sembrar('convenioCupon', {
      convenioId: 'convenio-confe',
      name: 'Postre gratis',
      tipo: 'FREEBIE',
      position: 2,
      activoAliado: false,
    });

    const info = await svc.info('cafe-luna', 'confenalco');

    expect(info.cerrado).toBeNull();
    expect(info.beneficios).toHaveLength(1);
    expect(info.beneficios[0].resumen).toBe('Aplicar 10% de descuento');
  });

  it('un convenio en pausa se dice en castellano y sin culpar a nadie', async () => {
    const { svc } = montar({ status: 'PAUSED' });
    const info = await svc.info('cafe-luna', 'confenalco');
    expect(info.cerrado).toMatch(/en pausa/);
  });

  it('sin cupones la página avisa de que aún no está lista', async () => {
    const { svc } = montar({ conCupon: false });
    const info = await svc.info('cafe-luna', 'confenalco');
    expect(info.cerrado).toMatch(/aún no está disponible/);
    expect(info.beneficios).toHaveLength(0);
  });
});
