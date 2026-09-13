import { describe, it, expect } from 'vitest';
import { ReservationsService } from './reservations.service';

/**
 * Qué contesta el escáner cuando le enseñan el pase de una RESERVA.
 *
 * EL FALLO (2026-09-13, Ricuras Paisas): «cuando le iba a escanear el código a
 * la tarjeta de un cliente me salió que el sello estaba listo pero que la
 * versión del escáner no detectaba la tarjeta».
 *
 * La reserva se confirmaba bien. Lo que fallaba era la RESPUESTA: las cuatro
 * salidas de `handleScannedReservation` no traían `kind`, y una de ellas
 * tampoco traía `message`. El escáner no tiene forma de saber qué está
 * mirando, cae en su red de seguridad y enseña «esta versión del escáner no
 * sabe mostrar este tipo de tarjeta» — que se lee como que el escáner está
 * roto, cuando lo que pasaba es que la clienta (Laura Daniela, que reservó el
 * 11 de septiembre) todavía no tiene tarjeta de ese negocio.
 *
 * Las dos reglas que fijan estos tests:
 *   1. TODA salida trae `kind: 'reserva'`.
 *   2. Si no hay tarjeta que enseñar, trae un `message` para el cajero.
 *
 * Lo que NO se toca: escanear una reserva sigue SIN crear tarjeta y SIN dar
 * sellos (decisión del 2026-06-30). El arreglo es explicarlo, no cambiarlo.
 */

type Reserva = {
  id: string;
  tenantId: string;
  customerId: string | null;
  customerName: string;
  party: number | null;
  date: Date;
  time: string;
  status: string;
  table: { number: string } | null;
  zone: { name: string } | null;
};

const RESERVA: Reserva = {
  id: 'r1',
  tenantId: 't1',
  customerId: 'c1',
  customerName: 'Laura Daniela Rojas Castellanos',
  party: 2,
  date: new Date('2026-09-13T12:00:00Z'),
  time: '19:30',
  status: 'CONFIRMED',
  table: { number: '4' },
  zone: { name: 'Terraza' },
};

/**
 * @param hay qué encuentra la base: la tarjeta de sellos del negocio y el pase
 *            de esa persona.
 */
function servicio(hay: {
  reserva?: Partial<Reserva>;
  tarjetaDeSellos?: boolean;
  pase?: boolean;
}) {
  const r = { ...RESERVA, ...(hay.reserva ?? {}) };
  const prisma: any = {
    reservation: {
      findUnique: async () => r,
      findFirst: async () => r,
      update: async () => r,
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [],
    },
    card: {
      findFirst: async () =>
        hay.tarjetaDeSellos === false ? null : { id: 'card1' },
    },
    pass: {
      findUnique: async () =>
        hay.pase
          ? {
              id: 'p1',
              stampsCount: 3,
              card: { id: 'card1', name: 'Tarjeta de sellos', type: 'STAMPS' },
              customer: { id: 'c1', fullName: r.customerName },
              tenant: { brandName: 'Ricuras', primaryColor: null, logoUrl: null },
            }
          : null,
      findFirst: async () => null,
    },
    stamp: { findMany: async () => [] },
    table: { update: async () => ({}) },
  };
  const nada: any = {};
  return new ReservationsService(
    prisma,
    nada, nada, nada, nada, nada,
  );
}

const usuario: any = { id: 'u1', role: 'TENANT_OWNER', tenantId: 't1' };

describe('escanear el pase de una reserva', () => {
  it('con tarjeta: contesta «reserva» y trae el pase', async () => {
    const r: any = await servicio({ pase: true }).handleScannedReservation(
      usuario,
      'r1',
    );
    expect(r.kind).toBe('reserva');
    expect(r.pass).toBeTruthy();
    expect(r.reservation?.customerName).toBe(RESERVA.customerName);
  });

  it('SIN tarjeta: contesta «reserva» y explica por qué no hay nada que enseñar', async () => {
    // Este es el caso de Ricuras. Antes no traía ni `kind` ni `message`.
    const r: any = await servicio({ pase: false }).handleScannedReservation(
      usuario,
      'r1',
    );
    expect(r.kind).toBe('reserva');
    expect(r.pass).toBeNull();
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
    // Y dice de quién se trata, que es lo que el cajero necesita.
    expect(r.message).toContain(RESERVA.customerName);
  });

  it('negocio sin tarjeta de fidelización: también se explica', async () => {
    const r: any = await servicio({
      tarjetaDeSellos: false,
    }).handleScannedReservation(usuario, 'r1');
    expect(r.kind).toBe('reserva');
    expect(r.pass).toBeNull();
    expect(r.message).toContain('tarjeta de fidelización');
  });

  it('reserva sin cliente registrado: también se explica', async () => {
    const r: any = await servicio({
      reserva: { customerId: null },
    }).handleScannedReservation(usuario, 'r1');
    expect(r.kind).toBe('reserva');
    expect(r.pass).toBeNull();
    expect(typeof r.message).toBe('string');
  });

  it('NINGUNA salida se queda sin `kind`: es lo que rompía el escáner', async () => {
    const casos = [
      servicio({ pase: true }),
      servicio({ pase: false }),
      servicio({ tarjetaDeSellos: false }),
      servicio({ reserva: { customerId: null } }),
    ];
    for (const s of casos) {
      const r: any = await s.handleScannedReservation(usuario, 'r1');
      expect(r.kind).toBe('reserva');
    }
  });
});
