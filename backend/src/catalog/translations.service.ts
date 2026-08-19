import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  TRANSLATABLE_ENTITY_TYPES,
  TRANSLATABLE_FIELDS,
  TranslatableEntityType,
  TranslatableField,
  TranslationService,
} from './translation.service';

// Locales que el admin puede gestionar. ES queda fuera porque es la
// fuente canónica (lo que el dueño escribe en /app/menu o /app/storefront).
const TARGET_LOCALES = ['en', 'pt'] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

type FieldSpec = {
  entityType: TranslatableEntityType;
  entityId: string;
  field: TranslatableField;
  sourceText: string;
  /// Etiqueta humana para que el admin entienda QUÉ está editando.
  /// Ej: "Café caliente · descripción" o "Producto Capuchino · nombre".
  contextLabel: string;
  /// Etiqueta corta de la entidad raíz para agrupar en la UI.
  group: string;
};

@Injectable()
export class TranslationsAdminService {
  constructor(
    private prisma: PrismaService,
    private translator: TranslationService,
  ) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /**
   * Valida entityType, field y locale contra los sets oficiales.
   * Sin esto, un cliente podría crear filas basura en MenuTranslation
   * con `entityType='admin'` o `field='password'` (no es exploit pero
   * pollutea la cache y rompe asunciones del listado).
   */
  private validateKey(entityType: string, field: string, locale: string) {
    if (!TRANSLATABLE_ENTITY_TYPES.includes(entityType as TranslatableEntityType)) {
      throw new BadRequestException(`entityType inválido: ${entityType}`);
    }
    if (!TRANSLATABLE_FIELDS.includes(field as TranslatableField)) {
      throw new BadRequestException(`field inválido: ${field}`);
    }
    if (!TARGET_LOCALES.includes(locale as TargetLocale)) {
      throw new BadRequestException(`Locale inválido: ${locale}`);
    }
  }

  /**
   * Lista TODOS los strings traducibles del tenant + estado actual de
   * traducción (auto / manual / missing / stale) para EN y PT. Una row
   * por (entityType, entityId, field).
   */
  async list(user: AuthUser, override?: string) {
    const tenantId = this.tid(user, override);

    // 1. Levantar todas las entidades fuente del tenant
    const [tenant, categories, products, promotions, cards, infoLinks] =
      await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            brandName: true,
            storefront: { select: { description: true } },
          },
        }),
        this.prisma.category.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            description: true,
            tagline: true,
            parentId: true,
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.product.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            description: true,
            category: { select: { name: true } },
            variants: {
              select: {
                id: true,
                name: true,
                groupName: true,
              },
            },
            extras: { select: { id: true, name: true } },
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.promotion.findMany({
          where: { tenantId },
          select: { id: true, name: true, description: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.card.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            description: true,
            rewardText: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.infoLink.findMany({
          where: { tenantId },
          select: { id: true, title: true, subtitle: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const fields: FieldSpec[] = [];

    // Storefront description (singleton por tenant)
    if (tenant.storefront?.description) {
      fields.push({
        entityType: 'storefront',
        entityId: tenant.id,
        field: 'description',
        sourceText: tenant.storefront.description,
        contextLabel: `${tenant.brandName} · subtítulo`,
        group: 'Storefront',
      });
    }

    // Categorías y subcategorías
    const catNameById = new Map(categories.map((c) => [c.id, c.name]));
    for (const c of categories) {
      const parentLabel = c.parentId
        ? `${catNameById.get(c.parentId) ?? '?'} › ${c.name}`
        : c.name;
      const group = c.parentId ? `Subsección · ${parentLabel}` : `Sección · ${c.name}`;
      if (c.name) {
        fields.push({
          entityType: 'category',
          entityId: c.id,
          field: 'name',
          sourceText: c.name,
          contextLabel: `${parentLabel} · nombre`,
          group,
        });
      }
      if (c.description) {
        fields.push({
          entityType: 'category',
          entityId: c.id,
          field: 'description',
          sourceText: c.description,
          contextLabel: `${parentLabel} · descripción`,
          group,
        });
      }
      if (c.tagline) {
        fields.push({
          entityType: 'category',
          entityId: c.id,
          field: 'tagline',
          sourceText: c.tagline,
          contextLabel: `${parentLabel} · tagline`,
          group,
        });
      }
    }

    // Productos + variantes + extras
    for (const p of products) {
      const productLabel = p.name;
      const group = `Producto · ${p.category?.name ?? '?'} › ${productLabel}`;
      if (p.name) {
        fields.push({
          entityType: 'product',
          entityId: p.id,
          field: 'name',
          sourceText: p.name,
          contextLabel: `${productLabel} · nombre`,
          group,
        });
      }
      if (p.description) {
        fields.push({
          entityType: 'product',
          entityId: p.id,
          field: 'description',
          sourceText: p.description,
          contextLabel: `${productLabel} · descripción`,
          group,
        });
      }
      for (const v of p.variants) {
        if (v.name) {
          fields.push({
            entityType: 'variant',
            entityId: v.id,
            field: 'name',
            sourceText: v.name,
            contextLabel: `${productLabel} · variante "${v.name}"`,
            group,
          });
        }
        if (v.groupName) {
          fields.push({
            entityType: 'variant',
            entityId: v.id,
            field: 'groupName',
            sourceText: v.groupName,
            contextLabel: `${productLabel} · grupo de variantes "${v.groupName}"`,
            group,
          });
        }
      }
      for (const e of p.extras) {
        if (e.name) {
          fields.push({
            entityType: 'extra',
            entityId: e.id,
            field: 'name',
            sourceText: e.name,
            contextLabel: `${productLabel} · adicional "${e.name}"`,
            group,
          });
        }
      }
    }

    // Promociones
    for (const promo of promotions) {
      const group = `Promoción · ${promo.name}`;
      if (promo.name) {
        fields.push({
          entityType: 'promotion',
          entityId: promo.id,
          field: 'name',
          sourceText: promo.name,
          contextLabel: `${promo.name} · nombre`,
          group,
        });
      }
      if (promo.description) {
        fields.push({
          entityType: 'promotion',
          entityId: promo.id,
          field: 'description',
          sourceText: promo.description,
          contextLabel: `${promo.name} · descripción`,
          group,
        });
      }
    }

    // Tarjetas de fidelización (sólo campos visibles en página pública de
    // enrollment — name, description, rewardText). terms / mensajes
    // automáticos quedan en ES por ahora.
    for (const card of cards) {
      const group = `Tarjeta · ${card.name}`;
      if (card.name) {
        fields.push({
          entityType: 'card',
          entityId: card.id,
          field: 'name',
          sourceText: card.name,
          contextLabel: `${card.name} · nombre`,
          group,
        });
      }
      if (card.description) {
        fields.push({
          entityType: 'card',
          entityId: card.id,
          field: 'description',
          sourceText: card.description,
          contextLabel: `${card.name} · descripción`,
          group,
        });
      }
      if (card.rewardText) {
        fields.push({
          entityType: 'card',
          entityId: card.id,
          field: 'rewardText',
          sourceText: card.rewardText,
          contextLabel: `${card.name} · recompensa`,
          group,
        });
      }
    }

    // InfoLinks (páginas tipo Linktree). Sólo title + subtitle — el JSON
    // de sections/buttons queda en ES por ser estructura compleja.
    for (const link of infoLinks) {
      const group = `Info Link · ${link.title}`;
      if (link.title) {
        fields.push({
          entityType: 'infolink',
          entityId: link.id,
          field: 'title',
          sourceText: link.title,
          contextLabel: `${link.title} · título`,
          group,
        });
      }
      if (link.subtitle) {
        fields.push({
          entityType: 'infolink',
          entityId: link.id,
          field: 'subtitle',
          sourceText: link.subtitle,
          contextLabel: `${link.title} · subtítulo`,
          group,
        });
      }
    }

    // 2. Bulk lookup de cache de traducciones para todas las (entity,field)
    const cached = await this.prisma.menuTranslation.findMany({
      where: {
        tenantId,
        locale: { in: [...TARGET_LOCALES] },
        OR: fields.map((f) => ({
          entityType: f.entityType,
          entityId: f.entityId,
          field: f.field,
        })),
      },
    });
    const cacheByKey = new Map<string, (typeof cached)[number]>();
    for (const c of cached) {
      cacheByKey.set(
        `${c.entityType}:${c.entityId}:${c.field}:${c.locale}`,
        c,
      );
    }

    // 3. Armar la respuesta + stats
    const rows = fields.map((f) => {
      const baseKey = `${f.entityType}:${f.entityId}:${f.field}`;
      const en = cacheByKey.get(`${baseKey}:en`);
      const pt = cacheByKey.get(`${baseKey}:pt`);
      const trStatus = (
        c: (typeof cached)[number] | undefined,
      ): { text: string; source: 'auto' | 'manual'; stale: boolean } | null => {
        if (!c) return null;
        return {
          text: c.text,
          source: c.source as 'auto' | 'manual',
          stale: c.sourceText !== f.sourceText,
        };
      };
      return {
        entityType: f.entityType,
        entityId: f.entityId,
        field: f.field,
        sourceText: f.sourceText,
        contextLabel: f.contextLabel,
        group: f.group,
        en: trStatus(en),
        pt: trStatus(pt),
      };
    });

    const stats = {
      total: rows.length,
      missing: { en: 0, pt: 0 },
      manual: { en: 0, pt: 0 },
      stale: { en: 0, pt: 0 },
    };
    for (const r of rows) {
      for (const loc of TARGET_LOCALES) {
        const t = r[loc];
        if (!t) stats.missing[loc]++;
        else {
          if (t.source === 'manual') stats.manual[loc]++;
          if (t.stale) stats.stale[loc]++;
        }
      }
    }

    return { rows, stats };
  }

  /**
   * Override manual del admin. Pisa siempre la traducción automática y
   * NO se invalida cuando cambia el sourceText (a propósito — la
   * decisión del dueño manda; si quiere regenerar, hace explícito el
   * call a regenerate).
   */
  async setManual(
    user: AuthUser,
    entityType: string,
    entityId: string,
    field: string,
    locale: string,
    text: string,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    this.validateKey(entityType, field, locale);
    if (!text || !text.trim()) {
      throw new BadRequestException('Texto vacío');
    }
    if (text.length > 5000) {
      throw new BadRequestException('Texto muy largo (máx 5000 chars)');
    }
    // Snapshot del sourceText actual al momento del override
    const sourceText = await this.lookupSourceText(
      tenantId,
      entityType,
      entityId,
      field,
    );
    return this.prisma.menuTranslation.upsert({
      where: {
        tenantId_entityType_entityId_field_locale: {
          tenantId,
          entityType,
          entityId,
          field,
          locale,
        },
      },
      update: {
        text: text.trim(),
        sourceText,
        source: 'manual',
      },
      create: {
        tenantId,
        entityType,
        entityId,
        field,
        locale,
        text: text.trim(),
        sourceText,
        source: 'manual',
      },
    });
  }

  /**
   * Borra la traducción cacheada (auto o manual). Próximo request al
   * menú público re-traducirá automáticamente vía Claude.
   */
  async clear(
    user: AuthUser,
    entityType: string,
    entityId: string,
    field: string,
    locale: string,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    this.validateKey(entityType, field, locale);
    try {
      await this.prisma.menuTranslation.delete({
        where: {
          tenantId_entityType_entityId_field_locale: {
            tenantId,
            entityType,
            entityId,
            field,
            locale,
          },
        },
      });
    } catch {
      // No existía — idempotente, OK.
    }
    return { ok: true };
  }

  /**
   * Forza una nueva traducción automática vía Claude. Útil cuando el
   * sourceText cambió y el admin quiere refrescar sin esperar al
   * próximo request público.
   */
  async regenerate(
    user: AuthUser,
    entityType: string,
    entityId: string,
    field: string,
    locale: string,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    this.validateKey(entityType, field, locale);
    const sourceText = await this.lookupSourceText(
      tenantId,
      entityType,
      entityId,
      field,
    );
    if (!sourceText) {
      throw new NotFoundException('Texto fuente no encontrado');
    }
    // Borrar el row existente para forzar miss en la cache. El batch
    // re-llamará a Claude y persistirá el nuevo valor con source='auto'.
    await this.prisma.menuTranslation.deleteMany({
      where: {
        tenantId,
        entityType,
        entityId,
        field,
        locale,
      },
    });
    // Botón MANUAL del admin: a diferencia del menú público (fallback silencioso),
    // acá SÍ mostramos el motivo real si la IA falla — "nada falla en silencio".
    if (!this.translator.available) {
      throw new ServiceUnavailableException(
        'La traducción por IA no está configurada (falta la API key). Avisá al administrador.',
      );
    }
    let result: Map<string, string>;
    try {
      result = await this.translator.translateMenuBatch(
        tenantId,
        [
          {
            entityType: entityType as any,
            entityId,
            field: field as any,
            text: sourceText,
          },
        ],
        locale,
        { throwOnAiError: true },
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '');
      const friendly = /credit balance|billing|quota|insufficient|payment/i.test(msg)
        ? 'La IA no tiene crédito disponible. Recargá crédito en Plans & Billing (Anthropic) y volvé a intentar.'
        : /rate limit|429|overloaded/i.test(msg)
          ? 'La IA está saturada ahora mismo. Probá de nuevo en un minuto.'
          : /model|not found|404/i.test(msg)
            ? 'El modelo de IA no está disponible para esta cuenta.'
            : 'La traducción por IA no está disponible ahora. Intentá más tarde.';
      throw new ServiceUnavailableException(friendly);
    }
    const newText = result.get(`${entityType}:${entityId}:${field}`);
    return { text: newText ?? sourceText };
  }

  /**
   * Devuelve el sourceText (en ES) actual de la entidad. Hace una
   * select directa al modelo correspondiente. Si no existe la
   * entidad o el campo está vacío, devuelve "".
   */
  private async lookupSourceText(
    tenantId: string,
    entityType: string,
    entityId: string,
    field: string,
  ): Promise<string> {
    if (entityType === 'storefront') {
      const sf = await this.prisma.storefront.findUnique({
        where: { tenantId },
        select: { description: true },
      });
      if (field === 'description') return sf?.description ?? '';
    }
    if (entityType === 'category') {
      const c = await this.prisma.category.findFirst({
        where: { id: entityId, tenantId },
        select: { name: true, description: true, tagline: true },
      });
      if (!c) return '';
      if (field === 'name') return c.name ?? '';
      if (field === 'description') return c.description ?? '';
      if (field === 'tagline') return c.tagline ?? '';
    }
    if (entityType === 'product') {
      const p = await this.prisma.product.findFirst({
        where: { id: entityId, tenantId },
        select: { name: true, description: true },
      });
      if (!p) return '';
      if (field === 'name') return p.name ?? '';
      if (field === 'description') return p.description ?? '';
    }
    if (entityType === 'variant') {
      const v = await this.prisma.productVariant.findFirst({
        where: { id: entityId, product: { tenantId } },
        select: { name: true, groupName: true },
      });
      if (!v) return '';
      if (field === 'name') return v.name ?? '';
      if (field === 'groupName') return v.groupName ?? '';
    }
    if (entityType === 'extra') {
      const e = await this.prisma.productExtra.findFirst({
        where: { id: entityId, product: { tenantId } },
        select: { name: true },
      });
      if (!e) return '';
      if (field === 'name') return e.name ?? '';
    }
    if (entityType === 'promotion') {
      const p = await this.prisma.promotion.findFirst({
        where: { id: entityId, tenantId },
        select: { name: true, description: true },
      });
      if (!p) return '';
      if (field === 'name') return p.name ?? '';
      if (field === 'description') return p.description ?? '';
    }
    if (entityType === 'card') {
      const c = await this.prisma.card.findFirst({
        where: { id: entityId, tenantId },
        select: { name: true, description: true, rewardText: true },
      });
      if (!c) return '';
      if (field === 'name') return c.name ?? '';
      if (field === 'description') return c.description ?? '';
      if (field === 'rewardText') return c.rewardText ?? '';
    }
    if (entityType === 'infolink') {
      const il = await this.prisma.infoLink.findFirst({
        where: { id: entityId, tenantId },
        select: { title: true, subtitle: true },
      });
      if (!il) return '';
      if (field === 'title') return il.title ?? '';
      if (field === 'subtitle') return il.subtitle ?? '';
    }
    return '';
  }
}
