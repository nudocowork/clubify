import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { fechaEn } from '../common/franjas-horarias';
import {
  exigirEscritura,
  resolveTeamAccess,
  type AccesoAlEquipo,
} from './team-access';
import { asegurarColumnas } from './sales-columnas';
import { SalesLeadsService } from './sales-leads.service';
import {
  fechaDelReintento,
  grupoDeSeguimiento,
  pasosEIntentos,
  validarResultado,
  type Resultado,
} from './seguimientos-de-equipo';

/**
 * «Seguimientos» del equipo: la lista de trabajo diaria.
 *
 * La pestaña era una tabla plana de seguimientos con un filtro de estado, sin
 * forma de registrar qué pasó. En TeamClubify se trabaja por grupos —vencidos,
 * para hoy, programados— y cada paso se cierra con un RESULTADO que decide lo
 * siguiente: programar otro paso, cerrar la venta o darlo por perdido. Eso trae
 * este servicio. Las reglas puras viven en `seguimientos-de-equipo.ts`.
 */

const ZONA = 'America/Bogota';
const TOPE = 300;

const ETIQUETA: Record<Resultado, string> = {
  compro: 'Compró',
  continuar: 'Respondió y desea continuar',
  mas_tiempo: 'Pidió más tiempo',
  no_respondio: 'No respondió',
  no_calificado: 'Lead no calificado',
};

@Injectable()
export class SeguimientosDeEquipoService {
  constructor(
    private prisma: PrismaService,
    private leads: SalesLeadsService,
  ) {}

  /** Borrar un paso deja al lead sin próximo seguimiento: lo hace el líder o un admin. */
  private puedeBorrar(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  async listar(user: AuthUser, teamId: string, estado: 'pendientes' | 'hechos' = 'pendientes') {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const hechos = estado === 'hechos';

    const filas = await this.prisma.salesFollowup.findMany({
      where: {
        salesTeamId: teamId,
        done: hechos,
        // Un paso pendiente de un lead que ya compró o se dio por perdido no es
        // trabajo: no se le va a volver a escribir. Se filtra EN LA CONSULTA:
        // filtrarlo después del `take` dejaba fuera pasos vivos, sin avisar, en
        // cuanto hubiera más de 300 (Fable, 2026-09-14).
        //
        // `kind` admite NULL (hoy toda columna nace con tipo, `CUSTOM` las que se
        // crean a mano, pero la columna no lo exige), y en SQL
        // `kind <> 'NOT_INTERESTED'` es NULL para esas filas, no «verdadero»: el
        // `OR` evita que un lead en una columna sin tipo pierda sus pasos.
        ...(hechos
          ? {}
          : {
              lead: {
                wonAt: null,
                stage: { OR: [{ kind: null }, { kind: { not: 'NOT_INTERESTED' } }] },
              },
            }),
      },
      orderBy: hechos ? { doneAt: 'desc' } : { dueAt: 'asc' },
      take: TOPE,
      select: {
        id: true, leadId: true, dueAt: true, channel: true, note: true, done: true,
        doneAt: true, outcome: true, assignedUserId: true, createdAt: true,
        lead: {
          select: {
            id: true, name: true, company: true, phone: true, wonAt: true,
            stage: { select: { kind: true } },
          },
        },
      },
    });

    const vivos = filas;
    const leadIds = [...new Set(vivos.map((f) => f.leadId))];

    const [historia, reuniones, miembros] = await Promise.all([
      leadIds.length
        ? this.prisma.salesFollowup.findMany({
            where: { salesTeamId: teamId, leadId: { in: leadIds } },
            select: { id: true, leadId: true, createdAt: true, outcome: true },
          })
        : Promise.resolve([] as Array<{ id: string; leadId: string; createdAt: Date; outcome: string | null }>),
      // Quién ATENDIÓ al cliente: el closer de su última cita realizada. Es lo
      // que se quiere ver en la columna; el responsable del paso puede ser otro.
      leadIds.length
        ? this.prisma.salesMeeting.findMany({
            where: { salesTeamId: teamId, leadId: { in: leadIds }, status: 'REALIZADA', hostUserId: { not: null } },
            orderBy: { startAt: 'desc' },
            select: { leadId: true, hostUserId: true },
          })
        : Promise.resolve([] as Array<{ leadId: string | null; hostUserId: string | null }>),
      // Los nombres por la membresía del equipo: `SalesTeamMember` no pasa por el
      // filtro de negocio, y `User` sí (un afiliado sin negocio saldría sin nombre).
      this.prisma.salesTeamMember.findMany({
        where: { teamId },
        select: { userId: true, user: { select: { fullName: true } } },
      }),
    ]);

    const nombre = new Map(miembros.map((m) => [m.userId, m.user?.fullName ?? null]));
    const atendio = new Map<string, string>();
    for (const r of reuniones) if (r.leadId && r.hostUserId && !atendio.has(r.leadId)) atendio.set(r.leadId, r.hostUserId);

    const porLead = new Map<string, typeof historia>();
    for (const h of historia) {
      if (!porLead.has(h.leadId)) porLead.set(h.leadId, []);
      porLead.get(h.leadId)!.push(h);
    }
    const numeracion = new Map<string, { paso: number; intento: number }>();
    for (const lista of porLead.values()) {
      for (const [id, n] of pasosEIntentos(lista)) numeracion.set(id, n);
    }

    const item = (f: (typeof vivos)[number]) => {
      const closerId = atendio.get(f.leadId) ?? f.assignedUserId;
      return {
        id: f.id,
        dueAt: f.dueAt,
        channel: f.channel,
        note: f.note,
        outcome: f.outcome,
        doneAt: f.doneAt,
        paso: numeracion.get(f.id)?.paso ?? 1,
        intento: numeracion.get(f.id)?.intento ?? 1,
        closer: closerId ? (nombre.get(closerId) ?? null) : null,
        lead: f.lead
          ? { id: f.lead.id, nombre: f.lead.name, empresa: f.lead.company, telefono: f.lead.phone }
          : null,
      };
    };

    const base = {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeBorrar: this.puedeBorrar(acceso),
      estado,
      // Hay más de los que se enseñan: la pantalla lo dice en vez de callarlo.
      truncado: filas.length === TOPE,
    };
    if (hechos) return { ...base, hechos: vivos.map(item) };

    const hoy = fechaEn(new Date(), ZONA);
    const grupos = { vencidos: [] as ReturnType<typeof item>[], hoy: [] as ReturnType<typeof item>[], programados: [] as ReturnType<typeof item>[] };
    for (const f of vivos) grupos[grupoDeSeguimiento(f.dueAt, hoy, ZONA)].push(item(f));
    return { ...base, grupos };
  }

  /**
   * Cierra un paso con su resultado y hace lo que ese resultado pide.
   *
   * El cierre es ATÓMICO (`updateMany` sobre los abiertos): dos personas
   * registrando el mismo paso a la vez no crean dos pasos siguientes ni mueven
   * la tarjeta dos veces — la segunda ve `count: 0` y recibe un aviso.
   *
   * «Compró» y «no calificado» mueven el lead por `moverLead`, la misma puerta
   * del CRM: sella la venta, dispara los eventos y arranca la implementación.
   * Hacerlo a mano aquí sería una segunda copia de esa regla.
   *
   * Un fallo a medias no puede dejar el paso cerrado sin salida: el cierre, el
   * siguiente paso y el motivo van en una transacción, y si luego falla
   * `moverLead` se reabre el paso para que el reintento lo termine.
   */
  async registrarResultado(
    user: AuthUser,
    teamId: string,
    seguimientoId: string,
    body: { outcome?: string; proximaFecha?: string | null; nota?: string | null; motivo?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const v = validarResultado(body, new Date());
    if ('error' in v) throw new BadRequestException(v.error);

    const seg = await this.prisma.salesFollowup.findFirst({
      where: { id: seguimientoId, salesTeamId: teamId },
      select: { id: true, leadId: true, assignedUserId: true, channel: true },
    });
    if (!seg) throw new NotFoundException('Seguimiento no encontrado');

    // «No respondió» sin fecha se reprograma solo, con la cadencia de la
    // referencia. Antes cerraba el paso sin crear otro y el lead salía de la
    // lista para siempre: en «Interesado» y sin que nadie volviera a escribirle
    // (Fable, 2026-09-14). El intento sale de la historia del lead, igual que
    // el «intento N» que se ve en la pantalla.
    let reintento: number | null = null;
    if (v.outcome === 'no_respondio' && !v.proximaFecha) {
      const historia = await this.prisma.salesFollowup.findMany({
        where: { salesTeamId: teamId, leadId: seg.leadId },
        select: { id: true, createdAt: true, outcome: true },
      });
      reintento = (pasosEIntentos(historia).get(seg.id)?.intento ?? 1) + 1;
      v.proximaFecha = fechaDelReintento(reintento, fechaEn(new Date(), ZONA), ZONA);
    }

    const programa = !!v.proximaFecha && v.outcome !== 'compro' && v.outcome !== 'no_calificado';

    // Cierre, siguiente paso y motivo en UNA transacción. Antes iban sueltos: si
    // fallaba el `create`, el paso quedaba cerrado sin siguiente, el reintento
    // recibía «ya tenía un resultado» y el lead se quedaba sin salida desde la
    // pantalla (Fable, 2026-09-14).
    await this.prisma.$transaction(async (tx) => {
      const cierre = await tx.salesFollowup.updateMany({
        where: { id: seg.id, salesTeamId: teamId, done: false },
        data: { done: true, doneAt: new Date(), outcome: v.outcome },
      });
      if (cierre.count === 0) {
        throw new BadRequestException('Este seguimiento ya tenía un resultado registrado');
      }
      if (programa) {
        await tx.salesFollowup.create({
          data: {
            leadId: seg.leadId,
            salesTeamId: teamId,
            assignedUserId: seg.assignedUserId,
            dueAt: v.proximaFecha!,
            channel: seg.channel,
            note: reintento
              ? `Reintento automático (intento ${reintento}).${v.nota ? ` ${v.nota}` : ''}`
              : v.nota,
          },
        });
      }
      if (v.outcome === 'no_calificado') {
        await tx.salesLead.updateMany({
          where: { id: seg.leadId, salesTeamId: teamId },
          data: { lostReason: v.motivo },
        });
      }
    });

    // Mover el lead va DESPUÉS del cierre y fuera de la transacción: `moverLead`
    // dispara eventos y arranca la implementación, y eso no lo deshace un
    // rollback. Moverlo ANTES abriría otra carrera: dos personas registrando a
    // la vez «compró» y «no calificado» moverían el lead las dos, y la columna
    // final sería la de quien perdió el cierre. Si falla, se reabre el paso. (El
    // motivo, si quedó escrito, no estorba: solo se lee en un lead perdido, y el
    // reintento lo reescribe.)
    if (v.outcome === 'compro' || v.outcome === 'no_calificado') {
      try {
        const columnas = await asegurarColumnas(this.prisma, teamId);
        const destino = columnas.find((c) => c.kind === (v.outcome === 'compro' ? 'CLIENT' : 'NOT_INTERESTED'));
        if (destino) await this.leads.moverLead(user, teamId, seg.leadId, destino.id);
      } catch (e) {
        await this.prisma.salesFollowup
          .updateMany({
            where: { id: seg.id, salesTeamId: teamId, done: true, outcome: v.outcome },
            data: { done: false, doneAt: null, outcome: null },
          })
          .catch(() => null);
        throw e;
      }
    } else {
      await this.prisma.salesLead
        .updateMany({ where: { id: seg.leadId, salesTeamId: teamId }, data: { lastActivityAt: new Date() } })
        .catch(() => null);
    }

    // La nota, al final: si el lead no se pudo mover, no queda escrito «Compró».
    const texto =
      `Seguimiento: ${ETIQUETA[v.outcome]}` +
      (programa ? ` · próximo paso el ${fechaEn(v.proximaFecha!, ZONA)}${reintento ? ' (reintento automático)' : ''}` : '') +
      (v.motivo ? ` · motivo: ${v.motivo}` : '') +
      (v.nota ? ` — ${v.nota}` : '');
    await this.prisma.salesLeadActivity
      .create({ data: { leadId: seg.leadId, salesTeamId: teamId, userId: user.id, kind: 'nota', body: texto } })
      .catch(() => null);

    return { ok: true, proximoPaso: programa ? v.proximaFecha : null };
  }

  async eliminar(user: AuthUser, teamId: string, seguimientoId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    if (!this.puedeBorrar(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden eliminar seguimientos');
    }
    // Solo los abiertos: uno cerrado es historia del lead y se queda.
    const r = await this.prisma.salesFollowup.deleteMany({
      where: { id: seguimientoId, salesTeamId: teamId, done: false },
    });
    if (r.count === 0) throw new NotFoundException('Seguimiento no encontrado o ya cerrado');
    return { ok: true };
  }
}
