import { describe, it, expect } from 'vitest';
import { CuponeraService } from './cuponera.service';

/**
 * «Mi tarjeta» y «Mis sellos» de la Cuponera por teléfono. Mismo fallo que la
 * tienda (ver `passes/busqueda-por-telefono.spec.ts`): `CONTAINS` con siete
 * dígitos devolvía el `passId` de cualquiera cuyo número llevara esas cifras.
 */

function montar(fichas: Array<{ id: string; phone: string; fullName: string }>) {
  const conSelect = (fila: any, select?: any) => {
    if (!select) return fila;
    const out: any = {};
    for (const k of Object.keys(select)) if (select[k]) out[k] = fila[k];
    return out;
  };
  const prisma: any = {
    benefitCampaign: { findUnique: async () => ({ id: 'camp', tenantId: 'sys' }) },
    customer: {
      findMany: async ({ where, select }: any) =>
        fichas
          .filter((c) =>
            where.phone?.contains !== undefined
              ? c.phone.includes(where.phone.contains)
              : where.phone?.endsWith !== undefined
                ? c.phone.endsWith(where.phone.endsWith)
                : true,
          )
          .map((c) => conSelect(c, select)),
    },
    pass: {
      findMany: async ({ where }: any) =>
        fichas
          .filter((c) => where.customerId.in.includes(c.id))
          .map((c) => ({ id: `pase-${c.id}`, serialNumber: `CLB-${c.id}`, customer: { fullName: c.fullName } })),
    },
    stampProgram: { findMany: async () => [{ id: 'prog', name: 'Café', rewardText: 'Gratis', stampsRequired: 10 }] },
    stampCard: {
      findMany: async ({ where }: any) =>
        where.customerId.in.map((id: string) => ({ programId: 'prog', customerId: id, stampsCount: id === 'ana' ? 3 : 9 })),
    },
  };
  return new CuponeraService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never);
}

const ANA = { id: 'ana', phone: '+573001112233', fullName: 'Ana Gómez' };
// Lleva las diez cifras de Ana DENTRO, pero es otro número (una cifra más).
const OTRO = { id: 'otro', phone: '+5730011122334', fullName: 'Pedro Ruiz' };
// Mismas diez cifras finales, otro país.
const EEUU = { id: 'eeuu', phone: '+13001112233', fullName: 'John Doe' };

describe('Cuponera: tarjeta por teléfono', () => {
  it('un número que contiene el tecleado no devuelve la tarjeta de otro', async () => {
    const r = await montar([ANA, OTRO]).findCardByPhone('3001112233');
    expect(r.passes.map((p) => p.id)).toEqual(['pase-ana']);
  });

  it('con el prefijo de país, otro país con las mismas cifras no casa', async () => {
    const r = await montar([ANA, EEUU]).findCardByPhone('+57 300 111 2233');
    expect(r.passes.map((p) => p.id)).toEqual(['pase-ana']);
  });

  it('siete dígitos no bastan', async () => {
    const r = await montar([ANA, OTRO]).findCardByPhone('1112233');
    expect(r.passes).toEqual([]);
  });

  it('«Mis sellos» tampoco enseña los sellos de otro', async () => {
    const r = await montar([EEUU]).stampsByPhone('+57 3001112233');
    // Sin ficha propia no hay sellos que enseñar: nunca los 9 de Pedro.
    expect(r.programs.some((p) => p.stampsCount === 9)).toBe(false);
  });
});
