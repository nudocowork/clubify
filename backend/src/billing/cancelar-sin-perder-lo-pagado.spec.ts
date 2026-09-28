import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { desconectaAlCancelar } from './cancelacion';

/**
 * CANCELAR NO ES RENUNCIAR A LO PAGADO, POR NINGUNA DE LAS PUERTAS.
 *
 * La regla la decidió Javier el 2026-09-10 —quien pagó hasta el 25 y avisa el
 * 10 sigue hasta el 25— y vive sola en `cancelacion.ts` precisamente porque la
 * cancelación entra por VARIAS puertas. El comentario de `billing.service`
 * llegó a decir que «las dos puertas deciden ahora con el mismo criterio».
 * Eran TRES, y la tercera no la aplicaba.
 *
 * LO QUE COSTÓ (2026-09-28): la cuenta SELLEA había pagado USD 80 el 26 de
 * agosto y su período corría hasta el 26 de OCTUBRE. El 26 de septiembre llegó
 * la cancelación por Stripe y `onSubscriptionCancelled` la suspendió en el
 * acto. Un mes de servicio pagado, cortado, sin que nadie lo decidiera. Y era
 * la cuenta de la propia marca.
 *
 * Este candado no comprueba la aritmética —de eso va
 * `cancelacion-y-renovacion.spec.ts`— sino que NINGUNA puerta se la salte.
 */

/** Los ficheros que atienden una cancelación, y cómo se reconoce cada uno. */
const PUERTAS = [
  {
    fichero: 'billing.service.ts',
    puerta: 'el botón «cancelar cuenta» del panel del negocio',
  },
  {
    fichero: 'hotmart.service.ts',
    puerta: 'el webhook de Hotmart',
  },
  {
    fichero: 'stripe.service.ts',
    puerta: 'el webhook de Stripe — el que se quedó fuera y suspendió a SELLEA',
  },
];

const dir = path.join(process.cwd(), 'src', 'billing');
const leer = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

describe('todas las puertas de cancelación deciden con la misma regla', () => {
  for (const { fichero, puerta } of PUERTAS) {
    it(`${fichero} — ${puerta}`, () => {
      const src = leer(fichero);
      expect(
        src.includes('desconectaAlCancelar'),
        `${fichero} atiende una cancelación y NO usa \`desconectaAlCancelar\`. ` +
          'Suspender sin mirar `currentPeriodEnd` le corta a un negocio días que ' +
          'ya pagó. Si de verdad esta puerta no cancela nada, quítala de PUERTAS.',
      ).toBe(true);
    });
  }

  it('NINGUNA suspende a secas junto a una cancelación', () => {
    // El fallo no fue olvidar el import, fue escribir `status: 'SUSPENDED'`
    // directamente. Se busca esa forma dentro de la función que cancela.
    const sospechosas: string[] = [];
    for (const { fichero } of PUERTAS) {
      const src = leer(fichero);
      const i = src.indexOf('onSubscriptionCancelled');
      if (i === -1) continue;
      // El cuerpo de la función, a ojo de buen cubero: hasta la siguiente
      // declaración de método privado.
      const cuerpo = src.slice(i, src.indexOf('private async', i + 40));
      const suspendeYa = /status:\s*'SUSPENDED'/.test(cuerpo);
      const mira = cuerpo.includes('desconectaAlCancelar');
      if (suspendeYa && !mira) sospechosas.push(fichero);
    }
    expect(
      sospechosas,
      'Estas suspenden dentro de la cancelación sin consultar la regla.',
    ).toEqual([]);
  });
});

describe('EL CASO SELLEA, con sus fechas reales', () => {
  // Pagó el 26 de agosto; el período corría hasta el 26 de octubre. La
  // cancelación llegó el 26 de septiembre.
  const CANCELACION = new Date('2026-09-26T23:16:00Z');
  const SELLEA = {
    status: 'ACTIVE',
    failedPaymentCount: 0,
    currentPeriodEnd: new Date('2026-10-26T23:15:00Z'),
  };

  it('NO se le corta: le quedaba un mes pagado', () => {
    expect(desconectaAlCancelar(SELLEA, CANCELACION)).toBe(false);
  });

  it('y sí se le corta cuando llega el 26 de octubre', () => {
    expect(
      desconectaAlCancelar(SELLEA, new Date('2026-10-27T00:00:00Z')),
    ).toBe(true);
  });

  it('con un cobro fallido por detrás, se corta ya', () => {
    // No hay días pagados que respetar: es el caso VALMONT BARBERIA.
    expect(
      desconectaAlCancelar({ ...SELLEA, failedPaymentCount: 1 }, CANCELACION),
    ).toBe(true);
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: la regla distingue los dos casos', () => {
    // Si `desconectaAlCancelar` devolviera siempre lo mismo, lo de arriba
    // pasaría en verde sin proteger nada.
    expect(desconectaAlCancelar(SELLEA, CANCELACION)).not.toBe(
      desconectaAlCancelar(SELLEA, new Date('2026-10-27T00:00:00Z')),
    );
  });
});
