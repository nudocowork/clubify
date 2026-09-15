import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  exigirEscritura,
  resolveTeamAccess,
  type AccesoAlEquipo,
} from './team-access';
import { asegurarColumnas } from './sales-columnas';
import { SalesLeadsService } from './sales-leads.service';
import {
  EMBUDOS_INICIALES,
  ETAPAS_DE_EMBUDO_NUEVO,
  datosDeEstado,
  esEstadoDeOportunidad,
  normalizarValor,
  ordenTrasSoltar,
  whereDeOportunidades,
  type FiltrosDeCrm,
} from './crm-de-equipo';

/**
 * «CRM» del equipo: embudos de OPORTUNIDADES, como en TeamClubify.
 *
 * El CRM era el tablero de leads. Javier eligió (2026-09-14) traer el de la
 * referencia tal cual: varios embudos por equipo, y en cada uno oportunidades
 * con contacto, valor, responsable y estado. Un contacto puede tener varias.
 * El tablero de leads sigue siendo la pestaña «Leads»: Banco, Seguimientos,
 * Clientes y la reserva pública dependen de sus columnas, y esto no las toca.
 *
 * El único punto de contacto entre los dos: GANAR una oportunidad es cerrar una
 * venta, y el lead pasa a su columna de clientes por `moverLead`.
 *
 * Todo método empieza por `resolveTeamAccess`. Las reglas puras viven en
 * `crm-de-equipo.ts`.
 */

/** Tope de tarjetas por embudo. Los totales se calculan en la base y no lo sufren. */
const TOPE = 1000;

const INCLUIR = {
  lead: { select: { id: true, name: true, company: true, phone: true } },
} as const;
type OportunidadConLead = Prisma.SalesOpportunityGetPayload<{ include: typeof INCLUIR }>;

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const dinero = (n: number) => `$${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
const ETIQUETA_DE_ESTADO: Record<string, string> = {
  abierta: 'reabierta',
  ganada: 'ganada',
  perdida: 'perdida',
  abandonada: 'abandonada',
};

@Injectable()
export class CrmDeEquipoService {
  constructor(
    private prisma: PrismaService,
    private leads: SalesLeadsService,
  ) {}

  /**
   * Cambiar la forma de los embudos (crearlos, borrarlos, tocar sus etapas) y
   * borrar oportunidades es del líder o un admin de la marca, como borrar en
   * Contactos y Seguimientos. Crear, mover y cerrar oportunidades, de cualquiera
   * que escriba.
   */
  private puedeConfigurar(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  private exigirConfigurar(acceso: AccesoAlEquipo, que: string) {
    if (!this.puedeConfigurar(acceso)) {
      throw new ForbiddenException(`Solo el líder del equipo o un admin de la marca pueden ${que}`);
    }
  }

  // ── Lectura ───────────────────────────────────────────────────────────────

  async tablero(user: AuthUser, teamId: string, raw: FiltrosDeCrm & { embudo?: string }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const embudos = await this.asegurarEmbudos(teamId, acceso.team.whiteLabelId);
    const embudo = embudos.find((e) => e.id === raw.embudo) ?? embudos[0];
    const filtros: FiltrosDeCrm = {
      responsable: texto(raw.responsable, 60) || undefined,
      estado: texto(raw.estado, 20) || undefined,
      q: texto(raw.q, 120) || undefined,
    };
    const where = whereDeOportunidades(teamId, embudo.id, filtros);

    const [etapas, filas, total, porEtapa, abierto, miembros] = await Promise.all([
      this.prisma.salesPipelineStage.findMany({
        where: { pipelineId: embudo.id, salesTeamId: teamId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.salesOpportunity.findMany({
        where,
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        take: TOPE,
        include: INCLUIR,
      }),
      this.prisma.salesOpportunity.count({ where }),
      // Los totales en la base, no sumando lo cargado: con el tope, sumar en
      // memoria daría cifras que parecen reales y no lo son.
      this.prisma.salesOpportunity.groupBy({
        by: ['stageId'],
        where,
        _count: { _all: true },
        _sum: { value: true },
      }),
      this.prisma.salesOpportunity.aggregate({
        where: { AND: [where, { status: 'abierta' }] },
        _sum: { value: true },
      }),
      this.miembros(teamId),
    ]);

    const nombre = new Map(miembros.map((m) => [m.userId, m.user?.fullName ?? 'Sin nombre']));
    const totales = new Map(
      porEtapa.map((g) => [g.stageId, { cuantas: g._count._all, valor: Number(g._sum.value ?? 0) }]),
    );

    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeConfigurar: this.puedeConfigurar(acceso),
      filtros,
      embudos: embudos.map((e) => ({ id: e.id, nombre: e.name })),
      embudo: { id: embudo.id, nombre: embudo.name },
      etapas: etapas.map((s) => ({
        id: s.id,
        nombre: s.name,
        color: s.color,
        cuantas: totales.get(s.id)?.cuantas ?? 0,
        valor: totales.get(s.id)?.valor ?? 0,
      })),
      abierto: Number(abierto._sum.value ?? 0),
      total,
      truncado: total > filas.length,
      responsables: miembros
        .filter((m) => m.isActive)
        .map((m) => ({ id: m.userId, nombre: m.user?.fullName ?? 'Sin nombre' }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      oportunidades: filas.map((o) => this.paraElPanel(o, nombre)),
    };
  }

  // ── Embudos ───────────────────────────────────────────────────────────────

  async crearEmbudo(user: AuthUser, teamId: string, body: { nombre?: string }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'crear embudos');
    const nombre = texto(body.nombre, 60);
    if (!nombre) throw new BadRequestException('Ponle nombre al embudo');
    await this.asegurarEmbudos(teamId, acceso.team.whiteLabelId);
    const ultimo = await this.prisma.salesPipeline.findFirst({
      where: { salesTeamId: teamId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const embudo = await this.prisma.$transaction(async (tx) => {
      const e = await tx.salesPipeline.create({
        data: {
          salesTeamId: teamId,
          whiteLabelId: acceso.team.whiteLabelId,
          name: nombre,
          position: (ultimo?.position ?? -1) + 1,
        },
      });
      await tx.salesPipelineStage.createMany({
        data: ETAPAS_DE_EMBUDO_NUEVO.map((s, i) => ({
          pipelineId: e.id,
          salesTeamId: teamId,
          name: s.nombre,
          color: s.color,
          position: i,
        })),
      });
      return e;
    });
    return { id: embudo.id, nombre: embudo.name };
  }

  async renombrarEmbudo(user: AuthUser, teamId: string, embudoId: string, body: { nombre?: string }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'renombrar embudos');
    const nombre = texto(body.nombre, 60);
    if (!nombre) throw new BadRequestException('Ponle nombre al embudo');
    const r = await this.prisma.salesPipeline.updateMany({
      where: { id: embudoId, salesTeamId: teamId },
      data: { name: nombre },
    });
    if (!r.count) throw new NotFoundException('Embudo no encontrado');
    return { ok: true };
  }

  /** Borra el embudo con sus etapas y sus oportunidades. Los contactos se quedan. */
  async borrarEmbudo(user: AuthUser, teamId: string, embudoId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'eliminar embudos');
    await this.embudoDelEquipo(teamId, embudoId);
    // Sin embudos, la próxima visita volvería a sembrar los de la referencia:
    // mejor decirlo que sorprender con dos embudos que nadie creó.
    const cuantos = await this.prisma.salesPipeline.count({ where: { salesTeamId: teamId } });
    if (cuantos <= 1) throw new BadRequestException('El equipo necesita al menos un embudo');
    const r = await this.prisma.salesPipeline.deleteMany({ where: { id: embudoId, salesTeamId: teamId } });
    if (!r.count) throw new NotFoundException('Embudo no encontrado');
    return { ok: true };
  }

  // ── Etapas ────────────────────────────────────────────────────────────────

  async crearEtapa(
    user: AuthUser,
    teamId: string,
    embudoId: string,
    body: { nombre?: string; color?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'cambiar las etapas');
    await this.embudoDelEquipo(teamId, embudoId);
    const nombre = texto(body.nombre, 40);
    if (!nombre) throw new BadRequestException('Ponle nombre a la etapa');
    const ultima = await this.prisma.salesPipelineStage.findFirst({
      where: { pipelineId: embudoId, salesTeamId: teamId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const s = await this.prisma.salesPipelineStage.create({
      data: {
        pipelineId: embudoId,
        salesTeamId: teamId,
        name: nombre,
        color: texto(body.color, 9) || null,
        position: (ultima?.position ?? -1) + 1,
      },
    });
    return { id: s.id, nombre: s.name, color: s.color };
  }

  async editarEtapa(
    user: AuthUser,
    teamId: string,
    etapaId: string,
    body: { nombre?: string; color?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'cambiar las etapas');
    const data: Prisma.SalesPipelineStageUpdateManyMutationInput = {};
    if (body.nombre !== undefined) {
      const nombre = texto(body.nombre, 40);
      if (!nombre) throw new BadRequestException('La etapa necesita un nombre');
      data.name = nombre;
    }
    if (body.color !== undefined) data.color = texto(body.color, 9) || null;
    const r = await this.prisma.salesPipelineStage.updateMany({
      where: { id: etapaId, salesTeamId: teamId },
      data,
    });
    if (!r.count) throw new NotFoundException('Etapa no encontrada');
    return { ok: true };
  }

  async ordenarEtapas(user: AuthUser, teamId: string, embudoId: string, body: { ids?: string[] }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'cambiar las etapas');
    const actuales = await this.prisma.salesPipelineStage.findMany({
      where: { pipelineId: embudoId, salesTeamId: teamId },
      select: { id: true },
    });
    const validas = new Set(actuales.map((a) => a.id));
    const ids = [...new Set(body.ids ?? [])].filter((id) => validas.has(id));
    // La lista tiene que ser EXACTAMENTE la del embudo: si alguien añadió o borró
    // una etapa mientras tanto, reordenar con la lista vieja dejaría huecos.
    if (!actuales.length || ids.length !== validas.size) {
      throw new BadRequestException('Las etapas cambiaron mientras tanto. Recarga y vuelve a ordenar.');
    }
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.salesPipelineStage.updateMany({
          where: { id, salesTeamId: teamId },
          data: { position: i },
        }),
      ),
    );
    return { ok: true };
  }

  async borrarEtapa(user: AuthUser, teamId: string, etapaId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'cambiar las etapas');
    const etapa = await this.etapaDelEquipo(teamId, etapaId);
    const [dentro, restantes] = await Promise.all([
      this.prisma.salesOpportunity.count({ where: { stageId: etapaId, salesTeamId: teamId } }),
      this.prisma.salesPipelineStage.count({ where: { pipelineId: etapa.pipelineId, salesTeamId: teamId } }),
    ]);
    if (dentro > 0) {
      throw new BadRequestException(`La etapa tiene ${dentro} oportunidad(es). Muévelas antes de borrarla.`);
    }
    if (restantes <= 1) throw new BadRequestException('Un embudo necesita al menos una etapa');
    try {
      await this.prisma.salesPipelineStage.deleteMany({ where: { id: etapaId, salesTeamId: teamId } });
    } catch (e) {
      // Alguien metió una oportunidad entre el conteo y el borrado: la clave
      // foránea lo frena, y se dice lo mismo que si ya estuviera dentro.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new BadRequestException('La etapa tiene oportunidades. Muévelas antes de borrarla.');
      }
      throw e;
    }
    return { ok: true };
  }

  // ── Oportunidades ─────────────────────────────────────────────────────────

  async crearOportunidad(
    user: AuthUser,
    teamId: string,
    body: {
      embudoId?: string;
      etapaId?: string;
      nombre?: string;
      valor?: number | null;
      responsableId?: string | null;
      leadId?: string;
      contactoNombre?: string;
      contactoTelefono?: string;
    },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const etapa = await this.etapaDelEquipo(teamId, body.etapaId ?? '');
    if (body.embudoId && etapa.pipelineId !== body.embudoId) {
      throw new BadRequestException('Esa etapa no es de ese embudo');
    }
    const embudo = await this.embudoDelEquipo(teamId, etapa.pipelineId);
    const valor = normalizarValor(body.valor);
    if (typeof valor !== 'number') throw new BadRequestException(valor.error);
    await this.exigirMiembroActivo(teamId, body.responsableId);

    let lead: { id: string; name: string | null };
    if (body.leadId) {
      const l = await this.prisma.salesLead.findFirst({
        where: { id: body.leadId, salesTeamId: teamId },
        select: { id: true, name: true },
      });
      if (!l) throw new NotFoundException('Contacto no encontrado');
      lead = l;
    } else {
      const nombreC = texto(body.contactoNombre, 120);
      const telefono = texto(body.contactoTelefono, 40);
      if (!nombreC && !telefono) {
        throw new BadRequestException('Elige un contacto o escribe su nombre o teléfono');
      }
      // Por la puerta del tablero de leads: deduplica por teléfono, enlaza el
      // contacto de marketing y dispara `sales_lead_created`. Crearlo a mano
      // aquí sería una segunda copia de esa regla.
      const l = await this.leads.crearLead(user, teamId, {
        name: nombreC || null,
        phone: telefono || null,
      });
      lead = { id: l.id, name: l.name };
    }

    const nombre = texto(body.nombre, 120) || lead.name || 'Oportunidad';
    const ultima = await this.prisma.salesOpportunity.findFirst({
      where: { stageId: etapa.id, salesTeamId: teamId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const o = await this.prisma.salesOpportunity.create({
      data: {
        salesTeamId: teamId,
        whiteLabelId: acceso.team.whiteLabelId,
        pipelineId: etapa.pipelineId,
        stageId: etapa.id,
        leadId: lead.id,
        name: nombre,
        value: valor,
        source: 'manual',
        assignedUserId: body.responsableId || null,
        position: (ultima?.position ?? -1) + 1,
        createdByUserId: user.id,
      },
      include: INCLUIR,
    });
    await this.anotar(
      lead.id,
      teamId,
      user.id,
      `Oportunidad «${nombre}» abierta en «${embudo.name}» · ${dinero(valor)}`,
    );
    const miembros = await this.miembros(teamId);
    return this.paraElPanel(o, new Map(miembros.map((m) => [m.userId, m.user?.fullName ?? 'Sin nombre'])));
  }

  async editarOportunidad(
    user: AuthUser,
    teamId: string,
    id: string,
    body: { nombre?: string; valor?: number | null; responsableId?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const o = await this.oportunidadDelEquipo(teamId, id);
    const data: Prisma.SalesOpportunityUpdateManyMutationInput = {};
    if (body.nombre !== undefined) {
      const nombre = texto(body.nombre, 120);
      if (!nombre) throw new BadRequestException('La oportunidad necesita un nombre');
      data.name = nombre;
    }
    let valor: number | undefined;
    if (body.valor !== undefined) {
      const v = normalizarValor(body.valor);
      if (typeof v !== 'number') throw new BadRequestException(v.error);
      valor = v;
      data.value = v;
    }
    if (body.responsableId !== undefined) {
      await this.exigirMiembroActivo(teamId, body.responsableId);
      data.assignedUserId = body.responsableId || null;
    }
    await this.prisma.salesOpportunity.updateMany({ where: { id, salesTeamId: teamId }, data });
    // Ya ganada y con otro valor: el lead lleva el valor de la venta, que es lo
    // que suma «Ventas del mes». Sin esto había que reabrir y volver a ganar
    // para corregir un monto (lo mismo hace la referencia).
    if (valor !== undefined && o.status === 'ganada' && valor !== Number(o.value)) {
      await this.prisma.salesLead.updateMany({
        where: { id: o.leadId, salesTeamId: teamId },
        data: { value: valor },
      });
    }
    return { ok: true };
  }

  /**
   * Mueve una tarjeta a una etapa y posición.
   *
   * Contra la etapa en la que la persona CREÍA que estaba: si otra la movió
   * antes, no se pisa su cambio y se devuelve `sinCambios`, igual que el
   * tablero de leads. El orden de la columna destino se reescribe de una vez.
   */
  async moverOportunidad(
    user: AuthUser,
    teamId: string,
    id: string,
    body: {
      etapaId?: string;
      posicion?: number;
      antesDeId?: string | null;
      etapaActualId?: string | null;
    },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const o = await this.oportunidadDelEquipo(teamId, id);
    const destino = await this.etapaDelEquipo(teamId, body.etapaId ?? '');
    if (destino.pipelineId !== o.pipelineId) {
      throw new BadRequestException('Esa etapa es de otro embudo');
    }
    // Soltarla sobre sí misma no es moverla.
    if (body.antesDeId === id && o.stageId === destino.id) return { ok: true };

    const movida = await this.prisma.$transaction(async (tx) => {
      const r = await tx.salesOpportunity.updateMany({
        where: {
          id,
          salesTeamId: teamId,
          ...(body.etapaActualId ? { stageId: body.etapaActualId } : {}),
        },
        data: { stageId: destino.id },
      });
      if (!r.count) return false;
      const columna = await tx.salesOpportunity.findMany({
        where: { stageId: destino.id, salesTeamId: teamId },
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        select: { id: true },
      });
      const ids = columna.map((c) => c.id);
      // Antes de QUÉ tarjeta se soltó, por id y no por índice: con un filtro
      // puesto la pantalla solo ve parte de la columna, y su índice no es el de
      // la columna entera (Fable, 2026-09-14). Sin tarjeta de referencia, la
      // posición que llegue; sin nada, al final.
      const resto = ids.filter((x) => x !== id);
      const antes = body.antesDeId ? resto.indexOf(body.antesDeId) : -1;
      const orden = ordenTrasSoltar(ids, id, antes >= 0 ? antes : (body.posicion ?? resto.length));
      // Una sola sentencia para toda la columna: con cien tarjetas, cien
      // `update` dentro de la transacción rozan su tiempo máximo.
      await tx.$executeRawUnsafe(
        `UPDATE "SalesOpportunity" AS o SET "position" = v.pos
           FROM unnest($1::text[], $2::int[]) AS v(id, pos)
          WHERE o."id" = v.id AND o."salesTeamId" = $3`,
        orden,
        orden.map((_, i) => i),
        teamId,
      );
      return true;
    });
    if (!movida) return { sinCambios: true };

    if (o.stageId !== destino.id) {
      const origen = await this.prisma.salesPipelineStage.findUnique({
        where: { id: o.stageId },
        select: { name: true },
      });
      await this.anotar(
        o.leadId,
        teamId,
        user.id,
        `Oportunidad «${o.name}»: ${origen?.name ?? 'otra etapa'} → ${destino.name}`,
      );
    }
    return { ok: true };
  }

  /**
   * Cambia el estado de una oportunidad.
   *
   * Compare-and-set contra el estado leído: dos personas cambiándolo a la vez no
   * se pisan, y la segunda recibe un aviso en vez de un estado que no eligió.
   *
   * GANAR es cerrar una venta: el lead lleva el valor y pasa a su columna de
   * clientes por `moverLead` —la misma puerta del tablero, que sella la venta,
   * dispara `sales_lead_won` y arranca la implementación—. Si eso falla, la
   * oportunidad vuelve a su estado anterior en vez de quedar «ganada» sin venta.
   * Reabrirla NO deshace la venta del lead: la fecha en que se cerró es un hecho.
   */
  async cambiarEstado(
    user: AuthUser,
    teamId: string,
    id: string,
    body: { estado?: string; motivo?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    if (!esEstadoDeOportunidad(body.estado)) throw new BadRequestException('Estado no válido');
    const estado = body.estado;
    const o = await this.oportunidadDelEquipo(teamId, id);
    if (o.status === estado) return { ok: true, sinCambios: true };

    const r = await this.prisma.salesOpportunity.updateMany({
      where: { id, salesTeamId: teamId, status: o.status },
      data: datosDeEstado(estado, body.motivo, new Date()),
    });
    if (!r.count) {
      throw new BadRequestException('Otra persona cambió el estado de esta oportunidad. Recarga el tablero.');
    }

    if (estado === 'ganada') {
      try {
        const columnas = await asegurarColumnas(this.prisma, teamId);
        const clientes = columnas.find((c) => c.kind === 'CLIENT');
        // Sin columna de clientes no hay dónde cerrar la venta: se dice, y la
        // compensación de abajo devuelve la oportunidad a su estado. Seguir en
        // silencio la dejaba «ganada» sin venta, sin implementación y sin
        // `sales_lead_won` (Fable, 2026-09-14).
        if (!clientes) {
          throw new BadRequestException(
            'El tablero de Leads ya no tiene la columna de clientes, así que no hay dónde cerrar la venta',
          );
        }
        const valor = Number(o.value);
        if (valor > 0) {
          await this.prisma.salesLead.updateMany({
            where: { id: o.leadId, salesTeamId: teamId },
            data: { value: valor },
          });
        }
        await this.leads.moverLead(user, teamId, o.leadId, clientes.id);
      } catch (e) {
        await this.prisma.salesOpportunity
          .updateMany({
            where: { id, salesTeamId: teamId, status: 'ganada' },
            data: { status: o.status, wonAt: o.wonAt, lostAt: o.lostAt, lostReason: o.lostReason },
          })
          .catch(() => null);
        throw e;
      }
    }

    const motivo = estado === 'perdida' || estado === 'abandonada' ? texto(body.motivo, 200) : '';
    await this.anotar(
      o.leadId,
      teamId,
      user.id,
      `Oportunidad «${o.name}» ${ETIQUETA_DE_ESTADO[estado]}` +
        (estado === 'ganada' ? ` · ${dinero(Number(o.value))}` : '') +
        (motivo ? ` · motivo: ${motivo}` : ''),
    );
    return { ok: true };
  }

  async borrarOportunidad(user: AuthUser, teamId: string, id: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso, 'eliminar oportunidades');
    const r = await this.prisma.salesOpportunity.deleteMany({ where: { id, salesTeamId: teamId } });
    if (!r.count) throw new NotFoundException('Oportunidad no encontrada');
    return { ok: true };
  }

  // ── Ayudas ────────────────────────────────────────────────────────────────

  /**
   * Los embudos del equipo, sembrando los de la referencia la primera vez.
   *
   * Con un candado de Postgres por equipo: dos personas abriendo el CRM a la vez
   * por primera vez contarían cero las dos y sembrarían dos juegos. Con el
   * candado, la segunda espera y ya encuentra los de la primera.
   */
  private async asegurarEmbudos(teamId: string, whiteLabelId: string | null) {
    const leer = () =>
      this.prisma.salesPipeline.findMany({
        where: { salesTeamId: teamId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
    const hay = await leer();
    if (hay.length) return hay;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `crm-embudos:${teamId}`);
      if (await tx.salesPipeline.count({ where: { salesTeamId: teamId } })) return;
      for (let i = 0; i < EMBUDOS_INICIALES.length; i++) {
        const inicial = EMBUDOS_INICIALES[i];
        const e = await tx.salesPipeline.create({
          data: { salesTeamId: teamId, whiteLabelId, name: inicial.nombre, position: i },
        });
        await tx.salesPipelineStage.createMany({
          data: inicial.etapas.map((s, j) => ({
            pipelineId: e.id,
            salesTeamId: teamId,
            name: s.nombre,
            color: s.color,
            position: j,
          })),
        });
      }
    });
    return leer();
  }

  private async embudoDelEquipo(teamId: string, embudoId: string) {
    const e = await this.prisma.salesPipeline.findFirst({ where: { id: embudoId, salesTeamId: teamId } });
    if (!e) throw new NotFoundException('Embudo no encontrado');
    return e;
  }

  private async etapaDelEquipo(teamId: string, etapaId: string) {
    const s = await this.prisma.salesPipelineStage.findFirst({ where: { id: etapaId, salesTeamId: teamId } });
    if (!s) throw new NotFoundException('Etapa no encontrada');
    return s;
  }

  private async oportunidadDelEquipo(teamId: string, id: string) {
    const o = await this.prisma.salesOpportunity.findFirst({ where: { id, salesTeamId: teamId } });
    if (!o) throw new NotFoundException('Oportunidad no encontrada');
    return o;
  }

  private async exigirMiembroActivo(teamId: string, userId?: string | null) {
    if (!userId) return;
    const m = await this.prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { isActive: true },
    });
    if (!m?.isActive) throw new BadRequestException('Esa persona no está en el equipo');
  }

  /**
   * Los miembros con su nombre. Por la membresía y no por `User`: `User` pasa
   * por el filtro de negocio y en el panel de una marca saldría sin nombre.
   */
  private miembros(teamId: string) {
    return this.prisma.salesTeamMember.findMany({
      where: { teamId },
      select: { userId: true, isActive: true, user: { select: { fullName: true } } },
    });
  }

  /** Deja rastro en la ficha del lead y lo marca como activo. Nunca tumba la acción. */
  private async anotar(leadId: string, teamId: string, userId: string, body: string) {
    await Promise.all([
      this.prisma.salesLeadActivity
        .create({ data: { leadId, salesTeamId: teamId, userId, kind: 'nota', body } })
        .catch(() => null),
      this.prisma.salesLead
        .updateMany({ where: { id: leadId, salesTeamId: teamId }, data: { lastActivityAt: new Date() } })
        .catch(() => null),
    ]);
  }

  private paraElPanel(o: OportunidadConLead, nombre: Map<string, string>) {
    return {
      id: o.id,
      nombre: o.name,
      valor: Number(o.value),
      estado: o.status,
      etapaId: o.stageId,
      posicion: o.position,
      origen: o.source,
      motivo: o.lostReason,
      responsableId: o.assignedUserId,
      responsable: o.assignedUserId ? (nombre.get(o.assignedUserId) ?? 'Fuera del equipo') : null,
      ganadaEl: o.wonAt,
      perdidaEl: o.lostAt,
      creadaEl: o.createdAt,
      lead: o.lead
        ? { id: o.lead.id, nombre: o.lead.name, empresa: o.lead.company, telefono: o.lead.phone }
        : null,
    };
  }
}
