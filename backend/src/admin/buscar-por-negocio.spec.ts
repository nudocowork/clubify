import { describe, it, expect, vi } from 'vitest';
import { MessageLogService } from './message-log.service';

/**
 * Buscar en «Mensajes enviados» por el NOMBRE DEL NEGOCIO.
 *
 * EL CASO (Javier, 2026-09-26): buscó «oasis» y vio 5 correos y ningún SMS.
 * Conclusión razonable: «los SMS no están saliendo». Falsa — habían salido
 * tres, los mismos días que los correos.
 *
 * La búsqueda solo miraba el TEXTO del mensaje y su destinatario. Y el texto de
 * un SMS de cobro dice «tu suscripción de Clubify»: nunca nombra al negocio.
 * El del correo sí. Así que el canal que menos se nombra a sí mismo era el que
 * parecía roto, y el buscador devolvía «lo que casualmente menciona la palabra»
 * en vez de «lo de ese negocio».
 */

const PLATAFORMA: any = { role: 'PLATFORM_OWNER', whiteLabelId: null };

function montar(negocios: Array<{ id: string }>) {
  const prisma: any = {
    tenant: { findMany: vi.fn(async () => negocios) },
  };
  return { svc: new MessageLogService(prisma), prisma };
}

/** `buildWhere` es privado: se llama por el nombre, que es lo que se prueba. */
const donde = (svc: MessageLogService, f: any) =>
  (svc as any).buildWhere(PLATAFORMA, f) as Promise<any>;

const ramaO = (w: any) =>
  (w.AND as any[]).find((x) => Array.isArray(x?.OR))?.OR ?? [];

describe('buscar por el nombre del negocio', () => {
  it('EL CASO: «oasis» trae también lo que NO lo menciona', async () => {
    const { svc } = montar([{ id: 't-oasis' }]);
    const w = await donde(svc, { q: 'oasis' });
    expect(ramaO(w)).toContainEqual({ tenantId: { in: ['t-oasis'] } });
  });

  it('sin perder lo de antes: sigue buscando en el texto y el destino', async () => {
    const { svc } = montar([{ id: 't-oasis' }]);
    const o = ramaO(await donde(svc, { q: 'oasis' }));
    const campos = o.flatMap((x: any) => Object.keys(x));
    for (const campo of [
      'toEmail',
      'toPhone',
      'subject',
      'preview',
      'error',
      'templateId',
    ]) {
      expect(campos).toContain(campo);
    }
  });

  it('busca por nombre, por razón social y por slug', async () => {
    const { svc, prisma } = montar([{ id: 't-1' }]);
    await donde(svc, { q: 'oasis' });
    const campos = prisma.tenant.findMany.mock.calls[0][0].where.OR.flatMap(
      (x: any) => Object.keys(x),
    );
    expect(campos.sort()).toEqual(['brandName', 'name', 'slug']);
  });

  it('sin negocios que casen NO se añade un `in` vacío', async () => {
    // `{ tenantId: { in: [] } }` dentro de un OR no rompe, pero es una rama que
    // no puede casar nunca: mejor no mandarla a la base.
    const { svc } = montar([]);
    const o = ramaO(await donde(svc, { q: 'loquesea' }));
    expect(o.some((x: any) => 'tenantId' in x)).toBe(false);
  });

  it('sin búsqueda no se le pregunta nada a la base por los negocios', async () => {
    const { svc, prisma } = montar([{ id: 't-1' }]);
    const w = await donde(svc, {});
    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    expect(ramaO(w)).toEqual([]);
  });

  it('hay tope: una letra suelta no se trae la base entera', async () => {
    const { svc, prisma } = montar([{ id: 't-1' }]);
    await donde(svc, { q: 'a' });
    expect(prisma.tenant.findMany.mock.calls[0][0].take).toBe(200);
  });

  it('el filtro de negocio del desplegable sigue mandando aparte', async () => {
    // `tenantId` explícito ACOTA (va en el AND); la búsqueda AMPLÍA (va en el
    // OR). Si se mezclaran, elegir un negocio y escribir texto daría de más.
    const { svc } = montar([{ id: 't-oasis' }]);
    const w = await donde(svc, { q: 'oasis', tenantId: 't-otro' });
    const base = (w.AND as any[]).find((x) => x?.tenantId === 't-otro');
    expect(base).toBeTruthy();
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: el criterio viejo no traía el SMS', async () => {
    // El SMS de cobro dice «tu suscripción de Clubify» y su destino es un
    // teléfono: con el criterio de antes, buscar «oasis» no casaba con nada
    // suyo.
    const sms = {
      toEmail: null,
      toPhone: '+5076...3495',
      subject: null,
      preview: 'Hola Ameth 👋 En 3 días se renueva tu suscripción de Clubify.',
      error: null,
      templateId: 'payment_reminder_3d',
      tenantId: 't-oasis',
    };
    const comoAntes = ['toEmail', 'toPhone', 'subject', 'preview', 'error', 'templateId'].some(
      (k) => String((sms as any)[k] ?? '').toLowerCase().includes('oasis'),
    );
    expect(comoAntes).toBe(false);

    const { svc } = montar([{ id: 't-oasis' }]);
    const o = ramaO(await donde(svc, { q: 'oasis' }));
    const rama = o.find((x: any) => 'tenantId' in x);
    expect(rama.tenantId.in).toContain(sms.tenantId);
  });
});
