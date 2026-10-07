/**
 * Las secciones REALES de `/admin` (las carpetas de `src/app/admin`).
 *
 * El panel interpreta `/admin/<algo>` como «el panel de la marca blanca
 * <algo>» salvo que `<algo>` sea una sección de esta lista. Antes había TRES
 * copias (middleware, menú lateral y `brand-from-path`) y cada una iba por su
 * lado: «Marcas blancas» abría el menú de una marca inexistente porque faltaba
 * en una (Sara, 2026-10-06) y a otra le faltaban 12, Contabilidad incluida.
 *
 * **Toda carpeta nueva en `src/app/admin` va aquí**, en esta única lista.
 * `pagos`, `reviews` y `settings` no son carpetas: son rutas antiguas que
 * ya estaban en una de las copias y se conservan para no romper enlaces.
 */
export const SECCIONES_ADMIN: ReadonlySet<string> = new Set([
  'academia', 'accounting', 'affiliate-registration', 'ai-knowledge',
  'audit', 'automatizaciones', 'branding', 'business-categories',
  'business-groups', 'commissions', 'contabilidad', 'creditos', 'industries',
  'infolinks', 'integrations', 'lab', 'maintenance', 'map', 'marcas-blancas',
  'mensajes', 'pagos', 'pagos-manuales', 'payouts', 'pending-payments',
  'rankings', 'referrals', 'reports', 'reviews', 'sales-leaderboard',
  'sales-teams', 'settings', 'support-materials', 'tenants', 'trials',
  'upgrades', 'users', 'ventas',
]);
