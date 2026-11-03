import { describe, expect, it } from 'vitest';
import { clasificarAbonos, leerDecision, type DecisionAbono } from './abonos';

const d = (s: string) => new Date(s);

describe('clasificación de abonos', () => {
  it('enlaza solo el abono con el restante pagado con el mismo correo', () => {
    const r = clasificarAbonos(
      [{ tx: 'A1', email: 'Santiago@Gmail.com ', fecha: d('2026-10-13') }],
      [{ tx: 'P1', email: 'santiago@gmail.com', fecha: d('2026-10-18') }],
      new Map(),
    );
    expect(r[0]).toEqual({ tx: 'A1', estado: 'ENLAZADO', pagoTx: 'P1', enlace: 'AUTOMATICO' });
  });

  it('sin restante queda en espera', () => {
    const r = clasificarAbonos([{ tx: 'A1', email: 'x@y.com', fecha: d('2026-10-13') }], [], new Map());
    expect(r[0].estado).toBe('EN_ESPERA');
  });

  it('un restante anterior al abono no cuenta', () => {
    const r = clasificarAbonos(
      [{ tx: 'A1', email: 'x@y.com', fecha: d('2026-10-13') }],
      [{ tx: 'P1', email: 'x@y.com', fecha: d('2026-09-01') }],
      new Map(),
    );
    expect(r[0].estado).toBe('EN_ESPERA');
  });

  it('un mismo restante no se enlaza a dos abonos', () => {
    const r = clasificarAbonos(
      [
        { tx: 'A1', email: 'x@y.com', fecha: d('2026-10-01') },
        { tx: 'A2', email: 'x@y.com', fecha: d('2026-10-02') },
      ],
      [{ tx: 'P1', email: 'x@y.com', fecha: d('2026-10-05') }],
      new Map(),
    );
    expect(r.map((x) => x.estado)).toEqual(['ENLAZADO', 'EN_ESPERA']);
  });

  it('el enlace manual reserva el pago y gana sobre el automático', () => {
    const decisiones = new Map<string, DecisionAbono>([
      ['A2', { estado: 'ENLAZADO', pagoTx: 'P1', fecha: '2026-10-06' }],
    ]);
    const r = clasificarAbonos(
      [
        { tx: 'A1', email: 'x@y.com', fecha: d('2026-10-01') },
        { tx: 'A2', email: 'otro@y.com', fecha: d('2026-10-02') },
      ],
      [{ tx: 'P1', email: 'x@y.com', fecha: d('2026-10-05') }],
      decisiones,
    );
    expect(r[0].estado).toBe('EN_ESPERA');
    expect(r[1]).toMatchObject({ estado: 'ENLAZADO', pagoTx: 'P1', enlace: 'MANUAL' });
  });

  it('«No pagará» cede si el cliente termina pagando', () => {
    const decisiones = new Map<string, DecisionAbono>([['A1', { estado: 'NO_PAGARA', fecha: '2026-10-02' }]]);
    const sinPago = clasificarAbonos([{ tx: 'A1', email: 'x@y.com', fecha: d('2026-10-01') }], [], decisiones);
    expect(sinPago[0].estado).toBe('NO_PAGARA');
    const conPago = clasificarAbonos(
      [{ tx: 'A1', email: 'x@y.com', fecha: d('2026-10-01') }],
      [{ tx: 'P1', email: 'x@y.com', fecha: d('2026-10-09') }],
      decisiones,
    );
    expect(conPago[0].estado).toBe('ENLAZADO');
  });

  it('una decisión ilegible se ignora', () => {
    expect(leerDecision('no-es-json')).toBeNull();
    expect(leerDecision('{"estado":"OTRO"}')).toBeNull();
  });
});
