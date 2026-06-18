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
 *   - role === SUPER_ADMIN  → global, EXCEPTO si entró a una marca blanca
 *     (whiteLabelTenantIds en el contexto) → scopea a `tenantId IN (marca)`
 *   - role === MARKETING    → no actúa (marketing/diseño cross-tenant)
 *   - contexto inactivo     → no actúa (background jobs, cron, scripts)
 *   - bypass = true         → no actúa (super admin tools opt-in)
 *
 * Modo marca blanca (decisión A): las escrituras (create/createMany) sólo se
 * permiten con `data.tenantId` explícito y dentro de la marca; las ambiguas
 * (sin tenantId) se bloquean — hay que entrar al negocio específico.
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

/**
 * Modo marca blanca: AND-merge de `tenantId IN (set de la marca)`. Si la
 * query ya filtra por un tenantId escalar, valida que pertenezca a la marca
 * (sino ForbiddenException). Set vacío → `{ in: [] }` no devuelve nada
 * (correcto: una marca sin tenants no tiene datos).
 */
function mergeWhereAndIn(args: any, tenantIds: string[], model: string) {
  args = args ?? {};
  const inFilter = { tenantId: { in: tenantIds } };
  const existing = args.where;
  if (!existing) {
    args.where = inFilter;
    return args;
  }
  const et = existing.tenantId;
  if (typeof et === 'string') {
    if (!tenantIds.includes(et)) {
      throw new ForbiddenException(
        `Cross-brand query bloqueada en ${model}: where.tenantId=${et.slice(
          0,
          8,
        )}… fuera de la marca activa.`,
      );
    }
    return args; // ya restringida a un tenant de la marca
  }
  // tenantId objeto ({in/notIn/...}) u otros filtros → AND-merge para acotar
  // a la marca sin pisar el where existente.
  args.where = { AND: [existing, inFilter] };
  return args;
}

/**
 * Modo marca blanca, escrituras (decisión A): no hay un tenantId único que
 * inyectar. Permitimos solo escrituras con `data.tenantId` EXPLÍCITO que
 * pertenezca a la marca; las escrituras ambiguas (sin tenantId) se bloquean
 * — el SUPER_ADMIN debe entrar al negocio específico para crearlas.
 */
function guardWhiteLabelCreate(args: any, tenantIds: string[], model: string) {
  const tid = args?.data?.tenantId;
  if (tid == null) {
    throw new ForbiddenException(
      `Escritura en ${model} bloqueada en modo marca-blanca sin tenantId explícito: entrá al negocio específico para crear registros.`,
    );
  }
  if (!tenantIds.includes(tid)) {
    throw new ForbiddenException(
      `Cross-brand write bloqueado en ${model}: tenantId fuera de la marca activa.`,
    );
  }
  return args;
}

/**
 * Modo marca blanca, modelo Tenant: el propio Tenant NO tiene columna
 * `tenantId` (su PK es `id`), así que el scoping genérico no lo cubre.
 * Acotamos los LISTADOS de negocios por `id IN (tenants de la marca)` para
 * que `/admin` no muestre negocios de otras marcas bajo impersonación.
 */
function mergeWhereAndIdIn(args: any, ids: string[]) {
  args = args ?? {};
  const inFilter = { id: { in: ids } };
  const existing = args.where;
  args.where = existing ? { AND: [existing, inFilter] } : inFilter;
  return args;
}

function guardWhiteLabelCreateMany(
  args: any,
  tenantIds: string[],
  model: string,
) {
  const data = args?.data;
  const items = Array.isArray(data) ? data : data ? [data] : [];
  for (const item of items) {
    const tid = item?.tenantId;
    if (tid == null) {
      throw new ForbiddenException(
        `Escritura en ${model}.createMany bloqueada en modo marca-blanca sin tenantId explícito.`,
      );
    }
    if (!tenantIds.includes(tid)) {
      throw new ForbiddenException(
        `Cross-brand write bloqueado en ${model}.createMany: tenantId fuera de la marca activa.`,
      );
    }
  }
  return args;
}

export function tenantMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    const scope = TenantContext.enforcedScope();
    if (!scope) return next(params);

    const model = params.model;
    if (!model) return next(params);

    // Caso especial: el modelo Tenant no tiene `tenantId` (PK = id). En modo
    // marca acotamos sus LISTADOS por `id IN (tenants de la marca)`. Reads
    // solamente: update/delete singular por id ya quedan fuera del scoping
    // genérico (se permiten), y los writes de asignación de marca son acción
    // de PLATFORM_OWNER (no entra en modo marca).
    if (model === 'Tenant') {
      if (scope.kind === 'whiteLabel') {
        switch (params.action) {
          case 'findMany':
          case 'findFirst':
          case 'findFirstOrThrow':
          case 'count':
          case 'aggregate':
          case 'groupBy':
            params.args = mergeWhereAndIdIn(params.args, scope.tenantIds);
            break;
          default:
            break;
        }
      }
      return next(params);
    }

    if (!MODELS_WITH_TENANT_ID.has(model)) return next(params);

    switch (params.action) {
      case 'findMany':
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'count':
      case 'aggregate':
      case 'groupBy':
      case 'updateMany':
      case 'deleteMany':
        params.args =
          scope.kind === 'tenant'
            ? mergeWhereAnd(params.args, scope.tenantId, model)
            : mergeWhereAndIn(params.args, scope.tenantIds, model);
        break;

      case 'create':
        params.args =
          scope.kind === 'tenant'
            ? injectCreateData(params.args, scope.tenantId, model)
            : guardWhiteLabelCreate(params.args, scope.tenantIds, model);
        break;

      case 'createMany':
        params.args =
          scope.kind === 'tenant'
            ? injectCreateManyData(params.args, scope.tenantId, model)
            : guardWhiteLabelCreateMany(params.args, scope.tenantIds, model);
        break;

      case 'findUnique':
      case 'findUniqueOrThrow': {
        const result = await next(params);
        const rid =
          result && typeof result === 'object' && 'tenantId' in result
            ? (result as any).tenantId
            : null;
        if (rid) {
          const allowed =
            scope.kind === 'tenant'
              ? rid === scope.tenantId
              : scope.tenantIds.includes(rid);
          if (!allowed) {
            logger.warn(
              `Cross-tenant read bloqueado: ${model}.${params.action} retornó record de tenant ` +
                `${String(rid).slice(0, 8)}… (scope: ${scope.kind})`,
            );
            return null;
          }
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
