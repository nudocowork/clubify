import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { brandWhiteLabelWhere, resolveBrandScope } from '../common/white-label/brand-scope.util';
import { enlaceDeLaLista, enlaceDelInfolink, hostPublico, ordenarNegocios } from './enlaces';

export interface InfolinkDeLaBiblioteca {
  id: string;
  titulo: string;
  url: string;
  activo: boolean;
  visitas: number;
}

export interface NegocioDeLaBiblioteca {
  id: string;
  nombre: string;
  slug: string;
  logoUrl: string | null;
  estado: string;
  /** La página con todos sus InfoLinks activos. */
  urlLista: string;
  activos: number;
  infolinks: InfolinkDeLaBiblioteca[];
}

/**
 * «Biblioteca de Infolinks» del panel /admin: cada negocio de la marca con su
 * logo y los enlaces de sus InfoLinks, para copiarlos sin entrar a su panel.
 *
 * Solo lee. El alcance por marca es el mismo de Métricas: cada marca ve sus
 * negocios y Clubify los suyos más los legacy sin marca.
 */
@Injectable()
export class BibliotecaInfolinksService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(user: AuthUser | undefined): Promise<NegocioDeLaBiblioteca[]> {
    const scope = await resolveBrandScope(this.prisma, user?.whiteLabelId ?? null);
    const negocios = await this.prisma.tenant.findMany({
      where: {
        deletedAt: null,
        isCampaignHost: false,
        ...brandWhiteLabelWhere(scope),
        infoLinks: { some: {} },
      },
      select: {
        id: true,
        name: true,
        brandName: true,
        slug: true,
        logoUrl: true,
        status: true,
        storefront: { select: { customDomain: true } },
        whiteLabel: { select: { domain: true, appDomain: true } },
        infoLinks: {
          select: { id: true, slug: true, rootSlug: true, title: true, isActive: true, views: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return ordenarNegocios(
      negocios.map((t) => {
        const host = hostPublico({
          dominioPropio: t.storefront?.customDomain,
          dominioAppMarca: t.whiteLabel?.appDomain,
          dominioMarca: t.whiteLabel?.domain,
        });
        const infolinks = t.infoLinks
          // Activos primero: son los que se pueden compartir.
          .sort((a, b) => Number(b.isActive) - Number(a.isActive))
          .map((il) => ({
            id: il.id,
            // Hay InfoLinks guardados con título vacío o con un espacio; sin
            // esto la tarjeta mostraría un enlace sin nombre.
            titulo: il.title?.trim() || il.rootSlug || il.slug,
            url: enlaceDelInfolink(host, t.slug, il),
            activo: il.isActive,
            visitas: il.views,
          }));
        return {
          id: t.id,
          nombre: (t.brandName || t.name).trim(),
          slug: t.slug,
          logoUrl: t.logoUrl,
          estado: t.status,
          urlLista: enlaceDeLaLista(host, t.slug),
          activos: infolinks.filter((i) => i.activo).length,
          infolinks,
        };
      }),
    );
  }
}
