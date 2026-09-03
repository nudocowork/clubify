import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  resolveBrandScope,
  brandWhiteLabelWhere,
} from '../common/white-label/brand-scope.util';

/**
 * Service del Mapa de Negocios SUPER_ADMIN. Devuelve el listado de
 * tenants con sus Locations geolocalizadas + atribución a embajador/
 * influencer (via ReferralUse cronológicamente más antiguo).
 *
 * Tenants SIN Locations NO se incluyen — el panel de Mapa muestra
 * únicamente lo que tiene coordenadas. Para auditar quién no configuró
 * sede, está /admin/tenants normal.
 *
 * Limit duro de 500 tenants para evitar dibujar miles de markers y
 * matar el browser.
 */
@Injectable()
export class BusinessMapService {
  constructor(private prisma: PrismaService) {}

  /**
   * @param whiteLabelIdUsuario marca del usuario. Si la tiene, MANDA: un admin
   *        de marca no puede ver los negocios de otra pidiendo otro `slug`.
   * @param slugPedido marca que el panel maestro está viendo por URL.
   *        Solo se honra cuando el usuario NO está acotado a una marca.
   */
  async list(
    whiteLabelIdUsuario?: string | null,
    slugPedido?: string | null,
  ) {
    let whiteLabelId = whiteLabelIdUsuario ?? null;
    if (!whiteLabelId && slugPedido) {
      const wl = await this.prisma.whiteLabel.findFirst({
        where: { slug: slugPedido.toLowerCase() },
        select: { id: true },
      });
      whiteLabelId = wl?.id ?? null;
    }

    const tenants = await this.prisma.tenant.findMany({
      where: {
        // Solo tenants con al menos una Location activa.
        locations: { some: { isActive: true } },
        // Sin marca resuelta se muestran todos: es el mapa global del dueño
        // de la plataforma, que SÍ debe verlos todos.
        ...(whiteLabelId ? { whiteLabelId } : {}),
      },
      select: {
        id: true,
        brandName: true,
        slug: true,
        status: true,
        businessCategorySlug: true,
        createdAt: true,
        locations: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        referralUses: {
          where: {
            status: 'SIGNED_UP',
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            referralCode: {
              select: {
                id: true,
                code: true,
                ownerName: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return tenants.map((t) => {
      const ref = t.referralUses[0]?.referralCode ?? null;
      // Solo nos interesa atribución a AMBASSADOR o INFLUENCER.
      const assignedToCode =
        ref && (ref.role === 'AMBASSADOR' || ref.role === 'INFLUENCER')
          ? {
              id: ref.id,
              code: ref.code,
              ownerName: ref.ownerName,
              role: ref.role as 'AMBASSADOR' | 'INFLUENCER',
            }
          : null;

      return {
        tenantId: t.id,
        brandName: t.brandName,
        slug: t.slug,
        status: t.status,
        businessCategorySlug: t.businessCategorySlug,
        createdAt: t.createdAt,
        locations: t.locations.map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
          // Decimal → number para JSON-friendly. Las coords ya tienen 7
          // decimales en DB, suficiente precisión para mapa.
          latitude: Number(l.latitude),
          longitude: Number(l.longitude),
        })),
        assignedToCode,
      };
    });
  }

  /**
   * Lista de afiliados (INFLUENCER + AMBASSADOR) para los dropdowns de
   * filtro del mapa. Solo los activos, ordenados alfabéticamente.
   */
  async listAffiliates(whiteLabelId?: string | null) {
    // Aislamiento por marca: ReferralCode tiene whiteLabelId directo pero NO
    // tenantId → el middleware no lo scopea. Filtramos por la marca del admin
    // (sin marca en sesión → default Clubify, que incluye los códigos legacy
    // con whiteLabelId null).
    const scope = await resolveBrandScope(this.prisma, whiteLabelId);
    const brand = brandWhiteLabelWhere(scope);
    const codes = await this.prisma.referralCode.findMany({
      where: {
        isActive: true,
        role: { in: ['AMBASSADOR', 'INFLUENCER'] },
        ...brand,
      },
      select: {
        id: true,
        code: true,
        ownerName: true,
        role: true,
      },
      orderBy: [{ role: 'asc' }, { ownerName: 'asc' }],
    });
    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      ownerName: c.ownerName,
      role: c.role as 'AMBASSADOR' | 'INFLUENCER',
    }));
  }
}
