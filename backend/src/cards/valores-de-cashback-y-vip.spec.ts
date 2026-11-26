import { describe, expect, it } from 'vitest';
import { compraMinima, metricaParaGuardar, nivelesParaGuardar, porcentajeDeCashback } from './valores-de-cashback-y-vip';

describe('valores de Cashback y VIP', () => {
  it('el % es un entero de 1 a 100', () => {
    expect(porcentajeDeCashback(7.5)).toBe(8);
    expect(porcentajeDeCashback(500)).toBe(100);
    expect(porcentajeDeCashback(0)).toBe(1);
    expect(porcentajeDeCashback('abc')).toBeNull();
    expect(porcentajeDeCashback(null)).toBeNull();
  });

  it('compra mínima: 0 o vacío es «sin mínimo»', () => {
    expect(compraMinima(0)).toBeNull();
    expect(compraMinima('')).toBeNull();
    expect(compraMinima(-5)).toBeNull();
    expect(compraMinima(30000)).toBe(30000);
  });

  it('niveles limpios, ordenados y acotados', () => {
    const r = nivelesParaGuardar([
      { name: ' Oro ', threshold: 600000.4, perks: ['10% en todo', '', 3], color: '#D4AF37', icon: '🥇' },
      { name: '', threshold: 100 },
      { name: 'Bronce', threshold: -5, color: 'rojo' },
      'basura',
    ]);
    expect(r).toEqual([
      { name: 'Bronce', threshold: 0, perks: [] },
      { name: 'Oro', threshold: 600000, perks: ['10% en todo'], color: '#D4AF37', icon: '🥇' },
    ]);
    expect(nivelesParaGuardar(Array.from({ length: 9 }, (_, i) => ({ name: `N${i}`, threshold: i })))).toHaveLength(6);
  });

  it('métrica desconocida = gasto', () => {
    expect(metricaParaGuardar('visits')).toBe('visits');
    expect(metricaParaGuardar('cualquiera')).toBe('spend');
  });
});
