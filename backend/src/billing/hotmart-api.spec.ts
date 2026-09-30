import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HotmartApiService } from './hotmart-api.service';

/**
 * El cliente de la API de Hotmart, contra un fetch falso.
 *
 * Lo que fijan estas pruebas: que el token se pida UNA vez y se reutilice
 * (Hotmart lo da por 48 h; pedirlo por llamada sería castigar su rate
 * limit), que `send_mail` viaje apagado por defecto (el correo que ve el
 * cliente es el de su marca, no el de Hotmart), y que el cliente NUNCA
 * lance — una cancelación local no puede fallar porque Hotmart esté caído.
 */

const TOKEN_OK = {
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'tok-123', expires_in: 172799, token_type: 'bearer' }),
};
const CANCEL_OK = {
  ok: true,
  status: 200,
  json: async () => ({ status: 'INACTIVE', subscriber_code: 'ABC' }),
};

describe('el cliente de la API de Hotmart', () => {
  beforeEach(() => {
    process.env.HOTMART_CLIENT_ID = 'id-prueba';
    process.env.HOTMART_CLIENT_SECRET = 'secret-prueba';
  });
  afterEach(() => {
    delete process.env.HOTMART_CLIENT_ID;
    delete process.env.HOTMART_CLIENT_SECRET;
    vi.unstubAllGlobals();
  });

  it('sin credenciales no está configurada y lo dice sin llamar a nadie', async () => {
    delete process.env.HOTMART_CLIENT_ID;
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    const svc = new HotmartApiService();
    expect(svc.estaConfigurada()).toBe(false);
    const r = await svc.cancelarSuscripcion('ABC');
    expect(r.ok).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('pide el token UNA vez y cancela con Bearer y send_mail apagado', async () => {
    const fetchFalso = vi.fn(async (url: string) =>
      url.includes('/security/oauth/token') ? TOKEN_OK : CANCEL_OK,
    );
    vi.stubGlobal('fetch', fetchFalso);
    const svc = new HotmartApiService();

    const r1 = await svc.cancelarSuscripcion('UYW0OQ02');
    const r2 = await svc.cancelarSuscripcion('OTRO123');

    expect(r1).toEqual({ ok: true, status: 'INACTIVE' });
    expect(r2.ok).toBe(true);
    const llamadas = fetchFalso.mock.calls;
    const tokens = llamadas.filter(([u]) => String(u).includes('/oauth/token'));
    expect(tokens).toHaveLength(1); // cacheado para la segunda
    const [urlCancel, initCancel] = llamadas.find(([u]) =>
      String(u).includes('/subscriptions/UYW0OQ02/cancel'),
    )! as unknown as [string, RequestInit];
    expect(urlCancel).toContain('/payments/api/v1/subscriptions/');
    expect((initCancel.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(String(initCancel.body))).toEqual({ send_mail: false });
  });

  it('un 4xx de Hotmart vuelve como ok:false con el motivo — jamás como excepción', async () => {
    const fetchFalso = vi.fn(async (url: string) =>
      url.includes('/oauth/token')
        ? TOKEN_OK
        : { ok: false, status: 404, json: async () => ({ error: 'SUBSCRIPTION_NOT_FOUND' }) },
    );
    vi.stubGlobal('fetch', fetchFalso);
    const svc = new HotmartApiService();
    const r = await svc.cancelarSuscripcion('NO-EXISTE');
    expect(r).toEqual({ ok: false, motivo: 'SUBSCRIPTION_NOT_FOUND' });
  });

  it('la red rota tampoco lanza', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const svc = new HotmartApiService();
    const r = await svc.cancelarSuscripcion('ABC');
    expect(r.ok).toBe(false);
    // El error de red al pedir el token se traga en tokenVigente y vuelve
    // como el motivo genérico del token — lo que importa es que no LANZA.
    if (!r.ok) expect(r.motivo).toContain('token');
  });
});
