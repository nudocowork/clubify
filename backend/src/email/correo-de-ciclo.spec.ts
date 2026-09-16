import { describe, it, expect } from 'vitest';
import { EMAIL_TEMPLATES, interpolateEmail } from './brand-email-templates';
import { interpolarAsunto, renderCorreoDeCiclo } from './correo-de-ciclo';
import { escaparHtml, identidadDeMarca } from './maquetador';

const SELLEA = identidadDeMarca({
  name: 'Sellea',
  logoUrl: 'https://cdn.example.com/branding/logo.png',
  iconUrl: 'https://cdn.example.com/branding/icono.png',
  primaryColor: '#FF4D3D',
  secondaryColor: '#1A1033',
  contactEmail: 'hola@selleala.com',
  domain: 'www.selleala.com',
  appDomain: 'app.selleala.com',
});

const VARS: Record<string, string> = {
  platform: 'Sellea',
  brandName: 'Fressh',
  ownerName: 'Camila',
  panelUrl: 'https://app.selleala.com/app',
  loginEmail: 'camila@fressh.co',
  supportEmail: 'hola@selleala.com',
  nextChargeDate: '14 de octubre de 2026',
  chargeDate: '14 de octubre de 2026',
  pauseDate: '18 de octubre de 2026',
  trialDays: '7',
  buyerName: 'Camila',
  activateUrl: 'https://www.selleala.com/activar?email=camila%40fressh.co',
};

const render = (id: string, vars = VARS, identidad = SELLEA) => {
  const def = EMAIL_TEMPLATES.find((t) => t.id === id)!;
  return {
    def,
    ...renderCorreoDeCiclo({
      def,
      identidad,
      asunto: interpolateEmail(def.subject, vars),
      cuerpo: interpolateEmail(def.default, vars),
      vars,
    }),
  };
};

describe('correos del ciclo de vida sobre el maquetador', () => {
  for (const t of EMAIL_TEMPLATES) {
    it(`${t.id}: firma de la marca, sin Markdown ni rastro de otra marca`, () => {
      const { def, html, texto } = render(t.id);
      expect(html).toContain('src="https://cdn.example.com/branding/logo.png"');
      expect(html).toContain('Enviado por Sellea');
      expect(html).toContain(escaparHtml(def.kicker ?? ''));
      for (const s of [html, texto]) {
        expect(s).not.toContain('**');
        expect(s.toLowerCase()).not.toContain('clubify');
      }
      expect(html.toUpperCase()).not.toContain('#22C55E');
      if (def.cta) {
        const url = VARS[def.cta.urlVar];
        expect(html).toContain(`href="${escaparHtml(url)}"`);
        // El texto plano también lleva el enlace: sin él no hay a dónde ir.
        expect(texto).toContain(url);
      }
    });
  }

  it('cada plantilla tiene antetítulo, y sus datos usan tokens declarados', () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(t.kicker?.trim(), t.id).toBeTruthy();
      for (const f of t.facts ?? []) {
        expect(t.vars, `${t.id} → ${f.label}`).toContain(f.var);
      }
    }
  });

  it('ningún dato de la caja repite lo que ya dicen el asunto o el cuerpo por defecto', () => {
    for (const t of EMAIL_TEMPLATES) {
      for (const f of t.facts ?? []) {
        expect(t.default, `${t.id}: el cuerpo ya dice {${f.var}}`).not.toContain(`{${f.var}}`);
        expect(t.subject, `${t.id}: el asunto ya dice {${f.var}}`).not.toContain(`{${f.var}}`);
      }
    }
  });

  it('si la marca reescribió el cuerpo, la caja de datos no se pinta', () => {
    const def = EMAIL_TEMPLATES.find((t) => t.id === 'email_payment_confirmed')!;
    const { html, texto } = renderCorreoDeCiclo({
      def,
      identidad: SELLEA,
      asunto: 'Recibimos tu pago',
      cuerpo: 'Hola Camila, gracias. Tu próximo cobro será el 1 de enero.',
      vars: VARS,
    });
    expect(html).not.toContain('>Negocio</td>');
    expect(html).not.toContain('Próximo cobro</td>');
    expect(texto).not.toContain('Próximo cobro:');
  });

  it('el título es el asunto sin el emoji del principio', () => {
    const { html } = render('email_panel_ready');
    expect(html).toMatch(/<h1[^>]*>Tu panel de Sellea ya está listo<\/h1>/);
  });

  it('pinta los datos del negocio y omite las filas con el token vacío', () => {
    const { html } = render('email_payment_confirmed', { ...VARS, nextChargeDate: '' });
    expect(html).toContain('>Negocio</td>');
    expect(html).toContain('>Fressh</td>');
    expect(html).not.toContain('Próximo cobro</td>');
  });

  it('al comprador no le dice que «tiene una cuenta», y le deja el enlace a la vista', () => {
    const { html } = render('email_buyer_activation');
    expect(html).toContain('porque hiciste una compra en Sellea.');
    expect(html).not.toContain('tienes una cuenta en');
    expect(html).toContain('¿El botón no abre?');
  });

  it('sin marca resuelta el correo sale sin nombre, logo ni firma', () => {
    const { html } = render('email_payment_failed', { ...VARS, platform: '' }, null);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Enviado por');
    expect(html).not.toContain('*');
  });

  it('sin panel propio de la marca el correo sale sin botón', () => {
    const { html, texto } = render('email_payment_failed', { ...VARS, panelUrl: '' });
    expect(html).not.toContain('class="c-boton"');
    expect(texto).not.toContain('Revisar mi suscripción:');
  });

  it('el texto plano es el cuerpo legible, los datos de la caja y el enlace del botón', () => {
    const { texto } = render('email_payment_confirmed');
    expect(texto.startsWith('Hola Camila, confirmamos el pago de tu suscripción de Sellea.')).toBe(true);
    expect(texto).toContain('Negocio: Fressh\nPróximo cobro: 14 de octubre de 2026');
    expect(texto.endsWith('Ver mi panel: https://app.selleala.com/app')).toBe(true);
  });
});

describe('interpolarAsunto', () => {
  it('un token vacío no deja dobles espacios ni espacios al final', () => {
    expect(interpolarAsunto('Tu cuenta de {platform} está por pausarse', { platform: '' })).toBe(
      'Tu cuenta de está por pausarse',
    );
    expect(interpolarAsunto('No pudimos procesar tu pago de {platform}', {})).toBe(
      'No pudimos procesar tu pago de',
    );
    expect(interpolarAsunto('🎉 Tu panel de {platform} ya está listo', { platform: 'Sellea' })).toBe(
      '🎉 Tu panel de Sellea ya está listo',
    );
  });
});
