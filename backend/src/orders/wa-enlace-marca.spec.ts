import { describe, it, expect, vi, afterEach } from 'vitest';
import { OrdersService } from './orders.service';
import { ChannelsService } from '../channels/channels.service';

/**
 * Al crear un pedido público, el WhatsApp que se le arma al negocio lleva el
 * enlace de SU marca. El mensaje lo arma `ChannelsService` (probado en
 * `channels/wa-enlace-marca.spec.ts`), pero solo puede hacerlo si el pedido le
 * pasa la marca: sin cargarla, el enlace se omite. Esto comprueba que
 * `createPublic` la carga de verdad.
 */

const APP_URL_ANTES = process.env.APP_URL;
afterEach(() => {
  if (APP_URL_ANTES === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = APP_URL_ANTES;
});

function montar() {
  const actualizaciones: any[] = [];
  const prisma = {
    tenant: {
      findUnique: vi.fn(async ({ include }: any) => ({
        id: 't1',
        slug: 'cafe-sellea',
        status: 'ACTIVE',
        brandName: 'Café',
        whiteLabelId: 'wl-sellea',
        whatsappOrdersPhone: '573177777400',
        currency: 'COP',
        currencySymbol: '$',
        storefront: { theme: {} },
        // Como Prisma: la relación solo viene si se pidió.
        ...(include?.whiteLabel
          ? {
              whiteLabel: {
                slug: 'sellea',
                domain: 'selleala.com',
                appDomain: 'app.selleala.com',
              },
            }
          : {}),
      })),
    },
    product: {
      findMany: vi.fn(async () => [
        {
          id: 'p1',
          name: 'Café',
          basePrice: 5000,
          isAvailable: true,
          variantPriceMode: 'DELTA',
          variants: [],
          extras: [],
        },
      ]),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    $executeRaw: vi.fn(async () => 0),
    customer: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'c1', email: null, ...data })),
    },
    order: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.code ? null : { id: 'o1', tenantId: 't1', customer: {} },
      ),
      create: vi.fn(async ({ data }: any) => ({
        id: 'o1',
        ...data,
        customerPaymentMethod: data.customerPaymentMethod ?? null,
        customerPaymentOther: null,
      })),
      update: vi.fn(async (args: any) => {
        actualizaciones.push(args.data);
        return {};
      }),
    },
    event: { create: vi.fn(async () => ({})) },
  };
  const svc = new OrdersService(
    prisma as any,
    new ChannelsService(null as any),
    { computeForCart: vi.fn(async () => ({ discount: 0, applied: [] })) } as any,
    { emit: vi.fn(async () => undefined) } as any,
    { broadcastOrderUpsert: vi.fn() } as any,
    { send: vi.fn(async () => undefined) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { onDeliveryOrderCreated: vi.fn(async () => undefined) } as any,
    { notify: vi.fn(async () => undefined) } as any,
    { enviarATenant: vi.fn(async () => undefined) } as any,
    { avisar: vi.fn(async () => undefined) } as any,
  );
  return { svc, actualizaciones };
}

describe('pedido público de un negocio de marca blanca', () => {
  it('el WhatsApp al negocio enlaza al panel de SU marca', async () => {
    process.env.APP_URL = 'https://app.soyclubify.com';
    const { svc, actualizaciones } = montar();
    const r = await svc.createPublic({
      tenantSlug: 'cafe-sellea',
      customer: { fullName: 'Ana', phone: '+57 3001234567' },
      items: [{ productId: 'p1', qty: 1 }],
      fulfillment: 'PICKUP',
    });
    const texto = decodeURIComponent(String(r.whatsappLink).split('?text=')[1] ?? '');
    expect(texto).toContain('https://app.selleala.com/o/');
    expect(texto.toLowerCase()).not.toContain('clubify');
    expect(actualizaciones[0].whatsappLink).toBe(r.whatsappLink);
  });
});
