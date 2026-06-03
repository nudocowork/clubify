import { ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Middleware Prisma que enforza el `tenantId` del contexto activo (seteado
 * por TenantContextInterceptor en cada request HTTP autenticado).
 *
 * Cobertura:
 *   ✓ findMany / findFirst / count / aggregate / groupBy → inyecta
 *     `where.tenantId` (AND-merged)
 *   ✓ updateMany / deleteMany → inyecta `where.tenantId`
 *   ✓ create / createMany → inyecta `data.tenantId`
 *   ✓ findUnique / findUniqueOrThrow → post-validate (devuelve null si el
 *     record pertenece a otro tenant)
 *   ✗ update / delete / upsert SINGULAR → no cubiertos (Prisma no permite
 *     filter no-unique en where). Los services deben hacer findFirst con
 *     where.tenantId previo, como ya es el patrón.
 *
 * Comportamiento bypass:
 *   - role === SUPER_ADMIN  → no actúa (puede leer cualquier tenant)
 *   - role === MARKETING    → no actúa (marketing/diseño cross-tenant)
 *   - contexto inactivo     → no actúa (background jobs, cron, scripts)
 *   - bypass = true         → no actúa (super admin tools opt-in)
 *
 * Si una query ya tiene `where.tenantId` o `data.tenantId` que NO coincide
 * con el del contexto, lanza ForbiddenException — esto convierte fugas
 * silenciosas en errores ruidosos durante desarrollo.
 */

const logger = new Logger('PrismaTenantMiddleware');

/**
 * Set de modelos que tienen campo `tenantId` (extraído del DMMF en runtime).
 * Si agregas un modelo nuevo con tenantId, no hay que tocar nada aquí.
 */
const MODELS_WITH_TENANT_ID = new Set<string>(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
    .map((m) => m.name),
);

function mergeWhereAnd(args: any, tenantId: string, model: string) {
  args = args ?? {};
  const existing = args.where;
  if (!existing) {
    args.where = { tenantId };
    return args;
  }
  if (existing.tenantId !== undefined && existing.tenantId !== null) {
    if (typeof existing.tenantId === 'object') {
      // Permitimos filtros tipo `{ tenantId: { in: [...] } }`. No validamos
      // contenido — confianza en el caller (típicamente super admin tools
      // que ya pasan por bypass).
      return args;
    }
    if (existing.tenantId !== tenantId) {
      throw new ForbiddenException(
        `Cross-tenant query bloqueada en ${model}: where.tenantId=${String(
          existing.tenantId,
        ).slice(0, 8)}… no coincide con tenant activo.`,
      );
    }
    return args;
  }
  // AND-merge: preserva el where existente y añade tenantId.
  args.where = { AND: [existing, { tenantId }] };
  return args;
}

function injectCreateData(args: any, tenantId: string, model: string) {
  args = args ?? {};
  const data = args.data;
  if (!data) {
    args.data = { tenantId };
    return args;
  }
  if (data.tenantId === undefined || data.tenantId === null) {
    args.data = { ...data, tenantId };
    return args;
  }
  if (data.tenantId !== tenantId) {
    throw new ForbiddenException(
      `Cross-tenant write bloqueado en ${model}: data.tenantId=${String(
        data.tenantId,
      ).slice(0, 8)}… no coincide con tenant activo.`,
    );
  }
  return args;
}

function injectCreateManyData(args: any, tenantId: string, model: string) {
  args = args ?? {};
  const data = args.data;
  if (Array.isArray(data)) {
    args.data = data.map((item: any) => {
      if (item == null) return item;
      if (item.tenantId === undefined || item.tenantId === null) {
        return { ...item, tenantId };
      }
      if (item.tenantId !== tenantId) {
        throw new ForbiddenException(
          `Cross-tenant write bloqueado en ${model}.createMany: tenantId no coincide.`,
        );
      }
      return item;
    });
  } else if (data && typeof data === 'object') {
    args.data =
      (data as any).tenantId === undefined || (data as any).tenantId === null
        ? { ...data, tenantId }
        : (data as any).tenantId !== tenantId
          ? (() => {
              throw new ForbiddenException(
                `Cross-tenant write bloqueado en ${model}.createMany: tenantId no coincide.`,
              );
            })()
          : data;
  }
  return args;
}

export function tenantMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    const enforcedTid = TenantContext.enforcedTenantId();
    if (!enforcedTid) return next(params);

    const model = params.model;
    if (!model || !MODELS_WITH_TENANT_ID.has(model)) return next(params);

    switch (params.action) {
      case 'findMany':
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'count':
      case 'aggregate':
      case 'groupBy':
      case 'updateMany':
      case 'deleteMany':
        params.args = mergeWhereAnd(params.args, enforcedTid, model);
        break;

      case 'create':
        params.args = injectCreateData(params.args, enforcedTid, model);
        break;

      case 'createMany':
        params.args = injectCreateManyData(params.args, enforcedTid, model);
        break;

      case 'findUnique':
      case 'findUniqueOrThrow': {
        const result = await next(params);
        if (
          result &&
          typeof result === 'object' &&
          'tenantId' in result &&
          (result as any).tenantId &&
          (result as any).tenantId !== enforcedTid
        ) {
          logger.warn(
            `Cross-tenant read bloqueado: ${model}.${params.action} retornó record de tenant ` +
              `${String((result as any).tenantId).slice(0, 8)}… (activo: ${enforcedTid.slice(0, 8)}…)`,
          );
          return params.action === 'findUniqueOrThrow' ? null : null;
        }
        return result;
      }

      // update / delete / upsert SINGULAR: no cubiertos. Los services deben
      // validar ownership con findFirst({ where: { id, tenantId } }) previo.
      // Cobertura futura via Prisma.$extends + transformación a findFirst.
      default:
        break;
    }

    return next(params);
  };
}
