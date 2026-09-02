import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import { cupoDeAlta, errorDeTramos, type TramoAlta } from './club-periodo';
import {
  bdVacia,
  crearPrismaFalso,
  crearBilletera,
  type BaseDeDatos,
  type Ganchos,
} from './club-prisma-falso';

/**
 * El alta: planes, tramos de prorrateo y el primer cupo del cliente.
 *
 * Contra el servicio real. Lo que se persigue aquí es el dinero que se regala
 * sin querer: un tramo mal puesto, un hueco en la configuración o un doble
 * clic que duplique la membresía.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@negocio.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};
const OTRO_NEGOCIO: AuthUser = {
  id: 'u-ajeno',
  email: 'dueno@otro.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't2',
};
const SUPER: AuthUser = {
  id: 'u-super',
  email: 'super@soyclubify.com',
  role: 'SUPER_ADMIN' as AuthUser['role'],
  tenantId: null,
};

let bd: BaseDeDatos;
let ganchos: Ganchos;
let svc: ClubService;

function montar() {
  bd = bdVacia();
  bd.clientes.push(
    { id: 'cli1', tenantId: 't1', fullName: 'Ana Ruiz' },
    { id: 'cli2', tenantId: 't1', fullName: 'Beto Páez' },
    { id: 'ajeno', tenantId: 't2', fullName: 'Cliente de otro' },
  );
  const falso = crearPrismaFalso(bd);
  ganchos = falso.ganchos;
  const billetera = crearBilletera();
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
  );
}

/** Un plan ya guardado, saltándose el servicio, con los tramos que se pidan. */
function plan(tramos: TramoAlta[] = [], beneficiosPorMes = 10, isActive = true) {
  bd.planes.push({
    id: 'p1',
    tenantId: 't1',
    name: 'Café Diario',
    slug: 'cafe-diario',
    description: '',
    beneficiosPorMes,
    unidad: 'café',
    precioCents: 60000,
    currency: 'COP',
    isActive,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  tramos.forEach((t, i) =>
    bd.tramos.push({ id: `tr${i}`, planId: 'p1', ...t }),
  );
}

const enFecha = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  enFecha('2026-09-05T17:00:00Z'); // 5 de septiembre, mediodía en Bogotá
  montar();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('cuánto recibe quien se da de alta a mitad de mes', () => {
  const TRAMOS: TramoAlta[] = [
    { desdeDia: 1, hastaDia: 15, beneficios: 10 },
    { desdeDia: 16, hastaDia: 24, beneficios: 5 },
    { desdeDia: 25, hastaDia: 31, beneficios: 3 },
  ];

  it('el día 5 entra por el primer tramo: cupo entero', async () => {
    plan(TRAMOS);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(m).toMatchObject({ saldo: 10, cupoDelPeriodo: 10, periodo: '2026-09' });
  });

  it('el día 28 entra por el último: tres', async () => {
    plan(TRAMOS);
    enFecha('2026-09-28T17:00:00Z');
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(m).toMatchObject({ saldo: 3, cupoDelPeriodo: 3 });
  });

  it('un solo tramo para todo el mes vale para cualquier día', async () => {
    plan([{ desdeDia: 1, hastaDia: 31, beneficios: 4 }]);
    for (const dia of ['01', '17', '30']) {
      montar();
      plan([{ desdeDia: 1, hastaDia: 31, beneficios: 4 }]);
      enFecha(`2026-09-${dia}T17:00:00Z`);
      const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
      expect(m.saldo).toBe(4);
    }
  });

  it('un tramo de cero: el cliente paga y este mes no recibe nada', async () => {
    // Es configurable a propósito ("del 25 en adelante no damos nada"), pero
    // conviene ver el efecto entero: no puede consumir, y el mes que viene
    // recibe el cupo completo.
    plan([{ desdeDia: 25, hastaDia: 31, beneficios: 0 }]);
    enFecha('2026-09-28T17:00:00Z');
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(m).toMatchObject({ saldo: 0, cupoDelPeriodo: 0 });

    // El alta ya le crea el pase con el cupo dentro (antes no lo creaba nadie
    // y había que simularlo aquí). Se usa el suyo, que es el que mira el
    // reinicio del mes siguiente.
    const suPase = bd.membresias[0].passId!;
    const vista = await svc.resolverParaCaja(DUENO, suPase);
    expect(vista.puedeConsumir).toBe(false);
    expect(vista.saldo).toBe(0);
    await expect(svc.consumir(DUENO, m.id, 1)).rejects.toThrow(
      ConflictException,
    );

    enFecha('2026-10-02T17:00:00Z');
    await svc.reiniciarCupos();
    expect(bd.pases.find((x) => x.id === suPase)!.stampsCount).toBe(10);
  });

  it('sin tramos configurados todo el mundo recibe el cupo entero', async () => {
    plan([]);
    enFecha('2026-09-30T17:00:00Z');
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(m.saldo).toBe(10);
  });

  it('un tramo que promete más que el plan queda acotado al plan', async () => {
    plan([{ desdeDia: 1, hastaDia: 31, beneficios: 999 }]);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(m.saldo).toBe(10);
  });
});

describe('los huecos de la configuración se pagan con cupo regalado', () => {
  it('un día sin tramo recibe el cupo entero, más que el tramo de al lado', async () => {
    // Decisión escrita en `club-periodo.ts`: mejor regalar que dejar en cero a
    // quien pagó. El efecto raro se ve aquí: el del día 20 recibe 5 y el del
    // 26 —que no cae en ningún tramo— recibe 10.
    plan([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 25, beneficios: 5 },
    ]);
    enFecha('2026-09-20T17:00:00Z');
    expect((await svc.darDeAlta(DUENO, 'p1', 'cli1')).saldo).toBe(5);
    enFecha('2026-09-26T17:00:00Z');
    expect((await svc.darDeAlta(DUENO, 'p1', 'cli2')).saldo).toBe(10);
  });

  it('los tramos que se quedan en el 30 dejan al 31 sin cubrir, y nadie avisa', async () => {
    // TRAMPA REAL: el negocio piensa "el mes tiene 30 días" y configura hasta
    // el 30. En enero, marzo, mayo, julio, agosto, octubre y diciembre existe
    // el 31, y ese día se regala el cupo entero. `errorDeTramos` no dice nada.
    const tramos: TramoAlta[] = [
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 30, beneficios: 5 },
    ];
    expect(errorDeTramos(tramos)).toBeNull(); // el validador lo acepta
    expect(cupoDeAlta(30, 10, tramos)).toBe(5);
    expect(cupoDeAlta(31, 10, tramos)).toBe(10); // el 31 cobra doble

    plan(tramos);
    enFecha('2026-10-31T17:00:00Z');
    expect((await svc.darDeAlta(DUENO, 'p1', 'cli1')).saldo).toBe(10);
  });

  it('un tramo 31-31 nunca se aplica en los meses de 30 días', async () => {
    // El día 31 no existe en septiembre: quien entre el 30 cae en el tramo
    // anterior, no en éste.
    plan([
      { desdeDia: 1, hastaDia: 30, beneficios: 5 },
      { desdeDia: 31, hastaDia: 31, beneficios: 1 },
    ]);
    enFecha('2026-09-30T17:00:00Z');
    expect((await svc.darDeAlta(DUENO, 'p1', 'cli1')).saldo).toBe(5);
  });

  it('un día imposible no revienta: devuelve el cupo entero', () => {
    expect(cupoDeAlta(0, 10, [{ desdeDia: 1, hastaDia: 31, beneficios: 2 }])).toBe(10);
    expect(cupoDeAlta(32, 10, [{ desdeDia: 1, hastaDia: 31, beneficios: 2 }])).toBe(10);
  });

  it('si dos tramos se pisaran igualmente, manda el de día más bajo', () => {
    // El validador los rechaza al guardar, pero pueden quedar filas viejas de
    // antes de la validación. El servicio los pide `orderBy desdeDia asc`, así
    // que el resultado es estable y no depende del orden del planificador.
    const solapados: TramoAlta[] = [
      { desdeDia: 1, hastaDia: 20, beneficios: 10 },
      { desdeDia: 10, hastaDia: 31, beneficios: 2 },
    ];
    expect(cupoDeAlta(15, 10, solapados)).toBe(10);
  });
});

describe('editar los tramos con gente ya dentro', () => {
  it('a quien ya está dado de alta no le cambia el saldo', async () => {
    plan([{ desdeDia: 1, hastaDia: 15, beneficios: 10 }]);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(m.saldo).toBe(10);

    await svc.actualizarPlan(DUENO, 'p1', {
      tramos: [{ desdeDia: 1, hastaDia: 15, beneficios: 2 }],
    });
    expect(bd.pases[0].stampsCount).toBe(10); // intacto

    // Pero el siguiente que entre hoy ya recibe lo nuevo.
    const otro = await svc.darDeAlta(DUENO, 'p1', 'cli2');
    expect(otro.saldo).toBe(2);
  });

  it('los tramos se reemplazan enteros, no se acumulan', async () => {
    plan([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 31, beneficios: 5 },
    ]);
    await svc.actualizarPlan(DUENO, 'p1', {
      tramos: [{ desdeDia: 1, hastaDia: 31, beneficios: 7 }],
    });
    expect(bd.tramos).toHaveLength(1);
    enFecha('2026-09-20T17:00:00Z');
    expect((await svc.darDeAlta(DUENO, 'p1', 'cli1')).saldo).toBe(7);
  });

  it('mandar una lista vacía borra los tramos y vuelve al cupo entero', async () => {
    plan([{ desdeDia: 1, hastaDia: 31, beneficios: 3 }]);
    await svc.actualizarPlan(DUENO, 'p1', { tramos: [] });
    expect(bd.tramos).toHaveLength(0);
    expect((await svc.darDeAlta(DUENO, 'p1', 'cli1')).saldo).toBe(10);
  });

  it('unos tramos inválidos NO borran los que ya funcionaban', async () => {
    // La validación va antes de la transacción. Si fuera al revés, un error de
    // dedo dejaría el plan sin tramos y todo el mundo cobrando el mes entero.
    plan([{ desdeDia: 1, hastaDia: 15, beneficios: 10 }]);
    await expect(
      svc.actualizarPlan(DUENO, 'p1', {
        tramos: [
          { desdeDia: 1, hastaDia: 20, beneficios: 10 },
          { desdeDia: 10, hastaDia: 31, beneficios: 5 },
        ],
      }),
    ).rejects.toThrow(/se pisan/);
    expect(bd.tramos).toHaveLength(1);
    expect(bd.tramos[0].beneficios).toBe(10);
  });

  it('no se puede editar el plan de otro negocio', async () => {
    plan([]);
    await expect(
      svc.actualizarPlan(OTRO_NEGOCIO, 'p1', { beneficiosPorMes: 500 }),
    ).rejects.toThrow(NotFoundException);
    expect(bd.planes[0].beneficiosPorMes).toBe(10);
  });
});

describe('dar de alta a un cliente', () => {
  it('el doble clic devuelve la misma membresía, no dos', async () => {
    plan([]);
    const a = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const b = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(b.id).toBe(a.id);
    expect(bd.membresias).toHaveLength(1);
    expect(bd.pases[0].stampsCount).toBe(10); // no 20
  });

  it('dos altas simultáneas: la que pierde el índice único devuelve la otra', async () => {
    // El índice [planId, customerId] es la red de verdad. Se fuerza que las dos
    // comprueben "¿ya existe?" antes de que ninguna haya insertado.
    plan([]);
    let soltar!: () => void;
    const enEspera = new Promise<void>((r) => (soltar = r));
    ganchos.antesDeCrearMembresia = () => enEspera;

    const uno = svc.darDeAlta(DUENO, 'p1', 'cli1');
    await Promise.resolve();
    const dos = svc.darDeAlta(DUENO, 'p1', 'cli1');
    await new Promise((r) => process.nextTick(r));
    soltar();

    const [a, b] = await Promise.all([uno, dos]);
    expect(a.id).toBe(b.id);
    expect(bd.membresias).toHaveLength(1);
    expect(bd.pases[0].stampsCount).toBe(10);
  });

  it('el saldo del alta ya descuenta lo consumido si vuelve a pulsar', async () => {
    plan([]);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(DUENO, m.id, 4);
    const repetida = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(repetida.saldo).toBe(6); // devuelve la real, no una nueva llena
  });

  it('un plan apagado no admite altas', async () => {
    plan([], 10, false);
    await expect(svc.darDeAlta(DUENO, 'p1', 'cli1')).rejects.toThrow(
      'El plan está apagado.',
    );
    expect(bd.membresias).toHaveLength(0);
  });

  it('un cliente de otro negocio no se puede colar en este plan', async () => {
    plan([]);
    await expect(svc.darDeAlta(DUENO, 'p1', 'ajeno')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('el dueño de otro negocio no puede dar de alta en este plan', async () => {
    plan([]);
    await expect(svc.darDeAlta(OTRO_NEGOCIO, 'p1', 'cli1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('un SUPER_ADMIN sin negocio indicado no opera a ciegas', async () => {
    plan([]);
    await expect(svc.darDeAlta(SUPER, 'p1', 'cli1')).rejects.toThrow(
      'Sin negocio asociado.',
    );
  });

  it('un SUPER_ADMIN con el negocio indicado sí', async () => {
    plan([]);
    const m = await svc.darDeAlta(SUPER, 'p1', 'cli1', 't1');
    expect(m.saldo).toBe(10);
  });
});

describe('crear planes', () => {
  it('el nombre se convierte en un slug sin tildes ni emojis', async () => {
    const p = await svc.crearPlan(DUENO, {
      name: '  Café Diario ☕ ',
      beneficiosPorMes: 10,
    });
    expect(p.slug).toBe('cafe-diario');
    expect(p.name).toBe('Café Diario ☕'); // el nombre visible conserva el suyo
  });

  it('un nombre que no deja letras no se queda sin slug', async () => {
    // Antes se usaba `plan-${Date.now()}`. Se cambió a un slug estable con
    // sufijo sólo si choca: un timestamp hace que dos entornos con los mismos
    // datos den URLs distintas, y la del negocio cambiaba según la hora del
    // alta. El primero se lleva «plan» a secas.
    const p = await svc.crearPlan(DUENO, { name: '☕☕☕', beneficiosPorMes: 3 });
    expect(p.slug).toBe('plan');
    const q = await svc.crearPlan(DUENO, { name: '🍰🍰', beneficiosPorMes: 3 });
    expect(q.slug).toBe('plan-2');
  });

  it('el slug no pasa de 40 caracteres', async () => {
    const p = await svc.crearPlan(DUENO, {
      name: 'Plan de cafés y jugos para los clientes más fieles del centro',
      beneficiosPorMes: 3,
    });
    expect(p.slug.length).toBeLessThanOrEqual(40);
  });

  it('el cupo tiene que ser un entero de 1 en adelante', async () => {
    for (const malo of [0, -3, 1.5, NaN]) {
      await expect(
        svc.crearPlan(DUENO, { name: 'X', beneficiosPorMes: malo }),
      ).rejects.toThrow(BadRequestException);
    }
    expect(bd.planes).toHaveLength(0);
  });

  it('sin nombre no hay plan', async () => {
    await expect(
      svc.crearPlan(DUENO, { name: '   ', beneficiosPorMes: 5 }),
    ).rejects.toThrow('Falta el nombre del plan.');
  });

  it('los tramos se validan antes de guardar nada', async () => {
    await expect(
      svc.crearPlan(DUENO, {
        name: 'Con tramos malos',
        beneficiosPorMes: 5,
        tramos: [{ desdeDia: 20, hastaDia: 5, beneficios: 1 }],
      }),
    ).rejects.toThrow(/empieza después/);
    expect(bd.planes).toHaveLength(0);
    expect(bd.tramos).toHaveLength(0);
  });

  it('los tramos se guardan junto con el plan', async () => {
    const p = await svc.crearPlan(DUENO, {
      name: 'Con tramos',
      beneficiosPorMes: 5,
      tramos: [
        { desdeDia: 16, hastaDia: 31, beneficios: 2 },
        { desdeDia: 1, hastaDia: 15, beneficios: 5 },
      ],
    });
    expect(p.tramos).toHaveLength(2);
    // Ojo: `crearPlan` los devuelve con `include: { tramos: true }`, SIN
    // `orderBy` — o sea en el orden que le dé la base. Todas las demás rutas
    // (listar, actualizar, alta) los piden ordenados por día. Si la pantalla
    // del negocio pinta lo que devuelve el POST, se ven en un orden y tras
    // recargar en otro.
    const lista = await svc.listarPlanes(DUENO);
    expect(
      lista[0].tramos.map((t: { desdeDia: number }) => t.desdeDia),
    ).toEqual([1, 16]);
  });

  it('los planes se listan con sus miembros activos y pausados', async () => {
    plan([]);
    await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const m2 = await svc.darDeAlta(DUENO, 'p1', 'cli2');
    await svc.cambiarEstado(DUENO, m2.id, 'PAUSADA');

    const lista = await svc.listarPlanes(DUENO);
    expect(lista[0]).toMatchObject({ miembrosActivos: 1, miembrosPausados: 1 });
  });

  it('el listado de un negocio no cuenta miembros de otro', async () => {
    plan([]);
    await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const lista = await svc.listarPlanes(OTRO_NEGOCIO);
    expect(lista).toHaveLength(0);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * FALLOS ENCONTRADOS — estos tests están EN ROJO a propósito.
 * Describen lo que debería pasar, no lo que pasa hoy.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('FALLO — un cliente cancelado no puede volver nunca al club', () => {
  it('volver a darlo de alta debería devolverlo al club', async () => {
    // `darDeAlta` devuelve la membresía existente sin mirar su estado, y
    // `cambiarEstado` se niega a reactivar una CANCELADA. Entre las dos dejan
    // al cliente fuera para siempre: la única salida hoy es borrar la fila a
    // mano en la base.
    plan([]);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.cambiarEstado(DUENO, m.id, 'CANCELADA');

    const vuelta = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(vuelta.status).toBe('ACTIVA');
    expect(vuelta.saldo).toBe(10);
  });
});

describe('dos planes con el mismo nombre no revientan', () => {
  it('el segundo entra con sufijo, no con un 500', async () => {
    // El slug sale del nombre y `[tenantId, slug]` es único, así que un doble
    // clic en «Crear plan» subía el P2002 crudo hasta el filtro de Nest: 500 y
    // a Sentry, sin decirle al negocio qué hacer.
    //
    // Se resolvió con sufijo en vez de con un error. Un negocio puede querer
    // dos planes «Café» de verdad (uno de 10 y otro de 30), y hacerle inventar
    // un nombre distinto sólo para que la URL no choque es pedirle que cargue
    // con un detalle nuestro.
    const a = await svc.crearPlan(DUENO, { name: 'Café', beneficiosPorMes: 10 });
    const b = await svc.crearPlan(DUENO, { name: 'Café', beneficiosPorMes: 30 });
    expect(a.slug).toBe('cafe');
    expect(b.slug).toBe('cafe-2');
    expect(b.name).toBe('Café');
  });
});
