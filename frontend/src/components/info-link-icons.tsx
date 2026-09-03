/* =====================================================================
 *  InfoLink · Biblioteca de iconos (SVG inline, monocromáticos-colorables)
 * ---------------------------------------------------------------------
 *  Set de iconos nativos para los botones del InfoLink. Cada entrada:
 *   - name:     id estable que se guarda en button.iconName
 *   - label:    caption corto (universal) mostrado en el picker
 *   - keywords: términos ES+EN para el buscador
 *   - render:   (color?) => JSX. `color` (opcional) pinta el glifo; si no
 *               se pasa, usa el color por defecto de marca del icono (para
 *               que sea reconocible sin configurar). Así el control "Color
 *               del icono" (spec #12) funciona SOBRE cualquier icono.
 *
 *  Los iconos son monocromáticos a propósito → respetan iconColor. Para
 *  logos multicolor de marca propia, el usuario sube una imagen (iconType
 *  = 'image'). NUEVO módulo, aditivo — no toca nada existente.
 * =================================================================== */
import type { ReactNode } from 'react';

export type InfoLinkIconEntry = {
  name: string;
  label: string;
  keywords: string;
  /** color por defecto cuando el usuario no fija uno */
  defaultColor: string;
  render: (color: string) => ReactNode;
};

// Helpers para no repetir viewBox
const line = (color: string, d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">
    {d}
  </svg>
);
const fill = (color: string, d: ReactNode, vb = '0 0 24 24') => (
  <svg viewBox={vb} fill={color} width="100%" height="100%">
    {d}
  </svg>
);

export const INFO_LINK_ICONS: InfoLinkIconEntry[] = [
  {
    name: 'whatsapp', label: 'WhatsApp', keywords: 'whatsapp wa chat mensaje phone teléfono', defaultColor: '#25D366',
    render: (c) => fill(c, <path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.4.7 4.6 1.9 6.5L4 29l7.8-1.9c1.8 1 3.8 1.5 5.9 1.5h.3c6.6 0 11.6-5.3 11.6-11.9C29.6 8.3 22.6 3 16 3zm0 21.7h-.2c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.9 1 1-3.8-.3-.4a9.7 9.7 0 01-1.5-5.2C5.3 9.6 10.1 5 16 5c2.6 0 5 1 6.8 2.9a9.5 9.5 0 012.8 6.8c0 5.3-4.5 9.9-9.6 9.9v.1zm5.5-7.4c-.3-.2-1.8-.9-2.1-1s-.5-.1-.7.2-.8 1-1 1.2-.4.2-.7.1c-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1s0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5s0-.4 0-.6-.7-1.7-1-2.3c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.4 1 2.8 1.2 3 2 3.1 4.9 4.4c.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.8-.7 2-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.4z"/>, '0 0 32 32'),
  },
  {
    name: 'instagram', label: 'Instagram', keywords: 'instagram ig insta foto camera', defaultColor: '#E1306C',
    render: (c) => (
      <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9} width="100%" height="100%">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.4" cy="6.6" r="1.2" fill={c} stroke="none" />
      </svg>
    ),
  },
  {
    name: 'facebook', label: 'Facebook', keywords: 'facebook fb meta', defaultColor: '#1877F2',
    render: (c) => fill(c, <path d="M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0022 12z"/>),
  },
  {
    name: 'tiktok', label: 'TikTok', keywords: 'tiktok tik tok video', defaultColor: '#FFFFFF',
    render: (c) => fill(c, <path d="M16.5 3c.3 2.3 1.6 3.9 3.9 4.1v2.8c-1.4.1-2.6-.3-3.9-1.1v5.6c0 5.6-6.1 7.3-8.6 3.4-1.6-2.6-.6-6.9 4.3-7.1v2.9c-.4.1-.8.2-1.2.4-1.2.5-1.8 1.3-1.6 2.6.3 2.4 4.7 3.1 4.3-1.5V3h2.8z"/>),
  },
  {
    name: 'youtube', label: 'YouTube', keywords: 'youtube yt video', defaultColor: '#FF0000',
    render: (c) => fill(c, <path d="M23 12s0-3.2-.4-4.7c-.2-.8-.9-1.5-1.7-1.7C19.3 5.2 12 5.2 12 5.2s-7.3 0-8.9.4c-.8.2-1.5.9-1.7 1.7C1 8.8 1 12 1 12s0 3.2.4 4.7c.2.8.9 1.5 1.7 1.7 1.6.4 8.9.4 8.9.4s7.3 0 8.9-.4c.8-.2 1.5-.9 1.7-1.7.4-1.5.4-4.7.4-4.7zM9.8 15V9l5.2 3-5.2 3z"/>),
  },
  {
    name: 'telegram', label: 'Telegram', keywords: 'telegram tg mensaje', defaultColor: '#229ED9',
    render: (c) => fill(c, <path d="M21.9 4.3L2.9 11.6c-1 .4-1 1.4-.2 1.7l4.8 1.5 1.9 5.7c.2.7.6.8 1.2.3l2.7-2.4 4.7 3.5c.7.4 1.3.2 1.5-.7l3-14c.2-1-.5-1.4-1.4-1.1zM8.7 14.4l9-5.6c.4-.3.8-.1.5.2l-7.4 6.8-.3 3.3-1.3-4.7z"/>),
  },
  {
    name: 'x', label: 'X', keywords: 'x twitter tuit', defaultColor: '#FFFFFF',
    render: (c) => fill(c, <path d="M17.5 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.1 21H2l7.3-8.3L2 3h6.4l4.4 5.9L17.5 3zm-1.1 16h1.7L7.7 4.7H5.9L16.4 19z"/>),
  },
  {
    name: 'linkedin', label: 'LinkedIn', keywords: 'linkedin trabajo work in', defaultColor: '#0A66C2',
    render: (c) => fill(c, <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5V9.5h3V19zM6.5 8.2A1.7 1.7 0 116.5 4.8a1.7 1.7 0 010 3.4zM19 19h-3v-4.9c0-1.2 0-2.7-1.6-2.7S12.5 12.6 12.5 14V19h-3V9.5h2.9v1.3h.1c.4-.8 1.4-1.6 2.9-1.6 3.1 0 3.6 2 3.6 4.6V19z"/>),
  },
  {
    name: 'google', label: 'Google', keywords: 'google buscar search g', defaultColor: '#4285F4',
    render: (c) => fill(c, <path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 01-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0012 22zM6.4 13.9a6 6 0 010-3.8V7.5H3.1a10 10 0 000 9l3.3-2.6zM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0012 2a10 10 0 00-8.9 5.5l3.3 2.6C7.2 7.8 9.4 6.1 12 6.1z"/>),
  },
  {
    name: 'maps', label: 'Maps', keywords: 'maps mapa google ubicación location cómo llegar', defaultColor: '#EA4335',
    render: (c) => fill(c, <path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/>),
  },
  {
    name: 'location', label: 'Ubicación', keywords: 'location ubicación pin lugar dirección', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z"/><circle cx="12" cy="10" r="3"/></>),
  },
  {
    name: 'phone', label: 'Teléfono', keywords: 'phone teléfono llamar call', defaultColor: '#FFFFFF',
    render: (c) => fill(c, <path d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.2 11 11 0 003.5.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11 11 0 00.6 3.5 1 1 0 01-.3 1l-2.2 2.3z"/>),
  },
  {
    name: 'email', label: 'Email', keywords: 'email correo mail mensaje', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>),
  },
  {
    name: 'web', label: 'Sitio web', keywords: 'web sitio página website globe globo', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></>),
  },
  {
    name: 'calendar', label: 'Calendario', keywords: 'calendar calendario fecha agenda', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></>),
  },
  {
    name: 'booking', label: 'Reservas', keywords: 'booking reservas cita agendar calendar', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4M9 14l2 2 4-4"/></>),
  },
  {
    name: 'delivery', label: 'Delivery', keywords: 'delivery domicilio moto envío reparto pedido', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M6 8h9l3 5v4h-2M6 8v9h8M6 8l-1-3H3"/><circle cx="8" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></>),
  },
  {
    name: 'menu', label: 'Menú', keywords: 'menu menú carta comida restaurante food', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M6 3v18M6 3c-1.5 0-2 1.5-2 3s.5 3 2 3M6 3c1.5 0 2 1.5 2 3s-.5 3-2 3M17 3v18M14 3v6a3 3 0 006 0V3"/></>),
  },
  {
    name: 'store', label: 'Tienda', keywords: 'store tienda shop local negocio', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6"/></>),
  },
  {
    name: 'cart', label: 'Carrito', keywords: 'cart carrito compra comprar shop', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.2 11.2a1.5 1.5 0 001.5 1.2h8.4a1.5 1.5 0 001.5-1.2L21 7H6"/></>),
  },
  {
    name: 'pdf', label: 'PDF', keywords: 'pdf documento archivo file', defaultColor: '#FF5252',
    render: (c) => line(c, <><path d="M6 2h8l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M14 2v4h4"/><path d="M8.5 16v-3.5h1a1 1 0 010 2h-1M13 16v-3.5M16 12.5h-1.5V16"/></>),
  },
  {
    name: 'download', label: 'Descargar', keywords: 'download descargar bajar', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></>),
  },
  {
    name: 'music', label: 'Música', keywords: 'music música audio nota', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></>),
  },
  {
    name: 'spotify', label: 'Spotify', keywords: 'spotify música playlist', defaultColor: '#1DB954',
    render: (c) => fill(c, <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.6 14.4a.6.6 0 01-.9.2c-2.4-1.5-5.4-1.8-9-1a.6.6 0 11-.3-1.2c3.9-.9 7.3-.5 10 1.1a.6.6 0 01.2.9zm1.2-2.7a.8.8 0 01-1 .3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 11-.4-1.5c3.7-1.1 8.3-.6 11.4 1.4a.8.8 0 01.1 1zm.1-2.8C14.6 8.9 9.4 8.7 6.3 9.7A.9.9 0 115.7 8c3.6-1.1 9.3-.9 13 1.4a.9.9 0 11-.9 1.6z"/>),
  },
  {
    name: 'camera', label: 'Cámara', keywords: 'camera cámara foto photo', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M4 7h3l2-2h6l2 2h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.5"/></>),
  },
  {
    name: 'star', label: 'Estrella', keywords: 'star estrella favorito reseña rating', defaultColor: '#FBBF24',
    render: (c) => fill(c, <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z"/>),
  },
  {
    name: 'heart', label: 'Corazón', keywords: 'heart corazón like me gusta', defaultColor: '#F43F5E',
    render: (c) => fill(c, <path d="M12 21s-7-4.5-9.3-9C1.2 8.7 2.6 5.5 5.7 5c2-.3 3.5.8 4.3 2 .8-1.2 2.3-2.3 4.3-2 3.1.5 4.5 3.7 3 7-2.3 4.5-9.3 9-9.3 9z"/>),
  },
  {
    name: 'clock', label: 'Horario', keywords: 'clock reloj horario hora time', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>),
  },
  {
    name: 'link', label: 'Enlace', keywords: 'link enlace url', defaultColor: '#FFFFFF',
    render: (c) => line(c, <><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/></>),
  },
];

export const INFO_LINK_ICONS_BY_NAME: Record<string, InfoLinkIconEntry> =
  Object.fromEntries(INFO_LINK_ICONS.map((i) => [i.name, i]));

/** Renderiza el glifo de un icono nativo por nombre. `color` opcional
 *  (si falta usa el defaultColor de marca del icono). Devuelve null si el
 *  nombre no existe. */
export function renderInfoLinkIcon(name: string | undefined, color?: string): ReactNode {
  if (!name) return null;
  const entry = INFO_LINK_ICONS_BY_NAME[name];
  if (!entry) return null;
  return entry.render(color || entry.defaultColor);
}

/** Filtra la biblioteca por texto (label + keywords + name). */
export function searchInfoLinkIcons(q: string): InfoLinkIconEntry[] {
  const s = q.trim().toLowerCase();
  if (!s) return INFO_LINK_ICONS;
  return INFO_LINK_ICONS.filter(
    (i) =>
      i.name.includes(s) ||
      i.label.toLowerCase().includes(s) ||
      i.keywords.toLowerCase().includes(s),
  );
}
