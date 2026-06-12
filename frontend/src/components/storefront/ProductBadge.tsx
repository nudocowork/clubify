/**
 * Badge para etiquetas de producto en la vista catálogo (Bloque 6 —
 * 2026-06-11). Mismo componente para los 6 layouts del storefront +
 * cualquier otra superficie donde se muestren productos.
 *
 * Antes cada layout pintaba el tag con un estilo distinto (top-left
 * con fondo blanco en GRID, "▸ Tag" en CLEAN, pill en CLASSIC, etc.).
 * El badge ahora es consistente y reconoce 5 etiquetas conocidas con
 * colores intencionales (Nuevo=azul, Popular=naranja, Promo=rojo,
 * 2x1=rojo, Recomendado=ámbar). Cualquier tag custom cae al estilo
 * neutral del primary del tenant.
 *
 * Variantes:
 *  - 'overlay' → posicionado absolute top-left (default sobre imagen).
 *    Si el producto tiene descuento se puede usar 'overlay-right' para
 *    no chocar con el badge `-X%`.
 *  - 'inline' → renderizado en flujo normal, junto al nombre o precio.
 */

type BadgeVariant = 'overlay' | 'overlay-right' | 'inline';

type Style = {
  bg: string;
  text: string;
  border?: string;
};

const NEUTRAL: Style = { bg: 'bg-white/95', text: 'text-ink', border: 'border border-line/30' };

const KNOWN: Record<string, Style> = {
  nuevo: { bg: 'bg-blue-600', text: 'text-white' },
  new: { bg: 'bg-blue-600', text: 'text-white' },
  popular: { bg: 'bg-orange-500', text: 'text-white' },
  recomendado: { bg: 'bg-amber-500', text: 'text-white' },
  promo: { bg: 'bg-red-600', text: 'text-white' },
  oferta: { bg: 'bg-red-600', text: 'text-white' },
  '2x1': { bg: 'bg-red-600', text: 'text-white' },
  sale: { bg: 'bg-red-600', text: 'text-white' },
  agotado: { bg: 'bg-mute', text: 'text-white' },
};

function styleFor(tag: string): Style {
  return KNOWN[tag.toLowerCase().trim()] ?? NEUTRAL;
}

export function ProductBadge({
  tag,
  variant = 'overlay',
}: {
  tag: string;
  variant?: BadgeVariant;
}) {
  if (!tag) return null;
  const s = styleFor(tag);
  const base =
    'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shadow-sm';
  const positional =
    variant === 'overlay'
      ? 'absolute top-2 left-2 z-10'
      : variant === 'overlay-right'
        ? 'absolute top-2 right-2 z-10'
        : 'inline-block';
  return (
    <span
      className={`${positional} ${base} ${s.bg} ${s.text} ${s.border ?? ''}`}
    >
      {tag}
    </span>
  );
}

/**
 * Renderiza el primer tag como overlay (default top-left). Útil para
 * cards con imagen donde solo queremos mostrar el principal.
 */
export function PrimaryProductBadge({
  tags,
  variant = 'overlay',
}: {
  tags: string[] | null | undefined;
  variant?: BadgeVariant;
}) {
  const first = tags?.[0];
  if (!first) return null;
  return <ProductBadge tag={first} variant={variant} />;
}
