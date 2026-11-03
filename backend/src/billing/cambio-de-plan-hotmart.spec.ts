import { describe, expect, it } from 'vitest';
import { esCambioDePlanHotmart } from './cambio-de-plan-hotmart';

const base = {
  codigoNuevo: 'A0B5A42Y',
  codigoAnterior: '8SDDLI3P',
  recurrencia: 1,
  periodicidadActual: 'TRIMESTRAL',
  periodicidadDelPago: 'MENSUAL',
  precioActual: null,
  precioDeLaOferta: 50,
};

describe('cambio de plan por Hotmart', () => {
  it('El Tiros: trimestral viejo, mensual nuevo con otra suscripción → cambia', () => {
    expect(esCambioDePlanHotmart(base)).toBe(true);
  });

  it('la renovación de la misma suscripción no cambia el plan', () => {
    expect(esCambioDePlanHotmart({ ...base, codigoNuevo: '8SDDLI3P' })).toBe(false);
  });

  it('la recurrencia 2 de una suscripción nueva ya no es el cambio', () => {
    expect(esCambioDePlanHotmart({ ...base, recurrencia: 2 })).toBe(false);
  });

  it('si no se sabe qué plan se pagó, no se adivina', () => {
    expect(esCambioDePlanHotmart({ ...base, periodicidadDelPago: null })).toBe(false);
  });

  it('primer pago del negocio (sin código anterior): lo resuelve el camino de siempre', () => {
    expect(esCambioDePlanHotmart({ ...base, codigoAnterior: null })).toBe(false);
  });

  it('volver a suscribirse al mismo plan (Fusion sushi) no es cambio', () => {
    expect(
      esCambioDePlanHotmart({
        ...base,
        periodicidadActual: 'TRIMESTRAL',
        periodicidadDelPago: 'TRIMESTRAL',
        precioDeLaOferta: null,
      }),
    ).toBe(false);
  });

  it('mismo periodo pero otro precio declarado (mensual 68 → básica 25) sí es cambio', () => {
    expect(
      esCambioDePlanHotmart({
        ...base,
        periodicidadActual: 'MENSUAL',
        periodicidadDelPago: 'MENSUAL',
        precioActual: null,
        precioDeLaOferta: 25,
      }),
    ).toBe(true);
  });
});
