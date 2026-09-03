import { describe, expect, it, vi } from 'vitest';
import { MktActionService } from '../src/marketing/mkt-action.service';

// Fake prisma con dos envíos y un contacto, para probar la correlación de eventos.
function makeSvc() {
  const actions = [
    { id: 'a1', whiteLabelId: 'b', contactId: 'c1', channel: 'email', providerMessageId: 'mid-1', createdAt: new Date(1), openedAt: null, deliveredAt: null, clickedAt: null, bouncedAt: null },
    { id: 'a2', whiteLabelId: 'b', contactId: 'c1', channel: 'email', providerMessageId: 'mid-2', createdAt: new Date(2), openedAt: null, deliveredAt: null, clickedAt: null, bouncedAt: null },
  ];
  const prisma = {
    mktAction: {
      findFirst: vi.fn(async ({ where }: any) => {
        let list = actions.filter((a) => a.whiteLabelId === where.whiteLabelId);
        if (where.providerMessageId) list = list.filter((a) => a.providerMessageId === where.providerMessageId);
        if (where.contactId) list = list.filter((a) => a.contactId === where.contactId);
        if (where.channel) list = list.filter((a) => a.channel === where.channel);
        list = list.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
        return list[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const a = actions.find((x) => x.id === where.id);
        Object.assign(a as any, data);
        return a;
      }),
    },
    mktContact: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.email === 'c1@x.com' ? { id: 'c1' } : null,
      ),
    },
  };
  const svc = new MktActionService(prisma as any, {} as any);
  return { svc, actions };
}

describe('stampEvent — correlación por messageId', () => {
  it('un messageId sella el envío correcto (open → openedAt)', async () => {
    const { svc, actions } = makeSvc();
    const r = await svc.stampEvent({ whiteLabelId: 'b', messageId: 'mid-2', kind: 'open' });
    expect(r.contactId).toBe('c1');
    expect(actions.find((a) => a.id === 'a2')!.openedAt).toBeTruthy();
    expect(actions.find((a) => a.id === 'a1')!.openedAt).toBeNull(); // no toca el otro
  });

  it('sin messageId, respaldo por email → último envío del contacto', async () => {
    const { svc, actions } = makeSvc();
    const r = await svc.stampEvent({ whiteLabelId: 'b', email: 'c1@x.com', kind: 'delivered' });
    expect(r.contactId).toBe('c1');
    // el más reciente (a2) es el que se sella
    expect(actions.find((a) => a.id === 'a2')!.deliveredAt).toBeTruthy();
  });

  it('reply no tiene columna: solo devuelve el contactId (para reanudar)', async () => {
    const { svc } = makeSvc();
    const r = await svc.stampEvent({ whiteLabelId: 'b', messageId: 'mid-1', kind: 'reply' });
    expect(r.contactId).toBe('c1');
  });
});
