import { describe, it, expect, beforeAll } from 'vitest';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { QueueService } from '../jobs/queue.service';
import { AlianzasPortalService } from './alianzas-portal.service';
import { ColaFalsa, escenario, type Fila } from './alianzas-prisma-falso';

/**
 * El portal de la EMPRESA ALIADA: `AlianzasPortalService`, el de verdad,
 * corriendo contra el doble de Prisma en memoria.
 *
 * Las tres cosas que este portal no puede romper nunca:
 *
 *  1. **Cada parte manda sobre SU interruptor.** El aliado toca `activoAliado`
 *     y jamás `isActive`. Si pudiera tocar el del negocio, encender y apagar
 *     acabaría en una pelea de interruptores.
 *  2. **No es un buscador de personas.** La baja responde exactamente lo mismo
 *     exista o no la tarjeta, y el informe no lleva ni un nombre ni un
 *     teléfono: son los empleados del aliado, pero los datos son del negocio.
 *  3. **Un enlace que no vale no cuenta nada.** Mismo mensaje para un token
 *     inventado que para un negocio suspendido.
 */

beforeAll(() => {
  Logger.overrideLogger([]);
});

function montar(op: Parameters<typeof escenario>[0] = {}) {
  const e = escenario(op);
  const cola = new ColaFalsa();
  const svc = new AlianzasPortalService(e.prisma, cola as unknown as QueueService);
  return { ...e, cola, svc };
}

/** Un empleado con su tarjeta y su pase ya instalado. */
function conEmpleado(
  db: ReturnType<typeof escenario>['db'],
  p: Fila = {},
): { customer: Fila; pass: Fila; tarjeta: Fila } {
  const n = db.tabla('convenioTarjeta').length + 1;
  const customer = db.sembrar('customer', {
    tenantId: 'tenant-cafe',
    fullName: p.fullName ?? 'Ana Pérez',
    phone: p.phone ?? `+57300111223${n}`,
  });
  const card = db.tabla('card')[0] ??
    db.sembrar('card', { tenantId: 'tenant-cafe', convenioId: 'convenio-confe' });
  const pass = db.sembrar('pass', {
    tenantId: 'tenant-cafe',
    cardId: card.id,
    customerId: customer.id,
    serialNumber: `CLB-${n}`,
    qrToken: `QR-${n}`,
    authToken: 'x',
  });
  const tarjeta = db.sembrar('convenioTarjeta', {
    convenioId: 'convenio-confe',
    customerId: customer.id,
    passId: pass.id,
    documento: p.documento ?? `102030${n}`,
    status: p.status ?? 'ACTIVE',
    blockedAt: p.blockedAt ?? null,
    blockedBy: p.blockedBy ?? null,
  });
  return { customer, pass, tarjeta };
}

describe('un enlace que no vale no cuenta nada', () => {
  it('un token inventado no revela si el convenio existe', async () => {
    const { svc } = montar();
    await expect(svc.ver('no-existe')).rejects.toThrow(NotFoundException);
    await expect(svc.ver('no-existe')).rejects.toThrow('Enlace no válido.');
  });

  it('un token vacío o en blanco tampoco', async () => {
    const { svc } = montar();
    await expect(svc.ver('')).rejects.toThrow('Enlace no válido.');
    await expect(svc.ver('   ')).rejects.toThrow('Enlace no válido.');
  });

  it('con el módulo apagado el portal dice LO MISMO que con un token falso', async () => {
    // Si dijera «este negocio tiene los convenios desactivados», el portal
    // confirmaría que el token es bueno y en qué estado está el negocio.
    const { svc } = montar({ conveniosEnabled: false });
    await expect(svc.ver('portal-confe')).rejects.toThrow('Enlace no válido.');
    await expect(svc.interruptor('portal-confe', 'cupon-10', false)).rejects.toThrow(
      'Enlace no válido.',
    );
    await expect(svc.baja('portal-confe', '1020304')).rejects.toThrow(
      'Enlace no válido.',
    );
  });

  it('con el negocio suspendido, igual', async () => {
    const { svc } = montar({ tenantStatus: 'SUSPENDED' });
    await expect(svc.ver('portal-confe')).rejects.toThrow('Enlace no válido.');
  });

  it('el token del INFORME no abre el portal', async () => {
    // `reportToken` y `aliadoToken` van aparte a propósito: el informe se
    // reenvía por correo sin pensarlo, el mando no.
    const { svc } = montar();
    await expect(svc.ver('informe-confe')).rejects.toThrow('Enlace no válido.');
  });
});

describe('el interruptor del aliado', () => {
  it('apaga SOLO su llave: la del negocio no se toca', async () => {
    const { svc, db } = montar();

    const r = await svc.interruptor('portal-confe', 'cupon-10', false);

    expect(r).toEqual({ ok: true, cambio: true });
    const cupon = db.tabla('convenioCupon')[0];
    expect(cupon.activoAliado).toBe(false);
    expect(cupon.isActive).toBe(true);
  });

  it('encender tampoco toca la del negocio', async () => {
    const { svc, db } = montar({ cupon: { isActive: false, activoAliado: false } });

    await svc.interruptor('portal-confe', 'cupon-10', true);

    const cupon = db.tabla('convenioCupon')[0];
    expect(cupon.activoAliado).toBe(true);
    // El aliado NO puede encender lo que apagó el negocio.
    expect(cupon.isActive).toBe(false);
  });

  it('poner el interruptor donde ya estaba no cambia nada ni empuja nada', async () => {
    const { svc, cola } = montar();
    const r = await svc.interruptor('portal-confe', 'cupon-10', true);
    expect(r).toEqual({ ok: true, cambio: false });
    expect(cola.pushes()).toHaveLength(0);
  });

  it('empuja el pase cuando cambia lo que el empleado VE', async () => {
    const { svc, db, cola } = montar();
    const uno = conEmpleado(db);
    const dos = conEmpleado(db);

    await svc.interruptor('portal-confe', 'cupon-10', false);

    expect(cola.pushes().map((j) => j.datos.passId).sort()).toEqual(
      [uno.pass.id, dos.pass.id].sort(),
    );
    // `lastActivityAt` se toca ANTES de encolar: si no se mueve, Apple
    // responde 304 y el pase sigue enseñando lo de antes. Es el fallo que hace
    // creer que la billetera «no se actualiza».
    for (const p of db.tabla('pass')) {
      expect(p.lastActivityAt).toBeInstanceOf(Date);
    }
  });

  it('NO empuja si el negocio ya lo tenía apagado', async () => {
    // Encender mi llave con la del negocio apagada no cambia nada en la
    // tarjeta: empujar por eso gasta cuota de Apple y Google y hace vibrar
    // teléfonos para nada.
    const { svc, db, cola } = montar({
      cupon: { isActive: false, activoAliado: false },
    });
    conEmpleado(db);

    await svc.interruptor('portal-confe', 'cupon-10', true);

    expect(db.tabla('convenioCupon')[0].activoAliado).toBe(true);
    expect(cola.pushes()).toHaveLength(0);
  });

  it('un cupón que no es de este convenio no se puede tocar', async () => {
    const { svc, db } = montar();
    // Cupón de otro convenio del mismo negocio: el portal solo manda en el suyo.
    const otro = db.sembrar('convenio', {
      tenantId: 'tenant-cafe',
      slug: 'otro',
      reportToken: 'r2',
      aliadoToken: 'a2',
    });
    const ajeno = db.sembrar('convenioCupon', { convenioId: otro.id });

    await expect(
      svc.interruptor('portal-confe', ajeno.id, false),
    ).rejects.toThrow(NotFoundException);
    expect(db.tabla('convenioCupon').find((c) => c.id === ajeno.id)!.activoAliado).toBe(
      true,
    );
  });

  it('con el convenio FINALIZADO el portal queda en solo lectura', async () => {
    const { svc, db } = montar({ status: 'FINISHED' });

    const vista = await svc.ver('portal-confe');
    expect(vista.soloLectura).toBe(true);

    await expect(
      svc.interruptor('portal-confe', 'cupon-10', false),
    ).rejects.toThrow(BadRequestException);
    expect(db.tabla('convenioCupon')[0].activoAliado).toBe(true);
  });

  it('con el convenio en PAUSA el aliado sí puede seguir tocando lo suyo', async () => {
    // La pausa es del negocio y es reversible; la decisión del aliado
    // sobrevive al ciclo de pausa, que es lo que él espera.
    const { svc, db } = montar({ status: 'PAUSED' });
    const vista = await svc.ver('portal-confe');

    expect(vista.soloLectura).toBe(false);
    expect(vista.motivoGlobal).toBe('Convenio en pausa.');
    await svc.interruptor('portal-confe', 'cupon-10', false);
    expect(db.tabla('convenioCupon')[0].activoAliado).toBe(false);
  });
});

describe('la baja por documento', () => {
  it('bloquea la tarjeta, deja constancia de quién y empuja el pase', async () => {
    const { svc, db, cola } = montar();
    const { tarjeta, pass } = conEmpleado(db, { documento: '1020304' });

    const r = await svc.baja('portal-confe', '1020304');

    expect(r.ok).toBe(true);
    const guardada = db.tabla('convenioTarjeta').find((t) => t.id === tarjeta.id)!;
    expect(guardada.status).toBe('BLOCKED');
    expect(guardada.blockedBy).toBe('aliado');
    expect(guardada.blockedAt).toBeInstanceOf(Date);
    expect(cola.pushes().map((j) => j.datos.passId)).toEqual([pass.id]);
  });

  it('también lo saca de la lista blanca: si no, mañana volvería a entrar', async () => {
    const { svc, db } = montar({ verificacion: 'LISTA' });
    conEmpleado(db, { documento: '1020304' });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '1020304',
      usedAt: new Date(),
    });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '7654321',
    });

    await svc.baja('portal-confe', '1020304');

    expect(db.tabla('convenioListaBlanca').map((f) => f.documento)).toEqual([
      '7654321',
    ]);
  });

  it('responde EXACTAMENTE lo mismo exista o no la tarjeta', async () => {
    // Si la respuesta cambiara, el portal sería un buscador para averiguar
    // quién de la empresa tiene tarjeta.
    const { svc, db } = montar();
    conEmpleado(db, { documento: '1020304' });

    const existe = await svc.baja('portal-confe', '1020304');
    const noExiste = await svc.baja('portal-confe', '5555555');

    expect(noExiste).toEqual(existe);
    expect(JSON.stringify(noExiste)).not.toMatch(/Ana|no encontr|no existe/i);
  });

  it('encuentra la tarjeta aunque el documento venga con puntos y guiones', async () => {
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db, { documento: '10203045' });

    await svc.baja('portal-confe', '1.020.304-5');

    expect(
      db.tabla('convenioTarjeta').find((t) => t.id === tarjeta.id)!.status,
    ).toBe('BLOCKED');
  });

  it('un documento a medias se rechaza en vez de bloquear a ciegas', async () => {
    const { svc, db } = montar();
    conEmpleado(db, { documento: '1020304' });

    await expect(svc.baja('portal-confe', '12')).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.baja('portal-confe', '   ')).rejects.toThrow(
      BadRequestException,
    );
    expect(db.tabla('convenioTarjeta')[0].status).toBe('ACTIVE');
  });

  it('dar de baja a quien ya estaba bloqueado no reescribe la fecha ni vuelve a empujar', async () => {
    const bloqueadoEl = new Date('2026-01-15T10:00:00Z');
    const { svc, db, cola } = montar();
    conEmpleado(db, {
      documento: '1020304',
      status: 'BLOCKED',
      blockedAt: bloqueadoEl,
      blockedBy: 'negocio',
    });

    await svc.baja('portal-confe', '1020304');

    const t = db.tabla('convenioTarjeta')[0];
    expect(t.blockedAt).toEqual(bloqueadoEl);
    // Y sigue constando quién lo bloqueó primero: el negocio no ve un bloqueo
    // «del aliado» que nunca hizo.
    expect(t.blockedBy).toBe('negocio');
    expect(cola.pushes()).toHaveLength(0);
  });
});

describe('el informe del aliado', () => {
  it('no lleva ni un nombre ni un teléfono de los empleados', async () => {
    const { svc, db } = montar();
    conEmpleado(db, { fullName: 'Ana Pérez', phone: '+573001112233' });
    conEmpleado(db, { fullName: 'Luis Gómez', phone: '+573009998877' });

    const vista = await svc.ver('portal-confe');
    const texto = JSON.stringify(vista);

    expect(texto).not.toContain('Ana Pérez');
    expect(texto).not.toContain('Luis Gómez');
    expect(texto).not.toContain('573001112233');
    expect(texto).not.toContain('1020301');
    expect(vista.informe.tarjetasActivas).toBe(2);
  });

  it('cuenta activas y bloqueadas por separado', async () => {
    const { svc, db } = montar();
    conEmpleado(db);
    conEmpleado(db);
    conEmpleado(db, { status: 'BLOCKED' });

    const { informe } = await svc.ver('portal-confe');

    expect(informe.tarjetasActivas).toBe(2);
    expect(informe.tarjetasBloqueadas).toBe(1);
  });

  it('los canjes anulados no cuentan ni en el número ni en los pesos', async () => {
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db);
    const canje = (extra: Fila) =>
      db.sembrar('convenioCanje', {
        convenioId: 'convenio-confe',
        cuponId: 'cupon-10',
        tarjetaId: tarjeta.id,
        ...extra,
      });
    canje({ descuentoMonto: 5_000 });
    canje({ descuentoMonto: 3_000 });
    canje({ descuentoMonto: 9_000, revertedAt: new Date(), revertedBy: 'u1' });

    const { informe } = await svc.ver('portal-confe');

    expect(informe.canjesTotales).toBe(2);
    expect(informe.descuentoTotal).toBe(8_000);
  });

  it('sin totales de tiquete el informe cuenta canjes, no pesos', async () => {
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db);
    db.sembrar('convenioCanje', {
      convenioId: 'convenio-confe',
      cuponId: 'cupon-10',
      tarjetaId: tarjeta.id,
      descuentoMonto: null,
    });

    const { informe } = await svc.ver('portal-confe');

    expect(informe.canjesTotales).toBe(1);
    // null y no 0: «no lo sabemos» no es «cero pesos».
    expect(informe.descuentoTotal).toBeNull();
  });
});

describe('lo que el aliado ve de cada beneficio', () => {
  it('su interruptor es suyo y el del negocio solo se informa', async () => {
    const { svc } = montar({ cupon: { isActive: false, activoAliado: true } });

    const { cupones } = await svc.ver('portal-confe');

    expect(cupones[0].miInterruptor).toBe(true);
    expect(cupones[0].apagadoPorElNegocio).toBe(true);
    expect(cupones[0].estado).toBe('Apagado por el negocio');
  });

  const estados: { nombre: string; cupon: Fila; estado: string }[] = [
    { nombre: 'todo encendido', cupon: {}, estado: 'Activo' },
    { nombre: 'lo apagó él', cupon: { activoAliado: false }, estado: 'Apagado por ti' },
    {
      nombre: 'lo apagaron los dos',
      cupon: { isActive: false, activoAliado: false },
      estado: 'Apagado por ti y por el negocio',
    },
    {
      nombre: 'venció',
      cupon: { endsAt: new Date('2020-01-01T00:00:00Z') },
      estado: 'Venció',
    },
    {
      nombre: 'se agotó',
      cupon: { maxTotal: 3, canjesCount: 3 },
      estado: 'Agotado',
    },
  ];

  for (const c of estados) {
    it(`«${c.estado}» cuando ${c.nombre}`, async () => {
      const { svc } = montar({ cupon: c.cupon });
      const { cupones } = await svc.ver('portal-confe');
      expect(cupones[0].estado).toBe(c.estado);
    });
  }

  it('el motivo global tapa a todos los cupones con el mismo mensaje', async () => {
    // Repetir «Convenio en pausa» una vez por beneficio hace pensar que cada
    // uno falló por su cuenta.
    const { svc, db } = montar({ status: 'PAUSED' });
    db.sembrar('convenioCupon', {
      convenioId: 'convenio-confe',
      name: 'Postre gratis',
      position: 2,
    });

    const { cupones } = await svc.ver('portal-confe');

    expect(cupones.map((c) => c.estado)).toEqual([
      'Convenio en pausa.',
      'Convenio en pausa.',
    ]);
  });

  it('el aliado ve el código solo si el convenio va por código', async () => {
    const conCodigo = await montar({
      verificacion: 'CODIGO',
      codigo: 'CONFE2026',
    }).svc.ver('portal-confe');
    expect(conCodigo.convenio.codigo).toBe('CONFE2026');

    const abierto = await montar({ verificacion: 'ABIERTO' }).svc.ver('portal-confe');
    expect(abierto.convenio.codigo).toBeNull();
  });

  it('la cabecera lleva la marca del NEGOCIO, nunca la de la plataforma', async () => {
    const { svc } = montar();
    const vista = await svc.ver('portal-confe');
    expect(vista.negocio.nombre).toBe('Café Luna');
    expect(JSON.stringify(vista)).not.toMatch(/Clubify/i);
  });
});
