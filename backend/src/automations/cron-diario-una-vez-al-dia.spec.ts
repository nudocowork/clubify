import { describe, it, expect } from 'vitest';
import { AutomationsService } from './automations.service';

/**
 * Los crons diarios salen a la hora del negocio, UNA vez al día, y sobreviven
 * a que haya dos procesos vivos a la vez.
 *
 * Tres cosas distintas que se prueban aquí, todas encontradas en revisión:
 *
 * 1. VENTANA, no punto exacto. Comparar `=== hora` no tiene recuperación: si
 *    el proceso no está vivo en el minuto 0 de esa hora (un despliegue con
 *    healthcheck de hasta 600 s, un crash, un OOM), esos negocios pierden el
 *    día entero. Antes ese agujero caía a las 3am, cuando nadie despliega;
 *    ahora cae a las 8 de la mañana, que es justo cuando se despliega.
 *
 * 2. CANDADO EN LA BASE, no en memoria. Durante un despliegue Railway mantiene
 *    el contenedor viejo hasta que el nuevo pasa el healthcheck: hay DOS
 *    procesos con el cron armado, cada uno con su propio `Map`. Si el solape
 *    cruza el minuto 0 de la hora local de un negocio, el saludo sale doble. Y
 *    el día que `numReplicas` pase de 1, saldría doble todos los días.
 *
 * 3. Una vez al día, pero AL DÍA SIGUIENTE otra vez.
 *
 * El `updateMany` del doble es atómico (sin ningún `await` dentro), que es lo
 * que hace Postgres con un UPDATE sobre una fila.
 */

const BOGOTA = 'America/Bogota';
/** 13:00 UTC = 08:00 en Bogotá (UTC-5). Hora objetivo de los cumpleaños. */
const A_LAS_8_EN_BOGOTA = new Date('2026-09-16T13:00:00Z');
/** 14:00 UTC = 09:00 en Bogotá. Hora objetivo del «te extrañamos». */
const A_LAS_9_EN_BOGOTA = new Date('2026-09-16T14:00:00Z');

/** Una "base de datos" compartida por todos los procesos del test. */
function base(negocios: Array<{ id: string; timezone?: string }>) {
  const tenants = new Map(
    negocios.map((t) => [
      t.id,
      {
        id: t.id,
        brandName: t.id,
        timezone: t.timezone ?? BOGOTA,
        ultimoCronCumpleanos: null as string | null,
        ultimoCronInactividad: null as string | null,
      },
    ]),
  );

  return {
    tenants,
    tenant: {
      findMany: async () => [...tenants.values()],
      // ATÓMICO: sin `await` dentro, como el UPDATE de una fila en Postgres.
      updateMany: async ({ where, data }: any) => {
        const t: any = tenants.get(where.id);
        if (!t) return { count: 0 };
        // where.OR = [{ campo: null }, { campo: { not: dia } }]
        const casa = (where.OR as any[]).some((cond) => {
          const [campo, esperado] = Object.entries(cond)[0] as [string, any];
          if (esperado === null) return t[campo] === null;
          return t[campo] !== esperado.not;
        });
        if (!casa) return { count: 0 };
        Object.assign(t, data);
        return { count: 1 };
      },
    },
  };
}

/** Un "proceso" del backend: su propio servicio, la misma base. */
function proceso(db: ReturnType<typeof base>, cumpleaneros: string[] = ['c1']) {
  const prisma: any = {
    tenant: db.tenant,
    $queryRaw: async () => cumpleaneros.map((id) => ({ id, fullName: id })),
    customer: {
      findMany: async () => cumpleaneros.map((id) => ({ id, fullName: id })),
    },
  };

  const svc = new AutomationsService(prisma, {} as any, {} as any, {} as any);
  const emitidos: Array<{ evento: string; tenantId: string; customerId: string }> = [];
  // `emit` es la puerta por la que sale el push/SMS/WA al cliente final.
  (svc as any).emit = async (evento: string, payload: any) => {
    emitidos.push({ evento, tenantId: payload.tenantId, customerId: payload.customerId });
  };
  return { svc, emitidos };
}

describe('la ventana horaria (recuperarse si el proceso no estaba vivo)', () => {
  // Objetos con $nombre en vez de %s posicional: con `%s` los marcadores
  // consumen los elementos EN ORDEN y el título salía desalineado («a las
  // 14:00Z (hora local 2026) dispara=9»). Un test cuyo nombre miente no se
  // puede interpretar el día que falle en CI.
  it.each([
    { utc: '13:00Z', iso: '2026-09-16T13:00:00Z', local: 8, dispara: true }, // la hora objetivo
    { utc: '14:00Z', iso: '2026-09-16T14:00:00Z', local: 9, dispara: true }, // se recupera una hora tarde
    { utc: '16:00Z', iso: '2026-09-16T16:00:00Z', local: 11, dispara: true }, // último tick de la ventana
    { utc: '12:00Z', iso: '2026-09-16T12:00:00Z', local: 7, dispara: false }, // todavía no
    { utc: '17:00Z', iso: '2026-09-16T17:00:00Z', local: 12, dispara: false }, // ya pasó la ventana
  ])('a las $utc (hora local $local) dispara=$dispara', async ({ iso, dispara }) => {
    const esperado = dispara;
    const db = base([{ id: 't1' }]);
    const p = proceso(db);

    // Se prueba el FILTRO con un instante fijo, no el cron entero: el cron usa
    // `new Date()` y un test que dependa del reloj de quien lo corre da verde
    // o rojo según la hora del día.
    const dentro = await (p.svc as any).negociosEnSuVentana(8, new Date(iso));

    expect(dentro.length > 0).toBe(esperado);
  });

  it('si el proceso estaba caído a las 8, a las 10 el negocio SIGUE recibiendo', async () => {
    const db = base([{ id: 't1' }]);
    // Nadie corrió a las 8 (proceso caído por un despliegue).
    const tarde = proceso(db);
    const dentro = await (tarde.svc as any).negociosEnSuVentana(
      8,
      new Date('2026-09-16T15:00:00Z'), // 10:00 en Bogotá
    );
    expect(dentro).toHaveLength(1);

    // Y al reclamar, se lo lleva: no se perdió el día.
    const mio = await (tarde.svc as any).reclamarDiaLocal(
      'ultimoCronCumpleanos',
      't1',
      '2026-09-16',
    );
    expect(mio).toBe(true);
  });
});

describe('dos procesos a la vez (el solape del despliegue)', () => {
  it('solo UNO de los dos emite, aunque cada uno tenga su propia memoria', async () => {
    const db = base([{ id: 't1' }]);
    const viejo = proceso(db); // contenedor que aún no ha muerto
    const nuevo = proceso(db); // contenedor que acaba de pasar el healthcheck

    await Promise.all([
      (viejo.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16'),
      (nuevo.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16'),
    ]).then(async ([a, b]) => {
      // Exactamente uno gana el claim.
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });
  });

  it('tres procesos tampoco multiplican el saludo', async () => {
    const db = base([{ id: 't1' }]);
    const ps = [proceso(db), proceso(db), proceso(db)];

    const ganados = await Promise.all(
      ps.map((p) =>
        (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16'),
      ),
    );

    expect(ganados.filter(Boolean)).toHaveLength(1);
  });

  it('el cron completo de cumpleaños, con dos procesos, emite a cada cliente UNA vez', async () => {
    const db = base([{ id: 't1' }]);
    const a = proceso(db, ['c1', 'c2']);
    const b = proceso(db, ['c1', 'c2']);

    await Promise.all([
      a.svc.cronBirthday(A_LAS_8_EN_BOGOTA),
      b.svc.cronBirthday(A_LAS_8_EN_BOGOTA),
    ]);

    const total = [...a.emitidos, ...b.emitidos];
    expect(total).toHaveLength(2); // c1 y c2, una vez cada uno
    expect(total.map((x) => x.customerId).sort()).toEqual(['c1', 'c2']);
  });

  it('el cron completo de inactividad tampoco duplica el «te extrañamos»', async () => {
    const db = base([{ id: 't1' }]);
    const a = proceso(db, ['c1']);
    const b = proceso(db, ['c1']);

    await Promise.all([
      a.svc.cronInactivity(A_LAS_9_EN_BOGOTA),
      b.svc.cronInactivity(A_LAS_9_EN_BOGOTA),
    ]);

    const total = [...a.emitidos, ...b.emitidos];
    expect(total).toHaveLength(1);
    expect(total[0].evento).toBe('INACTIVITY');
  });

  it('un solo proceso emite a todos sus clientes (el candado no apaga de más)', async () => {
    const db = base([{ id: 't1' }]);
    const p = proceso(db, ['c1', 'c2', 'c3']);

    await p.svc.cronBirthday(A_LAS_8_EN_BOGOTA);

    expect(p.emitidos).toHaveLength(3);
  });
});

describe('una vez al día, pero todos los días', () => {
  it('el mismo proceso no repite dentro del mismo día', async () => {
    const db = base([{ id: 't1' }]);
    const p = proceso(db);

    const primero = await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16');
    const segundo = await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16');

    expect(primero).toBe(true);
    expect(segundo).toBe(false);
  });

  it('al día siguiente vuelve a disparar', async () => {
    const db = base([{ id: 't1' }]);
    const p = proceso(db);

    await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16');
    const manana = await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-17');

    expect(manana).toBe(true);
  });

  it('cumpleaños e inactividad son candados independientes', async () => {
    const db = base([{ id: 't1' }]);
    const p = proceso(db);

    await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16');
    const inactividad = await (p.svc as any).reclamarDiaLocal('ultimoCronInactividad', 't1', '2026-09-16');

    // Reclamar el saludo de cumpleaños no puede apagar el «te extrañamos».
    expect(inactividad).toBe(true);
  });

  it('un negocio no le roba el día a otro', async () => {
    const db = base([{ id: 't1' }, { id: 't2' }]);
    const p = proceso(db);

    await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16');
    const otro = await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't2', '2026-09-16');

    expect(otro).toBe(true);
  });
});

describe('el primer día tras la migración (columna a NULL)', () => {
  it('con el candado en NULL el negocio reclama igual', async () => {
    const db = base([{ id: 't1' }]);
    expect(db.tenants.get('t1')!.ultimoCronCumpleanos).toBeNull();

    const p = proceso(db);
    const mio = await (p.svc as any).reclamarDiaLocal('ultimoCronCumpleanos', 't1', '2026-09-16');

    // Si el `OR` con null no estuviera, esto daría false y NADIE recibiría
    // nada el primer día — en los 126 negocios a la vez.
    expect(mio).toBe(true);
  });
});

describe('cada negocio en su hora', () => {
  it('a las 13Z entra el de Bogotá y no el de Ciudad de México', async () => {
    const db = base([
      { id: 'bogota', timezone: 'America/Bogota' }, // 08:00 → entra
      { id: 'mexico', timezone: 'America/Mexico_City' }, // 07:00 → aún no
    ]);
    const p = proceso(db);

    const dentro = await (p.svc as any).negociosEnSuVentana(8, A_LAS_8_EN_BOGOTA);

    expect(dentro.map((t: any) => t.id)).toEqual(['bogota']);
  });
});
