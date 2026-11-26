import { describe, it, expect } from 'vitest';
import {
  avanceDeNivel,
  faltaMontoParaNivel,
  mensajeDeSubidaDeNivel,
  metricaDeNivel,
  nivelesDeLaTarjeta,
  nivelPara,
} from './nivel-vip';

const NIVELES = nivelesDeLaTarjeta([
  { name: 'Plata', threshold: 0, perks: [] },
  { name: 'Oro', threshold: 500000, perks: ['10 % de descuento', 'Bebida gratis'] },
  { name: 'Diamante', threshold: 2000000 },
]);

describe('nivelesDeLaTarjeta', () => {
  it('descarta filas sin nombre y limpia umbrales y beneficios', () => {
    const n = nivelesDeLaTarjeta([
      { name: '  Oro ', threshold: '100', perks: ['a', '', 3] },
      { name: '', threshold: 5 },
      null,
      { threshold: 9 },
    ]);
    expect(n).toEqual([{ name: 'Oro', threshold: 100, perks: ['a'] }]);
  });
  it('no es una lista → sin niveles', () => {
    expect(nivelesDeLaTarjeta(null)).toEqual([]);
    expect(nivelesDeLaTarjeta({})).toEqual([]);
  });
});

describe('metricaDeNivel', () => {
  it('sin métrica guardada es por gasto', () => {
    expect(metricaDeNivel(null)).toBe('spend');
    expect(metricaDeNivel('')).toBe('spend');
    expect(metricaDeNivel('visits')).toBe('visits');
    expect(metricaDeNivel('stamps')).toBe('stamps');
  });
});

describe('avanceDeNivel', () => {
  const base = { amount: 1, purchaseAmount: 80000, esRegalo: false };

  it('por gasto suma la COMPRA, no el cashback ganado', () => {
    // El defecto: CASHBACK_ADD con amount=4000 (5 %) sumaba 4000, no 80000.
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'CASHBACK_ADD', amount: 4000 })).toBe(80000);
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'POINTS_ADD', amount: 80 })).toBe(80000);
  });
  it('por gasto la VISIT con monto suma (antes sumaba cero)', () => {
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'VISIT' })).toBe(80000);
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'STAMP' })).toBe(80000);
  });
  it('por gasto: sin compra, regalo o acción que resta → no suma', () => {
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'VISIT', purchaseAmount: undefined })).toBe(0);
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'VISIT', esRegalo: true })).toBe(0);
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'CASHBACK_REDEEM' })).toBe(0);
    expect(avanceDeNivel({ ...base, metrica: 'spend', accion: 'REFUND' })).toBe(0);
  });
  it('visitas y sellos se comportan como siempre', () => {
    expect(avanceDeNivel({ ...base, metrica: 'visits', accion: 'VISIT' })).toBe(1);
    expect(avanceDeNivel({ ...base, metrica: 'visits', accion: 'STAMP', amount: 2 })).toBe(2);
    expect(avanceDeNivel({ ...base, metrica: 'visits', accion: 'CASHBACK_ADD' })).toBe(0);
    expect(avanceDeNivel({ ...base, metrica: 'stamps', accion: 'STAMP' })).toBe(1);
    expect(avanceDeNivel({ ...base, metrica: 'stamps', accion: 'VISIT' })).toBe(0);
  });
});

describe('faltaMontoParaNivel', () => {
  const base = {
    tipoDeTarjeta: 'MEMBERSHIP',
    hayNiveles: true,
    metrica: 'spend' as const,
    accion: 'VISIT',
    purchaseAmount: undefined as number | undefined,
    esRegalo: false,
    esSuperAdmin: false,
  };
  it('VIP por gasto sin monto → falta', () => {
    expect(faltaMontoParaNivel(base)).toBe(true);
    expect(faltaMontoParaNivel({ ...base, purchaseAmount: 0 })).toBe(true);
  });
  it('con monto, regalo o SUPER_ADMIN → no falta', () => {
    expect(faltaMontoParaNivel({ ...base, purchaseAmount: 1 })).toBe(false);
    expect(faltaMontoParaNivel({ ...base, esRegalo: true })).toBe(false);
    expect(faltaMontoParaNivel({ ...base, esSuperAdmin: true })).toBe(false);
  });
  it('por visitas, sin niveles u otro tipo de tarjeta → no se exige', () => {
    expect(faltaMontoParaNivel({ ...base, metrica: 'visits' })).toBe(false);
    expect(faltaMontoParaNivel({ ...base, hayNiveles: false })).toBe(false);
    expect(faltaMontoParaNivel({ ...base, tipoDeTarjeta: 'CASHBACK' })).toBe(false);
    expect(faltaMontoParaNivel({ ...base, accion: 'REDEEM' })).toBe(false);
  });
});

describe('nivelPara', () => {
  it('el más alto alcanzado', () => {
    expect(nivelPara(NIVELES, 0, null)).toBe('Plata');
    expect(nivelPara(NIVELES, 499999, 'Plata')).toBe('Plata');
    expect(nivelPara(NIVELES, 500000, 'Plata')).toBe('Oro');
    expect(nivelPara(NIVELES, 9e9, 'Oro')).toBe('Diamante');
  });
  it('sin alcanzar ninguno conserva el que tenía', () => {
    const sinBase = nivelesDeLaTarjeta([{ name: 'Oro', threshold: 100 }]);
    expect(nivelPara(sinBase, 50, null)).toBe(null);
    expect(nivelPara(sinBase, 50, 'Viejo')).toBe('Viejo');
  });
});

describe('mensajeDeSubidaDeNivel', () => {
  it('subir avisa con el nivel y sus beneficios', () => {
    expect(mensajeDeSubidaDeNivel(NIVELES, 'Plata', 'Oro')).toEqual({
      header: '¡Subiste de nivel!',
      body: 'Ahora eres Oro. 10 % de descuento · Bebida gratis',
    });
    expect(mensajeDeSubidaDeNivel(NIVELES, 'Oro', 'Diamante')).toEqual({
      header: '¡Subiste de nivel!',
      body: 'Ahora eres Diamante.',
    });
  });
  it('primer nivel (sin anterior) también avisa', () => {
    expect(mensajeDeSubidaDeNivel(NIVELES, null, 'Plata')?.header).toBe('¡Subiste de nivel!');
  });
  it('mismo nivel o bajada → no avisa', () => {
    expect(mensajeDeSubidaDeNivel(NIVELES, 'Oro', 'Oro')).toBeUndefined();
    expect(mensajeDeSubidaDeNivel(NIVELES, 'Diamante', 'Oro')).toBeUndefined();
    expect(mensajeDeSubidaDeNivel(NIVELES, 'Oro', null)).toBeUndefined();
  });
});
