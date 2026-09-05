import { describe, it, expect } from 'vitest';
import {
  periodoDe,
  diaDelMes,
  cupoDeAlta,
  errorDeTramos,
  periodicidadValida,
  tocaReiniciar,
} from './club-periodo';

/**
 * Reglas de la Tarjeta de Club.
 *
 * Estos tests importan el módulo REAL. Es a propósito: los de Convenios
 * reimplementan la lógica dentro del propio fichero, así que pasan los 31 sin
 * proteger una sola línea de lo que corre en producción.
 */

describe('el mes se cuenta en hora de Bogotá, no en UTC', () => {
  it('un café de las 8 de la noche del 30 cuenta para septiembre', () => {
    // 01:00 UTC del 1 de octubre son las 20:00 del 30 de septiembre en
    // Bogotá. Contándolo en UTC, ese café saldría del cupo de octubre y el
    // cliente perdería uno de septiembre sin haberlo gastado.
    expect(periodoDe(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09');
  });

  it('el primero a mediodía ya es el mes nuevo', () => {
    expect(periodoDe(new Date('2026-10-01T17:00:00Z'))).toBe('2026-10');
  });

  it('el día del mes también es el de Bogotá', () => {
    expect(diaDelMes(new Date('2026-10-01T01:00:00Z'))).toBe(30);
    expect(diaDelMes(new Date('2026-10-01T17:00:00Z'))).toBe(1);
  });
});

describe('cuánto recibe quien se da de alta a mitad de mes', () => {
  const tramos = [
    { desdeDia: 1, hastaDia: 15, beneficios: 10 },
    { desdeDia: 16, hastaDia: 24, beneficios: 5 },
    { desdeDia: 25, hastaDia: 31, beneficios: 3 },
  ];

  it('el ejemplo de Javier: del 1 al 15 el cupo entero', () => {
    expect(cupoDeAlta(1, 10, tramos)).toBe(10);
    expect(cupoDeAlta(15, 10, tramos)).toBe(10);
  });

  it('del 25 al 30, tres', () => {
    expect(cupoDeAlta(25, 10, tramos)).toBe(3);
    expect(cupoDeAlta(31, 10, tramos)).toBe(3);
  });

  it('los bordes de cada tramo entran', () => {
    expect(cupoDeAlta(16, 10, tramos)).toBe(5);
    expect(cupoDeAlta(24, 10, tramos)).toBe(5);
  });

  it('sin tramos configurados recibe el cupo entero', () => {
    // Es lo que espera quien no configuró nada. Devolver 0 dejaría al cliente
    // que acaba de pagar con una tarjeta vacía.
    expect(cupoDeAlta(20, 10, [])).toBe(10);
  });

  it('un día sin cubrir también recibe el cupo entero', () => {
    // Mejor regalar de más que dejar en cero a alguien que pagó por un hueco
    // en la configuración del negocio.
    expect(cupoDeAlta(20, 10, [{ desdeDia: 1, hastaDia: 15, beneficios: 10 }])).toBe(10);
  });

  it('un tramo no puede dar más que el cupo del mes', () => {
    // Un tramo mal puesto no convierte el alta en un regalo mayor que la
    // propia suscripción.
    expect(cupoDeAlta(5, 10, [{ desdeDia: 1, hastaDia: 31, beneficios: 999 }])).toBe(10);
  });

  it('un tramo puede dar cero', () => {
    expect(cupoDeAlta(28, 10, [{ desdeDia: 25, hastaDia: 31, beneficios: 0 }])).toBe(0);
  });
});

describe('tramos mal configurados se rechazan al guardar', () => {
  it('los que no se pisan pasan', () => {
    expect(
      errorDeTramos([
        { desdeDia: 1, hastaDia: 15, beneficios: 10 },
        { desdeDia: 16, hastaDia: 31, beneficios: 5 },
      ]),
    ).toBeNull();
  });

  it('dos tramos que cubren el mismo día se rechazan', () => {
    // Si dos tramos cubren el día 15, a dos clientes del mismo día les tocaría
    // distinto según el orden de la consulta. Nadie entendería por qué.
    expect(
      errorDeTramos([
        { desdeDia: 1, hastaDia: 15, beneficios: 10 },
        { desdeDia: 15, hastaDia: 31, beneficios: 5 },
      ]),
    ).toMatch(/se pisan/);
  });

  it('un tramo al revés se rechaza', () => {
    expect(errorDeTramos([{ desdeDia: 20, hastaDia: 5, beneficios: 3 }])).toMatch(
      /empieza después/,
    );
  });

  it('días fuera del mes se rechazan', () => {
    expect(errorDeTramos([{ desdeDia: 0, hastaDia: 10, beneficios: 3 }])).toMatch(/del 1 al 31/);
    expect(errorDeTramos([{ desdeDia: 1, hastaDia: 32, beneficios: 3 }])).toMatch(/del 1 al 31/);
  });

  it('beneficios negativos se rechazan', () => {
    expect(errorDeTramos([{ desdeDia: 1, hastaDia: 10, beneficios: -1 }])).toMatch(/entero/);
  });

  it('sin tramos no hay nada que rechazar', () => {
    expect(errorDeTramos([])).toBeNull();
  });
});

describe('el reinicio mensual: asignar, nunca sumar', () => {
  it('reinicia cuando cambia el mes', () => {
    expect(tocaReiniciar({ status: 'ACTIVA', periodo: '2026-08' }, '2026-09')).toBe(true);
  });

  it('correr el cron dos veces el mismo mes no hace nada', () => {
    // Esta es toda la idempotencia. Con `saldo += 10` la segunda pasada
    // regalaría otro cupo; con la comparación de período, no pasa nada.
    expect(tocaReiniciar({ status: 'ACTIVA', periodo: '2026-09' }, '2026-09')).toBe(false);
  });

  it('tres meses pausada vuelve con UN cupo, no con tres', () => {
    // Se compara el período guardado con el ACTUAL, no se cuentan los meses
    // transcurridos. Volver de una pausa larga no acumula reinicios.
    const m = { status: 'ACTIVA', periodo: '2026-06' };
    expect(tocaReiniciar(m, '2026-09')).toBe(true);
    // Y tras reiniciar una vez, ya no toca.
    expect(tocaReiniciar({ ...m, periodo: '2026-09' }, '2026-09')).toBe(false);
  });

  it('una membresía pausada NO se reinicia', () => {
    // Si no está pagando, no recibe. Su saldo se congela hasta que vuelva.
    expect(tocaReiniciar({ status: 'PAUSADA', periodo: '2026-08' }, '2026-09')).toBe(false);
  });

  it('una cancelada tampoco', () => {
    expect(tocaReiniciar({ status: 'CANCELADA', periodo: '2026-08' }, '2026-09')).toBe(false);
  });
});

describe('el cupo se reinicia, no se acumula — la regla que define el producto', () => {
  it('consumir 3 de 10 no deja 17 el mes siguiente', () => {
    const CUPO = 10;
    let saldo = CUPO;
    saldo -= 3; // consumió 3 en septiembre
    expect(saldo).toBe(7);

    // Llega octubre. El reinicio ASIGNA, no suma.
    if (tocaReiniciar({ status: 'ACTIVA', periodo: '2026-09' }, '2026-10')) {
      saldo = CUPO;
    }
    expect(saldo).toBe(10); // no 17
  });

  it('gastarlo todo deja el mismo cupo que no gastar nada', () => {
    const CUPO = 10;
    const gastoTodo = { status: 'ACTIVA', periodo: '2026-09', saldo: 0 };
    const gastoNada = { status: 'ACTIVA', periodo: '2026-09', saldo: 10 };
    for (const m of [gastoTodo, gastoNada]) {
      if (tocaReiniciar(m, '2026-10')) m.saldo = CUPO;
    }
    expect(gastoTodo.saldo).toBe(10);
    expect(gastoNada.saldo).toBe(10);
  });
});

describe('periodicidad del plan', () => {
  it('solo reconoce MENSUAL y ANUAL, y ante la duda cobra al mes', () => {
    expect(periodicidadValida('ANUAL')).toBe('ANUAL');
    expect(periodicidadValida('anual')).toBe('ANUAL');
    expect(periodicidadValida(' Anual ')).toBe('ANUAL');
    expect(periodicidadValida('MENSUAL')).toBe('MENSUAL');
    // Lo que no se entiende cae en MENSUAL: es lo que eran todos los planes
    // antes de que esto existiera. Un plan sin periodicidad no puede quedarse
    // sin decir cómo se lee su precio.
    expect(periodicidadValida(undefined)).toBe('MENSUAL');
    expect(periodicidadValida(null)).toBe('MENSUAL');
    expect(periodicidadValida('')).toBe('MENSUAL');
    expect(periodicidadValida('TRIMESTRAL')).toBe('MENSUAL');
  });
});
