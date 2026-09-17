import { describe, it, expect, afterEach } from 'vitest';
import { ChannelsService } from './channels.service';

/**
 * El «Ver pedido:» del WhatsApp del pedido lleva el dominio de SU marca.
 *
 * EL BUG: la línea era `${APP_URL}/o/<código>` para todos. APP_URL es
 * `app.soyclubify.com`, así que el negocio de Sellea recibía el pedido de su
 * cliente con un enlace de Clubify, y WhatsApp le pintaba la vista previa de
 * Clubify. Es la misma fuga que ya se cerró en el aviso por SMS (8fdca586).
 *
 * Y sin marca resuelta NO se pinta: una marca blanca sin dominio propio no
 * puede caer a `soyclubify.com`. Mejor un mensaje sin enlace (el detalle está
 * en su panel) que uno que delata la plataforma.
 */

const svc = new ChannelsService(null as any);

const order = {
  code: 'CBR6',
  items: [{ qty: 1, name: 'Oreo', lineTotal: 21500, unitPrice: 21500 }],
  subtotal: 21500,
  discount: 0,
  total: 21500,
  fulfillment: 'PICKUP',
} as any;
const customer = { fullName: 'QA Test', phone: '+57 3150621706' } as any;
const base = { whatsappOrdersPhone: '573177777400', currency: 'COP', currencySymbol: '$' };

const texto = (tenant: any) =>
  decodeURIComponent(svc.generateWaMeOwner(tenant, order, customer).split('?text=')[1] ?? '');

const APP_URL_ANTES = process.env.APP_URL;
afterEach(() => {
  if (APP_URL_ANTES === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = APP_URL_ANTES;
});

describe('enlace «Ver pedido» del WhatsApp al negocio', () => {
  it('un negocio de Sellea recibe el enlace de SU panel, no el de Clubify', () => {
    process.env.APP_URL = 'https://app.soyclubify.com';
    const t = texto({
      ...base,
      whiteLabelId: 'wl-sellea',
      whiteLabel: { slug: 'sellea', appDomain: 'app.selleala.com', domain: 'selleala.com' },
    });
    expect(t).toContain('https://app.selleala.com/o/CBR6');
    expect(t.toLowerCase()).not.toContain('clubify');
  });

  it('una marca blanca SIN dominio propio no lleva enlace (nunca cae a Clubify)', () => {
    process.env.APP_URL = 'https://app.soyclubify.com';
    const t = texto({
      ...base,
      whiteLabelId: 'wl-x',
      whiteLabel: { slug: 'marca-x', appDomain: null, domain: null },
    });
    expect(t).not.toContain('Ver pedido');
    expect(t.toLowerCase()).not.toContain('clubify');
    expect(t).not.toContain('localhost');
    // El resto del mensaje sigue entero.
    expect(t).toContain('CBR6');
  });

  it('si la marca no se pudo cargar, tampoco se adivina el enlace', () => {
    process.env.APP_URL = 'https://app.soyclubify.com';
    const t = texto({ ...base, whiteLabelId: 'wl-sellea' });
    expect(t).not.toContain('Ver pedido');
    expect(t.toLowerCase()).not.toContain('clubify');
  });

  it('un negocio de la plataforma (sin marca) sí lleva el enlace de Clubify', () => {
    process.env.APP_URL = 'https://app.soyclubify.com';
    const t = texto({ ...base, whiteLabelId: null });
    expect(t).toContain('Ver pedido: https://app.soyclubify.com/o/CBR6');
  });

  it('la marca Clubify sin dominio en su fila también es la plataforma', () => {
    process.env.APP_URL = 'https://app.soyclubify.com';
    const t = texto({
      ...base,
      whiteLabelId: 'wl-clubify',
      whiteLabel: { slug: 'clubify', appDomain: null, domain: null },
    });
    expect(t).toContain('Ver pedido: https://app.soyclubify.com/o/CBR6');
  });
});
