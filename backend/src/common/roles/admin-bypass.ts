import { Role } from '@prisma/client';

/**
 * Roles con bypass cross-tenant: pueden leer/escribir datos de cualquier
 * negocio (vía override de tenantId en query param o servicio).
 *
 *  - SUPER_ADMIN: bypass total, todas las áreas (financiero, scanner, etc.)
 *  - MARKETING:   bypass solo en marketing/diseño. Los endpoints financieros
 *                 quedan bloqueados por @Roles a nivel controller.
 *
 * Este helper se usa DENTRO de services que ya están protegidos por @Roles.
 * No reemplaza el guard, solo el patrón runtime `user.role === 'SUPER_ADMIN'`
 * cuando queremos extender el bypass a MARKETING.
 */
export function hasAdminBypass(role: Role | null | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'MARKETING';
}
