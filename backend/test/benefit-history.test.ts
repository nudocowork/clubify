import { describe, it, expect } from 'vitest';
import { diffBenefit, actorOf } from '../src/cuponera/benefit-history';

/**
 * Diff del historial (spec §6). Lo que importa: que un update PARCIAL no
 * reporte como "cambiado" todo lo que ni siquiera se tocó, y que no invente
 * cambios donde el valor es el mismo escrito distinto.
 */
describe('diffBenefit', () => {
  it('registra el cambio con antes y después', () => {
    const d = diffBenefit({ percentOff: 30, title: 'A' }, { percentOff: 15 });
    expect(d).toEqual({ percentOff: { from: 30, to: 15 } });
  });

  it('un update parcial NO marca los campos que no vinieron', () => {
    const d = diffBenefit({ percentOff: 30, title: 'A', terms: 'x' }, { percentOff: 15 });
    expect(Object.keys(d)).toEqual(['percentOff']);
  });

  it('no inventa cambios cuando el valor es el mismo', () => {
    expect(diffBenefit({ title: 'A', percentOff: 15 }, { title: 'A', percentOff: 15 })).toEqual({});
  });

  it('ignora los campos que no se rastrean', () => {
    const d = diffBenefit({ redemptionCount: 1, id: 'x' }, { redemptionCount: 99, id: 'y' });
    expect(d).toEqual({});
  });

  it('compara fechas por instante, no por identidad de objeto', () => {
    const a = new Date('2026-08-24T05:00:00.000Z');
    const b = new Date('2026-08-24T05:00:00.000Z');
    expect(diffBenefit({ validUntil: a }, { validUntil: b })).toEqual({});
    const c = new Date('2026-09-01T05:00:00.000Z');
    expect(Object.keys(diffBenefit({ validUntil: a }, { validUntil: c }))).toEqual(['validUntil']);
  });

  it('un campo que pasa a null sí es un cambio', () => {
    const d = diffBenefit({ validUntil: new Date('2026-08-24T05:00:00.000Z') }, { validUntil: null });
    expect(d.validUntil.to).toBeNull();
  });

  it('undefined explícito no cuenta como cambio', () => {
    expect(diffBenefit({ title: 'A' }, { title: undefined })).toEqual({});
  });

  it('captura los campos del spec §7 y §6 que importan', () => {
    const d = diffBenefit(
      { maxPerMember: 1, limitPeriod: 'LIFETIME', status: 'ACTIVE', approval: 'APPROVED' },
      { maxPerMember: 2, limitPeriod: 'MONTH', status: 'PAUSED', approval: 'PENDING' },
    );
    expect(Object.keys(d).sort()).toEqual(['approval', 'limitPeriod', 'maxPerMember', 'status']);
  });
});

describe('actorOf', () => {
  it('congela nombre y rol para que el historial siga legible', () => {
    expect(actorOf({ id: 'u1', fullName: 'Ana', role: 'ALLY_BUSINESS' })).toEqual({
      userId: 'u1',
      actorName: 'Ana',
      actorRole: 'ALLY_BUSINESS',
    });
  });

  it('tolera que no haya usuario (proceso automático)', () => {
    expect(actorOf(null)).toEqual({ userId: null, actorName: '', actorRole: '' });
  });
});
