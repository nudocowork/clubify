import { AsyncLocalStorage } from 'async_hooks';
import { Role } from '@prisma/client';

/**
 * Contexto de tenant propagado vía AsyncLocalStorage.
 *
 * Para CADA request HTTP autenticado, `TenantContextInterceptor` setea este
 * contexto antes de invocar el handler. El middleware de Prisma lo lee para
 * inyectar `where: { tenantId }` automáticamente en queries de modelos que
 * tengan ese campo.
 *
 * Reglas:
 *   - role === SUPER_ADMIN  → bypass total (puede consultar cualquier tenant)
 *   - role === MARKETING    → bypass total (marketing/diseño cross-tenant)
 *   - tenantId === null    → contexto inactivo (sin enforcement)
 *   - Background jobs/crons → no setean contexto → sin enforcement
 *
 * Si necesitás operar cross-tenant deliberadamente (super admin tools, batch
 * jobs), usa `runWithoutTenant()` o `runWithTenant({ bypass: true }, fn)`.
 */
export type TenantCtx = {
  tenantId: string | null;
  userId: string | null;
  role: Role | null;
  /** Si true, el middleware NO inyecta `tenantId` (super admin / jobs). */
  bypass: boolean;
  /** Marca blanca activa (SUPER_ADMIN que "entró" a una white-label). */
  whiteLabelId?: string | null;
  /** Set de tenantIds de la marca activa, resuelto por el interceptor.
   *  Presente → el middleware scopea las queries a `tenantId IN (...)` en
   *  vez de a un solo tenant. Tiene prioridad sobre el bypass global de
   *  SUPER_ADMIN (modo "dentro de la marca"). */
  whiteLabelTenantIds?: string[] | null;
};

/**
 * Alcance de enforcement resuelto para el contexto actual:
 *   - { kind: 'tenant' }     → un solo negocio (usuario normal)
 *   - { kind: 'whiteLabel' } → todos los tenants de una marca (impersonación)
 *   - null                   → sin enforcement (global / bypass / público)
 */
export type EnforcedScope =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'whiteLabel'; tenantIds: string[]; whiteLabelId: string | null }
  | null;

const storage = new AsyncLocalStorage<TenantCtx>();

export const TenantContext = {
  /**
   * Corre `fn` con un contexto de tenant activo. Cualquier await/promesa
   * dentro de fn verá el mismo contexto.
   */
  run<T>(ctx: TenantCtx, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /** Corre `fn` SIN enforcement (cross-tenant, super admin tools). */
  runWithoutTenant<T>(fn: () => T): T {
    return storage.run(
      { tenantId: null, userId: null, role: null, bypass: true },
      fn,
    );
  },

  /** Devuelve el contexto actual, o null si no hay request activo. */
  current(): TenantCtx | null {
    return storage.getStore() ?? null;
  },

  /**
   * Devuelve el tenantId enforceable para el contexto actual.
   * Retorna null si: no hay contexto / bypass activo / super admin.
   */
  enforcedTenantId(): string | null {
    const ctx = storage.getStore();
    if (!ctx) return null;
    if (ctx.bypass) return null;
    if (ctx.role === 'SUPER_ADMIN' || ctx.role === 'MARKETING') return null;
    return ctx.tenantId;
  },

  /**
   * Alcance de enforcement para el contexto actual. Reemplaza a
   * `enforcedTenantId()` en el middleware: distingue el modo "un tenant" del
   * modo "marca blanca" (set de tenants), o null si no hay enforcement.
   */
  enforcedScope(): EnforcedScope {
    const ctx = storage.getStore();
    if (!ctx) return null;
    if (ctx.bypass) return null;
    // Modo marca blanca: SUPER_ADMIN dentro de una marca con el set de
    // tenants ya resuelto por el interceptor. Prioridad sobre el bypass
    // global de SUPER_ADMIN.
    if (ctx.whiteLabelTenantIds) {
      return {
        kind: 'whiteLabel',
        tenantIds: ctx.whiteLabelTenantIds,
        whiteLabelId: ctx.whiteLabelId ?? null,
      };
    }
    if (ctx.role === 'SUPER_ADMIN' || ctx.role === 'MARKETING') return null;
    if (ctx.tenantId) return { kind: 'tenant', tenantId: ctx.tenantId };
    return null;
  },
};
