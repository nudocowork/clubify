import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import {
  bdVacia,
  crearPrismaFalso,
  crearBilletera,
  crearAutomatizaciones,
  respirar,
  type BaseDeDatos,
  type Ganchos,
} from './club-prisma-falso';

/**
 * El mostrador de una cafetería un sábado a tope.
 *
 * Esto NO es una revisión de código: es usar el servicio REAL como lo usaría
 * un cajero con prisa —pulsar dos veces, cobrar tres cafés cuando quedan dos,
 * equivocarse de Ana, cobrar a las 23:50 del 30 y otra vez a las 00:10 del 1—
 * y mirar qué se rompe o qué se pierde.
 *
 * Los `it.fails` son fugas encontradas jugando, no deseos: describen lo que
 * DEBERÍA pasar y hoy no pasa. No los borres para poner el CI en verde;
 * arregla el servicio o bórralos con una decisión escrita en la bitácora.
 *
 * Dos de las fugas que salieron aquí —el informe del mes sumando las líneas
 * anuladas, y la caja pintándole el cupo entero al socio pausado— se
 * corrigieron el 2026-09-02 mientras se escribía esto, así que sus tests están
 * en verde y lo que hacen ahora es sujetar el arreglo.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@cafeteria.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};
/** El de la caja. En el controlador solo llega a `caja/*`. */
const CAJERO: AuthUser = {
  id: 'u-cajero',
  email: 'caja@cafeteria.com',
  role: 'TENANT_STAFF' as AuthUser['role'],
  tenantId: 't1',
};

let bd: BaseDeDatos;
let ganchos: Ganchos;
let svc: ClubService;
let empujados: Array<{ passId: string; motivo: string }>;
let emitidos: Array<{ evento: string; datos: any }>;

/**
 * Abre la cafetería: un plan de 10 cafés al mes y dos clientas que se llaman
 * casi igual —Ana Ruiz y Ana Rojas—, que es como el cajero se equivoca.
 *
 * Con `socio: false` no hay ni tarjeta ni pase ni membresía: los crea el
 * propio `darDeAlta`, que es lo que pasa la primera vez.
 */
function abrirElNegocio(
  opciones: {
    saldo?: number;
    periodo?: string;
    socio?: boolean;
    tramos?: Array<{ desdeDia: number; hastaDia: number; beneficios: number }>;
  } = {},
) {
  const {
    saldo: conSaldo = 10,
    periodo = '2026-09',
    socio = true,
    tramos = [],
  } = opciones;

  bd = bdVacia();
  bd.planes.push({
    id: 'p1',
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
  tramos.forEach((t, i) =>
    bd.tramos.push({ id: `tr${i}`, planId: 'p1', ...t }),
  );
  bd.clientes.push({
    id: 'cli1',
    tenantId: 't1',
    fullName: 'Ana Ruiz',
    phone: '3001112233',
  });
  bd.clientes.push({
    id: 'cli2',
    tenantId: 't1',
    fullName: 'Ana Rojas',
    phone: '3009998877',
  });

  if (socio) {
    bd.tarjetas.push({
      id: 'card1',
      tenantId: 't1',
      clubPlanId: 'p1',
      name: 'Café Diario',
      type: 'STAMPS',
      stampsRequired: 10,
      rewardText: '10 café al mes',
      isActive: true,
    });
    bd.pases.push({
      id: 'pass1',
      tenantId: 't1',
      cardId: 'card1',
      customerId: 'cli1',
      serialNumber: 'CLB-ANA',
      qrToken: 'qr-ana',
      authToken: 'auth-ana',
      stampsCount: conSaldo,
      status: 'ACTIVE',
      lastActivityAt: null,
      createdAt: new Date('2026-09-01'),
      updatedAt: new Date('2026-09-01'),
    });
    bd.membresias.push({
      id: 'm1',
      planId: 'p1',
      customerId: 'cli1',
      passId: 'pass1',
      status: 'ACTIVA',
      periodo,
      cupoDelPeriodo: 10,
      createdAt: new Date('2026-09-01'),
      pausedAt: null,
      updatedAt: new Date('2026-09-01'),
    });
  }

  const falso = crearPrismaFalso(bd);
  const billetera = crearBilletera();
  const autos = crearAutomatizaciones();
  ganchos = falso.ganchos;
  empujados = billetera.empujados;
  emitidos = autos.emitidos;
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    autos.automations as unknown as AutomationsService,
  );
}

const socio = () => bd.membresias[0];
/** El saldo vivo de Ana Ruiz. Está en el pase, no en la membresía. */
const saldo = () => bd.pases.find((p) => p.customerId === 'cli1')!.stampsCount;
/** Cafés que salieron por la barra, contando líneas anuladas. */
const servidos = () => bd.consumos.reduce((t, c) => t + c.cantidad, 0);
const bienvenidas = () => emitidos.filter((e) => e.evento === 'PASS_CREATED');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Sábado 5 de septiembre, mediodía en Bogotá.
  vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));
  abrirElNegocio();
});
afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────
// 1. El doble toque
// ─────────────────────────────────────────────────────────────────────────

describe('el doble toque: la pantalla tarda y el cajero vuelve a pulsar', () => {
  it('dos toques seguidos cobran DOS cafés, y es a propósito', async () => {
    // La secuencia real: el cajero pulsa, el wifi del local va lento, no ve
    // respuesta y pulsa otra vez. `consumir` no tiene ventana de repetición
    // —ni clave de idempotencia en el DTO, ni «ya cobraste a este socio hace
    // dos segundos»—, así que el segundo toque es un cobro nuevo y el cliente
    // se lleva 9 cafés de los 10 que pagó.
    //
    // Es una decisión tomada, no un descuido, y este test la sostiene: dos
    // cafés PEDIDOS seguidos —la mesa que pide uno, se lo lleva, y vuelve por
    // el segundo— se ven exactamente igual que el doble toque. Una ventana de
    // «descarta lo igual a lo anterior» se comería ese caso, que es normal en
    // un mostrador. Si alguien añade esa ventana, este test se pone rojo antes
    // de que el negocio deje de poder cobrar dos cafés seguidos.
    //
    // Lo que sí protege al cliente está en el test de abajo y en la pantalla:
    // el botón se desactiva mientras la petición está en vuelo.
    await svc.consumir(CAJERO, 'm1', 1);
    await svc.consumir(CAJERO, 'm1', 1);

    expect(servidos()).toBe(2);
    expect(saldo()).toBe(8);
  });

  it('el candado del descuento no es lo que frena el doble cobro', async () => {
    // Conviene tenerlo escrito para no confiarse: `stampsCount: { gte: N }`
    // impide bajar de cero, NO cobrar dos veces cuando sí hay saldo. Con 10 en
    // la tarjeta las dos peticiones simultáneas son válidas y las dos pasan.
    // La defensa contra el doble envío es el `setBusy` de la pantalla del
    // escáner; una red que reintente, o dos pestañas, se la saltan.
    await Promise.all([
      svc.consumir(CAJERO, 'm1', 1),
      svc.consumir(CAJERO, 'm1', 1),
    ]);
    expect(saldo()).toBe(8);
  });

  it('lo que salva al cliente hoy es que el cajero deshaga el toque de más', async () => {
    // Ésta es la única red que existe, y hay que conservarla: si el cajero se
    // da cuenta, deshacer devuelve el café y deshacerlo dos veces no le regala
    // otro. La pantalla del escáner solo guarda el ÚLTIMO consumo y solo
    // mientras la tarjeta siga en pantalla; si el cliente ya se fue, desde la
    // caja no se le devuelve nada.
    const primero = await svc.consumir(CAJERO, 'm1', 1);
    const repetido = await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(8);

    const r = await svc.anularConsumo(CAJERO, repetido.consumoId);
    expect(r).toMatchObject({ devuelto: 1, saldo: 9 });

    await expect(svc.anularConsumo(CAJERO, repetido.consumoId)).rejects.toThrow(
      ConflictException,
    );
    expect(saldo()).toBe(9);
    // Y el primero, el bueno, sigue en pie.
    expect(
      bd.consumos.find((c) => c.id === primero.consumoId)?.revertedAt,
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Dos cajas a la vez
// ─────────────────────────────────────────────────────────────────────────

describe('dos cajas: el sábado hay dos cajeros escaneando', () => {
  it('el mismo socio con UN café en dos cajas: solo uno se lo lleva', async () => {
    // Se fuerza el orden que rompe al código ingenuo: la caja A queda retenida
    // DENTRO del descuento mientras B completa el suyo entero. Con un
    // `if (saldo > 0) saldo--` los dos pasarían el `if` y el negocio serviría
    // dos cafés cobrando uno.
    abrirElNegocio({ saldo: 1 });
    let soltarA!: () => void;
    const aEnEspera = new Promise<void>((r) => (soltarA = r));
    ganchos.antesDeDescontar = () => aEnEspera;

    const cajaA = svc.consumir(CAJERO, 'm1', 1);
    const cajaB = svc.consumir(CAJERO, 'm1', 1);
    await respirar();
    soltarA();

    const r = await Promise.allSettled([cajaA, cajaB]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(saldo()).toBe(0); // nunca -1
    expect(servidos()).toBe(1);
  });

  it('al cajero que pierde se le dice cuántos quedan, no un error del sistema', async () => {
    // En el mostrador, «error 500» y «no le quedan» son dos conversaciones muy
    // distintas con el cliente que está delante.
    abrirElNegocio({ saldo: 1 });
    await svc.consumir(CAJERO, 'm1', 1);
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      /Sin cupo: le quedan 0 de 10/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. El pedido de la mesa
// ─────────────────────────────────────────────────────────────────────────

describe('el pedido de la mesa: tres cafés y quedan dos', () => {
  it('no descuenta NINGUNO, y el mensaje dice cuántos hay', async () => {
    // Todo o nada es lo correcto en un mostrador: si el sistema cobrara 2 de
    // los 3 en silencio, el cajero serviría tres creyendo que están pagados y
    // el negocio regalaría el tercero sin enterarse. Y el mensaje tiene que
    // traer el número, porque es lo que el cajero le va a decir a la mesa.
    abrirElNegocio({ saldo: 2 });
    await expect(svc.consumir(CAJERO, 'm1', 3)).rejects.toThrow(
      /Sin cupo: le quedan 2 de 10/,
    );
    expect(saldo()).toBe(2);
    expect(bd.consumos).toHaveLength(0);
  });

  it('el cajero cierra la venta cobrando los dos que sí hay', async () => {
    abrirElNegocio({ saldo: 2 });
    await svc.consumir(CAJERO, 'm1', 3).catch(() => null);
    const r = await svc.consumir(CAJERO, 'm1', 2);
    expect(r.saldo).toBe(0);
    expect(servidos()).toBe(2);
  });

  it('pedir exactamente los que quedan entra, no se queda corto por uno', async () => {
    abrirElNegocio({ saldo: 3 });
    expect((await svc.consumir(CAJERO, 'm1', 3)).saldo).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. La corrección
// ─────────────────────────────────────────────────────────────────────────

describe('la corrección: cobró de más, deshace y vuelve a cobrar bien', () => {
  it('cobró 3, deshizo y cobró 1: el saldo cuadra en 9', async () => {
    const malo = await svc.consumir(CAJERO, 'm1', 3);
    expect(saldo()).toBe(7);
    await svc.anularConsumo(CAJERO, malo.consumoId);
    expect(saldo()).toBe(10);
    const bueno = await svc.consumir(CAJERO, 'm1', 1);
    expect(bueno.saldo).toBe(9);
    expect(saldo()).toBe(9);
    // El histórico no se reescribe: la línea mala queda marcada, no borrada.
    expect(bd.consumos).toHaveLength(2);
    expect(bd.consumos[0].revertedAt).not.toBeNull();
    expect(bd.consumos[0].revertedBy).toBe('u-cajero');
  });

  it('deshacer dos veces no le regala un café al cliente', async () => {
    const c = await svc.consumir(CAJERO, 'm1', 2);
    await svc.anularConsumo(CAJERO, c.consumoId);
    await expect(svc.anularConsumo(CAJERO, c.consumoId)).rejects.toThrow(
      'Este consumo ya estaba anulado.',
    );
    expect(saldo()).toBe(10); // no 12
  });

  it('se da cuenta al día siguiente: dentro del mismo mes todavía se deshace', async () => {
    const c = await svc.consumir(CAJERO, 'm1', 2);
    vi.setSystemTime(new Date('2026-09-06T17:00:00Z'));
    expect(await svc.anularConsumo(CAJERO, c.consumoId)).toMatchObject({
      devuelto: 2,
      saldo: 10,
    });
  });

  it('el mes que viene ya no, y no se le regala cupo nuevo', async () => {
    // Devolver en octubre un café de septiembre sería cupo que nadie pagó.
    const c = await svc.consumir(CAJERO, 'm1', 2);
    vi.setSystemTime(new Date('2026-10-02T17:00:00Z'));
    await svc.consumir(CAJERO, 'm1', 1); // el reinicio perezoso: 10 − 1 = 9

    const r = await svc.anularConsumo(CAJERO, c.consumoId);
    expect(r).toMatchObject({
      devuelto: 0,
      motivo: 'consumo de un período anterior',
    });
    expect(saldo()).toBe(9);
  });

  it('el informe del mes no cuenta los cafés que se anularon', async () => {
    // Ésta es LA pregunta del producto: el negocio cobra 60.000 y quiere saber
    // cuántos cafés entregó. Sumar TODAS las líneas del período inflaba el
    // número dos veces por cada corrección del cajero —la mala y la buena—, y
    // el panel lo pinta en grande: «4 cafés entregados», «4,0 por socio»,
    // cuando por la barra salió uno. Cuanto más cuidadoso era el cajero
    // corrigiendo, peor le salía la cuenta.
    //
    // Se acotó el `_sum` a `revertedAt: null`. La línea anulada NO desaparece
    // del listado —el histórico no se esconde—, solo deja de sumar.
    const malo = await svc.consumir(CAJERO, 'm1', 3);
    await svc.anularConsumo(CAJERO, malo.consumoId);
    await svc.consumir(CAJERO, 'm1', 1);

    const informe = await svc.consumosDelPlan(DUENO, 'p1');
    expect(informe.entregadas).toBe(1);
    // Y la línea mala sigue ahí, marcada, para que el negocio la vea.
    expect(informe.total).toBe(2);
    expect(
      informe.consumos.find((c) => c.id === malo.consumoId)?.anuladoEn,
    ).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. El moroso
// ─────────────────────────────────────────────────────────────────────────

describe('el moroso: no paga, se pausa, paga, se reactiva', () => {
  it('conserva lo que le quedaba: la pausa no se queda con su cupo', async () => {
    await svc.consumir(CAJERO, 'm1', 4); // le quedan 6
    await svc.cambiarEstado(DUENO, 'm1', 'PAUSADA');

    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      'Esta membresía está pausada.',
    );
    expect(saldo()).toBe(6);

    await svc.cambiarEstado(DUENO, 'm1', 'ACTIVA');
    expect((await svc.consumir(CAJERO, 'm1', 1)).saldo).toBe(5);
  });

  it('al pausarlo se le repinta la tarjeta, para que no llegue creyendo que tiene', async () => {
    // La caja lo frena bien, así que no se pierde dinero: se pierde la
    // discusión en el mostrador, que para el negocio es peor.
    await svc.cambiarEstado(DUENO, 'm1', 'PAUSADA');
    expect(empujados).toContainEqual({
      passId: 'pass1',
      motivo: 'club.estado',
    });
  });

  it('«dar de alta» al que acaba de pagar NO lo reactiva: sigue pausado', async () => {
    // El cajero cobra los 60.000 en efectivo y vuelve a darlo de alta, que es
    // el gesto natural. El servicio devuelve 200 con la membresía tal cual y
    // NO la reactiva. Está bien que un alta no levante una pausa a escondidas
    // —la pausa es una decisión del negocio—, pero el único aviso de que sigue
    // pausado es el `status` de la respuesta: si la pantalla solo dice
    // «listo», el cajero manda al cliente a la barra y allí le dicen que no.
    //
    // Y reactivar de verdad (`PATCH membresias/:id/estado`) es de
    // TENANT_OWNER: un cajero no puede, con el cliente delante.
    await svc.cambiarEstado(DUENO, 'm1', 'PAUSADA');

    const r = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(r.status).toBe('PAUSADA');
    expect(socio().status).toBe('PAUSADA');
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pausado tres meses, al reactivarlo recibe UN cupo, no tres', async () => {
    await svc.consumir(CAJERO, 'm1', 8); // le quedan 2 de septiembre
    await svc.cambiarEstado(DUENO, 'm1', 'PAUSADA');

    vi.setSystemTime(new Date('2026-12-05T17:00:00Z'));
    await svc.reiniciarCupos(); // el cron ignora a los pausados
    expect(saldo()).toBe(2);

    await svc.cambiarEstado(DUENO, 'm1', 'ACTIVA');
    const r = await svc.consumir(CAJERO, 'm1', 1);
    expect(r.cupoDelPeriodo).toBe(10);
    expect(r.saldo).toBe(9); // 10 de diciembre, no 2 + 30 acumulados
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. El que se va y vuelve
// ─────────────────────────────────────────────────────────────────────────

describe('el que se va y vuelve', () => {
  it('se va con 6 y vuelve a la semana: los 6 siguen ahí', async () => {
    await svc.consumir(CAJERO, 'm1', 4);
    await svc.cambiarEstado(DUENO, 'm1', 'CANCELADA');
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      'Esta membresía está cancelada.',
    );

    vi.setSystemTime(new Date('2026-09-12T17:00:00Z'));
    const r = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(r.saldo).toBe(6);
    expect(socio().status).toBe('ACTIVA');
    // Y no se le da la bienvenida otra vez, que le llegaría en cada readmisión.
    expect(bienvenidas()).toHaveLength(0);
  });

  it('irse y volver tres veces el mismo mes no le recarga el cupo', async () => {
    // La recarga infinita: cancelar y readmitir devolviendo el cupo entero
    // dejaría al socio con cafés ilimitados por una sola cuota.
    await svc.consumir(CAJERO, 'm1', 7);
    for (let i = 0; i < 3; i++) {
      await svc.cambiarEstado(DUENO, 'm1', 'CANCELADA');
      await svc.darDeAlta(DUENO, 'p1', 'cli1');
    }
    expect(saldo()).toBe(3);
    expect(socio().cupoDelPeriodo).toBe(10);
  });

  it('vuelve el mes siguiente: cupo nuevo y la tarjeta que ya tenía instalada', async () => {
    await svc.consumir(CAJERO, 'm1', 7);
    await svc.cambiarEstado(DUENO, 'm1', 'CANCELADA');

    vi.setSystemTime(new Date('2026-10-03T17:00:00Z'));
    const r = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(r.saldo).toBe(10);
    // El mismo pase: no se le pide reinstalar la tarjeta en el móvil.
    expect(r.passId).toBe('pass1');
    expect(bd.pases).toHaveLength(1);
    expect(socio().periodo).toBe('2026-10');
  });

  it('al que vuelve un mes después SÍ se le vuelve a dar la bienvenida', async () => {
    // Se fija tal cual está, no porque esté claramente bien: el negocio que
    // cancele y readmita cada mes —para «reiniciarle» la suscripción a mano—
    // le dispara el PASS_CREATED cada vez, con lo que cuelgue de él. Si algún
    // día se le engancha un cupón de bienvenida, esto se vuelve una fuga.
    await svc.cambiarEstado(DUENO, 'm1', 'CANCELADA');
    vi.setSystemTime(new Date('2026-10-03T17:00:00Z'));
    await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(bienvenidas()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. El fin de mes, en hora de Bogotá
// ─────────────────────────────────────────────────────────────────────────

describe('el fin de mes: las 23:50 del 30 y las 00:10 del 1', () => {
  // Las dos horas son el MISMO día en UTC (1 de octubre): si algo del camino
  // contara en UTC, el café de las 23:50 saldría del cupo de octubre y el
  // cliente perdería uno.
  const LAS_23_50_DEL_30 = new Date('2026-10-01T04:50:00Z');
  const LAS_00_10_DEL_1 = new Date('2026-10-01T05:10:00Z');

  it('el café de las 23:50 del 30 se apunta a septiembre', async () => {
    vi.setSystemTime(LAS_23_50_DEL_30);
    abrirElNegocio({ saldo: 4, periodo: '2026-09' });

    const r = await svc.consumir(CAJERO, 'm1', 1);
    expect(r.saldo).toBe(3);
    expect(bd.consumos[0].periodo).toBe('2026-09');
    expect(socio().periodo).toBe('2026-09');
  });

  it('veinte minutos después ya tiene el cupo de octubre, sin esperar al cron', async () => {
    // El cron es HORARIO: entre las 00:00 y su primera pasada hay hasta una
    // hora. Decirle «no» a alguien que pagó por un cron nuestro que aún no ha
    // corrido es un problema nuestro cobrado al cliente. El sobrante de
    // septiembre se pierde —ésa es la regla— pero el café sale de octubre.
    vi.setSystemTime(LAS_23_50_DEL_30);
    abrirElNegocio({ saldo: 4, periodo: '2026-09' });
    await svc.consumir(CAJERO, 'm1', 1); // quedan 3 de septiembre

    vi.setSystemTime(LAS_00_10_DEL_1);
    const r = await svc.consumir(CAJERO, 'm1', 1);
    expect(r.cupoDelPeriodo).toBe(10);
    expect(r.saldo).toBe(9); // 10 de octubre menos éste, no 3 − 1
    expect(bd.consumos[1].periodo).toBe('2026-10');
    expect(socio().periodo).toBe('2026-10');
  });

  it('el que terminó septiembre en cero ve el botón, no «sin cupo»', async () => {
    // La pantalla del cajero hace el mismo reinicio perezoso pero SIN
    // escribir. Sin esto, al que llegó a cero no se le pintaba el botón —y
    // `consumir` habría funcionado—, mientras que al que le sobraba sí. El
    // caso que favorece al negocio funcionaba y el que favorece al cliente no.
    vi.setSystemTime(LAS_00_10_DEL_1);
    abrirElNegocio({ saldo: 0, periodo: '2026-09' });

    const v = await svc.resolverParaCaja(CAJERO, 'pass1');
    expect(v).toMatchObject({
      saldo: 10,
      periodo: '2026-10',
      puedeConsumir: true,
    });
    // Mirar no escribe: el reinicio lo hace el consumo.
    expect(saldo()).toBe(0);
    expect(socio().periodo).toBe('2026-09');
  });

  it.fails(
    'dar de alta a las 23:50 del 30 no debería entregar dos cupos por una cuota',
    async () => {
      // El socio nuevo del final de mes. Sin tramos configurados —el valor por
      // defecto, y `cupoDeAlta` devuelve el cupo entero cuando no hay— cobra
      // una cuota, recibe 10 cafés esa noche y a los veinte minutos otros 10,
      // porque el cupo se reinicia por MES NATURAL mientras el cobro es
      // manual, por fecha de pago. 20 cafés por 60.000, y el negocio se entera
      // mirando la barra.
      //
      // Los tramos de alta existen justo para esto, pero son opcionales y
      // nadie avisa al crear el plan de que sin ellos el último día del mes
      // regala un cupo entero.
      //
      // OJO: `club-vivales.spec.ts` cubre esta misma fuga con más detalle y le
      // pone precio (20 cafés = 60.000 regalados). Aquí queda la versión del
      // mostrador —la secuencia que teclea el cajero— y allí el cálculo. Si se
      // arregla, se caen las dos: decidid cuál se queda.
      vi.setSystemTime(LAS_23_50_DEL_30);
      abrirElNegocio({ socio: false });

      const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
      await svc.consumir(CAJERO, m.id, 10); // los 10 de septiembre, esa noche

      vi.setSystemTime(LAS_00_10_DEL_1);
      await svc.consumir(CAJERO, m.id, 10); // y 10 más, veinte minutos después

      expect(servidos()).toBeLessThanOrEqual(10);
    },
  );

  it('con un tramo de fin de mes configurado, el alta del 30 recibe 3', async () => {
    // La defensa que sí existe. Se fija para que nadie la quite pensando que
    // no hace nada: es lo único que separa al plan de regalar un cupo entero.
    vi.setSystemTime(LAS_23_50_DEL_30);
    abrirElNegocio({
      socio: false,
      tramos: [
        { desdeDia: 1, hastaDia: 24, beneficios: 10 },
        { desdeDia: 25, hastaDia: 31, beneficios: 3 },
      ],
    });
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(m.saldo).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. El cajero despistado
// ─────────────────────────────────────────────────────────────────────────

describe('el cajero despistado', () => {
  it('da de alta a la Ana equivocada: la baja corta el consumo, la bienvenida ya salió', async () => {
    // Ana Ruiz y Ana Rojas. El cajero elige la de arriba de la lista.
    abrirElNegocio({ socio: false });
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli2');

    // El aviso de bienvenida sale en el acto y no hay forma de recogerlo: Ana
    // Rojas, que no pagó nada, recibe «bienvenida a Café Diario».
    expect(bienvenidas()).toHaveLength(1);
    expect(bienvenidas()[0].datos.customerId).toBe('cli2');

    // Lo que sí se corta bien es el consumo.
    await svc.cambiarEstado(DUENO, m.id, 'CANCELADA');
    await expect(svc.consumir(CAJERO, m.id, 1)).rejects.toThrow(
      'Esta membresía está cancelada.',
    );
    // Y la caja se lo dice al escanear, sin dejarle cobrar.
    const v = await svc.resolverParaCaja(CAJERO, m.passId!);
    expect(v).toMatchObject({ status: 'CANCELADA', puedeConsumir: false });
  });

  it('darla de alta dos veces no crea dos socias, ni dos tarjetas, ni dos bienvenidas', async () => {
    abrirElNegocio({ socio: false });
    const a = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const b = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(b.id).toBe(a.id);
    expect(b.passId).toBe(a.passId);
    expect(bd.membresias).toHaveLength(1);
    expect(bd.pases).toHaveLength(1);
    expect(bd.tarjetas).toHaveLength(1);
    expect(bienvenidas()).toHaveLength(1);
    // Y el clic de más no le recarga lo que ya gastó.
    await svc.consumir(CAJERO, a.id, 3);
    expect((await svc.darDeAlta(DUENO, 'p1', 'cli1')).saldo).toBe(7);
  });

  it.fails(
    'escanear un cartón de sellos normal no debería mandarlo a dar de alta a nadie',
    async () => {
      // `GET /club/caja/pase/:passId` es alcanzable con cualquier pase (rol de
      // caja). Con uno que no es de club, el cajero recibe «Esta tarjeta de
      // club no tiene socio asignado. Vuelve a darlo de alta desde Tarjeta de
      // Club» — y se va a meter en el club a alguien que solo tenía un cartón
      // de sellos. El mensaje asume `card.clubPlanId`, que solo garantiza el
      // escáner, no esta ruta.
      abrirElNegocio();
      bd.tarjetas.push({
        id: 'card-sellos',
        tenantId: 't1',
        clubPlanId: null,
        name: 'Cartón de sellos',
        type: 'STAMPS',
        stampsRequired: 8,
        rewardText: 'El noveno gratis',
        isActive: true,
      });
      bd.pases.push({
        id: 'pass-sellos',
        tenantId: 't1',
        cardId: 'card-sellos',
        customerId: 'cli2',
        serialNumber: 'STP-1',
        qrToken: 'qr-sellos',
        authToken: 'auth-sellos',
        stampsCount: 3,
        status: 'ACTIVE',
        lastActivityAt: null,
        createdAt: new Date('2026-09-01'),
        updatedAt: new Date('2026-09-01'),
      });

      const err: any = await svc
        .resolverParaCaja(CAJERO, 'pass-sellos')
        .catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).not.toMatch(/Vuelve a darlo de alta/);
    },
  );

  it('teclear una cantidad imposible no toca nada', async () => {
    // El cajero con prisa deja el campo en cero, o se le cuela un decimal.
    for (const n of [0, -1, 1.5, Number.NaN]) {
      await expect(svc.consumir(CAJERO, 'm1', n)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(saldo()).toBe(10);
    expect(bd.consumos).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Lo que la pantalla del cajero le enseña del que no paga
// ─────────────────────────────────────────────────────────────────────────

describe('la pantalla del cajero con un socio pausado', () => {
  it('a un pausado con el mes atrasado se le enseña lo que tiene, no el cupo entero', async () => {
    // El reinicio perezoso de la caja miraba SOLO el período, al revés que el
    // cron (`tocaReiniciar` sí mira `status`) y que `consumir` (que corta antes
    // por pausada): al socio que lleva un mes sin pagar le pintaba «10 cafés»
    // cuando en su tarjeta hay 2. Frenarlo lo frenaba —`puedeConsumir` era
    // false—, pero el cajero tenía delante un número grande y un cliente que lo
    // estaba viendo: la discusión en el mostrador, con nosotros dándole la
    // razón al cliente. Y el mismo número salía en la ficha del cliente del
    // panel («En pausa · 10 cafés»), que llama a esta misma ruta.
    //
    // Ahora el reinicio se anticipa solo a quien lo va a recibir.
    abrirElNegocio({ saldo: 2, periodo: '2026-08' });
    socio().status = 'PAUSADA';

    const v = await svc.resolverParaCaja(CAJERO, 'pass1');
    expect(v).toMatchObject({ saldo: 2, puedeConsumir: false });
  });

  it('y con el mes al día le enseña el saldo de verdad', async () => {
    abrirElNegocio({ saldo: 2, periodo: '2026-09' });
    socio().status = 'PAUSADA';
    const v = await svc.resolverParaCaja(CAJERO, 'pass1');
    expect(v).toMatchObject({ saldo: 2, puedeConsumir: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. La tarjeta que se pierde
// ─────────────────────────────────────────────────────────────────────────

describe('el cliente cambia de móvil y pierde la tarjeta', () => {
  it.fails(
    'rehacérsela a mitad de mes no debería devolverle el cupo entero',
    async () => {
      // `ClubMembresia.pass` es `onDelete: SetNull`: si el pase desaparece —al
      // fusionar clientes duplicados, al rehacerle la tarjeta— la membresía se
      // queda sin `passId`, y entonces `darDeAlta` deja de ver «vuelve este
      // mes» y le emite un pase nuevo CON EL CUPO DEL DÍA. El socio que se
      // había gastado 8 de 10 vuelve a tener 10.
      //
      // Está puesto a propósito para poder reparar a un socio sin tarjeta,
      // pero de paso es la única recarga que queda abierta: quien pueda hacer
      // desaparecer el pase, recarga.
      //
      // OJO: `club-vivales.spec.ts` cubre esta misma ruta y además el caso
      // contrario —con tramos, reemitir el día 20 le RECORTA de 8 a 3— y el de
      // reemitir a un pausado, que lo reactiva. Si se arregla, se caen las dos:
      // decidid cuál se queda.
      abrirElNegocio({ socio: false });
      const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
      await svc.consumir(CAJERO, m.id, 8);
      expect(saldo()).toBe(2);

      bd.pases.length = 0;
      socio().passId = null;

      const r = await svc.darDeAlta(DUENO, 'p1', 'cli1');
      expect(r.saldo).toBe(2);
    },
  );
});
