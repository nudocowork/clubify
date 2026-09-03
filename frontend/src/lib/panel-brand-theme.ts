/**
 * Generador del tema del panel por marca blanca. Los colores están FIJOS en
 * tailwind.config (no son CSS vars), así que el override del verde Clubify al
 * color de la marca se hace con un bloque CSS scopeado a `.brand-panel`.
 *
 * Se usa en DOS lugares para evitar el flash del tema por defecto (FODT):
 *  - Server: los layouts del panel (app/app, app/admin) lo inyectan en el
 *    primer HTML según el host → el primer paint ya sale con el color real.
 *  - Cliente: AppShell lo re-inyecta (impersonación / acceso por slug en el
 *    dominio Clubify, donde el server no puede resolver la marca por host).
 */

/** Oscurece un hex en `amount` (0..1) — para hovers. */
export function darkenHex(hex: string, amount = 0.12): string {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  const ch = (i: number) =>
    Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/** CSS scopeado a `.brand-auth` (pantallas de login/registro/reset): voltea los
 *  tokens brand/ok al color de la marca. Mismo contenido que BrandAuthTheme,
 *  extraído acá para poder inyectarlo también desde el SERVER (anti-flash). */
export function authBrandCss(color: string): string {
  const c = color || '#16a34a';
  const hover = darkenHex(c, 0.12);
  // Gradientes de marca: las clases `from-brand-*`/`via-brand-*`/`to-brand-*`
  // setean variables `--tw-gradient-*`, NO background-color, así que el override
  // de arriba no las alcanza → un panel `bg-gradient-to-* from-brand-400` queda
  // VERDE Clubify aunque la marca sea otra (ej. el aside de /activar). Volteamos
  // los tres stops al color de la marca (claro→marca→oscuro para conservar el
  // degradado). Mismo enfoque que `.sellea-theme` en las landings.
  const gFrom = mixHex(c, 'white', 0.14);
  const gTo = darkenHex(c, 0.28);
  return `
.brand-auth .text-brand,.brand-auth [class*="text-brand"]{color:${c}!important}
.brand-auth [class*="bg-brand"]:not([class*="bg-brand-soft"]){background-color:${c}!important}
.brand-auth [class*="bg-brand-soft"]{background-color:${c}1f!important}
.brand-auth [class*="border-brand"]{border-color:${c}!important}
.brand-auth .text-ok,.brand-auth [class*="text-ok"]{color:${c}!important}
.brand-auth .btn-primary{background-color:${c}!important;border-color:${c}!important}
.brand-auth .btn-primary:hover{background-color:${hover}!important;border-color:${hover}!important}
.brand-auth .tab-active{background-color:${c}!important}
.brand-auth .btn-link{color:${c}!important}
.brand-auth [class*="accent-brand"]{accent-color:${c}!important}
.brand-auth [class*="from-brand"]{--tw-gradient-from:${gFrom} var(--tw-gradient-from-position)!important;--tw-gradient-to:${c}00 var(--tw-gradient-to-position)!important;--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to)!important}
.brand-auth [class*="via-brand"]{--tw-gradient-to:${c}00 var(--tw-gradient-to-position)!important;--tw-gradient-stops:var(--tw-gradient-from),${c} var(--tw-gradient-via-position),var(--tw-gradient-to)!important}
.brand-auth [class*="to-brand"]{--tw-gradient-to:${gTo} var(--tw-gradient-to-position)!important}
.brand-auth .input:focus{border-color:${c}!important;box-shadow:0 0 0 3px ${c}33!important}
`;
}

/** Mezcla un hex hacia negro o blanco en `amount` (0..1). */
export function mixHex(
  hex: string,
  target: 'black' | 'white',
  amount: number,
): string {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const t = target === 'black' ? 0 : 255;
  const mix = (c: number) => Math.round(c + (t - c) * amount);
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

/** CSS scopeado a `.brand-panel` que voltea TODO el verde Clubify del panel
 *  (tokens brand/ok + verdes del sidebar) al color de la marca. */
export function panelBrandCss(color: string, sidebarBg?: string | null): string {
  const c = color;
  // Fondo del sidebar: si la marca definió un color propio (backgroundColor) se
  // usa tal cual → permite un sidebar de OTRO tono (ej. #1A1033) manteniendo el
  // acento. Si no, se deriva oscureciendo el acento (comportamiento histórico).
  const bg = sidebarBg && /^#[0-9a-fA-F]{6}$/.test(sidebarBg) ? sidebarBg : null;
  const sb = bg || mixHex(c, 'black', 0.86); // fondo sidebar (oscuro)
  const sb2 = bg ? mixHex(bg, 'black', 0.25) : mixHex(c, 'black', 0.9);
  const hover = bg ? mixHex(bg, 'white', 0.08) : mixHex(c, 'black', 0.72); // hover sidebar
  const btnHover = mixHex(c, 'black', 0.12); // hover de botones (tono apenas más oscuro)
  const section = mixHex(c, 'white', 0.5); // labels de sección (claros)
  const soft = c + '24'; // ~14% alpha para *-soft
  return `
.brand-panel [class~="bg-sidebar-bg"]{background-color:${sb}!important}
.brand-panel [class~="bg-sidebar-bg2"]{background-color:${sb2}!important}
.brand-panel [class~="bg-sidebar-hover"],.brand-panel .hover\\:bg-sidebar-hover:hover{background-color:${hover}!important}
.brand-panel [class~="bg-sidebar-active"],.brand-panel .hover\\:bg-sidebar-active:hover{background-color:${c}!important}
.brand-panel [class~="text-sidebar-section"]{color:${section}!important}
.brand-panel [class*="bg-brand"]:not([class*="bg-brand-soft"]){background-color:${c}!important}
.brand-panel [class*="bg-brand-soft"]{background-color:${soft}!important}
.brand-panel [class*="text-brand"]{color:${c}!important}
.brand-panel [class*="border-brand"]{border-color:${c}!important}
.brand-panel .tab-active{background-color:${c}!important}
.brand-panel .hover\\:bg-brand-700:hover,.brand-panel .hover\\:border-brand-700:hover{background-color:${c}!important;border-color:${c}!important}
.brand-panel [class~="text-ok"]{color:${c}!important}
.brand-panel [class~="bg-ok"]:not([class*="bg-ok-soft"]){background-color:${c}!important}
.brand-panel [class*="bg-ok-soft"]{background-color:${soft}!important}
.brand-panel [class~="border-ok"]{border-color:${c}!important}
.brand-panel .btn-primary{background-color:${c}!important;border-color:${c}!important}
.brand-panel .btn-primary:hover{background-color:${btnHover}!important;border-color:${btnHover}!important}
.brand-panel .btn-link{color:${c}!important}
.brand-panel .input:focus{border-color:${c}!important;box-shadow:0 0 0 3px ${soft}!important}
`;
}
