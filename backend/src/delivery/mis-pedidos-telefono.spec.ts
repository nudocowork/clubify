import { describe, it, expect, vi } from 'vitest';
import { DeliveryService, colaDelTelefono, mismoTelefono } from './delivery.service';

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
  // El VECINO: comparte los últimos OCHO dígitos con «colombia»
  // (…50621706) pero no los diez. Existe porque la búsqueda pasó a hacerse
  // por ocho para que Panamá y Perú funcionen, así que el LIKE se lo trae
  // junto al bueno. Lo descarta el filtro fino, no la consulta.
  { id: 'vecino', tenantId: 't1', phone: '+57 325 062 1706' },
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
        // El SELECT real trae `id, phone`: el listado filtra fino con
        // `mismoTelefono` sobre ese phone, porque el LIKE busca por ocho
        // dígitos y puede traer al vecino que comparta la cola corta.
      ).map((c) => ({ id: c.id, phone: c.phone }));
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

/**
 * Panamá y Perú: el bug que dejaba a medio continente sin ver sus pedidos.
 *
 * La comparación tomaba los últimos DIEZ dígitos, que es el largo del móvil
 * colombiano. Para un panameño (ocho) esos diez se comían parte del prefijo
 * 507, y su número guardado sin prefijo no terminaba en eso nunca. Lo mismo en
 * Perú con nueve. Funcionaba en Colombia por casualidad del largo.
 */
describe('el vecino que comparte la cola corta NO ve mis pedidos', () => {
  it('buscar por ocho dígitos trae de más, y el filtro fino lo descarta', () => {
    // 3150621706 y 3250621706 terminan igual en ocho (…50621706) y difieren
    // en diez. Si el listado se quedara con lo que devuelve el LIKE, este
    // cliente vería los pedidos del otro. Es la fuga que abriría bajar la
    // búsqueda a ocho sin filtrar después.
    expect(mismoTelefono('+57 315 062 1706', '+57 325 062 1706')).toBe(false);
    expect(colaDelTelefono('+57 315 062 1706')).toBe(colaDelTelefono('+57 325 062 1706'));
  });
});

describe('mismoTelefono — el mismo número aunque uno lleve prefijo', () => {
  it('Panamá: móvil de 8 dígitos con y sin el +507', () => {
    expect(mismoTelefono('+507 6123-4567', '61234567')).toBe(true);
    expect(mismoTelefono('61234567', '+507 6123-4567')).toBe(true);
  });

  it('Perú: móvil de 9 dígitos con y sin el +51', () => {
    expect(mismoTelefono('+51 987 654 321', '987654321')).toBe(true);
  });

  it('Colombia sigue comparándose por sus diez dígitos enteros', () => {
    expect(mismoTelefono('+57 300 1234567', '3001234567')).toBe(true);
  });

  it('dos números distintos NO casan, aunque compartan la cola corta', () => {
    // Lo que protege de abrir la búsqueda a ocho dígitos: si los dos son
    // largos, se comparan los diez.
    expect(mismoTelefono('+57 300 1234567', '+57 311 1234567')).toBe(false);
    expect(mismoTelefono('3001234567', '3111234567')).toBe(false);
  });

  it('un número demasiado corto no es una llave: nunca casa', () => {
    expect(mismoTelefono('12345', '12345')).toBe(false);
    expect(mismoTelefono('', '3001234567')).toBe(false);
    expect(mismoTelefono(null, null)).toBe(false);
  });

  it('los separadores del checkout dan igual', () => {
    // El checkout guarda «+57 3150621706» con espacio: 344 de 454 clientes
    // tienen separadores.
    expect(mismoTelefono('+57 3150621706', '3150621706')).toBe(true);
    expect(mismoTelefono('(315) 062-1706', '3150621706')).toBe(true);
  });
});
