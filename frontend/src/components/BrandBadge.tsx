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
  // Slug de la marca blanca (ej. 'sellea'). Lo usan pantallas que cambian
  // comportamiento por marca, como exigir correo/cumpleaños en el registro.
  slug?: string | null;
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
  color,
}: {
  brand: BrandBadgeBrand;
  variant?: 'subtle' | 'pill' | 'auto';
  dark?: boolean;
  /**
   * Color del texto, elegido por el negocio. Null/vacío = automático.
   *
   * Existe porque el badge se pierde. La variante clara usa los colores de
   * tema, pensados para fondo claro, y sobre una portada oscura o una foto no
   * se lee. El automático acierta casi siempre — pero «casi» no basta cuando
   * el fondo es una imagen.
   *
   * Tiñe SOLO el texto. La marca —el cuadrito con la inicial o el logo— se
   * queda con el suyo: es de la marca, no del negocio que la pinta.
   */
  color?: string | null;
}) {
  const resolved = variant === 'auto' ? (dark ? 'pill' : 'subtle') : variant;
  const tinte = color && String(color).trim() ? String(color).trim() : null;
  const label = brand.attribution?.madeWith || `Hecho con ${brand.name}`;
  const initial = (brand.initial || brand.name[0] || '·').toUpperCase();
  /** El color DE LA MARCA, para el cuadrito. No lo pisa el tinte del negocio. */
  const colorDeMarca = brand.primaryColor || '#22C55E';
  const href = brand.websiteUrl
    ? `${brand.websiteUrl}?utm_source=storefront&utm_medium=badge`
    : '#';

  // Mini favicon de la marca: si el backend manda icono/logo, lo mostramos como
  // imagen; si no, caemos al cuadrito con la inicial. Antes SIEMPRE se dibujaba
  // la inicial aunque hubiera favicon (el logo "no aparecía" bajo el formulario).
  const markImg = brand.iconUrl || brand.logoUrl || null;
  const Mark = markImg ? (
    <img
      src={markImg}
      alt=""
      loading="lazy"
      decoding="async"
      className="w-3.5 h-3.5 rounded-[4px] object-contain bg-white flex-none"
    />
  ) : (
    <span
      className="w-3.5 h-3.5 rounded-[4px] text-white flex items-center justify-center font-bold text-[8px]"
      style={{ background: colorDeMarca }}
    >
      {initial}
    </span>
  );

  if (resolved === 'pill') {
    // Con color propio la pastilla blanca se quita a propósito: el color se
    // eligió para leerse contra el FONDO de la página, no contra blanco. Si no,
    // elegir blanco sobre un fondo negro daría blanco sobre blanco.
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={
          tinte
            ? 'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 transition'
            : 'inline-flex items-center gap-1.5 bg-white/95 hover:bg-white text-ink/80 hover:text-ink text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-sm transition'
        }
        style={tinte ? { color: tinte } : undefined}
      >
        {Mark}
        {label}
      </a>
    );
  }
  return (
    <div
      className={`text-center text-[11px] pt-4 pb-6 select-none ${tinte ? '' : 'text-mute'}`}
      style={tinte ? { color: tinte } : undefined}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-1.5 transition ${tinte ? '' : 'hover:text-ink'}`}
        style={tinte ? { color: tinte } : undefined}
      >
        {Mark}
        <span>
          Hecho con{' '}
          <span className={`font-semibold ${tinte ? '' : 'text-ink'}`}>
            {brand.name}
          </span>
        </span>
      </a>
    </div>
  );
}
