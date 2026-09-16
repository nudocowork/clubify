import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

// Quién entra al equipo no es lo que se prueba aquí: un líder, siempre.
vi.mock('./team-access', () => ({
  resolveTeamAccess: vi.fn(async () => ({
    team: { id: 't1', name: 'Equipo Norte', whiteLabelId: 'wl1', isActive: true, status: 'activo' },
    esAdminDeMarca: false,
    roles: ['lider'],
    puedeEscribir: true,
  })),
}));

import {
  cifrarToken,
  colorDeGoogleMasCercano,
  construirEvento,
  descifrarToken,
  firmarEstado,
  googleConfigurado,
  idDeEventoParaCita,
  invitadosDelEvento,
  leerEstado,
  origenPermitido,
  rutaSegura,
  tituloDelEvento,
  urlDeConsentimiento,
  urlDeVuelta,
} from './calendario-de-equipo';
import { CalendarioDeEquipoService, enlaceDeGestion } from './calendario-de-equipo.service';
import { ErrorDeGoogle } from './cliente-google-calendar';
import { mensajeDeWhatsapp } from './configuracion-de-equipo';
import type { PrismaService } from '../common/prisma/prisma.service';

const CLAVES = [
  'SECRETS_ENC_KEY',
  'JWT_SECRET',
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'GOOGLE_CALENDAR_STATE_SECRET',
  'GOOGLE_CALENDAR_REDIRECT_URI',
  'API_URL',
  'APP_URL',
  'CORS_ROOT_DOMAIN',
  'CORS_EXTRA_ORIGINS',
];
const antes: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of CLAVES) antes[k] = process.env[k];
  process.env.SECRETS_ENC_KEY = randomBytes(32).toString('base64');
  process.env.JWT_SECRET = 'secreto-de-prueba';
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'cliente.apps.googleusercontent.com';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'secreto-del-cliente';
  process.env.API_URL = 'https://api.plataforma.test';
  process.env.APP_URL = 'https://app.plataforma.test';
  process.env.CORS_ROOT_DOMAIN = 'plataforma.test';
  delete process.env.GOOGLE_CALENDAR_STATE_SECRET;
  delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  delete process.env.CORS_EXTRA_ORIGINS;
});

afterAll(() => {
  for (const k of CLAVES) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
});

const ESTADO = { t: 't1', u: 'u1', o: 'https://app.selleala.com', r: '/admin/sales-teams/t1/configuracion' };

describe('el state del OAuth', () => {
  it('se lee tal cual se firmó', () => {
    const r = leerEstado(firmarEstado(ESTADO));
    expect(r).toEqual({ ok: true, datos: ESTADO });
  });

  it('una letra cambiada en el contenido o en la firma lo invalida', () => {
    const [v, cuerpo, firma] = firmarEstado(ESTADO).split('.');
    const otroCuerpo = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo, 'base64url').toString()), o: 'https://evil.com' }),
    ).toString('base64url');
    expect(leerEstado(`${v}.${otroCuerpo}.${firma}`)).toEqual({ ok: false, motivo: 'invalido' });
    const otraFirma = (firma[0] === 'A' ? 'B' : 'A') + firma.slice(1);
    expect(leerEstado(`${v}.${cuerpo}.${otraFirma}`)).toEqual({ ok: false, motivo: 'invalido' });
    expect(leerEstado('basura')).toEqual({ ok: false, motivo: 'invalido' });
    expect(leerEstado(undefined)).toEqual({ ok: false, motivo: 'invalido' });
  });

  it('vence a los 10 minutos, pero con firma buena sabe a dónde volver', () => {
    const state = firmarEstado(ESTADO, Date.now() - 11 * 60_000);
    expect(leerEstado(state)).toEqual({ ok: false, motivo: 'vencido', datos: ESTADO });
  });

  it('firmado con otro secreto no vale', () => {
    const state = firmarEstado(ESTADO);
    process.env.JWT_SECRET = 'otro-secreto';
    try {
      expect(leerEstado(state)).toEqual({ ok: false, motivo: 'invalido' });
    } finally {
      process.env.JWT_SECRET = 'secreto-de-prueba';
    }
  });

  it('pide el permiso offline, con consentimiento y los scopes mínimos', () => {
    const u = new URL(urlDeConsentimiento('v1.x.y'));
    expect(u.searchParams.get('redirect_uri')).toBe('https://api.plataforma.test/api/public/calendario-google/callback');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe('v1.x.y');
    const scopes = u.searchParams.get('scope')!.split(' ');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(scopes.some((s) => s.includes('gmail'))).toBe(false);
  });

  it('sin credenciales no está configurado', () => {
    const secreto = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    try {
      expect(googleConfigurado()).toBe(false);
    } finally {
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET = secreto;
    }
    expect(googleConfigurado()).toBe(true);
  });
});

describe('a dónde se vuelve', () => {
  const sellea = { hosts: new Set(['app.selleala.com']), plataforma: false };
  const plataforma = { hosts: new Set<string>(), plataforma: true };

  it('solo a un panel de la marca del equipo y a una ruta local', () => {
    expect(origenPermitido('https://app.selleala.com', sellea)).toBe('https://app.selleala.com');
    // Un equipo de Sellea no devuelve el código al panel de la plataforma.
    expect(origenPermitido('https://app.plataforma.test', sellea)).toBeNull();
    expect(origenPermitido('https://equipos.plataforma.test', sellea)).toBeNull();
    // Ni uno de la plataforma al de una marca.
    expect(origenPermitido('https://equipos.plataforma.test', plataforma)).toBe('https://equipos.plataforma.test');
    expect(origenPermitido('https://app.selleala.com', plataforma)).toBeNull();
    expect(origenPermitido('https://evil.com', plataforma)).toBeNull();
    expect(origenPermitido('http://app.selleala.com', sellea)).toBeNull();
    expect(origenPermitido('https://app.selleala.com/otra', sellea)).toBeNull();
    expect(rutaSegura('/admin/sales-teams/t1/configuracion')).toBe('/admin/sales-teams/t1/configuracion');
    expect(rutaSegura('//evil.com')).toBeNull();
    expect(rutaSegura('https://evil.com')).toBeNull();
  });

  it('el código de Google va en el fragmento, no en la URL que ve un servidor', () => {
    const url = urlDeVuelta(ESTADO, { calendario: 'codigo', code: '4/abc' });
    expect(url.split('#')[0]).toBe('https://app.selleala.com/admin/sales-teams/t1/configuracion');
    expect(url.split('#')[1]).toContain('code=4%2Fabc');
  });
});

describe('tokens cifrados', () => {
  it('se guardan cifrados y se leen de vuelta', () => {
    const guardado = cifrarToken('ya29.token-de-google');
    expect(guardado.startsWith('enc:v1:')).toBe(true);
    expect(guardado).not.toContain('token-de-google');
    expect(descifrarToken(guardado)).toBe('ya29.token-de-google');
  });

  it('un token en plano o con otra clave no se usa', () => {
    expect(descifrarToken('ya29.token-en-plano')).toBeNull();
    const guardado = cifrarToken('ya29.token');
    const clave = process.env.SECRETS_ENC_KEY;
    process.env.SECRETS_ENC_KEY = randomBytes(32).toString('base64');
    try {
      expect(descifrarToken(guardado)).toBeNull();
    } finally {
      process.env.SECRETS_ENC_KEY = clave;
    }
  });
});

describe('el evento', () => {
  const base = {
    citaId: '5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    inicio: new Date('2026-10-01T15:00:00Z'),
    duracionMin: 45,
    zona: 'America/Bogota',
    titulo: 'Reunión con Equipo Norte · Ana',
    descripcion: 'Cliente: Ana',
    invitados: [{ email: 'ana@cliente.com' }],
    colorId: '2',
    gestionados: { closer: null, cliente: 'ana@cliente.com' },
  };

  it('lleva hora, zona, sala, color e id fijo de la cita', () => {
    const ev = construirEvento({ ...base, pedirSala: true }, { conId: true }) as any;
    expect(ev.start).toEqual({ dateTime: '2026-10-01T15:00:00.000Z', timeZone: 'America/Bogota' });
    expect(ev.end.dateTime).toBe('2026-10-01T15:45:00.000Z');
    expect(ev.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
    expect(ev.colorId).toBe('2');
    expect(ev.id).toBe(idDeEventoParaCita(base.citaId));
    expect(ev.id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(ev.extendedProperties.private.citaId).toBe(base.citaId);
  });

  it('sin sala pedida no toca la conferencia (un PATCH conserva la que había)', () => {
    const ev = construirEvento({ ...base, pedirSala: false }, { conId: false }) as any;
    expect(ev.conferenceData).toBeUndefined();
    expect(ev.id).toBeUndefined();
  });

  it('el título no lleva el nombre de la plataforma', () => {
    expect(tituloDelEvento({ equipo: 'Equipo Norte', cliente: 'Ana' })).toBe('Reunión con Equipo Norte · Ana');
    expect(tituloDelEvento({ tituloAgenda: 'Asesoría gratis', equipo: 'Equipo Norte' })).toBe('Asesoría gratis');
  });

  it('al reasignar sale el closer anterior, entra el nuevo y el cliente conserva su respuesta', () => {
    const invitados = invitadosDelEvento({
      existentes: [
        { email: 'ana@cliente.com', responseStatus: 'accepted' },
        { email: 'luis@closer.com' },
        { email: 'jefe@equipo.com' },
      ],
      anteriores: { closer: 'luis@closer.com', cliente: 'ana@cliente.com' },
      cliente: { email: 'ana@cliente.com', nombre: 'Ana' },
      closer: { email: 'Marta@Closer.com', nombre: 'Marta' },
      invitarCliente: true,
      invitarCloser: true,
    });
    expect(invitados).toEqual([
      { email: 'ana@cliente.com', responseStatus: 'accepted' },
      { email: 'jefe@equipo.com' },
      { email: 'marta@closer.com', displayName: 'Marta' },
    ]);
  });

  it('sin la casilla, el cliente no se invita', () => {
    const invitados = invitadosDelEvento({
      cliente: { email: 'ana@cliente.com' },
      closer: { email: 'luis@closer.com' },
      invitarCliente: false,
      invitarCloser: true,
    });
    expect(invitados.map((i) => i.email)).toEqual(['luis@closer.com']);
  });

  it('el color de la agenda va al tono de Google más parecido', () => {
    expect(colorDeGoogleMasCercano('#22C55E')).toBe('2');
    expect(colorDeGoogleMasCercano('#F59E0B')).toBe('5');
    expect(colorDeGoogleMasCercano(null)).toBeNull();
    expect(colorDeGoogleMasCercano('verde')).toBeNull();
  });

  it('el enlace de gestión sale del dominio de la marca, o no sale', () => {
    expect(enlaceDeGestion({ slug: 'sellea', domain: 'selleala.com', appDomain: 'app.selleala.com' }, 'tok')).toBe(
      'https://app.selleala.com/agenda/cita/tok',
    );
    expect(enlaceDeGestion({ slug: 'otra', domain: null, appDomain: null }, 'tok')).toBeNull();
  });

  it('{{sala}} entra en el mensaje de WhatsApp', () => {
    expect(mensajeDeWhatsapp('Hola {{nombre}}, entra aquí: {{sala}}', { nombre: 'Ana', sala: 'https://meet.google.com/abc' })).toBe(
      'Hola Ana, entra aquí: https://meet.google.com/abc',
    );
  });
});

// ── El servicio, con Google y la base de mentira ─────────────────────────

const CITA_ID = '5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const SALA = 'https://meet.google.com/abc-defg-hij';

function montar(opciones: { cita?: Record<string, unknown>; conexion?: Record<string, unknown> | null; closer?: string } = {}) {
  const escrituras = { citas: [] as any[], conexiones: [] as any[] };
  const db: { conexion: any } = {
    conexion:
      opciones.conexion === null
        ? null
        : {
            salesTeamId: 't1',
            active: true,
            email: 'agenda@equipo.com',
            accessToken: cifrarToken('token-vigente'),
            refreshToken: cifrarToken('token-de-refresco'),
            expiresAt: new Date(Date.now() + 3600_000),
            calendarId: 'primary',
            colorId: '9',
            autoMeet: true,
            inviteLead: true,
            inviteCloser: true,
            sendUpdates: true,
            connectedAt: new Date(),
            lastError: null,
            lastSyncAt: null,
            ...opciones.conexion,
          },
  };
  const cita = {
    id: CITA_ID,
    salesTeamId: 't1',
    hostUserId: 'u-closer',
    startAt: new Date('2026-10-01T15:00:00Z'),
    durationMin: 30,
    timezone: 'America/Bogota',
    status: 'PENDIENTE',
    manageToken: 'tok123',
    meetUrl: null,
    gcalEventId: null,
    gcalCalendarId: null,
    lead: { name: 'Ana Pérez', email: 'ana@cliente.com', phone: '+57 300 000 0000', company: 'Café Ana' },
    agenda: { color: '#22C55E', settings: {} },
    team: { name: 'Equipo Norte', whiteLabel: { slug: 'sellea', domain: 'selleala.com', appDomain: 'app.selleala.com' } },
    ...opciones.cita,
  };
  const prisma = {
    salesMeeting: {
      findUnique: vi.fn(async () => cita),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async (a: any) => {
        escrituras.citas.push(a.data);
        return { count: 1 };
      }),
    },
    salesCalendarConnection: {
      findUnique: vi.fn(async () => db.conexion),
      updateMany: vi.fn(async (a: any) => {
        escrituras.conexiones.push(a.data);
        return { count: 1 };
      }),
      upsert: vi.fn(async (a: any) => {
        db.conexion = { salesTeamId: 't1', calendarId: 'primary', autoMeet: true, inviteLead: true, inviteCloser: true, sendUpdates: true, colorId: null, lastSyncAt: null, ...a.create };
        return db.conexion;
      }),
    },
    salesTeamMember: {
      findUnique: vi.fn(async () => ({ user: { email: opciones.closer ?? 'luis@closer.com', fullName: 'Luis Closer' } })),
    },
    whiteLabel: {
      findMany: vi.fn(async () => [{ domain: 'selleala.com', appDomain: 'app.selleala.com' }]),
      // `iniciar` lee la marca del equipo para saber a qué dominios puede
      // volver el código de Google.
      findUnique: vi.fn(async () => ({ slug: 'sellea', domain: 'selleala.com', appDomain: 'app.selleala.com' })),
    },
  };
  const google = {
    canjearCodigo: vi.fn(),
    renovarAcceso: vi.fn(),
    correoDeLaCuenta: vi.fn(async () => null),
    revocar: vi.fn(async () => undefined),
    crearEvento: vi.fn(async (_t: string, _c: string, cuerpo: any, _avisar?: boolean) => ({ id: cuerpo.id ?? 'ev-libre', hangoutLink: SALA })),
    verEvento: vi.fn(),
    actualizarEvento: vi.fn(),
    borrarEvento: vi.fn(async () => undefined),
    listarCalendarios: vi.fn(async () => []),
  };
  const svc = new CalendarioDeEquipoService(prisma as unknown as PrismaService);
  svc.cliente = google as any;
  return { svc, prisma, google, escrituras, db };
}

const USUARIO = { id: 'u1', role: 'AFFILIATE_VENDOR' } as any;

describe('la sala de cada cita', () => {
  it('un fallo de Google no rompe la cita: devuelve null y deja el motivo', async () => {
    const { svc, google, escrituras } = montar();
    google.crearEvento.mockRejectedValue(new ErrorDeGoogle('Backend Error', 500));
    await expect(svc.sincronizarCita(CITA_ID)).resolves.toBeNull();
    expect(escrituras.citas).toEqual([{ gcalError: 'Google: Backend Error' }]);
    expect(escrituras.conexiones.at(-1)).toEqual({ lastError: 'Google: Backend Error' });
  });

  it('ni aunque falle la base', async () => {
    const { svc, prisma } = montar();
    prisma.salesMeeting.findUnique.mockRejectedValue(new Error('se cayó la conexión'));
    await expect(svc.sincronizarCita(CITA_ID)).resolves.toBeNull();
  });

  it('crea el evento con sala, invitados y el color de la agenda, y guarda el enlace en la cita', async () => {
    const { svc, google, escrituras } = montar();
    await expect(svc.sincronizarCita(CITA_ID)).resolves.toBe(SALA);
    expect(google.crearEvento).toHaveBeenCalledTimes(1);
    const [token, calendario, cuerpo, avisar] = google.crearEvento.mock.calls[0];
    expect(token).toBe('token-vigente');
    expect(calendario).toBe('primary');
    expect(avisar).toBe(true);
    expect(cuerpo.id).toBe(idDeEventoParaCita(CITA_ID));
    expect(cuerpo.attendees.map((a: any) => a.email)).toEqual(['ana@cliente.com', 'luis@closer.com']);
    expect(cuerpo.colorId).toBe('2');
    expect(cuerpo.conferenceData).toBeDefined();
    expect(cuerpo.description).toContain('https://app.selleala.com/agenda/cita/tok123');
    expect(escrituras.citas.at(-1)).toEqual({ gcalEventId: cuerpo.id, gcalCalendarId: 'primary', meetUrl: SALA, gcalError: null });
  });

  it('reasignar cambia el invitado y no la sala', async () => {
    const { svc, google, escrituras } = montar({
      cita: { gcalEventId: 'ev1', gcalCalendarId: 'primary', meetUrl: SALA, agenda: null },
      closer: 'marta@closer.com',
    });
    google.verEvento.mockResolvedValue({
      id: 'ev1',
      hangoutLink: SALA,
      attendees: [{ email: 'ana@cliente.com', responseStatus: 'accepted' }, { email: 'luis@closer.com' }],
      extendedProperties: { private: { closer: 'luis@closer.com', cliente: 'ana@cliente.com' } },
    });
    google.actualizarEvento.mockImplementation(async () => ({ id: 'ev1', hangoutLink: SALA }));
    await expect(svc.sincronizarCita(CITA_ID)).resolves.toBe(SALA);
    expect(google.crearEvento).not.toHaveBeenCalled();
    const [, calendario, eventId, cuerpo] = google.actualizarEvento.mock.calls[0];
    expect([calendario, eventId]).toEqual(['primary', 'ev1']);
    expect(cuerpo.conferenceData).toBeUndefined();
    expect(cuerpo.colorId).toBe('9');
    expect(cuerpo.attendees).toEqual([
      { email: 'ana@cliente.com', responseStatus: 'accepted' },
      { email: 'marta@closer.com', displayName: 'Luis Closer' },
    ]);
    expect(escrituras.citas.at(-1)).toMatchObject({ gcalEventId: 'ev1', meetUrl: SALA });
  });

  it('si el evento ya existe (409) se adopta en vez de crear otro', async () => {
    const { svc, google } = montar();
    const id = idDeEventoParaCita(CITA_ID);
    google.crearEvento.mockRejectedValue(new ErrorDeGoogle('The requested identifier already exists.', 409));
    google.verEvento.mockResolvedValue({ id, status: 'cancelled', hangoutLink: SALA, attendees: [] });
    google.actualizarEvento.mockResolvedValue({ id, hangoutLink: SALA });
    await expect(svc.sincronizarCita(CITA_ID)).resolves.toBe(SALA);
    expect(google.crearEvento).toHaveBeenCalledTimes(1);
    expect(google.actualizarEvento.mock.calls[0][2]).toBe(id);
    expect(google.actualizarEvento.mock.calls[0][3].status).toBe('confirmed');
  });

  it('cancelar la cita cancela el evento', async () => {
    const { svc, google } = montar({ cita: { status: 'CANCELADA', gcalEventId: 'ev1', gcalCalendarId: 'agenda@equipo.com' } });
    await expect(svc.sincronizarCita(CITA_ID)).resolves.toBeNull();
    expect(google.borrarEvento).toHaveBeenCalledWith('token-vigente', 'agenda@equipo.com', 'ev1', true);
  });

  it('sin cuenta conectada no llama a Google ni deja error', async () => {
    const { svc, google, escrituras } = montar({ conexion: { active: false } });
    await expect(svc.sincronizarCita(CITA_ID)).resolves.toBeNull();
    expect(google.crearEvento).not.toHaveBeenCalled();
    expect(escrituras.citas).toEqual([]);
  });

  it('con esperarMs no espera a un Google lento, pero la sala se guarda igual', async () => {
    const { svc, google, escrituras } = montar();
    google.crearEvento.mockImplementation(
      (_t: string, _c: string, cuerpo: any) =>
        new Promise((res) => setTimeout(() => res({ id: cuerpo.id, hangoutLink: SALA }), 120)),
    );
    await expect(svc.sincronizarCita(CITA_ID, { esperarMs: 10 })).resolves.toBeNull();
    await new Promise((r) => setTimeout(r, 250));
    expect(escrituras.citas.at(-1)).toMatchObject({ meetUrl: SALA });
  });

  it('renueva un token vencido y lo guarda cifrado', async () => {
    const { svc, google, escrituras } = montar({ conexion: { expiresAt: new Date(Date.now() - 1000) } });
    google.renovarAcceso.mockResolvedValue({ access_token: 'token-renovado', expires_in: 3600 });
    await svc.sincronizarCita(CITA_ID);
    expect(google.crearEvento.mock.calls[0][0]).toBe('token-renovado');
    const guardado = escrituras.conexiones.find((d) => d.accessToken);
    expect(guardado.accessToken.startsWith('enc:v1:')).toBe(true);
    expect(JSON.stringify(guardado)).not.toContain('token-renovado');
  });
});

describe('la conexión', () => {
  const idToken = ['x', Buffer.from(JSON.stringify({ email: 'Agenda@Equipo.com' })).toString('base64url'), 'y'].join('.');
  const TOKENS = {
    access_token: 'acceso-en-plano',
    refresh_token: 'refresco-en-plano',
    expires_in: 3600,
    scope: 'openid email https://www.googleapis.com/auth/calendar.events',
    id_token: idToken,
  };

  it('el callback devuelve el código al panel de origen; con un state malo no redirige', () => {
    const { svc } = montar();
    const state = firmarEstado(ESTADO);
    const ok = svc.vueltaDelCallback({ code: '4/abc', state }) as { url: string };
    expect(ok.url.startsWith('https://app.selleala.com/admin/sales-teams/t1/configuracion#')).toBe(true);
    expect(ok.url).toContain('calendario=codigo');
    expect((svc.vueltaDelCallback({ error: 'access_denied', state }) as { url: string }).url).toContain('calendario=cancelado');
    expect('html' in svc.vueltaDelCallback({ code: '4/abc', state: 'falso' })).toBe(true);
  });

  it('iniciar no acepta volver a un dominio ajeno', async () => {
    const { svc } = montar();
    await expect(svc.iniciar(USUARIO, 't1', { origen: 'https://evil.com', ruta: '/x' })).rejects.toBeInstanceOf(BadRequestException);
    const r = await svc.iniciar(USUARIO, 't1', { origen: 'https://app.selleala.com', ruta: ESTADO.r });
    expect(r.url.startsWith('https://accounts.google.com/')).toBe(true);
  });

  it('la termina solo quien la empezó, y para ese equipo', async () => {
    const { svc, google } = montar();
    const deOtro = firmarEstado({ ...ESTADO, u: 'u-otro' });
    await expect(svc.conectar(USUARIO, 't1', { code: 'c', state: deOtro })).rejects.toBeInstanceOf(ForbiddenException);
    const deOtroEquipo = firmarEstado({ ...ESTADO, t: 't2' });
    await expect(svc.conectar(USUARIO, 't1', { code: 'c', state: deOtroEquipo })).rejects.toBeInstanceOf(ForbiddenException);
    expect(google.canjearCodigo).not.toHaveBeenCalled();
  });

  it('guarda los tokens cifrados y el estado no los devuelve nunca', async () => {
    const { svc, google, prisma } = montar({ conexion: null });
    google.canjearCodigo.mockResolvedValue(TOKENS);
    await expect(svc.conectar(USUARIO, 't1', { code: 'c', state: firmarEstado(ESTADO) })).resolves.toEqual({
      ok: true,
      email: 'agenda@equipo.com',
    });
    const guardado = prisma.salesCalendarConnection.upsert.mock.calls[0][0];
    expect(guardado.create.accessToken.startsWith('enc:v1:')).toBe(true);
    expect(guardado.create.refreshToken.startsWith('enc:v1:')).toBe(true);
    expect(JSON.stringify(guardado)).not.toMatch(/acceso-en-plano|refresco-en-plano/);

    const estado = await svc.estado(USUARIO, 't1');
    expect(estado.conexion?.conectado).toBe(true);
    expect(estado.conexion?.email).toBe('agenda@equipo.com');
    expect(JSON.stringify(estado)).not.toMatch(/enc:v1:|acceso-en-plano|refresco-en-plano/);
  });

  it('sin el permiso de eventos no se conecta y el acceso se revoca', async () => {
    const { svc, google, prisma } = montar({ conexion: null });
    google.canjearCodigo.mockResolvedValue({ ...TOKENS, scope: 'openid email' });
    await expect(svc.conectar(USUARIO, 't1', { code: 'c', state: firmarEstado(ESTADO) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(google.revocar).toHaveBeenCalledWith('acceso-en-plano');
    expect(prisma.salesCalendarConnection.upsert).not.toHaveBeenCalled();
  });
});
