import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { digitsOnly, phoneKeyOf, samePhone } from '../marketing/identity';
import {
  exigirEscritura,
  resolveTeamAccess,
  type AccesoAlEquipo,
} from './team-access';
import { SalesAutomationsService } from './sales-automations.service';

/**
 * «Contactos» del equipo: la base completa, filtrable y trabajable en lote.
 *
 * Antes la pestaña era la lista plana de leads con un buscador. En TeamClubify
 * Contactos es donde se trabaja la base: filtros por etiqueta, columna y
 * origen, listas guardadas, selección de miles y acciones en lote (etiquetar,
 * inscribir en un flujo, eliminar), y un aviso de duplicado al crear. Esto lo
 * trae a Clubify PRO.
 *
 * Las reglas que deciden QUÉ se consulta —el `where` de los filtros y la
 * limpieza de una lista guardada— son funciones puras y exportadas: se prueban
 * sin base. Todo método empieza por `resolveTeamAccess`.
 */

/** Etiqueta especial del filtro: los que no tienen NINGUNA. */
export const SIN_ETIQUETA = '__sin__';
export const POR_PAGINA = 25;
/** Tope de «seleccionar todos los del filtro». Evita una acción en lote de 200.000. */
export const TOPE_DE_SELECCION = 20_000;
/** Cuántos leads acepta una acción en lote de una vez. */
const TOPE_DE_LOTE = 5_000;
/**
 * Inscribir admite menos por petición: cada lead puede disparar un envío en
 * línea, y 5.000 en serie son decenas de minutos en una sola petición que el
 * proxy corta. La pantalla trocea de 100 en 100 (Fable, 2026-09-14).
 */
const TOPE_DE_INSCRIPCION = 200;

export type FiltrosDeContactos = {
  q?: string;
  etiqueta?: string;
  columna?: string;
  origen?: string;
};

/**
 * Limpia unos filtros que llegan de fuera (la URL, o una lista guardada).
 *
 * Lista blanca de claves y solo cadenas: una lista guardada es JSON en la base,
 * y guardar lo que llegue tal cual dejaría meter cualquier cosa en un `where`.
 */
export function normalizarFiltros(raw: unknown): FiltrosDeContactos {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const limpio = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
  const f: FiltrosDeContactos = {
    q: limpio(o.q, 120),
    etiqueta: limpio(o.etiqueta, 60),
    columna: limpio(o.columna, 60),
    origen: limpio(o.origen, 60),
  };
  // Sin claves vacías: así una lista guardada «sin filtros» es `{}` y no un
  // objeto con cuatro `undefined` que se serializan distinto.
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as FiltrosDeContactos;
}

/**
 * El `where` de la tabla de contactos. SIEMPRE empieza por el equipo: es lo que
 * impide que un filtro, por raro que sea, saque leads de otro equipo.
 */
export function whereDeContactos(teamId: string, f: FiltrosDeContactos): Prisma.SalesLeadWhereInput {
  const y: Prisma.SalesLeadWhereInput[] = [{ salesTeamId: teamId }];
  const q = (f.q ?? '').trim();
  if (q) {
    const digitos = digitsOnly(q);
    y.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        // Por teléfono solo si se escribieron dígitos de verdad: «Ana» no tiene
        // dígitos y buscaría `contains: ''`, que casa con todos.
        //
        // Sobre `phoneKey` y no sobre `phone`: `phone` se guarda tal cual se
        // escribió («+57 300 111 2233»), y buscar «300111» ahí no encontraba a
        // nadie (Fable, 2026-09-14). `phoneKey` son solo dígitos.
        ...(digitos.length >= 3 ? [{ phoneKey: { contains: digitos.slice(-10) } }] : []),
      ],
    });
  }
  if (f.etiqueta === SIN_ETIQUETA) y.push({ tags: { isEmpty: true } });
  else if (f.etiqueta) y.push({ tags: { has: f.etiqueta } });
  if (f.columna) y.push({ stageId: f.columna });
  if (f.origen) y.push({ source: f.origen });
  return { AND: y };
}

@Injectable()
export class ContactosDeEquipoService {
  constructor(
    private prisma: PrismaService,
    private automations: SalesAutomationsService,
  ) {}

  /** Borrar en lote es irreversible: lo hace el líder o un admin de la marca. */
  private puedeBorrar(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  /** De los ids que llegan, solo los que son de ESTE equipo. */
  private async idsDelEquipo(teamId: string, ids: string[]): Promise<string[]> {
    const unicos = [...new Set((ids ?? []).filter((x) => typeof x === 'string'))];
    if (unicos.length > TOPE_DE_LOTE) {
      throw new BadRequestException(`Como mucho ${TOPE_DE_LOTE} contactos por acción`);
    }
    if (!unicos.length) return [];
    const filas = await this.prisma.salesLead.findMany({
      where: { id: { in: unicos }, salesTeamId: teamId },
      select: { id: true },
    });
    return filas.map((f) => f.id);
  }

  async listar(user: AuthUser, teamId: string, raw: FiltrosDeContactos & { pagina?: number }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const filtros = normalizarFiltros(raw);
    const pagina = Math.max(1, Math.floor(Number(raw.pagina) || 1));
    const where = whereDeContactos(teamId, filtros);

    const [filas, total, etiquetas, origenes, columnas] = await Promise.all([
      this.prisma.salesLead.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        select: {
          id: true, name: true, phone: true, email: true, company: true, tags: true,
          source: true, value: true, wonAt: true, lastActivityAt: true,
          stage: { select: { id: true, name: true, color: true } },
          assignedUser: { select: { fullName: true } },
        },
      }),
      this.prisma.salesLead.count({ where }),
      // Las etiquetas EN USO del equipo, para el desplegable. En SQL y no
      // leyendo todos los leads: con `unnest` cuesta lo mismo con 100 que con
      // 100.000.
      this.prisma.$queryRawUnsafe<Array<{ etiqueta: string }>>(
        `SELECT DISTINCT unnest(tags) AS etiqueta FROM "SalesLead" WHERE "salesTeamId" = $1 ORDER BY 1`,
        teamId,
      ),
      this.prisma.salesLead.groupBy({
        by: ['source'],
        where: { salesTeamId: teamId, source: { not: null } },
      }),
      // En el orden del CRM, para que el desplegable se lea como el tablero.
      this.prisma.salesStage.findMany({
        where: { salesTeamId: teamId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, color: true },
      }),
    ]);

    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeBorrar: this.puedeBorrar(acceso),
      filtros,
      pagina,
      porPagina: POR_PAGINA,
      total,
      etiquetas: etiquetas.map((e) => e.etiqueta).filter(Boolean),
      origenes: origenes.map((o) => o.source as string).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')),
      columnas,
      filas: filas.map((l) => ({
        id: l.id,
        nombre: l.name,
        telefono: l.phone,
        email: l.email,
        empresa: l.company,
        etiquetas: l.tags,
        columna: l.stage,
        origen: l.source,
        vendedor: l.assignedUser?.fullName ?? null,
        valor: l.value != null ? Number(l.value) : null,
        ganado: !!l.wonAt,
        ultimaActividad: l.lastActivityAt,
      })),
    };
  }

  /** Todos los ids que casan con el filtro, para «seleccionar los N del filtro». */
  async idsDelFiltro(user: AuthUser, teamId: string, raw: FiltrosDeContactos) {
    await resolveTeamAccess(this.prisma, user, teamId);
    const filas = await this.prisma.salesLead.findMany({
      where: whereDeContactos(teamId, normalizarFiltros(raw)),
      select: { id: true },
      take: TOPE_DE_SELECCION,
    });
    return { ids: filas.map((f) => f.id), tope: filas.length >= TOPE_DE_SELECCION };
  }

  async etiquetarEnLote(user: AuthUser, teamId: string, ids: string[], etiqueta: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const t = (etiqueta ?? '').trim().slice(0, 60);
    if (!t || t === SIN_ETIQUETA) throw new BadRequestException('Escribe una etiqueta');
    const lista = await this.idsDelEquipo(teamId, ids);
    if (!lista.length) return { ok: true, cuenta: 0 };
    // Un solo UPDATE y condicional: añade la etiqueta solo a quien no la tiene.
    // Leer, decidir y escribir fila a fila duplicaría la etiqueta si dos
    // personas etiquetan la misma selección a la vez.
    const cuenta = await this.prisma.$executeRawUnsafe(
      `UPDATE "SalesLead"
          SET tags = array_append(tags, $1), "updatedAt" = NOW()
        WHERE id = ANY($2::text[]) AND "salesTeamId" = $3 AND NOT ($1 = ANY(tags))`,
      t,
      lista,
      teamId,
    );
    return { ok: true, cuenta };
  }

  /** Los flujos de marketing publicados de la MARCA del equipo. Nunca de otra. */
  async flujos(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    if (!acceso.team.whiteLabelId) return { flujos: [] };
    const flujos = await this.prisma.mktWorkflow.findMany({
      where: { whiteLabelId: acceso.team.whiteLabelId, status: 'published' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { flujos: flujos.map((f) => ({ id: f.id, nombre: f.name })) };
  }

  async inscribirEnLote(user: AuthUser, teamId: string, ids: string[], flujoId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    // El flujo tiene que ser de la marca del equipo y estar publicado: un id de
    // otra marca metería a estos leads en las campañas de otra empresa.
    const flujo = acceso.team.whiteLabelId
      ? await this.prisma.mktWorkflow.findFirst({
          where: { id: flujoId, whiteLabelId: acceso.team.whiteLabelId, status: 'published' },
          select: { id: true },
        })
      : null;
    if (!flujo) throw new NotFoundException('Ese flujo no existe o no está publicado');

    if ((ids ?? []).length > TOPE_DE_INSCRIPCION) {
      throw new BadRequestException(`Como mucho ${TOPE_DE_INSCRIPCION} contactos por inscripción; la pantalla los manda por partes`);
    }
    const lista = await this.idsDelEquipo(teamId, ids);
    let inscritos = 0;
    let omitidos = 0;
    let sinContacto = 0;
    let fallidos = 0;
    // Uno a uno y en serie: el motor resuelve la identidad de cada persona, y
    // en paralelo dos leads de la misma persona crearían dos contactos.
    for (const leadId of lista) {
      const r = await this.automations.inscribir(leadId, flujo.id);
      if (r === 'inscrito') inscritos++;
      else if (r === 'omitido') omitidos++;
      else if (r === 'sin_contacto') sinContacto++;
      else fallidos++;
    }
    return { ok: true, inscritos, omitidos, sinContacto, fallidos };
  }

  /**
   * Elimina en lote. Se salta los que tienen una venta cerrada: su historial
   * sostiene los números del equipo y las comisiones. Igual que TeamClubify.
   *
   * Lo que se va con el lead lo decide el esquema: su actividad, seguimientos y
   * mensajes (CASCADE); sus citas e implementación se quedan sin lead (SET NULL).
   */
  async eliminarEnLote(user: AuthUser, teamId: string, ids: string[]) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    if (!this.puedeBorrar(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden eliminar contactos en lote');
    }
    const lista = await this.idsDelEquipo(teamId, ids);
    if (!lista.length) return { ok: true, eliminados: 0, omitidos: 0 };
    const r = await this.prisma.salesLead.deleteMany({
      where: { id: { in: lista }, salesTeamId: teamId, wonAt: null },
    });
    return { ok: true, eliminados: r.count, omitidos: lista.length - r.count };
  }

  // ── Listas guardadas ────────────────────────────────────────────────────

  async vistas(user: AuthUser, teamId: string) {
    await resolveTeamAccess(this.prisma, user, teamId);
    const filas = await this.prisma.salesSavedView.findMany({
      where: { salesTeamId: teamId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, filters: true },
    });
    return {
      vistas: filas.map((v) => ({ id: v.id, nombre: v.name, filtros: normalizarFiltros(v.filters) })),
    };
  }

  async crearVista(user: AuthUser, teamId: string, nombre: string, filtros: unknown) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const n = (nombre ?? '').trim().slice(0, 60);
    if (!n) throw new BadRequestException('Ponle un nombre a la lista');
    const f = normalizarFiltros(filtros);
    const v = await this.prisma.salesSavedView.create({
      data: {
        salesTeamId: teamId,
        whiteLabelId: acceso.team.whiteLabelId,
        name: n,
        filters: f as Prisma.InputJsonValue,
        createdByUserId: user.id,
      },
      select: { id: true, name: true },
    });
    return { id: v.id, nombre: v.name, filtros: f };
  }

  async borrarVista(user: AuthUser, teamId: string, vistaId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const r = await this.prisma.salesSavedView.deleteMany({
      where: { id: vistaId, salesTeamId: teamId },
    });
    if (r.count === 0) throw new NotFoundException('Lista no encontrada');
    return { ok: true };
  }

  // ── Duplicado en otro equipo ────────────────────────────────────────────

  /**
   * ¿Esta persona ya la tiene OTRO equipo de la misma marca?
   *
   * Se pregunta ANTES de crear, para que dos equipos no le escriban a la misma
   * persona. Solo dentro de la marca: mirar en otras marcas diría a Sellea
   * quién es cliente de otra empresa. `phoneKey` es un cubo de candidatos (los
   * últimos 10 dígitos, que comparten São Paulo y Río), así que quien decide si
   * es la misma persona es `samePhone`, como en el resto del producto.
   */
  async duplicado(user: AuthUser, teamId: string, telefono: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const clave = phoneKeyOf(telefono);
    if (!clave || !acceso.team.whiteLabelId) return { encontrado: false as const };

    const candidatos = await this.prisma.salesLead.findMany({
      where: {
        whiteLabelId: acceso.team.whiteLabelId,
        phoneKey: clave,
        NOT: { salesTeamId: teamId },
      },
      orderBy: { lastActivityAt: 'desc' },
      take: 50,
      select: {
        id: true, name: true, phone: true, value: true, lastActivityAt: true,
        stage: { select: { name: true } },
        team: { select: { name: true, color: true, leadUser: { select: { fullName: true } } } },
      },
    });
    const igual = candidatos.find((c) => samePhone(c.phone, telefono));
    if (!igual) return { encontrado: false as const };
    return {
      encontrado: true as const,
      leadNombre: igual.name,
      equipoNombre: igual.team?.name ?? 'otro equipo',
      equipoColor: igual.team?.color ?? null,
      lider: igual.team?.leadUser?.fullName ?? null,
      ultimaActividad: igual.lastActivityAt,
      columna: igual.stage?.name ?? null,
      valor: igual.value != null ? Number(igual.value) : null,
    };
  }
}
