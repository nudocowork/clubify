import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolución de marca para el panel /admin. Fuente única para scopear modelos
 * que NO tienen `tenantId` (y por eso el middleware Prisma no los cubre):
 * Commission (vía referralUse.tenant) y ReferralCode (whiteLabelId directo).
 *
 * Regla de aislamiento (igual que tenants/metrics): sin marca en la sesión →
 * DEFAULT a Clubify (NO "ver todo"; el cross-brand vive en /superadmin).
 * Clubify incluye los registros legacy con whiteLabelId null. Otras marcas:
 * estricto a su id. NUNCA Clubify como fallback de OTRA marca.
 */

let _clubifyId: string | null | undefined;

export type BrandScope = {
  /** Marca efectiva: la de la sesión, o Clubify si la sesión no trae marca. */
  wlId: string | null;
  clubifyId: string | null;
  isClubify: boolean;
};

export async function resolveBrandScope(
  prisma: PrismaService,
  sessionWlId: string | null | undefined,
): Promise<BrandScope> {
  if (_clubifyId === undefined) {
    const wl = await prisma.whiteLabel.findFirst({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    _clubifyId = wl?.id ?? null;
  }
  const clubifyId = _clubifyId;
  const wlId = sessionWlId ?? clubifyId;
  return { wlId, clubifyId, isClubify: !!wlId && wlId === clubifyId };
}

/**
 * WHERE para un campo `whiteLabelId` (ReferralCode directo, o `tenant: {...}`
 * de una relación). Clubify ve sus registros + los legacy null; otra marca,
 * estricto a su id; sin marca clubify configurada (dev) → sin filtro.
 */
export function brandWhiteLabelWhere(scope: BrandScope): Record<string, any> {
  const { wlId, clubifyId, isClubify } = scope;
  if (!wlId) return {};
  if (isClubify) {
    return { OR: [{ whiteLabelId: clubifyId }, { whiteLabelId: null }] };
  }
  return { whiteLabelId: wlId };
}
