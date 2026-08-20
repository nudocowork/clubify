import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import {
  resolveBrandScope,
  brandWhiteLabelWhere,
} from '../common/white-label/brand-scope.util';
import { SMS_TEMPLATES } from '../billing/sms-templates';
import { brandMsgCatalog } from '../integrations/brand-message-templates';

/**
 * Lectura del historial de envíos (`MessageLog`): la pantalla que responde
 * «¿se enviaron los recordatorios de cobro de las cuentas de X marca?» sin
 * correr scripts a mano.
 *
 * Aislamiento por marca — dos decisiones deliberadas:
 *
 * 1. Las queries corren con `TenantContext.runWithoutTenant()`. MessageLog SÍ
 *    tiene `tenantId`, así que en una sesión de marca el middleware Prisma le
 *    inyectaría `tenantId IN (negocios de la marca)` — y eso ESCONDE las filas
 *    con `tenantId` null (avisos a la marca, envíos donde el contexto no traía
 *    negocio). Un aviso de marca que "desaparece" del historial se lee como
 *    «no se envió», que es justo el malentendido que esta pantalla viene a
 *    evitar. Por eso el scoping lo hacemos acá, explícito, por `whiteLabelId`.
 *
 * 2. El scoping usa `resolveBrandScope` + `brandWhiteLabelWhere`, la MISMA
 *    regla que ya usan comisiones y el mapa: sin marca en sesión → default
 *    Clubify (que incluye las filas legacy con whiteLabelId null); otra marca
 *    → estricto a su id. Solo PLATFORM_OWNER ve todo y puede elegir marca.
 */

type ListFilters = {
  /** Solo se honra para PLATFORM_OWNER; 'none' = filas sin marca. */
  whiteLabelId?: string | null;
  channel?: string | null;
  status?: string | null;
  templateId?: string | null;
  tenantId?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
};

type Caller = { role: string; whiteLabelId?: string | null };

/**
 * templateId → nombre humano, desde los catálogos existentes (SMS de billing,
 * administrativas/operativas y correos). Cache de módulo: los catálogos son
 * constantes en runtime.
 */
let _labelCache: Map<string, string> | null = null;
function templateLabel(id: string | null): string | null {
  if (!id) return null;
  if (!_labelCache) {
    _labelCache = new Map<string, string>();
    for (const t of SMS_TEMPLATES) _labelCache.set(t.id, t.label);
    for (const t of brandMsgCatalog()) _labelCache.set(t.id, t.label);
  }
  return _labelCache.get(id) ?? id;
}

function parseDateParam(raw: string, param: string): Date {
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    throw new BadRequestException(`Fecha inválida en "${param}": ${raw}`);
  }
  return d;
}

@Injectable()
export class MessageLogService {
  constructor(private prisma: PrismaService) {}

  /** WHERE de marca según quién pregunta (ver decisión 2 del header). */
  private async brandWhere(
    caller: Caller,
    requestedWl?: string | null,
  ): Promise<Record<string, any>> {
    if (caller.role === 'PLATFORM_OWNER') {
      if (!requestedWl) return {}; // vista global
      if (requestedWl === 'none') return { whiteLabelId: null };
      // Filtrar por una marca muestra EXACTAMENTE lo que esa marca ve en su
      // panel (Clubify incluye legacy null) — así el dueño puede verificar
      // el reclamo de una marca mirando lo mismo que ella.
      const scope = await resolveBrandScope(this.prisma, requestedWl);
      return brandWhiteLabelWhere(scope);
    }
    // Admin de marca: SIEMPRE su marca; el query param se ignora a propósito
    // (que un cliente malicioso mande ?whiteLabelId=otra no debe abrir nada).
    const scope = await resolveBrandScope(this.prisma, caller.whiteLabelId ?? null);
    return brandWhiteLabelWhere(scope);
  }

  /** Filtros comunes de list/summary, ya validados. */
  private async buildWhere(caller: Caller, f: ListFilters) {
    const brand = await this.brandWhere(caller, f.whiteLabelId ?? null);

    const base: Record<string, any> = {};
    if (f.channel) base.channel = f.channel;
    if (f.status) base.status = f.status;
    if (f.templateId) base.templateId = f.templateId;
    if (f.tenantId) base.tenantId = f.tenantId;
    if (f.from || f.to) {
      base.createdAt = {
        ...(f.from ? { gte: parseDateParam(f.from, 'from') } : {}),
        ...(f.to ? { lte: parseDateParam(f.to, 'to') } : {}),
      };
    }

    const q = f.q?.trim();
    const qWhere = q
      ? {
          OR: [
            { toEmail: { contains: q, mode: 'insensitive' as const } },
            { toPhone: { contains: q } },
            { subject: { contains: q, mode: 'insensitive' as const } },
            { preview: { contains: q, mode: 'insensitive' as const } },
            { error: { contains: q, mode: 'insensitive' as const } },
            { templateId: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : null;

    // AND explícito: `brand` y `qWhere` pueden traer OR cada uno; un spread
    // plano los pisaría entre sí en silencio.
    return { AND: [brand, base, ...(qWhere ? [qWhere] : [])] };
  }

  async list(
    caller: Caller,
    f: ListFilters & { page?: number; pageSize?: number },
  ) {
    // Number('abc') = NaN y Math.max(1, NaN) = NaN → skip inválido en Prisma.
    // Un query param roto degrada a los defaults, no a un 500.
    const page = Number.isFinite(f.page) ? Math.max(1, Math.floor(f.page!)) : 1;
    const pageSize = Number.isFinite(f.pageSize)
      ? Math.min(200, Math.max(1, Math.floor(f.pageSize!)))
      : 50;
    const where = await this.buildWhere(caller, f);

    return TenantContext.runWithoutTenant(async () => {
      const [total, rows] = await Promise.all([
        this.prisma.messageLog.count({ where }),
        this.prisma.messageLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // MessageLog guarda ids sueltos (sin relación en el schema, a propósito:
      // el log debe sobrevivir aunque se borre el negocio). Los nombres se
      // resuelven acá, en un lookup por página — 50 filas, no N+1.
      const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))];
      const wlIds = [...new Set(rows.map((r) => r.whiteLabelId).filter((x): x is string => !!x))];
      const [tenants, brands] = await Promise.all([
        tenantIds.length
          ? this.prisma.tenant.findMany({
              where: { id: { in: tenantIds } },
              select: { id: true, brandName: true },
            })
          : Promise.resolve([]),
        wlIds.length
          ? this.prisma.whiteLabel.findMany({
              where: { id: { in: wlIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);
      const tenantName = new Map(tenants.map((t) => [t.id, t.brandName]));
      const brandName = new Map(brands.map((b) => [b.id, b.name]));

      return {
        page,
        pageSize,
        total,
        items: rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          channel: r.channel,
          status: r.status,
          toPhone: r.toPhone,
          toEmail: r.toEmail,
          subject: r.subject,
          preview: r.preview,
          templateId: r.templateId,
          templateLabel: templateLabel(r.templateId),
          feature: r.feature,
          tenantId: r.tenantId,
          tenantName: r.tenantId ? (tenantName.get(r.tenantId) ?? null) : null,
          whiteLabelId: r.whiteLabelId,
          whiteLabelName: r.whiteLabelId
            ? (brandName.get(r.whiteLabelId) ?? null)
            : null,
          locationId: r.locationId,
          providerMessageId: r.providerMessageId,
          error: r.error,
        })),
      };
    });
  }

  /**
   * La pregunta del dueño en una sola respuesta: por plantilla, cuántos
   * salieron y cuántos fallaron en el rango filtrado.
   */
  async summary(caller: Caller, f: ListFilters) {
    const where = await this.buildWhere(caller, f);

    return TenantContext.runWithoutTenant(async () => {
      const grouped = await this.prisma.messageLog.groupBy({
        by: ['templateId', 'channel', 'status'],
        where,
        _count: { _all: true },
        _max: { createdAt: true },
      });

      type Row = {
        templateId: string | null;
        templateLabel: string | null;
        channel: string;
        sent: number;
        failed: number;
        lastAt: Date | null;
      };
      const byKey = new Map<string, Row>();
      for (const g of grouped) {
        const key = `${g.templateId ?? ''}::${g.channel}`;
        let row = byKey.get(key);
        if (!row) {
          row = {
            templateId: g.templateId,
            templateLabel: templateLabel(g.templateId),
            channel: g.channel,
            sent: 0,
            failed: 0,
            lastAt: null,
          };
          byKey.set(key, row);
        }
        if (g.status === 'sent') row.sent += g._count._all;
        else row.failed += g._count._all;
        const last = g._max.createdAt;
        if (last && (!row.lastAt || last > row.lastAt)) row.lastAt = last;
      }

      const rows = [...byKey.values()].sort(
        (a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0),
      );
      return {
        totals: {
          sent: rows.reduce((a, r) => a + r.sent, 0),
          failed: rows.reduce((a, r) => a + r.failed, 0),
        },
        rows,
      };
    });
  }

  /**
   * Opciones para los dropdowns de la pantalla. Las plantillas y negocios
   * salen del PROPIO log (solo lo que existe en el alcance del que mira);
   * la lista de marcas, solo para PLATFORM_OWNER.
   */
  async filterOptions(caller: Caller, requestedWl?: string | null) {
    const brand = await this.brandWhere(caller, requestedWl ?? null);

    return TenantContext.runWithoutTenant(async () => {
      const [tplGroups, tenantGroups, brands] = await Promise.all([
        this.prisma.messageLog.groupBy({
          by: ['templateId'],
          where: { AND: [brand, { templateId: { not: null } }] },
        }),
        this.prisma.messageLog.groupBy({
          by: ['tenantId'],
          where: { AND: [brand, { tenantId: { not: null } }] },
        }),
        caller.role === 'PLATFORM_OWNER'
          ? this.prisma.whiteLabel.findMany({
              select: { id: true, name: true, slug: true },
              orderBy: { name: 'asc' },
            })
          : Promise.resolve([]),
      ]);

      const tenantIds = tenantGroups
        .map((g) => g.tenantId)
        .filter((x): x is string => !!x);
      const tenants = tenantIds.length
        ? await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, brandName: true },
            orderBy: { brandName: 'asc' },
          })
        : [];

      const templates = tplGroups
        .map((g) => ({
          id: g.templateId as string,
          label: templateLabel(g.templateId) ?? (g.templateId as string),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'));

      return {
        templates,
        tenants: tenants.map((t) => ({ id: t.id, name: t.brandName })),
        brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
      };
    });
  }
}
