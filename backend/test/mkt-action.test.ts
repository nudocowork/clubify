import { describe, expect, it, vi } from 'vitest';
import { MktActionService } from '../src/marketing/mkt-action.service';
import { backoffMinutes, MAX_ATTEMPTS } from '../src/marketing/mkt-workflow.util';
import type { SendResult } from '../src/marketing/provider/mkt-provider.util';

// ── Fakes: prisma.mktAction en memoria + proveedor con resultados guionados ──
function applyData(row: any, data: any) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}
class FakeActions {
  rows = new Map<string, any>();
  private seq = 0;
  async create({ data }: any) {
    const id = 'a' + ++this.seq;
    const r = {
      id,
      attempts: 0,
      status: 'pending',
      nextAttemptAt: null,
      completedAt: null,
      providerMessageId: null,
      error: null,
      ...data,
    };
    this.rows.set(id, r);
    return { ...r };
  }
  async update({ where, data }: any) {
    const r = this.rows.get(where.id);
    applyData(r, data);
    return { ...r };
  }
  async updateMany({ where, data }: any) {
    const r = this.rows.get(where.id);
    if (!r) return { count: 0 };
    if (where.status && r.status !== where.status) return { count: 0 };
    applyData(r, data);
    return { count: 1 };
  }
  async findMany({ where }: any) {
    const now = Date.now();
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.status === where.status &&
          r.nextAttemptAt &&
          new Date(r.nextAttemptAt).getTime() <= now,
      )
      .map((r) => ({ id: r.id }));
  }
  async findUnique({ where }: any) {
    const r = this.rows.get(where.id);
    return r ? { ...r } : null;
  }
}
const fakePrisma = (fa: FakeActions) => ({ mktAction: fa }) as any;

function providerWith(results: Record<'email' | 'sms', SendResult[]>) {
  const idx = { email: 0, sms: 0 };
  const calls = { email: 0, sms: 0 };
  return {
    calls,
    sendEmail: vi.fn(async (): Promise<SendResult> => {
      calls.email++;
      return results.email[Math.min(idx.email++, results.email.length - 1)];
    }),
    sendSms: vi.fn(async (): Promise<SendResult> => {
      calls.sms++;
      return results.sms[Math.min(idx.sms++, results.sms.length - 1)];
    }),
  } as any;
}

const baseInput = {
  workflowId: 'w1',
  enrollmentId: 'e1',
  contactId: 'c1',
  whiteLabelId: 'b1',
  nodeId: 'n1',
  channel: 'email' as const,
  to: 'a@b.com',
  subject: 'Hola',
  body: '<p>hola</p>',
};

describe('backoff 2/5/15 + tope', () => {
  it('reintento 1→2, 2→5, 3→15, luego null', () => {
    expect(backoffMinutes(1)).toBe(2);
    expect(backoffMinutes(2)).toBe(5);
    expect(backoffMinutes(3)).toBe(15);
    expect(backoffMinutes(MAX_ATTEMPTS)).toBeNull();
    expect(backoffMinutes(0)).toBeNull();
  });
});

describe('MktActionService — estado + reintentos', () => {
  it('envío ok → sent, guarda providerMessageId', async () => {
    const fa = new FakeActions();
    const prov = providerWith({ email: [{ ok: true, messageId: 'mid-1' }], sms: [] });
    const svc = new MktActionService(fakePrisma(fa), prov);
    const a = await svc.dispatch(baseInput);
    expect(a.status).toBe('sent');
    expect(a.providerMessageId).toBe('mid-1');
    expect(a.attempts).toBe(1);
  });

  it('rechazado → retrying con nextAttemptAt; el reintento lo reenvía y queda sent', async () => {
    const fa = new FakeActions();
    // 1er intento falla, el reintento (2º) sale ok.
    const prov = providerWith({
      email: [{ ok: false, error: 'timeout' }, { ok: true, messageId: 'mid-2' }],
      sms: [],
    });
    const svc = new MktActionService(fakePrisma(fa), prov);
    const a = await svc.dispatch(baseInput);
    expect(a.status).toBe('retrying');
    expect(a.nextAttemptAt).toBeTruthy();
    expect(prov.calls.email).toBe(1);

    // Forzamos que ya venció y corremos el carril de reintentos.
    fa.rows.get(a.id).nextAttemptAt = new Date(Date.now() - 1000);
    const resolved = await svc.retryDue();
    expect(resolved).toBe(1);
    const after = fa.rows.get(a.id);
    expect(after.status).toBe('sent');
    expect(after.providerMessageId).toBe('mid-2');
    expect(after.attempts).toBe(2);
    expect(prov.calls.email).toBe(2);
  });

  it('cuerpo vacío (proveedor devuelve skipped) → skipped SIN reintentar', async () => {
    const fa = new FakeActions();
    const prov = providerWith({
      email: [{ ok: false, skipped: true, error: 'El nodo no tiene asunto ni contenido — revísalo.' }],
      sms: [],
    });
    const svc = new MktActionService(fakePrisma(fa), prov);
    const a = await svc.dispatch({ ...baseInput, subject: '', body: '' });
    expect(a.status).toBe('skipped');
    expect(a.nextAttemptAt).toBeNull();
    expect(a.error).toMatch(/revísalo/);
  });

  it('agota los 3 reintentos → failed', async () => {
    const fa = new FakeActions();
    const prov = providerWith({ email: [{ ok: false, error: 'down' }], sms: [] });
    const svc = new MktActionService(fakePrisma(fa), prov);
    const a = await svc.dispatch(baseInput); // intento 1 → retrying
    expect(a.status).toBe('retrying');
    // reintentos 2, 3, 4
    for (let i = 0; i < 3; i++) {
      fa.rows.get(a.id).nextAttemptAt = new Date(Date.now() - 1000);
      await svc.retryDue();
    }
    const after = fa.rows.get(a.id);
    expect(after.status).toBe('failed');
    expect(after.attempts).toBe(MAX_ATTEMPTS); // 4 envíos = 1 + 3 reintentos
  });

  it('un canal caído no afecta a otra acción (independencia)', async () => {
    const fa = new FakeActions();
    const prov = providerWith({
      email: [{ ok: false, error: 'email down' }],
      sms: [{ ok: true, messageId: 'sms-1' }],
    });
    const svc = new MktActionService(fakePrisma(fa), prov);
    const emailAction = await svc.dispatch(baseInput);
    const smsAction = await svc.dispatch({ ...baseInput, channel: 'sms', to: '+573001234567' });
    expect(emailAction.status).toBe('retrying'); // email falló
    expect(smsAction.status).toBe('sent'); // sms salió igual
  });
});
