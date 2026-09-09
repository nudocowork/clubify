import { describe, it, expect } from 'vitest';
import {
  diaDe,
  errorDeLimites,
  esperaEnPalabras,
  inicioDelDia,
  pluralDe,
  puedeConsumir,
} from './club-frecuencia';

const SIN_LIMITE = { maxPorDia: null, minutosEntreConsumos: null };
const VACIO = { consumidosHoy: 0, ultimoConsumoAt: null };

const pedir = (x: Partial<Parameters<typeof puedeConsumir>[0]>) =>
  puedeConsumir({
    limites: SIN_LIMITE,
    estado: VACIO,
    cantidad: 1,
    ahora: new Date('2026-09-08T20:00:00Z'),
    unidad: 'café',
    ...x,
  });

describe('sin límites configurados, todo sigue igual', () => {
  it('el caso que reportó Javier: tres seguidos pasaban, y siguen pasando', () => {
    // No se le cambian las reglas a un plan que ya se vendió. Los límites
    // nacen apagados; el negocio los enciende si quiere.
    const r = pedir({ estado: { consumidosHoy: 3, ultimoConsumoAt: new Date('2026-09-08T19:59:00Z') } });
    expect(r.permitido).toBe(true);
  });

  it('un cero o un negativo guardado por error no bloquea a nadie', () => {
    const r = pedir({
      limites: { maxPorDia: 0, minutosEntreConsumos: -5 },
      estado: { consumidosHoy: 9, ultimoConsumoAt: new Date('2026-09-08T19:59:59Z') },
    });
    expect(r.permitido).toBe(true);
  });
});

describe('máximo por día', () => {
  const limites = { maxPorDia: 2, minutosEntreConsumos: null };

  it('el primero y el segundo del día pasan', () => {
    expect(pedir({ limites, estado: VACIO }).permitido).toBe(true);
    expect(pedir({ limites, estado: { consumidosHoy: 1, ultimoConsumoAt: null } }).permitido).toBe(true);
  });

  it('el tercero no, y el mensaje dice cuándo volver', () => {
    const r = pedir({ limites, estado: { consumidosHoy: 2, ultimoConsumoAt: null } });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe('CUPO_DIARIO');
    expect(r.mensaje).toContain('2 cafés');
    expect(r.mensaje).toContain('mañana');
  });

  it('pedir 2 de golpe cuando solo queda 1 se rechaza entero', () => {
    // Media operación es peor que ninguna: el cajero entrega dos y se descuenta
    // uno, o al revés. Se rechaza y que lo pida por separado.
    const r = pedir({ limites, cantidad: 2, estado: { consumidosHoy: 1, ultimoConsumoAt: null } });
    expect(r.permitido).toBe(false);
    expect(r.mensaje).toContain('queda 1');
  });

  it('pedir 2 de golpe con el día entero libre sí pasa', () => {
    expect(pedir({ limites, cantidad: 2, estado: VACIO }).permitido).toBe(true);
  });

  it('usa la unidad del negocio, no la palabra «beneficio»', () => {
    const r = pedir({
      limites: { maxPorDia: 1, minutosEntreConsumos: null },
      estado: { consumidosHoy: 1, ultimoConsumoAt: null },
      unidad: 'lavada',
    });
    expect(r.mensaje).toContain('1 lavada');
  });
});

describe('espera entre usos', () => {
  const limites = { maxPorDia: null, minutosEntreConsumos: 60 };
  const ahora = new Date('2026-09-08T20:00:00Z');

  it('sin consumo previo, adelante', () => {
    expect(pedir({ limites, ahora, estado: VACIO }).permitido).toBe(true);
  });

  it('a los 59 minutos todavía no', () => {
    const r = pedir({
      limites,
      ahora,
      estado: { consumidosHoy: 1, ultimoConsumoAt: new Date('2026-09-08T19:01:00Z') },
    });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe('ESPERA');
    expect(r.mensaje).toContain('1 minuto');
    expect(r.disponibleEn?.toISOString()).toBe('2026-09-08T20:01:00.000Z');
  });

  it('justo al cumplirse la hora, sí', () => {
    const r = pedir({
      limites,
      ahora,
      estado: { consumidosHoy: 1, ultimoConsumoAt: new Date('2026-09-08T19:00:00Z') },
    });
    expect(r.permitido).toBe(true);
  });

  it('los tres consumos de DEMO CLUBIFY: el 2º y el 3º se habrían frenado', () => {
    const conEspera = { maxPorDia: null, minutosEntreConsumos: 30 };
    const segundo = pedir({
      limites: conEspera,
      ahora: new Date('2026-09-08T15:54:54Z'),
      estado: { consumidosHoy: 1, ultimoConsumoAt: new Date('2026-09-08T15:53:55Z') },
    });
    expect(segundo.permitido).toBe(false);
    expect(segundo.mensaje).toContain('30 minutos');
  });
});

describe('los dos límites a la vez: manda el que deja peor parado', () => {
  it('con el día agotado no se le promete una espera que no sirve', () => {
    const r = pedir({
      limites: { maxPorDia: 1, minutosEntreConsumos: 30 },
      estado: { consumidosHoy: 1, ultimoConsumoAt: new Date('2026-09-08T19:59:00Z') },
    });
    expect(r.motivo).toBe('CUPO_DIARIO');
    expect(r.mensaje).toContain('mañana');
  });

  it('con día libre pero recién usado, manda la espera', () => {
    const r = pedir({
      limites: { maxPorDia: 3, minutosEntreConsumos: 30 },
      estado: { consumidosHoy: 1, ultimoConsumoAt: new Date('2026-09-08T19:59:00Z') },
    });
    expect(r.motivo).toBe('ESPERA');
  });
});

describe('el día es el de Bogotá, no el de UTC', () => {
  it('un café de las 8 de la noche del 30 sigue siendo del día 30', () => {
    // 2026-09-30 20:00 en Bogotá = 2026-10-01 01:00 UTC. En UTC sería otro día
    // y otro cupo diario: el socio se llevaría el doble esa noche.
    expect(diaDe(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09-30');
  });

  it('y uno de las 6 de la mañana del 1 es del día 1', () => {
    expect(diaDe(new Date('2026-10-01T11:00:00Z'))).toBe('2026-10-01');
  });
});

describe('la espera, en palabras que se entienden', () => {
  it('redondea hacia arriba: mandarlo antes de tiempo es un segundo no', () => {
    expect(esperaEnPalabras(0.1)).toBe('1 minuto');
    expect(esperaEnPalabras(29.02)).toBe('30 minutos');
  });

  it('pasa a horas cuando toca', () => {
    expect(esperaEnPalabras(60)).toBe('1 hora');
    expect(esperaEnPalabras(135)).toBe('2 horas y 15 minutos');
    expect(esperaEnPalabras(121)).toBe('2 horas y 1 minuto');
  });
});

describe('lo que el negocio no puede guardar', () => {
  it('vacío es válido: es «sin límite»', () => {
    expect(errorDeLimites({ maxPorDia: null, minutosEntreConsumos: null }, 10)).toBeNull();
  });

  it('un tope diario mayor que el cupo del mes no limitaría nada', () => {
    expect(errorDeLimites({ maxPorDia: 11 }, 10)).toContain('cupo del mes');
    expect(errorDeLimites({ maxPorDia: 10 }, 10)).toBeNull();
  });

  it('cero, decimales y negativos se rechazan', () => {
    expect(errorDeLimites({ maxPorDia: 0 }, 10)).toContain('1 o más');
    expect(errorDeLimites({ maxPorDia: 1.5 }, 10)).toContain('entero');
    expect(errorDeLimites({ minutosEntreConsumos: -1 }, 10)).toContain('minutos');
  });

  it('más de 24 horas de espera le haría perder beneficios pagados', () => {
    expect(errorDeLimites({ minutosEntreConsumos: 1441 }, 10)).toContain('24 horas');
    expect(errorDeLimites({ minutosEntreConsumos: 1440 }, 10)).toBeNull();
  });
});

describe('el plural de la unidad, que lo lee un cliente', () => {
  it('las unidades que la gente escribe de verdad', () => {
    expect(pluralDe('café')).toBe('cafés'); // la ingenua daba «cafées»
    expect(pluralDe('lavada')).toBe('lavadas');
    expect(pluralDe('clase')).toBe('clases');
    expect(pluralDe('corte')).toBe('cortes');
    expect(pluralDe('masaje')).toBe('masajes');
    expect(pluralDe('menú')).toBe('menús');
    expect(pluralDe('sesión')).toBe('sesiones');
    expect(pluralDe('beneficio')).toBe('beneficios');
  });

  it('vacío cae en «beneficio», no en una cadena suelta', () => {
    expect(pluralDe('')).toBe('beneficios');
  });
});

describe('el arranque del dia, en UTC', () => {
  it('la medianoche de Bogota son las 05:00 UTC', () => {
    // Con el filtro puesto en medianoche UTC, los consumos de la tarde-noche
    // caerian en el dia siguiente y el tope diario dejaria pasar el doble.
    expect(inicioDelDia(new Date('2026-09-08T20:00:00Z')).toISOString()).toBe(
      '2026-09-08T05:00:00.000Z',
    );
  });

  it('a la 1 de la madrugada UTC seguimos en el dia anterior de Bogota', () => {
    expect(inicioDelDia(new Date('2026-10-01T01:00:00Z')).toISOString()).toBe(
      '2026-09-30T05:00:00.000Z',
    );
  });

  it('justo en la medianoche de Bogota, el dia arranca ahi mismo', () => {
    expect(inicioDelDia(new Date('2026-09-08T05:00:00Z')).toISOString()).toBe(
      '2026-09-08T05:00:00.000Z',
    );
  });
});
