import { describe, expect, it } from 'vitest';
import { montoFijoDelCodigo, quienCobraria, type CodigoParaCobro } from './quien-cobraria';

/**
 * Las reglas de Javier para cobrar una venta de equipo (2026-09-15). Nadie
 * llama a esto todavía; las pruebas fijan las reglas antes de tocar dinero.
 */

const MONTOS = { influencer: 80, embajador: 40 };
const APROBADO = new Date('2026-09-01');

const codigo = (id: string, o: Partial<CodigoParaCobro> = {}): CodigoParaCobro => ({
  id,
  role: 'INFLUENCER',
  isActive: true,
  approvedAt: APROBADO,
  fixedCommissionUsd: null,
  ...o,
});

describe('montoFijoDelCodigo', () => {
  it('el fijo propio del código manda; sin él, el de la marca por rol', () => {
    expect(montoFijoDelCodigo({ role: 'INFLUENCER', fixedCommissionUsd: 30 }, MONTOS)).toBe(30);
    expect(montoFijoDelCodigo({ role: 'INFLUENCER', fixedCommissionUsd: '30' }, MONTOS)).toBe(30);
    expect(montoFijoDelCodigo({ role: 'INFLUENCER', fixedCommissionUsd: null }, MONTOS)).toBe(80);
    expect(montoFijoDelCodigo({ role: 'AMBASSADOR', fixedCommissionUsd: null }, MONTOS)).toBe(40);
  });
  it('un fijo guardado que no se entiende cae al de la marca, nunca NaN', () => {
    expect(montoFijoDelCodigo({ role: 'AMBASSADOR', fixedCommissionUsd: 'x' }, MONTOS)).toBe(40);
  });
});

describe('quienCobraria · venta nueva', () => {
  it('closer, setter y referidor cobran cada uno su fijo, y se suman', () => {
    const r = quienCobraria({
      closer: codigo('c1'),
      setter: codigo('s1', { role: 'AMBASSADOR' }),
      referidor: codigo('r1', { fixedCommissionUsd: 30 }),
      montos: MONTOS,
      esRenovacion: false,
      pagaRenovaciones: false,
    });
    expect(r.cobros).toEqual([
      { codigoId: 'c1', papeles: ['closer'], monto: 80 },
      { codigoId: 's1', papeles: ['setter'], monto: 40 },
      { codigoId: 'r1', papeles: ['referidor'], monto: 30 },
    ]);
    expect(r.total).toBe(150);
    expect(r.avisos).toEqual([]);
  });

  it('closer y setter la misma persona: una sola vez', () => {
    const c = codigo('c1');
    const r = quienCobraria({ closer: c, setter: c, referidor: null, montos: MONTOS, esRenovacion: false, pagaRenovaciones: false });
    expect(r.cobros).toEqual([{ codigoId: 'c1', papeles: ['closer', 'setter'], monto: 80 }]);
    expect(r.total).toBe(80);
  });

  it('el referidor cobra aparte aunque sea quien cerró: son dos papeles', () => {
    const c = codigo('c1');
    const r = quienCobraria({ closer: c, setter: null, referidor: c, montos: MONTOS, esRenovacion: false, pagaRenovaciones: false });
    expect(r.cobros.map((x) => x.papeles)).toEqual([['closer'], ['referidor']]);
    expect(r.total).toBe(160);
  });

  it('sin código, inactivo, sin aprobar o con un rol sin fijo: no cobra y queda el aviso', () => {
    const r = quienCobraria({
      closer: null,
      setter: codigo('s1', { approvedAt: null }),
      referidor: null,
      montos: MONTOS,
      esRenovacion: false,
      pagaRenovaciones: false,
    });
    expect(r.cobros).toEqual([]);
    expect(r.avisos).toEqual([
      { papel: 'closer', motivo: 'sin_codigo' },
      { papel: 'setter', motivo: 'sin_aprobar' },
    ]);
    expect(
      quienCobraria({
        closer: codigo('c1', { isActive: false }),
        setter: codigo('s1', { role: 'VENDOR' }),
        referidor: null,
        montos: MONTOS,
        esRenovacion: false,
        pagaRenovaciones: false,
      }).avisos,
    ).toEqual([
      { papel: 'closer', motivo: 'inactivo' },
      { papel: 'setter', motivo: 'rol_sin_fijo' },
    ]);
  });
});

describe('quienCobraria · renovación', () => {
  const base = { closer: codigo('c1'), setter: codigo('s1'), referidor: codigo('r1'), montos: MONTOS, esRenovacion: true };

  it('con «solo la venta», en la renovación no cobra nadie (el referidor tampoco, como hoy)', () => {
    const r = quienCobraria({ ...base, pagaRenovaciones: false });
    expect(r.cobros).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('con «también renovaciones», cobran closer y setter; el referidor sigue siendo pago único', () => {
    const r = quienCobraria({ ...base, pagaRenovaciones: true });
    expect(r.cobros.map((x) => x.codigoId)).toEqual(['c1', 's1']);
    expect(r.total).toBe(160);
  });
});
