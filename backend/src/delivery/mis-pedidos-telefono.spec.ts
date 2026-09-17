import { describe, it, expect, vi } from 'vitest';
import { DeliveryService } from './delivery.service';

/**
 * «Mis pedidos» encuentra al cliente aunque su teléfono se guardara con
 * espacios.
 *
 * EL BUG: la búsqueda comparaba los últimos dígitos que escribe el cliente con
 * el teléfono GUARDADO TAL CUAL (`endsWith`). El checkout lo guarda con el
 * prefijo separado —«+57 3150621706», «+56 912345678»— y la cola de dígitos
 * nunca casaba con una cadena que lleva un espacio en medio. Medido en
 * producción el 2026-09-17: 344 de 454 clientes con pedidos tienen separadores.
 *
 * La comparación es dígito contra dígito en la base, con la MISMA regla que el
 * chat (`telefonoDelPedidoCoincide`): al menos 8 dígitos y por la cola.
 */

const CLIENTES = [
  { id: 'chile', tenantId: 't1', phone: '+56 912345678' },
  { id: 'colombia', tenantId: 't1', phone: '+57 315 062 1706' },
  // Un número guardado corto: no puede «contener» la cola de otro.
  { id: 'corto', tenantId: 't1', phone: '21706' },
  { id: 'sin-telefono', tenantId: 't1', phone: null },
  // El mismo teléfono en OTRO negocio: nunca sale aquí.
  { id: 'otro-negocio', tenantId: 't2', phone: '+57 3150621706' },
];

const PEDIDOS = CLIENTES.map((c, i) => ({
  code: `P${i}`,
  tenantId: c.tenantId,
  customerId: c.id,
  customer: c,
  status: 'PENDING',
  fulfillment: 'PICKUP',
  mode: null,
  total: 1000,
  createdAt: new Date('2026-09-16T12:00:00Z'),
  deliveryAddress: null,
  delivery: null,
}));

const digitos = (s: string | null) => (s ?? '').replace(/\D/g, '');

function servicio() {
  const svc = Object.create(DeliveryService.prototype) as any;
  svc.prisma = {
    tenant: { findUnique: vi.fn(async () => ({ id: 't1', status: 'ACTIVE' })) },
    // Imita la consulta cruda: `regexp_replace(phone, '\D', '', 'g') LIKE '%' || cola`
    // acotada al negocio. Los valores llegan en el orden de la plantilla.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, tenantId: string, patron: string) => {
      const sql = strings.join('?');
      expect(sql).toContain('regexp_replace');
      // `\D` NO: en la plantilla de Prisma la barra se pierde y a Postgres le
      // llega `'D'`, que no quita nada. Pasó al probarlo contra la base real:
      // la consulta no encontraba a nadie. Este fake no ejecuta SQL, así que es
      // lo único que avisa si alguien lo «simplifica» de vuelta.
      expect(sql).not.toContain('\\D');
      expect(patron.startsWith('%')).toBe(true);
      const cola = patron.slice(1);
      return CLIENTES.filter(
        (c) => c.tenantId === tenantId && digitos(c.phone).endsWith(cola),
      ).map((c) => ({ id: c.id }));
    }),
    order: {
      findMany: vi.fn(async ({ where }: any) =>
        PEDIDOS.filter((o) => {
          if (o.tenantId !== where.tenantId) return false;
          if (where.customerId?.in) return where.customerId.in.includes(o.customerId);
          // Forma vieja: `customer: { phone: { endsWith } }` sobre el valor crudo.
          const fin = where.customer?.phone?.endsWith;
          if (fin !== undefined) return (o.customer.phone ?? '').endsWith(fin);
          return true;
        }),
      ),
    },
  };
  return svc as DeliveryService;
}

const codigos = (r: { orders: { code: string }[] }) => r.orders.map((o) => o.code).sort();

describe('«Mis pedidos» por teléfono', () => {
  it('encuentra «+56 912345678» cuando el cliente escribe 56912345678', async () => {
    const r = await servicio().listPublicByPhone('negocio', '56912345678');
    expect(codigos(r)).toEqual(['P0']);
  });

  it('encuentra «+57 315 062 1706» con los 10 dígitos del móvil', async () => {
    const r = await servicio().listPublicByPhone('negocio', '3150621706');
    expect(codigos(r)).toEqual(['P1']);
  });

  it('y con el número entero y formateado como lo escriba', async () => {
    const r = await servicio().listPublicByPhone('negocio', '+57 (315) 062-1706');
    expect(codigos(r)).toEqual(['P1']);
  });

  it('con menos de 8 dígitos no devuelve nada', async () => {
    const r = await servicio().listPublicByPhone('negocio', '0621706');
    expect(r.orders).toEqual([]);
  });

  it('un número guardado corto no casa con la cola de otro número', async () => {
    const r = await servicio().listPublicByPhone('negocio', '3150621706');
    expect(codigos(r)).not.toContain('P2');
  });

  it('no enseña pedidos de otro negocio con el mismo teléfono', async () => {
    const r = await servicio().listPublicByPhone('negocio', '3150621706');
    expect(codigos(r)).not.toContain('P4');
  });
});
