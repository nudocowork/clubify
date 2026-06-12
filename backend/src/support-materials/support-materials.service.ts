import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SupportMaterialAudience,
  SupportMaterialType,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { hasAdminBypass } from '../common/roles/admin-bypass';

export type CreateSupportMaterialDto = {
  title: string;
  description?: string;
  type: SupportMaterialType;
  fileUrl?: string | null;
  externalUrl?: string | null;
  thumbnailUrl?: string | null;
  scriptBody?: string | null;
  category?: string;
  audience: SupportMaterialAudience;
  scopeInfluencerId?: string | null;
  order?: number;
  isActive?: boolean;
};

@Injectable()
export class SupportMaterialsService {
  constructor(private prisma: PrismaService) {}

  /** Lista todos los materiales — solo super admin. */
  async listAll(user: AuthUser) {
    if (!hasAdminBypass(user.role)) throw new ForbiddenException();
    return this.prisma.supportMaterial.findMany({
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
      include: {
        scopeInfluencer: {
          select: { id: true, code: true, ownerName: true },
        },
      },
    });
  }

  /** Lista categorías únicas — útil para autocomplete en el editor admin. */
  async listCategories(user: AuthUser) {
    if (!hasAdminBypass(user.role)) throw new ForbiddenException();
    const rows = await this.prisma.supportMaterial.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => r.category).filter(Boolean);
  }

  /**
   * Lista los materiales visibles para el afiliado autenticado.
   * Aplica filtros de audience y scope:
   * - audience: matchea su rol (INFLUENCER / AMBASSADOR / VENDOR / BOTH / ALL)
   * - scope: si el material tiene scopeInfluencerId, solo lo ven:
   *   - El propio influencer dueño del code, o
   *   - Embajadores cuyo parentCode es ese influencer, o
   *   - Vendors cuyo embajador padre tiene ese influencer como parent
   *
   * Fix 2026-06-12 (F): antes el VENDOR no estaba contemplado en el
   * gate inicial → respuesta 403. Ahora hereda los materiales que ve
   * su embajador padre (AMBASSADOR + BOTH + ALL), más los específicos
   * para VENDOR.
   */
  async listForAffiliate(user: AuthUser) {
    if (
      user.role !== 'AFFILIATE_INFLUENCER' &&
      user.role !== 'AFFILIATE_AMBASSADOR' &&
      user.role !== 'AFFILIATE_SOCIO' &&
      user.role !== 'AFFILIATE_VENDOR'
    ) {
      throw new ForbiddenException('No es un afiliado');
    }

    // Cargar mi código + parents para resolver el influencerId con el
    // que se podría scopear material. Para vendor: leer el code de su
    // embajador padre (vía parentEmbajadorCodeId) para heredar scope.
    const myCode = await this.prisma.referralCode.findFirst({
      where: { ownerUserId: user.id },
      select: {
        id: true,
        role: true,
        parentCodeId: true,
        parentEmbajadorCodeId: true,
      },
    });
    let myInfluencerId: string | null = null;
    if (myCode?.role === 'INFLUENCER') {
      myInfluencerId = myCode.id;
    } else if (myCode?.role === 'AMBASSADOR') {
      myInfluencerId = myCode.parentCodeId ?? null;
    } else if (myCode?.role === 'VENDOR' && myCode.parentEmbajadorCodeId) {
      const parentAmbassador = await this.prisma.referralCode.findUnique({
        where: { id: myCode.parentEmbajadorCodeId },
        select: { parentCodeId: true },
      });
      myInfluencerId = parentAmbassador?.parentCodeId ?? null;
    }

    const audienceFilter: SupportMaterialAudience[] = ['BOTH', 'ALL'];
    if (user.role === 'AFFILIATE_INFLUENCER') audienceFilter.push('INFLUENCER');
    if (user.role === 'AFFILIATE_AMBASSADOR' || user.role === 'AFFILIATE_SOCIO')
      audienceFilter.push('AMBASSADOR');
    if (user.role === 'AFFILIATE_VENDOR') {
      // Vendor hereda lo del embajador padre + ve material específico
      // para vendors. INFLUENCER queda fuera (no es para él).
      audienceFilter.push('AMBASSADOR');
      audienceFilter.push('VENDOR');
    }

    const where: Prisma.SupportMaterialWhereInput = {
      isActive: true,
      audience: { in: audienceFilter },
      OR: [
        { scopeInfluencerId: null },
        ...(myInfluencerId ? [{ scopeInfluencerId: myInfluencerId }] : []),
      ],
    };

    return this.prisma.supportMaterial.findMany({
      where,
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        fileUrl: true,
        externalUrl: true,
        thumbnailUrl: true,
        scriptBody: true,
        category: true,
        createdAt: true,
      },
    });
  }

  async getById(user: AuthUser, id: string) {
    if (!hasAdminBypass(user.role)) throw new ForbiddenException();
    const m = await this.prisma.supportMaterial.findUnique({
      where: { id },
      include: {
        scopeInfluencer: {
          select: { id: true, code: true, ownerName: true },
        },
      },
    });
    if (!m) throw new NotFoundException('Material no encontrado');
    return m;
  }

  async create(user: AuthUser, dto: CreateSupportMaterialDto) {
    if (!hasAdminBypass(user.role)) throw new ForbiddenException();
    // Validación defensiva: al menos una de fileUrl/externalUrl/scriptBody.
    // Sin esto, un material vacío rompería el render del front.
    if (!dto.fileUrl && !dto.externalUrl && !dto.scriptBody) {
      throw new ForbiddenException(
        'Carga un archivo, un link externo o el contenido del script.',
      );
    }
    return this.prisma.supportMaterial.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        type: dto.type,
        fileUrl: dto.fileUrl ?? null,
        externalUrl: dto.externalUrl ?? null,
        thumbnailUrl: dto.thumbnailUrl ?? null,
        scriptBody: dto.scriptBody ?? null,
        category: dto.category?.trim() || 'General',
        audience: dto.audience,
        scopeInfluencerId: dto.scopeInfluencerId ?? null,
        order: dto.order ?? 0,
        isActive: dto.isActive ?? true,
        createdById: user.id,
      },
    });
  }

  async update(
    user: AuthUser,
    id: string,
    dto: Partial<CreateSupportMaterialDto>,
  ) {
    if (!hasAdminBypass(user.role)) throw new ForbiddenException();
    await this.getById(user, id);
    return this.prisma.supportMaterial.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        description: dto.description === undefined ? undefined : dto.description,
        type: dto.type ?? undefined,
        fileUrl: dto.fileUrl === undefined ? undefined : dto.fileUrl,
        externalUrl:
          dto.externalUrl === undefined ? undefined : dto.externalUrl,
        thumbnailUrl:
          dto.thumbnailUrl === undefined ? undefined : dto.thumbnailUrl,
        scriptBody: dto.scriptBody === undefined ? undefined : dto.scriptBody,
        category: dto.category === undefined ? undefined : dto.category.trim() || 'General',
        audience: dto.audience ?? undefined,
        scopeInfluencerId:
          dto.scopeInfluencerId === undefined ? undefined : dto.scopeInfluencerId,
        order: dto.order ?? undefined,
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    if (!hasAdminBypass(user.role)) throw new ForbiddenException();
    await this.getById(user, id);
    await this.prisma.supportMaterial.delete({ where: { id } });
    return { ok: true };
  }

  /** Reordena materiales — recibe array de {id, order} para batch update. */
  async reorder(user: AuthUser, items: Array<{ id: string; order: number }>) {
    if (!hasAdminBypass(user.role)) throw new ForbiddenException();
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.supportMaterial.update({
          where: { id: it.id },
          data: { order: it.order },
        }),
      ),
    );
    return { ok: true };
  }
}
