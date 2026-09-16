import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { normalizarRoles, resolveTeamAccess, type AccesoAlEquipo } from './team-access';
import {
  avisoDePersona,
  claveDeRenovaciones,
  codigoParaLaVenta,
  normalizarBusqueda,
  normalizarId,
  pagaRenovacionesSegunAjuste,
  precargarPersonas,
  puedeBuscarNegocios,
  puedeVincularVentas,
  sugerirNegocios,
  type AvisoDePersona,
  type EstadoDelCodigo,
} from './ventas-de-equipo';
import { citasDelLead, tablaDeVentas, type FilaDeVenta } from './ventas-de-equipo.datos';

/** Negocios de la marca que se miran para sugerir. Clubify tiene ~125; sobra. */
const MAX_NEGOCIOS_PARA_SUGERIR = 5000;

type PersonaDeVenta = { userId: string; nombre: string; aviso: AvisoDePersona | null };

/**
 * «Venta del equipo»: vincular un lead ganado con el negocio de la marca en que
 * se convirtió, y con su closer y su setter. NO paga nada (ver
 * `ventas-de-equipo.ts`).
 *
 * Aislamiento: todo empieza por `resolveTeamAccess`, y el negocio tiene que ser
 * de la MARCA DEL EQUIPO; uno de otra marca responde igual que uno que no
 * existe. Los códigos de afiliado se buscan solo en esa marca.
 */
@Injectable()
export class VentasDeEquipoService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ── Lectura ───────────────────────────────────────────────────────────────

  /** Las ventas vinculadas del equipo, para la pestaña Clientes (una sola petición). */
  async listar(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const wl = this.marcaDe(acceso);
    const [marca, filas] = await Promise.all([
      this.prisma.whiteLabel.findUnique({ where: { id: wl }, select: { name: true } }),
      tablaDeVentas(this.prisma).findMany({
        where: { salesTeamId: teamId, estado: 'vinculada' },
        orderBy: { vinculadaEl: 'desc' },
        take: 500,
      }),
    ]);
    return {
      puedeVincular: puedeVincularVentas(acceso),
      // Sin nombre de marca no se pinta nada: nunca «Negocio de Clubify» por defecto.
      marca: marca?.name ? { nombre: marca.name } : null,
      ventas: await this.detallar(wl, teamId, filas),
    };
  }

  /** Lo que hace falta para vincular (o cambiar closer y setter) un cliente. */
  async preparar(user: AuthUser, teamId: string, leadId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirVincular(acceso);
    const wl = this.marcaDe(acceso);
    const lead = await this.leadDelEquipo(teamId, leadId);

    const [marca, vinculadasDeLaMarca, negocios, miembros, citas] = await Promise.all([
      this.prisma.whiteLabel.findUnique({ where: { id: wl }, select: { name: true } }),
      tablaDeVentas(this.prisma).findMany({ where: { whiteLabelId: wl, estado: 'vinculada' }, take: 5000 }),
      this.prisma.tenant.findMany({
        where: { whiteLabelId: wl, deletedAt: null },
        select: { id: true, brandName: true, name: true, email: true, phone: true, whatsappPhone: true },
        take: MAX_NEGOCIOS_PARA_SUGERIR,
      }),
      this.prisma.salesTeamMember.findMany({
        where: { teamId, isActive: true },
        select: { userId: true, roles: true, user: { select: { fullName: true, email: true } } },
      }),
      citasDelLead(this.prisma, teamId, leadId),
    ]);

    const propia = vinculadasDeLaMarca.find((v) => v.leadId === leadId && v.salesTeamId === teamId) ?? null;
    const ocupados = new Set(vinculadasDeLaMarca.map((v) => v.negocioId));
    const activos = new Set(miembros.map((m) => m.userId));
    const codigos = await this.codigosPorPersona(wl, [...activos]);

    return {
      lead: { id: lead.id, nombre: lead.name, ganado: !!lead.wonAt },
      marca: marca?.name ? { nombre: marca.name } : null,
      puedeBuscar: puedeBuscarNegocios(acceso),
      venta: propia ? (await this.detallar(wl, teamId, [propia]))[0] : null,
      // Un negocio ya vinculado a otra venta no se sugiere: no se podría elegir.
      sugerencias: propia
        ? []
        : sugerirNegocios(
            lead,
            negocios
              .filter((n) => !ocupados.has(n.id))
              .map((n) => ({
                id: n.id,
                nombre: n.brandName || n.name,
                email: n.email,
                phone: n.phone,
                whatsappPhone: n.whatsappPhone,
              })),
          ),
      precarga: propia
        ? { closerUserId: propia.closerUserId, setterUserId: propia.setterUserId }
        : precargarPersonas(citas, activos),
      miembros: miembros
        .map((m) => ({
          userId: m.userId,
          nombre: m.user?.fullName || m.user?.email || 'Sin nombre',
          roles: normalizarRoles(m.roles),
          codigo: (codigos.get(m.userId)?.estado ?? 'sin_codigo') as EstadoDelCodigo,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
  }

  /** Buscar un negocio de la marca por nombre, correo o enlace. Solo un admin. */
  async buscarNegocios(user: AuthUser, teamId: string, q: unknown) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    if (!puedeBuscarNegocios(acceso)) {
      throw new ForbiddenException('Solo un admin de la marca puede buscar negocios');
    }
    const wl = this.marcaDe(acceso);
    const texto = normalizarBusqueda(q);
    if (!texto) return { negocios: [] };
    const contiene = { contains: texto, mode: 'insensitive' as const };
    const [negocios, vinculadas] = await Promise.all([
      this.prisma.tenant.findMany({
        where: {
          whiteLabelId: wl,
          deletedAt: null,
          OR: [{ brandName: contiene }, { name: contiene }, { email: contiene }, { slug: contiene }],
        },
        select: { id: true, brandName: true, name: true, email: true },
        orderBy: { brandName: 'asc' },
        take: 10,
      }),
      tablaDeVentas(this.prisma).findMany({ where: { whiteLabelId: wl, estado: 'vinculada' }, take: 5000 }),
    ]);
    const ocupados = new Set(vinculadas.map((v) => v.negocioId));
    return {
      negocios: negocios.map((n) => ({
        id: n.id,
        nombre: n.brandName || n.name,
        correo: n.email,
        yaVinculado: ocupados.has(n.id),
      })),
    };
  }

  // ── Escritura ─────────────────────────────────────────────────────────────

  async vincular(
    user: AuthUser,
    teamId: string,
    leadId: string,
    body: { negocioId?: unknown; closerUserId?: unknown; setterUserId?: unknown },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirVincular(acceso);
    const wl = this.marcaDe(acceso);

    const negocioId = normalizarId(body.negocioId);
    if (!negocioId) throw new BadRequestException('Elige el negocio');
    const lead = await this.leadDelEquipo(teamId, leadId);
    if (!lead.wonAt) {
      throw new BadRequestException('Primero marca el lead como ganado: el negocio se vincula a una venta cerrada');
    }
    const negocio = await this.prisma.tenant.findFirst({
      where: { id: negocioId, whiteLabelId: wl, deletedAt: null },
      select: { id: true, brandName: true, name: true },
    });
    // De otra marca, borrado o inexistente: la misma respuesta para los tres.
    if (!negocio) throw new NotFoundException('Negocio no encontrado');

    const closerUserId = normalizarId(body.closerUserId);
    const setterUserId = normalizarId(body.setterUserId);
    await this.exigirColaborador(teamId, closerUserId, 'closer');
    await this.exigirColaborador(teamId, setterUserId, 'setter');

    const tabla = tablaDeVentas(this.prisma);
    const [delLead, delNegocio] = await Promise.all([
      tabla.findFirst({ where: { leadId, estado: 'vinculada' } }),
      tabla.findFirst({ where: { negocioId, estado: 'vinculada' } }),
    ]);
    if (delLead) {
      throw new ConflictException('Este cliente ya tiene un negocio vinculado. Desvincúlalo antes de elegir otro.');
    }
    if (delNegocio) throw new ConflictException('Ese negocio ya está vinculado a otra venta.');

    const [codigos, pagaRenovaciones] = await Promise.all([
      this.codigosPorPersona(wl, [closerUserId, setterUserId]),
      this.pagaRenovaciones(wl),
    ]);

    let fila: FilaDeVenta;
    try {
      fila = await tabla.create({
        data: {
          salesTeamId: teamId,
          whiteLabelId: wl,
          leadId,
          negocioId,
          closerUserId,
          closerCodeId: closerUserId ? (codigos.get(closerUserId)?.codigoId ?? null) : null,
          setterUserId,
          setterCodeId: setterUserId ? (codigos.get(setterUserId)?.codigoId ?? null) : null,
          pagaRenovaciones,
          estado: 'vinculada',
          vinculadaPorUserId: user.id,
        },
      });
    } catch (e) {
      // Dos personas vinculando a la vez: la comprobación de arriba no lo ve, lo
      // frena el índice único parcial de la migración.
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('Ese negocio o este cliente se acaban de vincular en otra venta. Recarga.');
      }
      throw e;
    }

    const nombre = negocio.brandName || negocio.name;
    await this.anotar(leadId, teamId, user.id, `Negocio vinculado: ${nombre}`);
    await this.audit.log({
      actorId: user.id,
      action: 'sales_team.sale_linked',
      resource: `SalesTeamSale:${fila.id}`,
      metadata: {
        salesTeamId: teamId,
        whiteLabelId: wl,
        leadId,
        negocioId,
        closerUserId,
        closerCodeId: fila.closerCodeId,
        setterUserId,
        setterCodeId: fila.setterCodeId,
        pagaRenovaciones,
      },
    });
    return (await this.detallar(wl, teamId, [fila]))[0];
  }

  /**
   * Cambiar closer o setter de una venta vinculada. Guardar vuelve a tomar el
   * código VIGENTE de los dos: es como se recoge un código aprobado después de
   * vincular. Condicional sobre `updatedAt`: dos personas editando a la vez no
   * se pisan en silencio.
   */
  async cambiarPersonas(
    user: AuthUser,
    teamId: string,
    leadId: string,
    body: { closerUserId?: unknown; setterUserId?: unknown },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirVincular(acceso);
    const wl = this.marcaDe(acceso);
    const tabla = tablaDeVentas(this.prisma);
    const venta = await tabla.findFirst({ where: { leadId, salesTeamId: teamId, estado: 'vinculada' } });
    if (!venta) throw new NotFoundException('Este cliente no tiene un negocio vinculado');

    const closerUserId = body.closerUserId === undefined ? venta.closerUserId : normalizarId(body.closerUserId);
    const setterUserId = body.setterUserId === undefined ? venta.setterUserId : normalizarId(body.setterUserId);
    // Solo se exige estar en el equipo a quien se pone nuevo: quien cerró y luego
    // se fue sigue siendo quien cerró.
    if (closerUserId !== venta.closerUserId) await this.exigirColaborador(teamId, closerUserId, 'closer');
    if (setterUserId !== venta.setterUserId) await this.exigirColaborador(teamId, setterUserId, 'setter');

    const codigos = await this.codigosPorPersona(wl, [closerUserId, setterUserId]);
    const data = {
      closerUserId,
      closerCodeId: closerUserId ? (codigos.get(closerUserId)?.codigoId ?? null) : null,
      setterUserId,
      setterCodeId: setterUserId ? (codigos.get(setterUserId)?.codigoId ?? null) : null,
    };
    const hecho = await tabla.updateMany({
      where: { id: venta.id, estado: 'vinculada', updatedAt: venta.updatedAt },
      data,
    });
    if (hecho.count === 0) {
      throw new ConflictException('Otra persona cambió esta venta mientras la editabas. Recarga y revísala.');
    }
    await this.audit.log({
      actorId: user.id,
      action: 'sales_team.sale_people_changed',
      resource: `SalesTeamSale:${venta.id}`,
      metadata: {
        whiteLabelId: wl,
        antes: {
          closerUserId: venta.closerUserId,
          closerCodeId: venta.closerCodeId,
          setterUserId: venta.setterUserId,
          setterCodeId: venta.setterCodeId,
        },
        despues: data,
      },
    });
    return (await this.detallar(wl, teamId, [{ ...venta, ...data }]))[0];
  }

  /** No se borra: queda `desvinculada`, con quién y cuándo. */
  async desvincular(user: AuthUser, teamId: string, leadId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirVincular(acceso);
    const wl = this.marcaDe(acceso);
    const tabla = tablaDeVentas(this.prisma);
    const venta = await tabla.findFirst({ where: { leadId, salesTeamId: teamId, estado: 'vinculada' } });
    if (!venta) throw new NotFoundException('Este cliente no tiene un negocio vinculado');
    const hecho = await tabla.updateMany({
      where: { id: venta.id, estado: 'vinculada' },
      data: { estado: 'desvinculada', desvinculadaPorUserId: user.id, desvinculadaEl: new Date() },
    });
    if (hecho.count === 0) throw new NotFoundException('Este cliente no tiene un negocio vinculado');
    await this.anotar(leadId, teamId, user.id, 'Negocio desvinculado');
    await this.audit.log({
      actorId: user.id,
      action: 'sales_team.sale_unlinked',
      resource: `SalesTeamSale:${venta.id}`,
      metadata: { whiteLabelId: wl, salesTeamId: teamId, leadId, negocioId: venta.negocioId },
    });
    return { ok: true };
  }

  // ── Piezas ────────────────────────────────────────────────────────────────

  private exigirVincular(acceso: AccesoAlEquipo) {
    if (!puedeVincularVentas(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden vincular el negocio de una venta');
    }
  }

  /** `resolveTeamAccess` ya niega un equipo sin marca; esto es para el compilador y por si cambia. */
  private marcaDe(acceso: AccesoAlEquipo): string {
    if (!acceso.team.whiteLabelId) throw new NotFoundException('Equipo no encontrado');
    return acceso.team.whiteLabelId;
  }

  private async leadDelEquipo(teamId: string, leadId: string) {
    const lead = await this.prisma.salesLead.findFirst({
      where: { id: leadId, salesTeamId: teamId },
      select: { id: true, name: true, phone: true, email: true, wonAt: true },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    return lead;
  }

  private async exigirColaborador(teamId: string, userId: string | null, papel: 'closer' | 'setter') {
    if (!userId) return;
    const miembro = await this.prisma.salesTeamMember.findMany({
      where: { teamId, isActive: true, userId: { in: [userId] } },
      select: { userId: true },
    });
    if (!miembro.length) {
      throw new BadRequestException(`El ${papel} tiene que ser un colaborador activo del equipo`);
    }
  }

  /** El código de cada persona, buscado SOLO en la marca del equipo. */
  private async codigosPorPersona(
    wl: string,
    userIds: Array<string | null>,
  ): Promise<Map<string, { estado: EstadoDelCodigo; codigoId: string | null }>> {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    const mapa = new Map<string, { estado: EstadoDelCodigo; codigoId: string | null }>();
    if (!ids.length) return mapa;
    const codigos = await this.prisma.referralCode.findMany({
      where: { ownerUserId: { in: ids }, whiteLabelId: wl },
      select: { id: true, ownerUserId: true, role: true, isActive: true, approvedAt: true },
    });
    for (const id of ids) mapa.set(id, codigoParaLaVenta(codigos.filter((c) => c.ownerUserId === id)));
    return mapa;
  }

  private async pagaRenovaciones(wl: string): Promise<boolean> {
    const marca = await this.prisma.whiteLabel.findUnique({ where: { id: wl }, select: { slug: true } });
    const clave = claveDeRenovaciones(marca?.slug);
    if (!clave) return false;
    const fila = await this.prisma.setting.findUnique({ where: { key: clave }, select: { value: true } });
    return pagaRenovacionesSegunAjuste(fila?.value);
  }

  /**
   * Nombres por membresía (incluidos quienes ya no están activos). Quien no es
   * miembro —un admin de la marca que vinculó— por su usuario: `findUnique` no
   * pasa por el filtro de negocio, y un afiliado sin negocio saldría sin nombre
   * con un listado.
   */
  private async nombres(teamId: string, userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    const mapa = new Map<string, string>();
    if (!ids.length) return mapa;
    const miembros = await this.prisma.salesTeamMember.findMany({
      where: { teamId, userId: { in: ids } },
      select: { userId: true, user: { select: { fullName: true, email: true } } },
    });
    for (const m of miembros) {
      const n = m.user?.fullName || m.user?.email;
      if (n) mapa.set(m.userId, n);
    }
    const faltan = ids.filter((id) => !mapa.has(id));
    const usuarios = await Promise.all(
      faltan.map((id) =>
        this.prisma.user.findUnique({ where: { id }, select: { fullName: true, email: true } }).catch(() => null),
      ),
    );
    faltan.forEach((id, k) => {
      const n = usuarios[k]?.fullName || usuarios[k]?.email;
      if (n) mapa.set(id, n);
    });
    return mapa;
  }

  private async detallar(wl: string, teamId: string, filas: FilaDeVenta[]) {
    if (!filas.length) return [];
    const personas = filas
      .flatMap((f) => [f.closerUserId, f.setterUserId, f.vinculadaPorUserId])
      .filter((x): x is string => !!x);
    const [negocios, nombres, codigos] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { id: { in: [...new Set(filas.map((f) => f.negocioId))] }, whiteLabelId: wl },
        select: { id: true, brandName: true, name: true },
      }),
      this.nombres(teamId, personas),
      this.codigosPorPersona(
        wl,
        filas.flatMap((f) => [f.closerUserId, f.setterUserId]),
      ),
    ]);
    const negocioPorId = new Map(negocios.map((n) => [n.id, n.brandName || n.name]));
    const persona = (userId: string | null, codigoGuardado: string | null): PersonaDeVenta | null =>
      userId
        ? {
            userId,
            nombre: nombres.get(userId) ?? 'Sin nombre',
            aviso: avisoDePersona(codigoGuardado, codigos.get(userId)?.estado ?? 'sin_codigo'),
          }
        : null;
    return filas.map((f) => ({
      id: f.id,
      leadId: f.leadId,
      // null si el negocio ya no es de la marca o se borró: la venta se enseña igual.
      negocio: { id: f.negocioId, nombre: negocioPorId.get(f.negocioId) ?? null },
      closer: persona(f.closerUserId, f.closerCodeId),
      setter: persona(f.setterUserId, f.setterCodeId),
      vinculadaEl: f.vinculadaEl,
      vinculadaPor: f.vinculadaPorUserId ? (nombres.get(f.vinculadaPorUserId) ?? null) : null,
    }));
  }

  /** Best-effort: una nota que no se guarda no deshace el vínculo, que ya ocurrió. */
  private async anotar(leadId: string, teamId: string, userId: string, body: string) {
    await this.prisma.salesLeadActivity
      .create({ data: { leadId, salesTeamId: teamId, userId, kind: 'sistema', body } })
      .catch(() => null);
  }
}
