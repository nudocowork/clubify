import { describe, it, expect } from 'vitest';
import { PassesService } from './passes.service';

/**
 * Las puertas PÚBLICAS de la tarjeta que se abren con un teléfono.
 *
 * EL FALLO (arqueo 2026-09-17): «Mi tarjeta» buscaba `phone CONTAINS
 * últimos10` con solo 7 dígitos, y devolvía `passId`, serial, nombre y sellos
 * de TODA ficha cuyo número contuviera lo tecleado. Con siete cifras se
 * sacaban las tarjetas de otros; con el número de un cliente, también las de
 * cualquiera cuyo teléfono lo llevara dentro (otro país, otro prefijo).
 *
 * Y el alta pública (`POST /passes/enroll/:cardId`, con un `cardId` que va en
 * el QR del mostrador) le cambiaba el NOMBRE y el IDIOMA a la ficha que ya
 * existía con ese teléfono: cualquiera renombraba a un cliente ajeno.
 */

type Ficha = {
  id: string;
  phone: string;
  fullName: string;
  email?: string | null;
  birthday?: Date | null;
  locale?: string;
};

/** Devuelve solo las columnas pedidas, como Prisma: si el código olvida
 *  seleccionar `phone`, la prueba lo ve. */
function conSelect<T extends Record<string, unknown>>(fila: T, select?: Record<string, unknown>) {
  if (!select) return fila;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = fila[k];
  return out;
}

/** Filtro de teléfono de Prisma sobre el texto crudo, como hace Postgres. */
function casaTelefono(phone: string, f: any): boolean {
  if (typeof f === 'string') return phone === f;
  if (f?.contains !== undefined) return phone.includes(f.contains);
  if (f?.endsWith !== undefined) return phone.endsWith(f.endsWith);
  if (f?.equals !== undefined) return phone === f.equals;
  return true;
}

function montar(fichas: Ficha[]) {
  const actualizaciones: Array<{ id: string; data: Record<string, unknown> }> = [];
  const creadas: Ficha[] = [];
  const pasesCreados: string[] = [];
  const todas = () => [...fichas, ...creadas];
  const pases = () =>
    todas().map((c) => ({
      id: `pase-${c.id}`,
      tenantId: 't1',
      cardId: 'card-1',
      customerId: c.id,
      serialNumber: `CLB-${c.id}`,
      stampsCount: 4,
      pointsBalance: 0,
      status: 'ACTIVE',
      card: { id: 'card-1', name: 'Café', type: 'STAMPS', stampsRequired: 10, primaryColor: '#000', clubPlanId: null },
      customer: { id: c.id, fullName: c.fullName },
    }));
  const prisma: any = {
    tenant: {
      findUnique: async () => ({ id: 't1', slug: 'cafe' }),
    },
    customer: {
      findMany: async ({ where, select, take }: any) =>
        todas()
          .filter((c) => casaTelefono(c.phone, where.phone))
          .slice(0, take ?? Infinity)
          .map((c) => conSelect(c as any, select)),
      findFirst: async ({ where, select }: any) => {
        const c = todas().find((x) => casaTelefono(x.phone, where.phone));
        return c ? conSelect(c as any, select) : null;
      },
      findUnique: async ({ where }: any) =>
        todas().find((c) => c.phone === where.tenantId_phone?.phone) ?? null,
      create: async ({ data }: any) => {
        const nueva = { id: `nueva-${creadas.length + 1}`, ...data };
        creadas.push(nueva);
        return nueva;
      },
      update: async ({ where, data }: any) => {
        actualizaciones.push({ id: where.id, data });
        const c = todas().find((x) => x.id === where.id)!;
        return { ...c, ...data };
      },
    },
    pass: {
      findMany: async ({ where }: any) =>
        pases().filter((p) => where.customerId.in.includes(p.customerId)),
      // Solo las fichas del arranque tienen pase: las recién creadas no.
      findUnique: async ({ where }: any) => {
        const id = where.cardId_customerId?.customerId;
        return fichas.some((f) => f.id === id) ? { id: `pase-${id}` } : null;
      },
      create: async ({ data }: any) => {
        pasesCreados.push(data.customerId);
        return { id: `pase-nuevo-${data.customerId}` };
      },
    },
    clubMembresia: { findMany: async () => [] },
    card: {
      findUnique: async () => ({
        id: 'card-1',
        tenantId: 't1',
        name: 'Café',
        isActive: true,
        clubPlanId: null,
        convenioId: null,
        dataPolicyEnabled: false,
        tenant: { id: 't1', status: 'ACTIVE', dataPolicyUrl: null, whiteLabelId: null },
      }),
    },
  };
  const automations: any = { emit: async () => undefined };
  const brand: any = { resolveByWhiteLabelId: async () => ({ slug: 'clubify' }) };
  // El registro de auditoría es @Global() en la app; acá basta un doble que no
  // hace nada: estas pruebas son de la búsqueda por teléfono, no de auditoría.
  const auditoria: any = { log: async () => undefined };
  const srv = new PassesService(prisma, automations, {} as never, brand, auditoria);
  return { srv, actualizaciones, creadas, pasesCreados };
}

const ANA: Ficha = { id: 'ana', phone: '+573001112233', fullName: 'Ana Gómez', email: 'ana@correo.co', locale: 'es' };
// Otro país, mismas diez últimas cifras. `CONTAINS` la juntaba con Ana.
const OTRO_PAIS: Ficha = { id: 'otro', phone: '+5713001112233', fullName: 'Pedro Ruiz', locale: 'es' };

describe('«Mi tarjeta» por teléfono (GET /passes/lookup/by-phone)', () => {
  it('un número que CONTIENE el tecleado no es el mismo teléfono', async () => {
    const { srv } = montar([ANA, OTRO_PAIS]);
    const r = await srv.findByPhonePublic('cafe', '+57 3001112233');
    expect(r.passes.map((p) => p.customer.id)).toEqual(['ana']);
  });

  it('siete dígitos ya no sacan las tarjetas de nadie', async () => {
    const { srv } = montar([ANA, OTRO_PAIS]);
    const r = await srv.findByPhonePublic('cafe', '1112233');
    expect(r.passes).toEqual([]);
  });

  it('la ficha guardada sin prefijo sigue apareciendo al buscar con +57', async () => {
    const SIN_PREFIJO: Ficha = { id: 'luz', phone: '3104445566', fullName: 'Luz Mar' };
    const { srv } = montar([SIN_PREFIJO]);
    const r = await srv.findByPhonePublic('cafe', '+57 3104445566');
    expect(r.passes.map((p) => p.customer.id)).toEqual(['luz']);
  });
});

/**
 * Móviles de 8 y 9 dígitos. El selector de país del checkout ofrece Chile,
 * Perú, Ecuador y España (9) y hay clientes de Panamá y Bolivia (8). Con el
 * umbral de 10 del emparejador de Equipos de Ventas, una ficha guardada sin
 * indicativo dejaba de encontrar su tarjeta (revisión de Fable, 2026-09-17).
 */
describe('«Mi tarjeta» con móviles de menos de 10 dígitos', () => {
  const CHILE = { id: 'cl', phone: '912345678', fullName: 'Camila' };
  const PANAMA = { id: 'pa', phone: '+507 61234567', fullName: 'Hydor cliente' };

  it('Chile guardado sin indicativo aparece al buscar con +56', async () => {
    const { srv } = montar([CHILE]);
    const r = await srv.findByPhonePublic('cafe', '+56 912345678');
    expect(r.passes.map((p: any) => p.customerName ?? p.customer?.fullName ?? p.id)).toHaveLength(1);
  });

  it('Panamá guardado con +507 aparece al teclear sus 8 dígitos', async () => {
    const { srv } = montar([PANAMA]);
    const r = await srv.findByPhonePublic('cafe', '61234567');
    expect(r.passes).toHaveLength(1);
  });

  it('con 7 dígitos sigue sin buscarse', async () => {
    const { srv } = montar([PANAMA]);
    const r = await srv.findByPhonePublic('cafe', '1234567');
    expect(r.passes).toHaveLength(0);
  });
});

describe('alta pública de la tarjeta (POST /passes/enroll/:cardId)', () => {
  it('NO le cambia el nombre ni el idioma a una ficha que ya existía', async () => {
    const { srv, actualizaciones } = montar([ANA]);
    const r = await srv.enrollPublic('card-1', {
      fullName: 'Nombre Falso',
      phone: '+573001112233',
      locale: 'en',
    });
    expect(r.passId).toBe('pase-ana');
    const tocado = actualizaciones.flatMap((a) => Object.keys(a.data));
    expect(tocado).not.toContain('fullName');
    expect(tocado).not.toContain('locale');
  });

  it('sí rellena lo que faltaba: el nombre que era un teléfono y el correo vacío', async () => {
    const MOSTRADOR: Ficha = { id: 'mostrador', phone: '+573005556677', fullName: '3005556677', email: null, locale: 'es' };
    const { srv, actualizaciones } = montar([MOSTRADOR]);
    await srv.enrollPublic('card-1', {
      fullName: 'Marta Díaz',
      phone: '+573005556677',
      email: 'marta@correo.co',
    });
    const datos = Object.assign({}, ...actualizaciones.map((a) => a.data));
    expect(datos.fullName).toBe('Marta Díaz');
    expect(datos.email).toBe('marta@correo.co');
  });

  it('otro país con las mismas diez cifras NO se lleva la tarjeta de esa ficha', async () => {
    const { srv, pasesCreados } = montar([OTRO_PAIS]);
    const r = await srv.enrollPublic('card-1', {
      fullName: 'Ana Gómez',
      phone: '+573001112233',
    });
    expect(r.passId).not.toBe('pase-otro');
    expect(r.isNew).toBe(true);
    expect(pasesCreados).toHaveLength(1);
  });
});

describe('GET /passes/:id (panel)', () => {
  it('no devuelve en claro la clave de Grow Business del negocio', async () => {
    const CLAVE = 'pit-9f8e7d6c5b4a-SECRETA-1234';
    const prisma: any = {
      pass: {
        findUnique: async () => ({
          id: 'p1',
          tenantId: 't1',
          card: {},
          customer: {},
          tenant: { id: 't1', brandName: 'Café', growBusinessApiKey: CLAVE },
        }),
      },
    };
    const srv = new PassesService(prisma, {} as never, {} as never, {} as never, {} as never);
    const r: any = await srv.get({ id: 'u', role: 'TENANT_OWNER', tenantId: 't1' } as any, 'p1');
    expect(JSON.stringify(r)).not.toContain('SECRETA');
    // El panel sigue sabiendo que HAY clave.
    expect(r.tenant.growBusinessApiKey).toBeTruthy();
  });
});
