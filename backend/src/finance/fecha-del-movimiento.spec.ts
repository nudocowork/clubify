import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  diaPorDefecto,
  fechaDentroDelPeriodo,
  hoyEnBogota,
  instanteDelDia,
} from './fecha-del-movimiento';
import { ExpenseService } from './expense.service';

/**
 * El caso que lo motivó: estando en mayo de 2026 se creaba un egreso y quedaba
 * guardado en septiembre, porque el formulario no pedía fecha y el backend caía
 * a `new Date()`.
 */

/** 24 de septiembre de 2026, 15:00 UTC = 10:00 en Bogotá. */
const HOY = new Date('2026-09-24T15:00:00.000Z');

describe('qué día es hoy en Bogotá', () => {
  it('a media mañana, el mismo día', () => {
    expect(hoyEnBogota(HOY)).toBe('2026-09-24');
  });

  it('a las 2 de la madrugada UTC todavía es el día ANTERIOR en Bogotá', () => {
    // Justo el borde que hace que un movimiento se cuente en el mes que no es.
    expect(hoyEnBogota(new Date('2026-10-01T02:00:00.000Z'))).toBe('2026-09-30');
  });
});

describe('el día que se guarda', () => {
  it('se guarda al mediodía de Bogotá, no a medianoche UTC', () => {
    // A medianoche UTC, el 1 de mayo es todavía 30 de abril en Bogotá: el
    // egreso se contaría en abril.
    expect(instanteDelDia('2026-05-01')?.toISOString()).toBe('2026-05-01T17:00:00.000Z');
  });

  it('un día que no existe se rechaza en vez de correrse al mes siguiente', () => {
    expect(instanteDelDia('2026-02-31')).toBeNull();
    expect(instanteDelDia('2026-13-01')).toBeNull();
    expect(instanteDelDia('mayo')).toBeNull();
  });
});

describe('si la fecha pertenece al período', () => {
  it('el mes', () => {
    expect(fechaDentroDelPeriodo('2026-05-15', '2026-05')).toBe(true);
    expect(fechaDentroDelPeriodo('2026-09-15', '2026-05')).toBe(false);
  });

  it('los bordes del mes, que son los que fallaban', () => {
    expect(fechaDentroDelPeriodo('2026-05-01', '2026-05')).toBe(true);
    expect(fechaDentroDelPeriodo('2026-05-31', '2026-05')).toBe(true);
    expect(fechaDentroDelPeriodo('2026-04-30', '2026-05')).toBe(false);
    expect(fechaDentroDelPeriodo('2026-06-01', '2026-05')).toBe(false);
  });

  it('el trimestre y el año', () => {
    expect(fechaDentroDelPeriodo('2026-05-15', '2026-T2')).toBe(true);
    expect(fechaDentroDelPeriodo('2026-07-01', '2026-T2')).toBe(false);
    expect(fechaDentroDelPeriodo('2026-12-31', '2026')).toBe(true);
    expect(fechaDentroDelPeriodo('2025-12-31', '2026')).toBe(false);
  });

  it('sin período contra el que contrastar, no se le estorba a nadie', () => {
    expect(fechaDentroDelPeriodo('2026-05-15', 'todo')).toBe(true);
    expect(fechaDentroDelPeriodo('2026-05-15', '')).toBe(true);
    expect(fechaDentroDelPeriodo('2026-05-15', undefined)).toBe(true);
  });
});

describe('la fecha que trae puesta el formulario', () => {
  it('estando en mayo, NO es la de hoy', () => {
    // El corazón del fallo: hoy es septiembre y el formulario abría en septiembre.
    expect(diaPorDefecto('2026-05', HOY)).toBe('2026-05-01');
    expect(diaPorDefecto('2026-05', HOY)).not.toBe(hoyEnBogota(HOY));
  });

  it('estando en el mes en curso, sí es hoy', () => {
    expect(diaPorDefecto('2026-09', HOY)).toBe('2026-09-24');
  });

  it('en un trimestre o un año que ya pasó, su primer día', () => {
    expect(diaPorDefecto('2026-T1', HOY)).toBe('2026-01-01');
    expect(diaPorDefecto('2025', HOY)).toBe('2025-01-01');
  });

  it('en un período que contiene hoy, hoy', () => {
    expect(diaPorDefecto('2026-T3', HOY)).toBe('2026-09-24');
    expect(diaPorDefecto('2026', HOY)).toBe('2026-09-24');
  });

  it('en «todo», hoy', () => {
    expect(diaPorDefecto('todo', HOY)).toBe('2026-09-24');
  });
});

// ── El guardado, que es donde no se puede confiar solo en la pantalla ───────

function servicio() {
  const creados: any[] = [];
  const prisma: any = {
    expense: { create: async ({ data }: any) => { creados.push(data); return { id: 'e1', ...data }; } },
  };
  return { svc: new ExpenseService(prisma), creados };
}

const EGRESO = { concept: 'Meta Ads', amountUsd: 120 };

describe('guardar un egreso', () => {
  it('sin fecha NO se guarda: ya no cae a la de hoy', async () => {
    const { svc, creados } = servicio();
    await expect(svc.create({ ...EGRESO } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(creados).toEqual([]);
  });

  it('guarda el día que se pidió, no el de hoy', async () => {
    const { svc, creados } = servicio();
    await svc.create({ ...EGRESO, expenseDate: '2026-05-15', periodo: '2026-05' } as any);
    expect(creados[0].expenseDate.toISOString()).toBe('2026-05-15T17:00:00.000Z');
  });

  it('una fecha de otro período se RECHAZA', async () => {
    // Aunque la pantalla no avise: esta es la comprobación que no se puede saltar.
    const { svc, creados } = servicio();
    await expect(
      svc.create({ ...EGRESO, expenseDate: '2026-09-15', periodo: '2026-05' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(creados).toEqual([]);
  });

  it('…salvo que se confirme a propósito', async () => {
    const { svc, creados } = servicio();
    await svc.create({
      ...EGRESO,
      expenseDate: '2026-09-15',
      periodo: '2026-05',
      confirmarOtroPeriodo: true,
    } as any);
    expect(creados[0].expenseDate.toISOString()).toBe('2026-09-15T17:00:00.000Z');
  });

  it('sin período, la fecha explícita basta', async () => {
    const { svc, creados } = servicio();
    await svc.create({ ...EGRESO, expenseDate: '2026-05-15' } as any);
    expect(creados[0].expenseDate.toISOString()).toBe('2026-05-15T17:00:00.000Z');
  });

  it('un día inventado se rechaza', async () => {
    const { svc } = servicio();
    await expect(
      svc.create({ ...EGRESO, expenseDate: '2026-02-31' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
