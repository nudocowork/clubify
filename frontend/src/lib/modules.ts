// Lanzador de módulos por rol — fuente ÚNICA de "qué ve cada correo al entrar".
// La consumen /hub (las tarjetas del lanzador) y /login (a dónde cae alguien
// tras autenticarse).
//
// Regla dura: aquí SOLO se ofrece lo que el guard real de cada sección deja
// pasar. Ofrecer un destino que el guard rebota deja al usuario en un
// ping-pong: AppShell manda los roles admin de /app a /admin y los de tenant
// de /admin a /app, así que una tarjeta mal asignada es un bucle, no un 403.
//
// Los permisos de cada destino, verificados contra el código:
//   /superadmin      → PLATFORM_OWNER          (superadmin/layout.tsx)
//   /admin           → SUPER_ADMIN, MARKETING  (AppShell isAdminRole)
//   /app             → roles de tenant         (AppShell variant 'app')
//   /app/orders      → TENANT_ORDERS           (route guard "Solo pedidos")
//   /scan            → TENANT_OWNER, TENANT_STAFF, SUPER_ADMIN
//                      (backend scanner.controller.ts @Roles)
//   /domicilios      → DELIVERY_COMPANY        (domicilios/layout.tsx)
//   /cuponera/admin  → CUPONERA_ADMIN
//   /cuponera/panel  → ALLY_BUSINESS
//   /affiliate       → AFFILIATE_*

export type ModuleKey =
  | 'masteradmin'
  | 'admin'
  | 'negocio'
  | 'pedidos'
  | 'escaner'
  | 'cuponera-admin'
  | 'cuponera-negocio'
  | 'domicilios'
  | 'afiliados';

export type AppModule = {
  key: ModuleKey;
  label: string;
  description: string;
  href: string;
  emoji: string;
  /** Color de acento de la tarjeta en el lanzador. */
  accent: string;
};

const MODULES: Record<ModuleKey, AppModule> = {
  masteradmin: {
    key: 'masteradmin',
    label: 'Master Admin',
    description: 'Marcas blancas, créditos, módulos e integraciones de la plataforma.',
    href: '/superadmin',
    emoji: '🏛️',
    accent: '#7C3AED',
  },
  admin: {
    key: 'admin',
    label: 'Administración',
    description: 'Negocios, cobros, comisiones y reportes de la marca.',
    href: '/admin',
    emoji: '🧭',
    accent: '#2563EB',
  },
  negocio: {
    key: 'negocio',
    label: 'Mi negocio',
    description: 'Tarjetas, clientes, pedidos, menú, automatizaciones y estadísticas.',
    href: '/app',
    emoji: '🏪',
    accent: '#16A34A',
  },
  pedidos: {
    key: 'pedidos',
    label: 'Pedidos',
    description: 'Recibe y gestiona los pedidos del local.',
    href: '/app/orders',
    emoji: '🛎️',
    accent: '#F97316',
  },
  escaner: {
    key: 'escaner',
    label: 'Escáner',
    description: 'Registra sellos, visitas y compras escaneando el pase del cliente.',
    href: '/scan',
    emoji: '📷',
    accent: '#6366F1',
  },
  'cuponera-admin': {
    key: 'cuponera-admin',
    label: 'Cuponera',
    description: 'Administra tu cuponera: aliados, beneficios y miembros.',
    href: '/cuponera/admin',
    emoji: '🎟️',
    accent: '#DB2777',
  },
  'cuponera-negocio': {
    key: 'cuponera-negocio',
    label: 'Mi negocio aliado',
    description: 'Tu ficha y tus promociones dentro de la cuponera.',
    href: '/cuponera/panel',
    emoji: '🏷️',
    accent: '#DB2777',
  },
  domicilios: {
    key: 'domicilios',
    label: 'Domicilios',
    description: 'Los domicilios de tu empresa: asignación, estados y liquidación.',
    href: '/domicilios',
    emoji: '🛵',
    accent: '#0EA5E9',
  },
  afiliados: {
    key: 'afiliados',
    label: 'Afiliados',
    description: 'Tus clientes referidos, comisiones y material de venta.',
    href: '/affiliate',
    emoji: '🤝',
    accent: '#0D9488',
  },
};

/**
 * Módulos a los que el usuario tiene acceso REAL, en orden de prioridad.
 * El primero es su destino natural tras el login (ver primaryHrefForUser).
 */
export function modulesForUser(user: { role?: string | null } | null): AppModule[] {
  const role = user?.role ?? '';
  if (!role) return [];

  // Los roles de afiliado son una familia (INFLUENCER, AMBASSADOR, VENDOR,
  // SOCIO) y todos entran al mismo panel.
  if (role.startsWith('AFFILIATE_')) return [MODULES.afiliados];

  switch (role) {
    case 'PLATFORM_OWNER':
      return [MODULES.masteradmin];
    case 'SUPER_ADMIN':
      return [MODULES.admin, MODULES.escaner];
    case 'MARKETING':
      // Sin escáner: los @Roles del backend no lo incluyen.
      return [MODULES.admin];
    case 'TENANT_OWNER':
    case 'TENANT_STAFF':
      return [MODULES.negocio, MODULES.escaner];
    case 'TENANT_ORDERS':
      // "Solo pedidos": el resto de /app está bloqueado por guard y por
      // default-deny en el backend, así que no se le ofrece nada más.
      return [MODULES.pedidos];
    case 'DELIVERY_COMPANY':
      return [MODULES.domicilios];
    case 'CUPONERA_ADMIN':
      return [MODULES['cuponera-admin']];
    case 'ALLY_BUSINESS':
      return [MODULES['cuponera-negocio']];
    default:
      return [];
  }
}

/**
 * Destino directo tras el login (comportamiento de siempre en la web: el
 * usuario entra a su panel sin pasar por el lanzador). El fallback a /app
 * cubre roles nuevos que todavía no estén en el registro: AppShell los
 * reencamina según corresponda.
 */
export function primaryHrefForUser(user: { role?: string | null } | null): string {
  return modulesForUser(user)[0]?.href ?? '/app';
}
