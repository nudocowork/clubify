import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Cache module-level de businessType por tenant. El TenantsService invalida la
// entrada cuando el super admin cambia el tipo de negocio, para que el bloqueo
// propague sin esperar el TTL. Sin esto habría hasta TTL_MS de inconsistencia.
const cache = new Map<string, { type: string; until: number }>();
const TTL_MS = 30_000;

export function invalidateBusinessTypeCache(tenantId: string) {
  cache.delete(tenantId);
}

/**
 * Prefijos de módulos que un negocio "Solo InfoLink" NO puede tocar (ni leer),
 * aunque escriba la URL a mano. Todo lo demás (auth, billing, tenants/me,
 * settings, info-links, media, qr-posters, metrics…) queda permitido. Se
 * bloquea por PREFIJO de path bajo el global prefix `/api`.
 *
 * Estos corresponden a los módulos que el panel oculta para InfoLink: Clientes,
 * Pedidos, Menú/Catálogo, Push, Reseñas, Reservas/Agenda/Eventos, Delivery,
 * Referidos, Automatizaciones, CRM, Wallet/Tarjetas/Sellos/Escáner/Pases,
 * Promociones, Campañas, Broadcasts, Canales, Badges.
 */
const BLOCKED_PREFIXES = [
  '/api/customers',
  '/api/orders',
  '/api/catalog',
  '/api/notifications',
  '/api/reviews',
  '/api/review-locations',
  '/api/review-qr-targets',
  '/api/reservations',
  '/api/reservation-events',
  '/api/service-reservations',
  '/api/delivery-business',
  '/api/referrals',
  '/api/automations',
  '/api/crm',
  '/api/wallet',
  '/api/cards',
  '/api/passes',
  '/api/stamps',
  '/api/scanner',
  '/api/promotions',
  '/api/campaigns',
  '/api/broadcasts',
  '/api/channels',
  '/api/badges',
];

/**
 * Bloquea en el backend el acceso de un negocio "Solo InfoLink" (businessType
 * INFOLINK) a los módulos que no le corresponden. Complementa el ocultamiento
 * visual del sidebar: aunque el dueño escriba /api/customers a mano, recibe 403
 * "No tienes acceso a este módulo". Solo aplica a TENANT_OWNER / TENANT_STAFF;
 * SUPER_ADMIN, roles de plataforma y endpoints @Public pasan sin fricción.
 *
 * Es un guard global (APP_GUARD) que corre DESPUÉS de JwtAuthGuard (necesita
 * req.user). Lee businessType de DB con cache TTL (patrón TenantStatusGuard).
 */
@Injectable()
export class InfoLinkOnlyGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const method = (req.method as string) || 'GET';
    if (method === 'OPTIONS') return true;

    const user = req.user;
    if (!user) return true; // pasa al JwtAuthGuard
    // Solo dueños/staff de negocio quedan bajo esta restricción. Admins de
    // marca, plataforma, marketing, afiliados, etc. no.
    if (user.role !== 'TENANT_OWNER' && user.role !== 'TENANT_STAFF') return true;
    if (!user.tenantId) return true;

    // Fast-path: si el path no es de un módulo bloqueable, ni consultamos DB.
    // req.path no incluye query string, así que basta match exacto o con "/".
    const path = (req.path as string) || '';
    if (!BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
      return true;
    }

    const type = await this.getBusinessType(user.tenantId);
    if (type !== 'INFOLINK') return true; // negocio completo → sin restricción

    throw new ForbiddenException({
      statusCode: 403,
      message: 'No tienes acceso a este módulo.',
      code: 'MODULE_NOT_AVAILABLE',
    });
  }

  private async getBusinessType(tenantId: string): Promise<string> {
    const now = Date.now();
    const hit = cache.get(tenantId);
    if (hit && hit.until > now) return hit.type;

    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessType: true },
    });
    const type = (t?.businessType as string) || 'FULL';
    cache.set(tenantId, { type, until: now + TTL_MS });
    return type;
  }
}
