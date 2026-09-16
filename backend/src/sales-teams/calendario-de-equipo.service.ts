import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveTeamAccess, type AccesoAlEquipo } from './team-access';
import {
  COLORES_DE_GOOGLE,
  cifrarToken,
  colorDeGoogleMasCercano,
  construirEvento,
  correoDelIdToken,
  descifrarToken,
  descripcionDelEvento,
  enlaceDeMeet,
  esColorDeGoogle,
  firmarEstado,
  googleConfigurado,
  idDeEventoParaCita,
  invitadosDelEvento,
  leerEstado,
  origenPermitido,
  rutaSegura,
  tienePermisoDeEventos,
  tituloDelEvento,
  urlDeConsentimiento,
  urlDeVuelta,
  type DatosDelEvento,
  type EventoDeGoogle,
} from './calendario-de-equipo';
import { clienteDeGoogle, ErrorDeGoogle, type ClienteDeGoogle } from './cliente-google-calendar';

/**
 * «📆 Conexión de Calendario / Correo» de un equipo de ventas: la de TeamClubify
 * (`TeamCalendarConnection`, `app/actions/calendar.ts`, `meeting-room.ts`).
 *
 * Dos mitades:
 * · La CONEXIÓN (líder o admin de la marca): conectar la cuenta de Google del
 *   equipo, elegir calendario y color, probar, generar salas, desconectar.
 * · La SALA de cada cita: `sincronizarCita`, el único punto de enganche para la
 *   agenda y el Banco. Crea, mueve, reasigna o cancela el evento según cómo está
 *   la cita EN LA BASE en ese momento, así da igual desde dónde se llame.
 *
 * TODO lo de la sala es best-effort: si el equipo no tiene cuenta o Google falla,
 * la cita sigue su curso y el motivo queda en `SalesMeeting.gcalError` y en la
 * conexión (`lastError`). Una cita no se puede perder por Google.
 */

const ABIERTAS = ['PENDIENTE', 'CONFIRMADA'];
const ZONA_POR_DEFECTO = 'America/Bogota';
const MAX_ERROR = 400;

type Conexion = {
  token: string;
  calendarId: string;
  colorId: string | null;
  autoMeet: boolean;
  inviteLead: boolean;
  inviteCloser: boolean;
  sendUpdates: boolean;
};

const esNoEsta = (e: unknown) => e instanceof ErrorDeGoogle && (e.status === 404 || e.status === 410);

/** Lo que se enseña al admin. De Google, su motivo; de lo demás, nada interno. */
function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorDeGoogle) return `Google: ${e.message}`.slice(0, MAX_ERROR);
  return 'No se pudo sincronizar con Google Calendar.';
}

/**
 * El enlace para cambiar o cancelar, en el dominio de la MARCA. Sin dominio
 * resuelto no se pone ninguno: un enlace de la plataforma en la invitación de
 * otra marca la delataría.
 */
export function enlaceDeGestion(
  marca: { slug: string; domain: string | null; appDomain: string | null } | null | undefined,
  manageToken: string,
): string | null {
  if (!marca) return null;
  const ruta = `/agenda/cita/${encodeURIComponent(manageToken)}`;
  const host = (marca.appDomain || marca.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (host) return `https://${host}${ruta}`;
  const app = marca.slug === 'clubify' ? (process.env.APP_URL ?? '').trim().replace(/\/+$/, '') : '';
  return app ? `${app}${ruta}` : null;
}

/** El título público de la agenda, leído directo del JSON: si no hay, el del equipo. */
function tituloDeAgenda(settings: unknown): string | null {
  const t = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).titulo : null;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

@Injectable()
export class CalendarioDeEquipoService {
  private readonly logger = new Logger('CalendarioDeEquipo');
  /** Google. Se cambia en las pruebas. */
  cliente: ClienteDeGoogle = clienteDeGoogle;
  /**
   * Una sincronización por cita a la vez en esta instancia. Agendar y asignar
   * casi a la vez lanzaban dos altas del mismo evento; entre instancias lo
   * resuelve el id fijo del evento (Google responde 409 al segundo).
   */
  private readonly cola = new Map<string, Promise<unknown>>();

  constructor(private prisma: PrismaService) {}

  // ── Permisos ────────────────────────────────────────────────────────────

  private puedeConfigurar(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  /** La misma regla que el resto de «Configuración». */
  private async exigirConfigurar(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    if (!this.puedeConfigurar(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden cambiar la conexión del calendario');
    }
    return acceso;
  }

  private exigirGoogle() {
    if (!googleConfigurado()) throw new BadRequestException('Falta configurar la conexión con Google.');
  }

  // ── La conexión ─────────────────────────────────────────────────────────

  async estado(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    // Sin la tabla (migración sin aplicar) se ve como «sin conectar», no como un 500.
    const c = await this.prisma.salesCalendarConnection
      .findUnique({ where: { salesTeamId: teamId } })
      .catch(() => null);
    return {
      configurado: googleConfigurado(),
      puedeConfigurar: this.puedeConfigurar(acceso),
      // Campo a campo: los tokens no salen nunca de aquí, ni cifrados.
      conexion: c
        ? {
            conectado: c.active && !!descifrarToken(c.refreshToken),
            email: c.email,
            desde: c.connectedAt,
            calendarioId: c.calendarId,
            colorId: c.colorId,
            crearSala: c.autoMeet,
            invitarCliente: c.inviteLead,
            invitarCloser: c.inviteCloser,
            enviarInvitaciones: c.sendUpdates,
            ultimoError: c.lastError,
            ultimaSincronizacion: c.lastSyncAt,
          }
        : null,
      colores: COLORES_DE_GOOGLE,
    };
  }

  /**
   * Desde qué paneles puede volver la conexión: los dominios de la marca DEL
   * EQUIPO, y los de la plataforma solo si la marca es la plataforma o no tiene
   * dominio propio. Sin marca, ninguno: cerrado por defecto.
   */
  private async origenesDelEquipo(whiteLabelId: string | null): Promise<{ hosts: Set<string>; plataforma: boolean }> {
    const marca = whiteLabelId
      ? await this.prisma.whiteLabel.findUnique({
          where: { id: whiteLabelId },
          select: { slug: true, domain: true, appDomain: true },
        })
      : null;
    const hosts = new Set<string>();
    for (const d of [marca?.domain, marca?.appDomain]) {
      const h = (d ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (!h) continue;
      hosts.add(h);
      if (!h.startsWith('www.')) hosts.add(`www.${h}`);
    }
    return { hosts, plataforma: !!marca && (marca.slug === 'clubify' || hosts.size === 0) };
  }

  /** Paso 1: la URL del permiso de Google, con el `state` firmado. */
  async iniciar(user: AuthUser, teamId: string, body: { origen?: string; ruta?: string }) {
    const acceso = await this.exigirConfigurar(user, teamId);
    this.exigirGoogle();
    const origen = origenPermitido(body.origen, await this.origenesDelEquipo(acceso.team.whiteLabelId));
    const ruta = rutaSegura(body.ruta);
    if (!origen || !ruta) throw new BadRequestException('No se puede conectar el calendario desde esta dirección.');
    return { url: urlDeConsentimiento(firmarEstado({ t: teamId, u: user.id, o: origen, r: ruta })) };
  }

  /**
   * Paso 2, el callback PÚBLICO de Google. Aquí no hay sesión, así que NO se
   * canjea nada: solo se comprueba la firma del `state` y se devuelve el código
   * al panel del que salió, que lo termina con su sesión (`conectar`). Así un
   * enlace de permiso reenviado a otra persona no conecta su cuenta a un equipo
   * ajeno: al volver, esa persona no es quien lo inició.
   */
  vueltaDelCallback(q: { code?: string; state?: string; error?: string }): { url: string } | { html: string } {
    const lectura = leerEstado(q.state);
    if (!lectura.ok && lectura.motivo === 'invalido') {
      return {
        html:
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Conexión con Google</title>' +
          '<p style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">' +
          'No se pudo completar la conexión con Google: el enlace no es válido. Vuelve a la configuración del equipo e inténtalo de nuevo.</p>',
      };
    }
    if (!lectura.ok) return { url: urlDeVuelta(lectura.datos, { calendario: 'vencido' }) };
    if (q.error) return { url: urlDeVuelta(lectura.datos, { calendario: q.error === 'access_denied' ? 'cancelado' : 'error' }) };
    if (!q.code || q.code.length > 2000) return { url: urlDeVuelta(lectura.datos, { calendario: 'error' }) };
    return { url: urlDeVuelta(lectura.datos, { calendario: 'codigo', code: q.code, state: q.state as string }) };
  }

  /** Paso 3: el panel, con su sesión, canjea el código y guarda la conexión. */
  async conectar(user: AuthUser, teamId: string, body: { code?: string; state?: string }) {
    const lectura = leerEstado(body.state);
    if (!lectura.ok) {
      throw new BadRequestException(
        lectura.motivo === 'vencido'
          ? 'El permiso de Google tardó demasiado. Vuelve a conectar la cuenta.'
          : 'La conexión con Google no es válida. Vuelve a intentarlo.',
      );
    }
    if (lectura.datos.t !== teamId || lectura.datos.u !== user.id) {
      throw new ForbiddenException('Esta conexión la empezó otra persona o es de otro equipo.');
    }
    await this.exigirConfigurar(user, teamId);
    this.exigirGoogle();
    if (!body.code) throw new BadRequestException('Google no devolvió el permiso. Vuelve a intentarlo.');

    let tok;
    try {
      tok = await this.cliente.canjearCodigo(body.code);
    } catch (e) {
      this.logger.warn(`canje del código (equipo ${teamId}): ${(e as Error).message}`);
      throw new BadRequestException('Google no aceptó la conexión. Vuelve a intentarlo.');
    }
    if (!tienePermisoDeEventos(tok.scope)) {
      await this.cliente.revocar(tok.access_token);
      throw new BadRequestException('Falta el permiso del calendario. Vuelve a conectar y deja marcada la casilla de Google Calendar.');
    }
    const email = correoDelIdToken(tok.id_token) ?? (await this.cliente.correoDeLaCuenta(tok.access_token));

    const previa = await this.prisma.salesCalendarConnection.findUnique({
      where: { salesTeamId: teamId },
      select: { email: true, refreshToken: true },
    });
    const mismaCuenta = !!previa?.email && !!email && previa.email.toLowerCase() === email;
    // Google solo entrega refresh_token con consentimiento: si al reconectar la
    // MISMA cuenta no llega, sirve el de antes. De otra cuenta, nunca.
    const refresh = tok.refresh_token
      ? cifrarToken(tok.refresh_token)
      : mismaCuenta && descifrarToken(previa?.refreshToken)
        ? previa!.refreshToken
        : null;
    if (!refresh) {
      await this.cliente.revocar(tok.access_token);
      throw new BadRequestException(
        'Google no entregó el permiso permanente. Quita el acceso en tu cuenta de Google (Seguridad → Conexiones con terceros) y vuelve a conectar.',
      );
    }
    if (previa && !mismaCuenta) {
      // La cuenta anterior deja de estar conectada: su permiso se revoca, no se queda vivo en Google.
      const vieja = descifrarToken(previa.refreshToken);
      if (vieja) await this.cliente.revocar(vieja);
    }

    const data = {
      provider: 'google',
      email,
      accessToken: cifrarToken(tok.access_token),
      refreshToken: refresh,
      expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
      scope: tok.scope ?? null,
      active: true,
      connectedByUserId: user.id,
      connectedAt: new Date(),
      lastError: null,
      // Con otra cuenta, el calendario elegido antes puede no existir en ella.
      ...(mismaCuenta ? {} : { calendarId: 'primary' }),
    };
    await this.prisma.salesCalendarConnection.upsert({
      where: { salesTeamId: teamId },
      create: { salesTeamId: teamId, ...data },
      update: data,
    });
    return { ok: true, email };
  }

  async desconectar(user: AuthUser, teamId: string) {
    await this.exigirConfigurar(user, teamId);
    const c = await this.prisma.salesCalendarConnection.findUnique({
      where: { salesTeamId: teamId },
      select: { refreshToken: true, accessToken: true },
    });
    if (!c) return { ok: true };
    const token = descifrarToken(c.refreshToken) ?? descifrarToken(c.accessToken);
    if (token) await this.cliente.revocar(token);
    await this.prisma.salesCalendarConnection.updateMany({
      where: { salesTeamId: teamId },
      data: {
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        scope: null,
        email: null,
        active: false,
        connectedAt: null,
        lastError: null,
      },
    });
    return { ok: true };
  }

  async calendarios(user: AuthUser, teamId: string) {
    await this.exigirConfigurar(user, teamId);
    try {
      const c = await this.conexionUsable(teamId);
      if (!c) return { calendarios: [], aviso: 'No hay ninguna cuenta conectada.' };
      return { calendarios: await this.cliente.listarCalendarios(c.token) };
    } catch {
      return {
        calendarios: [],
        aviso: 'Google no dejó ver la lista de calendarios. Reconecta la cuenta para dar ese permiso.',
      };
    }
  }

  async guardarPreferencias(
    user: AuthUser,
    teamId: string,
    body: {
      calendarioId?: string;
      colorId?: string | null;
      crearSala?: boolean;
      invitarCliente?: boolean;
      invitarCloser?: boolean;
      enviarInvitaciones?: boolean;
    },
  ) {
    await this.exigirConfigurar(user, teamId);
    const data: Record<string, unknown> = {};
    if (body.calendarioId !== undefined) {
      const id = String(body.calendarioId).trim();
      if (!id) throw new BadRequestException('Elige un calendario');
      if (id !== 'primary') {
        // Solo uno donde la cuenta puede escribir: con otro, cada cita fallaría en silencio.
        const lista = await this.calendarios(user, teamId);
        if (!lista.calendarios.some((c) => c.id === id)) {
          throw new BadRequestException('Ese calendario no está en la cuenta conectada o no se puede escribir en él');
        }
      }
      data.calendarId = id;
    }
    if (body.colorId !== undefined) {
      if (body.colorId !== null && body.colorId !== '' && !esColorDeGoogle(body.colorId)) {
        throw new BadRequestException('Ese color no existe en Google Calendar');
      }
      data.colorId = body.colorId || null;
    }
    if (body.crearSala !== undefined) data.autoMeet = !!body.crearSala;
    if (body.invitarCliente !== undefined) data.inviteLead = !!body.invitarCliente;
    if (body.invitarCloser !== undefined) data.inviteCloser = !!body.invitarCloser;
    if (body.enviarInvitaciones !== undefined) data.sendUpdates = !!body.enviarInvitaciones;
    if (!Object.keys(data).length) return { ok: true };
    const r = await this.prisma.salesCalendarConnection.updateMany({ where: { salesTeamId: teamId }, data });
    if (r.count === 0) throw new NotFoundException('Primero conecta la cuenta de Google del equipo');
    return { ok: true };
  }

  /**
   * Crea un evento en el calendario elegido y lo borra enseguida, sin avisar a
   * nadie: prueba de verdad que se puede escribir y generar la sala.
   */
  async probar(user: AuthUser, teamId: string) {
    await this.exigirConfigurar(user, teamId);
    if (!googleConfigurado()) return { ok: false, mensaje: 'Falta configurar la conexión con Google.' };
    try {
      const c = await this.conexionUsable(teamId);
      if (!c) return { ok: false, mensaje: 'No hay ninguna cuenta conectada.' };
      const inicio = new Date(Date.now() + 24 * 3600_000);
      const ev = await this.cliente.crearEvento(
        c.token,
        c.calendarId,
        {
          summary: 'Prueba de conexión',
          description: 'Evento de prueba. Se borra solo.',
          start: { dateTime: inicio.toISOString() },
          end: { dateTime: new Date(inicio.getTime() + 15 * 60_000).toISOString() },
          ...(c.autoMeet
            ? { conferenceData: { createRequest: { requestId: `prueba-${randomUUID()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
            : {}),
        },
        false,
      );
      const sala = enlaceDeMeet(ev);
      await this.cliente.borrarEvento(c.token, c.calendarId, ev.id, false).catch(() => undefined);
      await this.marcarConexion(teamId, null);
      if (c.autoMeet && !sala) {
        return { ok: false, mensaje: 'El evento se creó, pero Google no generó la sala de Meet en esta cuenta.' };
      }
      return {
        ok: true,
        mensaje: c.autoMeet ? 'Todo bien: se creó el evento y su sala de Meet.' : 'Todo bien: se creó el evento (sin sala: la opción está apagada).',
      };
    } catch (e) {
      const mensaje = mensajeDeError(e);
      await this.marcarConexion(teamId, mensaje);
      return { ok: false, mensaje };
    }
  }

  /** Equipos con una tanda de «Generar salas pendientes» corriendo en esta instancia. */
  private readonly tandasEnCurso = new Set<string>();

  /**
   * Al conectar, las citas que ya estaban agendadas siguen sin sala: se les
   * genera, POR TANDAS. Todas en una petición eran hasta cien citas por varias
   * llamadas a Google cada una: el proxy cortaba, el panel decía que había
   * fallado mientras el bucle seguía, y un segundo clic arrancaba otro encima.
   * Ahora cada petición hace una tanda (25 citas o 20 s, lo que llegue antes),
   * dice cuántas quedan, y no deja correr dos tandas del mismo equipo a la vez.
   */
  async generarSalasPendientes(user: AuthUser, teamId: string) {
    const TANDA = 25;
    const TIEMPO_MS = 20_000;
    await this.exigirConfigurar(user, teamId);
    this.exigirGoogle();
    if (this.tandasEnCurso.has(teamId)) {
      return { creadas: 0, fallidas: 0, total: 0, quedan: null, enCurso: true };
    }
    this.tandasEnCurso.add(teamId);
    try {
      const c = await this.conexionUsable(teamId).catch(() => null);
      if (!c) throw new BadRequestException('Primero conecta la cuenta de Google del equipo');
      const pendientes = {
        salesTeamId: teamId,
        status: { in: ABIERTAS },
        startAt: { gte: new Date() },
        OR: [{ gcalEventId: null }, ...(c.autoMeet ? [{ meetUrl: null }] : [])],
      };
      const tanda = await this.prisma.salesMeeting.findMany({
        where: pendientes,
        select: { id: true },
        // Primero las que nunca se intentaron: una cita que falla siempre no
        // puede tapar a las demás tanda tras tanda.
        orderBy: [{ gcalError: { sort: 'asc', nulls: 'first' } }, { startAt: 'asc' }],
        take: TANDA,
      });
      const hasta = Date.now() + TIEMPO_MS;
      let creadas = 0;
      let intentadas = 0;
      // De una en una: veinticinco altas a la vez son un 429 seguro de Google.
      for (const m of tanda) {
        if (Date.now() > hasta) break;
        intentadas++;
        const r = await this.enCola(m.id, () => this.sincronizar(m.id));
        if (r.ok) creadas++;
      }
      const quedan = await this.prisma.salesMeeting.count({ where: pendientes });
      return { creadas, fallidas: intentadas - creadas, total: intentadas, quedan, enCurso: false };
    } finally {
      this.tandasEnCurso.delete(teamId);
    }
  }

  // ── La sala de cada cita ────────────────────────────────────────────────

  /**
   * EL PUNTO DE ENGANCHE. Llamarlo después de crear, reagendar, reasignar,
   * cambiar de estado o cancelar una cita; mira la cita en la base y hace lo
   * que toca. Nunca lanza.
   *
   * Devuelve el enlace de la sala, o null. Con `esperarMs` espera como mucho eso
   * (para meter {{sala}} en el aviso de «cita agendada»); el trabajo sigue en
   * segundo plano y guarda la sala igual si Google tarda más.
   */
  sincronizarCita(citaId: string, opciones: { esperarMs?: number } = {}): Promise<string | null> {
    const trabajo = this.enCola(citaId, () => this.sincronizar(citaId))
      .then((r) => r.sala)
      .catch(() => null);
    if (!opciones.esperarMs) return trabajo;
    return Promise.race([
      trabajo,
      new Promise<null>((resolve) => {
        const t = setTimeout(() => resolve(null), opciones.esperarMs);
        t.unref?.();
      }),
    ]);
  }

  private enCola<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    const anterior = this.cola.get(clave) ?? Promise.resolve();
    const siguiente = anterior.catch(() => undefined).then(fn);
    const fin = siguiente.catch(() => undefined);
    this.cola.set(clave, fin);
    void fin.then(() => {
      if (this.cola.get(clave) === fin) this.cola.delete(clave);
    });
    return siguiente;
  }

  /** Access token vigente y preferencias. null = el equipo no tiene cuenta utilizable. */
  private async conexionUsable(teamId: string): Promise<Conexion | null> {
    const c = await this.prisma.salesCalendarConnection.findUnique({ where: { salesTeamId: teamId } });
    if (!c || !c.active) return null;
    const refresh = descifrarToken(c.refreshToken);
    if (!refresh) return null;
    let token = descifrarToken(c.accessToken);
    if (!token || !c.expiresAt || c.expiresAt.getTime() - Date.now() < 120_000) {
      try {
        const tok = await this.cliente.renovarAcceso(refresh);
        token = tok.access_token;
        await this.prisma.salesCalendarConnection.updateMany({
          where: { salesTeamId: teamId, active: true },
          data: {
            accessToken: cifrarToken(tok.access_token),
            expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
            ...(tok.refresh_token ? { refreshToken: cifrarToken(tok.refresh_token) } : {}),
          },
        });
      } catch (e) {
        if (e instanceof ErrorDeGoogle && e.codigo === 'invalid_grant') {
          // La cuenta quitó el permiso. Se apaga: la pantalla ofrece reconectar
          // en vez de fallar en silencio cita tras cita.
          await this.prisma.salesCalendarConnection.updateMany({
            where: { salesTeamId: teamId },
            data: {
              active: false,
              accessToken: null,
              refreshToken: null,
              expiresAt: null,
              lastError: 'Google quitó el permiso de esta cuenta. Vuelve a conectar el calendario.',
            },
          });
          return null;
        }
        throw e;
      }
    }
    return {
      token,
      calendarId: c.calendarId || 'primary',
      colorId: c.colorId,
      autoMeet: c.autoMeet,
      inviteLead: c.inviteLead,
      inviteCloser: c.inviteCloser,
      sendUpdates: c.sendUpdates,
    };
  }

  private async marcarConexion(teamId: string, error: string | null) {
    await this.prisma.salesCalendarConnection
      .updateMany({
        where: { salesTeamId: teamId },
        data: error ? { lastError: error.slice(0, MAX_ERROR) } : { lastError: null, lastSyncAt: new Date() },
      })
      .catch(() => undefined);
  }

  private async sincronizar(citaId: string): Promise<{ ok: boolean; sala: string | null }> {
    let teamId: string | null = null;
    try {
      if (!googleConfigurado()) return { ok: false, sala: null };
      const cita = await this.prisma.salesMeeting.findUnique({
        where: { id: citaId },
        select: {
          id: true,
          salesTeamId: true,
          hostUserId: true,
          startAt: true,
          durationMin: true,
          timezone: true,
          status: true,
          manageToken: true,
          meetUrl: true,
          gcalEventId: true,
          gcalCalendarId: true,
          lead: { select: { name: true, email: true, phone: true, company: true } },
          agenda: { select: { color: true, settings: true } },
          team: { select: { name: true, whiteLabel: { select: { slug: true, domain: true, appDomain: true } } } },
        },
      });
      if (!cita) return { ok: false, sala: null };
      teamId = cita.salesTeamId;
      const cancelada = cita.status === 'CANCELADA';
      // Realizada o no asistió: el evento se queda como estaba, de registro.
      if (!cancelada && !ABIERTAS.includes(cita.status)) return { ok: true, sala: cita.meetUrl };

      const conexion = await this.conexionUsable(cita.salesTeamId);
      if (!conexion) return { ok: false, sala: cita.meetUrl };

      if (cancelada) {
        if (!cita.gcalEventId) return { ok: true, sala: null };
        try {
          await this.cliente.borrarEvento(
            conexion.token,
            cita.gcalCalendarId || conexion.calendarId,
            cita.gcalEventId,
            conexion.sendUpdates,
          );
        } catch (e) {
          if (!esNoEsta(e)) throw e;
        }
        // Los ids se quedan: si la cita se reabre, el evento vuelve con su misma sala.
        await this.prisma.salesMeeting.updateMany({ where: { id: cita.id }, data: { gcalError: null } });
        await this.marcarConexion(cita.salesTeamId, null);
        return { ok: true, sala: null };
      }

      const closer = cita.hostUserId
        ? (
            await this.prisma.salesTeamMember.findUnique({
              where: { teamId_userId: { teamId: cita.salesTeamId, userId: cita.hostUserId } },
              select: { user: { select: { email: true, fullName: true } } },
            })
          )?.user ?? null
        : null;
      const invitar = {
        cliente: { email: cita.lead?.email, nombre: cita.lead?.name },
        closer: { email: closer?.email, nombre: closer?.fullName },
        invitarCliente: conexion.inviteLead,
        invitarCloser: conexion.inviteCloser,
      };
      const base: Omit<DatosDelEvento, 'invitados' | 'pedirSala'> = {
        citaId: cita.id,
        inicio: cita.startAt,
        duracionMin: cita.durationMin,
        zona: cita.timezone || ZONA_POR_DEFECTO,
        titulo: tituloDelEvento({ tituloAgenda: tituloDeAgenda(cita.agenda?.settings), equipo: cita.team.name, cliente: cita.lead?.name }),
        descripcion: descripcionDelEvento({
          cliente: cita.lead?.name,
          empresa: cita.lead?.company,
          telefono: cita.lead?.phone,
          enlaceDeGestion: enlaceDeGestion(cita.team.whiteLabel, cita.manageToken),
        }),
        // La agenda con color propio manda; si no, el color del equipo.
        colorId: colorDeGoogleMasCercano(cita.agenda?.color) ?? conexion.colorId ?? null,
        gestionados: {
          closer: conexion.inviteCloser ? (closer?.email ?? null) : null,
          cliente: conexion.inviteLead ? (cita.lead?.email ?? null) : null,
        },
      };

      let calendarId = cita.gcalCalendarId || conexion.calendarId;
      let ev: EventoDeGoogle;
      if (cita.gcalEventId) {
        try {
          ev = await this.actualizar(conexion, calendarId, cita.gcalEventId, base, invitar);
        } catch (e) {
          if (!esNoEsta(e)) throw e;
          // Lo borraron en Google o se conectó otra cuenta: uno nuevo en el calendario de ahora.
          calendarId = conexion.calendarId;
          ev = await this.crearOAdoptar(conexion, calendarId, base, invitar);
        }
      } else {
        calendarId = conexion.calendarId;
        ev = await this.crearOAdoptar(conexion, calendarId, base, invitar);
      }

      const sala = enlaceDeMeet(ev) ?? (cita.gcalEventId === ev.id ? cita.meetUrl : null);
      await this.prisma.salesMeeting.updateMany({
        where: { id: cita.id },
        data: { gcalEventId: ev.id, gcalCalendarId: calendarId, meetUrl: sala, gcalError: null },
      });
      await this.marcarConexion(cita.salesTeamId, null);
      return { ok: true, sala };
    } catch (e) {
      const mensaje = mensajeDeError(e);
      this.logger.warn(`cita ${citaId}: ${(e as Error)?.message ?? e}`);
      await this.prisma.salesMeeting
        .updateMany({ where: { id: citaId }, data: { gcalError: mensaje } })
        .catch(() => undefined);
      if (teamId) await this.marcarConexion(teamId, mensaje);
      return { ok: false, sala: null };
    }
  }

  /** PATCH sobre lo que hay: conserva la sala y a los invitados que no pone el sistema. */
  private async actualizar(
    conexion: Conexion,
    calendarId: string,
    eventId: string,
    base: Omit<DatosDelEvento, 'invitados' | 'pedirSala'>,
    invitar: Parameters<typeof invitadosDelEvento>[0],
  ): Promise<EventoDeGoogle> {
    const actual = await this.cliente.verEvento(conexion.token, calendarId, eventId);
    const cuerpo = construirEvento(
      {
        ...base,
        invitados: invitadosDelEvento({ ...invitar, existentes: actual.attendees, anteriores: actual.extendedProperties?.private }),
        // Sala solo si aún no tiene: pedirla otra vez no la cambia, pero no hace falta.
        pedirSala: conexion.autoMeet && !enlaceDeMeet(actual),
      },
      { conId: false },
    );
    return this.cliente.actualizarEvento(conexion.token, calendarId, eventId, cuerpo, conexion.sendUpdates);
  }

  private async crearOAdoptar(
    conexion: Conexion,
    calendarId: string,
    base: Omit<DatosDelEvento, 'invitados' | 'pedirSala'>,
    invitar: Parameters<typeof invitadosDelEvento>[0],
  ): Promise<EventoDeGoogle> {
    const nuevo = (conId: boolean) =>
      construirEvento({ ...base, invitados: invitadosDelEvento(invitar), pedirSala: conexion.autoMeet }, { conId });
    try {
      return await this.cliente.crearEvento(conexion.token, calendarId, nuevo(true), conexion.sendUpdates);
    } catch (e) {
      if (!(e instanceof ErrorDeGoogle && e.status === 409)) throw e;
    }
    // Ya existe con el id de esta cita: otra alta ganó la carrera, o es una cita
    // cancelada que se reabre. Se adopta ese evento.
    try {
      return await this.actualizar(conexion, calendarId, idDeEventoParaCita(base.citaId), base, invitar);
    } catch (e) {
      if (!esNoEsta(e)) throw e;
      return this.cliente.crearEvento(conexion.token, calendarId, nuevo(false), conexion.sendUpdates);
    }
  }
}
