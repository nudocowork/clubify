import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AppConfigService } from '../common/config/app-config.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AutomationsService } from '../automations/automations.service';
import type { CuponeraService } from '../cuponera/cuponera.service';
import type { ReservationsService } from '../reservations/reservations.service';
import type { ConveniosCanjeService } from '../convenios/convenios-canje.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ScannerService } from './scanner.service';
import { ClubService } from '../club/club.service';
import {
  bdVacia,
  crearBilletera,
  crearAutomatizaciones,
  crearPrismaFalso,
  type BaseDeDatos,
  type FilaTarjeta,
} from '../club/club-prisma-falso';

/**
 * El escáner tiene que saber a QUÉ familia pertenece la tarjeta que acaba de
 * leer y desviar a quien sabe atenderla: convenio, club, cupón o sellos.
 *
 * Estos tests llaman al SERVICIO REAL (`ScannerService.verifyQr`) contra el
 * Prisma falso de la Tarjeta de Club, y el club es también el servicio REAL
 * (`ClubService`). Así el caso «club sin membresía» prueba el error que sale
 * de producción, no una copia. Es la lección de Convenios: 31 tests verdes que
 * probaban una reimplementación dentro del propio fichero de test y no
 * protegían ni una línea de lo que corre.
 *
 * Lo único doblado es lo que NO se está probando aquí: convenios, cuponera y
 * reservas. De ellos solo interesa que el escáner los LLAME, no qué contestan.
 *
 * La afirmación que más importa y que se repite en casi todos: la consulta de
 * sellos (`prisma.stamp.findMany`) NO se llega a hacer cuando el pase es de
 * convenio o de club. Si alguien mueve el desvío por debajo de esa consulta,
 * una tarjeta de club empezaría a acumular sellos en vez de descontar cupo, y
 * `consultasDeSellos` lo delata.
 *
 * DEFECTO ABIERTO — `scanner.service.ts`, rama de convenio. La sede que se le
 * pasa a convenios sale de `(user as any).locationId`, y `AuthUser` NO tiene ese
 * campo: nada en `auth` lo pone y `POST /scanner/verify` solo recibe el
 * `qrToken`. Así que siempre llega `null`, y en `convenios-canje.service.ts`
 * la comprobación de sede está guardada tras `locationId &&`: un convenio
 * limitado a la sede A se canjea igual en la sede B. Aquí queda anclado el
 * `null` para que se vea; el arreglo es de la ventana de convenios.
 */

const CAJERO: AuthUser = {
  id: 'u-cajero',
  email: 'caja@negocio.com',
  role: 'TENANT_STAFF' as AuthUser['role'],
  tenantId: 't1',
};
const AJENO: AuthUser = {
  id: 'u-ajeno',
  email: 'dueno@otro.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't2',
};

const SECRETO = 'secreto-de-pruebas';

type Negocio = {
  id: string;
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  whiteLabel: { walletAdvanced: unknown } | null;
};

let bd: BaseDeDatos;
let negocios: Negocio[];
let sellos: Array<{ id: string; passId: string; createdAt: Date }>;
let consultasDeSellos: number;
let scanner: ScannerService;
let club: ClubService;

/**
 * Los tres módulos a los que el escáner DESVÍA. Aquí no se prueba qué
 * contestan —eso es de sus propios tests—, solo que se les llame a ellos y no
 * a otro. De ahí que sean dobles y el club no.
 */
function crearDobles() {
  return {
    convenios: {
      resolverParaCaja: vi.fn(async () => ({
        tipo: 'CONVENIO' as const,
        convenio: { id: 'cv1', nombre: 'Alianza Acme' },
        cupones: [] as unknown[],
      })),
    },
    cuponera: {
      // El tipo de retorno se declara ancho a propósito: por defecto contesta
      // `null` («no aplica»), y un test lo hace contestar para comprobar que
      // esa rama se come a las otras cuatro.
      scanMemberAsTenantAlly: vi.fn(
        async (): Promise<Record<string, unknown> | null> => null,
      ),
    },
    reservas: {
      handleScannedReservation: vi.fn(async () => ({ reserva: 'ok' })),
    },
  };
}
const espiarClub = (s: ClubService) => vi.spyOn(s, 'resolverParaCaja');

let dobles: ReturnType<typeof crearDobles>;
let espiaClub: ReturnType<typeof espiarClub>;

/** Proyección `select` de Prisma, con anidados (`whiteLabel: { select }`). */
function proyectarSel(fila: any, sel: any): any {
  if (fila == null) return null;
  if (!sel || sel === true) return { ...fila };
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sel)) {
    if (!v) continue;
    const sub = (v as any)?.select;
    salida[k] = sub ? proyectarSel(fila[k], sub) : fila[k];
  }
  return salida;
}

/**
 * El falso del club no modela las relaciones del pase (no las necesita). El
 * escáner sí las pide: `card`, `customer` y `tenant`. Se añaden aquí
 * ENVOLVIENDO las funciones del falso, sin tocar el fichero compartido.
 *
 * Estricto a propósito, igual que el falso original: si alguien quita
 * `card: true` del `passInclude` del escáner, `pass.card` llega undefined y
 * estos tests revientan — que es justo lo que pasaría en producción.
 */
function conRelacionesDelPase(prisma: any) {
  const original = {
    findUnique: prisma.pass.findUnique,
    findFirst: prisma.pass.findFirst,
  };
  const adjuntar = (fila: any, include: any) => {
    if (!fila || !include) return fila;
    if (include.card) {
      const c = bd.tarjetas.find((x) => x.id === fila.cardId);
      if (c) fila.card = { ...c };
    }
    if (include.customer) {
      const c = bd.clientes.find((x) => x.id === fila.customerId);
      if (c) fila.customer = { ...c };
    }
    if (include.tenant) {
      const t = negocios.find((x) => x.id === fila.tenantId);
      if (t) fila.tenant = proyectarSel(t, include.tenant?.select);
    }
    return fila;
  };
  prisma.pass.findUnique = async (args: any) =>
    adjuntar(await original.findUnique(args), args?.include);
  prisma.pass.findFirst = async (args: any) =>
    adjuntar(await original.findFirst(args), args?.include);
  prisma.stamp = {
    findMany: async ({ where, orderBy, take }: any) => {
      consultasDeSellos++;
      const lista = sellos.filter((s) => s.passId === where.passId);
      if (orderBy?.createdAt === 'desc') {
        lista.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return take ? lista.slice(0, take) : lista;
    },
  };
  return prisma;
}

/** Una tarjeta del negocio t1, con los desvíos apagados salvo lo que se pida. */
function tarjeta(
  id: string,
  extra: {
    type?: string;
    clubPlanId?: string | null;
    convenioId?: string | null;
  },
): FilaTarjeta {
  return {
    id,
    tenantId: 't1',
    clubPlanId: extra.clubPlanId ?? null,
    convenioId: extra.convenioId ?? null,
    name: id,
    type: extra.type ?? 'STAMPS',
    stampsRequired: 10,
    rewardText: 'Un café gratis',
    isActive: true,
  } as FilaTarjeta;
}

function pase(id: string, cardId: string, customerId: string, sufijo: string) {
  return {
    id,
    tenantId: 't1',
    cardId,
    customerId,
    serialNumber: 'CLB-' + sufijo,
    qrToken: 'QR-' + sufijo,
    authToken: 'auth-' + sufijo,
    stampsCount: 4,
    status: 'ACTIVE',
    lastActivityAt: null,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
  };
}

/**
 * Un negocio con las cuatro familias de tarjeta a la vez, más los dos casos
 * raros: la tarjeta con los dos desvíos puestos y el pase de club cuya
 * membresía no está o está pausada.
 */
function montar() {
  bd = bdVacia();
  negocios = [
    {
      id: 't1',
      brandName: 'Café Aurora',
      primaryColor: '#22C55E',
      logoUrl: null,
      // Apagado a propósito, y no `null`: `resolveWalletAdvanced` devuelve los
      // seis flags en true para cualquier entrada —incluida `undefined`—, así
      // que con `null` la aserción de abajo pasaría aunque el escáner no
      // llegara a leer la marca. Con un flag en false, sí distingue.
      whiteLabel: { walletAdvanced: { removeStamps: false } },
    },
  ];
  sellos = [
    { id: 's1', passId: 'pase-sellos', createdAt: new Date('2026-09-02') },
    { id: 's2', passId: 'pase-sellos', createdAt: new Date('2026-09-01') },
  ];
  consultasDeSellos = 0;

  bd.planes.push({
    id: 'plan1',
    tenantId: 't1',
    name: 'Café Diario',
    slug: 'cafe-diario',
    description: '',
    beneficiosPorMes: 10,
    unidad: 'café',
    precioCents: 60000,
    currency: 'COP',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Ana Ruiz' });
  bd.clientes.push({ id: 'cli2', tenantId: 't1', fullName: 'Beto Páez' });
  bd.clientes.push({ id: 'cli3', tenantId: 't1', fullName: 'Cami Soto' });

  bd.tarjetas.push(tarjeta('card-sellos', {}));
  bd.tarjetas.push(tarjeta('card-cupon', { type: 'COUPON' }));
  bd.tarjetas.push(tarjeta('card-club', { clubPlanId: 'plan1' }));
  bd.tarjetas.push(tarjeta('card-convenio', { convenioId: 'cv1' }));
  bd.tarjetas.push(
    tarjeta('card-ambas', { clubPlanId: 'plan1', convenioId: 'cv1' }),
  );

  bd.pases.push(pase('pase-sellos', 'card-sellos', 'cli1', 'SELLOS'));
  bd.pases.push(pase('pase-cupon', 'card-cupon', 'cli1', 'CUPON'));
  bd.pases.push(pase('pase-club', 'card-club', 'cli1', 'CLUB'));
  bd.pases.push(pase('pase-convenio', 'card-convenio', 'cli1', 'CONVENIO'));
  bd.pases.push(pase('pase-ambas', 'card-ambas', 'cli1', 'AMBAS'));
  // Mismo tipo de tarjeta de club, otro cliente: uno sin membresía ninguna y
  // otro con la membresía pausada (dejó de pagar).
  bd.pases.push(pase('pase-club-huerfano', 'card-club', 'cli2', 'HUERFANO'));
  bd.pases.push(pase('pase-club-pausado', 'card-club', 'cli3', 'PAUSADO'));

  bd.membresias.push({
    id: 'mem1',
    planId: 'plan1',
    customerId: 'cli1',
    passId: 'pase-club',
    status: 'ACTIVA',
    periodo: '2026-09',
    cupoDelPeriodo: 10,
    createdAt: new Date('2026-09-01'),
    pausedAt: null,
    updatedAt: new Date('2026-09-01'),
  });
  bd.membresias.push({
    id: 'mem3',
    planId: 'plan1',
    customerId: 'cli3',
    passId: 'pase-club-pausado',
    status: 'PAUSADA',
    periodo: '2026-09',
    cupoDelPeriodo: 10,
    createdAt: new Date('2026-09-01'),
    pausedAt: new Date('2026-09-10'),
    updatedAt: new Date('2026-09-10'),
  });

  const falso = crearPrismaFalso(bd);
  const prisma = conRelacionesDelPase(falso.prisma);
  const billetera = crearBilletera();

  club = new ClubService(
    prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    crearAutomatizaciones().automations as unknown as AutomationsService,
  );
  espiaClub = espiarClub(club);
  dobles = crearDobles();

  scanner = new ScannerService(
    dobles.cuponera as unknown as CuponeraService,
    prisma as unknown as PrismaService,
    { QR_HMAC_SECRET: SECRETO } as unknown as AppConfigService,
    dobles.reservas as unknown as ReservationsService,
    dobles.convenios as unknown as ConveniosCanjeService,
    club,
  );
}

beforeEach(() => montar());

describe('cada familia de tarjeta va a su rama', () => {
  it('sellos: el camino de siempre, con su historial', async () => {
    const r: any = await scanner.verifyQr(CAJERO, 'QR-SELLOS');
    expect(r.kind).toBe('sellos');
    expect(r.pass.id).toBe('pase-sellos');
    expect(r.recent).toHaveLength(2);
    expect(consultasDeSellos).toBe(1);
    // Los permisos de la marca viajan en el mismo payload y gatean el botón
    // «-1» de la caja. Si alguien quita `tenant` —o el `whiteLabel` anidado—
    // del `passInclude`, el flag vuelve a true por herencia y el botón
    // reaparece en un negocio cuya marca lo tiene apagado.
    expect(r.walletAdvanced.removeStamps).toBe(false);
    expect(r.walletAdvanced.showHistory).toBe(true);
    expect(dobles.convenios.resolverParaCaja).not.toHaveBeenCalled();
    expect(espiaClub).not.toHaveBeenCalled();
  });

  it('cupón: mismo payload que sellos pero `kind` lo separa', async () => {
    const r: any = await scanner.verifyQr(CAJERO, 'QR-CUPON');
    expect(r.kind).toBe('cupon');
    expect(r.pass.id).toBe('pase-cupon');
    expect(dobles.convenios.resolverParaCaja).not.toHaveBeenCalled();
    expect(espiaClub).not.toHaveBeenCalled();
  });

  it('club: resuelve el cupo y NI SE ASOMA a la tabla de sellos', async () => {
    const r: any = await scanner.verifyQr(CAJERO, 'QR-CLUB');
    expect(r.kind).toBe('club');
    // Se llamó al ClubService REAL, y con el pase que se acaba de leer: el
    // resto de las aserciones salen de que ese servicio consultó el falso.
    expect(espiaClub).toHaveBeenCalledWith(CAJERO, 'pase-club');
    expect(r.membresiaId).toBe('mem1');
    expect(r.plan).toBe('Café Diario');
    // El saldo NO sale de la membresía sino de `Pass.stampsCount` (4).
    expect(r.saldo).toBe(4);
    expect(r.puedeConsumir).toBe(true);
    // Lo que separa «descontar» de «acumular»: si esta consulta ocurriera, el
    // desvío estaría por debajo de los sellos.
    expect(consultasDeSellos).toBe(0);
    expect(r.pass).toBeUndefined();
    expect(dobles.convenios.resolverParaCaja).not.toHaveBeenCalled();
  });

  it('convenio: delega en el módulo de alianzas, sin tocar sellos', async () => {
    const r: any = await scanner.verifyQr(CAJERO, 'QR-CONVENIO');
    expect(r.kind).toBe('convenio');
    expect(r.tipo).toBe('CONVENIO');
    // La sede va SIEMPRE en null, y no porque este cajero no tenga: el
    // escáner la lee de `(user as any).locationId` y `AuthUser` no tiene ese
    // campo (ver DEFECTO en la cabecera de este fichero).
    expect(dobles.convenios.resolverParaCaja).toHaveBeenCalledWith(
      CAJERO,
      'pase-convenio',
      null,
    );
    expect(consultasDeSellos).toBe(0);
    expect(espiaClub).not.toHaveBeenCalled();
  });
});

describe('ninguna rama se traga a otra', () => {
  it('convenioId Y clubPlanId a la vez: gana convenio', async () => {
    // No debería existir una tarjeta así, pero si aparece, el escáner tiene
    // que elegir una sola y siempre la misma. Descontar cupo Y canjear
    // convenio con el mismo escaneo sería cobrarle dos veces al cliente.
    const r: any = await scanner.verifyQr(CAJERO, 'QR-AMBAS');
    expect(r.kind).toBe('convenio');
    expect(dobles.convenios.resolverParaCaja).toHaveBeenCalledTimes(1);
    expect(espiaClub).not.toHaveBeenCalled();
    expect(consultasDeSellos).toBe(0);
  });

  it('un pase de club de tipo COUPON sigue siendo club, no cupón', async () => {
    // El `kind === 'cupon'` se decide al final, por `card.type`. Si el desvío
    // del club se moviera detrás, esta tarjeta se leería como cupón de un solo
    // uso y el cupo mensual nunca se descontaría.
    bd.tarjetas.find((c) => c.id === 'card-club')!.type = 'COUPON';
    const r: any = await scanner.verifyQr(CAJERO, 'QR-CLUB');
    expect(r.kind).toBe('club');
    expect(consultasDeSellos).toBe(0);
  });

  it('el pase se resuelve igual por serial y el desvío sigue en pie', async () => {
    const r: any = await scanner.verifyQr(CAJERO, 'CLB-CLUB');
    expect(r.kind).toBe('club');
    expect(r.membresiaId).toBe('mem1');
  });

  it('el pase se resuelve igual por JWT legacy y el desvío sigue en pie', async () => {
    const jwt = sign({ pid: 'pase-convenio' }, SECRETO);
    const r: any = await scanner.verifyQr(CAJERO, jwt);
    expect(r.kind).toBe('convenio');
    expect(consultasDeSellos).toBe(0);
  });

  it('la guarda de tenant va ANTES de los cuatro desvíos', async () => {
    await expect(scanner.verifyQr(AJENO, 'QR-CONVENIO')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Se le preguntó a la cuponera ANTES de cerrar la puerta: el 403 es el
    // default y la excepción hay que ganársela, no al revés.
    expect(dobles.cuponera.scanMemberAsTenantAlly).toHaveBeenCalledTimes(1);
    expect(dobles.convenios.resolverParaCaja).not.toHaveBeenCalled();
    expect(espiaClub).not.toHaveBeenCalled();
    expect(consultasDeSellos).toBe(0);
  });

  it('aliado de cuponera: gana incluso a un pase de convenio', async () => {
    // Un negocio aliado escanea la tarjeta de OTRO negocio. Aunque esa tarjeta
    // tenga `convenioId`, el convenio es del negocio dueño del pase y el
    // aliado no tiene nada que canjear ahí: lo suyo es la cuponera.
    dobles.cuponera.scanMemberAsTenantAlly.mockResolvedValueOnce({
      socio: 'ok',
    });
    const r: any = await scanner.verifyQr(AJENO, 'QR-CONVENIO');
    expect(r).toEqual({ kind: 'cuponera', socio: 'ok' });
    expect(dobles.convenios.resolverParaCaja).not.toHaveBeenCalled();
    expect(espiaClub).not.toHaveBeenCalled();
    expect(consultasDeSellos).toBe(0);
  });

  it('SUPER_ADMIN ni se asoma a la cuponera y llega a su desvío', async () => {
    // Soporte mirando el pase de un negocio cualquiera: `tenantId` en null no
    // puede leerse como «es de otro negocio» y mandarlo por la rama de aliados.
    const soporte: AuthUser = {
      ...CAJERO,
      role: 'SUPER_ADMIN' as AuthUser['role'],
      tenantId: null,
    };
    const r: any = await scanner.verifyQr(soporte, 'QR-CLUB');
    expect(r.kind).toBe('club');
    expect(r.membresiaId).toBe('mem1');
    expect(dobles.cuponera.scanMemberAsTenantAlly).not.toHaveBeenCalled();
    expect(consultasDeSellos).toBe(0);
  });

  it('el QR de reserva ni llega a la resolución de pases', async () => {
    const r: any = await scanner.verifyQr(CAJERO, 'clubify-reservation:res-1');
    expect(r).toEqual({ reserva: 'ok' });
    expect(dobles.reservas.handleScannedReservation).toHaveBeenCalledWith(
      CAJERO,
      'res-1',
    );
    expect(consultasDeSellos).toBe(0);
  });
});

describe('club sin membresía viva: falla claro y NO cae a sellos', () => {
  it('sin membresía ninguna: 404 y NO se cae a sellos', async () => {
    await expect(
      scanner.verifyQr(CAJERO, 'QR-HUERFANO'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Lo que no puede pasar: que el fallo del club se convierta en «sumemos un
    // sello» y el cliente se lleve el beneficio por la puerta de atrás.
    expect(consultasDeSellos).toBe(0);
  });

  /**
   * El mensaje decía «Esta tarjeta no es de un club» — y la tarjeta SÍ es de
   * un club: tiene `clubPlanId`. Lo que falta es el socio. Al cajero le sonaba
   * a que el escáner estaba roto.
   *
   * No es hipotético: `ClubMembresia.pass` es `onDelete: SetNull`, así que
   * borrar y rehacer el pase de alguien deja su membresía sin `passId` y su
   * tarjeta ilegible en caja. Ahora el mensaje nombra al socio y dice la
   * salida: volver a darlo de alta.
   */
  it('sin socio: el mensaje lo dice, y dice qué hacer', async () => {
    await expect(scanner.verifyQr(CAJERO, 'QR-HUERFANO')).rejects.toThrow(
      /socio/i,
    );
    await expect(scanner.verifyQr(CAJERO, 'QR-HUERFANO')).rejects.toThrow(
      /dar(lo)? de alta/i,
    );
  });

  it('membresía PAUSADA: se resuelve como club y bloquea el consumo', async () => {
    const r: any = await scanner.verifyQr(CAJERO, 'QR-PAUSADO');
    expect(r.kind).toBe('club');
    expect(r.status).toBe('PAUSADA');
    expect(r.puedeConsumir).toBe(false);
    expect(consultasDeSellos).toBe(0);
  });

  it('saldo agotado: club con puedeConsumir en false, nunca sellos', async () => {
    bd.pases.find((p) => p.id === 'pase-club')!.stampsCount = 0;
    const r: any = await scanner.verifyQr(CAJERO, 'QR-CLUB');
    expect(r.kind).toBe('club');
    expect(r.saldo).toBe(0);
    expect(r.puedeConsumir).toBe(false);
    expect(consultasDeSellos).toBe(0);
  });
});
