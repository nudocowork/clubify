import { describe, it, expect } from 'vitest';
import { PayrollService } from './payroll.service';
import { olvidarMarcaClubify } from './alcance-de-marca';

/**
 * La nómina se puede corregir (Sara, 2026-09-17).
 *
 *  1. «Los pagos de nómina no se pueden estandarizar para todos los meses: a un
 *     colaborador este mes su base pudo haber sido 100.000 y el próximo 300.000
 *     … se debe poder editar el monto o eliminar ese colaborador de por vida».
 *  2. Los tres colaboradores de producción se dieron de alta con el monto en
 *     PESOS (800.000, 875.000…) en un campo de dólares, y no había forma de
 *     editarlos.
 *
 * Y la «nómina próxima» sumaba una quincena como si fuera el mes entero.
 */

function base() {
  const empleados: any[] = [
    { id: 'sara', name: 'Sara', role: 'PM', payType: 'Fijo', amountUsd: 800000, periodicity: 'QUINCENAL', active: true, whiteLabelId: null, note: null },
    { id: 'samu', name: 'Samuel', role: 'Diseño', payType: 'Fijo', amountUsd: 875000, periodicity: 'MENSUAL', active: true, whiteLabelId: null, note: null },
  ];
  const cortes: any[] = [
    { id: 'c1', totalUsd: 500, amountPaidUsd: 500, status: 'PAID', paidAt: new Date('2026-09-15T12:00:00Z'), whiteLabelId: null, periodEnd: new Date('2026-09-15T12:00:00Z') },
    { id: 'c2', totalUsd: 300, amountPaidUsd: 0, status: 'PENDING', paidAt: null, whiteLabelId: null, periodEnd: new Date('2026-09-30T12:00:00Z') },
  ];
  const items: any[] = [
    { id: 'i1', runId: 'c1', employeeId: 'sara', employeeName: 'Sara', baseUsd: 300, bonusUsd: 0, deductionUsd: 0, totalUsd: 300 },
    { id: 'i2', runId: 'c1', employeeId: 'samu', employeeName: 'Samuel', baseUsd: 200, bonusUsd: 0, deductionUsd: 0, totalUsd: 200 },
    { id: 'i3', runId: 'c2', employeeId: 'samu', employeeName: 'Samuel', baseUsd: 300, bonusUsd: 0, deductionUsd: 0, totalUsd: 300 },
  ];
  const coincide = (fila: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'OR') return (v as any[]).some((w) => coincide(fila, w));
      if (v && typeof v === 'object' && 'lte' in v) return Number(fila[k]) <= v.lte;
      return fila[k] === v;
    });
  const prisma: any = {
    whiteLabel: { findFirst: async () => null },
    payrollEmployee: {
      findMany: async ({ where }: any = {}) =>
        empleados.filter((e) => (where?.AND ?? [where ?? {}]).every((w: any) => coincide(e, 'active' in (w ?? {}) ? { active: w.active } : {}))),
      update: async ({ where, data }: any) => Object.assign(empleados.find((e) => e.id === where.id), data),
      deleteMany: async ({ where }: any) => {
        const i = empleados.findIndex((e) => e.id === where.id);
        if (i < 0) return { count: 0 };
        empleados.splice(i, 1);
        return { count: 1 };
      },
    },
    payrollItem: {
      create: async ({ data }: any) => {
        const nuevo = { id: `i${items.length + 1}`, ...data };
        items.push(nuevo);
        return nuevo;
      },
      findFirst: async ({ where }: any) => items.find((it) => coincide(it, where)) ?? null,
      findMany: async ({ where }: any) => items.filter((it) => coincide(it, where)),
      update: async ({ where, data }: any) => Object.assign(items.find((it) => it.id === where.id), data),
      deleteMany: async ({ where }: any) => {
        const i = items.findIndex((it) => coincide(it, where));
        if (i < 0) return { count: 0 };
        items.splice(i, 1);
        return { count: 1 };
      },
    },
    payrollRun: {
      findMany: async () => cortes,
      findUnique: async ({ where }: any) => cortes.find((c) => c.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(cortes.find((c) => c.id === where.id), data),
      deleteMany: async ({ where }: any) => {
        const i = cortes.findIndex((c) => coincide(c, where));
        if (i < 0) return { count: 0 };
        cortes.splice(i, 1);
        return { count: 1 };
      },
    },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  olvidarMarcaClubify();
  return { svc: new PayrollService(prisma), empleados, cortes, items };
}

describe('colaboradores', () => {
  it('se puede corregir el monto que se puso en pesos', async () => {
    const { svc, empleados } = base();
    await svc.updateEmployee('samu', { amountUsd: 220 });
    expect(Number(empleados.find((e) => e.id === 'samu').amountUsd)).toBe(220);
  });

  it('editar una cosa no borra las demás', async () => {
    const { svc, empleados } = base();
    await svc.updateEmployee('sara', { role: 'Project Manager' });
    const sara = empleados.find((e) => e.id === 'sara');
    expect(sara.role).toBe('Project Manager');
    expect(sara.name).toBe('Sara');
    expect(sara.periodicity).toBe('QUINCENAL');
  });

  it('eliminarlo de por vida no borra lo que ya se le pagó', async () => {
    const { svc, empleados, items, cortes } = base();
    expect((await svc.deleteEmployee('samu')).ok).toBe(true);
    expect(empleados.map((e) => e.id)).toEqual(['sara']);
    expect(items.filter((it) => it.employeeName === 'Samuel')).toHaveLength(2);
    expect(cortes[0].totalUsd).toBe(500);
  });

  it('la nómina próxima cuenta DOS quincenas en el mes', async () => {
    const { svc } = base();
    const r = await svc.summary(true);
    // 800.000 × 2 (quincenal) + 875.000 (mensual).
    expect(r.nominaProximaUsd).toBe(2475000);
  });
});

describe('agregar a alguien a un corte ya generado', () => {
  it('si el corte está pendiente, entra ahí y el total sube', async () => {
    // Sara generó el corte del 1-15, le faltaba un colaborador y volvió a
    // generar: quedaron dos cortes iguales.
    const { svc, cortes, items } = base();
    const r = await svc.addRunItem('c2', { employeeName: 'Nicolas', baseUsd: 200 });
    expect(r.ok).toBe(true);
    expect(cortes[1].totalUsd).toBe(500);
    expect(items.filter((it) => it.runId === 'c2')).toHaveLength(2);
  });

  it('si el corte ya tiene abonos, NO se toca: va un corte aparte', async () => {
    const { svc, cortes, items } = base();
    const r = await svc.addRunItem('c1', { employeeName: 'Nicolas', baseUsd: 200 });
    expect(r).toMatchObject({ ok: false, motivo: 'ya-pagado' });
    expect(cortes[0].totalUsd).toBe(500);
    expect(items.filter((it) => it.runId === 'c1')).toHaveLength(2);
  });

  it('a la misma persona no se le mete dos veces en el mismo corte', async () => {
    // Samuel ya está en c2: agregarlo otra vez le pagaría el sueldo doble y el
    // corte saldría inflado sin que se vea de dónde.
    const { svc, cortes, items } = base();
    const r = await svc.addRunItem('c2', { employeeId: 'samu', employeeName: 'Samuel', baseUsd: 300 });
    expect(r).toMatchObject({ ok: false, motivo: 'ya-esta' });
    expect(cortes[1].totalUsd).toBe(300);
    expect(items.filter((it) => it.runId === 'c2')).toHaveLength(1);
  });

  it('tampoco si le corrigieron el nombre después de generar el corte', async () => {
    // El panel filtra a los que faltan por NOMBRE: renombrado, Samuel vuelve a
    // aparecer como faltante. El candado va por id, que es lo que no cambia.
    const { svc, cortes } = base();
    await svc.updateEmployee('samu', { name: 'Samuel Pérez' });
    const r = await svc.addRunItem('c2', { employeeId: 'samu', employeeName: 'Samuel Pérez', baseUsd: 300 });
    expect(r).toMatchObject({ ok: false, motivo: 'ya-esta' });
    expect(cortes[1].totalUsd).toBe(300);
  });

  it('a alguien que de verdad falta sí lo deja entrar', async () => {
    // El candado no puede pasarse de frenada: Sara no está en c2.
    const { svc, cortes } = base();
    const r = await svc.addRunItem('c2', { employeeId: 'sara', employeeName: 'Sara', baseUsd: 200 });
    expect(r.ok).toBe(true);
    expect(cortes[1].totalUsd).toBe(500);
  });

  it('un corte que no existe no crea nada', async () => {
    const { svc, items } = base();
    const antes = items.length;
    expect(await svc.addRunItem('no-existe', { employeeName: 'X', baseUsd: 1 })).toMatchObject({ ok: false });
    expect(items).toHaveLength(antes);
  });
});

describe('el monto de cada mes', () => {
  it('cambiar la base de alguien en un corte recalcula el total del corte', async () => {
    const { svc, cortes } = base();
    const r = await svc.updateRunItem('c2', 'i3', { baseUsd: 100 });
    expect(r.ok).toBe(true);
    expect(cortes[1].totalUsd).toBe(100);
    expect(cortes[1].status).toBe('PENDING');
  });

  it('subir el monto de un corte ya pagado lo deja con saldo, no «pagado»', async () => {
    const { svc, cortes } = base();
    await svc.updateRunItem('c1', 'i1', { baseUsd: 400 });
    expect(cortes[0].totalUsd).toBe(600);
    expect(cortes[0].status).toBe('PARTIAL');
    expect(cortes[0].paidAt).toBeNull();
  });

  it('bajar un corte ya abonado por debajo de lo pagado se rechaza y no cambia nada', async () => {
    const { svc, cortes, items } = base();
    await expect(svc.updateRunItem('c1', 'i1', { baseUsd: 100 })).rejects.toThrow(/ya se le abonaron/);
    // Nada quedó a medias: la transacción real se revierte; aquí el total no se recalculó.
    expect(cortes[0].totalUsd).toBe(500);
    expect(cortes[0].status).toBe('PAID');
    expect(items.find((it) => it.id === 'i1').totalUsd).toBeLessThanOrEqual(300);
  });

  it('quitar a alguien de un corte pagado por completo también se rechaza', async () => {
    const { svc } = base();
    await expect(svc.deleteRunItem('c1', 'i2')).rejects.toThrow(/ya se le abonaron/);
  });

  it('un corte con abono parcial que baja hasta lo pagado queda PAGADO y con fecha', async () => {
    const { svc, cortes } = base();
    Object.assign(cortes[1], { amountPaidUsd: 200, status: 'PARTIAL', paidAt: null });
    await svc.updateRunItem('c2', 'i3', { baseUsd: 200 });
    expect(cortes[1].status).toBe('PAID');
    expect(cortes[1].paidAt).toBeInstanceOf(Date);
  });

  it('bono y deducción se aplican sobre la base nueva', async () => {
    const { svc, items } = base();
    await svc.updateRunItem('c2', 'i3', { baseUsd: 250, bonusUsd: 50, deductionUsd: 20 });
    expect(items.find((it) => it.id === 'i3').totalUsd).toBe(280);
  });

  it('un ítem de otro corte no se toca', async () => {
    const { svc } = base();
    expect((await svc.updateRunItem('c2', 'i1', { baseUsd: 1 })).ok).toBe(false);
  });

  it('quitar a alguien de un corte sin abonos baja el total', async () => {
    const { svc, cortes, items } = base();
    items.push({ id: 'i4', runId: 'c2', employeeId: 'sara', employeeName: 'Sara', baseUsd: 50, bonusUsd: 0, deductionUsd: 0, totalUsd: 50 });
    cortes[1].totalUsd = 350;
    await svc.deleteRunItem('c2', 'i4');
    expect(cortes[1].totalUsd).toBe(300);
  });

  it('un corte sin abonos se puede borrar; uno con pagos, no', async () => {
    const { svc, cortes } = base();
    expect((await svc.deleteRun('c1')).ok).toBe(false);
    expect((await svc.deleteRun('c2')).ok).toBe(true);
    expect(cortes.map((c) => c.id)).toEqual(['c1']);
  });
});
