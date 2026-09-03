import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import type { TramoAlta } from './club-periodo';
import {
  bdVacia,
  crearPrismaFalso,
  crearBilletera,
  crearAutomatizaciones,
  type BaseDeDatos,
  type FilaMembresia,
  type FilaPase,
  type Ganchos,
} from './club-prisma-falso';

/**
 * UN AÑO ENTERO de un club de café, mes a mes, contra el `ClubService` REAL.
 *
 * `club-reinicio.spec.ts` prueba UNA transición de mes. Aquí se encadenan doce,
 * con socios que se comportan distinto, para cazar lo que solo se ve con el
 * tiempo: derivas de un beneficio al mes, meses que se pierden en silencio y
 * números de informe que se van separando de la realidad.
 *
 * Los tests marcados `DESVIACIÓN` fijan a propósito el comportamiento MALO: si
 * alguien lo arregla se ponen rojos y hay que venir a borrarlos. Cada uno
 * explica qué se desvía y en qué mes aparece.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@negocio.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};

let bd: BaseDeDatos;
let ganchos: Ganchos;
let empujados: Array<{ passId: string; motivo: string }>;
let svc: ClubService;

function montar() {
  bd = bdVacia();
  const falso = crearPrismaFalso(bd);
  ganchos = falso.ganchos;
  const billetera = crearBilletera();
  empujados = billetera.empujados;
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    crearAutomatizaciones().automations as unknown as AutomationsService,
  );
}

/**
 * Congela el reloj en una hora de BOGOTÁ.
 *
 * Se escribe con el desfase explícito (`-05:00`) en vez de en UTC porque todo lo
 * que se prueba aquí depende de que el mes se cuente en Bogotá: poner «17:00Z»
 * y confiar en que son las 12 obliga a hacer la resta de cabeza en cada caso, y
 * es justo donde se cuelan los errores. Colombia no tiene horario de verano, así
 * que -05:00 vale los doce meses.
 */
function enBogota(fecha: string, hora = '12:00') {
  vi.setSystemTime(new Date(`${fecha}T${hora}:00-05:00`));
}

const dos = (n: number) => String(n).padStart(2, '0');
const periodoDelMes = (mes: number, anio = 2026) => `${anio}-${dos(mes)}`;

function filaDe(membresiaId: string): FilaMembresia {
  const m = bd.membresias.find((x) => x.id === membresiaId);
  if (!m) throw new Error(`no existe la membresía ${membresiaId}`);
  return m;
}

function paseDe(passId: string): FilaPase {
  const p = bd.pases.find((x) => x.id === passId);
  if (!p) throw new Error(`no existe el pase ${passId}`);
  return p;
}

/** Lo que se llevó una membresía en un mes, según `ClubConsumo`. */
function consumidoEn(membresiaId: string, periodo: string) {
  return bd.consumos
    .filter((c) => c.membresiaId === membresiaId && c.periodo === periodo)
    .reduce((t, c) => t + c.cantidad, 0);
}

async function crearPlanDeCafe(beneficiosPorMes = 10, tramos: TramoAlta[] = []) {
  return svc.crearPlan(DUENO, {
    name: 'Café Diario',
    beneficiosPorMes,
    unidad: 'café',
    precioCents: 6_000_000,
    currency: 'COP',
    description: 'Un café al día, todos los días.',
    tramos,
  });
}

async function altaDe(planId: string, clave: string, nombre: string) {
  bd.clientes.push({ id: `cli-${clave}`, tenantId: 't1', fullName: nombre });
  const alta = await svc.darDeAlta(DUENO, planId, `cli-${clave}`);
  // `darDeAlta` declara `passId` nullable porque una de sus salidas es la
  // membresía que ya existía. En un alta nueva siempre viene, y estrecharlo
  // aquí evita el `!` en las cuarenta llamadas de abajo.
  if (!alta.passId) throw new Error(`el alta de ${clave} salió sin pase`);
  return { ...alta, passId: alta.passId };
}

/** Reparte el consumo del mes entre tres visitas al local. */
function visitas(total: number): number[] {
  if (total <= 0) return [0, 0, 0];
  const base = Math.floor(total / 3);
  return [base, base, total - 2 * base];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  enBogota('2026-01-02');
  montar();
});
afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Doce meses seguidos ────────────────────────────────────────────────

type Perfil = {
  clave: string;
  nombre: string;
  /** Cuántos cafés intenta llevarse cada mes que está activo. */
  porMes: number;
  /** Meses (1-12) en los que el negocio lo tiene pausado por impago. */
  pausadoEn?: number[];
};

const PERFILES: Perfil[] = [
  { clave: 'todo', nombre: 'Ana (se lo bebe todo)', porMes: 10 },
  { clave: 'mitad', nombre: 'Beto (se bebe la mitad)', porMes: 5 },
  { clave: 'fantasma', nombre: 'Caro (no aparece nunca)', porMes: 0 },
  {
    clave: 'pausa',
    nombre: 'Dani (se pausa marzo, abril y mayo)',
    porMes: 4,
    pausadoEn: [3, 4, 5],
  },
];

type Anio = {
  planId: string;
  ids: Record<string, string>;
  pases: Record<string, string>;
  /** Cuántas veces se le ASIGNÓ el cupo del mes, alta incluida. */
  cupos: Record<string, number>;
  consumido: Record<string, number>;
  /** El saldo más alto que llegó a tener el pase en todo el año. */
  saldoMaximo: Record<string, number>;
  reiniciadasPorMes: number[];
};

/**
 * Corre el año entero: alta en enero, cron el día 1 de cada mes a las 08:00 y
 * tres visitas al local los días 5, 12 y 20.
 *
 * Las aserciones que van DENTRO del bucle son las que de verdad cazan una
 * deriva: comprobado solo al final, un mes que reparte 20 y otro que reparte 0
 * se compensan y el total cuadra igual.
 */
async function simularAnio(cupoMensual = 10): Promise<Anio> {
  const plan = await crearPlanDeCafe(cupoMensual);
  const r: Anio = {
    planId: plan.id,
    ids: {},
    pases: {},
    cupos: {},
    consumido: {},
    saldoMaximo: {},
    reiniciadasPorMes: [],
  };

  // Enero: las cuatro altas. El alta YA reparte el cupo del primer mes, así que
  // cuenta como uno de los doce.
  enBogota('2026-01-02');
  for (const p of PERFILES) {
    const alta = await altaDe(plan.id, p.clave, p.nombre);
    r.ids[p.clave] = alta.id;
    r.pases[p.clave] = alta.passId;
    r.cupos[p.clave] = 1;
    r.consumido[p.clave] = 0;
    r.saldoMaximo[p.clave] = alta.saldo;
    expect(alta.saldo).toBe(cupoMensual);
  }

  for (let mes = 1; mes <= 12; mes++) {
    const periodo = periodoDelMes(mes);

    if (mes > 1) {
      // El negocio pasa la cuenta a principio de mes: pausa a los que no
      // pagaron y reactiva a los que se pusieron al día. Antes del cron, que es
      // el orden real.
      enBogota(`${periodo}-01`, '07:00');
      for (const p of PERFILES) {
        const debe = p.pausadoEn?.includes(mes) ?? false;
        const esta = filaDe(r.ids[p.clave]).status === 'PAUSADA';
        if (debe !== esta) {
          await svc.cambiarEstado(
            DUENO,
            r.ids[p.clave],
            debe ? 'PAUSADA' : 'ACTIVA',
          );
        }
      }

      enBogota(`${periodo}-01`, '08:00');
      const antes = new Map(
        PERFILES.map((p) => [p.clave, filaDe(r.ids[p.clave]).periodo]),
      );
      const paso = await svc.reiniciarCupos();
      expect(paso.periodo).toBe(periodo);
      r.reiniciadasPorMes.push(paso.reiniciadas);

      for (const p of PERFILES) {
        const f = filaDe(r.ids[p.clave]);
        if (f.periodo !== antes.get(p.clave)) r.cupos[p.clave] += 1;

        if (f.status === 'ACTIVA') {
          // ASIGNA, no suma: aunque no gastara nada el mes pasado empieza en el
          // cupo exacto. Un `+=` en el reinicio se vería aquí como 20.
          expect(f.periodo).toBe(periodo);
          expect(f.cupoDelPeriodo).toBe(cupoMensual);
          expect(paseDe(r.pases[p.clave]).stampsCount).toBe(cupoMensual);
        } else {
          // Pausado: ni cupo ni avance de período. Congelado donde estaba.
          expect(f.periodo).not.toBe(periodo);
        }
      }
    }

    for (let i = 0; i < 3; i++) {
      const dia = [5, 12, 20][i];
      enBogota(`${periodo}-${dos(dia)}`, '10:00');
      for (const p of PERFILES) {
        const pausado = p.pausadoEn?.includes(mes) ?? false;
        if (pausado) {
          // Se acerca al mostrador igual: la caja tiene que frenarlo.
          await expect(svc.consumir(DUENO, r.ids[p.clave], 1)).rejects.toThrow(
            /pausada/i,
          );
          continue;
        }
        const cuanto = visitas(p.porMes)[i];
        if (cuanto === 0) continue;
        const res = await svc.consumir(DUENO, r.ids[p.clave], cuanto);
        r.consumido[p.clave] += cuanto;
        r.saldoMaximo[p.clave] = Math.max(r.saldoMaximo[p.clave], res.saldo);
      }
    }

    // Cierre del mes: lo asignado tiene que ser exactamente lo gastado más lo
    // que queda vivo. Si alguna vez no cuadra hay una unidad creada o perdida
    // por el camino — que es la fuga que busca todo este fichero.
    for (const p of PERFILES) {
      const f = filaDe(r.ids[p.clave]);
      if (f.periodo !== periodo) continue;
      expect(f.cupoDelPeriodo).toBe(
        consumidoEn(r.ids[p.clave], periodo) +
          paseDe(r.pases[p.clave]).stampsCount,
      );
    }
  }

  return r;
}

describe('doce meses seguidos', () => {
  it('cada socio recibe un cupo por mes VIVIDO: ni acumula ni pierde', async () => {
    const a = await simularAnio();

    // Doce cupos para los tres que estuvieron activos los doce meses.
    expect(a.cupos.todo).toBe(12);
    expect(a.cupos.mitad).toBe(12);
    expect(a.cupos.fantasma).toBe(12);
    // Y NUEVE para el que estuvo tres meses pausado: los meses que no pagó ni se
    // le deben ni se le acumulan. Es lo que hace que pausar sirva de algo; si
    // aquí saliera 12, pausar sería gratis.
    expect(a.cupos.pausa).toBe(9);

    // Nadie llegó nunca a tener más de un cupo en el pase. Con un reinicio que
    // sumara en vez de asignar, Caro —que no aparece nunca— habría cerrado
    // diciembre con 120.
    for (const p of PERFILES) {
      expect(a.saldoMaximo[p.clave]).toBeLessThanOrEqual(10);
    }

    expect(a.consumido.todo).toBe(120);
    expect(a.consumido.mitad).toBe(60);
    expect(a.consumido.fantasma).toBe(0);
    expect(a.consumido.pausa).toBe(36); // 4 × los 9 meses que estuvo dentro

    // Saldo al cerrar el año. Caro no gastó nada en doce meses y termina con 10,
    // no con 120: lo no gastado CADUCA cada mes.
    expect(paseDe(a.pases.todo).stampsCount).toBe(0);
    expect(paseDe(a.pases.mitad).stampsCount).toBe(5);
    expect(paseDe(a.pases.fantasma).stampsCount).toBe(10);
    expect(paseDe(a.pases.pausa).stampsCount).toBe(6);
  });

  it('el cron reinicia solo a los activos, mes a mes', async () => {
    const a = await simularAnio();
    // Febrero 4, marzo-mayo 3 (Dani pausado), junio-diciembre 4.
    expect(a.reiniciadasPorMes).toEqual([4, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4]);
    expect(a.reiniciadasPorMes.reduce((t, n) => t + n, 0)).toBe(41);
    // 41 reinicios + 4 altas = 45 cupos repartidos en el año.
    expect(Object.values(a.cupos).reduce((t, n) => t + n, 0)).toBe(45);
  });

  it('el socio pausado se queda con lo suyo congelado, no en cero', async () => {
    // Pausar no confisca: Dani termina enero con 6 y en abril sigue con 6.
    // Ponerlo a cero al pausar sería la lectura fácil y es la equivocada — pagó
    // enero entero.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const alta = await altaDe(plan.id, 'dani', 'Dani');
    enBogota('2026-01-10');
    await svc.consumir(DUENO, alta.id, 4);
    enBogota('2026-02-01', '07:00');
    await svc.cambiarEstado(DUENO, alta.id, 'PAUSADA');

    for (const mes of [2, 3, 4]) {
      enBogota(`${periodoDelMes(mes)}-01`, '08:00');
      expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
      expect(paseDe(alta.passId).stampsCount).toBe(6);
      expect(filaDe(alta.id).periodo).toBe('2026-01');
    }

    enBogota('2026-05-01', '07:00');
    await svc.cambiarEstado(DUENO, alta.id, 'ACTIVA');
    enBogota('2026-05-01', '08:00');
    await svc.reiniciarCupos();
    expect(paseDe(alta.passId).stampsCount).toBe(10); // uno, no cuatro
  });
});

// ── 2. Los bordes del mes, en hora de Bogotá ──────────────────────────────

describe('los bordes del mes se cuentan en Bogotá, no en UTC', () => {
  it('el 31 a las 23:59 de Bogotá aún es el mes viejo; el 1 a las 00:01, el nuevo', async () => {
    // Las dos horas caen en febrero UTC (04:59Z y 05:01Z del día 1). Contando en
    // UTC, el reinicio entraría en la primera y el cliente perdería el último
    // café de un mes que ya pagó.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-01-10');
    await svc.consumir(DUENO, alta.id, 7);

    enBogota('2026-01-31', '23:59');
    expect(new Date().toISOString()).toBe('2026-02-01T04:59:00.000Z');
    expect(await svc.reiniciarCupos()).toEqual({
      periodo: '2026-01',
      reiniciadas: 0,
    });
    // Y ese café de las 23:59 sale del cupo de ENERO y se contabiliza en enero.
    await svc.consumir(DUENO, alta.id, 1);
    expect(bd.consumos.at(-1)!.periodo).toBe('2026-01');
    expect(paseDe(alta.passId).stampsCount).toBe(2);

    enBogota('2026-02-01', '00:01');
    expect(new Date().toISOString()).toBe('2026-02-01T05:01:00.000Z');
    expect(await svc.reiniciarCupos()).toEqual({
      periodo: '2026-02',
      reiniciadas: 1,
    });
    expect(paseDe(alta.passId).stampsCount).toBe(10);
  });

  it('el 30 de septiembre a las 20:00 ya es 1 de octubre en UTC, y sigue siendo septiembre', async () => {
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');

    // Se llega hasta septiembre corriendo el cron cada mes.
    for (let mes = 2; mes <= 9; mes++) {
      enBogota(`${periodoDelMes(mes)}-01`, '08:00');
      await svc.reiniciarCupos();
    }

    enBogota('2026-09-30', '20:00');
    expect(new Date().toISOString()).toBe('2026-10-01T01:00:00.000Z');
    expect(await svc.reiniciarCupos()).toMatchObject({ periodo: '2026-09' });
    const antes = paseDe(alta.passId).stampsCount;
    await svc.consumir(DUENO, alta.id, 1);
    // El café de la noche del 30 sale del cupo de septiembre y se cuenta en
    // septiembre. En UTC habría cobrado dos veces: le robaría uno a octubre y
    // dejaría el informe de septiembre corto.
    expect(bd.consumos.at(-1)!.periodo).toBe('2026-09');
    expect(paseDe(alta.passId).stampsCount).toBe(antes - 1);

    // Cinco horas después ya es octubre en Bogotá y el reinicio entra.
    enBogota('2026-10-01', '00:05');
    await svc.consumir(DUENO, alta.id, 1);
    expect(bd.consumos.at(-1)!.periodo).toBe('2026-10');
    expect(paseDe(alta.passId).stampsCount).toBe(9); // reinicio perezoso: 10 − 1
  });

  it('el salto de año no se salta un mes ni cuenta dos', async () => {
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-12-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');

    enBogota('2026-12-31', '23:59');
    expect(await svc.reiniciarCupos()).toMatchObject({
      periodo: '2026-12',
      reiniciadas: 0,
    });
    enBogota('2027-01-01', '00:00');
    expect(await svc.reiniciarCupos()).toMatchObject({
      periodo: '2027-01',
      reiniciadas: 1,
    });
    expect(filaDe(alta.id).periodo).toBe('2027-01');
  });
});

// ── 3. Febrero, y los tramos que apuntan a días que no existen ────────────

describe('febrero y los meses cortos', () => {
  it('febrero de 28 días entrega su cupo como cualquier otro mes', async () => {
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-02-03');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-02-28', '23:59');
    expect(await svc.reiniciarCupos()).toMatchObject({
      periodo: '2026-02',
      reiniciadas: 0,
    });
    enBogota('2026-03-01', '00:30');
    expect(await svc.reiniciarCupos()).toMatchObject({
      periodo: '2026-03',
      reiniciadas: 1,
    });
    expect(paseDe(alta.passId).stampsCount).toBe(10);
  });

  it('el 29 de febrero bisiesto no adelanta marzo ni lo duplica', async () => {
    // 2028 es bisiesto. El día extra tiene que ser un día más de febrero, no un
    // mes nuevo: reiniciar el 29 daría trece cupos ese año.
    const plan = await crearPlanDeCafe(10);
    enBogota('2028-02-01');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2028-02-10');
    await svc.consumir(DUENO, alta.id, 8);

    enBogota('2028-02-29', '23:59');
    expect(await svc.reiniciarCupos()).toMatchObject({
      periodo: '2028-02',
      reiniciadas: 0,
    });
    expect(paseDe(alta.passId).stampsCount).toBe(2);
    enBogota('2028-03-01', '00:30');
    expect(await svc.reiniciarCupos()).toMatchObject({
      periodo: '2028-03',
      reiniciadas: 1,
    });
  });

  it('los doce meses de 2028 dan doce cupos, con bisiesto incluido', async () => {
    const plan = await crearPlanDeCafe(10);
    enBogota('2028-01-02');
    await altaDe(plan.id, 'ana', 'Ana');
    let cupos = 1;
    for (let mes = 2; mes <= 12; mes++) {
      enBogota(`${periodoDelMes(mes, 2028)}-01`, '08:00');
      cupos += (await svc.reiniciarCupos()).reiniciadas;
    }
    expect(cupos).toBe(12);
  });

  it('DESVIACIÓN: en febrero el tramo del 29 al 31 no se aplica NUNCA', async () => {
    // El negocio parte el mes: 1-15 → 10, 16-28 → 4, 29-31 → 1. La intención es
    // «al que entra el último día apenas le doy uno».
    //
    // En enero funciona. En un febrero de 28 días el día 29 no existe, así que
    // quien se da de alta el ÚLTIMO día del mes cae en el tramo 16-28 y se lleva
    // 4 en vez de 1: cuatro veces lo previsto, por una cuota completa.
    // `errorDeTramos` no avisa porque los tramos son válidos — el problema es el
    // calendario, no la configuración.
    const tramos: TramoAlta[] = [
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 28, beneficios: 4 },
      { desdeDia: 29, hastaDia: 31, beneficios: 1 },
    ];
    const plan = await crearPlanDeCafe(10, tramos);

    enBogota('2026-01-31');
    expect((await altaDe(plan.id, 'ene', 'Alta del 31 de enero')).saldo).toBe(1);

    enBogota('2026-02-28');
    const febrero = await altaDe(plan.id, 'feb', 'Alta del último día de febrero');
    expect(febrero.saldo).toBe(4); // debería ser 1: es el último día del mes

    // En abril, de 30 días, el tramo sí alcanza al último día.
    enBogota('2026-04-30');
    expect((await altaDe(plan.id, 'abr', 'Alta del 30 de abril')).saldo).toBe(1);
  });

  it('DESVIACIÓN: un tramo que acaba el 30 regala el cupo ENTERO cada día 31', async () => {
    // Tramos 1-15 → 10 y 16-30 → 3: el negocio da por hecho que cubrió el mes.
    // El día 31 queda sin tramo y `cupoDeAlta` devuelve el cupo COMPLETO
    // —decisión deliberada, «mejor regalar de más que dejar en cero a quien
    // pagó»—, así que quien entra el 31 recibe 10 por un día.
    //
    // Con el año delante deja de ser una anécdota: 2026 tiene SIETE días 31
    // (enero, marzo, mayo, julio, agosto, octubre y diciembre). Siete altas al
    // triple de lo previsto, y el negocio no lo ve por ningún lado.
    const plan = await crearPlanDeCafe(10, [
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 30, beneficios: 3 },
    ]);

    enBogota('2026-01-30');
    expect((await altaDe(plan.id, 'a', 'Alta del 30')).saldo).toBe(3);
    enBogota('2026-01-31');
    expect((await altaDe(plan.id, 'b', 'Alta del 31')).saldo).toBe(10);
    enBogota('2026-03-31');
    expect((await altaDe(plan.id, 'c', 'Otra alta del 31')).saldo).toBe(10);
  });
});

// ── 4. El cron que no corre ───────────────────────────────────────────────

describe('el cron que se cae', () => {
  it('saltarse un mes entero da UN cupo al volver, no dos', async () => {
    // El proceso estuvo caído todo marzo. Al volver el 1 de abril, el cron
    // compara el período GUARDADO con el ACTUAL y no cuenta meses: reparte uno.
    // Si contara los transcurridos, cada caída del servicio se pagaría en café
    // regalado.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-02-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-02-10');
    await svc.consumir(DUENO, alta.id, 10);
    expect(paseDe(alta.passId).stampsCount).toBe(0);

    // Marzo entero sin una sola pasada del cron.
    enBogota('2026-04-01', '08:00');
    expect(await svc.reiniciarCupos()).toMatchObject({
      periodo: '2026-04',
      reiniciadas: 1,
    });
    expect(paseDe(alta.passId).stampsCount).toBe(10); // no 20
    expect(filaDe(alta.id).periodo).toBe('2026-04');
  });

  it('saltarse TRES meses tampoco acumula: sigue siendo uno', async () => {
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-02-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-02-10');
    await svc.consumir(DUENO, alta.id, 10);

    enBogota('2026-06-01', '08:00');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 1 });
    expect(paseDe(alta.passId).stampsCount).toBe(10); // no 40
  });

  it('DESVIACIÓN: el mes que el cron se salta se pierde y no queda rastro', async () => {
    // La otra cara de lo anterior. El socio pagó marzo y en marzo no recibió
    // nada: `ClubConsumo` de marzo está vacío y la membresía salta de «2026-02»
    // a «2026-04». Nadie —ni el negocio ni nosotros— tiene forma de saber que
    // hubo un mes sin repartir: no se guarda el histórico de períodos asignados,
    // solo el último.
    //
    // El reinicio perezoso de `consumir` tapa el caso normal (basta con que el
    // socio pase por el local), así que esto solo muerde cuando el proceso
    // estuvo caído de verdad — y entonces muerde en silencio.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-02-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');

    enBogota('2026-04-01', '08:00');
    await svc.reiniciarCupos();

    expect(filaDe(alta.id).periodo).toBe('2026-04');
    const marzo = await svc.consumosDelPlan(DUENO, plan.id, {
      periodo: '2026-03',
    });
    expect(marzo.entregadas).toBe(0);
    expect(marzo.total).toBe(0);
    expect(bd.consumos.filter((c) => c.periodo === '2026-03')).toHaveLength(0);
  });

  it('si el proceso vive pero el cron no dispara, el consumo repone el cupo solo', async () => {
    // La red de seguridad de verdad: `consumir` reinicia de forma perezosa. El
    // socio que llega el 3 de marzo con el cron parado desde febrero NO se queda
    // sin su cupo, y el consumo se contabiliza en marzo, no en febrero.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-02-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-02-20');
    await svc.consumir(DUENO, alta.id, 10);

    enBogota('2026-03-03');
    const r = await svc.consumir(DUENO, alta.id, 2);
    expect(r.saldo).toBe(8);
    expect(r.cupoDelPeriodo).toBe(10);
    expect(filaDe(alta.id).periodo).toBe('2026-03');
    expect(bd.consumos.at(-1)!.periodo).toBe('2026-03');

    // Y cuando el cron por fin vuelve no le da otro: el período ya está al día.
    enBogota('2026-03-03', '13:00');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(paseDe(alta.passId).stampsCount).toBe(8);
  });

  it('DESVIACIÓN: al socio que se queda sin pase no le vuelve a llegar un cupo, y nadie avisa', async () => {
    // `ClubMembresia.pass` es `onDelete: SetNull`. Si el pase desaparece (se le
    // rehace la tarjeta, se borra por otra vía) la membresía queda ACTIVA y sin
    // `passId`, y el cron filtra por `passId: { not: null }`. A partir de ahí el
    // socio sigue pagando y no recibe NADA, mes tras mes, sin un log ni un
    // contador. La salida existe —volver a darlo de alta— pero hay que saber que
    // hace falta, y nada lo dice.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');

    filaDe(alta.id).passId = null;

    let reinicios = 0;
    for (let mes = 2; mes <= 12; mes++) {
      enBogota(`${periodoDelMes(mes)}-01`, '08:00');
      reinicios += (await svc.reiniciarCupos()).reiniciadas;
    }
    expect(reinicios).toBe(0); // once meses sin un solo cupo
    expect(filaDe(alta.id).status).toBe('ACTIVA'); // y sigue figurando como socio
    expect(filaDe(alta.id).periodo).toBe('2026-01');
    await expect(svc.consumir(DUENO, alta.id, 1)).rejects.toThrow(
      /todavía no tiene tarjeta/,
    );
  });
});

// ── 5. El cron corriendo de más ───────────────────────────────────────────

describe('el cron corriendo de más', () => {
  it('veinticuatro pasadas al día, doce meses: siguen siendo doce cupos', async () => {
    // El cron es HORARIO: en un año son 8760 pasadas y solo 12 pueden repartir.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');

    let repartidos = 1; // el alta
    for (let mes = 2; mes <= 12; mes++) {
      for (let hora = 0; hora < 24; hora++) {
        enBogota(`${periodoDelMes(mes)}-01`, `${dos(hora)}:00`);
        repartidos += (await svc.reiniciarCupos()).reiniciadas;
      }
      // Tras 24 pasadas el saldo es UN cupo, no veinticuatro.
      expect(paseDe(alta.passId).stampsCount).toBe(10);
    }
    expect(repartidos).toBe(12);
  });

  it('dos pasadas concurrentes reparten un cupo, no dos', async () => {
    // La carrera real: dos instancias del backend con el mismo cron a las 00:00.
    // Se fuerza parando la pasada A justo ANTES de marcar el período nuevo y
    // dejando entrar entera a la B. El `updateMany` condicionado al período
    // viejo es lo único que separa esto de un cupo doble.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const socios = [];
    for (const c of ['a', 'b', 'c']) {
      socios.push(await altaDe(plan.id, c, `Socio ${c}`));
    }
    enBogota('2026-01-15');
    for (const s of socios) await svc.consumir(DUENO, s.id, 6);

    enBogota('2026-02-01', '00:00');
    let deLaOtra = 0;
    ganchos.antesDeAvanzarPeriodo = async () => {
      deLaOtra = (await svc.reiniciarCupos()).reiniciadas;
    };
    const mia = await svc.reiniciarCupos();

    expect(deLaOtra).toBe(3);
    expect(mia.reiniciadas).toBe(0); // la lenta no vuelve a asignar nada
    for (const s of socios) expect(paseDe(s.passId).stampsCount).toBe(10);
  });

  it('dos pasadas lanzadas a la vez tampoco duplican', async () => {
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const socios = [];
    for (const c of ['a', 'b', 'c', 'd']) {
      socios.push(await altaDe(plan.id, c, `Socio ${c}`));
    }
    enBogota('2026-02-01', '00:00');
    const [x, y] = await Promise.all([
      svc.reiniciarCupos(),
      svc.reiniciarCupos(),
    ]);
    expect(x.reiniciadas + y.reiniciadas).toBe(4);
    for (const s of socios) expect(paseDe(s.passId).stampsCount).toBe(10);
  });

  it('la pasada del cron no pisa lo que el socio ya gastó ese mismo mes', async () => {
    // Escenario de las 00:20: el socio ya se tomó su café de octubre por el
    // reinicio perezoso y el cron llega después. Sin comparar el período, le
    // devolvería los cafés ya servidos.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-09-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-10-01', '00:10');
    await svc.consumir(DUENO, alta.id, 3);
    expect(paseDe(alta.passId).stampsCount).toBe(7);
    enBogota('2026-10-01', '00:20');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(paseDe(alta.passId).stampsCount).toBe(7);
  });
});

// ── 6. El negocio toca el plan a lo largo del año ─────────────────────────

describe('el negocio cambia el plan a lo largo del año', () => {
  it('los cambios de cupo entran el mes siguiente, nunca a mitad de mes', async () => {
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');

    const cupoPorMes: number[] = [];
    for (let mes = 1; mes <= 12; mes++) {
      if (mes > 1) {
        enBogota(`${periodoDelMes(mes)}-01`, '08:00');
        await svc.reiniciarCupos();
      }
      cupoPorMes.push(filaDe(alta.id).cupoDelPeriodo);

      enBogota(`${periodoDelMes(mes)}-10`);
      if (mes === 3) {
        await svc.actualizarPlan(DUENO, plan.id, { beneficiosPorMes: 15 });
      }
      if (mes === 7) {
        await svc.actualizarPlan(DUENO, plan.id, { beneficiosPorMes: 4 });
      }
      if (mes === 9) {
        await svc.actualizarPlan(DUENO, plan.id, { precioCents: 9_000_000 });
      }
      if (mes === 10) await svc.actualizarPlan(DUENO, plan.id, { unidad: 'bebida' });
      if (mes === 11) await svc.actualizarPlan(DUENO, plan.id, { isActive: false });
      if (mes === 12) await svc.actualizarPlan(DUENO, plan.id, { isActive: true });

      // El cambio de mitad de mes NO toca el mes en curso: el socio conserva el
      // cupo con el que empezó y su «llevas 6 de 10» sigue siendo cierto.
      expect(filaDe(alta.id).cupoDelPeriodo).toBe(cupoPorMes[mes - 1]);
    }

    // Marzo se paga con el cupo viejo y abril ya con el nuevo. Julio, igual.
    expect(cupoPorMes).toEqual([10, 10, 10, 15, 15, 15, 15, 4, 4, 4, 4, 4]);
  });

  it('apagar el plan en noviembre no le corta el cupo al que ya está dentro', async () => {
    // `isActive:false` solo cierra las altas nuevas. Cortar el cupo aquí le
    // quitaría en silencio lo que el socio pagó; para cerrar el club está «dar
    // de baja a todos», que es explícito y dice a cuántos afecta.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-11-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-11-10');
    await svc.actualizarPlan(DUENO, plan.id, { isActive: false });

    enBogota('2026-12-01', '08:00');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 1 });
    expect(paseDe(alta.passId).stampsCount).toBe(10);
    // Pero sí cierra la puerta a socios nuevos.
    bd.clientes.push({ id: 'cli-nuevo', tenantId: 't1', fullName: 'Nuevo' });
    await expect(svc.darDeAlta(DUENO, plan.id, 'cli-nuevo')).rejects.toThrow(
      /apagado/i,
    );
  });

  it('solo se reenvía el pase cuando cambia algo que se VE en él', async () => {
    // Con 3000 socios, tocar la descripción o el interruptor mandaría 3000
    // pushes a Apple y Google por algo que nadie nota.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-01-02');
    await altaDe(plan.id, 'ana', 'Ana');
    const pushes = () =>
      empujados.filter((e) => e.motivo === 'club.plan.editado').length;

    await svc.actualizarPlan(DUENO, plan.id, { beneficiosPorMes: 15 });
    expect(pushes()).toBe(1);
    await svc.actualizarPlan(DUENO, plan.id, { precioCents: 9_000_000 });
    expect(pushes()).toBe(1); // el precio no sale en el pase
    await svc.actualizarPlan(DUENO, plan.id, { description: 'Otra cosa' });
    expect(pushes()).toBe(1);
    await svc.actualizarPlan(DUENO, plan.id, { isActive: false });
    expect(pushes()).toBe(1);
    await svc.actualizarPlan(DUENO, plan.id, { unidad: 'bebida' });
    expect(pushes()).toBe(2); // la unidad sí
    await svc.actualizarPlan(DUENO, plan.id, { name: 'Club del Café' });
    expect(pushes()).toBe(3);
    // Reescribir el mismo valor no es un cambio.
    await svc.actualizarPlan(DUENO, plan.id, { name: 'Club del Café' });
    expect(pushes()).toBe(3);
  });

  it('DESVIACIÓN: bajar el cupo en julio deja la billetera diciendo «15 / 4»', async () => {
    // `actualizarPlan` sincroniza `Card.stampsRequired` con el cupo nuevo AL
    // INSTANTE, pero el saldo del socio (que vive en `Pass.stampsCount`) no se
    // toca hasta el mes siguiente — y con razón: quitárselo a mitad de mes sería
    // robarle lo que pagó.
    //
    // El resultado es que la billetera pinta el saldo sobre un denominador que
    // ya no le corresponde. Al SUBIR el cupo la sincronización arregla el
    // «15 / 10» que había antes; al BAJARLO crea el problema simétrico y peor:
    // «15 / 4» en la tarjeta durante veinte días. Aparece en JULIO en la
    // simulación del año, y en cualquier mes en que un negocio recorte el plan.
    const plan = await crearPlanDeCafe(15);
    enBogota('2026-07-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    expect(paseDe(alta.passId).stampsCount).toBe(15);

    enBogota('2026-07-10');
    await svc.actualizarPlan(DUENO, plan.id, { beneficiosPorMes: 4 });

    const tarjeta = bd.tarjetas.find((c) => c.clubPlanId === plan.id)!;
    expect(tarjeta.stampsRequired).toBe(4);
    expect(paseDe(alta.passId).stampsCount).toBe(15);
    // Lo que el socio ve en el móvil: quince de cuatro.
    expect(paseDe(alta.passId).stampsCount).toBeGreaterThan(
      tarjeta.stampsRequired,
    );
    // Y el texto del premio ya miente respecto a lo que tiene este mes.
    expect(tarjeta.rewardText).toBe('4 café al mes');
    // Puede seguir gastando los 15, y eso sí está bien.
    const r = await svc.consumir(DUENO, alta.id, 15);
    expect(r.saldo).toBe(0);
    expect(r.cupoDelPeriodo).toBe(15);

    // En agosto se recoloca solo.
    enBogota('2026-08-01', '08:00');
    await svc.reiniciarCupos();
    expect(paseDe(alta.passId).stampsCount).toBe(4);
  });
});

// ── 7. Cuadre final ───────────────────────────────────────────────────────

describe('cuadre del año', () => {
  it('lo que dice el informe mes a mes es lo que salió de los pases', async () => {
    const a = await simularAnio();

    let entregadasSegunElInforme = 0;
    for (let mes = 1; mes <= 12; mes++) {
      const periodo = periodoDelMes(mes);
      const informe = await svc.consumosDelPlan(DUENO, a.planId, { periodo });
      entregadasSegunElInforme += informe.entregadas;
      expect(informe.unidad).toBe('café');
      // El informe de cada mes cuadra con lo que descontó cada pase ese mes.
      const delMes = PERFILES.reduce(
        (t, p) => t + consumidoEn(a.ids[p.clave], periodo),
        0,
      );
      expect(informe.entregadas).toBe(delMes);
    }

    const consumidoDeVerdad = Object.values(a.consumido).reduce(
      (t, n) => t + n,
      0,
    );
    expect(consumidoDeVerdad).toBe(216);
    expect(entregadasSegunElInforme).toBe(216);

    // Y el cuadre grande: 45 cupos de 10 asignados en el año.
    const asignado = Object.values(a.cupos).reduce((t, n) => t + n, 0) * 10;
    const vivoAlCerrar = PERFILES.reduce(
      (t, p) => t + paseDe(a.pases[p.clave]).stampsCount,
      0,
    );
    expect(asignado).toBe(450);
    expect(vivoAlCerrar).toBe(21);
    // Lo que caducó: ni se entregó ni sigue vivo. 213 de 450, casi la mitad.
    // No es un fallo —el cupo no se acumula, es la regla del producto— pero es
    // el número que no se le enseña al negocio en ninguna pantalla.
    expect(asignado - consumidoDeVerdad - vivoAlCerrar).toBe(213);
  });

  it('el informe NO cuenta como entregado lo que se anuló', async () => {
    // `consumosDelPlan` suma `cantidad` de TODAS las filas del período, sin
    // excluir las que llevan `revertedAt`. El cupo sí vuelve al pase, así que el
    // socio no pierde nada — pero el número que el negocio usa para cruzar lo
    // que cobra contra lo que entrega («entregadas») se queda alto.
    //
    // Con una anulación al mes, el informe del año sobra por doce. Y cruzar
    // cobrado contra entregado es LA pregunta que este módulo existe para
    // responder.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-03-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-03-05');
    const uno = await svc.consumir(DUENO, alta.id, 1);
    await svc.consumir(DUENO, alta.id, 1);
    await svc.consumir(DUENO, alta.id, 1);
    expect(paseDe(alta.passId).stampsCount).toBe(7);

    // El cajero se equivocó en el primero y lo deshace.
    const anulacion = await svc.anularConsumo(DUENO, uno.consumoId);
    expect(anulacion.devuelto).toBe(1);
    expect(paseDe(alta.passId).stampsCount).toBe(8);

    const informe = await svc.consumosDelPlan(DUENO, plan.id, {
      periodo: '2026-03',
    });
    // Del pase salieron DOS cafés (10 → 8) y el informe dice dos. Antes decía
    // tres: sumaba también la línea anulada, así que cada corrección del cajero
    // inflaba dos veces el número con el que el negocio cruza lo que cobra
    // contra lo que entrega. Cuanto más cuidadoso corrigiendo, peor la cuenta.
    expect(10 - paseDe(alta.passId).stampsCount).toBe(2);
    expect(informe.entregadas).toBe(2);
    // Las tres líneas SÍ se listan: el histórico no se esconde, solo deja de
    // sumar la anulada.
    expect(informe.total).toBe(3);
    // La fila sí trae la marca, así que la pantalla PUEDE distinguirla: el que
    // no la mira es el agregado.
    expect(informe.consumos.filter((c) => c.anuladoEn != null)).toHaveLength(1);
  });

  it('anular un consumo de un mes cerrado no devuelve nada, y está bien: ya se entregó', async () => {
    // Un café servido el 30 de septiembre no se puede «devolver» en octubre: el
    // cupo de septiembre ya caducó, y devolvérselo saldría del de octubre.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-09-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-09-30', '22:00');
    const tarde = await svc.consumir(DUENO, alta.id, 1);

    enBogota('2026-10-01', '08:00');
    await svc.reiniciarCupos();
    const r = await svc.anularConsumo(DUENO, tarde.consumoId);
    expect(r.devuelto).toBe(0);
    expect(r.motivo).toBe('consumo de un período anterior');
    expect(paseDe(alta.passId).stampsCount).toBe(10); // ni 11
    // Y sigue contando en el informe de septiembre, que es donde se entregó.
    const sept = await svc.consumosDelPlan(DUENO, plan.id, {
      periodo: '2026-09',
    });
    expect(sept.entregadas).toBe(1);
  });

  it('al socio pausado la caja le enseña lo que tiene, no el cupo entero', async () => {
    // `resolverParaCaja` aplica el reinicio perezoso mirando solo el período y
    // NO el estado. Un socio pausado desde marzo, con 2 cafés reales en el pase,
    // aparece en la pantalla del cajero con «10 de 10».
    //
    // `puedeConsumir` sí sale en falso, así que no se entrega nada: el daño es
    // la discusión en el mostrador, y crece cuanto más lleve pausado.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-03-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-03-05');
    await svc.consumir(DUENO, alta.id, 8);
    enBogota('2026-03-20');
    await svc.cambiarEstado(DUENO, alta.id, 'PAUSADA');

    enBogota('2026-06-04');
    const vista = await svc.resolverParaCaja(DUENO, alta.passId);
    // El reinicio perezoso de la caja miraba solo el período, al revés que el
    // cron —que sí mira el estado— y que `consumir`. A un socio pausado desde
    // marzo le pintaba «10 de 10» con 2 en la tarjeta: no se entregaba nada,
    // pero el cajero tenía delante un número grande y un cliente mirándolo.
    expect(paseDe(alta.passId).stampsCount).toBe(2);
    expect(vista.saldo).toBe(2);
    expect(vista.status).toBe('PAUSADA');
    expect(vista.puedeConsumir).toBe(false);
  });

  it('con el reloj adelantado y corregido, el cron y el consumo van de acuerdo', async () => {
    // El cron busca `periodo: { lt: actual }` a propósito: una fila con período
    // FUTURO, por un reloj desajustado, no debe «reiniciarse» hacia atrás.
    // `consumir` comparaba con `!==`, así que para él un período futuro SÍ
    // tocaba reiniciar, y los dos guardias no decían lo mismo.
    //
    // Resultado: un servidor adelantado repartía el cupo de noviembre y, al
    // corregirse la hora, el primer café de septiembre volvía a rellenar el
    // pase. Tres cupos donde iba uno, con una sola cuota pagada — y bastaba un
    // contenedor con la hora mal un rato, sin recuperarse solo.
    //
    // Ahora los dos usan `<`: el período futuro se respeta hasta que el
    // calendario lo alcance.
    const plan = await crearPlanDeCafe(10);
    enBogota('2026-09-02');
    const alta = await altaDe(plan.id, 'ana', 'Ana');
    enBogota('2026-09-10');
    await svc.consumir(DUENO, alta.id, 7);
    expect(paseDe(alta.passId).stampsCount).toBe(3);

    // El reloj se va a noviembre y el cron reparte.
    enBogota('2026-11-01', '08:00');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 1 });
    expect(filaDe(alta.id).periodo).toBe('2026-11');
    expect(paseDe(alta.passId).stampsCount).toBe(10);

    // Se corrige la hora. El cron ya no la toca — eso es correcto.
    enBogota('2026-09-15');
    expect(await svc.reiniciarCupos()).toEqual({
      periodo: '2026-09',
      reiniciadas: 0,
    });

    // …y el consumo tampoco: la fila se queda en noviembre y se descuenta de
    // lo que hay, sin reponer nada. El socio no recibe un tercer cupo.
    const r = await svc.consumir(DUENO, alta.id, 1);
    expect(filaDe(alta.id).periodo).toBe('2026-11');
    expect(r.saldo).toBe(9); // 10 del reparto de noviembre, menos este
    expect(filaDe(alta.id).cupoDelPeriodo).toBe(10);
    // El café se apunta al mes REAL, aunque la fila lleve el período futuro:
    // el período del consumo sale de la fecha, no de la membresía.
    expect(bd.consumos.filter((c) => c.periodo === '2026-09')).toHaveLength(2);
  });
});
