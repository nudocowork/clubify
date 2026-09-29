import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Sedes del aliado (spec §5 y §9).
 *
 * El riesgo acá no es que no funcione, es que un aliado toque la sede de OTRO
 * adivinando el id. Por eso toda operación exige `allyBusinessId` junto al
 * `id`: se prueba que esa condición esté siempre.
 *
 * Actualizar va por `updateMany` (atómico, mira el `count`). Borrar NO puede:
 * antes de quitar la fila hay que quitar el punto de la tarjeta, y para eso
 * necesita el `tenantId`. Así que lee con `findFirst` acotado por las dos
 * claves y solo entonces borra por id. La condición se prueba sobre ese
 * `findFirst`, que es donde vive ahora el aislamiento.
 */
// El servicio navega `sede.ally.campaign.tenantId` para sincronizar el punto de
// la tarjeta. Un doble que devolviera solo `{ id }` reventaba con «Cannot read
// properties of undefined (reading 'campaign')», y los seis casos de
// aislamiento morían antes de comprobar nada.
const LA_SEDE = {
  id: 'loc-1',
  ally: { name: 'Aliado', status: 'APPROVED', campaign: { tenantId: 'tenant-1' } },
};

function make(count = 1) {
  const prisma = {
    allyLocation: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'loc-1', ...data })),
      updateMany: vi.fn().mockResolvedValue({ count }),
      deleteMany: vi.fn().mockResolvedValue({ count }),
      delete: vi.fn().mockResolvedValue({ id: 'loc-1' }),
      // count 0 = la sede no es de este aliado, así que findFirst no la ve.
      findFirst: vi.fn().mockResolvedValue(count === 0 ? null : LA_SEDE),
      findUnique: vi.fn().mockResolvedValue(count === 0 ? null : LA_SEDE),
    },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).getAllyForPortal = vi.fn().mockResolvedValue({ id: 'ally-mio' });
  // Este test vigila el aislamiento, no el punto de la tarjeta: sin estos
  // dobles cada caso arrastraría Wallet y push de verdad.
  (svc as any).syncAllyGeofence = vi.fn().mockResolvedValue(undefined);
  (svc as any).dropGeofence = vi.fn().mockResolvedValue(undefined);
  return { svc, prisma };
}
const user = { id: 'u1', allyBusinessId: 'ally-mio' } as any;

describe('sedes — aislamiento entre aliados', () => {
  it('listar scopea por el aliado de la sesión', async () => {
    const { svc, prisma } = make();
    await svc.listAllyLocations(user);
    expect(prisma.allyLocation.findMany.mock.calls[0][0].where).toEqual({
      allyBusinessId: 'ally-mio',
    });
  });

  it('crear cuelga la sede del aliado de la sesión, no de lo que venga en el body', async () => {
    const { svc, prisma } = make();
    await svc.createAllyLocation({ ...user }, { name: 'Cabecera', allyBusinessId: 'ally-ajeno' } as any);
    expect(prisma.allyLocation.create.mock.calls[0][0].data.allyBusinessId).toBe('ally-mio');
  });

  it('actualizar exige id Y allyBusinessId juntos', async () => {
    const { svc, prisma } = make();
    await svc.updateAllyLocation(user, 'loc-1', { city: 'Bucaramanga' });
    expect(prisma.allyLocation.updateMany.mock.calls[0][0].where).toEqual({
      id: 'loc-1',
      allyBusinessId: 'ally-mio',
    });
  });

  it('borrar exige id Y allyBusinessId juntos', async () => {
    const { svc, prisma } = make();
    await svc.deleteAllyLocation(user, 'loc-1');
    // El aislamiento vive en el findFirst: si no casan las dos claves no hay
    // sede, y salta el 404 antes de llegar al delete.
    expect(prisma.allyLocation.findFirst.mock.calls[0][0].where).toEqual({
      id: 'loc-1',
      allyBusinessId: 'ally-mio',
    });
  });

  it('tocar la sede de otro aliado da 404, no la modifica', async () => {
    const { svc } = make(0); // count 0 = no casó ninguna fila
    await expect(svc.updateAllyLocation(user, 'loc-ajena', { city: 'X' })).rejects.toThrow(
      /no encontrada/i,
    );
    await expect(svc.deleteAllyLocation(user, 'loc-ajena')).rejects.toThrow(/no encontrada/i);
  });
});

describe('sedes — validación', () => {
  it('la sede necesita nombre', async () => {
    const { svc } = make();
    await expect(svc.createAllyLocation(user, { name: '   ' })).rejects.toThrow(/nombre/i);
    await expect(svc.createAllyLocation(user, {})).rejects.toThrow(/nombre/i);
  });

  it('no deja activar geopush sin coordenadas: no dispararía nunca', async () => {
    const { svc } = make();
    await expect(
      svc.updateAllyLocation(user, 'loc-1', { geopushActive: true, latitude: null, longitude: null }),
    ).rejects.toThrow(/latitud y longitud/i);
  });

  it('sí deja activarlo cuando hay coordenadas', async () => {
    const { svc, prisma } = make();
    await svc.updateAllyLocation(user, 'loc-1', {
      geopushActive: true,
      latitude: 7.11,
      longitude: -73.12,
    });
    expect(prisma.allyLocation.updateMany.mock.calls[0][0].data.geopushActive).toBe(true);
  });

  it('solo escribe los campos que vinieron en el body', async () => {
    const { svc, prisma } = make();
    await svc.updateAllyLocation(user, 'loc-1', { city: 'Bucaramanga' });
    expect(Object.keys(prisma.allyLocation.updateMany.mock.calls[0][0].data)).toEqual(['city']);
  });
});
