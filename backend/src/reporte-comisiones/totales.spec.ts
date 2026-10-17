import { describe, it, expect } from 'vitest';
import {
  claveDeVenta,
  consolidar,
  estadoDeLiquidacion,
  porMes,
  sumaDeIndividuales,
  totalesDe,
  type FilaParaTotales,
} from './totales';

let n = 0;
const fila = (p: Partial<FilaParaTotales>): FilaParaTotales => ({
  id: `c${n++}`,
  codeId: 'ana',
  equipo: 'CLOSERS',
  estado: 'APROBADA',
  amount: 10,
  amountPaid: 0,
  ventaUsd: 68,
  ventaClave: 't:neg1|2026-10',
  esAjuste: false,
  ...p,
});

describe('una venta con varias comisiones no multiplica lo vendido', () => {
  it('influencer + embajador + socio del mismo cobro = UNA venta de $68', () => {
    const filas = [
      fila({ codeId: 'inf', amount: 3.4 }),
      fila({ codeId: 'emb', amount: 10.2 }),
      // La fila del socio puede venir sin base congelada.
      fila({ codeId: 'socio', equipo: 'SOCIOS', amount: 6.8, ventaUsd: 0 }),
    ];
    const t = totalesDe(filas);
    expect(t.ventas).toBe(1);
    expect(t.vendidoUsd).toBe(68);
    expect(t.comisionesUsd).toBe(20.4);
  });

  it('dos cobros del mismo negocio son dos ventas', () => {
    const t = totalesDe([fila({ ventaClave: 't:neg1|2026-09' }), fila({ ventaClave: 't:neg1|2026-10' })]);
    expect(t.ventas).toBe(2);
    expect(t.vendidoUsd).toBe(136);
  });

  it('la comisión de equipo y la manual no son ventas', () => {
    const base = { id: 'x', tenantId: null, businessGroupId: null, businessDate: null, createdAt: '2026-10-01' };
    expect(claveDeVenta({ ...base, periodKey: 'EQUIPO-2026-10-15', esManual: false })).toBeNull();
    expect(claveDeVenta({ ...base, tenantId: 't1', periodKey: 'MANUAL-2026-10-abc', esManual: true })).toBeNull();
    expect(claveDeVenta({ ...base, tenantId: 't1', periodKey: '2026-10', esManual: false })).toBe('t:t1|2026-10');
    expect(claveDeVenta({ ...base, periodKey: null, esManual: false, ingresoId: 'i9' })).toBe('i:i9');
  });
});

describe('el total general es la suma de los individuales', () => {
  // Montos con decimales feos a propósito: en coma flotante, sumar 0.1 muchas
  // veces deja colas que no cuadran.
  const filas: FilaParaTotales[] = [];
  const personas = ['ana', 'luis', 'sara', 'javier', null];
  for (let i = 0; i < 300; i++) {
    const estados = ['GENERADA', 'APROBADA', 'PENDIENTE_PAGO', 'PAGADA', 'RETENIDA', 'REVERSADA', 'EN_REVISION'] as const;
    const estado = estados[i % estados.length];
    const amount = Math.round((0.1 + (i % 17) * 1.37) * 100) / 100;
    filas.push(
      fila({
        codeId: personas[i % personas.length],
        equipo: i % 3 === 0 ? 'SOCIOS' : i % 3 === 1 ? 'CLOSERS' : 'ADMINISTRACION',
        estado,
        amount,
        amountPaid: estado === 'PAGADA' ? amount : estado === 'PENDIENTE_PAGO' && i % 2 ? 0.3 : 0,
        esAjuste: i % 11 === 0,
        // 37 es primo con 5 personas: cada venta la comparten varias.
        ventaClave: `t:n${i % 37}|2026-10`,
      }),
    );
  }
  const { general, porColaborador, porEquipo } = consolidar(filas);

  it('comisiones, ajustes, pagado y saldo cuadran al centavo', () => {
    const suma = sumaDeIndividuales(porColaborador);
    expect(suma.comisionesUsd).toBe(general.comisionesUsd);
    expect(suma.ajustesUsd).toBe(general.ajustesUsd);
    expect(suma.pagadoUsd).toBe(general.pagadoUsd);
    expect(suma.saldoUsd).toBe(general.saldoUsd);
  });

  it('los equipos también suman el general', () => {
    const s = Object.values(porEquipo).reduce((a, t) => a + Math.round(t.comisionesUsd * 100), 0) / 100;
    expect(s).toBe(general.comisionesUsd);
  });

  it('las filas sin destinatario no se esconden del total', () => {
    expect(porColaborador.has('—')).toBe(true);
  });

  it('el vendido general no es la suma de los vendidos individuales cuando comparten venta', () => {
    const suma = [...porColaborador.values()].reduce((a, t) => a + t.vendidoUsd, 0);
    expect(general.vendidoUsd).toBeLessThan(suma);
    expect(general.ventas).toBe(37);
  });
});

describe('dinero de las reversadas', () => {
  it('cuentan en su tarjeta pero no en el dinero', () => {
    const t = totalesDe([fila({ estado: 'REVERSADA', amount: 50 }), fila({ amount: 10 })]);
    expect(t.porEstado.REVERSADA).toEqual({ cantidad: 1, montoUsd: 50 });
    expect(t.comisionesUsd).toBe(10);
    expect(t.saldoUsd).toBe(10);
  });
});

describe('estado de liquidación', () => {
  it('pagado entero → liquidado; con abono → parcial; en corte → en corte', () => {
    expect(estadoDeLiquidacion(totalesDe([fila({ estado: 'PAGADA', amountPaid: 10 })]))).toBe('LIQUIDADO');
    expect(estadoDeLiquidacion(totalesDe([fila({ estado: 'PENDIENTE_PAGO', amountPaid: 4 })]))).toBe('PARCIAL');
    expect(estadoDeLiquidacion(totalesDe([fila({ estado: 'PENDIENTE_PAGO' })]))).toBe('EN_CORTE');
    expect(estadoDeLiquidacion(totalesDe([fila({ estado: 'GENERADA' })]))).toBe('PENDIENTE');
    expect(estadoDeLiquidacion(totalesDe([fila({ estado: 'REVERSADA' })]))).toBe('SIN_SALDO');
  });
});

describe('barras por mes en hora Bogotá', () => {
  it('el 1 de noviembre a las 02:00 UTC todavía es octubre en Bogotá', () => {
    const m = porMes([
      { fecha: '2026-11-01T02:00:00Z', amount: 5, estado: 'APROBADA' },
      { fecha: '2026-11-02T12:00:00Z', amount: 7, estado: 'PAGADA' },
      { fecha: '2026-11-02T12:00:00Z', amount: 99, estado: 'REVERSADA' },
    ]);
    expect(m).toEqual([
      { mes: '2026-10', comisionesUsd: 5, pagadoUsd: 0 },
      { mes: '2026-11', comisionesUsd: 7, pagadoUsd: 7 },
    ]);
  });
});
