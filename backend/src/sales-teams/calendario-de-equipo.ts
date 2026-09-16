import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/crypto/secret-box';

/**
 * «Conexión de Calendario / Correo» de un equipo — las reglas, sin base ni red.
 *
 * Cada EQUIPO conecta la cuenta de Google de su agenda. Al agendar una cita se
 * crea su evento y su sala de Google Meet, y el enlace vive en la CITA, no en el
 * closer: reasignar cambia el invitado y la sala sigue siendo la misma. Es lo que
 * hace TeamClubify (`lib/server/meeting-room.ts`).
 *
 * Aquí está lo que conviene probar sin Google delante: el `state` firmado del
 * OAuth, el cifrado de los tokens, cómo se arma el evento y los colores.
 *
 * Correo: no se pide permiso de Gmail. Las invitaciones y los cambios los manda
 * Google Calendar (`sendUpdates`), que es lo que hace la referencia.
 */

// ── Permisos que se piden ─────────────────────────────────────────────────

/**
 * Los mínimos. `calendar.events` crea, mueve y cancela eventos (y con ellos la
 * sala de Meet). `calendar.calendarlist.readonly` es solo para ofrecer «en qué
 * calendario caen las reuniones»: con `calendar.events` a secas Google no deja
 * listar calendarios, y la referencia se quedaba siempre en «primary» sin
 * decirlo. `openid email` dice qué cuenta quedó conectada.
 */
export const SCOPE_EVENTOS = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPES_DEL_CALENDARIO = [
  'openid',
  'email',
  SCOPE_EVENTOS,
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Ruta del callback, bajo el prefijo global `api`. */
export const RUTA_DEL_CALLBACK = '/api/public/calendario-google/callback';

// ── Configuración del servidor ────────────────────────────────────────────

/**
 * Credenciales PROPIAS del calendario, no las del inicio de sesión con Google
 * (`GOOGLE_CLIENT_ID`): así el cliente OAuth y su pantalla de consentimiento se
 * pueden llevar en otro proyecto de Google Cloud sin tocar el login.
 */
export function credencialesDeGoogle(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? '').trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * El redirect_uri tiene que ser IDÉNTICO al pedir el código, al canjearlo y al
 * registrado en Google Cloud. Sale de `API_URL` (el mismo que usa Wallet) o se
 * fuerza con `GOOGLE_CALENDAR_REDIRECT_URI`.
 */
export function redirectUriDelCalendario(): string | null {
  const forzada = (process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? '').trim();
  if (forzada) return forzada;
  const api = (process.env.API_URL ?? '').trim().replace(/\/+$/, '');
  return api ? `${api}${RUTA_DEL_CALLBACK}` : null;
}

/** Sin una clave de cifrado válida no se guardan tokens: se cifran siempre. */
export function claveDeCifradoLista(): boolean {
  const raw = process.env.SECRETS_ENC_KEY;
  if (!raw) return false;
  return Buffer.from(raw, 'base64').length === 32;
}

function secretoDelEstado(): string | null {
  return (process.env.GOOGLE_CALENDAR_STATE_SECRET || process.env.JWT_SECRET || '').trim() || null;
}

/** ¿Está todo lo que hace falta para conectar? Si no, la pantalla lo dice y no rompe nada. */
export function googleConfigurado(): boolean {
  return !!credencialesDeGoogle() && !!redirectUriDelCalendario() && claveDeCifradoLista() && !!secretoDelEstado();
}

// ── El `state` del OAuth ──────────────────────────────────────────────────

/**
 * Lo que viaja en el `state`: equipo, quién lo inició y a dónde volver. Va
 * FIRMADO (HMAC) porque el callback es público —Google redirige el navegador y
 * el backend autentica por cabecera, así que ahí no hay sesión— y lo que dice el
 * `state` decide a qué dominio se manda el código.
 */
export type EstadoDeConexion = {
  /** Equipo. */
  t: string;
  /** Usuario que la inició: al terminar tiene que ser el mismo, con su sesión. */
  u: string;
  /** Origen del panel (https://app.marca.com). Validado al iniciar. */
  o: string;
  /** Ruta de la configuración del equipo en ese panel. */
  r: string;
};

const VIGENCIA_DEL_ESTADO_S = 10 * 60;
const PROPOSITO = 'calendario-google';

function claveDelEstado(): Buffer {
  const base = secretoDelEstado();
  if (!base) throw new Error('Falta el secreto para firmar la conexión con Google');
  // Clave derivada: una firma de este flujo no vale como firma de otra cosa
  // hecha con el mismo JWT_SECRET, ni al revés.
  return createHmac('sha256', base).update(`${PROPOSITO}/state/v1`).digest();
}

const b64url = (b: Buffer) => b.toString('base64url');

export function firmarEstado(datos: EstadoDeConexion, ahoraMs = Date.now()): string {
  const cuerpo = b64url(
    Buffer.from(
      JSON.stringify({
        p: PROPOSITO,
        ...datos,
        n: randomBytes(9).toString('base64url'),
        e: Math.floor(ahoraMs / 1000) + VIGENCIA_DEL_ESTADO_S,
      }),
    ),
  );
  const firma = b64url(createHmac('sha256', claveDelEstado()).update(cuerpo).digest());
  return `v1.${cuerpo}.${firma}`;
}

export type LecturaDelEstado =
  | { ok: true; datos: EstadoDeConexion }
  /** `vencido` trae los datos: la firma es buena, así que se sabe a dónde volver. */
  | { ok: false; motivo: 'vencido'; datos: EstadoDeConexion }
  | { ok: false; motivo: 'invalido' };

export function leerEstado(state: unknown, ahoraMs = Date.now()): LecturaDelEstado {
  if (typeof state !== 'string' || state.length > 2000) return { ok: false, motivo: 'invalido' };
  const partes = state.split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') return { ok: false, motivo: 'invalido' };
  const [, cuerpo, firma] = partes;
  let esperada: Buffer;
  try {
    esperada = createHmac('sha256', claveDelEstado()).update(cuerpo).digest();
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
  const recibida = Buffer.from(firma, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
    return { ok: false, motivo: 'invalido' };
  }
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
  if (p.p !== PROPOSITO) return { ok: false, motivo: 'invalido' };
  const campos = [p.t, p.u, p.o, p.r];
  if (!campos.every((c) => typeof c === 'string' && c) || typeof p.e !== 'number') {
    return { ok: false, motivo: 'invalido' };
  }
  const datos: EstadoDeConexion = { t: p.t as string, u: p.u as string, o: p.o as string, r: p.r as string };
  if (p.e * 1000 < ahoraMs) return { ok: false, motivo: 'vencido', datos };
  return { ok: true, datos };
}

export function urlDeConsentimiento(state: string): string {
  const cred = credencialesDeGoogle();
  const redirect = redirectUriDelCalendario();
  if (!cred || !redirect) throw new Error('Falta configurar la conexión con Google');
  const q = new URLSearchParams({
    client_id: cred.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES_DEL_CALENDARIO.join(' '),
    // offline + consent: sin los dos Google no entrega refresh_token al
    // reconectar, y la conexión se caería a la hora.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/** Google deja desmarcar permisos sueltos: sin el de eventos, conectar no sirve de nada. */
export function tienePermisoDeEventos(scope: string | null | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes(SCOPE_EVENTOS);
}

/**
 * El correo de la cuenta, del `id_token` que llega en el canje del código. No se
 * verifica la firma a propósito: llega directo de Google, por TLS y autenticado
 * con el client_secret (lo que la guía de OpenID de Google da por válido).
 */
export function correoDelIdToken(idToken: string | null | undefined): string | null {
  if (!idToken) return null;
  try {
    const p = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof p.email === 'string' && p.email.includes('@') ? p.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// ── A dónde se vuelve ─────────────────────────────────────────────────────

/** Solo una ruta local del panel: nada de `//otro.com` ni barras invertidas. */
export function rutaSegura(ruta: unknown): string | null {
  if (typeof ruta !== 'string') return null;
  const r = ruta.trim();
  if (!r.startsWith('/') || r.startsWith('//') || r.includes('\\') || r.length > 300) return null;
  if (!/^[\w\-./~%]+$/.test(r)) return null;
  return r;
}

/**
 * El origen del panel desde el que se conecta, atado a la MARCA DEL EQUIPO. Es
 * lo que decide a qué dominio vuelve el código de Google, así que un líder de una
 * marca no puede pedir que vuelva al panel de otra marca ni al de la plataforma.
 *
 * Valen los dominios de la marca. Los de la plataforma que acepta el CORS
 * (`main.ts`: la app, sus subdominios, los extra) solo si `plataforma`: la marca
 * es la plataforma, o no tiene dominio propio y su panel se sirve ahí.
 * https siempre, salvo localhost fuera de producción.
 */
export function origenPermitido(
  origen: unknown,
  marca: { hosts: ReadonlySet<string>; plataforma: boolean },
): string | null {
  if (typeof origen !== 'string') return null;
  let u: URL;
  try {
    u = new URL(origen.trim());
  } catch {
    return null;
  }
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  const limpio = `${u.protocol}//${u.host.toLowerCase()}`;
  if (local) return process.env.NODE_ENV === 'production' ? null : limpio;

  if (marca.hosts.has(host)) return limpio;
  if (!marca.plataforma) return null;

  const appUrl = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '').toLowerCase();
  const raiz = (process.env.CORS_ROOT_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const extras = (process.env.CORS_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (limpio === appUrl) return limpio;
  if (extras.includes(limpio) || extras.includes(u.host.toLowerCase())) return limpio;
  if (raiz && (host === raiz || host.endsWith(`.${raiz}`))) return limpio;
  return null;
}

/**
 * Vuelta al panel. Lo de Google va en el FRAGMENTO (#): no se manda a ningún
 * servidor ni sale en el Referer, y la pantalla lo borra al leerlo.
 */
export function urlDeVuelta(datos: Pick<EstadoDeConexion, 'o' | 'r'>, params: Record<string, string>): string {
  return `${datos.o}${datos.r}#${new URLSearchParams(params).toString()}`;
}

// ── Tokens ────────────────────────────────────────────────────────────────

export function cifrarToken(token: string): string {
  return encryptSecret(token);
}

/**
 * Descifra un token guardado. Uno que NO esté cifrado no se usa: `decryptSecret`
 * devuelve tal cual lo que viene en plano (por los datos de pago antiguos), y
 * aquí eso solo podría ser un token metido a mano.
 */
export function descifrarToken(guardado: string | null | undefined): string | null {
  if (!guardado || !isEncrypted(guardado)) return null;
  try {
    return decryptSecret(guardado) || null;
  } catch {
    return null;
  }
}

// ── Colores de Google Calendar ────────────────────────────────────────────

/** Los 11 colores de evento de Google Calendar, con el nombre que les da en español. */
export const COLORES_DE_GOOGLE = [
  { id: '1', nombre: 'Lavanda', hex: '#7986CB' },
  { id: '2', nombre: 'Salvia', hex: '#33B679' },
  { id: '3', nombre: 'Uva', hex: '#8E24AA' },
  { id: '4', nombre: 'Flamenco', hex: '#E67C73' },
  { id: '5', nombre: 'Plátano', hex: '#F6BF26' },
  { id: '6', nombre: 'Mandarina', hex: '#F4511E' },
  { id: '7', nombre: 'Pavo real', hex: '#039BE5' },
  { id: '8', nombre: 'Grafito', hex: '#616161' },
  { id: '9', nombre: 'Arándano', hex: '#3F51B5' },
  { id: '10', nombre: 'Albahaca', hex: '#0B8043' },
  { id: '11', nombre: 'Tomate', hex: '#D50000' },
] as const;

export function esColorDeGoogle(id: unknown): id is string {
  return typeof id === 'string' && COLORES_DE_GOOGLE.some((c) => c.id === id);
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Google no acepta un color libre en un evento, solo uno de sus 11. Una agenda
 * con color propio (su `color`, de la paleta del equipo) pinta sus citas con el
 * tono de Google más parecido.
 */
export function colorDeGoogleMasCercano(hex: string | null | undefined): string | null {
  const c = hex ? rgb(hex) : null;
  if (!c) return null;
  let mejor: { id: string; d: number } | null = null;
  for (const g of COLORES_DE_GOOGLE) {
    const [r, gg, b] = rgb(g.hex)!;
    const d = (c[0] - r) ** 2 + (c[1] - gg) ** 2 + (c[2] - b) ** 2;
    if (!mejor || d < mejor.d) mejor = { id: g.id, d };
  }
  return mejor?.id ?? null;
}

// ── El evento ─────────────────────────────────────────────────────────────

export type Invitado = { email: string; displayName?: string; responseStatus?: string; [k: string]: unknown };

/**
 * Id del evento derivado de la cita. Google acepta ids propios (base32hex: 0-9
 * y a-v) y responde 409 si ya existe en ese calendario: dos altas a la vez de la
 * misma cita —el agendamiento y «Generar salas pendientes»— no crean dos eventos.
 */
export function idDeEventoParaCita(citaId: string): string {
  const limpio = citaId.toLowerCase().replace(/[^0-9a-v]/g, '');
  return `cita${limpio}`.slice(0, 1000);
}

export function tituloDelEvento(d: { tituloAgenda?: string | null; equipo: string; cliente?: string | null }): string {
  const base = (d.tituloAgenda ?? '').trim() || `Reunión con ${d.equipo.trim()}`;
  const cliente = (d.cliente ?? '').trim();
  return (cliente ? `${base} · ${cliente}` : base).slice(0, 250);
}

/**
 * Lo que lee el invitado, también el cliente. Nada interno (ni notas del equipo
 * ni enlaces al panel); el enlace para cambiar o cancelar, solo si la marca tiene
 * dominio resuelto.
 */
export function descripcionDelEvento(d: {
  cliente?: string | null;
  empresa?: string | null;
  telefono?: string | null;
  enlaceDeGestion?: string | null;
}): string {
  return [
    d.cliente ? `Cliente: ${d.cliente}` : '',
    d.empresa ? `Empresa: ${d.empresa}` : '',
    d.telefono ? `WhatsApp: ${d.telefono}` : '',
    d.enlaceDeGestion ? `\n¿Necesitas cambiar o cancelar la reunión? ${d.enlaceDeGestion}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const correo = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/**
 * Los invitados que quedan tras un cambio. Se parte de los que YA tiene el
 * evento (así no se pierde quien confirmó asistencia ni a quien añadieron a mano
 * en Google) y solo se tocan los que pone el sistema: el closer y el cliente
 * anteriores —que se guardan en el propio evento— salen si ya no tocan, y los
 * de ahora entran si faltan.
 */
export function invitadosDelEvento(d: {
  existentes?: Invitado[] | null;
  anteriores?: { closer?: string | null; cliente?: string | null };
  cliente?: { email?: string | null; nombre?: string | null } | null;
  closer?: { email?: string | null; nombre?: string | null } | null;
  invitarCliente: boolean;
  invitarCloser: boolean;
}): Invitado[] {
  const deseados: Invitado[] = [];
  if (d.invitarCliente && correo(d.cliente?.email)) {
    deseados.push({ email: correo(d.cliente?.email), ...(d.cliente?.nombre ? { displayName: d.cliente.nombre } : {}) });
  }
  if (d.invitarCloser && correo(d.closer?.email)) {
    deseados.push({ email: correo(d.closer?.email), ...(d.closer?.nombre ? { displayName: d.closer.nombre } : {}) });
  }
  const quieren = new Set(deseados.map((i) => i.email));
  const gestionados = new Set([correo(d.anteriores?.closer), correo(d.anteriores?.cliente)].filter(Boolean));
  const quedan = (d.existentes ?? []).filter((i) => {
    const e = correo(i.email);
    return e && (quieren.has(e) || !gestionados.has(e));
  });
  const ya = new Set(quedan.map((i) => correo(i.email)));
  return [...quedan, ...deseados.filter((i) => !ya.has(i.email))];
}

export type DatosDelEvento = {
  citaId: string;
  inicio: Date;
  duracionMin: number;
  zona: string;
  titulo: string;
  descripcion: string;
  invitados: Invitado[];
  /** Pedir sala de Meet. En un cambio, solo si la cita aún no tiene. */
  pedirSala: boolean;
  colorId: string | null;
  /** Los que pone el sistema, para reconocerlos en el siguiente cambio. */
  gestionados: { closer: string | null; cliente: string | null };
};

/** Cuerpo para crear (con `id`) o actualizar el evento. */
export function construirEvento(d: DatosDelEvento, opciones: { conId: boolean }): Record<string, unknown> {
  const fin = new Date(d.inicio.getTime() + d.duracionMin * 60_000);
  const cuerpo: Record<string, unknown> = {
    summary: d.titulo,
    description: d.descripcion,
    // La hora exacta (UTC) y la zona de la agenda: Google la pinta en la del invitado.
    start: { dateTime: d.inicio.toISOString(), timeZone: d.zona },
    end: { dateTime: fin.toISOString(), timeZone: d.zona },
    attendees: d.invitados,
    // Una cita cancelada y reabierta vuelve a la vida con su misma sala.
    status: 'confirmed',
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        citaId: d.citaId,
        closer: d.gestionados.closer ?? '',
        cliente: d.gestionados.cliente ?? '',
      },
    },
  };
  if (opciones.conId) cuerpo.id = idDeEventoParaCita(d.citaId);
  if (d.colorId) cuerpo.colorId = d.colorId;
  if (d.pedirSala) {
    cuerpo.conferenceData = {
      // Por cita: si la petición se repite, Google no crea otra sala.
      createRequest: { requestId: `sala-${d.citaId}`.slice(0, 100), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  return cuerpo;
}

export type EventoDeGoogle = {
  id: string;
  status?: string;
  hangoutLink?: string;
  attendees?: Invitado[];
  extendedProperties?: { private?: Record<string, string> };
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

export function enlaceDeMeet(ev: EventoDeGoogle | null | undefined): string | null {
  if (!ev) return null;
  if (ev.hangoutLink) return ev.hangoutLink;
  return ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null;
}
