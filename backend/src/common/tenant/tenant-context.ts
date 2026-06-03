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
};

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
};
