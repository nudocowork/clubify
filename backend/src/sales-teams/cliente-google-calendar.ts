import { credencialesDeGoogle, redirectUriDelCalendario, type EventoDeGoogle } from './calendario-de-equipo';

/**
 * Cliente mínimo de la API REST de Google Calendar, con `fetch` y sin SDK: son
 * seis llamadas y `googleapis` arrastra mucho para eso.
 *
 * TIEMPOS: un `fetch` sin `signal` no vence nunca, y esto cuelga de agendar una
 * cita. Token 10 s, calendario 15 s; quien llama decide cuánto espera.
 *
 * Nada de lo que se lanza lleva tokens: los mensajes salen de la respuesta de
 * Google, nunca de lo que se le mandó.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const API = 'https://www.googleapis.com/calendar/v3';

export class ErrorDeGoogle extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** `invalid_grant` = la cuenta quitó el permiso: hay que reconectar. */
    readonly codigo: string | null = null,
  ) {
    super(message);
    this.name = 'ErrorDeGoogle';
  }
}

export type TokensDeGoogle = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
};

export type CalendarioDeLaCuenta = { id: string; nombre: string; principal: boolean };

async function pedirToken(body: Record<string, string>): Promise<TokensDeGoogle> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    const codigo = typeof json.error === 'string' ? json.error : null;
    throw new ErrorDeGoogle(String(json.error_description || codigo || `Google respondió ${res.status}`), res.status, codigo);
  }
  return json as unknown as TokensDeGoogle;
}

function credenciales() {
  const c = credencialesDeGoogle();
  if (!c) throw new ErrorDeGoogle('Falta configurar la conexión con Google', 0, 'sin_configurar');
  return c;
}

async function llamar<T>(
  accessToken: string,
  ruta: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const q = init.query ? `?${new URLSearchParams(init.query).toString()}` : '';
  const res = await fetch(`${API}${ruta}${q}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 204) return {} as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string; status?: string } | undefined;
    throw new ErrorDeGoogle(err?.message || `Google Calendar respondió ${res.status}`, res.status, err?.status ?? null);
  }
  return json as T;
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;
const envio = (avisar: boolean) => (avisar ? 'all' : 'none');

export const clienteDeGoogle = {
  canjearCodigo(code: string): Promise<TokensDeGoogle> {
    const c = credenciales();
    return pedirToken({
      code,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: redirectUriDelCalendario() ?? '',
      grant_type: 'authorization_code',
    });
  },

  renovarAcceso(refreshToken: string): Promise<TokensDeGoogle> {
    const c = credenciales();
    return pedirToken({
      refresh_token: refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'refresh_token',
    });
  },

  async correoDeLaCuenta(accessToken: string): Promise<string | null> {
    try {
      const res = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { email?: string };
      return json.email?.toLowerCase() ?? null;
    } catch {
      return null;
    }
  },

  /** Nunca lanza: si Google ya lo había revocado, da igual. */
  async revocar(token: string): Promise<void> {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* sin red o ya revocado: los tokens locales se borran igual */
    }
  },

  crearEvento(token: string, calendarId: string, cuerpo: Record<string, unknown>, avisar: boolean) {
    return llamar<EventoDeGoogle>(token, `${cal(calendarId)}/events`, {
      method: 'POST',
      body: cuerpo,
      query: { conferenceDataVersion: '1', sendUpdates: envio(avisar) },
    });
  },

  verEvento(token: string, calendarId: string, eventId: string) {
    return llamar<EventoDeGoogle>(token, `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`);
  },

  /** PATCH conserva la sala: mover la cita o cambiar invitados no cambia el enlace. */
  actualizarEvento(token: string, calendarId: string, eventId: string, cuerpo: Record<string, unknown>, avisar: boolean) {
    return llamar<EventoDeGoogle>(token, `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: cuerpo,
      query: { conferenceDataVersion: '1', sendUpdates: envio(avisar) },
    });
  },

  async borrarEvento(token: string, calendarId: string, eventId: string, avisar: boolean): Promise<void> {
    await llamar(token, `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      query: { sendUpdates: envio(avisar) },
    });
  },

  /** Solo donde se puede escribir: en uno de solo lectura el evento fallaría. */
  async listarCalendarios(token: string): Promise<CalendarioDeLaCuenta[]> {
    const r = await llamar<{ items?: { id: string; summary?: string; primary?: boolean; accessRole?: string }[] }>(
      token,
      '/users/me/calendarList',
      { query: { minAccessRole: 'writer' } },
    );
    return (r.items ?? []).map((c) => ({ id: c.id, nombre: c.summary || c.id, principal: !!c.primary }));
  },
};

export type ClienteDeGoogle = typeof clienteDeGoogle;
