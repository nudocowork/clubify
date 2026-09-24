import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LabCategory,
  LabPriority,
  LabStatus,
  LabVoteKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { BrandEmailService } from '../email/brand-email.service';
import { MediaService } from '../media/media.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';
import {
  EtiquetaMarca,
  LabVisor,
  conEtiquetaDeMarca,
  esDeLaPlataforma,
  exigirAdjuntar,
  exigirModeracion,
  exigirParticipacion,
  filtroAdminPorMarca,
  filtroDeMarca,
  mismaMarca,
  puedeParticipar,
  puedeVerPropuesta,
  resolverVisorLab,
} from './lab-access';
import {
  LAB_CARPETA_ADJUNTOS,
  normalizarAdjunto,
  validarAdjuntoLab,
} from './lab-adjuntos';
import {
  type HechoLab,
  MemoriaDeAvisos,
  TELEFONO_EQUIPO_LAB,
  claveDeComentario,
  claveDePropuesta,
  debeAvisarAlEquipo,
  enlaceDeModeracion,
  textoAvisoLab,
} from './lab-aviso';

// Pesos del voting widget. NEED/HIGH_PRIORITY pesan más que un LIKE normal
// para que "lo necesito YA" mueva la aguja del ranking más que un like
// pasivo. DISLIKE resta sin tapar la propuesta (solo afecta el score, no
// la visibilidad).
const VOTE_WEIGHTS: Record<LabVoteKind, number> = {
  LIKE: 1,
  NEED: 3,
  HIGH_PRIORITY: 5,
  DISLIKE: -2,
};

// Status que se consideran "públicos" (visibles al feed general).
// PENDING y REJECTED solo los ve el autor + admin.
const PUBLIC_STATUSES: LabStatus[] = [
  'EVALUATING',
  'APPROVED',
  'IN_DEVELOPMENT',
  'IN_TESTING',
  'IMPLEMENTED',
];

// Transiciones de status permitidas. IMPLEMENTED es terminal; REJECTED
// puede reabrirse a EVALUATING o PENDING. Bloquea brincos como
// PENDING → IMPLEMENTED directo (cambio accidental desde el dropdown
// admin que dejaba un IMPLEMENTED sin pasar por IN_DEVELOPMENT/TESTING).
/**
 * Los saltos de estado permitidos.
 *
 * La escalera larga (evaluación → aprobada → desarrollo → pruebas →
 * implementada) tiene sentido para una propuesta de la COMUNIDAD, que se vota
 * antes de entrar al roadmap. Para un TICKET de una marca blanca no: Humberto
 * no manda ideas a votar, manda trabajo, y obligarle a pasar por «en
 * evaluación» solo añade clics y hace que el ticket desaparezca de la pestaña
 * donde se estaba mirando (Javier, 2026-09-18: «cuando se aprueba, en lugar de
 * ir a pendiente, ¿podemos colocarla a "En desarrollo" de inmediato?»).
 *
 * Así que se abren tres atajos, sin quitar ninguno de los pasos de antes:
 *  - PENDING → APPROVED y PENDING → IN_DEVELOPMENT: aprobar y ponerse a ello.
 *  - IN_DEVELOPMENT → IMPLEMENTED: darlo por terminado sin pasar por pruebas,
 *    que es como trabaja un equipo de este tamaño.
 *
 * IMPLEMENTED sigue sin salida: lo terminado no se reabre, se propone de nuevo.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<LabStatus, LabStatus[]> = {
  PENDING: ['EVALUATING', 'APPROVED', 'IN_DEVELOPMENT', 'REJECTED'],
  EVALUATING: ['APPROVED', 'IN_DEVELOPMENT', 'REJECTED', 'PENDING'],
  APPROVED: ['IN_DEVELOPMENT', 'REJECTED', 'EVALUATING'],
  IN_DEVELOPMENT: ['IN_TESTING', 'IMPLEMENTED', 'APPROVED', 'REJECTED'],
  IN_TESTING: ['IMPLEMENTED', 'IN_DEVELOPMENT', 'REJECTED'],
  IMPLEMENTED: [],
  REJECTED: ['PENDING', 'EVALUATING'],
};

/** Para que el panel ofrezca SOLO lo que el backend va a aceptar. */
export function transicionesPermitidas(desde: LabStatus): LabStatus[] {
  return ALLOWED_STATUS_TRANSITIONS[desde] ?? [];
}

const NO_ENCONTRADA = 'Propuesta no encontrada.';

export interface CreateProposalInput {
  title: string;
  description: string;
  category: LabCategory;
  priority?: LabPriority;
  expectedBenefit?: string | null;
  attachmentUrl?: string | null;
  attachmentKind?: string | null;
}

export interface ListPublicOptions {
  status?: LabStatus;
  sortBy?: 'top' | 'newest' | 'topMonth';
  q?: string;
  take?: number;
  skip?: number;
}

export interface ListAdminOptions {
  category?: LabCategory;
  status?: LabStatus;
  q?: string;
  /** Id de una marca, o `FILTRO_PLATAFORMA` para Clubify y las históricas sin marca. */
  whiteLabelId?: string;
  /** Ranking por votos (solo lo que ya salió a votación), para «Top votadas». */
  sortBy?: 'top' | 'topMonth';
  take?: number;
  skip?: number;
}

/**
 * SMS al equipo cuando una propuesta cambia de estado. El equipo modera las
 * propuestas de todas las marcas: sin la marca en el texto no sabe de quién es.
 */
export function textoAvisoEquipoLab(p: {
  marca: string | null;
  titulo: string;
  estado: LabStatus;
  motivo: string | null;
}): string {
  const lab = p.marca ? `Lab de ${p.marca}` : 'Lab (marca sin resolver)';
  return (
    `${lab}: la propuesta "${p.titulo}" cambió a ${p.estado}` +
    (p.motivo ? ` (motivo: ${p.motivo})` : '')
  );
}

function busqueda(q: string): Prisma.LabProposalWhereInput {
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ],
  };
}

@Injectable()
export class LabService {
  private logger = new Logger(LabService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
    private brandEmail: BrandEmailService,
    private media: MediaService,
  ) {}

  /**
   * Avisos ya enviados, para no repetir el SMS por el mismo hecho. Vive en el
   * servicio (singleton de Nest) y no en el módulo: así cada test arranca con
   * la memoria limpia.
   */
  private avisos = new MemoriaDeAvisos();

  // =============================================================
  //                     QUIÉN MIRA
  // =============================================================

  /**
   * Quién mira el Lab y con qué marca (reglas en `lab-access.ts`). Lanza 403
   * si es de una marca blanca y no es su administrador general.
   *
   * Cada rol lleva la marca en un sitio distinto: el admin en la sesión, el
   * dueño en su negocio y el afiliado —que no tiene `tenantId`— en su
   * `ReferralCode`. Sin `.catch` a propósito: si la base falla, mejor un 500
   * que tratar a un afiliado de otra marca como uno de la plataforma.
   */
  async visorDe(user: AuthUser): Promise<LabVisor> {
    const [{ clubifyId }, u] = await Promise.all([
      resolveBrandScope(this.prisma, null),
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          whiteLabelId: true,
          tenantId: true,
          referralCodes: { select: { whiteLabelId: true }, take: 1 },
        },
      }),
    ]);
    // El negocio sale de la sesión antes que de la base: un admin que entra a
    // un negocio lleva ese `tenantId` en el token, no en su usuario.
    const tenantId = user.tenantId ?? u?.tenantId ?? null;
    const negocio =
      user.role === 'TENANT_OWNER' && tenantId
        ? await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { whiteLabelId: true },
          })
        : null;
    return resolverVisorLab({
      role: user.role,
      sesionWhiteLabelId: user.whiteLabelId ?? null,
      // Entrar a una marca desde el panel maestro firma el token con el `sub`
      // de su administrador real: sin esto, lo escrito saldría a su nombre.
      suplantadoPor: user.impersonatedBy ?? null,
      usuarioWhiteLabelId: u?.whiteLabelId ?? null,
      negocioWhiteLabelId: negocio?.whiteLabelId ?? null,
      codigoWhiteLabelId: u?.referralCodes?.[0]?.whiteLabelId ?? null,
      clubifyId,
    });
  }

  /**
   * Lo que el front necesita para pintar el Lab: el alcance y el nombre y
   * colores de la marca. A la plataforma le devuelve la fila Clubify; si no
   * existe (dev), `marca: null` y el front usa textos neutros en vez de
   * inventarse un nombre. `soloLectura` esconde «Crear propuesta».
   */
  async contexto(user: AuthUser) {
    const visor = await this.visorDe(user);
    const id =
      visor.alcance === 'MARCA_ADMIN' ? visor.whiteLabelId : visor.clubifyId;
    const marca = id
      ? await this.prisma.whiteLabel.findUnique({
          where: { id },
          select: { name: true, slug: true, primaryColor: true, logoUrl: true },
        })
      : null;
    return {
      alcance: visor.alcance,
      soloLectura: visor.soloLectura,
      marca: marca ?? null,
    };
  }

  // =============================================================
  //                     PROPOSALS — públicas
  // =============================================================

  async createProposal(user: AuthUser, dto: CreateProposalInput) {
    const visor = await this.visorDe(user);
    exigirParticipacion(visor);
    const title = (dto.title ?? '').trim();
    const description = (dto.description ?? '').trim();
    if (title.length < 5) {
      throw new BadRequestException('El título es muy corto (mínimo 5).');
    }
    if (description.length < 20) {
      throw new BadRequestException(
        'La descripción es muy corta (mínimo 20 caracteres).',
      );
    }
    if (!['CLIENTS', 'AFFILIATES'].includes(dto.category)) {
      throw new BadRequestException('Categoría inválida.');
    }
    const adjunto = normalizarAdjunto(dto);
    const creada = await this.prisma.labProposal.create({
      data: {
        title,
        description,
        category: dto.category,
        priority: dto.priority ?? 'MEDIUM',
        expectedBenefit: dto.expectedBenefit?.trim() || null,
        ...adjunto,
        authorId: user.id,
        // La propuesta nace con la marca de quien la escribe: así sale en el
        // Lab de esa marca y, en la moderación, con su etiqueta.
        whiteLabelId: visor.whiteLabelId,
      },
    });
    // Best-effort: el SMS al equipo NUNCA puede tumbar la creación. Si falla,
    // la propuesta ya está guardada y se ve en la moderación igual.
    void this.avisarAlEquipo({
      clave: claveDePropuesta(user.id, creada.title),
      proposalId: creada.id,
      titulo: creada.title,
      whiteLabelId: visor.whiteLabelId,
      autorId: user.id,
      hecho: 'propuesta',
    });
    return creada;
  }

  /**
   * Sube una imagen o un video y devuelve su URL, para adjuntarla a una
   * propuesta. Pasa por la misma puerta que crearla —una sesión suplantada no
   * sube nada a nombre del administrador de la marca— y por eso vive aquí y no
   * en `/media/upload`, que además no admite al rol AFFILIATE_VENDOR.
   *
   * En la propuesta se guarda SOLO la URL: el archivo vive en el bucket.
   */
  async subirAdjunto(user: AuthUser, file: Express.Multer.File) {
    const visor = await this.visorDe(user);
    exigirParticipacion(visor);
    // El candado de verdad, en el backend: esconder el botón en el front no
    // impide un POST a mano. Va ANTES de mirar el archivo — a quien no le toca
    // no se le lee ni el tipo ni el tamaño.
    exigirAdjuntar(visor);
    const kind = validarAdjuntoLab(file);
    const subido = await this.media.upload({
      folder: LAB_CARPETA_ADJUNTOS,
      file,
    });
    return {
      url: subido.url,
      // El tipo validado, no el que deduzca el bucket: es el que decide cómo
      // se pinta el adjunto en la propuesta.
      kind,
      contentType: subido.contentType,
      size: subido.size,
    };
  }

  async listPublic(
    user: AuthUser,
    category: LabCategory,
    options: ListPublicOptions = {},
  ) {
    const visor = await this.visorDe(user);
    const take = Math.min(options.take ?? 20, 50);
    const skip = options.skip ?? 0;
    // Cada marca ve SU Lab; la plataforma junta Clubify y las históricas sin
    // marca. Va dentro de AND para no pisar el OR de la búsqueda.
    const and: Prisma.LabProposalWhereInput[] = [filtroDeMarca(visor)];
    if (options.q && options.q.trim()) and.push(busqueda(options.q.trim()));
    // QUIÉN VE LO QUE TODAVÍA NO ES PÚBLICO.
    //
    // Una propuesta nace PENDING y el muro solo enseña las que ya pasaron
    // revisión. Resultado: quien la escribía no volvía a verla —«¿se envió?»— y
    // el administrador de la marca tampoco veía lo que su gente acababa de
    // mandar (Javier, 2026-09-23: «sigo sin ver las nuevas propuestas de
    // Humberto; deberían aparecer como Enviadas»).
    //
    // Ahora, además de las públicas, cada uno ve:
    //  · las SUYAS, en cualquier estado (salen marcadas «Enviada»);
    //  · si manda en la marca —o es del equipo de la plataforma—, las que
    //    están esperando revisión, que son justo las que tiene que atender.
    // Las rechazadas siguen siendo cosa de su autor y de quien modera.
    const mandaEnLaMarca =
      visor.alcance === 'MARCA_ADMIN' || visor.alcance === 'PLATAFORMA_EQUIPO';
    const visibles: Prisma.LabProposalWhereInput[] = [
      { status: { in: PUBLIC_STATUSES } },
      { authorId: user.id },
    ];
    if (mandaEnLaMarca) visibles.push({ status: 'PENDING' });
    // La pestaña de estado ACOTA, nunca amplía: se suma al mismo filtro de
    // visibilidad. Con la rama de antes, quien manda en la marca podía pedir
    // `status=REJECTED` y leer las rechazadas de otros autores, que es justo lo
    // que no debe pasar.
    if (options.status) and.push({ status: options.status });
    and.push({ OR: visibles });
    const where: Prisma.LabProposalWhereInput = {
      category,
      AND: and,
    };

    let orderBy: Prisma.LabProposalOrderByWithRelationInput
      | Prisma.LabProposalOrderByWithRelationInput[] = { createdAt: 'desc' };
    if (options.sortBy === 'top') {
      orderBy = [{ votesScore: 'desc' }, { createdAt: 'desc' }];
    } else if (options.sortBy === 'topMonth') {
      // "Top del mes" — limita createdAt a últimos 30d y ordena por score.
      const since = new Date();
      since.setDate(since.getDate() - 30);
      where.createdAt = { gte: since };
      orderBy = [{ votesScore: 'desc' }, { createdAt: 'desc' }];
    }

    const [items, total] = await Promise.all([
      this.prisma.labProposal.findMany({
        where,
        orderBy,
        take,
        skip,
        include: {
          author: { select: { id: true, fullName: true, role: true } },
        },
      }),
      this.prisma.labProposal.count({ where }),
    ]);
    if (visor.alcance !== 'PLATAFORMA_EQUIPO') {
      return { items, total, take, skip };
    }
    // Solo el equipo: la etiqueta de la marca —que es lo que pinta la tarjeta
    // en naranja— y los pasos a los que puede mover cada propuesta, para
    // avanzarla desde el mismo feed sin ir a la moderación.
    const etiquetas = await this.etiquetasDeMarca(
      items.map((p) => p.whiteLabelId),
      visor.clubifyId,
    );
    return {
      items: conEtiquetaDeMarca(items, etiquetas, visor.clubifyId).map((p) => ({
        ...p,
        siguientesEstados: transicionesPermitidas(p.status),
      })),
      total,
      take,
      skip,
    };
  }

  /**
   * Una propuesta de otra marca da 404 (no 403, para no confirmar que el id
   * existe). PENDING o REJECTED: solo el autor y el equipo de la plataforma,
   * que es quien las revisa y la moderación enlaza al detalle.
   */
  private exigirVisible(
    visor: LabVisor,
    proposal: { status: LabStatus; authorId: string; whiteLabelId: string | null } | null,
    userId: string,
  ) {
    if (!proposal || !puedeVerPropuesta(visor, proposal.whiteLabelId)) {
      throw new NotFoundException(NO_ENCONTRADA);
    }
    // Quien manda en la marca abre las que están ESPERANDO revisión: son las
    // que su propio muro le enseña, y sin esto pulsar una daba «no encontrada»
    // en la misma pantalla. Las rechazadas siguen siendo del autor y del
    // equipo de la plataforma.
    const puedeModerarLaPendiente =
      proposal.status === 'PENDING' && visor.alcance === 'MARCA_ADMIN';
    if (
      !PUBLIC_STATUSES.includes(proposal.status) &&
      proposal.authorId !== userId &&
      visor.alcance !== 'PLATAFORMA_EQUIPO' &&
      !puedeModerarLaPendiente
    ) {
      throw new NotFoundException(NO_ENCONTRADA);
    }
  }

  async getById(id: string, user: AuthUser) {
    const visor = await this.visorDe(user);
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, fullName: true, role: true },
        },
        lastStatusChangedBy: { select: { id: true, fullName: true } },
      },
    });
    this.exigirVisible(visor, proposal, user.id);
    const p = proposal!;
    const esEquipo = visor.alcance === 'PLATAFORMA_EQUIPO';

    const [myVote, comments, voteBreakdown, etiquetas] = await Promise.all([
      this.prisma.labVote.findUnique({
        where: { proposalId_userId: { proposalId: id, userId: user.id } },
      }),
      this.prisma.labComment.findMany({
        where: { proposalId: id },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: {
          author: { select: { id: true, fullName: true, role: true } },
        },
      }),
      this.prisma.labVote.groupBy({
        by: ['kind'],
        where: { proposalId: id },
        _count: { _all: true },
      }),
      esEquipo
        ? this.etiquetasDeMarca([p.whiteLabelId], visor.clubifyId)
        : Promise.resolve(new Map<string, EtiquetaMarca>()),
    ]);

    const breakdown: Record<LabVoteKind, number> = {
      LIKE: 0,
      NEED: 0,
      HIGH_PRIORITY: 0,
      DISLIKE: 0,
    };
    for (const row of voteBreakdown) {
      breakdown[row.kind] = row._count._all;
    }

    return {
      ...p,
      // La etiqueta es cosa de la moderación: dentro de una marca todas las
      // propuestas son suyas y ponerle su propio nombre no dice nada.
      brand: esEquipo
        ? conEtiquetaDeMarca([p], etiquetas, visor.clubifyId)[0].brand
        : null,
      canParticipate: puedeParticipar(visor, p.whiteLabelId),
      myVote,
      comments,
      voteBreakdown: breakdown,
    };
  }

  /**
   * La propuesta sobre la que alguien vota o comenta, ya comprobada. Si es de
   * otra marca, 404. El equipo de la plataforma la ve pero no participa.
   */
  private async propuestaParaParticipar(proposalId: string, user: AuthUser) {
    const visor = await this.visorDe(user);
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        title: true,
        status: true,
        authorId: true,
        whiteLabelId: true,
      },
    });
    if (!proposal || !puedeVerPropuesta(visor, proposal.whiteLabelId)) {
      throw new NotFoundException(NO_ENCONTRADA);
    }
    // Antes que el chequeo de marca, para que la sesión suplantada reciba su
    // motivo y no el de «otra marca».
    exigirParticipacion(visor);
    if (!puedeParticipar(visor, proposal.whiteLabelId)) {
      throw new ForbiddenException(
        'Esta propuesta es del Lab de otra marca: puedes verla, pero no votar ni comentar.',
      );
    }
    return proposal;
  }

  async vote(proposalId: string, user: AuthUser, kind: LabVoteKind) {
    if (!VOTE_WEIGHTS[kind]) {
      throw new BadRequestException('Tipo de voto inválido.');
    }
    const proposal = await this.propuestaParaParticipar(proposalId, user);
    // Solo se vota sobre propuestas públicas (el autor puede ver pero no
    // votar sobre PENDING/REJECTED — no tendría sentido).
    if (!PUBLIC_STATUSES.includes(proposal.status)) {
      throw new ForbiddenException('No puedes votar esta propuesta.');
    }

    await this.prisma.labVote.upsert({
      where: { proposalId_userId: { proposalId, userId: user.id } },
      create: { proposalId, userId: user.id, kind },
      update: { kind },
    });
    return this.recalcVotes(proposalId);
  }

  async removeVote(proposalId: string, user: AuthUser) {
    await this.propuestaParaParticipar(proposalId, user);
    await this.prisma.labVote
      .delete({ where: { proposalId_userId: { proposalId, userId: user.id } } })
      .catch(() => null);
    return this.recalcVotes(proposalId);
  }

  async comment(proposalId: string, user: AuthUser, body: string) {
    const text = (body ?? '').trim();
    if (text.length < 2) {
      throw new BadRequestException('El comentario está vacío.');
    }
    if (text.length > 2000) {
      throw new BadRequestException('El comentario es demasiado largo.');
    }
    const proposal = await this.propuestaParaParticipar(proposalId, user);
    if (
      !PUBLIC_STATUSES.includes(proposal.status) &&
      proposal.authorId !== user.id
    ) {
      throw new ForbiddenException('No puedes comentar esta propuesta.');
    }

    const comment = await this.prisma.labComment.create({
      data: { proposalId, authorId: user.id, body: text },
      include: {
        author: { select: { id: true, fullName: true, role: true } },
      },
    });
    await this.prisma.labProposal.update({
      where: { id: proposalId },
      data: { commentsCount: { increment: 1 } },
    });
    // Javier pidió enterarse también de lo que COMENTA el administrador de la
    // marca: ahí es donde acaba precisándose lo que pide. Best-effort.
    void this.avisarAlEquipo({
      clave: claveDeComentario(user.id, proposalId),
      proposalId,
      titulo: proposal.title,
      whiteLabelId: proposal.whiteLabelId,
      autorId: user.id,
      hecho: 'comentario',
    });
    return comment;
  }

  async listComments(proposalId: string, user: AuthUser, take = 50, skip = 0) {
    const visor = await this.visorDe(user);
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id: proposalId },
      select: { status: true, authorId: true, whiteLabelId: true },
    });
    this.exigirVisible(visor, proposal, user.id);
    return this.prisma.labComment.findMany({
      where: { proposalId },
      orderBy: { createdAt: 'asc' },
      take: Math.min(take, 100),
      skip,
      include: {
        author: { select: { id: true, fullName: true, role: true } },
      },
    });
  }

  // =============================================================
  //                     ADMIN — review / status
  // =============================================================
  //
  // La moderación es del equipo de la plataforma y ve TODAS las marcas. Un
  // admin de marca blanca pasa el @Roles del controlador (es SUPER_ADMIN), así
  // que el candado de verdad es `exigirModeracion` en cada método.

  async listAdmin(user: AuthUser, options: ListAdminOptions = {}) {
    const visor = await this.visorDe(user);
    exigirModeracion(visor);
    const take = Math.min(options.take ?? 30, 100);
    const skip = options.skip ?? 0;
    const where: Prisma.LabProposalWhereInput = {};
    if (options.category) where.category = options.category;
    if (options.status) where.status = options.status;
    const and: Prisma.LabProposalWhereInput[] = [];
    const porMarca = filtroAdminPorMarca(options.whiteLabelId, visor.clubifyId);
    if (porMarca) and.push(porMarca);
    if (options.q && options.q.trim()) and.push(busqueda(options.q.trim()));
    if (and.length) where.AND = and;

    let orderBy: Prisma.LabProposalOrderByWithRelationInput[] = [
      { createdAt: 'desc' },
    ];
    if (options.sortBy) {
      // Igual que el top del feed: solo lo que ya salió a votación.
      if (!options.status) where.status = { in: PUBLIC_STATUSES };
      if (options.sortBy === 'topMonth') {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        where.createdAt = { gte: since };
      }
      orderBy = [{ votesScore: 'desc' }, { createdAt: 'desc' }];
    }

    const [items, total, marcas] = await Promise.all([
      this.prisma.labProposal.findMany({
        where,
        orderBy,
        take,
        skip,
        include: {
          author: {
            select: { id: true, fullName: true, role: true, email: true },
          },
          lastStatusChangedBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.labProposal.count({ where }),
      this.marcasConPropuestas(visor.clubifyId),
    ]);
    return {
      // `siguientesEstados` lo manda el BACKEND a propósito: el panel ofrecía
      // los 7 estados sin mirar desde cuál se venía, así que elegir uno no
      // permitido devolvía un 400 y el admin no entendía por qué. Duplicar la
      // tabla en el frontend habría dejado dos copias que se separan sin que
      // nadie se entere.
      items: conEtiquetaDeMarca(items, marcas, visor.clubifyId).map((p: any) => ({
        ...p,
        siguientesEstados: transicionesPermitidas(p.status),
      })),
      total,
      take,
      skip,
      // Opciones del filtro por marca: solo las marcas blancas con propuestas.
      marcas: [...marcas.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'es'),
      ),
    };
  }

  async setStatus(
    id: string,
    status: LabStatus,
    user: AuthUser,
    reason?: string | null,
  ) {
    exigirModeracion(await this.visorDe(user));
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!proposal) throw new NotFoundException(NO_ENCONTRADA);

    if (proposal.status !== status) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[proposal.status] ?? [];
      if (!allowed.includes(status)) {
        throw new BadRequestException(
          `No se puede pasar de ${proposal.status} a ${status} directo.`,
        );
      }
    }

    const updated = await this.prisma.labProposal.update({
      where: { id },
      data: {
        status,
        rejectionReason: status === 'REJECTED' ? reason ?? null : null,
        lastStatusChangedById: user.id,
        lastStatusChangedAt: new Date(),
      },
    });

    // Notificación best-effort al autor. No bloqueamos el cambio de status
    // si el SMS o el email fallan.
    if (proposal.status !== status) {
      void this.notifyStatusChange(proposal, status, reason ?? null);
    }
    return updated;
  }

  async mergeProposals(srcId: string, dstId: string, user: AuthUser) {
    const visor = await this.visorDe(user);
    exigirModeracion(visor);
    if (srcId === dstId) {
      throw new BadRequestException('Origen y destino no pueden ser iguales.');
    }
    const [src, dst] = await Promise.all([
      this.prisma.labProposal.findUnique({ where: { id: srcId } }),
      this.prisma.labProposal.findUnique({ where: { id: dstId } }),
    ]);
    if (!src) throw new NotFoundException('Propuesta origen no encontrada.');
    if (!dst) throw new NotFoundException('Propuesta destino no encontrada.');
    // Fusionar mueve comentarios y votos. Entre marcas distintas, lo escrito
    // en el Lab de una aparecería en el de la otra.
    if (!mismaMarca(src.whiteLabelId, dst.whiteLabelId, visor.clubifyId)) {
      throw new BadRequestException(
        'No se pueden fusionar propuestas de marcas distintas.',
      );
    }

    // Transferir comentarios y votos. Los votos pueden colisionar si el user
    // ya votó en dst — en ese caso mantenemos el voto existente de dst.
    await this.prisma.$transaction(async (tx) => {
      await tx.labComment.updateMany({
        where: { proposalId: srcId },
        data: { proposalId: dstId },
      });

      const srcVotes = await tx.labVote.findMany({
        where: { proposalId: srcId },
      });
      for (const v of srcVotes) {
        const existing = await tx.labVote.findUnique({
          where: {
            proposalId_userId: { proposalId: dstId, userId: v.userId },
          },
        });
        if (existing) {
          // El user ya votó en dst — descartamos el voto duplicado de src.
          await tx.labVote.delete({ where: { id: v.id } });
        } else {
          await tx.labVote.update({
            where: { id: v.id },
            data: { proposalId: dstId },
          });
        }
      }

      await tx.labProposal.update({
        where: { id: srcId },
        data: {
          status: 'REJECTED',
          rejectionReason: `Fusionada con #${dstId}`,
          lastStatusChangedById: user.id,
          lastStatusChangedAt: new Date(),
        },
      });
    });

    await this.recalcVotes(dstId);
    await this.recalcCommentCount(dstId);
    return { ok: true, srcId, dstId };
  }

  async deleteProposal(id: string, user: AuthUser) {
    exigirModeracion(await this.visorDe(user));
    const existing = await this.prisma.labProposal.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    if (!existing) throw new NotFoundException(NO_ENCONTRADA);
    await this.prisma.labProposal.delete({ where: { id } });
    this.logger.log(
      `LabProposal "${existing.title}" (${id}) eliminada por ${user.id}`,
    );
    return { ok: true };
  }

  async metrics(user: AuthUser) {
    const visor = await this.visorDe(user);
    exigirModeracion(visor);
    const [byStatus, byCategory, topContributors, topVoted] =
      await Promise.all([
        this.prisma.labProposal.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.labProposal.groupBy({
          by: ['category'],
          _count: { _all: true },
        }),
        this.prisma.labProposal.groupBy({
          by: ['authorId'],
          _count: { _all: true },
          orderBy: { _count: { authorId: 'desc' } },
          take: 10,
        }),
        this.prisma.labProposal.findMany({
          where: { status: { in: PUBLIC_STATUSES } },
          orderBy: { votesScore: 'desc' },
          take: 10,
          include: {
            author: { select: { id: true, fullName: true } },
          },
        }),
      ]);

    const statusCounts: Record<string, number> = {};
    for (const row of byStatus) statusCounts[row.status] = row._count._all;
    const categoryCounts: Record<string, number> = {};
    for (const row of byCategory) categoryCounts[row.category] = row._count._all;

    // Resolver nombres de los contribuidores. groupBy no permite include
    // → hacemos una query extra puntual.
    const authorIds = topContributors.map((r) => r.authorId);
    const [authors, etiquetas] = await Promise.all([
      authorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, fullName: true, role: true },
          })
        : Promise.resolve([]),
      this.etiquetasDeMarca(
        topVoted.map((p) => p.whiteLabelId),
        visor.clubifyId,
      ),
    ]);
    const authorById = new Map(authors.map((a) => [a.id, a]));
    const topContributorsResolved = topContributors.map((r) => ({
      userId: r.authorId,
      fullName: authorById.get(r.authorId)?.fullName ?? '—',
      role: authorById.get(r.authorId)?.role ?? null,
      count: r._count._all,
    }));

    // Categoría más activa: la que sume más proposals.
    let mostActiveCategory: string | null = null;
    let max = 0;
    for (const [cat, count] of Object.entries(categoryCounts)) {
      if (count > max) {
        max = count;
        mostActiveCategory = cat;
      }
    }

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    return {
      totals: {
        total,
        pending: statusCounts.PENDING ?? 0,
        evaluating: statusCounts.EVALUATING ?? 0,
        approved: statusCounts.APPROVED ?? 0,
        inDevelopment: statusCounts.IN_DEVELOPMENT ?? 0,
        inTesting: statusCounts.IN_TESTING ?? 0,
        implemented: statusCounts.IMPLEMENTED ?? 0,
        rejected: statusCounts.REJECTED ?? 0,
      },
      byCategory: categoryCounts,
      mostActiveCategory,
      topContributors: topContributorsResolved,
      topVoted: conEtiquetaDeMarca(topVoted, etiquetas, visor.clubifyId),
    };
  }

  // =============================================================
  //                     INTERNALS
  // =============================================================

  /** Nombre y color de las marcas blancas de estas propuestas (sin la plataforma). */
  private async etiquetasDeMarca(
    ids: Array<string | null>,
    clubifyId: string | null,
  ): Promise<Map<string, EtiquetaMarca>> {
    const unicos = [
      ...new Set(
        ids.filter(
          (id): id is string => !!id && !esDeLaPlataforma(id, clubifyId),
        ),
      ),
    ];
    if (unicos.length === 0) return new Map();
    const rows = await this.prisma.whiteLabel.findMany({
      where: { id: { in: unicos } },
      select: { id: true, name: true, primaryColor: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        { id: r.id, name: r.name, primaryColor: r.primaryColor ?? null },
      ]),
    );
  }

  /** Las marcas blancas que tienen alguna propuesta: etiquetas y filtro de la moderación. */
  private async marcasConPropuestas(clubifyId: string | null) {
    const grupos = await this.prisma.labProposal.groupBy({
      by: ['whiteLabelId'],
      _count: { _all: true },
    });
    return this.etiquetasDeMarca(
      grupos.map((g) => g.whiteLabelId),
      clubifyId,
    );
  }

  /** Nombre de la marca de una propuesta; las de la plataforma, el de la fila Clubify. */
  private async nombreDeMarca(whiteLabelId: string | null): Promise<string | null> {
    const { clubifyId } = await resolveBrandScope(this.prisma, null);
    const id = esDeLaPlataforma(whiteLabelId, clubifyId) ? clubifyId : whiteLabelId;
    if (!id) return null;
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id },
      select: { name: true },
    });
    return wl?.name ?? null;
  }

  /**
   * SMS a la línea del equipo de Clubify cuando el administrador de una MARCA
   * BLANCA crea una propuesta o comenta. Reglas y texto en `lab-aviso.ts`.
   *
   * Tres cosas que no se pueden romper:
   *  - No avisa por lo de la plataforma (Clubify y las históricas sin marca):
   *    son muchas más y el aviso dejaría de mirarse.
   *  - No avisa dos veces por lo mismo, porque `sendInternalAlert` no trae
   *    anti-repetición propia.
   *  - No lanza nunca: el llamador la dispara con `void` y la propuesta o el
   *    comentario ya están guardados.
   */
  private async avisarAlEquipo(p: {
    /** Qué se considera «lo mismo»: ver `claveDePropuesta`/`claveDeComentario`. */
    clave: string;
    proposalId: string;
    titulo: string;
    whiteLabelId: string | null;
    autorId: string;
    hecho: HechoLab;
  }) {
    try {
      // Sin marca es de la plataforma: no hay aviso, y se sale antes de tocar
      // la memoria para no llenarla con lo de Clubify, que es la mayoría.
      if (!p.whiteLabelId) return;
      // El corte va ANTES del primer `await`. Comprobándolo después, dos
      // comentarios seguidos pasaban los dos por el hueco y salían dos SMS:
      // leer-decidir-escribir sin atomicidad, el de siempre.
      if (this.avisos.esRepetido(p.clave)) return;

      const { clubifyId } = await resolveBrandScope(this.prisma, null);
      if (!debeAvisarAlEquipo(p.whiteLabelId, clubifyId)) return;

      const [marca, autor] = await Promise.all([
        this.nombreDeMarca(p.whiteLabelId),
        this.prisma.user.findUnique({
          where: { id: p.autorId },
          select: { fullName: true },
        }),
      ]);
      // El enlace es el de la moderación de la plataforma, que es donde el
      // equipo la trabaja. Va solo a un teléfono de casa: no es fuga de marca.
      const enlace = enlaceDeModeracion(
        process.env.APP_URL ?? 'https://app.soyclubify.com',
        p.proposalId,
      );
      const r = await this.alerts.sendInternalAlert(
        TELEFONO_EQUIPO_LAB,
        textoAvisoLab({
          marca,
          autor: autor?.fullName ?? null,
          titulo: p.titulo,
          enlace,
          hecho: p.hecho,
        }),
      );
      // `sendInternalAlert` NO lanza: captura sus errores y devuelve ok:false
      // (sin subcuenta de Grow Business, por ejemplo). Sin este warn, un SMS
      // que no sale no deja rastro en ningún sitio y nadie se entera.
      if (!r?.ok) {
        this.logger.warn(
          `Lab aviso al equipo no salió (${p.clave}): sendInternalAlert devolvió ok:false`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `Lab aviso al equipo falló (${p.clave}): ${(e as Error)?.message ?? e}`,
      );
    }
  }

  private async recalcVotes(proposalId: string) {
    const votes = await this.prisma.labVote.findMany({
      where: { proposalId },
      select: { kind: true },
    });
    let score = 0;
    for (const v of votes) score += VOTE_WEIGHTS[v.kind];
    return this.prisma.labProposal.update({
      where: { id: proposalId },
      data: { votesScore: score, votesCount: votes.length },
    });
  }

  private async recalcCommentCount(proposalId: string) {
    const commentsCount = await this.prisma.labComment.count({
      where: { proposalId },
    });
    return this.prisma.labProposal.update({
      where: { id: proposalId },
      data: { commentsCount },
    });
  }

  /**
   * Best-effort: avisamos al equipo + al autor cuando cambia el status.
   * Cualquier fallo se loguea pero no rompe el setStatus.
   */
  private async notifyStatusChange(
    proposal: {
      id: string;
      title: string;
      whiteLabelId: string | null;
      author: { fullName: string; email: string } | null;
    },
    newStatus: LabStatus,
    reason: string | null,
  ) {
    try {
      const marca = await this.nombreDeMarca(proposal.whiteLabelId);
      await this.alerts.sendTeamAlert(
        textoAvisoEquipoLab({
          marca,
          titulo: proposal.title,
          estado: newStatus,
          motivo: reason,
        }),
        'lab',
      );
    } catch (e) {
      this.logger.warn(
        `Lab team alert falló: ${(e as Error)?.message ?? e}`,
      );
    }

    if (!proposal.author?.email) return;
    try {
      // Solo propuestas de la plataforma. Ahora el autor puede ser el
      // administrador de una marca blanca, y este correo lleva un enlace fijo a
      // app.soyclubify.com y la firma genérica de la plataforma: fuga de marca.
      //
      // El transporte pasa a ser Grow Business: `EmailService.send` no mandaba
      // nada en producción —sin `RESEND_API_KEY` cae al adaptador de consola y
      // devuelve «ok»—, así que este aviso no ha salido nunca. Va por la
      // plataforma porque el filtro de arriba ya garantiza que es suya.
      const { clubifyId } = await resolveBrandScope(this.prisma, null);
      if (!esDeLaPlataforma(proposal.whiteLabelId, clubifyId)) return;
      await this.brandEmail.sendRaw({
        whiteLabelId: null,
        to: proposal.author.email,
        subject: `Tu propuesta en el Lab cambió de estado`,
        html: `
          <p>Hola ${proposal.author.fullName},</p>
          <p>Tu propuesta <b>"${proposal.title}"</b> ahora está en estado
            <b>${newStatus}</b>.</p>
          ${reason ? `<p><i>${reason}</i></p>` : ''}
          <p>Puedes verla en <a href="https://app.soyclubify.com/lab/${proposal.id}">el Lab</a>.</p>
          <p>— El equipo</p>
        `,
      });
    } catch (e) {
      this.logger.warn(
        `Lab autor email falló: ${(e as Error)?.message ?? e}`,
      );
    }
  }
}
