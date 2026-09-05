import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import { errorDeTramos } from './club-periodo';
import {
  bdVacia,
  crearBilletera,
  crearAutomatizaciones,
  crearPrismaFalso,
  type BaseDeDatos,
} from './club-prisma-falso';

/**
 * La Tarjeta de Club vista por los dos que se pelean el cupo:
 *
 *  · el socio que quiere sacarle más de lo que pagó, y
 *  · el socio honesto al que el sistema le quita lo suyo.
 *
 * Los dos lados de la misma pregunta —¿se escapa dinero?— porque el mismo
 * mecanismo falla en las dos direcciones: el cupo se repone por CALENDARIO
 * (el día 1) y la cuota se cobra por ANIVERSARIO (a mano, el día que el socio
 * entró). Todo lo caro de aquí abajo sale de ese desfase.
 *
 * Todo llama al SERVICIO REAL contra el Prisma falso. Lo que aguanta queda
 * fijado con un test; lo que se escapa queda demostrado, NO arreglado.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@negocio.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};
const CAJERO: AuthUser = {
  id: 'u-cajero',
  email: 'caja@negocio.com',
  role: 'TENANT_STAFF' as AuthUser['role'],
  tenantId: 't1',
};

/**
 * El plan del enunciado, para poder poner precio a cada fuga: 60.000 al mes
 * por 10 cafés son 6.000 el café. `precioCents` queda en 60000 como en el
 * resto de los tests del módulo.
 */
const CUOTA = 60_000;
const CUPO_MENSUAL = 10;
const POR_BENEFICIO = CUOTA / CUPO_MENSUAL;
const enPesos = (beneficios: number) => beneficios * POR_BENEFICIO;

type Tramo = { desdeDia: number; hastaDia: number; beneficios: number };

let bd: BaseDeDatos;
let svc: ClubService;
let emitidos: Array<{ evento: string; datos: any }>;

function montar(tramos: Tramo[] = []) {
  bd = bdVacia();
  bd.planes.push({
    id: 'p1',
    tenantId: 't1',
    name: 'Café Diario',
    slug: 'cafe-diario',
    description: '',
    beneficiosPorMes: CUPO_MENSUAL,
    unidad: 'café',
    precioCents: 60000,
    currency: 'COP',
    periodicidad: 'MENSUAL',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  tramos.forEach((t, i) => bd.tramos.push({ id: `tr${i}`, planId: 'p1', ...t }));
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Ana Ruiz' });
  bd.clientes.push({ id: 'cli2', tenantId: 't1', fullName: 'Beto Páez' });
  const falso = crearPrismaFalso(bd);
  const billetera = crearBilletera();
  const autos = crearAutomatizaciones();
  emitidos = autos.emitidos;
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    autos.automations as unknown as AutomationsService,
  );
}

/** La membresía tal como está AHORA en la base, no como la devolvió el alta. */
const fila = (membresiaId: string) =>
  bd.membresias.find((m) => m.id === membresiaId)!;

/**
 * El saldo vivo. Se busca por la membresía y no por un `passId` guardado:
 * varias de las rutas de aquí abajo le EMITEN UN PASE NUEVO al socio, y
 * mirando el viejo el test se creería que no pasó nada.
 */
const saldo = (membresiaId: string) =>
  bd.pases.find((p) => p.id === fila(membresiaId).passId)!.stampsCount;

/** Lo que el negocio entregó de verdad, contando unidades y no líneas. */
const entregados = () => bd.consumos.reduce((t, c) => t + c.cantidad, 0);

/**
 * Lo que un socio se lleva HOY si exprime lo que tenga: pasa el cron —que es
 * horario— y vacía el cupo de una sentada. `consumir` acepta cualquier
 * cantidad, así que quien entra el día 31 no necesita 31 días para gastarse
 * el mes: le basta un pedido de 10.
 */
async function vaciarCupo(membresiaId: string): Promise<number> {
  await svc.reiniciarCupos();
  const hay = saldo(membresiaId);
  if (hay > 0) await svc.consumir(CAJERO, membresiaId, hay);
  return hay;
}

/**
 * Beneficios que se lleva un socio ENTRE UNA CUOTA Y LA SIGUIENTE.
 *
 * `reinicios` son los días 1 que caen dentro de la ventana de su cuota. Ahí
 * está la fuga entera: quien paga el día 30 tiene un día 1 dentro de su mes
 * pagado, y quien paga el día 1 no tiene ninguno.
 */
async function porCuota(altaEn: string, ...reinicios: string[]): Promise<number> {
  vi.setSystemTime(new Date(altaEn));
  const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
  let llevados = await vaciarCupo(m.id);
  for (const dia of reinicios) {
    vi.setSystemTime(new Date(dia));
    llevados += await vaciarCupo(m.id);
  }
  return llevados;
}

/**
 * Lo que le queda al socio tras una fusión de fichas o el borrado de su pase:
 * la membresía viva y `passId` en null. Es literalmente lo que hace Postgres
 * —`ClubMembresia.pass` es `onDelete: SetNull`— cuando `customers.service`
 * fusiona dos fichas del mismo humano y borra el pase sobrante.
 */
function perderElPase(membresiaId: string) {
  const m = fila(membresiaId);
  const i = bd.pases.findIndex((p) => p.id === m.passId);
  if (i >= 0) bd.pases.splice(i, 1);
  m.passId = null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-05T17:00:00Z')); // 5 de sept, mediodía en Bogotá
  montar();
});
afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Compartir la tarjeta ────────────────────────────────────────────────

describe('el socio le pasa el QR a un amigo', () => {
  it('los dos consumen del MISMO cupo: compartir no crea uno nuevo', async () => {
    // Lo que evita: que el QR compartido resolviera a algo por cabeza. Aquí
    // el pase ES la membresía, así que el amigo se gasta los cafés del socio
    // y el negocio no entrega ni uno de más — que es lo único que le importa
    // al dinero.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    const delSocio = await svc.resolverParaCaja(CAJERO, m.passId!);
    const delAmigo = await svc.resolverParaCaja(CAJERO, m.passId!);
    expect(delAmigo.membresiaId).toBe(delSocio.membresiaId);

    await svc.consumir(CAJERO, delSocio.membresiaId, 6);
    await svc.consumir(CAJERO, delAmigo.membresiaId, 4);

    expect(saldo(m.id)).toBe(0);
    await expect(svc.consumir(CAJERO, m.id, 1)).rejects.toThrow('Sin cupo');
    expect(entregados()).toBe(CUPO_MENSUAL);
    expect(bd.membresias).toHaveLength(1);
    expect(bd.pases).toHaveLength(1);
  });

  it('el negocio no puede ver que fue el amigo: todo queda a nombre del titular', async () => {
    // No es una fuga de dinero —el cupo es uno— pero sí el límite del
    // control: no hay identidad en la caja, así que la tarjeta es al
    // portador. Queda fijado para que nadie lo descubra en el mostrador.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 1);

    const r = await svc.consumosDelPlan(DUENO, 'p1');
    expect(r.consumos).toHaveLength(1);
    expect(r.consumos[0].cliente.nombre).toBe('Ana Ruiz');
  });
});

// ── 2. Dos teléfonos / dos fichas ──────────────────────────────────────────

describe('el pase instalado en dos móviles', () => {
  it('no duplica el cupo: es la misma fila de `Pass`', async () => {
    // El índice único [cardId, customerId] es lo que lo sostiene. Volver a
    // pulsar «dar de alta» para mandarle la tarjeta al segundo móvil devuelve
    // el pase que ya tenía, con el saldo que ya tenía.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 4);

    const segundoMovil = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(segundoMovil.passId).toBe(m.passId);
    expect(segundoMovil.saldo).toBe(6);
    expect(bd.pases).toHaveLength(1);
    expect(saldo(m.id)).toBe(6);
  });

  it('dos fichas del mismo humano SÍ son dos cupos, y nada lo detecta', async () => {
    // El alta rápida busca por teléfono exacto: dos números del mismo humano
    // son dos clientes y dos membresías. El sistema no tiene forma de saberlo
    // —y la salida, fusionar las fichas, dispara el fallo de más abajo.
    const uno: any = await svc.altaRapida(DUENO, 'p1', '3001112233');
    const otro: any = await svc.altaRapida(DUENO, 'p1', '3009998877');

    expect(otro.cliente.id).not.toBe(uno.cliente.id);
    expect(bd.membresias).toHaveLength(2);
    expect(saldo(uno.id) + saldo(otro.id)).toBe(2 * CUPO_MENSUAL);
  });
});

// ── 3. Entrar barato: el desfase calendario / aniversario ──────────────────

describe('FUGA — el cupo se repone por calendario y la cuota se cobra por aniversario', () => {
  it('sin tramos, entrar el día 30 compra DOS cupos con una cuota', async () => {
    // Sin tramos configurados —el ajuste por defecto— quien entra el 30 de
    // septiembre recibe los 10 del mes, se los gasta en dos días, y el 1 de
    // octubre el cron le pone otros 10. Su siguiente cuota no vence hasta el
    // 30 de octubre: 20 cafés por 60.000.
    montar();
    const llevados = await porCuota(
      '2026-09-30T17:00:00Z',
      '2026-10-01T05:30:00Z', // el día 1 cae DENTRO de su mes pagado
    );

    expect(llevados).toBe(20);
    expect(enPesos(llevados - CUPO_MENSUAL)).toBe(60_000);
  });

  it('entrar el día 1 sale a diez: la comparación que pone precio a la fuga', async () => {
    montar();
    // Su ventana [1 sep, 1 oct) no contiene ningún reinicio ajeno.
    expect(await porCuota('2026-09-01T17:00:00Z')).toBe(CUPO_MENSUAL);
  });

  it('con tramos, la fuga se encoge pero no se cierra: 13 por cuota', async () => {
    // El tramo de 3 del final de mes es exactamente lo que el producto tiene
    // para esto, y aun así el que entra el 30 se lleva 3 + 10 antes de volver
    // a pagar. Un 30% de más, 18.000 por socio y por entrada.
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 31, beneficios: 3 },
    ]);
    const llevados = await porCuota(
      '2026-09-30T17:00:00Z',
      '2026-10-01T05:30:00Z',
    );

    expect(llevados).toBe(13);
    expect(enPesos(llevados - CUPO_MENSUAL)).toBe(18_000);
  });

  it('y con el MISMO tramo, si el negocio cobra por calendario, el que pierde es el socio', async () => {
    // El otro lado de la misma moneda, y el que hace que esto no se pueda
    // arreglar tocando sólo los tramos: el producto NO SABE cuándo cobra el
    // negocio. Si cobra el día 1 —lo natural cuando se cobra a mano—, el que
    // entró el 25 pagó su cuota completa de septiembre por 3 cafés. Dos
    // cuotas después ha pagado lo mismo que el que entró el día 1 y se ha
    // llevado 7 menos. El mismo tramo de 3 es un regalo o un robo según una
    // cosa que en ningún sitio se pregunta ni se guarda.
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 31, beneficios: 3 },
    ]);

    vi.setSystemTime(new Date('2026-09-01T17:00:00Z'));
    const temprano = await svc.darDeAlta(DUENO, 'p1', 'cli2');
    let llevaTemprano = await vaciarCupo(temprano.id);

    vi.setSystemTime(new Date('2026-09-25T17:00:00Z'));
    const tarde = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    let llevaTarde = await vaciarCupo(tarde.id);
    expect(llevaTarde).toBe(3); // primera cuota completa: tres cafés

    vi.setSystemTime(new Date('2026-10-01T05:30:00Z'));
    llevaTemprano += await vaciarCupo(temprano.id);
    llevaTarde += await vaciarCupo(tarde.id);

    // Dos cuotas cada uno, 120.000 cada uno.
    expect(llevaTemprano).toBe(20);
    expect(llevaTarde).toBe(13);
    expect(enPesos(llevaTemprano - llevaTarde)).toBe(42_000);
  });

  it('el único tramo que cuadra la cuenta es CERO — y ninguno más', async () => {
    // La demostración de que los tramos no pueden arreglar esto: entre la
    // cuota del día 20 y la siguiente, el socio se lleva SIEMPRE el tramo MÁS
    // el cupo entero del día 1. La función es «tramo + 10», así que sólo el
    // tramo 0 devuelve 10. Cualquier prorrateo «justo» —la mitad del mes,
    // media cuota— regala media cuota.
    const tabla: Array<[number, number]> = [];
    for (const beneficios of [0, 1, 3, 5, 10]) {
      montar([{ desdeDia: 16, hastaDia: 31, beneficios }]);
      tabla.push([
        beneficios,
        await porCuota('2026-09-20T17:00:00Z', '2026-10-01T05:30:00Z'),
      ]);
    }

    expect(tabla).toEqual([
      [0, 10],
      [1, 11],
      [3, 13],
      [5, 15],
      [10, 20],
    ]);
  });
});

// ── 6. Los tramos: combinaciones VÁLIDAS que regalan cupo ──────────────────

describe('FUGA — tramos que `errorDeTramos` acepta y regalan el mes entero', () => {
  it('el hueco del día 31 entrega el cupo ENTERO justo el peor día', async () => {
    // El negocio escribe «del 16 al 30» porque piensa en un mes de 30 días.
    // `errorDeTramos` lo acepta: no exige cubrir el mes. Y `cupoDeAlta`, ante
    // un día sin tramo, devuelve el cupo entero a propósito —«mejor regalar
    // que dejar en cero a quien pagó»—. Las dos decisiones por separado son
    // razonables; juntas, el día 31 es el más barato del año para entrar.
    const tramos: Tramo[] = [
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 30, beneficios: 3 },
    ];
    expect(errorDeTramos(tramos)).toBeNull(); // el validador no dice nada
    montar(tramos);

    const llevados = await porCuota(
      '2026-10-31T17:00:00Z', // octubre tiene 31: el 31 no lo cubre nadie
      '2026-11-01T05:30:00Z',
    );

    expect(llevados).toBe(20);
    expect(enPesos(llevados - CUPO_MENSUAL)).toBe(60_000);
  });

  it('el tramo de cero cierra el hueco en los meses largos…', async () => {
    // Con 29-31 en cero, quien entra el último día de octubre no recibe nada
    // hasta el 1 de noviembre: exactamente los 10 que pagó. Esto es lo que
    // hay que configurar, y es lo que hace de contraste al caso de febrero.
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 28, beneficios: 3 },
      { desdeDia: 29, hastaDia: 31, beneficios: 0 },
    ]);

    expect(
      await porCuota('2026-10-31T17:00:00Z', '2026-11-01T05:30:00Z'),
    ).toBe(CUPO_MENSUAL);
  });

  it('…y en febrero se abre solo: el último día del mes cae en el tramo de 3', async () => {
    // Los tramos son días del calendario, no «lo que queda de mes». En
    // febrero el 28 ES el último día y cae en 16-28, así que el tramo de cero
    // que cerraba el agujero en octubre no se aplica nunca. Misma
    // configuración, mismo comportamiento del socio, 3 beneficios de más.
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 28, beneficios: 3 },
      { desdeDia: 29, hastaDia: 31, beneficios: 0 },
    ]);

    const llevados = await porCuota(
      '2027-02-28T17:00:00Z', // 2027 no es bisiesto: el 28 es el último
      '2027-03-01T05:30:00Z',
    );

    expect(llevados).toBe(13);
    expect(enPesos(llevados - CUPO_MENSUAL)).toBe(18_000);
  });

  it('un tramo que da MÁS a fin de mes que a principio también pasa el validador', async () => {
    // Nada obliga a que los tramos decrezcan. Un dedo torpe al teclear
    // convierte el final del mes en la puerta barata, y ni al guardar ni
    // después avisa nadie.
    const alReves: Tramo[] = [
      { desdeDia: 1, hastaDia: 15, beneficios: 1 },
      { desdeDia: 16, hastaDia: 31, beneficios: 10 },
    ];
    expect(errorDeTramos(alReves)).toBeNull();

    const plan = await svc.crearPlan(DUENO, {
      name: 'Café al revés',
      beneficiosPorMes: 10,
      tramos: alReves,
    });
    expect(plan.tramos).toHaveLength(2);
  });
});

// ── 4. Cancelar, pausar y volver: variantes ────────────────────────────────

describe('pausar y reactivar en bucle no recarga nada', () => {
  it('cinco vueltas dentro del mismo mes dejan el saldo donde estaba', async () => {
    // Lo que evita: que `cambiarEstado` a ACTIVA repusiera el cupo. Un socio
    // con un dueño despistado podría pedir «páusame y reactívame» hasta
    // vaciar la caja.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 7);

    for (let i = 0; i < 5; i++) {
      await svc.cambiarEstado(DUENO, m.id, 'PAUSADA');
      await svc.cambiarEstado(DUENO, m.id, 'ACTIVA');
    }

    expect(saldo(m.id)).toBe(3);
    expect(fila(m.id).cupoDelPeriodo).toBe(CUPO_MENSUAL);
  });

  it('el bucle cruzando el mes reparte UN cupo, no uno por vuelta', async () => {
    // El reinicio perezoso mira el período guardado, así que da igual cuántas
    // veces se pause y se reactive: el mes nuevo sólo se cobra una vez.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(await vaciarCupo(m.id)).toBe(10);

    vi.setSystemTime(new Date('2026-10-01T05:30:00Z'));
    for (let i = 0; i < 4; i++) {
      await svc.cambiarEstado(DUENO, m.id, 'PAUSADA');
      await svc.cambiarEstado(DUENO, m.id, 'ACTIVA');
    }

    expect(await vaciarCupo(m.id)).toBe(10);
    expect(await vaciarCupo(m.id)).toBe(0); // ya no queda nada que exprimir
    expect(entregados()).toBe(20); // dos meses, dos cupos
  });
});

describe('FUGA — pausar esquiva los tramos; cancelar los cobra', () => {
  it('mismo día y mismo dinero: el pausado ve 10 y el cancelado 3', async () => {
    // Los tramos SÓLO se aplican al dar de alta. La reactivación no prorratea
    // —está decidido así—, pero eso convierte «páusame» en la palabra mágica:
    // el socio que deja de pagar y vuelve el 28 recibe el mes entero, y el
    // que fue dado de baja el mismo día por el mismo impago recibe 3. Siete
    // beneficios de diferencia, 42.000, por una palabra que elige el socio.
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 31, beneficios: 3 },
    ]);
    const pausado = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const cancelado = await svc.darDeAlta(DUENO, 'p1', 'cli2');
    await svc.consumir(CAJERO, pausado.id, 10);
    await svc.consumir(CAJERO, cancelado.id, 10);

    // Deja de pagar a mitad de septiembre. A uno lo pausan, al otro lo dan de
    // baja: para el negocio es la misma decisión.
    vi.setSystemTime(new Date('2026-09-15T17:00:00Z'));
    await svc.cambiarEstado(DUENO, pausado.id, 'PAUSADA');
    await svc.cambiarEstado(DUENO, cancelado.id, 'CANCELADA');

    // Los dos pagan otra vez el 28 de octubre.
    vi.setSystemTime(new Date('2026-10-28T17:00:00Z'));
    await svc.cambiarEstado(DUENO, pausado.id, 'ACTIVA');
    const vuelta = await svc.darDeAlta(DUENO, 'p1', 'cli2');

    const enCaja = await svc.resolverParaCaja(CAJERO, fila(pausado.id).passId!);
    expect(enCaja.saldo).toBe(10);
    expect(vuelta.saldo).toBe(3);
    expect(enPesos(enCaja.saldo - vuelta.saldo)).toBe(42_000);
  });
});

describe('cancelar con el plan apagado deja al socio fuera para siempre', () => {
  it('al cancelado por error no se le puede readmitir, pero al pausado sí', async () => {
    // La asimetría: `darDeAlta` exige el plan encendido y `cambiarEstado` no.
    // Apagar el plan se documenta como «sólo cierra las altas nuevas» —el
    // cron sigue repartiendo a los de dentro— pero también cierra la puerta
    // de vuelta del que se canceló por error. Ese socio pagó y se queda sin
    // nada, y la única salida es volver a encender el plan.
    const cancelado = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const pausado = await svc.darDeAlta(DUENO, 'p1', 'cli2');
    await svc.cambiarEstado(DUENO, cancelado.id, 'CANCELADA');
    await svc.cambiarEstado(DUENO, pausado.id, 'PAUSADA');

    await svc.actualizarPlan(DUENO, 'p1', { isActive: false });

    await expect(svc.darDeAlta(DUENO, 'p1', 'cli1')).rejects.toThrow(
      BadRequestException,
    );
    expect(fila(cancelado.id).status).toBe('CANCELADA');

    // Al pausado, en cambio, se le reactiva sin problema.
    await svc.cambiarEstado(DUENO, pausado.id, 'ACTIVA');
    expect(fila(pausado.id).status).toBe('ACTIVA');
    expect(saldo(pausado.id)).toBe(CUPO_MENSUAL);
  });

  it('con el módulo apagado tampoco vuelve, aunque siga pagando', async () => {
    // Mismo agujero por la otra puerta. `assertHabilitado` está antes que
    // todo, así que apagar el módulo del negocio congela a los cancelados.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.cambiarEstado(DUENO, m.id, 'CANCELADA');

    bd.clubEnabled = false;
    await expect(svc.darDeAlta(DUENO, 'p1', 'cli1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ── 5. El socio honesto al que el sistema le quita lo suyo ─────────────────

describe('FUGA — al socio que pierde el pase se le reescribe el saldo', () => {
  it('con tramos, reemitir la tarjeta el día 20 le recorta de 8 a 3', async () => {
    // La secuencia: el negocio fusiona la ficha duplicada del socio (o le
    // borra el pase por cualquier vía). Postgres pone `passId` en null, la
    // caja responde «esta tarjeta no tiene socio asignado. Vuelve a darlo de
    // alta» —el texto lo escribe el propio servicio— y el negocio obedece.
    //
    // Pero `vuelveEsteMes` exige `passId`, así que ese camino NO es la vuelta
    // de un socio que ya estaba: es un alta nueva. Le aplica el tramo del día
    // 20 y le deja 3 donde tenía 8. Cinco cafés que ya había pagado.
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 31, beneficios: 3 },
    ]);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 2);
    expect(saldo(m.id)).toBe(8);

    vi.setSystemTime(new Date('2026-09-20T17:00:00Z'));
    perderElPase(m.id);
    const reemitida = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(reemitida.saldo).toBe(3);
    expect(saldo(m.id)).toBe(3);
    expect(fila(m.id).cupoDelPeriodo).toBe(3); // y el pase pinta «de 3», no «de 10»
    expect(enPesos(8 - 3)).toBe(30_000);
  });

  it('sin tramos, la misma ruta le REGALA el mes entero', async () => {
    // El mismo `if` en la otra dirección: sin tramos, `cupoDeAlta` devuelve el
    // cupo completo, así que perder el pase a fin de mes con 1 café en la mano
    // es una recarga gratis. No es teórico: la fusión de fichas del módulo de
    // clientes acota la SUMA de los dos pases al cupo justamente para no
    // regalar, y luego esta ruta lo regala igual.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 9);
    expect(saldo(m.id)).toBe(1);

    perderElPase(m.id);
    const reemitida = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(reemitida.saldo).toBe(CUPO_MENSUAL);
    expect(enPesos(CUPO_MENSUAL - 1)).toBe(54_000);
  });

  it('y si estaba PAUSADO por impago, reemitir la tarjeta lo reactiva y le repone el cupo', async () => {
    // La peor de las tres. La membresía pausada sin pase no entra por el
    // atajo del principio de `darDeAlta` —pide `passId`— y cae al alta
    // completa, que escribe `status: ACTIVA` y `pausedAt: null`. El negocio
    // sólo quería volver a entregarle la tarjeta al que no ha pagado, y le
    // regala el mes, le borra el rastro de la pausa y le manda otra vez la
    // bienvenida.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 10);
    await svc.cambiarEstado(DUENO, m.id, 'PAUSADA');
    emitidos.length = 0;

    perderElPase(m.id);
    await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(fila(m.id).status).toBe('ACTIVA');
    expect(fila(m.id).pausedAt).toBeNull();
    expect(saldo(m.id)).toBe(CUPO_MENSUAL);
    expect(emitidos.map((e) => e.evento)).toEqual(['PASS_CREATED']);
  });
});

// ── 7. Consumir —y devolver— del mes que no es ─────────────────────────────

describe('el cupo de un mes no se gasta ni se devuelve contra otro', () => {
  it('anular en la ventana previa al cron no acumula sobre el mes nuevo', async () => {
    // El caso feo del día 1: el cajero deshace un café del 30 de septiembre a
    // las 00:30 del 1 de octubre, antes de que pase el cron. La devolución
    // toca el saldo VIEJO; el reinicio ASIGNA, no suma, así que no quedan 11.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const c = await svc.consumir(CAJERO, m.id, 1);
    expect(saldo(m.id)).toBe(9);

    vi.setSystemTime(new Date('2026-10-01T05:30:00Z'));
    await svc.anularConsumo(CAJERO, c.consumoId);
    await svc.reiniciarCupos();

    expect(saldo(m.id)).toBe(CUPO_MENSUAL);
    expect(fila(m.id).periodo).toBe('2026-10');
  });

  it('el café del 1 de octubre sale del cupo de octubre, no del sobrante', async () => {
    // Lo que evita: que el sobrante de septiembre se acumulara sobre el cupo
    // nuevo. El socio termina septiembre con 6 y aun así octubre son 10.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 4);

    vi.setSystemTime(new Date('2026-10-01T05:30:00Z'));
    await svc.consumir(CAJERO, m.id, 1);

    expect(saldo(m.id)).toBe(9);
    const octubre = await svc.consumosDelPlan(DUENO, 'p1');
    expect(octubre.periodo).toBe('2026-10');
    expect(octubre.entregadas).toBe(1);
  });
});

describe('FUGA — anular no caduca ni cuadra', () => {
  it('un cajero cómplice recarga el cupo tantas veces como quiera', async () => {
    // `anularConsumo` sólo mira que el consumo no esté ya anulado y que el
    // período coincida. No hay ventana de tiempo, ni tope, ni comprobación de
    // que el café no saliera de la máquina. Consumir 10 y deshacerlo dentro
    // del mismo mes devuelve el cupo entero, y se repite sin límite: aquí son
    // 50 cafés entregados con el saldo intacto en 10.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const c = await svc.consumir(CAJERO, m.id, 10);
      await svc.anularConsumo(CAJERO, c.consumoId);
    }

    expect(saldo(m.id)).toBe(CUPO_MENSUAL);
    expect(entregados()).toBe(50);
    expect(enPesos(50 - CUPO_MENSUAL)).toBe(240_000);
  });

  it('y el informe con el que el negocio cuadra YA NO suma los anulados', async () => {
    // `entregadas` agrega TODAS las líneas del período, anuladas incluidas.
    // Es el número que existe para responder «cuánto cobro contra cuánto
    // entrego», así que en cuanto hay una anulación ya no responde nada: ni
    // sirve para el cajero honesto (dice 3 donde no salió ningún café) ni
    // delata al deshonesto (dice 3 donde salieron 3 y se cobraron 0).
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const c = await svc.consumir(CAJERO, m.id, 3);
    await svc.anularConsumo(CAJERO, c.consumoId);

    const r = await svc.consumosDelPlan(DUENO, 'p1');
    // Cero: las tres líneas están anuladas y el cupo volvió entero al pase, así
    // que el negocio no entregó nada. Antes decía 3 — el mismo número con el
    // que cruza lo cobrado contra lo entregado, y el que un cajero cómplice
    // podría usar para esconder una recarga.
    expect(r.entregadas).toBe(0);
    expect(r.consumos[0].anuladoEn).not.toBeNull();
    expect(saldo(m.id)).toBe(CUPO_MENSUAL); // el cupo volvió: no se entregó nada
  });
});
