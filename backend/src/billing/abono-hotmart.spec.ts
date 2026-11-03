import { describe, expect, it } from 'vitest';
import { esOfertaDeAbono, ingresoDelPagoConAbono, ofertaConAbono } from './abono-hotmart';

describe('planes con abono de Hotmart', () => {
  it('el primer pago del trimestral con abono se contabiliza por 130, no por 150', () => {
    expect(ingresoDelPagoConAbono('iqbgp4fq', '1')).toBe(130);
    expect(ingresoDelPagoConAbono('IQBGP4FQ', 1)).toBe(130);
  });

  it('sin número de recurrencia se toma como primer pago', () => {
    expect(ingresoDelPagoConAbono('n8e031ty', undefined)).toBe(48);
  });

  it('las recurrencias vuelven al camino normal (precio del plan)', () => {
    expect(ingresoDelPagoConAbono('kkczwdkt', '2')).toBeNull();
  });

  it('una oferta normal no es de abono', () => {
    expect(ingresoDelPagoConAbono('5xge6zhd', '1')).toBeNull();
    expect(ofertaConAbono('04u23bz7')).toBeNull();
  });

  it('el plan completo sigue siendo la base del closer', () => {
    expect(ofertaConAbono('52fe5ax7')).toMatchObject({ primerPagoUsd: 258, precioDelPlanUsd: 278 });
  });

  it('reconoce la oferta del abono de 20', () => {
    expect(esOfertaDeAbono('9veek0a9')).toBe(true);
    expect(esOfertaDeAbono('ticqog5c')).toBe(false);
  });
});
