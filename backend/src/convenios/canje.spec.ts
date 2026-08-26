import { describe, it, expect } from 'vitest';

/**
 * Reglas del canje de convenio.
 *
 * Copias fieles de la lógica de `convenios-canje.service`; el módulo arrastra
 * NestJS y no se puede importar sin base de datos.
 *
 * Lo que no se puede romper:
 *   1. El descuento se calcula EN EL SERVIDOR. Si el cajero escribe el total,
 *      el sistema decide cuánto se descuenta — nunca al revés.
 *   2. Nunca descontar más que el total de la compra.
 *   3. El tope en pesos manda sobre el porcentaje.
 *   4. Un canje anulado no cuenta para nada.
 */

type Cupon = {
  tipo: string;
  valor: number;
  topeDescuento?: number | null;
};

function calcularDescuento(cupon: Cupon, compra: number | null): number | null {
  if (cupon.tipo === 'AMOUNT_OFF') {
    return compra != null ? Math.min(cupon.valor, compra) : cupon.valor;
  }
  if (cupon.tipo === 'PERCENT_OFF') {
    if (compra == null) return null;
    const bruto = Math.round((compra * cupon.valor) / 100);
    return cupon.topeDescuento != null
      ? Math.min(bruto, cupon.topeDescuento)
      : bruto;
  }
  return null;
}

describe('cuánto se descuenta', () => {
  it('un porcentaje sobre el total del tiquete', () => {
    expect(calcularDescuento({ tipo: 'PERCENT_OFF', valor: 10 }, 50_000)).toBe(5_000);
  });

  it('sin total escrito, el porcentaje no se puede calcular', () => {
    // Es exactamente el motivo por el que pedirle el monto al cajero vale la
    // pena: sin él, el informe cuenta canjes pero no pesos.
    expect(calcularDescuento({ tipo: 'PERCENT_OFF', valor: 10 }, null)).toBeNull();
  });

  it('el tope en pesos manda sobre el porcentaje', () => {
    // 10% de 900.000 son 90.000, pero el negocio puso techo de 20.000.
    const c = { tipo: 'PERCENT_OFF', valor: 10, topeDescuento: 20_000 };
    expect(calcularDescuento(c, 900_000)).toBe(20_000);
  });

  it('por debajo del techo, el techo no estorba', () => {
    const c = { tipo: 'PERCENT_OFF', valor: 10, topeDescuento: 20_000 };
    expect(calcularDescuento(c, 50_000)).toBe(5_000);
  });

  it('un monto fijo NUNCA descuenta más que la compra', () => {
    // Cupón de 10.000 sobre un café de 4.000: se descuentan 4.000, no 10.000.
    // Sin esto el negocio acabaría devolviendo dinero.
    expect(calcularDescuento({ tipo: 'AMOUNT_OFF', valor: 10_000 }, 4_000)).toBe(4_000);
  });

  it('un monto fijo sin total escrito se registra entero', () => {
    expect(calcularDescuento({ tipo: 'AMOUNT_OFF', valor: 10_000 }, null)).toBe(10_000);
  });

  it('producto gratis y 2x1 no tienen importe calculable', () => {
    expect(calcularDescuento({ tipo: 'FREEBIE', valor: 0 }, 50_000)).toBeNull();
    expect(calcularDescuento({ tipo: 'TWO_FOR_ONE', valor: 0 }, 50_000)).toBeNull();
  });

  it('redondea a pesos enteros — no existe medio peso', () => {
    // 7% de 33.333 = 2333,31
    expect(calcularDescuento({ tipo: 'PERCENT_OFF', valor: 7 }, 33_333)).toBe(2_333);
  });
});

/** El conteo para los topes: qué canjes cuentan. */
type Canje = { revertedAt: Date | null; createdAt: Date };

function cuentanParaElTope(canjes: Canje[], desde: Date | null): number {
  return canjes.filter(
    (c) => c.revertedAt == null && (desde == null || c.createdAt >= desde),
  ).length;
}

describe('qué canjes cuentan para el tope', () => {
  const d = (s: string) => new Date(s);

  it('un canje anulado NO cuenta', () => {
    const canjes = [
      { revertedAt: null, createdAt: d('2026-08-26T14:00:00Z') },
      { revertedAt: d('2026-08-26T14:05:00Z'), createdAt: d('2026-08-26T14:02:00Z') },
    ];
    expect(cuentanParaElTope(canjes, null)).toBe(1);
  });

  it('fuera de la ventana del período no cuenta', () => {
    const canjes = [
      { revertedAt: null, createdAt: d('2026-08-25T14:00:00Z') }, // ayer
      { revertedAt: null, createdAt: d('2026-08-26T14:00:00Z') }, // hoy
    ];
    const inicioDeHoy = d('2026-08-26T05:00:00Z'); // medianoche de Bogotá
    expect(cuentanParaElTope(canjes, inicioDeHoy)).toBe(1);
  });

  it('sin ventana se cuenta todo el historial', () => {
    const canjes = [
      { revertedAt: null, createdAt: d('2020-01-01T00:00:00Z') },
      { revertedAt: null, createdAt: d('2026-08-26T14:00:00Z') },
    ];
    expect(cuentanParaElTope(canjes, null)).toBe(2);
  });

  it('anulado Y fuera de ventana tampoco cuenta dos veces', () => {
    const canjes = [
      { revertedAt: d('2026-08-26T15:00:00Z'), createdAt: d('2026-08-26T14:00:00Z') },
    ];
    expect(cuentanParaElTope(canjes, d('2026-08-26T05:00:00Z'))).toBe(0);
  });
});

/** La ventana para anular en la caja. */
function sePuedeAnular(
  creado: Date,
  ahora: Date,
  minutos: number,
  esAdmin: boolean,
): boolean {
  if (esAdmin) return true;
  return (ahora.getTime() - creado.getTime()) / 60_000 <= minutos;
}

describe('anular un canje mal hecho', () => {
  const creado = new Date('2026-08-26T14:00:00Z');

  it('dentro de la ventana, sí', () => {
    const aLos5Minutos = new Date('2026-08-26T14:05:00Z');
    expect(sePuedeAnular(creado, aLos5Minutos, 10, false)).toBe(true);
  });

  it('pasada la ventana, no', () => {
    const alaHora = new Date('2026-08-26T15:00:00Z');
    expect(sePuedeAnular(creado, alaHora, 10, false)).toBe(false);
  });

  it('un administrador puede corregir un error viejo', () => {
    const alMesSiguiente = new Date('2026-09-26T14:00:00Z');
    expect(sePuedeAnular(creado, alMesSiguiente, 10, true)).toBe(true);
  });
});
