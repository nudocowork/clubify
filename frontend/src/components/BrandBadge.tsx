/**
 * Badge de marca que aparece en superficies que ven los clientes finales
 * (storefront, wallet, recibos, links públicos). Es PER-MARCA: muestra la marca
 * blanca del negocio ("Hecho con Sellea" → selleala.com), NUNCA Clubify por
 * defecto ni la marca de otra. La marca llega resuelta del backend (atribución
 * derivada del nombre, web, inicial, color).
 *
 * (Reemplaza a ClubifyBadge. Antes el badge estaba hardcodeado a Clubify y
 * marcado como "no removible"; ahora cada marca muestra el suyo.)
 *
 * variants:
 *  - "subtle": texto gris en footer (fondos claros).
 *  - "pill":   pastilla blanca con sombra (fondos oscuros / imagen / gradient).
 *  - "auto":   decide por `dark`.
 */
export type BrandBadgeBrand = {
  name: string;
  websiteUrl: string;
  initial?: string | null;
  primaryColor?: string | null;
  // Logo/ícono de la marca blanca — fallback visual cuando el negocio no tiene
  // logo propio (ej. cabecera del pase). El backend los incluye en el brand.
  logoUrl?: string | null;
  iconUrl?: string | null;
  attribution?: { madeWith?: string } | null;
};

export function BrandBadge({
  brand,
  variant = 'subtle',
  dark,
}: {
  brand: BrandBadgeBrand;
  variant?: 'subtle' | 'pill' | 'auto';
  dark?: boolean;
}) {
  const resolved = variant === 'auto' ? (dark ? 'pill' : 'subtle') : variant;
  const label = brand.attribution?.madeWith || `Hecho con ${brand.name}`;
  const initial = (brand.initial || brand.name[0] || '·').toUpperCase();
  const color = brand.primaryColor || '#22C55E';
  const href = brand.websiteUrl
    ? `${brand.websiteUrl}?utm_source=storefront&utm_medium=badge`
    : '#';

  const Mark = (
    <span
      className="w-3.5 h-3.5 rounded-[4px] text-white flex items-center justify-center font-bold text-[8px]"
      style={{ background: color }}
    >
      {initial}
    </span>
  );

  if (resolved === 'pill') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 bg-white/95 hover:bg-white text-ink/80 hover:text-ink text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-sm transition"
      >
        {Mark}
        {label}
      </a>
    );
  }
  return (
    <div className="text-center text-[11px] text-mute pt-4 pb-6 select-none">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 hover:text-ink transition"
      >
        {Mark}
        <span>
          Hecho con{' '}
          <span className="font-semibold text-ink">{brand.name}</span>
        </span>
      </a>
    </div>
  );
}
