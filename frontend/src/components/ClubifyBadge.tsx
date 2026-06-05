/**
 * Badge de marca Clubify que aparece SIEMPRE en superficies que ven los
 * clientes finales (storefront, wallet, recibos, links públicos). Esta
 * marca NO es desactivable por el dueño del negocio — es un mínimo no
 * negociable del producto.
 *
 * variants:
 *  - "subtle": texto gris en footer (para fondos claros).
 *  - "pill":   pastilla blanca con sombra (para fondos oscuros / imagen
 *              / gradient).
 *  - "auto":   decide entre subtle y pill según `dark`. Default en
 *              superficies con fondo configurable por el usuario.
 */
export function ClubifyBadge({
  variant = 'subtle',
  dark,
}: {
  variant?: 'subtle' | 'pill' | 'auto';
  /** Solo se respeta cuando variant='auto'. Si true, renderea como pill
   *  (claro sobre fondo oscuro); si false, como subtle (oscuro sobre
   *  fondo claro). Pasalo desde el parent usando `isDarkBackground()`. */
  dark?: boolean;
}) {
  const resolved =
    variant === 'auto' ? (dark ? 'pill' : 'subtle') : variant;
  if (resolved === 'pill') {
    return (
      <a
        href="https://soyclubify.com?utm_source=storefront&utm_medium=badge"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 bg-white/95 hover:bg-white text-ink/80 hover:text-ink text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-sm transition"
      >
        <span className="w-3.5 h-3.5 rounded-[4px] bg-gradient-to-br from-brand-400 to-brand-700 text-white flex items-center justify-center font-bold text-[8px]">
          C
        </span>
        Hecho con Clubify
      </a>
    );
  }
  return (
    <div className="text-center text-[11px] text-mute pt-4 pb-6 select-none">
      <a
        href="https://soyclubify.com?utm_source=storefront&utm_medium=badge"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 hover:text-ink transition"
      >
        <span className="w-3.5 h-3.5 rounded-[4px] bg-gradient-to-br from-brand-400 to-brand-700 text-white flex items-center justify-center font-bold text-[8px]">
          C
        </span>
        <span>
          Hecho con <span className="font-semibold text-ink">Clubify</span>
        </span>
      </a>
    </div>
  );
}
