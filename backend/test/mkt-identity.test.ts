import { describe, expect, it } from 'vitest';
import {
  samePhone,
  phoneKeyOf,
  phoneNormOf,
  emailNormOf,
  decideContactMatch,
  resolveContact,
  UniqueContactViolation,
  type ContactRow,
  type ContactStore,
  type ResolveInput,
} from '../src/marketing/identity';

describe('samePhone — veredicto de identidad', () => {
  it('nacional ≡ E.164 (mismo contacto): 3001234567 ≡ +573001234567', () => {
    expect(samePhone('3001234567', '+573001234567')).toBe(true);
  });
  it('São Paulo ≠ Río (personas distintas): +5511987654321 ≠ +5521987654321', () => {
    expect(samePhone('+5511987654321', '+5521987654321')).toBe(false);
  });
  it('iguales exactos → true', () => {
    expect(samePhone('+57 300 123 4567', '573001234567')).toBe(true);
  });
  it('sufijo <7 no basta', () => {
    expect(samePhone('123456', '999123456')).toBe(false);
  });
  it('vacíos → false', () => {
    expect(samePhone('', '573001234567')).toBe(false);
    expect(samePhone(null, null)).toBe(false);
  });
});

describe('claves de teléfono', () => {
  it('phoneKey = últimos 10 (bucket) — São Paulo y Río COMPARTEN bucket', () => {
    expect(phoneKeyOf('+5511987654321')).toBe('1987654321');
    expect(phoneKeyOf('+5521987654321')).toBe('1987654321');
  });
  it('phoneNorm = todos los dígitos (único) — São Paulo ≠ Río', () => {
    expect(phoneNormOf('+5511987654321')).toBe('5511987654321');
    expect(phoneNormOf('+5521987654321')).toBe('5521987654321');
  });
  it('phoneNorm distingue nacional vs E.164 (por eso el veredicto NO usa la clave)', () => {
    expect(phoneNormOf('3001234567')).toBe('3001234567');
    expect(phoneNormOf('+573001234567')).toBe('573001234567');
  });
  it('<7 dígitos → null (no identifica)', () => {
    expect(phoneKeyOf('12345')).toBeNull();
    expect(phoneNormOf('12345')).toBeNull();
  });
  it('emailNorm trim + minúsculas', () => {
    expect(emailNormOf('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(emailNormOf('sin-arroba')).toBeNull();
  });
});

const row = (o: Partial<ContactRow>): ContactRow => ({
  id: o.id ?? 'x',
  email: o.email ?? null,
  phone: o.phone ?? null,
  phoneKey: o.phoneKey ?? phoneKeyOf(o.phone),
  phoneNorm: o.phoneNorm ?? phoneNormOf(o.phone),
  deleted: o.deleted ?? false,
});

describe('decideContactMatch — un solo lugar que decide', () => {
  it('match por teléfono (nacional↔E164) → reuse', () => {
    const cands = [row({ id: 'a', phone: '+573001234567' })];
    expect(decideContactMatch(cands, { phone: '3001234567' })).toEqual({ action: 'reuse', match: cands[0] });
  });
  it('São Paulo entrando, Río en el bucket → NO reusa (crea)', () => {
    const cands = [row({ id: 'rio', phone: '+5521987654321' })];
    expect(decideContactMatch(cands, { phone: '+5511987654321' })).toEqual({ action: 'create' });
  });
  it('match por email exacto → reuse', () => {
    const cands = [row({ id: 'e', email: 'a@b.com' })];
    expect(decideContactMatch(cands, { email: 'A@B.com' })).toEqual({ action: 'reuse', match: cands[0] });
  });
  it('candidato eliminado → reactivate (no duplica)', () => {
    const cands = [row({ id: 'd', phone: '+573001234567', deleted: true })];
    expect(decideContactMatch(cands, { phone: '3001234567' })).toEqual({ action: 'reactivate', match: cands[0] });
  });
});

// Store fake en memoria — prueba reactivación y CARRERA sin DB.
class FakeStore implements ContactStore {
  rows: ContactRow[] = [];
  private seq = 0;
  /** Si se setea, el PRÓXIMO create lanza la violación (simula la carrera). */
  raceInsertOnNext: ContactRow | null = null;

  async findCandidates(args: { phoneKey: string | null; email: string | null }) {
    return this.rows.filter(
      (r) =>
        (args.phoneKey && r.phoneKey === args.phoneKey) ||
        (args.email && r.email === args.email),
    );
  }
  async create(data: any): Promise<ContactRow> {
    if (this.raceInsertOnNext) {
      // Otro proceso ganó la carrera: "persistimos" su fila y rechazamos ésta.
      const winner = this.raceInsertOnNext;
      this.rows.push(winner);
      this.raceInsertOnNext = null;
      throw new UniqueContactViolation('duplicate key');
    }
    const r = row({ id: `c${++this.seq}`, ...data });
    this.rows.push(r);
    return r;
  }
  async reactivate(id: string, _input: ResolveInput): Promise<ContactRow> {
    const r = this.rows.find((x) => x.id === id)!;
    r.deleted = false;
    return r;
  }
  async findByUnique(args: { phoneNorm: string | null; email: string | null }) {
    return (
      this.rows.find(
        (r) =>
          (args.phoneNorm && r.phoneNorm === args.phoneNorm) ||
          (args.email && r.email === args.email),
      ) ?? null
    );
  }
}

describe('resolveContact — un contacto por identidad', () => {
  it('primer alta → crea', async () => {
    const s = new FakeStore();
    const c = await resolveContact(s, { phone: '+573001234567', name: 'Ana' });
    expect(s.rows.length).toBe(1);
    expect(c.id).toBe('c1');
  });

  it('segunda alta con OTRO formato del mismo número → reusa, no duplica', async () => {
    const s = new FakeStore();
    await resolveContact(s, { phone: '+573001234567' });
    const c2 = await resolveContact(s, { phone: '3001234567' });
    expect(s.rows.length).toBe(1);
    expect(c2.id).toBe('c1');
  });

  it('São Paulo y Río → dos fichas (comparten bucket, veredicto las separa)', async () => {
    const s = new FakeStore();
    await resolveContact(s, { phone: '+5511987654321' });
    await resolveContact(s, { phone: '+5521987654321' });
    expect(s.rows.length).toBe(2);
  });

  it('contacto eliminado que vuelve → se reactiva, no se duplica', async () => {
    const s = new FakeStore();
    const c = await resolveContact(s, { phone: '+573001234567' });
    s.rows.find((r) => r.id === c.id)!.deleted = true;
    const back = await resolveContact(s, { phone: '3001234567' });
    expect(s.rows.length).toBe(1);
    expect(back.id).toBe(c.id);
    expect(back.deleted).toBe(false);
  });

  it('dos altas simultáneas del mismo número → una sola ficha (carrera cerrada)', async () => {
    const s = new FakeStore();
    // Simulamos que, entre el findCandidates (vacío) y el create, otro proceso
    // insertó la ficha ganadora → nuestro create choca con el índice único.
    const winner = row({ id: 'winner', phone: '+573001234567' });
    s.raceInsertOnNext = winner;
    const got = await resolveContact(s, { phone: '+573001234567' });
    expect(got.id).toBe('winner');
    expect(s.rows.filter((r) => r.phoneNorm === '573001234567').length).toBe(1);
  });
});
