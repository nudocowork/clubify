import { describe, it, expect } from 'vitest';
import { afiliadoQueVendio, nombreDelPlan, tipoDeIngreso } from './eventos';

describe('Sales Wall · reglas', () => {
  it('NUEVA es venta; RENOVACION y UPGRADE, renovación; lo demás no sale', () => {
    expect(tipoDeIngreso('NUEVA')).toBe('venta');
    expect(tipoDeIngreso('renovacion')).toBe('renovacion');
    expect(tipoDeIngreso('UPGRADE')).toBe('renovacion');
    expect(tipoDeIngreso('OTRO')).toBeNull();
    expect(tipoDeIngreso(null)).toBeNull();
  });

  it('vendió el vendedor antes que el embajador y el influencer', () => {
    expect(
      afiliadoQueVendio([
        { role: 'INFLUENCER', ownerName: 'Nicolas Quintero' },
        { role: 'VENDOR', ownerName: 'Samuel Navarro' },
        { role: 'AMBASSADOR', ownerName: 'Sara Plata' },
      ]),
    ).toBe('Samuel Navarro');
    expect(afiliadoQueVendio([{ role: 'INFLUENCER', ownerName: 'Nicolas Quintero' }])).toBe('Nicolas Quintero');
  });

  it('sin afiliado (o solo un socio), «Venta directa»', () => {
    expect(afiliadoQueVendio([])).toBe('Venta directa');
    expect(afiliadoQueVendio([{ role: 'SOCIO', ownerName: 'Javier' }])).toBe('Venta directa');
  });

  it('nombre del plan', () => {
    expect(nombreDelPlan('TRIMESTRAL', 150)).toBe('Plan Trimestral');
    expect(nombreDelPlan('MENSUAL', 25)).toBe('Mensualidad básica');
    expect(nombreDelPlan('MENSUAL', 68)).toBe('Plan Mensual');
    expect(nombreDelPlan(null, 50)).toBe('');
  });
});
