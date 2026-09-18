import { describe, it, expect } from 'vitest';
import {
  CLAVE_ULTIMA_PASADA,
  VENTANA_POR_DEFECTO,
  dentroDeLaVentana,
  describirVentana,
  leerVentana,
  normalizarVentana,
} from './ventana-de-envio';
import { horaLocal } from '../automations/hora-local';

/**
 * El ciclo de cobro sale a una hora decente y UNA sola vez al día.
 *
 * EL BUG (Javier, 2026-09-18): «envía mensajes SÚPER TARDE, 11 de la noche, y
 * no tengo cómo arreglar eso». El cron decía `EVERY_DAY_AT_3AM` y el servidor
 * va en UTC: las 03:00 UTC son las 22:00 de Bogotá. En producción, TODOS los
 * avisos de cobro de los últimos días salieron a las 22:00.
 *
 * Lo que se prueba aquí:
 *  1. que las 03:00 UTC eran de verdad las 10 de la noche (el caso que falló);
 *  2. que la ventana por defecto cae en horario de oficina;
 *  3. que un ajuste corrupto NO deja el ciclo sin correr ni lo manda de noche;
 *  4. que dos procesos a la vez —lo que pasa en CADA despliegue— no duplican.
 */

const BOGOTA = 'America/Bogota';

describe('la hora a la que salía el ciclo de cobro', () => {
  it('las 03:00 UTC del cron viejo eran las 22:00 de Bogotá', () => {
    // Este es el caso que el cliente vivió: «llegan a las 11 de la noche».
    expect(horaLocal(new Date('2026-09-18T03:00:00Z'), BOGOTA)).toBe(22);
  });

  it('con la ventana nueva, a las 03:00 UTC ya no se envía', () => {
    const h = horaLocal(new Date('2026-09-18T03:00:00Z'), BOGOTA);
    expect(dentroDeLaVentana(h, VENTANA_POR_DEFECTO)).toBe(false);
  });

  it('se envía a media mañana, que es cuando debe', () => {
    // 14:00 UTC = 09:00 en Bogotá.
    const h = horaLocal(new Date('2026-09-18T14:00:00Z'), BOGOTA);
    expect(h).toBe(9);
    expect(dentroDeLaVentana(h, VENTANA_POR_DEFECTO)).toBe(true);
  });

  it('la ventana tiene margen: si se pierde el primer tick, el siguiente sirve', () => {
    // Un despliegue con healthcheck puede comerse la hora en punto.
    for (const utc of ['14:00', '15:00', '16:00', '17:00']) {
      const h = horaLocal(new Date(`2026-09-18T${utc}:00Z`), BOGOTA);
      expect(dentroDeLaVentana(h, VENTANA_POR_DEFECTO)).toBe(true);
    }
    // Y a las 18:00 UTC (13:00 Bogotá) ya se cerró: `hasta` no se incluye.
    expect(dentroDeLaVentana(horaLocal(new Date('2026-09-18T18:00:00Z'), BOGOTA), VENTANA_POR_DEFECTO)).toBe(false);
  });
});

describe('el ajuste de la ventana', () => {
  it('acepta una franja válida', () => {
    expect(normalizarVentana({ desde: 10, hasta: 12, zona: 'America/Mexico_City' }))
      .toEqual({ desde: 10, hasta: 12, zona: 'America/Mexico_City' });
  });

  it('una franja al revés no se guarda: sería no enviar nunca', () => {
    expect(normalizarVentana({ desde: 20, hasta: 8 })).toMatchObject({
      desde: VENTANA_POR_DEFECTO.desde,
      hasta: VENTANA_POR_DEFECTO.hasta,
    });
  });

  it('una franja vacía (desde = hasta) tampoco', () => {
    expect(normalizarVentana({ desde: 9, hasta: 9 })).toMatchObject({ desde: 9, hasta: 13 });
  });

  it('horas fuera de rango o basura caen al valor de fábrica', () => {
    for (const malo of [{ desde: -1, hasta: 5 }, { desde: 9, hasta: 99 }, { desde: 'abc', hasta: 'def' }, {}]) {
      const v = normalizarVentana(malo);
      expect(v.desde).toBe(VENTANA_POR_DEFECTO.desde);
      expect(v.hasta).toBe(VENTANA_POR_DEFECTO.hasta);
    }
  });

  it('una zona que Intl no entiende no rompe nada', () => {
    expect(normalizarVentana({ desde: 9, hasta: 13, zona: 'Marte/Olympus' }).zona).toBe(BOGOTA);
  });

  it('un JSON ilegible en la base NO deja el ciclo sin correr', () => {
    // Si esto devolviera algo inválido, el cobro no se reclamaría y nadie se
    // suspendería: un ajuste roto no puede parar el dinero.
    const v = leerVentana('{esto no es json');
    expect(v).toEqual(VENTANA_POR_DEFECTO);
    expect(dentroDeLaVentana(9, v)).toBe(true);
  });

  it('sin nada guardado, usa el de fábrica', () => {
    expect(leerVentana(null)).toEqual(VENTANA_POR_DEFECTO);
    expect(leerVentana('')).toEqual(VENTANA_POR_DEFECTO);
  });

  it('se describe de forma legible para el panel', () => {
    expect(describirVentana({ desde: 9, hasta: 13, zona: BOGOTA }))
      .toBe('de 09:00 a 13:00 (America/Bogota)');
  });
});

/**
 * El candado del día, tal y como lo hace el servicio: `upsert` para asegurar
 * la fila y `updateMany` condicional mirando el `count`.
 *
 * Se reproduce aquí sobre un doble de Prisma porque instanciar `BillingService`
 * entero arrastra media aplicación. Lo que importa es la CARRERA, y eso es el
 * `updateMany`: en Postgres un UPDATE sobre una fila es atómico, así que de dos
 * procesos solo uno ve `count === 1`.
 */
function baseDeAjustes() {
  const filas = new Map<string, string>();
  return {
    filas,
    setting: {
      upsert: async ({ where, create }: any) => {
        if (!filas.has(where.key)) filas.set(where.key, create.value);
        return { key: where.key, value: filas.get(where.key) };
      },
      updateMany: async ({ where, data }: any) => {
        const actual = filas.get(where.key);
        if (actual === undefined) return { count: 0 };
        if (where.value?.not !== undefined && actual === where.value.not) return { count: 0 };
        filas.set(where.key, data.value);
        return { count: 1 };
      },
    },
  };
}

async function reclamarElDia(prisma: any, diaLocal: string): Promise<boolean> {
  await prisma.setting.upsert({
    where: { key: CLAVE_ULTIMA_PASADA },
    update: {},
    create: { key: CLAVE_ULTIMA_PASADA, value: '' },
  });
  const claim = await prisma.setting.updateMany({
    where: { key: CLAVE_ULTIMA_PASADA, value: { not: diaLocal } },
    data: { value: diaLocal },
  });
  return claim.count === 1;
}

describe('una sola pasada al día', () => {
  it('el primer tick de la ventana se lleva el día y el resto no', async () => {
    const p = baseDeAjustes();
    expect(await reclamarElDia(p, '2026-09-18')).toBe(true);
    expect(await reclamarElDia(p, '2026-09-18')).toBe(false);
    expect(await reclamarElDia(p, '2026-09-18')).toBe(false);
  });

  it('DOS PROCESOS A LA VEZ (un despliegue) no duplican el ciclo', async () => {
    // En cada despliegue Railway mantiene vivo el contenedor viejo hasta que el
    // nuevo pasa el healthcheck: hay dos procesos con el cron armado. Sin este
    // candado, todos los recordatorios y avisos de mora salen DOS veces.
    const p = baseDeAjustes();
    const resultados = await Promise.all([
      reclamarElDia(p, '2026-09-18'),
      reclamarElDia(p, '2026-09-18'),
      reclamarElDia(p, '2026-09-18'),
    ]);
    expect(resultados.filter(Boolean)).toHaveLength(1);
  });

  it('al día siguiente vuelve a correr', async () => {
    const p = baseDeAjustes();
    expect(await reclamarElDia(p, '2026-09-18')).toBe(true);
    expect(await reclamarElDia(p, '2026-09-19')).toBe(true);
  });

  it('el primer día tras desplegar SÍ corre (la fila no existía)', async () => {
    // `updateMany` no crea filas: sin el `upsert` previo, el ciclo no correría
    // nunca y nadie se enteraría hasta que alguien no pagara.
    const p = baseDeAjustes();
    expect(p.filas.has(CLAVE_ULTIMA_PASADA)).toBe(false);
    expect(await reclamarElDia(p, '2026-09-18')).toBe(true);
  });
});
