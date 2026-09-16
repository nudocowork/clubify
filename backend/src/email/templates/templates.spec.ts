import { describe, it, expect } from 'vitest';
import {
  accountActivatedTemplate,
  inviteAffiliateTemplate,
  orderConfirmedTemplate,
  orderCreatedTemplate,
  orderReadyTemplate,
  passwordResetTemplate,
  welcomeOwnerTemplate,
  welcomeStaffTemplate,
  type MarcaDeCorreo,
  type Tenant,
} from './templates';

const NEGOCIO: Tenant = {
  brandName: 'Empanadas La Parada',
  logoUrl: 'https://cdn.example.com/logos/parada.jpg',
  primaryColor: '#F59E0B',
  whatsappPhone: null,
  slug: 'empanadas-la-parada',
};
const SELLEA: MarcaDeCorreo = {
  name: 'Sellea',
  primaryColor: '#FF4D3D',
  logoUrl: 'https://cdn.example.com/branding/logo.png',
};

/** Las plantillas que firma la MARCA (no el negocio). */
const deLaMarca = (brand: MarcaDeCorreo | null) => [
  welcomeOwnerTemplate({ tenant: NEGOCIO, fullName: 'Camila Rojas', trialEndsAt: null, appUrl: 'https://app.selleala.com', brand, loginUrl: 'https://app.selleala.com/login', yaPago: true }),
  welcomeOwnerTemplate({ tenant: NEGOCIO, fullName: 'Camila Rojas', trialEndsAt: null, appUrl: 'https://app.selleala.com', brand, yaPago: false }),
  passwordResetTemplate({ fullName: 'Camila Rojas', resetUrl: 'https://app.selleala.com/reset/abc', expiresInMinutes: 30, brand }),
  inviteAffiliateTemplate({ fullName: 'Andrés Gómez', inviteUrl: 'https://app.selleala.com/reset/abc', role: 'AFFILIATE_SOCIO', code: 'ANDRES20', commissionPercent: 20, campaignName: null, parentName: null, brand }),
  accountActivatedTemplate({ tenant: NEGOCIO, fullName: 'Camila Rojas', loginEmail: 'camila@parada.co', loginUrl: 'https://app.selleala.com/login', brand }),
];

/** Las que firma el NEGOCIO. */
const delNegocio = (brand: { name: string } | null) => [
  welcomeStaffTemplate({ tenant: NEGOCIO, fullName: 'Sofía', email: 'sofia@parada.co', tempPassword: 'Kx7-pQ2m', loginUrl: 'https://app.selleala.com/login', brand }),
  orderCreatedTemplate({ tenant: NEGOCIO, customerName: 'Mateo', code: 'A7K2', total: 22000, items: [{ name: 'Empanada', qty: 2, lineTotal: 22000 }], trackingUrl: 'https://app.selleala.com/o/A7K2', brand }),
  orderConfirmedTemplate({ tenant: NEGOCIO, customerName: 'Mateo', code: 'A7K2', trackingUrl: 'https://app.selleala.com/o/A7K2', brand }),
  orderReadyTemplate({ tenant: NEGOCIO, customerName: 'Mateo', code: 'A7K2', brand }),
];

const todo = (t: { subject: string; text: string; html: string }) => `${t.subject}\n${t.text}\n${t.html}`;

describe('plantillas con texto propio', () => {
  it('con la marca Sellea ninguna nombra a Clubify ni lleva su verde o su morado', () => {
    for (const t of [...deLaMarca(SELLEA), ...delNegocio({ name: 'Sellea' })]) {
      expect(todo(t).toLowerCase()).not.toContain('clubify');
      expect(t.html.toUpperCase()).not.toMatch(/#22C55E|#6366F1/);
      expect(t.html).not.toContain('**');
    }
  });

  it('sin marca no inventan «Clubify» ni un «Hecho con»', () => {
    for (const t of [...deLaMarca(null), ...delNegocio(null)]) {
      expect(todo(t).toLowerCase()).not.toContain('clubify');
      expect(t.html).not.toContain('Hecho con');
    }
    for (const t of deLaMarca(null)) {
      expect(t.html).not.toContain('Enviado por');
      expect(t.html).not.toContain('<img');
    }
  });

  it('las de la marca llevan su logo; las del negocio, el del negocio y el crédito', () => {
    for (const t of deLaMarca(SELLEA).slice(2, 4)) {
      expect(t.html).toContain(`src="${SELLEA.logoUrl}"`);
      expect(t.html).toContain('Enviado por Sellea');
    }
    for (const t of delNegocio({ name: 'Sellea' })) {
      expect(t.html).toContain(`src="${NEGOCIO.logoUrl}"`);
      expect(t.html).toContain('Enviado por Empanadas La Parada');
      expect(t.html).toContain('Hecho con Sellea');
    }
  });

  it('escapan lo que escribe el cliente (nombre, producto)', () => {
    const t = orderCreatedTemplate({
      tenant: NEGOCIO,
      customerName: '<img src=x onerror=alert(1)>',
      code: 'A1',
      total: 1000,
      items: [{ name: '<script>alert(1)</script>', qty: 1, lineTotal: 1000 }],
      trackingUrl: 'https://app.selleala.com/o/A1',
      brand: null,
    });
    expect(t.html).not.toContain('<script>');
    expect(t.html).not.toContain('<img src=x');
    expect(t.html).toContain('&lt;script&gt;');
  });

  it('la bienvenida entrega su contenido sin marco, para que el transporte le ponga la marca', () => {
    const w = welcomeOwnerTemplate({ tenant: NEGOCIO, fullName: 'Camila Rojas', trialEndsAt: null, appUrl: 'https://app.selleala.com', brand: { name: 'Sellea' }, yaPago: true });
    expect(w.contenido.titulo).toBe('¡Listo, Camila!');
    expect(w.contenido.boton?.url).toBe('https://app.selleala.com/app');
    expect(w.contenido).not.toHaveProperty('identidad');
  });

  it('tutean: no queda voseo en lo que lee el cliente', () => {
    const voseo = /(^|[^\p{L}])(sos|podés|ingresá|subí|personalizá|compartí|escribinos|click en)(?=[^\p{L}]|$)/iu;
    for (const t of [...deLaMarca(SELLEA), ...delNegocio({ name: 'Sellea' })]) {
      expect(todo(t)).not.toMatch(voseo);
    }
  });
});
