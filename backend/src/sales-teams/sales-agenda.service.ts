import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  diaDeLaSemanaEn,
  errorDeFranja,
  fechaEn,
  fechaValida,
  huecosDelDia,
  minutosLocalesAUtc,
} from '../common/franjas-horarias';
import { phoneKeyOf, emailNormOf } from '../marketing/identity';
import { MktProviderService } from '../marketing/provider/mkt-provider.service';
import { exigirEscritura, resolveTeamAccess } from './team-access';
import { asegurarColumnas } from './sales-columnas';
import { SalesAutomationsService } from './sales-automations.service';
import { CalendarioDeEquipoService } from './calendario-de-equipo.service';
import { closersActivosDelEquipo } from './closers-del-equipo';
import { franjaDeHora, franjasDelDia, horaEnZona, semaforoDeCita } from './agenda-del-dia';
import type { Prisma } from '@prisma/client';
import {
  camposGuardados,
  camposParaElPublico,
  camposQueFaltan,
  datosDelLead,
  limpiarRespuestas,
  pideDatoDeContacto,
  puntajeDelFormulario,
  resumenDeRespuestas,
} from './formularios-de-equipo';
import { leerAjustesDeAgenda, type AjustesDeAgenda } from './ajustes-de-agenda';

/**
 * La agenda del equipo de ventas — fase 4.
 *
 * El vendedor mueve la tarjeta a «Interesado» y lo siguiente que necesita es
 * quedar con esa persona. Aquí vive eso: el horario de cada vendedor, los
 * huecos que salen de él, la cita, y el enlace que el prospecto abre sin tener
 * cuenta de nada.
 *
 * TRES COSAS QUE NO SON OBVIAS
 * ----------------------------
 * 1. **Los huecos son una foto, no una reserva.** Entre que el prospecto ve
 *    «10:30 libre» y pulsa, otro puede haberlo cogido. Por eso `agendar`
 *    vuelve a comprobar el solape DENTRO de una transacción, y la comprobación
 *    de antes solo sirve para no enseñar horas imposibles.
 *
 * 2. **El enlace público NO lleva el id de la cita**, lleva un `manageToken`
 *    de 32 caracteres. Con el id, cualquiera que cambiara un número en la URL
 *    cancelaría la cita de otro.
 *
 * 3. **La zona horaria se mide, no se supone.** Ver `franjas-horarias.ts`.
 *
 * 4. **Un equipo tiene varias agendas de reserva** (`SalesAgenda`), cada una
 *    con su enlace, horario, formulario y cupos; se configuran en
 *    `agendas-de-reserva.service.ts`. Lo público entra por el slug de la
 *    AGENDA, y el slug del equipo —el enlace de cuando había una sola— lleva a
 *    su primera agenda activa.
 *
 * Todo método empieza por `resolveTeamAccess`, menos los tres públicos — que
 * se defienden con el token y con el equipo tener el módulo encendido.
 */

/** Por defecto, y lo que casi nadie va a cambiar. */
const ZONA_POR_DEFECTO = 'America/Bogota';
const DURACION_POR_DEFECTO = 30;
/** No se ofrece un hueco a menos de esto: el vendedor no llegaría. */
const ANTELACION_MIN = 30;

const ESTADOS = [
  'PENDIENTE',
  'CONFIRMADA',
  'REALIZADA',
  'NO_ASISTIO',
  'CANCELADA',
] as const;
type Estado = (typeof ESTADOS)[number];

/** Las que ocupan sitio en la agenda. Una cancelada libera su hora. */
const OCUPAN = ['PENDIENTE', 'CONFIRMADA', 'REALIZADA'];

@Injectable()
export class SalesAgendaService {
  private logger = new Logger(SalesAgendaService.name);

  constructor(
    private prisma: PrismaService,
    private mkt: MktProviderService,
    private automations: SalesAutomationsService,
    /**
     * La sala de Google Meet de cada cita. Opcional: donde no está (las pruebas
     * que montan el servicio a mano) la agenda funciona igual, sin sala.
     */
    @Optional() private calendario?: CalendarioDeEquipoService,
  ) {}

  // ── Horario del equipo ──────────────────────────────────────────────────

  async verHorario(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const [franjas, equipo] = await Promise.all([
      this.prisma.salesAvailability.findMany({
        where: { salesTeamId: teamId },
        orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
      }),
      this.prisma.salesTeam.findUnique({
        where: { id: teamId },
        select: { slug: true },
      }),
    ]);
    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      franjas,
      // null = todavia no tiene enlace publico. Se crea a peticion, no de
      // oficio: un enlace que nadie pidio es una puerta abierta de mas.
      slug: equipo?.slug ?? null,
    };
  }

  /**
   * Reemplaza el horario de un vendedor (o el del equipo, con `userId` nulo).
   *
   * Se reemplaza entero en vez de ir fila a fila: son pocas filas y razonar
   * sobre altas y bajas por separado es donde se cuelan los duplicados. Va en
   * transacción para que un fallo a medias no deje al equipo sin horario.
   */
  async guardarHorario(
    user: AuthUser,
    teamId: string,
    body: {
      userId?: string | null;
      franjas: Array<{ weekday: number; startMin: number; endMin: number }>;
    },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);

    const filas = body.franjas ?? [];
    for (const f of filas) {
      if (!Number.isInteger(f.weekday) || f.weekday < 0 || f.weekday > 6) {
        throw new BadRequestException('El día de la semana va de 0 (domingo) a 6.');
      }
      const err = errorDeFranja(f);
      if (err) throw new BadRequestException(err);
    }
    // Solapes DENTRO del mismo día: dos franjas que se pisan ofrecerían el
    // mismo hueco dos veces y el vendedor lo vería duplicado en la pantalla.
    const porDia = new Map<number, Array<{ startMin: number; endMin: number }>>();
    for (const f of filas) {
      const lista = porDia.get(f.weekday) ?? [];
      if (lista.some((o) => f.startMin < o.endMin && f.endMin > o.startMin)) {
        throw new BadRequestException(
          'Hay dos tramos que se pisan el mismo día. Únelos en uno.',
        );
      }
      lista.push(f);
      porDia.set(f.weekday, lista);
    }

    const userId = body.userId ?? null;
    if (userId) await this.exigirDelEquipo(teamId, userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.salesAvailability.deleteMany({
        where: { salesTeamId: teamId, userId },
      });
      if (filas.length) {
        await tx.salesAvailability.createMany({
          data: filas.map((f) => ({
            salesTeamId: teamId,
            userId,
            weekday: f.weekday,
            startMin: f.startMin,
            endMin: f.endMin,
          })),
        });
      }
    });
    return this.verHorario(user, teamId);
  }

  private async exigirDelEquipo(teamId: string, userId: string) {
    const m = await this.prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { isActive: true },
    });
    if (!m?.isActive) {
      throw new BadRequestException('Esa persona no está en el equipo.');
    }
  }

  // ── Huecos ──────────────────────────────────────────────────────────────

  /**
   * Los huecos libres de un día para un vendedor.
   *
   * Si ese vendedor no tiene horario propio, se usa el del equipo (`userId`
   * nulo). Así un equipo pequeño pone un horario y ya está, y quien necesite el
   * suyo lo sobreescribe sin tocar el de los demás.
   */
  private async huecosDe(
    teamId: string,
    fecha: string,
    hostUserId: string | null,
    zona: string,
    duracionMin: number,
    /** La de la agenda pública del equipo; desde dentro, la de siempre. */
    antelacionMin = ANTELACION_MIN,
  ) {
    if (!fechaValida(fecha)) {
      throw new BadRequestException('La fecha tiene que ser YYYY-MM-DD.');
    }
    const weekday = diaDeLaSemanaEn(fecha, zona);
    const propias = hostUserId
      ? await this.prisma.salesAvailability.findMany({
          where: { salesTeamId: teamId, userId: hostUserId, weekday },
        })
      : [];
    const franjas = propias.length
      ? propias
      : await this.prisma.salesAvailability.findMany({
          where: { salesTeamId: teamId, userId: null, weekday },
        });
    if (!franjas.length) return [];

    const desde = minutosLocalesAUtc(fecha, 0, zona);
    const hasta = minutosLocalesAUtc(fecha, 24 * 60, zona);
    const citas = await this.prisma.salesMeeting.findMany({
      where: {
        salesTeamId: teamId,
        status: { in: OCUPAN },
        startAt: { gte: desde, lt: hasta },
        // Con vendedor, solo bloquea SU agenda. Sin vendedor, la del equipo
        // entero — que es lo correcto cuando el horario también es del equipo.
        ...(hostUserId ? { hostUserId } : {}),
      },
      select: { startAt: true, durationMin: true },
    });

    return huecosDelDia({
      fecha,
      zona,
      franjas: franjas.map((f) => ({ startMin: f.startMin, endMin: f.endMin })),
      ocupado: citas.map((c) => ({
        startAt: c.startAt,
        endAt: new Date(c.startAt.getTime() + c.durationMin * 60_000),
      })),
      duracionMin,
      antelacionMin,
    });
  }

  /**
   * Los huecos de varios días con DOS consultas —horarios propios y citas— en
   * vez de dos o tres por día. El calendario público llega a pedir 60 días desde
   * un enlace sin sesión: día a día eran hasta 180 consultas por visita (Fable,
   * 2026-09-15).
   *
   * El horario es el de la AGENDA; con un vendedor concreto, el suyo propio si
   * lo tiene ese día. Con vendedor solo cuentan sus citas y cabe una a la vez;
   * sin él cuentan todas las del equipo y caben tantas como cupos tenga la agenda.
   */
  private async huecosDelRango(
    teamId: string,
    fechas: string[],
    hostUserId: string | null,
    zona: string,
    ajustes: Pick<AjustesDeAgenda, 'franjas' | 'duracionMin' | 'antelacionMin' | 'pasoMin' | 'cuposPorHorario'>,
  ): Promise<Map<string, ReturnType<typeof huecosDelDia>>> {
    const porFecha = new Map<string, ReturnType<typeof huecosDelDia>>();
    if (!fechas.length) return porFecha;
    const [propias, citas] = await Promise.all([
      hostUserId
        ? this.prisma.salesAvailability.findMany({
            where: { salesTeamId: teamId, userId: hostUserId },
            select: { weekday: true, startMin: true, endMin: true },
          })
        : Promise.resolve([] as Array<{ weekday: number; startMin: number; endMin: number }>),
      this.prisma.salesMeeting.findMany({
        where: {
          salesTeamId: teamId,
          status: { in: OCUPAN },
          startAt: {
            gte: minutosLocalesAUtc(fechas[0], 0, zona),
            lt: minutosLocalesAUtc(fechas[fechas.length - 1], 24 * 60, zona),
          },
          ...(hostUserId ? { hostUserId } : {}),
        },
        select: { startAt: true, durationMin: true },
      }),
    ]);
    const cupos = hostUserId ? 1 : ajustes.cuposPorHorario;
    const ocupado = citas.map((c) => ({
      desde: c.startAt.getTime(),
      hasta: c.startAt.getTime() + c.durationMin * 60_000,
    }));
    for (const fecha of fechas) {
      const weekday = diaDeLaSemanaEn(fecha, zona);
      const suyas = propias.filter((f) => f.weekday === weekday);
      const delDia = suyas.length ? suyas : ajustes.franjas.filter((f) => f.weekday === weekday);
      if (!delDia.length) {
        porFecha.set(fecha, []);
        continue;
      }
      // `huecosDelDia` tira un hueco con UNA cita encima. Se le pasan sin citas y
      // se cuentan aquí: el hueco se ofrece mientras las que coinciden no llenen
      // los cupos. Con un cupo es exactamente lo de antes.
      const libres = huecosDelDia({
        fecha,
        zona,
        franjas: delDia.map((f) => ({ startMin: f.startMin, endMin: f.endMin })),
        ocupado: [],
        duracionMin: ajustes.duracionMin,
        pasoMin: ajustes.pasoMin,
        antelacionMin: ajustes.antelacionMin,
      }).filter((h) => {
        const inicio = h.startAt.getTime();
        const fin = inicio + ajustes.duracionMin * 60_000;
        return ocupado.filter((o) => inicio < o.hasta && fin > o.desde).length < cupos;
      });
      porFecha.set(fecha, libres);
    }
    return porFecha;
  }

  async huecos(
    user: AuthUser,
    teamId: string,
    q: { fecha: string; hostUserId?: string | null; duracionMin?: number },
  ) {
    await resolveTeamAccess(this.prisma, user, teamId);
    const huecos = await this.huecosDe(
      teamId,
      q.fecha,
      q.hostUserId ?? null,
      ZONA_POR_DEFECTO,
      q.duracionMin ?? DURACION_POR_DEFECTO,
    );
    return { fecha: q.fecha, zona: ZONA_POR_DEFECTO, huecos };
  }

  // ── Citas ───────────────────────────────────────────────────────────────

  async listar(
    user: AuthUser,
    teamId: string,
    q: { desde?: string; hasta?: string; hostUserId?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const desde = q.desde && fechaValida(q.desde)
      ? minutosLocalesAUtc(q.desde, 0, ZONA_POR_DEFECTO)
      : new Date();
    const hasta = q.hasta && fechaValida(q.hasta)
      ? minutosLocalesAUtc(q.hasta, 24 * 60, ZONA_POR_DEFECTO)
      : new Date(desde.getTime() + 30 * 24 * 3600_000);

    const citas = await this.prisma.salesMeeting.findMany({
      where: {
        salesTeamId: teamId,
        startAt: { gte: desde, lt: hasta },
        ...(q.hostUserId ? { hostUserId: q.hostUserId } : {}),
      },
      orderBy: { startAt: 'asc' },
      take: 500,
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      zona: ZONA_POR_DEFECTO,
      citas: citas.map((c) => this.paraElPanel(c)),
    };
  }

  /**
   * La rejilla de UN día: closers en columnas, franjas en filas y el semáforo de
   * cada cita. Las franjas salen del horario de las agendas activas del equipo
   * para ese día de la semana, estiradas para que quepa cualquier cita que caiga
   * fuera.
   *
   * Las canceladas no ocupan celda: liberaron su hora. Un «no asistió» sí, en
   * rojo, porque esa hora se perdió y hay que verlo.
   */
  async dia(user: AuthUser, teamId: string, fecha?: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const zona = ZONA_POR_DEFECTO;
    const elDia = fecha && fechaValida(fecha) ? fecha : fechaEn(new Date(), zona);
    const desde = minutosLocalesAUtc(elDia, 0, zona);
    const hasta = minutosLocalesAUtc(elDia, 24 * 60, zona);

    const [closers, citas, agendas] = await Promise.all([
      closersActivosDelEquipo(this.prisma, teamId),
      this.prisma.salesMeeting.findMany({
        where: {
          salesTeamId: teamId,
          startAt: { gte: desde, lt: hasta },
          status: { not: 'CANCELADA' },
        },
        orderBy: { startAt: 'asc' },
        take: 500,
        include: { lead: { select: { id: true, name: true, company: true, phone: true, source: true } } },
      }),
      // El horario vive ahora en cada agenda de reserva, no en el equipo.
      this.prisma.salesAgenda.findMany({
        where: { salesTeamId: teamId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { settings: true },
      }),
    ]);
    const ajustesDeAgendas = agendas.map((a) => leerAjustesDeAgenda(a.settings));
    const semana = diaDeLaSemanaEn(elDia, zona);
    const horario = ajustesDeAgendas.flatMap((a) => a.franjas.filter((f) => f.weekday === semana));

    // Una cita cuyo anfitrión no es closer activo —un miembro con otro rol, o un
    // closer dado de baja con citas ya puestas— no caía en ninguna columna: se
    // perdía de la rejilla que se mira cada mañana (Fable, 2026-09-14). Se le
    // abre su columna, marcada, para que se vea y se pueda reasignar.
    const activos = new Set(closers.map((c) => c.id));
    const ajenos = [
      ...new Set(citas.map((c) => c.hostUserId).filter((id): id is string => !!id && !activos.has(id))),
    ];
    const columnas: Array<{ id: string; nombre: string; activo: boolean }> = closers.map((c) => ({
      ...c,
      activo: true,
    }));
    if (ajenos.length) {
      // Por la membresía y por el líder, no por `User`: `User` pasa por el filtro
      // de negocio y en el panel de una marca saldría sin nombre.
      const [miembros, equipo] = await Promise.all([
        this.prisma.salesTeamMember.findMany({
          where: { teamId, userId: { in: ajenos } },
          select: { userId: true, user: { select: { fullName: true } } },
        }),
        this.prisma.salesTeam.findUnique({
          where: { id: teamId },
          select: { leadUserId: true, leadUser: { select: { fullName: true } } },
        }),
      ]);
      const nombre = new Map(miembros.map((m) => [m.userId, m.user?.fullName ?? null]));
      if (equipo?.leadUserId && equipo.leadUser?.fullName && !nombre.get(equipo.leadUserId)) {
        nombre.set(equipo.leadUserId, equipo.leadUser.fullName);
      }
      for (const id of ajenos) {
        columnas.push({ id, nombre: nombre.get(id) ?? 'Fuera del equipo', activo: false });
      }
    }

    const horas = citas.map((c) => horaEnZona(c.startAt, zona));
    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      fecha: elDia,
      zona,
      // Reasignar reparte el trabajo de otros: como en el Banco, líder o admin.
      puedeAsignar: acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider')),
      // La reunión que se agenda desde aquí dura lo que la primera agenda del
      // equipo, no 30 fijos (Fable, 2026-09-15).
      duracionMin: ajustesDeAgendas[0]?.duracionMin ?? DURACION_POR_DEFECTO,
      closers: columnas,
      franjas: franjasDelDia(horario, horas),
      citas: citas.map((c, i) => ({
        id: c.id,
        hostUserId: c.hostUserId,
        startAt: c.startAt,
        hora: horas[i],
        franja: franjaDeHora(horas[i]),
        durationMin: c.durationMin,
        status: c.status,
        semaforo: semaforoDeCita(c),
        // Para «Confirmar asistencia» o «Quitar confirmación» en el detalle.
        confirmada: !!c.confirmedAt || c.status === 'CONFIRMADA',
        notes: c.notes,
        lead: c.lead
          ? {
              id: c.lead.id,
              nombre: c.lead.name,
              empresa: c.lead.company,
              telefono: c.lead.phone,
              origen: c.lead.source,
            }
          : null,
      })),
    };
  }

  private paraElPanel(c: {
    id: string;
    leadId: string | null;
    hostUserId: string | null;
    startAt: Date;
    durationMin: number;
    status: string;
    manageToken: string;
    notes: string | null;
    lead?: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  }) {
    return {
      id: c.id,
      leadId: c.leadId,
      hostUserId: c.hostUserId,
      startAt: c.startAt,
      durationMin: c.durationMin,
      status: c.status,
      manageToken: c.manageToken,
      notes: c.notes,
      lead: c.lead ?? null,
    };
  }

  /**
   * Agenda una cita desde dentro («Nueva reunión» de la cuadrícula).
   *
   * El lead viene por id o por sus datos: la referencia agenda con el nombre y
   * el WhatsApp escritos a mano, sin buscar antes en el tablero. Con esos datos
   * se reutiliza el lead con ese teléfono o se crea en la primera columna, como
   * en la reserva pública.
   *
   * El choque se mira ANTES de crear el lead: si no, cada intento en una hora
   * ocupada dejaba otra ficha de la misma persona. La comprobación que manda
   * sigue siendo la de dentro de `crearCita`.
   */
  async agendar(
    user: AuthUser,
    teamId: string,
    body: {
      leadId?: string | null;
      hostUserId?: string | null;
      startAt: string;
      durationMin?: number;
      notes?: string | null;
      lead?: { nombre?: string | null; whatsapp?: string | null; empresa?: string | null; fuente?: string | null } | null;
    },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    let leadId = body.leadId ?? null;
    if (!leadId && body.lead) {
      const nombre = (body.lead.nombre ?? '').trim();
      if (!nombre) throw new BadRequestException('El nombre del lead es obligatorio.');
      const { inicio, fin, hostUserId } = await this.validarCita(teamId, body);
      if ((await this.coincidencias(this.prisma, teamId, inicio, fin, hostUserId)) > 0) {
        throw new ConflictException('Esa hora ya está ocupada. Elige otra, por favor.');
      }
      leadId = await this.leadDeContacto(teamId, acceso.team.whiteLabelId, {
        name: nombre,
        phone: body.lead.whatsapp,
        company: body.lead.empresa,
        source: body.lead.fuente,
        creadoPor: user.id,
      });
    }
    return this.crearCita(teamId, {
      ...body,
      leadId,
      creadaPor: user.id,
    });
  }

  /** Lo que se comprueba de una cita antes de tocar la base: hora, duración y que el closer sea del equipo. */
  private async validarCita(
    teamId: string,
    body: { startAt: string; durationMin?: number; hostUserId?: string | null },
  ) {
    const inicio = new Date(body.startAt);
    if (Number.isNaN(inicio.getTime())) {
      throw new BadRequestException('La hora de la cita no es válida.');
    }
    if (inicio.getTime() < Date.now()) {
      throw new BadRequestException('Esa hora ya pasó.');
    }
    const duracion = body.durationMin ?? DURACION_POR_DEFECTO;
    if (!Number.isInteger(duracion) || duracion < 5 || duracion > 8 * 60) {
      throw new BadRequestException('La duración va de 5 minutos a 8 horas.');
    }
    const hostUserId = body.hostUserId ?? null;
    if (hostUserId) await this.exigirDelEquipo(teamId, hostUserId);
    return { inicio, fin: new Date(inicio.getTime() + duracion * 60_000), duracion, hostUserId };
  }

  /**
   * Cuántas citas que ocupan sitio se pisan con [inicio, fin): con closer, solo
   * las suyas; sin él, las de todo el equipo. Se traen las de ±12 h y se compara
   * el rango en memoria: Prisma no sabe expresar «solapa» sobre una duración que
   * vive en otra columna.
   */
  private async coincidencias(
    db: Prisma.TransactionClient,
    teamId: string,
    inicio: Date,
    fin: Date,
    hostUserId: string | null,
    sinContar?: string,
  ): Promise<number> {
    const cercanas = await db.salesMeeting.findMany({
      where: {
        salesTeamId: teamId,
        status: { in: OCUPAN },
        startAt: {
          gte: new Date(inicio.getTime() - 12 * 3600_000),
          lt: new Date(inicio.getTime() + 12 * 3600_000),
        },
        ...(hostUserId ? { hostUserId } : {}),
        ...(sinContar ? { id: { not: sinContar } } : {}),
      },
      select: { startAt: true, durationMin: true },
    });
    return cercanas.filter((c) => {
      const cFin = new Date(c.startAt.getTime() + c.durationMin * 60_000);
      return inicio < cFin && fin > c.startAt;
    }).length;
  }

  private async crearCita(
    teamId: string,
    body: {
      leadId?: string | null;
      hostUserId?: string | null;
      startAt: string;
      durationMin?: number;
      notes?: string | null;
      creadaPor?: string | null;
      /** La agenda de reserva de la que viene, si viene de una. */
      agendaId?: string | null;
      /** Cuántas citas pueden coincidir sin closer: los cupos de la agenda. Con closer, siempre una. */
      cupos?: number;
    },
  ) {
    const { inicio, duracion, fin, hostUserId } = await this.validarCita(teamId, body);

    if (body.leadId) {
      const l = await this.prisma.salesLead.findFirst({
        where: { id: body.leadId, salesTeamId: teamId },
        select: { id: true },
      });
      if (!l) throw new NotFoundException('Lead no encontrado');
    }

    const cupos = hostUserId ? 1 : Math.max(1, body.cupos ?? 1);
    const cita = await this.prisma.$transaction(async (tx) => {
      // CON CANDADO POR EQUIPO. Sin él, dos reservas a la vez contaban las mismas
      // citas, cabían las dos y la hora se quedaba con una más de las que admite.
      // Con cupos ya no es un caso raro: es lo que pasa cuando dos personas abren
      // el mismo enlace a la vez.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `citas:${teamId}`);
      if ((await this.coincidencias(tx, teamId, inicio, fin, hostUserId)) >= cupos) {
        throw new ConflictException(
          'Esa hora acaba de ocuparse. Elige otra, por favor.',
        );
      }

      return tx.salesMeeting.create({
        data: {
          salesTeamId: teamId,
          leadId: body.leadId ?? null,
          hostUserId,
          startAt: inicio,
          durationMin: duracion,
          timezone: ZONA_POR_DEFECTO,
          status: 'PENDIENTE',
          // 32 caracteres: el enlace es la única llave de esa cita.
          manageToken: nanoid(32),
          notes: body.notes?.trim() || null,
          agendaId: body.agendaId ?? null,
          // Quién la agendó desde dentro: es el «setter» de la venta del equipo
          // («Negocio de la marca», en Clientes). Una reserva por el enlace
          // público no trae a nadie y se queda en null, que es lo correcto:
          // rellenarlo a ojo sería atribuirle a alguien una venta.
          agendadaPorUserId: body.creadaPor ?? null,
        },
        include: {
          lead: { select: { id: true, name: true, phone: true, email: true } },
        },
      });
    });

    // El evento y su sala de Meet. Se espera como mucho 8 s para que {{sala}}
    // entre en el aviso de «cita agendada»; si Google tarda más, la sala se
    // guarda igual en segundo plano y la cita no espera a nadie.
    const sala = (await this.calendario?.sincronizarCita(cita.id, { esperarMs: 8000 })) ?? null;

    const leadDeLaCita = cita.leadId;
    if (leadDeLaCita) {
      await this.anotarEnElLead(
        leadDeLaCita,
        teamId,
        body.creadaPor ?? null,
        `Cita agendada para el ${fechaEn(inicio, ZONA_POR_DEFECTO)}`,
      );
      void this.automations.disparar(leadDeLaCita, 'sales_meeting_booked', {
        cita_fecha: fechaEn(inicio, ZONA_POR_DEFECTO),
        ...(sala ? { sala } : {}),
      });
    }
    return this.paraElPanel(cita);
  }

  /**
   * El lead de una cita: reutiliza el que haya con ese teléfono, o lo crea en
   * la primera columna. Lo usan la reserva pública y «Nueva reunión».
   *
   * Reutilizar es lo importante: si no, cada vez que alguien reagenda aparece
   * una tarjeta nueva y el vendedor acaba con la misma persona cuatro veces en
   * el tablero.
   */
  private async leadDeContacto(
    teamId: string,
    whiteLabelId: string | null,
    body: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      /** Desde dentro. La reserva pública la completa después, con lo del formulario. */
      company?: string | null;
      /** De dónde llegó. Sin él, «agenda». */
      source?: string | null;
      creadoPor?: string | null;
    },
  ): Promise<string | null> {
    const phone = (body.phone ?? '').trim();
    const phoneKey = phoneKeyOf(phone);
    const nombre = (body.name ?? '').trim();
    // EL NOMBRE BASTA PARA ENTRAR AL TABLERO.
    //
    // Antes esto exigía teléfono o correo, y el formulario público pide
    // «nombre O teléfono». Quien escribía solo su nombre pasaba el formulario
    // y **se perdía aquí**: `null` → cita sin lead → el vendedor veía el hueco
    // ocupado sin saber de quién. Es el mismo fallo que ya se arregló unas
    // líneas más abajo con las columnas del tablero, y por la misma razón: la
    // cita queda y la persona no.
    if (!phoneKey && !(body.email ?? '').trim() && !nombre) return null;

    if (phoneKey) {
      const ya = await this.prisma.salesLead.findFirst({
        where: { salesTeamId: teamId, phoneKey },
        select: { id: true },
      });
      if (ya) {
        // La empresa escrita entra si la ficha no tenía; lo que ya había no se pisa.
        const empresa = (body.company ?? '').trim().slice(0, 160);
        if (empresa) {
          await this.prisma.salesLead.updateMany({
            where: { id: ya.id, salesTeamId: teamId, company: null },
            data: { company: empresa },
          });
        }
        return ya.id;
      }
    }

    // Se SIEMBRAN si el equipo aún no tiene tablero abierto. Rendirse aquí
    // hacía desaparecer al prospecto: la cita quedaba y la persona no, así que
    // el vendedor veía un hueco ocupado sin saber de quién. Cazado en una
    // prueba contra producción con «Equipo Ecuador», creado en agosto y con el
    // tablero sin estrenar.
    const columnas = await asegurarColumnas(this.prisma, teamId);
    const primera = columnas[0];
    if (!primera) return null;

    const lead = await this.prisma.salesLead.create({
      data: {
        salesTeamId: teamId,
        whiteLabelId,
        stageId: primera.id,
        name: nombre || null,
        phone: phone || null,
        phoneKey,
        email: emailNormOf(body.email),
        company: (body.company ?? '').trim().slice(0, 160) || null,
        source: (body.source ?? '').trim().slice(0, 40) || 'agenda',
        createdByUserId: body.creadoPor ?? null,
      },
      select: { id: true },
    });
    return lead.id;
  }

  async cambiarEstado(
    user: AuthUser,
    teamId: string,
    citaId: string,
    estado: string,
    nota?: string | null,
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    if (!(ESTADOS as readonly string[]).includes(estado)) {
      throw new BadRequestException('Ese estado no existe.');
    }
    const cita = await this.prisma.salesMeeting.findFirst({
      where: { id: citaId, salesTeamId: teamId },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    const actualizada = await this.prisma.salesMeeting.update({
      where: { id: citaId },
      data: { status: estado as Estado },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
    if (cita.leadId) {
      // Las observaciones de «Registrar resultado» van con el cambio de estado:
      // la cita no tiene columna para ellas, y el historial del lead es donde se leen.
      const observaciones = (nota ?? '').trim().slice(0, 2000);
      await this.anotarEnElLead(
        cita.leadId,
        teamId,
        user.id,
        `Cita marcada como ${estado.toLowerCase().replace('_', ' ')}${observaciones ? `\nObservaciones: ${observaciones}` : ''}`,
      );
      // Solo el plantón tiene disparador propio: es el único estado que pide
      // una reacción automática («¿reagendamos?»). Los demás los ve el
      // vendedor en su agenda.
      if (estado === 'NO_ASISTIO') {
        void this.automations.disparar(cita.leadId, 'sales_meeting_no_show', {});
      }
    }
    // Cancelada: cancela el evento. Reabierta: lo recupera con su misma sala.
    void this.calendario?.sincronizarCita(citaId);
    return this.paraElPanel(actualizada);
  }

  /**
   * «Reagendar» desde el detalle de la reunión: la misma cita a otra hora.
   *
   * Vuelve a PENDIENTE y se le borran las confirmaciones y el recordatorio
   * enviado: eran de la hora vieja. Con ellos puestos, la cuadrícula la pintaba
   * en verde para una hora que el cliente nunca confirmó, y el recordatorio de la
   * hora nueva no salía porque el candado creía que ya se había mandado.
   *
   * Con el mismo candado que agendar, y UPDATE condicional sobre las que siguen
   * abiertas: una cita que se canceló mientras tanto no se reabre.
   */
  async reagendar(user: AuthUser, teamId: string, citaId: string, startAt: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const cita = await this.prisma.salesMeeting.findFirst({
      where: { id: citaId, salesTeamId: teamId },
      select: { id: true, leadId: true, hostUserId: true, durationMin: true, status: true, agendaId: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    if (!['PENDIENTE', 'CONFIRMADA'].includes(cita.status)) {
      throw new BadRequestException('Esa reunión ya está cerrada: agenda una nueva.');
    }
    // Con closer, una cita suya a la vez. Sin él, los cupos de la agenda de la que
    // vino, como al reservarla: comparando con uno, mover una cita de una agenda
    // de 3 cupos a una hora con otra encima se rechazaba (Fable, 2026-09-15).
    const agenda =
      !cita.hostUserId && cita.agendaId
        ? await this.prisma.salesAgenda.findFirst({
            where: { id: cita.agendaId, salesTeamId: teamId },
            select: { settings: true },
          })
        : null;
    const cupos = agenda ? leerAjustesDeAgenda(agenda.settings).cuposPorHorario : 1;
    // Sin volver a exigir que el closer siga en el equipo: si se fue, la cita
    // igual hay que moverla (y reasignarla).
    const { inicio, fin } = await this.validarCita(teamId, { startAt, durationMin: cita.durationMin });
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `citas:${teamId}`);
      if ((await this.coincidencias(tx, teamId, inicio, fin, cita.hostUserId, cita.id)) >= cupos) {
        throw new ConflictException('Esa hora ya está ocupada. Elige otra, por favor.');
      }
      const r = await tx.salesMeeting.updateMany({
        where: { id: cita.id, salesTeamId: teamId, status: { in: ['PENDIENTE', 'CONFIRMADA'] } },
        data: {
          startAt: inicio,
          status: 'PENDIENTE',
          reminderSentAt: null,
          confirmedAt: null,
          confirmedByUserId: null,
          conf1h: false,
          conf1hAt: null,
          conf30min: false,
          conf30minAt: null,
        },
      });
      if (r.count === 0) throw new NotFoundException('La reunión ya no se puede reagendar');
    });
    if (cita.leadId) {
      await this.anotarEnElLead(
        cita.leadId,
        teamId,
        user.id,
        `Cita reagendada para el ${fechaEn(inicio, ZONA_POR_DEFECTO)} a las ${horaEnZona(inicio, ZONA_POR_DEFECTO)}`,
      );
    }
    // Mueve el evento; la sala de Meet sigue siendo la misma.
    void this.calendario?.sincronizarCita(cita.id);
    return { ok: true };
  }

  // ── Público: el prospecto, sin cuenta ───────────────────────────────────

  /**
   * El formulario que pide una agenda de reserva, o null (nombre y teléfono).
   *
   * Solo si está activo y asegura un dato de contacto. Las pantallas ya impiden
   * elegir uno sin él, pero una edición a la vez que otro lo elige podía colarlo,
   * y sin ese dato la cita saldría sin lead: mejor el formulario de siempre.
   */
  private async formularioDeLaAgenda(teamId: string, formId: string | null) {
    if (!formId) return null;
    const f = await this.prisma.salesForm.findFirst({ where: { id: formId, salesTeamId: teamId, isActive: true } });
    return f && pideDatoDeContacto(camposGuardados(f.fields)) ? f : null;
  }

  /**
   * La agenda que abre `/agenda/<slug>`.
   *
   * Primero la AGENDA con ese enlace. Si no hay ninguna, el slug del EQUIPO lleva
   * a su primera agenda activa: es el enlace que se repartía cuando cada equipo
   * tenía una sola, y tiene que seguir abriendo algo aunque esa agenda cambie de
   * enlace o se borre. Una agenda que existe pero está apagada NO cae al equipo:
   * apagarla es cerrar ese enlace.
   *
   * Comprueba el módulo igual que el resto: si la marca lo tiene apagado, el
   * enlace deja de existir. Un equipo PAUSADO («Configuración») tampoco ofrece
   * nada: pausado es justo «no recibe citas nuevas». Las ya reservadas se siguen
   * gestionando por su enlace.
   */
  private async agendaPublica(slug: string) {
    const campos = {
      id: true,
      salesTeamId: true,
      isActive: true,
      formId: true,
      settings: true,
      team: { select: { id: true, name: true, whiteLabelId: true, isActive: true, status: true } },
    } as const;
    let agenda = await this.prisma.salesAgenda.findUnique({ where: { slug }, select: campos });
    if (!agenda) {
      const equipo = await this.prisma.salesTeam.findFirst({ where: { slug }, select: { id: true } });
      if (equipo) {
        agenda = await this.prisma.salesAgenda.findFirst({
          where: { salesTeamId: equipo.id, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: campos,
        });
      }
    }
    if (!agenda || !agenda.isActive || !agenda.team.isActive || agenda.team.status === 'pausado') {
      throw new NotFoundException('Agenda no disponible');
    }
    await this.exigirModulo(agenda.team.whiteLabelId);
    return agenda;
  }

  /** El calendario que ve el prospecto: los días y las horas libres de ESA agenda. */
  async calendarioPublico(slug: string, hostUserId?: string | null) {
    const agenda = await this.agendaPublica(slug);

    // «Cómo se ve y cuándo se reserva»: cuántos días se ofrecen, qué duración,
    // con cuánta antelación, qué fechas no, y el horario y los cupos.
    const ajustes = leerAjustesDeAgenda(agenda.settings);
    const bloqueadas = new Set(ajustes.fechasBloqueadas);
    const hoy = fechaEn(new Date(), ZONA_POR_DEFECTO);
    const fechas: string[] = [];
    for (let i = 0; i < ajustes.diasHaciaAdelante; i++) {
      const d = new Date(
        minutosLocalesAUtc(hoy, 0, ZONA_POR_DEFECTO).getTime() + i * 24 * 3600_000,
      );
      const fecha = fechaEn(d, ZONA_POR_DEFECTO);
      if (!bloqueadas.has(fecha)) fechas.push(fecha);
    }
    const huecosPorFecha = await this.huecosDelRango(
      agenda.salesTeamId,
      fechas,
      hostUserId ?? null,
      ZONA_POR_DEFECTO,
      ajustes,
    );
    const dias: Array<{ fecha: string; huecos: { startAt: Date; label: string }[] }> = [];
    for (const fecha of fechas) {
      const huecos = huecosPorFecha.get(fecha) ?? [];
      if (huecos.length) dias.push({ fecha, huecos });
    }
    // El formulario que eligió esta agenda, si está activo. Sin él, la página
    // pide lo de siempre: nombre y teléfono.
    const formulario = await this.formularioDeLaAgenda(agenda.salesTeamId, agenda.formId);
    return {
      team: { name: agenda.team.name },
      zona: ZONA_POR_DEFECTO,
      titulo: ajustes.titulo,
      subtitulo: ajustes.subtitulo,
      volverAlSitio: ajustes.volverAlSitio,
      redirigirEnSegundos: ajustes.redirigirEnSegundos,
      duracionMin: ajustes.duracionMin,
      dias,
      formulario: formulario
        ? {
            nombre: formulario.name,
            descripcion: formulario.description,
            campos: camposParaElPublico(camposGuardados(formulario.fields)),
          }
        : null,
    };
  }

  async reservarPublico(
    slug: string,
    body: {
      startAt: string;
      hostUserId?: string | null;
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      respuestas?: Record<string, unknown> | null;
    },
  ) {
    const agenda = await this.agendaPublica(slug);
    const team = agenda.team;

    // EL FORMULARIO, ANTES QUE LA HORA. Si la agenda pide uno, lo que llega se
    // limpia (solo sus preguntas, cada una con su tipo) y se exige lo
    // obligatorio que la persona tuvo delante. Lo que el formulario dice del
    // lead manda sobre los campos sueltos del cuerpo.
    const formulario = await this.formularioDeLaAgenda(team.id, agenda.formId);
    const campos = formulario ? camposGuardados(formulario.fields) : [];
    const respuestas = formulario ? limpiarRespuestas(campos, body.respuestas) : null;
    if (respuestas) {
      const faltan = camposQueFaltan(campos, respuestas);
      if (faltan.length) {
        throw new BadRequestException({ message: 'Revisa las preguntas marcadas: faltan por contestar o no son válidas.', campos: faltan });
      }
    }
    const delFormulario = respuestas ? datosDelLead(campos, respuestas) : {};
    const datosDeContacto = {
      name: delFormulario.name ?? body.name,
      phone: delFormulario.phone ?? body.phone,
      email: delFormulario.email ?? body.email,
    };
    // SIN UN DATO DE CONTACTO NO HAY RESERVA. `leadDeContacto` devolvía
    // null en silencio y la cita salía sin lead: el closer veía el hueco ocupado
    // sin saber de quién. Lo exigía solo la página; un `curl`, o una página
    // cargada CON formulario cuando el equipo lo quitaba antes de enviar, pasaba
    // (Fable, 2026-09-15). Mismo criterio que usa el lead, así que lo que pasa
    // aquí crea lead seguro.
    if (
      !(datosDeContacto.name ?? '').trim() &&
      !phoneKeyOf(datosDeContacto.phone) &&
      !emailNormOf(datosDeContacto.email)
    ) {
      throw new BadRequestException('Déjanos al menos tu nombre, tu WhatsApp o tu correo.');
    }

    // LA HORA TIENE QUE SER UNA DE LAS OFRECIDAS.
    //
    // Antes esto se fiaba del `startAt` que llegara en el cuerpo, y lo único
    // que comprobaba `crearCita` era que no solapara con otra cita. O sea: con
    // un `curl` se podía reservar un domingo a las 3 de la mañana, fuera de
    // todo horario publicado. El calendario público es una sugerencia del
    // navegador, no un candado; el candado va aquí.
    //
    // Se recalculan los huecos del día y se exige que el instante pedido sea
    // uno de ellos. De paso cubre la carrera de manual: dos personas mirando
    // el mismo hueco: al segundo ya no le sale.
    const inicioPedido = new Date(body.startAt);
    if (Number.isNaN(inicioPedido.getTime())) {
      throw new BadRequestException('La hora de la cita no es válida.');
    }
    // Lo mismo que ofrece el calendario, con los ajustes de la agenda: una fecha
    // bloqueada o más allá de los días que se ofrecen no se reserva escribiendo
    // la hora a mano, y una hora con los cupos llenos tampoco.
    const ajustes = leerAjustesDeAgenda(agenda.settings);
    const fechaPedida = fechaEn(inicioPedido, ZONA_POR_DEFECTO);
    const hoyEnLaZona = fechaEn(new Date(), ZONA_POR_DEFECTO);
    const ultimoDia = fechaEn(
      new Date(
        minutosLocalesAUtc(hoyEnLaZona, 0, ZONA_POR_DEFECTO).getTime() +
          (ajustes.diasHaciaAdelante - 1) * 24 * 3600_000,
      ),
      ZONA_POR_DEFECTO,
    );
    const ofrecidos =
      ajustes.fechasBloqueadas.includes(fechaPedida) || fechaPedida > ultimoDia
        ? []
        : ((
            await this.huecosDelRango(team.id, [fechaPedida], body.hostUserId ?? null, ZONA_POR_DEFECTO, ajustes)
          ).get(fechaPedida) ?? []);
    if (!ofrecidos.some((h) => h.startAt.getTime() === inicioPedido.getTime())) {
      throw new BadRequestException(
        'Ese horario ya no está disponible. Elige otro.',
      );
    }

    // El prospecto que agenda ENTRA AL TABLERO. Si no, la cita queda huérfana:
    // el vendedor no la ve en su embudo y el recordatorio no tiene a quién
    // avisar, porque el teléfono se habría quedado dentro de una nota.
    const leadId = await this.leadDeContacto(team.id, team.whiteLabelId, datosDeContacto);
    // Lo que el formulario sabe del lead y el lead no tenía (empresa, Instagram)
    // se completa, sin pisar lo que ya había.
    if (leadId && delFormulario.company) {
      await this.prisma.salesLead.updateMany({
        where: { id: leadId, salesTeamId: team.id, company: null },
        data: { company: delFormulario.company },
      });
    }
    if (leadId && delFormulario.instagram) {
      await this.prisma.salesLead.updateMany({
        where: { id: leadId, salesTeamId: team.id, instagram: null },
        data: { instagram: delFormulario.instagram },
      });
    }

    const cita = await this.crearCita(team.id, {
      leadId,
      hostUserId: body.hostUserId ?? null,
      startAt: body.startAt,
      durationMin: ajustes.duracionMin,
      agendaId: agenda.id,
      cupos: ajustes.cuposPorHorario,
      // Con formulario, las notas de la cita llevan sus respuestas: el closer
      // las lee sin abrir nada más.
      notes: (body.notes ?? '').trim() || (respuestas ? resumenDeRespuestas(campos, respuestas) : '') || null,
    });
    if (formulario && respuestas) {
      // La respuesta entera se guarda, también lo que no tiene columna en el
      // lead. Nunca tumba la reserva: la cita ya está hecha y sus notas llevan
      // el resumen.
      await this.prisma.salesFormResponse
        .create({
          data: {
            salesTeamId: team.id,
            formId: formulario.id,
            leadId: leadId ?? null,
            meetingId: cita.id,
            answers: respuestas as unknown as Prisma.InputJsonValue,
            score: puntajeDelFormulario(campos, respuestas),
          },
        })
        .catch((e) => this.logger.warn(`no se guardó la respuesta del formulario: ${(e as Error).message}`));
    }
    // Solo el token: el id de la cita no sale nunca de aquí.
    return {
      ok: true,
      manageToken: cita.manageToken,
      startAt: cita.startAt,
      // A qué WhatsApp seguir al terminar, si el formulario lo pide.
      whatsapp: formulario?.redirectWhatsapp
        ? { numero: formulario.redirectWhatsapp, mensaje: formulario.redirectMessage ?? '' }
        : null,
    };
  }

  /** La cita desde su enlace. El token ES la autorización. */
  async verPorToken(token: string) {
    const c = await this.prisma.salesMeeting.findUnique({
      where: { manageToken: token },
      include: { team: { select: { name: true, whiteLabelId: true } } },
    });
    if (!c) throw new NotFoundException('Cita no encontrada');
    await this.exigirModulo(c.team.whiteLabelId);
    return {
      equipo: c.team.name,
      startAt: c.startAt,
      durationMin: c.durationMin,
      status: c.status,
      zona: c.timezone ?? ZONA_POR_DEFECTO,
    };
  }

  /**
   * El prospecto cancela desde su enlace.
   *
   * `updateMany` condicional sobre los estados que se pueden cancelar: dos
   * clics seguidos no cancelan dos veces, y una cita ya REALIZADA no se
   * deshace desde un enlace público.
   */
  async cancelarPorToken(token: string) {
    const c = await this.prisma.salesMeeting.findUnique({
      where: { manageToken: token },
      select: { id: true, leadId: true, salesTeamId: true, team: { select: { whiteLabelId: true } } },
    });
    if (!c) throw new NotFoundException('Cita no encontrada');
    await this.exigirModulo(c.team.whiteLabelId);

    const r = await this.prisma.salesMeeting.updateMany({
      where: { id: c.id, status: { in: ['PENDIENTE', 'CONFIRMADA'] } },
      data: { status: 'CANCELADA' },
    });
    if (r.count === 0) {
      return { ok: true, yaEstaba: true };
    }
    if (c.leadId) {
      await this.anotarEnElLead(
        c.leadId,
        c.salesTeamId,
        null,
        'El prospecto canceló la cita desde su enlace',
      );
    }
    void this.calendario?.sincronizarCita(c.id);
    return { ok: true, yaEstaba: false };
  }

  // ── Recordatorio ────────────────────────────────────────────────────────

  /**
   * Avisa de las citas que empiezan dentro de la próxima hora.
   *
   * EL CANDADO ES LO IMPORTANTE. `reminderSentAt` se pone con un UPDATE
   * CONDICIONAL sobre `reminderSentAt: null`, y solo se manda el mensaje si ese
   * update tocó una fila. Sin eso, dos ciclos del cron solapados —o dos
   * instancias del backend— leen las mismas citas, las dos pasan el `if`, y al
   * prospecto le llegan dos recordatorios idénticos. Es el mismo fallo de
   * leer-decidir-escribir que ya nos ha mordido en cobros y en sellos.
   *
   * Se reclama ANTES de mandar, no después: mejor un recordatorio perdido si
   * el envío falla que dos recordatorios seguros.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async recordarCitas() {
    const ahora = new Date();
    const hasta = new Date(ahora.getTime() + 60 * 60_000);
    const candidatas = await this.prisma.salesMeeting
      .findMany({
        where: {
          status: { in: ['PENDIENTE', 'CONFIRMADA'] },
          reminderSentAt: null,
          startAt: { gte: ahora, lt: hasta },
        },
        take: 200,
        include: {
          team: { select: { name: true, whiteLabelId: true } },
          lead: { select: { phone: true, name: true, source: true } },
        },
      })
      .catch(() => []);
    if (!candidatas.length) return;

    let enviados = 0;
    for (const c of candidatas) {
      // EL TELÉFONO SE MIRA ANTES DE RECLAMAR.
      //
      // Estaba después, y eso QUEMABA el recordatorio: a una cita cuyo lead no
      // tenía teléfono se le sellaba `reminderSentAt` y luego se salía por el
      // `continue` sin mandar nada. Si el vendedor le ponía el número más
      // tarde, el aviso ya no salía nunca — el candado anti-duplicados creía
      // que ya se había enviado.
      //
      // No confundirlo con el reclamo: ese SÍ va antes del envío a propósito
      // (mejor un recordatorio perdido que dos). Pero esto no es una carrera,
      // es una condición previa.
      const telefono = (c.lead?.phone ?? '').trim();
      const wlId = c.team.whiteLabelId;
      if (!telefono || !wlId) continue;

      // Reclamo: si otro ciclo llegó primero, `count` es 0 y no se manda nada.
      const reclamo = await this.prisma.salesMeeting.updateMany({
        where: { id: c.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (reclamo.count === 0) continue;

      const hora = new Intl.DateTimeFormat('es-CO', {
        timeZone: c.timezone ?? ZONA_POR_DEFECTO,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(c.startAt);
      const r = await this.mkt
        .sendSms({
          whiteLabelId: wlId,
          toPhone: telefono,
          message: `Hola${c.lead?.name ? ` ${c.lead.name.split(' ')[0]}` : ''}, te recordamos tu cita de hoy a las ${hora} con ${c.team.name}.${c.meetUrl ? ` Entra aquí: ${c.meetUrl}` : ''}`,
          ctx: {
            feature: 'sales-agenda-recordatorio',
            whiteLabelId: wlId,
            // El teléfono de un lead nacido en la agenda pública lo escribió
            // alguien sin sesión: va marcado para que el tope de envíos lo
            // cuente. Reservar y cancelar en bucle es la forma de usar el
            // remitente de la marca como arma contra un tercero.
            destinatarioSinVerificar: c.lead?.source === 'agenda',
          },
        })
        .catch((e) => ({ ok: false as const, error: (e as Error).message }));
      if (r.ok) enviados++;
    }
    if (enviados) this.logger.log(`Recordatorios de cita enviados: ${enviados}`);
  }

  private async exigirModulo(whiteLabelId: string | null) {
    if (!whiteLabelId) throw new NotFoundException('Agenda no disponible');
    const fila = await this.prisma.whiteLabelModule.findUnique({
      where: { whiteLabelId_module: { whiteLabelId, module: 'SALES_TEAMS' } },
      select: { enabled: true },
    });
    if (!fila?.enabled) throw new NotFoundException('Agenda no disponible');
  }

  private async anotarEnElLead(
    leadId: string,
    salesTeamId: string,
    userId: string | null,
    body: string,
  ) {
    await this.prisma.salesLeadActivity
      .create({ data: { leadId, salesTeamId, userId, kind: 'cita', body } })
      .catch((e) =>
        this.logger.warn(`no se pudo anotar la cita: ${(e as Error).message}`),
      );
    await this.prisma.salesLead
      .update({ where: { id: leadId }, data: { lastActivityAt: new Date() } })
      .catch(() => null);
  }
}
