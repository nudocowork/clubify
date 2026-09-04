import { describe, it, expect, beforeAll } from 'vitest';
import { BadRequestException, Logger } from '@nestjs/common';
import type { QueueService } from '../jobs/queue.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ConveniosService } from './convenios.service';
import { ColaFalsa, escenario, type Fila } from './alianzas-prisma-falso';

/**
 * El panel del negocio: `ConveniosService`, el de verdad, contra el doble de
 * Prisma en memoria.
 *
 * Lo que se prueba aquí es la salida al callejón sin salida que tenía el
 * producto: el documento se fija en la PRIMERA activación, así que un dedazo
 * —o alguien que activó con el teléfono de un compañero— dejaba a la persona
 * legítima fuera para siempre. El panel solo sabía bloquear, y bloquear
 * tampoco deja volver a activar.
 */

beforeAll(() => {
  Logger.overrideLogger([]);
});

const DUENO = {
  id: 'user-dueno',
  email: 'dueno@cafeluna.co',
  role: 'TENANT_OWNER',
  tenantId: 'tenant-cafe',
} as unknown as AuthUser;

function montar(op: Parameters<typeof escenario>[0] = {}) {
  const e = escenario(op);
  const cola = new ColaFalsa();
  const svc = new ConveniosService(e.prisma, cola as unknown as QueueService);
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
    email: p.email ?? null,
  });
  const card =
    db.tabla('card')[0] ??
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
    documento: p.documento ?? '10203045',
  });
  return { customer, pass, tarjeta };
}

describe('corregir el documento de una tarjeta', () => {
  it('lo cambia, que es lo que desatasca a quien se equivocó al teclear', async () => {
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db, { documento: '1020304' });

    const r = await svc.corregirDocumento(DUENO, tarjeta.id, '10203045');

    expect(r.cambio).toBe(true);
    expect(db.tabla('convenioTarjeta')[0].documento).toBe('10203045');
  });

  it('normaliza igual que la activación, o no volvería a coincidir', async () => {
    // Si el panel guardara «10.203.045» y el enlace normaliza a «10203045», la
    // corrección no serviría de nada: seguiría sin casar.
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db, { documento: '1020304' });

    await svc.corregirDocumento(DUENO, tarjeta.id, ' 10.203.045 ');

    expect(db.tabla('convenioTarjeta')[0].documento).toBe('10203045');
  });

  it('no deja pisar el documento de otra persona, y dice de quién es', async () => {
    // El índice único parcial lo impediría igual, pero un P2002 crudo le diría
    // «error interno» donde lo que pasa es justo el dato que necesita saber.
    const { svc, db } = montar();
    conEmpleado(db, { fullName: 'Beto Gómez', documento: '99999999' });
    const { tarjeta } = conEmpleado(db, { documento: '1020304' });

    await expect(
      svc.corregirDocumento(DUENO, tarjeta.id, '99999999'),
    ).rejects.toThrow(/Beto Gómez/);
  });

  it('un documento demasiado corto no pasa', async () => {
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db);
    await expect(svc.corregirDocumento(DUENO, tarjeta.id, '12')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('el dueño de otro negocio no puede tocarla', async () => {
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db, { documento: '1020304' });
    const otro = { ...DUENO, tenantId: 'tenant-ajeno' } as AuthUser;

    await expect(
      svc.corregirDocumento(otro, tarjeta.id, '10203045'),
    ).rejects.toThrow();
    // Lo que de verdad importa: no la tocó.
    expect(db.tabla('convenioTarjeta')[0].documento).toBe('1020304');
  });
});

describe('liberar una tarjeta', () => {
  it('la borra con su pase, para que esa persona pueda volver a activar', async () => {
    // El pase se va con ella: dejarlo lo dejaría en el teléfono apuntando a una
    // alianza que ya no lo reconoce, pintado como un cartón de sellos vacío.
    const { svc, db } = montar();
    const { tarjeta, pass } = conEmpleado(db);

    await svc.liberarTarjeta(DUENO, tarjeta.id);

    expect(db.tabla('convenioTarjeta')).toHaveLength(0);
    expect(db.tabla('pass').find((p) => p.id === pass.id)).toBeUndefined();
  });

  it('DEVUELVE su cupo en la lista blanca', async () => {
    // Activar quema esas filas. Sin devolverlas, en modo LISTA la persona
    // seguiría sin poder entrar y liberar no habría servido de nada.
    const { svc, db } = montar({ verificacion: 'LISTA' });
    const { tarjeta } = conEmpleado(db, { email: 'ana@empresa.co' });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '10203045',
      usedAt: new Date(),
    });
    db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      email: 'ana@empresa.co',
      usedAt: new Date(),
    });

    await svc.liberarTarjeta(DUENO, tarjeta.id);

    // Las DOS: quien carga la lista pega lo que le dio RRHH, y una misma
    // persona puede estar por cédula y por correo.
    for (const fila of db.tabla('convenioListaBlanca')) {
      expect(fila.usedAt).toBeNull();
    }
  });

  it('se niega si ya tiene canjes, y dice cuántos', async () => {
    // `ConvenioCanje` cuelga en cascada: borrarla se llevaría el historial y
    // devolvería el tope global, que es un descuento que el negocio ya dio.
    const { svc, db, cupon } = montar();
    const { tarjeta } = conEmpleado(db);
    db.sembrar('convenioCanje', {
      convenioId: 'convenio-confe',
      cuponId: cupon!.id,
      tarjetaId: tarjeta.id,
    });

    await expect(svc.liberarTarjeta(DUENO, tarjeta.id)).rejects.toThrow(
      /1 canje/,
    );
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
  });

  it('no toca la lista blanca de OTRA persona', async () => {
    const { svc, db } = montar({ verificacion: 'LISTA' });
    const { tarjeta } = conEmpleado(db, { documento: '10203045' });
    const ajena = db.sembrar('convenioListaBlanca', {
      convenioId: 'convenio-confe',
      documento: '77777777',
      usedAt: new Date(),
    });

    await svc.liberarTarjeta(DUENO, tarjeta.id);

    expect(
      db.tabla('convenioListaBlanca').find((f) => f.id === ajena.id)!.usedAt,
    ).not.toBeNull();
  });

  it('el dueño de otro negocio no puede borrarla', async () => {
    const { svc, db } = montar();
    const { tarjeta } = conEmpleado(db);
    const otro = { ...DUENO, tenantId: 'tenant-ajeno' } as AuthUser;

    await expect(svc.liberarTarjeta(otro, tarjeta.id)).rejects.toThrow();
    expect(db.tabla('convenioTarjeta')).toHaveLength(1);
  });
});
