import { describe, it, expect } from 'vitest';
import { brandEmailPanelUrl } from './brand-email-creds.util';

describe('brandEmailPanelUrl — el enlace al panel en los correos de una marca', () => {
  const APP = 'https://soyclubify.com';

  it('usa el panel propio de la marca, con appDomain antes que domain', () => {
    expect(
      brandEmailPanelUrl(
        { appDomain: 'app.selleala.com', domain: 'www.selleala.com' },
        { isPlatform: false, fallbackAppUrl: APP },
      ),
    ).toBe('https://app.selleala.com');
    expect(
      brandEmailPanelUrl({ domain: 'www.fideliso.com/' }, { isPlatform: false, fallbackAppUrl: APP }),
    ).toBe('https://www.fideliso.com');
  });

  it('una marca blanca sin dominio NO cae a la plataforma: se queda sin enlace', () => {
    expect(
      brandEmailPanelUrl({ appDomain: null, domain: '  ' }, { isPlatform: false, fallbackAppUrl: APP }),
    ).toBeNull();
    expect(brandEmailPanelUrl(null, { isPlatform: false, fallbackAppUrl: APP })).toBeNull();
  });

  it('la plataforma sin dominio sí usa APP_URL', () => {
    expect(
      brandEmailPanelUrl(null, { isPlatform: true, fallbackAppUrl: 'https://soyclubify.com/' }),
    ).toBe('https://soyclubify.com');
  });
});
