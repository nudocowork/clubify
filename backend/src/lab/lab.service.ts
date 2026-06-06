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
import { EmailService } from '../email/email.service';

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
  take?: number;
  skip?: number;
}

@Injectable()
export class LabService {
  private logger = new Logger(LabService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
    private email: EmailService,
  ) {}

  // =============================================================
  //                     PROPOSALS — públicas
  // =============================================================

  async createProposal(userId: string, dto: CreateProposalInput) {
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
    return this.prisma.labProposal.create({
      data: {
        title,
        description,
        category: dto.category,
        priority: dto.priority ?? 'MEDIUM',
        expectedBenefit: dto.expectedBenefit?.trim() || null,
        attachmentUrl: dto.attachmentUrl || null,
        attachmentKind: dto.attachmentKind || null,
        authorId: userId,
      },
    });
  }

  async listPublic(category: LabCategory, options: ListPublicOptions = {}) {
    const take = Math.min(options.take ?? 20, 50);
    const skip = options.skip ?? 0;
    const where: Prisma.LabProposalWhereInput = {
      category,
      status: options.status ?? { in: PUBLIC_STATUSES },
    };
    if (options.q && options.q.trim()) {
      const q = options.q.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

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
    return { items, total, take, skip };
  }

  async getById(id: string, userId: string) {
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, fullName: true, role: true, email: true },
        },
        lastStatusChangedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada.');

    // Si está PENDING o REJECTED, solo la ve el autor (o admin via /admin/lab).
    if (!PUBLIC_STATUSES.includes(proposal.status)) {
      if (proposal.authorId !== userId) {
        throw new NotFoundException('Propuesta no encontrada.');
      }
    }

    const [myVote, comments, voteBreakdown] = await Promise.all([
      this.prisma.labVote.findUnique({
        where: { proposalId_userId: { proposalId: id, userId } },
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

    return { ...proposal, myVote, comments, voteBreakdown: breakdown };
  }

  async vote(proposalId: string, userId: string, kind: LabVoteKind) {
    if (!VOTE_WEIGHTS[kind]) {
      throw new BadRequestException('Tipo de voto inválido.');
    }
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id: proposalId },
      select: { id: true, status: true, authorId: true },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada.');
    // Solo se vota sobre propuestas públicas (el autor puede ver pero no
    // votar sobre PENDING/REJECTED — no tendría sentido).
    if (!PUBLIC_STATUSES.includes(proposal.status)) {
      throw new ForbiddenException('No puedes votar esta propuesta.');
    }

    await this.prisma.labVote.upsert({
      where: { proposalId_userId: { proposalId, userId } },
      create: { proposalId, userId, kind },
      update: { kind },
    });
    return this.recalcVotes(proposalId);
  }

  async removeVote(proposalId: string, userId: string) {
    await this.prisma.labVote
      .delete({ where: { proposalId_userId: { proposalId, userId } } })
      .catch(() => null);
    return this.recalcVotes(proposalId);
  }

  async comment(proposalId: string, userId: string, body: string) {
    const text = (body ?? '').trim();
    if (text.length < 2) {
      throw new BadRequestException('El comentario está vacío.');
    }
    if (text.length > 2000) {
      throw new BadRequestException('El comentario es demasiado largo.');
    }
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id: proposalId },
      select: { id: true, status: true, authorId: true },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada.');
    if (
      !PUBLIC_STATUSES.includes(proposal.status) &&
      proposal.authorId !== userId
    ) {
      throw new ForbiddenException('No puedes comentar esta propuesta.');
    }

    const comment = await this.prisma.labComment.create({
      data: { proposalId, authorId: userId, body: text },
      include: {
        author: { select: { id: true, fullName: true, role: true } },
      },
    });
    await this.prisma.labProposal.update({
      where: { id: proposalId },
      data: { commentsCount: { increment: 1 } },
    });
    return comment;
  }

  async listComments(proposalId: string, take = 50, skip = 0) {
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

  async listAdmin(options: ListAdminOptions = {}) {
    const take = Math.min(options.take ?? 30, 100);
    const skip = options.skip ?? 0;
    const where: Prisma.LabProposalWhereInput = {};
    if (options.category) where.category = options.category;
    if (options.status) where.status = options.status;
    if (options.q && options.q.trim()) {
      const q = options.q.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.labProposal.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
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
    ]);
    return { items, total, take, skip };
  }

  async setStatus(
    id: string,
    status: LabStatus,
    adminUserId: string,
    reason?: string | null,
  ) {
    const proposal = await this.prisma.labProposal.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada.');

    const updated = await this.prisma.labProposal.update({
      where: { id },
      data: {
        status,
        rejectionReason: status === 'REJECTED' ? reason ?? null : null,
        lastStatusChangedById: adminUserId,
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

  async mergeProposals(srcId: string, dstId: string, adminUserId: string) {
    if (srcId === dstId) {
      throw new BadRequestException('Origen y destino no pueden ser iguales.');
    }
    const [src, dst] = await Promise.all([
      this.prisma.labProposal.findUnique({ where: { id: srcId } }),
      this.prisma.labProposal.findUnique({ where: { id: dstId } }),
    ]);
    if (!src) throw new NotFoundException('Propuesta origen no encontrada.');
    if (!dst) throw new NotFoundException('Propuesta destino no encontrada.');

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
          lastStatusChangedById: adminUserId,
          lastStatusChangedAt: new Date(),
        },
      });
    });

    await this.recalcVotes(dstId);
    await this.recalcCommentCount(dstId);
    return { ok: true, srcId, dstId };
  }

  async deleteProposal(id: string, adminUserId: string) {
    const existing = await this.prisma.labProposal.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    if (!existing) throw new NotFoundException('Propuesta no encontrada.');
    await this.prisma.labProposal.delete({ where: { id } });
    this.logger.log(
      `LabProposal "${existing.title}" (${id}) eliminada por ${adminUserId}`,
    );
    return { ok: true };
  }

  async metrics() {
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
    const authors = authorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, fullName: true, role: true },
        })
      : [];
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
      topVoted,
    };
  }

  // =============================================================
  //                     INTERNALS
  // =============================================================

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
    proposal: { id: string; title: string; author: { fullName: string; email: string } | null },
    newStatus: LabStatus,
    reason: string | null,
  ) {
    const teamBody =
      `Clubify Lab: la propuesta "${proposal.title}" cambió a ${newStatus}` +
      (reason ? ` (motivo: ${reason})` : '');
    try {
      await this.alerts.sendTeamAlert(teamBody);
    } catch (e) {
      this.logger.warn(
        `Lab team alert falló: ${(e as Error)?.message ?? e}`,
      );
    }

    if (!proposal.author?.email) return;
    try {
      await this.email.send({
        to: proposal.author.email,
        subject: `Tu propuesta en Clubify Lab cambió de estado`,
        html: `
          <p>Hola ${proposal.author.fullName},</p>
          <p>Tu propuesta <b>"${proposal.title}"</b> ahora está en estado
            <b>${newStatus}</b>.</p>
          ${reason ? `<p><i>${reason}</i></p>` : ''}
          <p>Puedes verla en <a href="https://app.soyclubify.com/lab/${proposal.id}">Clubify Lab</a>.</p>
          <p>— El equipo de Clubify</p>
        `,
      });
    } catch (e) {
      this.logger.warn(
        `Lab autor email falló: ${(e as Error)?.message ?? e}`,
      );
    }
  }
}
