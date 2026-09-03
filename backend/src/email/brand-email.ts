import type { PrismaService } from '../common/prisma/prisma.service';

/**
 * Identidad de email de una marca blanca para envíos transaccionales.
 *
 * - `from`: remitente verificado de la marca (ej "Sellea <hola@selleala.com>").
 *   Solo se usa si `WhiteLabel.emailFrom` está seteado (dominio verificado en
 *   Resend/DKIM). Si es null → `undefined` y el EmailService usa el remitente
 *   global de Clubify. Así ninguna otra marca queda afectada.
 * - `loginUrl`: link al panel de la marca (ej https://selleala.com/login) —
 *   derivado de `domain`/`appDomain`. Cae al APP_URL global si la marca no tiene
 *   dominio propio.
 * - `brandName`: nombre de la marca (para copy/footer). 'Clubify' si no hay marca.
 * - `hasBrandSender`: true si la marca tiene remitente propio configurado (gate
 *   para envíos que SOLO deben salir en marcas opt-in, ej email de activación).
 */
export interface BrandEmailIdentity {
  whiteLabelId: string | null;
  brandName: string;
  from?: string;
  replyTo?: string;
  websiteUrl: string;
  loginUrl: string;
  hasBrandSender: boolean;
}

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/**
 * Resuelve la identidad de email de la marca dueña de un tenant/whiteLabel.
 * `fallbackAppUrl` = APP_URL global (para marcas sin dominio propio o Clubify).
 */
export async function resolveBrandEmail(
  prisma: PrismaService,
  whiteLabelId: string | null | undefined,
  fallbackAppUrl: string,
): Promise<BrandEmailIdentity> {
  const base = stripTrailingSlash(fallbackAppUrl || 'https://soyclubify.com');
  const clubify: BrandEmailIdentity = {
    whiteLabelId: null,
    brandName: 'Clubify',
    from: undefined,
    replyTo: undefined,
    websiteUrl: base,
    loginUrl: `${base}/login`,
    hasBrandSender: false,
  };
  if (!whiteLabelId) return clubify;

  const wl = await prisma.whiteLabel
    .findUnique({
      where: { id: whiteLabelId },
      select: {
        id: true,
        name: true,
        emailFrom: true,
        contactEmail: true,
        domain: true,
        appDomain: true,
      },
    })
    .catch(() => null);
  if (!wl) return clubify;

  const host = (wl.domain || wl.appDomain || '').trim();
  const websiteUrl = host ? `https://${stripTrailingSlash(host)}` : base;
  const from = wl.emailFrom?.trim() || undefined;
  return {
    whiteLabelId: wl.id,
    brandName: wl.name?.trim() || 'Clubify',
    from,
    replyTo: from ? wl.contactEmail?.trim() || undefined : undefined,
    websiteUrl,
    loginUrl: `${websiteUrl}/login`,
    hasBrandSender: !!from,
  };
}
