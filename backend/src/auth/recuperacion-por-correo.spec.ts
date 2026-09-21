import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthService } from './auth.service';
import { passwordResetTemplate } from '../email/templates/templates';

/**
 * «Recuperar contraseña» tiene que MANDAR el correo, y con la marca correcta.
 *
 * El fallo (2026-09-20): el reset salía por `EmailService`, que usa Resend, y en
 * producción no hay `RESEND_API_KEY` — el adaptador de consola lo escribía en el
 * log y no llegaba nunca. Medido: 15 recuperaciones pedidas en 30 días, 0
 * correos enviados; clientes reales pidiéndolo tres y cuatro veces seguidas.
 *
 * Todo lo que llega al usuario sale por la subcuenta de Grow Business de su
 * marca (`BrandEmailService`), y el enlace va al panel de ESA marca.
 */

// ─────────── El doble de la base, con lo justo para este flujo ───────────

function prismaFalso(opts: {
  usuario?: any;
  marcas?: Record<string, any>;
  negocios?: Record<string, any>;
  codigos?: any[];
  tokens?: any[];
} = {}) {
  const tokens: any[] = opts.tokens ?? [];
  return {
    tokens,
    user: {
      findUnique: vi.fn(async ({ where }: any) =>
        opts.usuario && opts.usuario.email === where.email ? opts.usuario : null,
      ),
    },
    whiteLabel: {
      findUnique: vi.fn(async ({ where }: any) => opts.marcas?.[where.id] ?? null),
    },
    tenant: {
      findUnique: vi.fn(async ({ where }: any) => opts.negocios?.[where.id] ?? null),
    },
    referralCode: {
      findFirst: vi.fn(async ({ where }: any) =>
        (opts.codigos ?? []).find(
          (c) => c.ownerUserId === where.ownerUserId && c.whiteLabelId != null,
        ) ?? null,
      ),
    },
    passwordResetToken: {
      count: vi.fn(async ({ where }: any) =>
        tokens.filter(
          (t) =>
            t.userId === where.userId &&
            t.createdAt >= where.createdAt.gte &&
            !String(t.tokenHash).startsWith('sms:'),
        ).length,
      ),
      create: vi.fn(async ({ data }: any) => {
        const fila = { ...data, id: `t${tokens.length + 1}`, createdAt: new Date() };
        tokens.push(fila);
        return fila;
      }),
    },
  };
}

/** Monta AuthService con lo mínimo, saltándose el contenedor de Nest. */
function servicio(prisma: any) {
  const svc = Object.create(AuthService.prototype) as any;
  svc.prisma = prisma;
  svc.logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  svc.appConfig = { APP_URL: 'https://soyclubify.com' };
  svc.brandEmail = { sendRaw: vi.fn(async () => ({ sent: true })) };
  // Si alguna vez vuelve a usarse, la prueba lo caza: este camino no manda nada
  // en producción.
  svc.email = { send: vi.fn() };
  return svc;
}

const SELLEA = {
  id: 'wl-sellea',
  name: 'Sellea',
  slug: 'sellea',
  primaryColor: '#FF4D3D',
  logoUrl: 'https://cdn/sellea.png',
  domain: 'www.selleala.com',
  appDomain: 'app.selleala.com',
  emailFrom: 'Sellea <hola@selleala.com>',
  contactEmail: 'hola@selleala.com',
};
const SIN_DOMINIO = { ...SELLEA, id: 'wl-mudo', name: 'Marca Muda', slug: 'muda', domain: null, appDomain: null };

const DUENO = {
  id: 'u1',
  email: 'camila@negocio.com',
  fullName: 'Camila Rojas',
  isActive: true,
  whiteLabelId: null,
  tenantId: 'neg1',
};

/** El correo que se le pasó a `sendRaw` en la primera llamada. */
function loEnviado(svc: any) {
  const llamada = svc.brandEmail.sendRaw.mock.calls[0]?.[0];
  return llamada;
}

describe('el correo sale por la marca del usuario', () => {
  it('el dueño de un negocio de Sellea: marca Sellea y enlace a su panel', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      marcas: { 'wl-sellea': SELLEA },
      negocios: { neg1: { whiteLabelId: 'wl-sellea', whiteLabel: SELLEA } },
    });
    const svc = servicio(prisma);

    await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r)); // el envío va sin `await`

    const env = loEnviado(svc);
    expect(env.whiteLabelId).toBe('wl-sellea');
    expect(env.tenantId).toBe('neg1');
    expect(env.contenido.boton.url).toMatch(/^https:\/\/app\.selleala\.com\/reset\//);
    expect(env.subject).toContain('Sellea');
    expect(env.html).not.toContain('Clubify');
  });

  it('un AFILIADO no tiene negocio: la marca sale de su código de referido', async () => {
    // En producción hay 73 afiliados sin `tenantId` ni `whiteLabelId`, 6 de
    // Sellea. Sin esto les llegaba un correo firmado por Clubify.
    const afiliado = { ...DUENO, id: 'u9', tenantId: null, whiteLabelId: null };
    const prisma = prismaFalso({
      usuario: afiliado,
      marcas: { 'wl-sellea': SELLEA },
      codigos: [{ ownerUserId: 'u9', whiteLabelId: 'wl-sellea', whiteLabel: SELLEA }],
    });
    const svc = servicio(prisma);

    await svc.requestPasswordReset(afiliado.email);
    await new Promise((r) => setImmediate(r));

    const env = loEnviado(svc);
    expect(env.whiteLabelId).toBe('wl-sellea');
    expect(env.contenido.boton.url).toMatch(/^https:\/\/app\.selleala\.com\/reset\//);
  });

  it('un negocio de Clubify: enlace al panel de Clubify', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);

    await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r));

    const env = loEnviado(svc);
    expect(env.whiteLabelId).toBeNull();
    expect(env.contenido.boton.url).toMatch(/^https:\/\/soyclubify\.com\/reset\//);
  });

  it('una marca SIN dominio propio no recibe correo: un enlace de Clubify la delataría', async () => {
    const prisma = prismaFalso({
      usuario: { ...DUENO, whiteLabelId: 'wl-mudo', tenantId: null },
      marcas: { 'wl-mudo': SIN_DOMINIO },
    });
    const svc = servicio(prisma);

    const r = await svc.requestPasswordReset(DUENO.email);
    await new Promise((res) => setImmediate(res));

    expect(svc.brandEmail.sendRaw).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true }); // por fuera, idéntico
    expect(svc.logger.warn).toHaveBeenCalled(); // pero queda dicho
  });

  it('nunca pasa por el camino muerto de Resend', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);
    await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r));
    expect(svc.email.send).not.toHaveBeenCalled();
  });
});

describe('lo que no se le cuenta a quien pregunta', () => {
  it('un correo que no existe responde igual y no crea nada', async () => {
    const prisma = prismaFalso({ usuario: DUENO });
    const svc = servicio(prisma);

    const r = await svc.requestPasswordReset('nadie@ejemplo.com');

    expect(r).toEqual({ ok: true });
    expect(prisma.tokens.length).toBe(0);
    expect(svc.brandEmail.sendRaw).not.toHaveBeenCalled();
  });

  it('un usuario inactivo tampoco recibe nada, y responde igual', async () => {
    const prisma = prismaFalso({ usuario: { ...DUENO, isActive: false } });
    const svc = servicio(prisma);

    const r = await svc.requestPasswordReset(DUENO.email);

    expect(r).toEqual({ ok: true });
    expect(prisma.tokens.length).toBe(0);
  });

  it('NO espera al envío: si esperara, el correo registrado tardaría y el desconocido no', async () => {
    // El oráculo por tiempo: la respuesta es la misma, pero tardar solo cuando
    // la cuenta existe dice quién tiene cuenta.
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);
    let terminado = false;
    svc.brandEmail.sendRaw = vi.fn(
      () =>
        new Promise((res) => {
          setTimeout(() => {
            terminado = true;
            res({ sent: true });
          }, 50);
        }),
    );

    await svc.requestPasswordReset(DUENO.email);

    expect(terminado).toBe(false); // respondió sin esperar al envío
  });
});

describe('el tope por hora', () => {
  it('a la sexta petición ya no manda, y responde igual', async () => {
    // Cada petición manda un correo REAL desde el remitente de la marca: sin
    // tope, esto inunda el buzón de cualquiera y quema el dominio.
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);

    for (let i = 0; i < 6; i++) await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r));

    expect(svc.brandEmail.sendRaw).toHaveBeenCalledTimes(5);
    expect(prisma.tokens.length).toBe(5);
    const ultima = await svc.requestPasswordReset(DUENO.email);
    expect(ultima).toEqual({ ok: true });
  });

  it('los códigos por SMS no gastan el cupo del correo', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
      tokens: Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        userId: 'u1',
        tokenHash: `sms:${i}`,
        createdAt: new Date(),
      })),
    });
    const svc = servicio(prisma);

    await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r));

    expect(svc.brandEmail.sendRaw).toHaveBeenCalledTimes(1);
  });
});

describe('el token', () => {
  it('es de 30 minutos y NO lleva el prefijo del SMS', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);
    const antes = Date.now();

    await svc.requestPasswordReset(DUENO.email);

    const t = prisma.tokens[0];
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 en hexadecimal
    expect(t.expiresAt.getTime() - antes).toBeGreaterThan(29 * 60 * 1000);
    expect(t.expiresAt.getTime() - antes).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
  });

  it('el enlace lleva el token en claro, que es lo único que el usuario tiene', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);

    await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r));

    const url: string = loEnviado(svc).contenido.boton.url;
    expect(url.split('/reset/')[1]?.length).toBeGreaterThan(20);
  });
});

describe('si el correo no sale, queda dicho', () => {
  it('lo avisa en el log con el motivo', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);
    svc.brandEmail.sendRaw = vi.fn(async () => ({ sent: false, reason: 'no_connection' }));

    await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r));

    const avisos = svc.logger.warn.mock.calls.map((c: any[]) => String(c[0])).join(' ');
    expect(avisos).toContain('no salió');
    expect(avisos).toContain('no_connection');
  });

  it('el log NO lleva el correo de la persona: va el id', async () => {
    const prisma = prismaFalso({
      usuario: DUENO,
      negocios: { neg1: { whiteLabelId: null, whiteLabel: null } },
    });
    const svc = servicio(prisma);
    svc.brandEmail.sendRaw = vi.fn(async () => ({ sent: false, reason: 'send_failed' }));

    await svc.requestPasswordReset(DUENO.email);
    await new Promise((r) => setImmediate(r));

    const avisos = svc.logger.warn.mock.calls.map((c: any[]) => String(c[0])).join(' ');
    expect(avisos).not.toContain(DUENO.email);
    expect(avisos).toContain('u1');
  });
});

// ─────────── Anclas sobre el código, por si alguien lo devuelve atrás ───────────

const FUENTE = readFileSync(resolve(__dirname, 'auth.service.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('anclas del método', () => {
  const metodo = (() => {
    const i = FUENTE.indexOf('async requestPasswordReset(email: string)');
    expect(i, 'no encuentro requestPasswordReset en auth.service.ts').toBeGreaterThan(0);
    const fin = FUENTE.indexOf('\n  /**', i);
    // Sin espacios ni saltos: el formateador parte las cadenas donde quiere.
    return FUENTE.slice(i, fin > i ? fin : undefined).replace(/\s+/g, '');
  })();

  it('envía por BrandEmailService y no por el EmailService de Resend', () => {
    expect(metodo).toContain('this.brandEmail.sendRaw('.replace(/\s+/g, ''));
    expect(metodo).not.toContain('this.email.send(');
  });

  it('arma el enlace con el panel de la marca, no con el APP_URL global', () => {
    expect(metodo).toContain('enlaceDeRecuperacion(');
    expect(metodo).toContain('marca.panelUrl');
    expect(metodo).not.toContain('`${appUrl}/reset/');
  });
});

describe('el contenido del correo', () => {
  const armado = passwordResetTemplate({
    fullName: 'Camila Rojas',
    resetUrl: 'https://app.selleala.com/reset/abc123',
    expiresInMinutes: 30,
    brand: { name: 'Sellea', primaryColor: '#FF6B4A', logoUrl: 'https://cdn/sellea.png' },
  });

  it('viaja como `contenido` para que la marca le ponga su marco', () => {
    // `sendRaw` solo repinta con el logo y el color de la marca si le llega
    // `contenido`; con solo `html` sale el marco de quien lo armó.
    expect(armado.contenido).toBeTruthy();
    expect(armado.contenido.boton?.url).toBe('https://app.selleala.com/reset/abc123');
  });

  it('enseña el enlace en texto, por si el botón no abre', () => {
    expect(armado.contenido.enlaceVisible).toBe(true);
    expect(armado.text).toContain('https://app.selleala.com/reset/abc123');
  });

  it('firma con la marca del usuario, no con Clubify', () => {
    expect(armado.subject).toBe('Restablece tu contraseña en Sellea');
    expect(armado.html).toContain('Sellea');
    expect(armado.html).not.toContain('Clubify');
  });

  it('dice cuánto dura el enlace: media hora', () => {
    expect(armado.contenido.preheader).toContain('30 minutos');
  });
});
