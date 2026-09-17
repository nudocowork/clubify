import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import {
  bdVacia,
  crearPrismaFalso,
  pase,
  tarjeta,
  type BaseDeDatos,
} from './stamps-prisma-falso';

/**
 * El script que reabre los pases que el canje dejó atascados en COMPLETED,
 * contra el SCRIPT REAL (`backend/scripts/reabrir-pases-canjeados.cjs`).
 *
 * Lo que no se puede romper: la simulación no escribe NADA; solo toca
 * STAMPS/VISITS por debajo de su tope; nunca un cupón (su COMPLETED es «usado»)
 * ni una tarjeta de club (su contador baja: «por debajo del tope» es normal);
 * y correrlo dos veces no hace nada la segunda.
 */

type Resultado = { total: number; porNegocio: Array<{ tenantId: string; pases: number }> };
type Script = { reabrir: (prisma: unknown, opts: { aplicar: boolean }) => Promise<Resultado> };

// createRequire y no `import`: es un .cjs fuera de `src`, y así el script se
// prueba tal cual se ejecuta, sin que el compilador lo arrastre al build.
const cargar = (): Script =>
  createRequire(path.join(process.cwd(), 'package.json'))(
    path.join(process.cwd(), 'scripts', 'reabrir-pases-canjeados.cjs'),
  ) as Script;

function produccionEnMiniatura(): BaseDeDatos {
  const bd = bdVacia();
  bd.tarjetas.push(
    tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }),
    tarjeta({ id: 'visitas', type: 'VISITS', visitsRequired: 5, tenantId: 't2' }),
    tarjeta({ id: 'club', type: 'STAMPS', stampsRequired: 10, clubPlanId: 'plan1' }),
    tarjeta({ id: 'alianza', type: 'STAMPS', stampsRequired: 1, convenioId: 'conv1' }),
    tarjeta({ id: 'cupon', type: 'COUPON', stampsRequired: 10 }),
    tarjeta({ id: 'sin-tope', type: 'STAMPS', stampsRequired: null }),
  );
  bd.pases.push(
    // Atascados: deben reabrirse.
    pase({ id: 'atascado-sellos', cardId: 'sellos', customerId: 'c1', stampsCount: 2, status: 'COMPLETED' }),
    pase({ id: 'atascado-visitas', cardId: 'visitas', tenantId: 't2', customerId: 'c2', visitsCount: 0, status: 'COMPLETED' }),
    // No se tocan.
    pase({ id: 'lleno', cardId: 'sellos', customerId: 'c3', stampsCount: 10, status: 'COMPLETED' }),
    pase({ id: 'activo', cardId: 'sellos', customerId: 'c4', stampsCount: 3 }),
    pase({ id: 'revocado', cardId: 'sellos', customerId: 'c5', stampsCount: 3, status: 'REVOKED' }),
    pase({ id: 'socio-club', cardId: 'club', customerId: 'c6', stampsCount: 4, status: 'COMPLETED' }),
    pase({ id: 'empleado', cardId: 'alianza', customerId: 'c7', stampsCount: 0, status: 'COMPLETED' }),
    pase({ id: 'cupon-usado', cardId: 'cupon', customerId: 'c8', status: 'COMPLETED' }),
    pase({ id: 'sin-tope', cardId: 'sin-tope', customerId: 'c9', stampsCount: 3, status: 'COMPLETED' }),
  );
  return bd;
}

const estados = (bd: BaseDeDatos) => Object.fromEntries(bd.pases.map((p) => [p.id, p.status]));

describe('reabrir-pases-canjeados', () => {
  it('simulación: cuenta los atascados por negocio y NO escribe nada', async () => {
    const bd = produccionEnMiniatura();
    const antes = estados(bd);
    const { prisma, registro } = crearPrismaFalso(bd);

    const r = await cargar().reabrir(prisma, { aplicar: false });

    expect(r.total).toBe(2);
    expect(r.porNegocio).toEqual(
      expect.arrayContaining([
        { tenantId: 't1', pases: 1 },
        { tenantId: 't2', pases: 1 },
      ]),
    );
    expect(estados(bd)).toEqual(antes);
    expect(registro.filter((x) => x.startsWith('pass.'))).toEqual([]);
  });

  it('--aplicar: reabre SOLO los de sellos/visitas bajo el tope', async () => {
    const bd = produccionEnMiniatura();
    const { prisma } = crearPrismaFalso(bd);

    const r = await cargar().reabrir(prisma, { aplicar: true });

    expect(r.total).toBe(2);
    expect(estados(bd)).toEqual({
      'atascado-sellos': 'ACTIVE',
      'atascado-visitas': 'ACTIVE',
      lleno: 'COMPLETED',
      activo: 'ACTIVE',
      revocado: 'REVOKED',
      'socio-club': 'COMPLETED',
      empleado: 'COMPLETED',
      'cupon-usado': 'COMPLETED',
      'sin-tope': 'COMPLETED',
    });
    // Solo el estado: ni contadores ni `lastActivityAt`, que usan las campañas
    // de inactividad y no debe moverse por un arreglo.
    expect(bd.pases.find((p) => p.id === 'atascado-sellos')).toMatchObject({
      stampsCount: 2,
      lastActivityAt: null,
    });
  });

  it('idempotente: la segunda pasada no encuentra nada', async () => {
    const bd = produccionEnMiniatura();
    const { prisma } = crearPrismaFalso(bd);
    const script = cargar();

    await script.reabrir(prisma, { aplicar: true });
    const segunda = await script.reabrir(prisma, { aplicar: true });

    expect(segunda.total).toBe(0);
  });
});
