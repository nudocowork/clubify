import { describe, it, expect, beforeAll } from 'vitest';
import { Logger } from '@nestjs/common';
import { alianzaDelPase } from './alianzas-pase.util';
import { escenario, type Fila } from './alianzas-prisma-falso';

/**
 * Lo que la billetera pinta de una alianza. Un solo sitio, porque el pase de
 * Apple y el de Google leen de aquí: si esto miente, mienten los dos.
 *
 * No tenía ni un test, y es lo que decide qué ve el empleado cuando enseña el
 * teléfono en la caja.
 */

beforeAll(() => {
  Logger.overrideLogger([]);
});

function conPase(db: ReturnType<typeof escenario>['db'], p: Fila = {}) {
  const customer = db.sembrar('customer', {
    tenantId: 'tenant-cafe',
    fullName: 'Ana Pérez',
    phone: '+573001112233',
  });
  const card = db.sembrar('card', {
    tenantId: 'tenant-cafe',
    convenioId: 'convenio-confe',
  });
  const pass = db.sembrar('pass', {
    tenantId: 'tenant-cafe',
    cardId: card.id,
    customerId: customer.id,
    serialNumber: 'CLB-1',
    qrToken: 'QR-1',
    authToken: 'x',
  });
  db.sembrar('convenioTarjeta', {
    convenioId: 'convenio-confe',
    customerId: customer.id,
    passId: pass.id,
    documento: '10203045',
    status: p.status ?? 'ACTIVE',
  });
  return pass;
}

describe('lo que la billetera enseña de una alianza', () => {
  it('los beneficios VIVOS, que es lo que la caja va a aplicar', async () => {
    const { db, prisma } = escenario({
      cupon: { tipo: 'PERCENT_OFF', valor: 15, name: 'almuerzos' },
    });
    const pass = conPase(db);
    db.sembrar('convenioCupon', {
      convenioId: 'convenio-confe',
      name: 'bebida',
      tipo: 'FREEBIE',
      valor: 0,
      isActive: true,
      activoAliado: true,
      position: 2,
    });

    const a = await alianzaDelPase(prisma, 'convenio-confe', pass.id);

    expect(a!.empresa).toBe('Confenalco');
    expect(a!.vivos).toHaveLength(2);
    expect(a!.estado).toBe('ACTIVO');
  });

  it('un cupón apagado por el ALIADO no se enseña', async () => {
    // El pase no puede prometer lo que la caja va a rechazar: el canje exige
    // los dos interruptores.
    const { db, prisma } = escenario({ cupon: { activoAliado: false } });
    const pass = conPase(db);

    const a = await alianzaDelPase(prisma, 'convenio-confe', pass.id);

    expect(a!.vivos).toEqual([]);
  });

  it('las condiciones salen de los beneficios, no de la plantilla', async () => {
    // `Card.terms` está vacío en la plantilla de una alianza. Leyéndolo, el
    // reverso del pase decía «Condiciones: —» en una tarjeta que sí tiene
    // letra pequeña.
    const { db, prisma } = escenario({
      cupon: { terms: 'No acumulable con otras promociones.' },
    });
    const pass = conPase(db);

    const a = await alianzaDelPase(prisma, 'convenio-confe', pass.id);

    expect(a!.condiciones).toEqual(['No acumulable con otras promociones.']);
  });

  it('no repite la misma condición aunque la compartan varios beneficios', async () => {
    // Verla tres veces seguidas en el reverso se lee como un error.
    const { db, prisma } = escenario({ cupon: { terms: 'Solo de lunes a viernes.' } });
    const pass = conPase(db);
    db.sembrar('convenioCupon', {
      convenioId: 'convenio-confe',
      name: 'bebida',
      tipo: 'FREEBIE',
      valor: 0,
      terms: 'Solo de lunes a viernes.',
      isActive: true,
      activoAliado: true,
      position: 2,
    });

    const a = await alianzaDelPase(prisma, 'convenio-confe', pass.id);

    expect(a!.condiciones).toEqual(['Solo de lunes a viernes.']);
  });

  it('sin letra pequeña no inventa ninguna', async () => {
    const { db, prisma } = escenario({ cupon: { terms: '   ' } });
    const pass = conPase(db);

    const a = await alianzaDelPase(prisma, 'convenio-confe', pass.id);

    expect(a!.condiciones).toEqual([]);
  });

  it('las condiciones de un beneficio APAGADO no se enseñan', async () => {
    const { db, prisma } = escenario({
      cupon: { isActive: false, terms: 'Solo con compra mínima.' },
    });
    const pass = conPase(db);

    const a = await alianzaDelPase(prisma, 'convenio-confe', pass.id);

    expect(a!.condiciones).toEqual([]);
  });

  it('una persona bloqueada lo lleva escrito en el pase', async () => {
    const { db, prisma } = escenario();
    const pass = conPase(db, { status: 'BLOCKED' });

    const a = await alianzaDelPase(prisma, 'convenio-confe', pass.id);

    expect(a!.estado).toBe('BLOQUEADA');
  });

  it('un convenio que ya no existe no revienta el pase', async () => {
    const { db, prisma } = escenario();
    conPase(db);

    expect(await alianzaDelPase(prisma, 'convenio-fantasma', 'pass-x')).toBeNull();
  });
});
