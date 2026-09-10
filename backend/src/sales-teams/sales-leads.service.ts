import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  phoneKeyOf,
  emailNormOf,
  decideContactMatch,
} from '../marketing/identity';
import {
  exigirEscritura,
  resolveTeamAccess,
  type AccesoAlEquipo,
} from './team-access';
import { asegurarColumnas } from './sales-columnas';

/**
 * El CRM de un equipo de ventas de marca — fase 3.
 *
 * POR QUÉ NO SE REUTILIZÓ EL CRM DE AFILIADOS
 * -------------------------------------------
 * Media especificación ya estaba construida (`CrmContact`, `Pipeline`,
 * `Stage`), pero para AFILIADOS, y hay tres razones duras en el esquema:
 *
 * 1. `CrmContact.ownerUserId` es NOT NULL con `onDelete: Cascade`, y en este
 *    producto los usuarios se borran EN DURO: al irse un vendedor se llevaría
 *    los leads del equipo por delante.
 * 2. `Pipeline.ownerUserId` es `@unique` NOT NULL. Un embudo de equipo obliga
 *    a levantar esa restricción en una tabla viva del CRM de Jhon.
 * 3. `MktContact` tiene índices únicos parciales por marca —UNA fila por
 *    persona—, así que la misma persona en dos equipos los rompe.
 *
 * De ahí `SalesLead`: tablas propias, `assignedUserId` con `SetNull`, y enlace
 * a `MktContact` por id y SIN clave foránea (ese modelo no declara
 * relaciones). Eso da gratis la identidad por teléfono, el opt-out y la puerta
 * a las automatizaciones.
 *
 * NINGUNA tabla `Sales*` lleva un campo llamado `tenantId`, y es a propósito:
 * el middleware de Prisma inyecta `where.tenantId` en CUALQUIER modelo que
 * tenga ese campo, leyéndolo del DMMF. Un equipo es de una MARCA, no de un
 * negocio; con ese nombre quedaría filtrado por un negocio que no existe y las
 * consultas volverían vacías.
 *
 * Todo método empieza por `resolveTeamAccess`: el aislamiento entre marcas se
 * escribe a mano en cada consulta y no hay red debajo.
 */

/** Cuántos leads devuelve el tablero de una vez. */
const TOPE_LEADS = 2000;

export interface DatosDeLead {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  company?: string | null;
  source?: string | null;
  value?: number | null;
  tags?: string[];
  assignedUserId?: string | null;
  stageId?: string | null;
  lostReason?: string | null;
}

@Injectable()
export class SalesLeadsService {
  private logger = new Logger(SalesLeadsService.name);

  constructor(private prisma: PrismaService) {}

  // ── Columnas ────────────────────────────────────────────────────────────

  /** Las columnas del equipo, sembrándolas si es la primera vez. */
  private columnasDe(salesTeamId: string) {
    return asegurarColumnas(this.prisma, salesTeamId);
  }

  /** La columna, comprobando que es de ESTE equipo. */
  private async columnaDelEquipo(salesTeamId: string, stageId: string) {
    const s = await this.prisma.salesStage.findFirst({
      where: { id: stageId, salesTeamId },
    });
    if (!s) throw new NotFoundException('Columna no encontrada');
    return s;
  }

  async tablero(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const columnas = await this.columnasDe(teamId);
    const leads = await this.prisma.salesLead.findMany({
      where: { salesTeamId: teamId },
      orderBy: { lastActivityAt: 'desc' },
      take: TOPE_LEADS,
      include: {
        assignedUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    const total = await this.prisma.salesLead.count({
      where: { salesTeamId: teamId },
    });
    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      esAdminDeMarca: acceso.esAdminDeMarca,
      misRoles: acceso.roles,
      columnas,
      leads: leads.map((l) => this.paraElPanel(l)),
      // El tablero no pagina. Si algún día un equipo pasa del tope, que se vea
      // en la pantalla en vez de perder leads en silencio — que es lo que le
      // pasó a la lista de clientes con su tope de 100.
      total,
      truncado: total > leads.length,
    };
  }

  async crearColumna(
    user: AuthUser,
    teamId: string,
    body: { name: string; color?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('Ponle nombre a la columna.');
    await this.columnasDe(teamId);
    const ultima = await this.prisma.salesStage.findFirst({
      where: { salesTeamId: teamId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return this.prisma.salesStage.create({
      data: {
        salesTeamId: teamId,
        name,
        kind: 'CUSTOM',
        color: body.color ?? null,
        position: (ultima?.position ?? -1) + 1,
      },
    });
  }

  async editarColumna(
    user: AuthUser,
    teamId: string,
    stageId: string,
    body: { name?: string; color?: string | null; position?: number },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    await this.columnaDelEquipo(teamId, stageId);
    return this.prisma.salesStage.update({
      where: { id: stageId },
      data: {
        name: body.name?.trim() || undefined,
        color: body.color === undefined ? undefined : body.color,
        position: body.position,
      },
    });
  }

  /**
   * Borra una columna moviendo sus leads a la primera.
   *
   * `SalesStage` tiene `onDelete: Restrict` desde `SalesLead` a propósito: sin
   * eso, borrar una columna se llevaría los leads por delante. Aquí se mueven
   * primero, dentro de la misma transacción.
   */
  async borrarColumna(user: AuthUser, teamId: string, stageId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const columnas = await this.columnasDe(teamId);
    if (columnas.length <= 1) {
      throw new BadRequestException(
        'Un tablero sin columnas no sirve para nada. Deja al menos una.',
      );
    }
    await this.columnaDelEquipo(teamId, stageId);
    const destino = columnas.find((c) => c.id !== stageId)!;

    await this.prisma.$transaction(async (tx) => {
      await tx.salesLead.updateMany({
        where: { salesTeamId: teamId, stageId },
        data: { stageId: destino.id },
      });
      await tx.salesStage.delete({ where: { id: stageId } });
    });
    return { ok: true, movidosA: destino.id };
  }

  // ── Leads ───────────────────────────────────────────────────────────────

  private paraElPanel(l: {
    id: string;
    stageId: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    instagram: string | null;
    company: string | null;
    source: string | null;
    value: unknown;
    tags: string[];
    lostReason: string | null;
    wonAt: Date | null;
    assignedUserId: string | null;
    assignedUser?: { id: string; fullName: string | null; email: string } | null;
    lastActivityAt: Date;
    createdAt: Date;
  }) {
    return {
      id: l.id,
      stageId: l.stageId,
      name: l.name,
      phone: l.phone,
      email: l.email,
      instagram: l.instagram,
      company: l.company,
      source: l.source,
      value: l.value == null ? null : Number(l.value),
      tags: l.tags ?? [],
      lostReason: l.lostReason,
      wonAt: l.wonAt,
      assignedUserId: l.assignedUserId,
      assignedTo:
        l.assignedUser?.fullName?.trim() || l.assignedUser?.email || null,
      lastActivityAt: l.lastActivityAt,
      createdAt: l.createdAt,
    };
  }

  /**
   * Alta de lead.
   *
   * Si ya hay uno con el mismo teléfono EN ESTE EQUIPO, no se crea otro: se
   * devuelve el que había, marcado con `yaExistia`. Dos vendedores metiendo al
   * mismo prospecto es la forma más rápida de que dos personas lo llamen el
   * mismo día, y el índice `[whiteLabelId, phoneKey]` no es único —a propósito,
   * porque dos equipos SÍ pueden trabajar a la misma persona—.
   */
  async crearLead(user: AuthUser, teamId: string, body: DatosDeLead) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const columnas = await this.columnasDe(teamId);

    const stageId = body.stageId
      ? (await this.columnaDelEquipo(teamId, body.stageId)).id
      : columnas[0].id;

    const phoneKey = phoneKeyOf(body.phone);
    if (phoneKey) {
      const repetido = await this.prisma.salesLead.findFirst({
        where: { salesTeamId: teamId, phoneKey },
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
        },
      });
      if (repetido) {
        return { ...this.paraElPanel(repetido), yaExistia: true };
      }
    }

    await this.exigirVendedorDelEquipo(teamId, body.assignedUserId);

    const lead = await this.prisma.salesLead.create({
      data: {
        salesTeamId: teamId,
        whiteLabelId: acceso.team.whiteLabelId,
        stageId,
        name: (body.name ?? '').trim() || null,
        phone: (body.phone ?? '').trim() || null,
        phoneKey,
        email: emailNormOf(body.email),
        instagram: (body.instagram ?? '').trim() || null,
        company: (body.company ?? '').trim() || null,
        source: (body.source ?? '').trim() || null,
        value: body.value ?? null,
        tags: body.tags ?? [],
        assignedUserId: body.assignedUserId ?? null,
        createdByUserId: user.id,
        // El contacto de marketing equivalente, si esa persona ya está en la
        // marca. Sin él, las automatizaciones no tienen a quién escribirle.
        mktContactId: await this.mktContactDe(acceso, body.phone, body.email),
      },
      include: {
        assignedUser: { select: { id: true, fullName: true, email: true } },
      },
    });

    await this.anotar(lead.id, teamId, user.id, 'sistema', 'Lead creado');
    return { ...this.paraElPanel(lead), yaExistia: false };
  }

  /**
   * El `MktContact` de esa persona en ESTA marca, si ya existe. Nunca de otra.
   *
   * NO se casa por `phoneKey` a secas. Ese campo es un BUCKET de candidatos —lo
   * dice su propio comentario en el esquema—: son los últimos 10 dígitos, y São
   * Paulo y Río caen en el mismo cubo siendo personas distintas. Quien decide
   * es `decideContactMatch`, que es el único sitio del producto que decide
   * identidad. Enlazar mal aquí significaría escribirle a otra persona.
   *
   * Best-effort: sin contacto, el lead vive igual; lo que no tiene es puerta a
   * las automatizaciones hasta que esa persona entre en la marca.
   */
  private async mktContactDe(
    acceso: AccesoAlEquipo,
    telefono: string | null | undefined,
    email?: string | null,
  ): Promise<string | null> {
    const wlId = acceso.team.whiteLabelId;
    if (!wlId) return null;
    const phoneKey = phoneKeyOf(telefono);
    const emailNorm = emailNormOf(email);
    if (!phoneKey && !emailNorm) return null;
    try {
      const candidatos = await this.prisma.mktContact.findMany({
        where: {
          whiteLabelId: wlId,
          OR: [
            ...(phoneKey ? [{ phoneKey }] : []),
            ...(emailNorm ? [{ email: emailNorm }] : []),
          ],
        },
        select: {
          id: true,
          email: true,
          phone: true,
          phoneKey: true,
          phoneNorm: true,
          deleted: true,
        },
        take: 25,
      });
      const veredicto = decideContactMatch(candidatos, {
        phone: telefono ?? null,
        email: emailNorm,
      });
      // Solo se enlaza a una ficha VIVA. Una borrada se reactiva en el flujo de
      // marketing, no aquí de tapadillo.
      return veredicto.action === 'reuse' ? veredicto.match.id : null;
    } catch {
      return null;
    }
  }

  /** Un lead solo se asigna a alguien que esté EN el equipo. */
  private async exigirVendedorDelEquipo(
    teamId: string,
    userId?: string | null,
  ) {
    if (!userId) return;
    const m = await this.prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { isActive: true },
    });
    if (!m?.isActive) {
      throw new BadRequestException(
        'Esa persona no está en el equipo. Añádela antes de asignarle leads.',
      );
    }
  }

  private async leadDelEquipo(teamId: string, leadId: string) {
    const l = await this.prisma.salesLead.findFirst({
      where: { id: leadId, salesTeamId: teamId },
      include: {
        assignedUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!l) throw new NotFoundException('Lead no encontrado');
    return l;
  }

  async verLead(user: AuthUser, teamId: string, leadId: string) {
    await resolveTeamAccess(this.prisma, user, teamId);
    const lead = await this.leadDelEquipo(teamId, leadId);
    const actividades = await this.prisma.salesLeadActivity.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { ...this.paraElPanel(lead), actividades };
  }

  async editarLead(
    user: AuthUser,
    teamId: string,
    leadId: string,
    body: DatosDeLead,
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    await this.leadDelEquipo(teamId, leadId);
    if (body.assignedUserId !== undefined) {
      await this.exigirVendedorDelEquipo(teamId, body.assignedUserId);
    }
    const phone = body.phone === undefined ? undefined : (body.phone ?? '').trim() || null;

    const lead = await this.prisma.salesLead.update({
      where: { id: leadId },
      data: {
        name: body.name === undefined ? undefined : (body.name ?? '').trim() || null,
        phone,
        // La clave se recalcula SIEMPRE que cambie el teléfono, incluso al
        // borrarlo: dejarla colgada haría que el lead siguiera casando con
        // alguien que ya no es.
        phoneKey: phone === undefined ? undefined : phoneKeyOf(phone),
        email: body.email === undefined ? undefined : emailNormOf(body.email),
        instagram:
          body.instagram === undefined ? undefined : (body.instagram ?? '').trim() || null,
        company:
          body.company === undefined ? undefined : (body.company ?? '').trim() || null,
        source: body.source === undefined ? undefined : (body.source ?? '').trim() || null,
        value: body.value === undefined ? undefined : body.value,
        tags: body.tags === undefined ? undefined : body.tags,
        assignedUserId:
          body.assignedUserId === undefined ? undefined : body.assignedUserId,
        lastActivityAt: new Date(),
      },
      include: {
        assignedUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    return this.paraElPanel(lead);
  }

  /**
   * Mueve el lead de columna.
   *
   * El `updateMany` es CONDICIONAL sobre la columna de origen: si otro vendedor
   * lo movió mientras este arrastraba la tarjeta, `count` es 0 y no se pisa su
   * cambio. Sin eso, el que suelta último gana, y el primero no se entera de
   * que su movimiento desapareció.
   *
   * `stageIdActual` es opcional para no romper a quien llame sin él; cuando
   * viene, protege.
   */
  async moverLead(
    user: AuthUser,
    teamId: string,
    leadId: string,
    stageId: string,
    stageIdActual?: string | null,
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const antes = await this.leadDelEquipo(teamId, leadId);
    const destino = await this.columnaDelEquipo(teamId, stageId);
    if (antes.stageId === destino.id) return this.paraElPanel(antes);

    const movido = await this.prisma.salesLead.updateMany({
      where: {
        id: leadId,
        salesTeamId: teamId,
        ...(stageIdActual ? { stageId: stageIdActual } : {}),
      },
      data: {
        stageId: destino.id,
        lastActivityAt: new Date(),
        // Ganado se sella al entrar en la columna de clientes, y NO se borra al
        // salir: la fecha en que se cerró es un hecho, aunque luego se mueva.
        ...(destino.kind === 'CLIENT' && !antes.wonAt ? { wonAt: new Date() } : {}),
      },
    });
    if (movido.count === 0) {
      const ahora = await this.leadDelEquipo(teamId, leadId);
      return { ...this.paraElPanel(ahora), sinCambios: true };
    }

    const origen = await this.prisma.salesStage.findUnique({
      where: { id: antes.stageId },
      select: { name: true },
    });
    await this.anotar(
      leadId,
      teamId,
      user.id,
      'etapa',
      `${origen?.name ?? 'Sin columna'} → ${destino.name}`,
    );
    return this.paraElPanel(await this.leadDelEquipo(teamId, leadId));
  }

  async borrarLead(user: AuthUser, teamId: string, leadId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    await this.leadDelEquipo(teamId, leadId);
    await this.prisma.salesLead.delete({ where: { id: leadId } });
    return { ok: true };
  }

  // ── Actividad ───────────────────────────────────────────────────────────

  async anotarNota(
    user: AuthUser,
    teamId: string,
    leadId: string,
    body: { body: string; kind?: string },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    await this.leadDelEquipo(teamId, leadId);
    const texto = (body.body ?? '').trim();
    if (!texto) throw new BadRequestException('La nota está vacía.');
    const kind = ['nota', 'llamada', 'mensaje', 'cita'].includes(body.kind ?? '')
      ? (body.kind as string)
      : 'nota';
    const a = await this.anotar(leadId, teamId, user.id, kind, texto);
    // Anotar ES actividad: sin esto el lead parecía abandonado en el tablero
    // aunque el vendedor lo estuviera trabajando a diario.
    await this.prisma.salesLead.update({
      where: { id: leadId },
      data: { lastActivityAt: new Date() },
    });
    return a;
  }

  /** Deja rastro. Best-effort: que falle el registro no tumba la operación. */
  private async anotar(
    leadId: string,
    salesTeamId: string,
    userId: string | null,
    kind: string,
    body: string,
  ) {
    return this.prisma.salesLeadActivity
      .create({
        data: { leadId, salesTeamId, userId, kind, body },
      })
      .catch((e) => {
        this.logger.warn(
          `no se pudo anotar la actividad del lead ${leadId}: ${(e as Error).message}`,
        );
        return null;
      });
  }
}
