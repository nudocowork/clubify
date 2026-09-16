import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CalendarioDeEquipoService } from './calendario-de-equipo.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { fechaEn, minutosLocalesAUtc } from '../common/franjas-horarias';
import {
  exigirEscritura,
  resolveTeamAccess,
  type AccesoAlEquipo,
} from './team-access';
import { closersActivosDelEquipo, nombreDeQuienUsa } from './closers-del-equipo';
import { SalesAutomationsService } from './sales-automations.service';
import { MENSAJE_POR_DEFECTO, leerAjustes } from './configuracion-de-equipo';
import { camposGuardados, resumenDeRespuestas, type Respuestas } from './formularios-de-equipo';

/**
 * «Banco» del equipo: la cola de CITAS antes de la llamada.
 *
 * La pestaña enseñaba los leads sin vendedor. En TeamClubify el banco es la cola
 * donde quien coordina reparte las citas entre los closers y persigue que el
 * cliente confirme, y es lo que se pidió. Por eso aquí manda `SalesMeeting`.
 *
 * Las reglas que deciden qué ve cada quien —grupo de la cita, semáforo de
 * confirmación, closer sugerido y orden de la cola— son funciones PURAS y
 * exportadas: se prueban sin base, y las calcula el servidor para que dos
 * personas con el reloj del móvil desfasado no vean colas distintas.
 *
 * Todo método empieza por `resolveTeamAccess`, como el resto del módulo.
 */

const ZONA = 'America/Bogota';

/** Minutos antes de la cita en que se cierra la ventana del recordatorio de 1 h. */
export const VENTANA_1H_CIERRA = 45;
/** Idem para el de 30 min. Pasada esta, si no confirmó ninguna, hay que perseguir. */
export const VENTANA_30MIN_CIERRA = 20;
/** Una cita que empezó hace menos de esto todavía se persigue: llegar tarde no es no venir. */
const TOLERANCIA_TARDE = -15;
/** Canceladas y plantones se enseñan de los últimos días, no de siempre. */
const DIAS_DE_HISTORIAL = 30;

/** Hasta cuántos leads se pintan por pestaña. El total real va aparte. */
const TOPE_DE_LISTA = 500;

/** Tiene algo pendiente y todavía no compró. */
const EN_SEGUIMIENTO = { wonAt: null, followups: { some: { done: false } } };
const GANADO = { wonAt: { not: null } };
/** No compró y lo dieron por perdido: con motivo, o en la columna de no interesados. */
const PERDIDO = {
  wonAt: null,
  OR: [{ lostReason: { not: null } }, { stage: { kind: 'NOT_INTERESTED' } }],
};
const SELECT_LEAD = {
  id: true,
  name: true,
  company: true,
  value: true,
  followups: {
    where: { done: false },
    orderBy: { dueAt: 'asc' as const },
    take: 1,
    select: { dueAt: true },
  },
};

/** Las citas que ya no admiten nada: ni asignar, ni confirmar, ni no-show. */
const CERRADAS = ['REALIZADA', 'CANCELADA', 'NO_ASISTIO'];

export type GrupoDelBanco = 'por_asignar' | 'por_confirmar' | 'no_show' | 'canceladas';
export type EstadoDeVentana = 'confirmada' | 'vencida' | 'pendiente';

/**
 * En qué pestaña del banco cae una cita.
 *
 * `CONFIRMADA` sale del banco a propósito (y `REALIZADA`): el banco es lo que
 * falta por resolver antes de la llamada, y una cita confirmada ya está
 * resuelta — vive en la Agenda.
 */
export function grupoDeCita(c: { status: string; hostUserId: string | null }): GrupoDelBanco | null {
  if (c.status === 'PENDIENTE') return c.hostUserId ? 'por_confirmar' : 'por_asignar';
  if (c.status === 'NO_ASISTIO') return 'no_show';
  if (c.status === 'CANCELADA') return 'canceladas';
  return null;
}

export function minutosHasta(startAt: Date, ahora: Date): number {
  return Math.round((startAt.getTime() - ahora.getTime()) / 60_000);
}

/**
 * El semáforo de una cita: sus dos recordatorios y si hay que perseguirla.
 *
 * Tres estados por ventana y no dos. «Todavía puede confirmar» y «se le pidió y
 * no contestó» tienen que verse distintos: si no, no se sabe a quién llamar.
 * Una confirmación a mano (`confirmedAt`) cuenta como las dos.
 */
export function estadoDeConfirmacion(
  c: { status: string; conf1h: boolean; conf30min: boolean; confirmedAt: Date | null },
  minutos: number,
): { h1: EstadoDeVentana; m30: EstadoDeVentana; hayQuePerseguir: boolean } {
  const manual = !!c.confirmedAt;
  const h1: EstadoDeVentana =
    c.conf1h || manual ? 'confirmada' : minutos <= VENTANA_1H_CIERRA ? 'vencida' : 'pendiente';
  const m30: EstadoDeVentana =
    c.conf30min || manual ? 'confirmada' : minutos <= VENTANA_30MIN_CIERRA ? 'vencida' : 'pendiente';
  const muerta = CERRADAS.includes(c.status);
  return {
    h1,
    m30,
    hayQuePerseguir: !muerta && h1 === 'vencida' && m30 === 'vencida' && minutos > TOLERANCIA_TARDE,
  };
}

/**
 * El closer al que se le sugiere la próxima cita: el menos cargado HOY, y a
 * igualdad, el menos cargado en la semana. Es una sugerencia, no una regla:
 * quien coordina puede elegir otro.
 */
export function sugerirCloser(carga: Array<{ id: string; hoy: number; semana: number }>): string | null {
  if (!carga.length) return null;
  return [...carga].sort((a, b) => a.hoy - b.hoy || a.semana - b.semana)[0].id;
}

/**
 * El orden de la cola: por hora, y a la misma hora, primero la que tiene más
 * confirmaciones. Una cita con las dos confirmaciones es la que más probable es
 * que ocurra, y es la que no se puede quedar sin closer.
 */
export function ordenarCola<T extends { startAt: Date; conf1h: boolean; conf30min: boolean }>(filas: T[]): T[] {
  const confirmaciones = (x: T) => (x.conf1h ? 1 : 0) + (x.conf30min ? 1 : 0);
  return [...filas].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || confirmaciones(b) - confirmaciones(a),
  );
}

/**
 * El siguiente paso pendiente de cada lead: el que vence antes.
 *
 * Es lo que en la referencia son «Próxima acción» y «Nota de seguimiento»,
 * columnas del lead allá; aquí el próximo paso vive en `SalesFollowup`. Con dos
 * pasos pendientes manda el más cercano, no el último que se creó: el Banco
 * tiene que decir qué toca AHORA.
 */
export function proximoPasoPorLead<T extends { leadId: string; dueAt: Date }>(pasos: T[]): Map<string, T> {
  const porLead = new Map<string, T>();
  for (const p of pasos) {
    const ya = porLead.get(p.leadId);
    if (!ya || p.dueAt.getTime() < ya.dueAt.getTime()) porLead.set(p.leadId, p);
  }
  return porLead;
}

@Injectable()
export class BancoDeEquipoService {
  constructor(
    private prisma: PrismaService,
    private automations: SalesAutomationsService,
    /** La sala de Google Meet de la cita sigue a la asignación y a la cancelación. */
    private calendario: CalendarioDeEquipoService,
  ) {}

  /**
   * Deja la acción en el historial del lead y lo sube en «actividad».
   *
   * Lo mismo que hace la Agenda (`anotarEnElLead`). Sin esto, lo que se hacía
   * desde el banco no aparecía en la ficha del lead en el CRM, y un lead viejo
   * no subía en la lista: el seguimiento «No asistió» recién creado podía no
   * verse en la pestaña de al lado (Fable, 2026-09-14). Best-effort: una nota
   * que no se guarda no puede deshacer la acción, que ya ocurrió.
   */
  private async anotar(citaId: string, teamId: string, userId: string, body: string) {
    const cita = await this.prisma.salesMeeting
      .findFirst({ where: { id: citaId, salesTeamId: teamId }, select: { leadId: true } })
      .catch(() => null);
    if (!cita?.leadId) return;
    await this.prisma.salesLeadActivity
      .create({ data: { leadId: cita.leadId, salesTeamId: teamId, userId, kind: 'cita', body } })
      .catch(() => null);
    await this.prisma.salesLead
      .update({ where: { id: cita.leadId }, data: { lastActivityAt: new Date() } })
      .catch(() => null);
  }

  /** Asignar reparte el trabajo de otros: lo hace el líder o un admin de la marca. */
  private puedeAsignar(acceso: AccesoAlEquipo): boolean {
    return acceso.esAdminDeMarca || acceso.roles.includes('lider');
  }

  /**
   * Los closers activos del equipo. La regla vive en `closers-del-equipo.ts` y
   * la comparte la Agenda: si cada pantalla la calculara a su manera, alguien
   * saldría en la rejilla y no aparecería para asignarle citas.
   */
  private closersDelEquipo(teamId: string) {
    return closersActivosDelEquipo(this.prisma, teamId);
  }

  async banco(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const ahora = new Date();
    const hoy = fechaEn(ahora, ZONA);
    /**
     * Las 00:00 de BOGOTÁ de hace `dias` días.
     *
     * Antes era `setUTCHours(0)`: medianoche UTC, que en Bogotá son las 19:00
     * del día anterior. A las 20:00 de Bogotá eso ya caía en el día siguiente y
     * la «semana» de cada closer perdía un día laboral entero (encontrado por
     * Fable, 2026-09-14). Mismo patrón que `calendarioPublico` de la Agenda.
     */
    const inicioDeDiaHace = (dias: number) =>
      minutosLocalesAUtc(fechaEn(new Date(ahora.getTime() - dias * 86_400_000), ZONA), 0, ZONA);
    const hace30 = inicioDeDiaHace(DIAS_DE_HISTORIAL);
    // «La semana» de la referencia: desde hace 6 días, incluidas las futuras.
    const inicioSemana = inicioDeDiaHace(6);

    const closers = await this.closersDelEquipo(teamId);

    const [citas, ocupadas, seguimiento, ganadas, perdidas, totales, equipo, yo] = await Promise.all([
      this.prisma.salesMeeting.findMany({
        where: {
          salesTeamId: teamId,
          OR: [
            { status: 'PENDIENTE' },
            { status: { in: ['NO_ASISTIO', 'CANCELADA'] }, startAt: { gte: hace30 } },
          ],
        },
        orderBy: { startAt: 'asc' },
        take: 500,
        include: {
          lead: { select: { id: true, name: true, company: true, phone: true, email: true, source: true, instagram: true } },
        },
      }),
      // La carga cuenta lo que el closer TIENE que atender: sus citas vivas.
      this.prisma.salesMeeting.findMany({
        where: {
          salesTeamId: teamId,
          hostUserId: { in: closers.map((c) => c.id) },
          status: { in: ['PENDIENTE', 'CONFIRMADA'] },
          startAt: { gte: inicioSemana },
        },
        select: { hostUserId: true, startAt: true },
      }),
      // Una consulta por pestaña, con su propio filtro. Antes era UNA de 300
      // leads filtrada en memoria: un equipo con más de 300 veía un trozo de
      // «Ganadas» sin ningún aviso (Fable, 2026-09-14).
      this.prisma.salesLead.findMany({
        where: { salesTeamId: teamId, ...EN_SEGUIMIENTO },
        orderBy: { lastActivityAt: 'desc' },
        take: TOPE_DE_LISTA,
        select: SELECT_LEAD,
      }),
      this.prisma.salesLead.findMany({
        where: { salesTeamId: teamId, ...GANADO },
        orderBy: { wonAt: 'desc' },
        take: TOPE_DE_LISTA,
        select: SELECT_LEAD,
      }),
      this.prisma.salesLead.findMany({
        where: { salesTeamId: teamId, ...PERDIDO },
        orderBy: { lastActivityAt: 'desc' },
        take: TOPE_DE_LISTA,
        select: SELECT_LEAD,
      }),
      // Los totales reales, para que la pestaña diga cuántos hay aunque la
      // lista se corte en `TOPE_DE_LISTA`.
      Promise.all([
        this.prisma.salesLead.count({ where: { salesTeamId: teamId, ...EN_SEGUIMIENTO } }),
        this.prisma.salesLead.count({ where: { salesTeamId: teamId, ...GANADO } }),
        this.prisma.salesLead.count({ where: { salesTeamId: teamId, ...PERDIDO } }),
      ]).then(([seg, gan, per]) => ({ seguimiento: seg, ganadas: gan, perdidas: per })),
      this.prisma.salesTeam.findUnique({ where: { id: teamId }, select: { settings: true } }),
      nombreDeQuienUsa(this.prisma, teamId, user.id),
    ]);

    // «Configuración»: nombres de las pestañas, qué enseña una cita y el texto
    // con el que se abre WhatsApp.
    const ajustes = leerAjustes(equipo?.settings);
    // Las respuestas al formulario de la agenda y su puntaje («Lead Score»), solo
    // si el equipo los quiere ver aquí: el Banco se recarga cada minuto y no hay
    // por qué leerlos siempre.
    const campos = ajustes.camposDelBanco;
    const respuestasPorCita = new Map<string, string[]>();
    const puntajePorCita = new Map<string, number>();
    if ((campos.includes('respuestas') || campos.includes('puntaje')) && citas.length) {
      const filas = await this.prisma.salesFormResponse.findMany({
        where: { salesTeamId: teamId, meetingId: { in: citas.map((c) => c.id) } },
        orderBy: { createdAt: 'asc' },
        select: { meetingId: true, answers: true, score: true, form: { select: { fields: true } } },
      });
      for (const f of filas) {
        if (!f.meetingId) continue;
        puntajePorCita.set(f.meetingId, f.score);
        const r = f.answers && typeof f.answers === 'object' && !Array.isArray(f.answers) ? (f.answers as Respuestas) : {};
        const texto = resumenDeRespuestas(camposGuardados(f.form.fields), r, 600);
        if (texto) respuestasPorCita.set(f.meetingId, texto.split('\n'));
      }
    }

    // «Próxima acción» y «Nota de seguimiento»: el siguiente paso pendiente del
    // lead de cada cita. Igual que las respuestas, solo si se eligieron.
    const leadsDeLasCitas = [...new Set(citas.map((c) => c.leadId).filter((id): id is string => !!id))];
    const pasoPorLead =
      (campos.includes('proxima_accion') || campos.includes('nota_seguimiento')) && leadsDeLasCitas.length
        ? proximoPasoPorLead(
            await this.prisma.salesFollowup.findMany({
              where: { salesTeamId: teamId, leadId: { in: leadsDeLasCitas }, done: false },
              // Orden fijo: con dos pasos a la misma hora, sin él Postgres devuelve
              // cualquiera y la nota del Banco cambiaba de una recarga a otra
              // (Fable, 15-09-2026).
              orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
              select: { leadId: true, dueAt: true, channel: true, note: true },
            }),
          )
        : new Map<string, { leadId: string; dueAt: Date; channel: string | null; note: string | null }>();

    const nombreDe = new Map(closers.map((c) => [c.id, c.nombre]));
    const carga = closers.map((c) => {
      const suyas = ocupadas.filter((o) => o.hostUserId === c.id);
      return {
        id: c.id,
        nombre: c.nombre,
        hoy: suyas.filter((o) => fechaEn(o.startAt, ZONA) === hoy).length,
        semana: suyas.length,
      };
    });

    const paraElPanel = (c: (typeof citas)[number]) => {
      const minutos = minutosHasta(c.startAt, ahora);
      const paso = c.leadId ? pasoPorLead.get(c.leadId) : undefined;
      return {
        id: c.id,
        startAt: c.startAt,
        durationMin: c.durationMin,
        status: c.status,
        hostUserId: c.hostUserId,
        host: c.hostUserId ? { id: c.hostUserId, nombre: nombreDe.get(c.hostUserId) ?? 'Fuera del equipo' } : null,
        conf1h: c.conf1h,
        conf30min: c.conf30min,
        confirmada: !!c.confirmedAt,
        confirmacion: estadoDeConfirmacion(c, minutos),
        minutosParaEmpezar: minutos,
        lead: c.lead
          ? {
              id: c.lead.id,
              nombre: c.lead.name,
              empresa: c.lead.company,
              telefono: c.lead.phone,
              email: c.lead.email,
              origen: c.lead.source,
              instagram: c.lead.instagram,
            }
          : null,
        respuestas: respuestasPorCita.get(c.id) ?? null,
        puntaje: puntajePorCita.get(c.id) ?? null,
        proximoPaso: paso ? { cuando: paso.dueAt, canal: paso.channel, nota: paso.note } : null,
        // {{sala}} del mensaje de WhatsApp: el enlace de Google Meet de la cita.
        sala: c.meetUrl ?? null,
      };
    };

    const de = (g: GrupoDelBanco) => citas.filter((c) => grupoDeCita(c) === g);
    const porAsignar = ordenarCola(de('por_asignar'));

    const leadParaElPanel = (l: (typeof ganadas)[number]) => ({
      id: l.id,
      nombre: l.name,
      empresa: l.company,
      valor: l.value != null ? Number(l.value) : null,
      proximoSeguimiento: l.followups[0]?.dueAt ?? null,
    });

    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeAsignar: acceso.puedeEscribir && this.puedeAsignar(acceso),
      closers,
      carga,
      sugerido: sugerirCloser(carga),
      sinAsignarPronto: porAsignar
        .filter((c) => {
          const m = minutosHasta(c.startAt, ahora);
          return m <= 10 && m >= -5;
        })
        .map(paraElPanel),
      por_asignar: porAsignar.map(paraElPanel),
      por_confirmar: ordenarCola(de('por_confirmar')).map(paraElPanel),
      no_show: de('no_show').map(paraElPanel),
      canceladas: de('canceladas').map(paraElPanel),
      seguimiento: seguimiento.map(leadParaElPanel),
      ganadas: ganadas.map(leadParaElPanel),
      perdidas: perdidas.map(leadParaElPanel),
      totales,
      etiquetas: ajustes.etiquetasDelBanco,
      campos: ajustes.camposDelBanco,
      mensajeWhatsapp: ajustes.mensajeWhatsapp ?? MENSAJE_POR_DEFECTO,
      // Quien firma el WhatsApp: la persona en sesión, como en la referencia.
      yo: { nombre: yo },
    };
  }

  /**
   * Asigna (o reasigna) la cita a un closer del equipo.
   *
   * El closer tiene que ser miembro ACTIVO de ESTE equipo con rol `closer`: sin
   * comprobarlo, conociendo un id se le podría colgar una cita a alguien de otra
   * marca. `updateMany` condicional: una cita que se canceló mientras alguien
   * elegía closer no se reabre.
   */
  async asignar(user: AuthUser, teamId: string, citaId: string, hostUserId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    if (!this.puedeAsignar(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden repartir las citas');
    }
    const closers = await this.closersDelEquipo(teamId);
    const closer = closers.find((c) => c.id === hostUserId);
    if (!closer) {
      throw new BadRequestException('Esa persona no es closer activo de este equipo');
    }
    const r = await this.prisma.salesMeeting.updateMany({
      where: { id: citaId, salesTeamId: teamId, status: { notIn: CERRADAS } },
      data: { hostUserId, assignedAt: new Date(), assignedByUserId: user.id },
    });
    if (r.count === 0) throw new NotFoundException('La cita no existe o ya no se puede asignar');
    await this.anotar(citaId, teamId, user.id, `Cita asignada a ${closer.nombre}`);
    // Cambia el closer invitado al evento; la sala sigue siendo la misma.
    void this.calendario.sincronizarCita(citaId);
    return { ok: true };
  }

  /** Confirmación a mano. `on: false` la deshace (el cliente avisó que no puede). */
  async confirmar(user: AuthUser, teamId: string, citaId: string, on: boolean) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const r = await this.prisma.salesMeeting.updateMany({
      where: {
        id: citaId,
        salesTeamId: teamId,
        status: { in: ['PENDIENTE', 'CONFIRMADA'] },
        // Confirmar una cita SIN closer la sacaba del banco —y de la alerta de
        // «sin asignar a punto de empezar»— sin que nadie la tuviera. Primero
        // se asigna. Deshacer (`on: false`) no lo exige.
        ...(on ? { hostUserId: { not: null } } : {}),
      },
      data: on
        ? { status: 'CONFIRMADA', confirmedAt: new Date(), confirmedByUserId: user.id }
        : { status: 'PENDIENTE', confirmedAt: null, confirmedByUserId: null },
    });
    if (r.count === 0) {
      throw new NotFoundException(
        on
          ? 'La cita no existe, ya está cerrada o todavía no tiene closer asignado'
          : 'La cita no existe o ya no se puede cambiar',
      );
    }
    await this.anotar(
      citaId,
      teamId,
      user.id,
      on ? 'Cita confirmada' : 'Se deshizo la confirmación de la cita',
    );
    return { ok: true };
  }

  /** Marca o quita uno de los dos recordatorios. */
  async marcarConfirmacion(user: AuthUser, teamId: string, citaId: string, cual: '1h' | '30min', on: boolean) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const cuando = on ? new Date() : null;
    const r = await this.prisma.salesMeeting.updateMany({
      where: { id: citaId, salesTeamId: teamId, status: { notIn: CERRADAS } },
      data: cual === '1h' ? { conf1h: on, conf1hAt: cuando } : { conf30min: on, conf30minAt: cuando },
    });
    if (r.count === 0) throw new NotFoundException('La cita no existe o ya está cerrada');
    const ventana = cual === '1h' ? '1 hora' : '30 min';
    await this.anotar(
      citaId,
      teamId,
      user.id,
      on ? `Confirmó asistencia (${ventana} antes)` : `Se quitó la confirmación de ${ventana} antes`,
    );
    return { ok: true };
  }

  /**
   * «No asistió», en un clic desde el banco.
   *
   * Solo si la cita YA pasó: marcarla antes dispararía el aviso de reagendar al
   * cliente antes de su reunión. El cambio es ATÓMICO (`updateMany` sobre las
   * que siguen abiertas): dos clics o dos pestañas no crean dos seguimientos ni
   * mandan dos avisos — el segundo ve `count: 0` y se va.
   */
  async noAsistio(user: AuthUser, teamId: string, citaId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const cita = await this.prisma.salesMeeting.findFirst({
      where: { id: citaId, salesTeamId: teamId },
      select: { id: true, startAt: true, leadId: true, hostUserId: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    if (cita.startAt.getTime() > Date.now()) {
      throw new BadRequestException('La cita todavía no ha ocurrido: no se puede marcar como no asistió');
    }
    const r = await this.prisma.salesMeeting.updateMany({
      where: { id: citaId, salesTeamId: teamId, status: { notIn: CERRADAS } },
      data: { status: 'NO_ASISTIO' },
    });
    if (r.count === 0) return { ok: true, yaEstaba: true };

    if (cita.leadId) {
      const lead = await this.prisma.salesLead.findUnique({
        where: { id: cita.leadId },
        select: { assignedUserId: true },
      });
      // El paso para reagendar: aparece en Seguimientos de quien lleva el lead.
      await this.prisma.salesFollowup.create({
        data: {
          leadId: cita.leadId,
          salesTeamId: teamId,
          assignedUserId: lead?.assignedUserId ?? cita.hostUserId ?? null,
          dueAt: new Date(),
          channel: 'WhatsApp',
          note: 'No asistió — reagendar la cita.',
        },
      });
      // El mismo disparador que usa la Agenda al marcar un plantón.
      void this.automations.disparar(cita.leadId, 'sales_meeting_no_show', {});
      await this.anotar(citaId, teamId, user.id, 'No asistió a la cita (marcado en el banco)');
    }
    return { ok: true };
  }

  async cancelar(user: AuthUser, teamId: string, citaId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const r = await this.prisma.salesMeeting.updateMany({
      where: { id: citaId, salesTeamId: teamId, status: { notIn: ['CANCELADA', 'REALIZADA'] } },
      data: { status: 'CANCELADA' },
    });
    if (r.count === 0) throw new NotFoundException('La cita no existe o ya estaba cerrada');
    await this.anotar(citaId, teamId, user.id, 'Cita cancelada desde el banco');
    void this.calendario.sincronizarCita(citaId);
    return { ok: true };
  }
}
