import { describe, expect, it } from 'vitest';
import { exclusion, montoDudoso, motivoFuera, promedio, type NegocioCrudo } from './recompra-calculo';

const HOY = new Date('2026-11-13T12:00:00Z');
const fila = (unicos: number, recurrentes: number, visitas = unicos, diasEntre: number | null = 20) => ({
  unicos, recurrentes, visitas, diasEntre, ingresos: null, conMonto: 0,
});
const negocio = (o: Partial<NegocioCrudo> = {}): NegocioCrudo => ({
  id: 't1', nombre: 'Café', marca: 'Clubify', status: 'ACTIVE', currency: 'COP',
  alta: new Date('2026-01-01'), historico: fila(100, 20), ultimos90: fila(50, 15),
  medianaMonto: 15000, pctMontoBajo: 0, ...o,
});

describe('quién entra al promedio', () => {
  it('entra con 30+ clientes y 60+ días', () => {
    expect(motivoFuera(negocio(), null, HOY)).toBeNull();
  });
  it('fuera con menos de 30 clientes, aunque su recompra sea alta', () => {
    expect(motivoFuera(negocio({ historico: fila(29, 25) }), null, HOY)).toMatch(/30 clientes/);
  });
  it('fuera si lleva menos de 60 días', () => {
    expect(motivoFuera(negocio({ alta: new Date('2026-10-01') }), null, HOY)).toMatch(/60 días/);
  });
  it('fuera si está suspendido', () => {
    expect(motivoFuera(negocio({ status: 'SUSPENDED' }), null, HOY)).toMatch(/Suspendido/);
  });
  it('Momento queda fuera por sus sellos de prueba, no por tamaño', () => {
    const motivo = exclusion('Momento Café', 'momento-cafe');
    expect(motivo).toBeTruthy();
    expect(motivoFuera(negocio({ historico: fila(300, 290) }), motivo, HOY)).toBe(motivo);
    expect(exclusion('Amor Espresso', 'amor-espresso')).toBeNull();
  });
});

describe('montos dudosos', () => {
  it('pesos con mediana bajo 1.000 = el cajero no escribe el valor real', () => {
    expect(montoDudoso({ currency: 'COP', medianaMonto: 5, pctMontoBajo: 10 })).toBe(true);
  });
  it('en dólares un ticket de 8 es normal', () => {
    expect(montoDudoso({ currency: 'USD', medianaMonto: 8, pctMontoBajo: 0 })).toBe(false);
  });
  it('más del 30 % de montos bajos lo marca en cualquier moneda', () => {
    expect(montoDudoso({ currency: 'MXN', medianaMonto: 2000, pctMontoBajo: 31 })).toBe(true);
  });
});

describe('promedio por negocio', () => {
  it('cada negocio pesa igual, no cada cliente', () => {
    // 10 % de 1000 clientes y 50 % de 40 clientes → 30 %, no 11,5 %.
    expect(promedio([fila(1000, 100), fila(40, 20)]).recompra).toBe(30);
  });
  it('ignora negocios sin clientes en la ventana', () => {
    expect(promedio([fila(0, 0), fila(40, 10), null]).negocios).toBe(1);
  });
});
