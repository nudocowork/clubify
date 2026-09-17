import { describe, it, expect, vi } from 'vitest';
import { OrdersService } from './orders.service';

/**
 * Descontar stock no pierde unidades cuando entran dos pedidos a la vez.
 *
 * EL BUG: `decrementStock` leía el stock, restaba en memoria y escribía el
 * resultado. Dos pedidos simultáneos del mismo producto con 5 unidades leían
 * los dos «5» y escribían los dos «4»: se vendían dos y el inventario solo
 * bajaba una. Con el último en stock, los dos pedidos entraban y el producto
 * no se marcaba agotado.
 *
 * El arreglo resta en la propia base (`GREATEST(stock - n, 0)`), sin leer
 * antes. El `$executeRaw` falso de abajo hace lo mismo que ese UPDATE: resta
 * sobre lo que haya EN ESE MOMENTO, que es justo lo que garantiza Postgres.
 */

type Producto = { id: string; stock: number | null; isAvailable: boolean };

function montar(productos: Producto[]) {
  const porId = new Map(productos.map((p) => [p.id, p]));
  const prisma = {
    porId,
    product: {
      // Camino viejo: leer y escribir por separado.
      findUnique: vi.fn(async ({ where }: any) => {
        const p = porId.get(where.id);
        return p ? { ...p } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const p = porId.get(where.id)!;
        if (data.stock !== undefined) p.stock = data.stock;
        if (data.isAvailable !== undefined) p.isAvailable = data.isAvailable;
        return { ...p };
      }),
    },
    // Camino nuevo: un UPDATE que resta en la base. Valores en el orden de la
    // plantilla: (cantidad, cantidad, id).
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...valores: any[]) => {
      const sql = strings.join('?');
      expect(sql).toContain('GREATEST');
      const [cantidad, , id] = valores;
      const p = porId.get(id);
      if (!p || p.stock === null) return 0;
      const antes = p.stock;
      p.stock = Math.max(antes - cantidad, 0);
      if (antes - cantidad <= 0) p.isAvailable = false;
      return 1;
    }),
  };
  const svc = new OrdersService(
    prisma as any,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any, null as any,
  ) as any;
  return { svc, prisma };
}

describe('descontar stock', () => {
  it('dos pedidos a la vez del mismo producto descuentan los dos', async () => {
    const { svc, prisma } = montar([{ id: 'p1', stock: 5, isAvailable: true }]);
    await Promise.all([
      svc.decrementStock([{ productId: 'p1', qty: 1 }]),
      svc.decrementStock([{ productId: 'p1', qty: 1 }]),
    ]);
    expect(prisma.porId.get('p1')!.stock).toBe(3);
  });

  it('la última unidad pedida dos veces deja el producto agotado y en 0', async () => {
    const { svc, prisma } = montar([{ id: 'p1', stock: 1, isAvailable: true }]);
    await Promise.all([
      svc.decrementStock([{ productId: 'p1', qty: 1 }]),
      svc.decrementStock([{ productId: 'p1', qty: 1 }]),
    ]);
    expect(prisma.porId.get('p1')).toMatchObject({ stock: 0, isAvailable: false });
  });

  it('suma las líneas del mismo producto en un solo pedido', async () => {
    const { svc, prisma } = montar([{ id: 'p1', stock: 10, isAvailable: true }]);
    await svc.decrementStock([
      { productId: 'p1', qty: 2 },
      { productId: 'p1', qty: 3 },
    ]);
    expect(prisma.porId.get('p1')!.stock).toBe(5);
  });

  it('un producto sin control de inventario no se toca', async () => {
    const { svc, prisma } = montar([{ id: 'p1', stock: null, isAvailable: true }]);
    await svc.decrementStock([{ productId: 'p1', qty: 2 }]);
    expect(prisma.porId.get('p1')).toMatchObject({ stock: null, isAvailable: true });
  });
});
