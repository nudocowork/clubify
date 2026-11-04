import { describe, expect, it, vi } from 'vitest';
import { cobroQueComisiona, esPrimerPagoConAbono, revisarConsistencia } from './consistencia-del-dinero';

/**
 * Revisión diaria del 2026-11-04: de 12 avisos, 10 eran cosas que estaban
 * bien. Un aviso que se equivoca todos los días se deja de leer, y entonces
 * se pierde el que importa (ese día, Romanos: dos comisiones y un cobro).
 */
describe('consistencia del dinero: lo que NO es una inconsistencia', () => {
  it('plan con abono: comisión sobre el plan completo, ingreso por el restante', () => {
    expect(esPrimerPagoConAbono(500, 480)).toBe(true); // Alquimia
    expect(esPrimerPagoConAbono(150, 130)).toBe(true); // Chillin, Las Ricuras
    expect(esPrimerPagoConAbono(68, 48)).toBe(true); // Paicoat
    expect(esPrimerPagoConAbono(278, 258)).toBe(true);
  });

  it('una diferencia que no es la del abono sigue siendo un aviso', () => {
    expect(esPrimerPagoConAbono(150, 68)).toBe(false); // comisión de grupo contra un ingreso suelto
    expect(esPrimerPagoConAbono(52.24, 50)).toBe(false); // Macondo: cambio de moneda, real
    expect(esPrimerPagoConAbono(500, 460)).toBe(false);
  });

  it('servicio adicional y venta directa no comisionan; un afiliado de verdad sí', () => {
    expect(cobroQueComisiona('OTRO', ['TAFMPWK5'])).toBe(false); // Altieri, Paquete de Alianzas
    expect(cobroQueComisiona('RENOVACION', ['VENTA_DIRECTA'])).toBe(false); // El Tiros
    expect(cobroQueComisiona('RENOVACION', ['TAFMPWK5'])).toBe(true);
    expect(cobroQueComisiona('NUEVA', ['VENTA_DIRECTA', 'TAFMPWK5'])).toBe(true);
  });
});

describe('consistencia del dinero: abono fuera de Contabilidad', () => {
  const vacio = {
    incomeRecord: { findMany: vi.fn(async () => []) },
    commission: { findMany: vi.fn(async () => []) },
    referralUse: { findMany: vi.fn(async () => []) },
    businessGroup: { findMany: vi.fn(async () => []) },
    tenant: { findMany: vi.fn(async () => []) },
    setting: { findUnique: vi.fn(async () => null) },
    whiteLabel: { findFirst: vi.fn(async () => ({ id: 'clubify' })), findUnique: vi.fn(async () => ({ id: 'clubify' })) },
  };

  it('avisa del abono «En revisión»', async () => {
    const prisma = {
      ...vacio,
      $queryRawUnsafe: vi.fn(async () => [
        { tx: 'HP2182632665', brandName: 'Paicoat', grossUsd: '20.9', saleDate: new Date('2026-09-17T14:36:27Z') },
      ]),
    };
    const lista = await revisarConsistencia(prisma, new Date('2026-11-04T13:00:00Z'));
    expect(lista).toContainEqual({ tipo: 'ABONO_FUERA_DEL_LIBRO', quien: 'Paicoat', detalle: '$20.9 del 2026-09-17' });
  });

  it('si esa consulta falla, el resto de la revisión sale igual', async () => {
    const prisma = { ...vacio, $queryRawUnsafe: vi.fn(async () => { throw new Error('caída'); }) };
    await expect(revisarConsistencia(prisma, new Date('2026-11-04T13:00:00Z'))).resolves.toEqual([]);
  });
});
