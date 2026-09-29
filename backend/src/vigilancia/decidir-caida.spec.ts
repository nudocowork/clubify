import { describe, it, expect } from 'vitest';
import { decidirCaida, mediana } from './decidir-caida';

/**
 * Lo que se prueba acá no es «detecta caídas»: eso es lo fácil. Es que NO
 * suene cuando no pasa nada, porque una alarma que suena de noche a diario se
 * aprende a ignorar, y entonces no sirve para el día que sí importa.
 */
describe('mediana', () => {
  it('no se deja arrastrar por un día de promoción', () => {
    // 400 en un día de promo: la media daría 82 y a partir de ahí un día
    // normal de 20 parecería una caída del 75%.
    const conPromo = [18, 20, 22, 19, 400];
    expect(mediana(conPromo)).toBe(20);
    const media = conPromo.reduce((a, b) => a + b, 0) / conPromo.length;
    expect(Math.round(media)).toBe(96);
  });

  it('con un número par de días promedia los dos del centro', () => {
    expect(mediana([10, 20, 30, 40])).toBe(25);
  });

  it('sin datos devuelve 0 en vez de reventar', () => {
    expect(mediana([])).toBe(0);
  });
});

describe('decidirCaida — lo que NO debe sonar', () => {
  it('una madrugada tranquila no es una caída', () => {
    // 4 de la mañana: lo normal es 0 o 1 pedido. Tener 0 es martes.
    const v = decidirCaida(0, [0, 1, 0, 0, 1, 0, 0], 3);
    expect(v.estado).toBe('sin-señal');
    expect(v.motivo).toMatch(/mínimo útil/);
  });

  it('un negocio recién estrenado no da base para opinar', () => {
    const v = decidirCaida(0, [40, 38], 3);
    expect(v.estado).toBe('sin-señal');
    expect(v.motivo).toMatch(/2 día\(s\) de historia/);
  });

  it('una hora flojita tampoco: 12 de 40 es poco, pero no es una caída', () => {
    const v = decidirCaida(12, [40, 38, 42, 39, 41, 40, 37], 3);
    expect(v.estado).toBe('sano');
  });

  it('un día de promoción no hace que el día siguiente parezca roto', () => {
    // Con la media (96) 20 pedidos serían el 21% -> falsa alarma.
    const v = decidirCaida(20, [18, 20, 22, 19, 400, 21, 19], 3);
    expect(v.estado).toBe('sano');
  });
});

describe('decidirCaida — lo que SÍ debe sonar', () => {
  it('cero pedidos un viernes a las 8 de la tarde', () => {
    const v = decidirCaida(0, [40, 38, 42, 39, 41, 40, 37], 3);
    expect(v.estado).toBe('caida');
    if (v.estado === 'caida') expect(v.gravedad).toBe('total');
    expect(v.motivo).toMatch(/lo normal a esta hora son 40/);
  });

  it('entran 2 de los 40 de siempre: una pasarela medio rota', () => {
    const v = decidirCaida(2, [40, 38, 42, 39, 41, 40, 37], 3);
    expect(v.estado).toBe('caida');
    if (v.estado === 'caida') expect(v.gravedad).toBe('fuerte');
  });

  it('justo en el filo del cuarto: 10 de 40 todavía no, 9 sí', () => {
    // Fijar el borde a propósito: si alguien mueve el 0.25 el test lo dice.
    expect(decidirCaida(10, [40, 40, 40, 40, 40, 40], 3).estado).toBe('sano');
    expect(decidirCaida(9, [40, 40, 40, 40, 40, 40], 3).estado).toBe('caida');
  });

  it('el motivo lleva los números, que es lo que hace útil el aviso', () => {
    const v = decidirCaida(0, [40, 40, 40, 40, 40, 40], 3);
    // Un aviso que solo dice «actividad baja» obliga a ir a mirar; este ya
    // trae con qué decidir si es grave sin abrir el panel.
    expect(v.motivo).toContain('0');
    expect(v.motivo).toContain('40');
  });
});
