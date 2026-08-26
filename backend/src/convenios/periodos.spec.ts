import { describe, it, expect } from 'vitest';
import { inicioDelPeriodo, describirTope, cuandoVuelve } from './periodos';

/**
 * Los bordes que rompen este tipo de código:
 *   - las 02:00 UTC, que en Bogotá son todavía el día ANTERIOR
 *   - el domingo, que pertenece a la semana que empezó el lunes previo
 *   - la semana que cruza el cambio de mes
 *   - el 1 de enero
 *   - una zona con horario de verano, donde restar horas a mano falla
 */

const BOGOTA = 'America/Bogota';

describe('el caso que motivó todo esto', () => {
  it('hoy a las 4pm y mañana a las 11am son DOS días distintos', () => {
    // 16:00 en Bogotá = 21:00 UTC del mismo día.
    const hoyTarde = new Date('2026-08-26T21:00:00Z');
    // 11:00 en Bogotá del día siguiente = 16:00 UTC.
    const mananaManana = new Date('2026-08-27T16:00:00Z');

    const a = inicioDelPeriodo('DIA', hoyTarde, BOGOTA)!;
    const b = inicioDelPeriodo('DIA', mananaManana, BOGOTA)!;

    expect(a.getTime()).not.toBe(b.getTime());
    // Solo van 19 horas: una ventana móvil de 24h lo habría rechazado.
    const horas = (mananaManana.getTime() - hoyTarde.getTime()) / 3_600_000;
    expect(horas).toBe(19);
  });

  it('dos visitas el MISMO día caen en la misma ventana', () => {
    const manana = new Date('2026-08-26T14:00:00Z'); // 09:00 Bogotá
    const tarde = new Date('2026-08-26T22:00:00Z'); // 17:00 Bogotá
    expect(inicioDelPeriodo('DIA', manana, BOGOTA)!.getTime()).toBe(
      inicioDelPeriodo('DIA', tarde, BOGOTA)!.getTime(),
    );
  });
});

describe('la medianoche NO es la del servidor', () => {
  it('a las 02:00 UTC en Bogotá es todavía el día anterior', () => {
    // 2026-08-27T02:00Z = 2026-08-26 21:00 en Bogotá.
    const t = new Date('2026-08-27T02:00:00Z');
    const inicio = inicioDelPeriodo('DIA', t, BOGOTA)!;
    // La medianoche del 26 en Bogotá = 05:00 UTC del 26.
    expect(inicio.toISOString()).toBe('2026-08-26T05:00:00.000Z');
  });

  it('el día empieza a las 05:00 UTC, no a las 00:00', () => {
    const t = new Date('2026-08-26T18:00:00Z');
    expect(inicioDelPeriodo('DIA', t, BOGOTA)!.getUTCHours()).toBe(5);
  });

  it('nunca arranca en el futuro', () => {
    const t = new Date('2026-08-26T21:00:00Z');
    for (const p of ['DIA', 'SEMANA', 'MES', 'ANIO'] as const) {
      expect(inicioDelPeriodo(p, t, BOGOTA)!.getTime()).toBeLessThanOrEqual(
        t.getTime(),
      );
    }
  });
});

describe('la semana empieza el lunes', () => {
  it('el domingo pertenece a la semana del lunes ANTERIOR', () => {
    // Domingo 2026-08-30, 15:00 Bogotá = 20:00 UTC.
    const domingo = new Date('2026-08-30T20:00:00Z');
    // Lunes 2026-08-24, 15:00 Bogotá.
    const lunes = new Date('2026-08-24T20:00:00Z');
    expect(inicioDelPeriodo('SEMANA', domingo, BOGOTA)!.getTime()).toBe(
      inicioDelPeriodo('SEMANA', lunes, BOGOTA)!.getTime(),
    );
  });

  it('el lunes abre una ventana nueva', () => {
    const domingo = new Date('2026-08-30T20:00:00Z');
    const lunesSiguiente = new Date('2026-08-31T20:00:00Z');
    expect(inicioDelPeriodo('SEMANA', domingo, BOGOTA)!.getTime()).not.toBe(
      inicioDelPeriodo('SEMANA', lunesSiguiente, BOGOTA)!.getTime(),
    );
  });

  it('una semana que cruza el cambio de mes no se parte', () => {
    // Lunes 31 de agosto y jueves 3 de septiembre, misma semana.
    const lunes31 = new Date('2026-08-31T20:00:00Z');
    const jueves3 = new Date('2026-09-03T20:00:00Z');
    expect(inicioDelPeriodo('SEMANA', lunes31, BOGOTA)!.getTime()).toBe(
      inicioDelPeriodo('SEMANA', jueves3, BOGOTA)!.getTime(),
    );
  });
});

describe('mes y año', () => {
  it('quien canjeó el 31 recupera sus usos el 1', () => {
    const treintaYUno = new Date('2026-08-31T20:00:00Z');
    const primero = new Date('2026-09-01T20:00:00Z');
    expect(inicioDelPeriodo('MES', treintaYUno, BOGOTA)!.getTime()).not.toBe(
      inicioDelPeriodo('MES', primero, BOGOTA)!.getTime(),
    );
  });

  it('el 1 de enero abre año nuevo', () => {
    const finDeAnio = new Date('2026-12-31T20:00:00Z');
    const anioNuevo = new Date('2027-01-01T20:00:00Z');
    expect(inicioDelPeriodo('ANIO', finDeAnio, BOGOTA)!.getTime()).not.toBe(
      inicioDelPeriodo('ANIO', anioNuevo, BOGOTA)!.getTime(),
    );
  });
});

describe('otras zonas', () => {
  it('México corta el día en otro momento que Bogotá', () => {
    const t = new Date('2026-08-27T04:00:00Z');
    const bog = inicioDelPeriodo('DIA', t, BOGOTA)!;
    const mex = inicioDelPeriodo('DIA', t, 'America/Mexico_City')!;
    expect(bog.getTime()).not.toBe(mex.getTime());
  });

  it('una zona CON horario de verano se resuelve bien', () => {
    // Madrid en agosto va en UTC+2: la medianoche local es 22:00 UTC del día
    // anterior. Restar un desfase fijo aquí daría otra cosa.
    const t = new Date('2026-08-26T12:00:00Z');
    const madrid = inicioDelPeriodo('DIA', t, 'Europe/Madrid')!;
    expect(madrid.toISOString()).toBe('2026-08-25T22:00:00.000Z');
  });

  it('una zona inválida cae a Bogotá en vez de tumbar el canje', () => {
    const t = new Date('2026-08-26T21:00:00Z');
    expect(inicioDelPeriodo('DIA', t, 'No/Existe')!.getTime()).toBe(
      inicioDelPeriodo('DIA', t, BOGOTA)!.getTime(),
    );
  });
});

describe('SIEMPRE no tiene ventana', () => {
  it('devuelve null: se cuenta todo el historial', () => {
    const t = new Date('2026-08-26T21:00:00Z');
    expect(inicioDelPeriodo('SIEMPRE', t, BOGOTA)).toBeNull();
    expect(inicioDelPeriodo(null, t, BOGOTA)).toBeNull();
    expect(inicioDelPeriodo(undefined, t, BOGOTA)).toBeNull();
  });
});

describe('los textos que ve la gente', () => {
  it('describe el tope en castellano llano', () => {
    expect(describirTope(null, 'DIA')).toBe('Sin límite de usos');
    expect(describirTope(1, 'SIEMPRE')).toBe('Una sola vez');
    expect(describirTope(3, 'SIEMPRE')).toBe('3 en total');
    expect(describirTope(1, 'DIA')).toBe('1 vez por día');
    expect(describirTope(2, 'MES')).toBe('2 veces por mes');
  });

  it('dice cuándo vuelve sin contadores que mentirían', () => {
    expect(cuandoVuelve('DIA')).toContain('mañana');
    expect(cuandoVuelve('MES')).toContain('mes que viene');
    // Sin período no hay "vuelve": se acabó.
    expect(cuandoVuelve('SIEMPRE')).toContain('agotó');
  });
});
