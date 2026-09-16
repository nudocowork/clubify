import { describe, it, expect } from 'vitest';
import { fechaLocal, horaLocal, restarDias } from './hora-local';

/**
 * La push de las 4 de la mañana.
 *
 * EL FALLO (Javier, 16-09-2026): «hoy llegó una push Android a las 4am, lo
 * cual no tiene sentido, ya que fue enviada en la noche por Konnys. Hay varios
 * clientes así».
 *
 * Los crons diarios de automatizaciones estaban clavados a una hora UTC
 * (`0 8 * * *` cumpleaños, `0 9 * * *` inactividad) y el servidor va en UTC.
 * En Bogotá (UTC-5) eso es las 3am y las 4am. En producción, en 60 días: 482
 * push a las 3am y 1.027 a las 4am, todas de automatizaciones. El «Te
 * extrañamos …💌» de Konys salió a las 04:03.
 *
 * `Tenant.timezone` ya existía y nadie lo miraba. Estas son las cuentas que
 * decidían la hora del envío, ahora aparte para poder probarlas solas.
 */

/** Las horas UTC a las que estaban clavados los crons antes del arreglo. */
const CRON_VIEJO_CUMPLEANOS_UTC = '2026-09-16T08:00:00Z';
const CRON_VIEJO_INACTIVIDAD_UTC = '2026-09-16T09:00:00Z';

describe('el bug, tal cual salía en producción', () => {
  it('el cron de inactividad de las 9 UTC son las 4 de la mañana en Bogotá', () => {
    const hora = horaLocal(new Date(CRON_VIEJO_INACTIVIDAD_UTC), 'America/Bogota');
    expect(hora).toBe(4); // la push de Konys, a las 04:03
  });

  it('el cron de cumpleaños de las 8 UTC son las 3 de la mañana en Bogotá', () => {
    const hora = horaLocal(new Date(CRON_VIEJO_CUMPLEANOS_UTC), 'America/Bogota');
    expect(hora).toBe(3);
  });

  it('a las 8 de la mañana en Bogotá le corresponden las 13 UTC, no las 8', () => {
    // Si el cron dispara a las 13 UTC, el negocio de Bogotá lo recibe a las 8.
    expect(horaLocal(new Date('2026-09-16T13:00:00Z'), 'America/Bogota')).toBe(8);
  });
});

describe('cada negocio en su hora, no en la del servidor', () => {
  // Una sola hora UTC no puede ser «las 8 de la mañana» para todos: en
  // producción hay negocios en 10 zonas distintas.
  const ahora = new Date('2026-09-16T13:00:00Z');

  it.each([
    ['America/Bogota', 8], // Colombia (97 negocios)
    ['America/Lima', 8], // Perú (4)
    ['America/Panama', 8], // Panamá
    ['America/New_York', 9], // 8 negocios
    ['America/Mexico_City', 7], // 5 negocios
    ['America/Caracas', 9], // Venezuela (5)
    // Chile (3). En septiembre ya entró el horario de verano (UTC-3), así que
    // no coincide con Caracas aunque el resto del año sí. Justo por esto la
    // hora no se puede calcular restando un número fijo.
    ['America/Santiago', 10],
    ['America/La_Paz', 9], // Bolivia (1)
    ['America/Guatemala', 7], // (1)
  ])('a las 13 UTC en %s son las %i', (zona, esperada) => {
    expect(horaLocal(ahora, zona)).toBe(esperada);
  });

  it('a las 13 UTC NO es la misma hora local en todas partes', () => {
    const zonas = ['America/Bogota', 'America/Santiago', 'America/Mexico_City'];
    const horas = new Set(zonas.map((z) => horaLocal(ahora, z)));
    expect(horas.size).toBeGreaterThan(1);
  });
});

describe('qué día es hoy para el negocio', () => {
  it('a las 02:00 UTC en Bogotá todavía es el día anterior', () => {
    // Si se usa la fecha UTC, al negocio se le adelanta el calendario un día
    // entero: los cumpleaños salen el día que no toca.
    expect(fechaLocal(new Date('2026-09-16T02:00:00Z'), 'America/Bogota')).toBe(
      '2026-09-15',
    );
  });

  it('a las 12:00 UTC en Bogotá ya es el mismo día', () => {
    expect(fechaLocal(new Date('2026-09-16T12:00:00Z'), 'America/Bogota')).toBe(
      '2026-09-16',
    );
  });

  it('la medianoche local es la hora 0 y el día que empieza', () => {
    const medianocheEnBogota = new Date('2026-09-16T05:00:00Z');
    expect(horaLocal(medianocheEnBogota, 'America/Bogota')).toBe(0);
    expect(fechaLocal(medianocheEnBogota, 'America/Bogota')).toBe('2026-09-16');
  });

  it('en Nueva York a las 02:00 UTC también es el día anterior', () => {
    expect(
      fechaLocal(new Date('2026-09-16T02:00:00Z'), 'America/New_York'),
    ).toBe('2026-09-15');
  });
});

describe('restar 30 días para el umbral de inactividad', () => {
  it('cruza el cambio de mes', () => {
    expect(restarDias('2026-09-16', 30)).toBe('2026-08-17');
  });

  it('cruza el cambio de año', () => {
    expect(restarDias('2026-01-10', 30)).toBe('2025-12-11');
  });

  it('cuenta bien un año bisiesto', () => {
    expect(restarDias('2024-03-01', 1)).toBe('2024-02-29');
  });

  it('restar 0 días deja la fecha igual', () => {
    expect(restarDias('2026-09-16', 0)).toBe('2026-09-16');
  });
});

describe('defensa ante datos malos', () => {
  it('una zona horaria corrupta no tumba el cron de los demás negocios', () => {
    // Intl lanza RangeError con una zona inválida. Si eso sube, un solo
    // negocio con la columna mal deja sin mensajes a todos los demás.
    expect(() => horaLocal(new Date(), 'Marte/Olympus_Mons')).not.toThrow();
    expect(horaLocal(new Date(CRON_VIEJO_INACTIVIDAD_UTC), 'no-existe')).toBe(4);
  });

  it('sin zona horaria se asume la de Bogotá, no la del servidor', () => {
    expect(
      horaLocal(new Date(CRON_VIEJO_INACTIVIDAD_UTC), '' as unknown as string),
    ).toBe(4);
  });
});
