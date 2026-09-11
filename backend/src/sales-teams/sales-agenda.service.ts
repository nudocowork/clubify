import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
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
 * Todo método empieza por `resolveTeamAccess`, menos los tres públicos — que
 * se defienden con el token y con el equipo tener el módulo encendido.
 */

/** Por defecto, y lo que casi nadie va a cambiar. */
const ZONA_POR_DEFECTO = 'America/Bogota';
const DURACION_POR_DEFECTO = 30;
/** Cuánto se mira hacia delante en el calendario público. */
const DIAS_QUE_SE_OFRECEN = 21;
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
   * Crea el enlace publico del equipo, si no lo tiene.
   *
   * El slug sale del nombre y lleva sufijo hasta que entre: `SalesTeam.slug` es
   * unico en toda la plataforma, asi que dos equipos «Ventas» de marcas
   * distintas chocarian y Prisma devolveria un P2002 crudo.
   *
   * Idempotente: si ya tiene, devuelve el que tiene. Cambiarlo romperia los
   * enlaces que el equipo ya haya repartido.
   */
  async asegurarEnlace(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const actual = await this.prisma.salesTeam.findUnique({
      where: { id: teamId },
      select: { slug: true, name: true },
    });
    if (actual?.slug) return { slug: actual.slug, yaTenia: true };

    const base =
      (actual?.name ?? 'equipo')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'equipo';

    const ocupados = new Set(
      (
        await this.prisma.salesTeam.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      )
        .map((t) => t.slug)
        .filter(Boolean) as string[],
    );
    let libre = base;
    for (let i = 2; ocupados.has(libre) && i <= 50; i++) libre = `${base}-${i}`;

    await this.prisma.salesTeam.update({
      where: { id: teamId },
      data: { slug: libre },
    });
    return { slug: libre, yaTenia: false };
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
      antelacionMin: ANTELACION_MIN,
    });
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
   * Agenda una cita.
   *
   * El candado está aquí y no en la pantalla de huecos: entre ver «10:30
   * libre» y pulsar pasan segundos, y en esos segundos cabe otro. Se comprueba
   * el solape DENTRO de la transacción, contra las citas que ocupan sitio.
   *
   * No hay índice único que lo garantice —las citas no chocan por igualdad,
   * chocan por rango— así que la transacción es lo que hay. Con dos escrituras
   * simultáneas exactas todavía podrían colarse las dos; para el volumen de un
   * equipo de ventas es un riesgo que no paga una tabla de bloqueos.
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
    },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    return this.crearCita(teamId, {
      ...body,
      creadaPor: user.id,
    });
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
    },
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

    if (body.leadId) {
      const l = await this.prisma.salesLead.findFirst({
        where: { id: body.leadId, salesTeamId: teamId },
        select: { id: true },
      });
      if (!l) throw new NotFoundException('Lead no encontrado');
    }

    const fin = new Date(inicio.getTime() + duracion * 60_000);

    const cita = await this.prisma.$transaction(async (tx) => {
      // Se traen las del día y se compara el rango en memoria: Prisma no sabe
      // expresar «solapa» sobre una duración que vive en otra columna.
      const delDia = await tx.salesMeeting.findMany({
        where: {
          salesTeamId: teamId,
          status: { in: OCUPAN },
          startAt: {
            gte: new Date(inicio.getTime() - 12 * 3600_000),
            lt: new Date(inicio.getTime() + 12 * 3600_000),
          },
          ...(hostUserId ? { hostUserId } : {}),
        },
        select: { startAt: true, durationMin: true },
      });
      const choca = delDia.some((c) => {
        const cFin = new Date(c.startAt.getTime() + c.durationMin * 60_000);
        return inicio < cFin && fin > c.startAt;
      });
      if (choca) {
        throw new ConflictException(
          'Esa hora acaba de ocuparse. Elegí otra, por favor.',
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
        },
        include: {
          lead: { select: { id: true, name: true, phone: true, email: true } },
        },
      });
    });

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
      });
    }
    return this.paraElPanel(cita);
  }

  /**
   * El lead de una reserva pública: reutiliza el que haya con ese teléfono, o
   * lo crea en la primera columna.
   *
   * Reutilizar es lo importante: si no, cada vez que alguien reagenda aparece
   * una tarjeta nueva y el vendedor acaba con la misma persona cuatro veces en
   * el tablero.
   */
  private async leadDeLaReservaPublica(
    teamId: string,
    whiteLabelId: string | null,
    body: { name?: string | null; phone?: string | null; email?: string | null },
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
      if (ya) return ya.id;
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
        source: 'agenda',
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
      await this.anotarEnElLead(
        cita.leadId,
        teamId,
        user.id,
        `Cita marcada como ${estado.toLowerCase().replace('_', ' ')}`,
      );
      // Solo el plantón tiene disparador propio: es el único estado que pide
      // una reacción automática («¿reagendamos?»). Los demás los ve el
      // vendedor en su agenda.
      if (estado === 'NO_ASISTIO') {
        void this.automations.disparar(cita.leadId, 'sales_meeting_no_show', {});
      }
    }
    return this.paraElPanel(actualizada);
  }

  // ── Público: el prospecto, sin cuenta ───────────────────────────────────

  /**
   * El calendario que ve el prospecto.
   *
   * Comprueba el módulo igual que el resto: si la marca lo tiene apagado, este
   * enlace deja de existir. Sin eso, apagar el módulo escondería el menú del
   * equipo y dejaría el enlace público sirviendo citas.
   */
  async calendarioPublico(teamSlug: string, hostUserId?: string | null) {
    const team = await this.prisma.salesTeam.findFirst({
      where: { slug: teamSlug, isActive: true },
      select: { id: true, name: true, whiteLabelId: true },
    });
    if (!team) throw new NotFoundException('Agenda no disponible');
    await this.exigirModulo(team.whiteLabelId);

    const hoy = fechaEn(new Date(), ZONA_POR_DEFECTO);
    const dias: Array<{ fecha: string; huecos: { startAt: Date; label: string }[] }> = [];
    for (let i = 0; i < DIAS_QUE_SE_OFRECEN; i++) {
      const d = new Date(
        minutosLocalesAUtc(hoy, 0, ZONA_POR_DEFECTO).getTime() + i * 24 * 3600_000,
      );
      const fecha = fechaEn(d, ZONA_POR_DEFECTO);
      const huecos = await this.huecosDe(
        team.id,
        fecha,
        hostUserId ?? null,
        ZONA_POR_DEFECTO,
        DURACION_POR_DEFECTO,
      );
      if (huecos.length) dias.push({ fecha, huecos });
    }
    return { team: { name: team.name }, zona: ZONA_POR_DEFECTO, dias };
  }

  async reservarPublico(
    teamSlug: string,
    body: {
      startAt: string;
      hostUserId?: string | null;
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
    },
  ) {
    const team = await this.prisma.salesTeam.findFirst({
      where: { slug: teamSlug, isActive: true },
      select: { id: true, whiteLabelId: true },
    });
    if (!team) throw new NotFoundException('Agenda no disponible');
    await this.exigirModulo(team.whiteLabelId);

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
    const huecosDelDia = await this.huecosDe(
      team.id,
      fechaEn(inicioPedido, ZONA_POR_DEFECTO),
      body.hostUserId ?? null,
      ZONA_POR_DEFECTO,
      DURACION_POR_DEFECTO,
    );
    if (!huecosDelDia.some((h) => h.startAt.getTime() === inicioPedido.getTime())) {
      throw new BadRequestException(
        'Ese horario ya no está disponible. Elige otro.',
      );
    }

    // El prospecto que agenda ENTRA AL TABLERO. Si no, la cita queda huérfana:
    // el vendedor no la ve en su embudo y el recordatorio no tiene a quién
    // avisar, porque el teléfono se habría quedado dentro de una nota.
    const leadId = await this.leadDeLaReservaPublica(team.id, team.whiteLabelId, body);

    const cita = await this.crearCita(team.id, {
      leadId,
      hostUserId: body.hostUserId ?? null,
      startAt: body.startAt,
      notes: (body.notes ?? '').trim() || null,
    });
    // Solo el token: el id de la cita no sale nunca de aquí.
    return { ok: true, manageToken: cita.manageToken, startAt: cita.startAt };
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
      // Reclamo: si otro ciclo llegó primero, `count` es 0 y no se manda nada.
      const reclamo = await this.prisma.salesMeeting.updateMany({
        where: { id: c.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (reclamo.count === 0) continue;

      const telefono = (c.lead?.phone ?? '').trim();
      const wlId = c.team.whiteLabelId;
      if (!telefono || !wlId) continue;

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
          message: `Hola${c.lead?.name ? ` ${c.lead.name.split(' ')[0]}` : ''}, te recordamos tu cita de hoy a las ${hora} con ${c.team.name}.`,
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
