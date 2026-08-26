// Tipos, fábricas y render a HTML de CORREO de las plantillas del Email
// Marketing de la marca. Vive separado del editor por dos razones: se puede
// probar sin montar React, y las reglas duras del dominio quedan en un solo
// lugar. Las reglas:
//
// 1. El HTML final va en TABLAS con estilos EN LÍNEA y ancho máximo ~600px.
//    Los clientes de correo (Outlook, Gmail, etc.) no soportan flexbox, grid
//    ni hojas de estilo externas. El único <style> embebido lleva media
//    queries y dark mode — mejora progresiva: quien lo ignora (Outlook
//    escritorio) ve la versión de escritorio, que funciona igual.
// 2. NUNCA un data:image dentro del documento. Las imágenes se suben a S3 y
//    en los bloques viaja solo la URL. El backend rechaza con 400 cualquier
//    guardado que contenga data:image (la tabla QrPoster llegó a pesar el 77%
//    de la base por incrustar imágenes en base64 — ese error no se repite).
// 3. ESTE archivo es la ÚNICA fuente del HTML de una plantilla. El editor
//    regenera `html` desde los bloques en cada guardado, así que cualquier
//    HTML escrito a mano en otro sitio se pierde al primer guardado. Por eso
//    el seed de plantillas de fábrica (backend/scripts/seed-email-templates.cjs)
//    también renderiza con renderEmailHtml() en vez de maquetar aparte: lo que
//    se previsualiza, lo que se edita y lo que se envía son lo mismo.

// ── Tokens de diseño ────────────────────────────────────────────────────────
// Un solo sitio para colores, tipografía y ritmo vertical. Los bloques nuevos
// tiran de aquí para sus valores por defecto; lo que el usuario cambia en el
// editor manda sobre el token.
export const EMAIL_TOKENS = {
  color: {
    /** Acento de las plantillas de fábrica: un índigo que no se parece a
     *  ninguna marca concreta (las de fábrica se listan para TODAS). Cada
     *  marca recolorea su copia desde Ajustes → Color de acento. */
    acento: '#4f46e5',
    acentoOscuro: '#4338ca',
    acentoSuave: '#eef2ff',
    tinta: '#111827',
    tintaSuave: '#6b7280',
    borde: '#e5e7eb',
    fondo: '#f4f5f7',
    tarjeta: '#ffffff',
    sobreAcento: '#ffffff',
  },
  /** Stack seguro: son fuentes del sistema, no webfonts (una webfont que
   *  Outlook no tiene termina renderizando Times New Roman). */
  fuente: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  texto: {
    h1: { size: 30, line: 38 },
    h2: { size: 22, line: 30 },
    body: { size: 16, line: 26 },
    small: { size: 13, line: 20 },
  },
  radio: 8,
  /** Ritmo vertical entre bloques y relleno lateral del contenedor. */
  espacio: { s: 16, m: 24, l: 32, xl: 40 },
} as const;

export type EmailBlockType =
  | 'text'
  | 'heading'
  | 'image'
  | 'button'
  | 'buttons'
  | 'logo'
  | 'divider'
  | 'social'
  | 'footer'
  | 'spacer'
  | 'html'
  | 'feature'
  | 'product'
  | 'order'
  | 'quote'
  | 'rating'
  | 'coupon';

export type SocialNetworkKind =
  | 'facebook'
  | 'instagram'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'linkedin'
  | 'whatsapp'
  | 'web';

export type EmailBlock = { id: string; type: EmailBlockType; props: Record<string, any> };
export type EmailColumn = { id: string; widthPct: number; blocks: EmailBlock[] };
/** Fondo y relleno de la BANDA horizontal. Es lo que permite «banda de color»
 *  y tarjetas con aire sin meter HTML a mano. */
export type EmailRowProps = { background: string; paddingV: number; paddingH: number };
export type EmailRow = { id: string; columns: EmailColumn[]; props: EmailRowProps };
export type EmailDocSettings = {
  backgroundColor: string;
  contentBackground: string;
  contentWidth: number;
  fontFamily: string;
  textColor: string;
  /** Color de acento: botones, enlaces, antetítulos, iconos y cupones lo
   *  heredan cuando no traen color propio. Cambiarlo repinta la plantilla. */
  linkColor: string;
  /** Texto de vista previa (lo que el cliente ve junto al asunto en la
   *  bandeja). Va oculto al principio del cuerpo. 40-90 caracteres. */
  preheader: string;
};
export type EmailDoc = { version: 1; settings: EmailDocSettings; rows: EmailRow[] };

export function uid(): string {
  try {
    return 'b' + crypto.randomUUID().slice(0, 8);
  } catch {
    return 'b' + Math.random().toString(36).slice(2, 10);
  }
}

export const BLOCK_META: Record<EmailBlockType, { label: string; icon: string }> = {
  heading: { label: 'Título', icon: '🅃' },
  text: { label: 'Texto', icon: '📝' },
  image: { label: 'Imagen', icon: '🖼️' },
  button: { label: 'Botón', icon: '🔘' },
  buttons: { label: 'Botón doble', icon: '⚏' },
  logo: { label: 'Logotipo', icon: '🏷️' },
  feature: { label: 'Icono + texto', icon: '✨' },
  product: { label: 'Producto', icon: '🛍️' },
  order: { label: 'Resumen de pedido', icon: '🧾' },
  quote: { label: 'Testimonio', icon: '💬' },
  rating: { label: 'Estrellas', icon: '⭐' },
  coupon: { label: 'Cupón', icon: '🎟️' },
  divider: { label: 'Divisor', icon: '➖' },
  social: { label: 'Redes sociales', icon: '🌐' },
  footer: { label: 'Pie de página', icon: '📄' },
  spacer: { label: 'Espaciador', icon: '↕️' },
  html: { label: 'Código HTML', icon: '＜＞' },
};

// Orden del panel de Elementos: primero lo que se usa en todas las plantillas,
// después los bloques de contenido rico, y al final los utilitarios.
export const ELEMENT_ORDER: EmailBlockType[] = [
  'heading',
  'text',
  'image',
  'button',
  'buttons',
  'logo',
  'feature',
  'product',
  'order',
  'quote',
  'rating',
  'coupon',
  'divider',
  'social',
  'footer',
  'spacer',
  'html',
];

// Diseños de columnas disponibles. Los anchos suman 100 para que el render
// por porcentajes cierre exacto en clientes quisquillosos.
export const LAYOUTS: { key: string; label: string; widths: number[] }[] = [
  { key: '1', label: '1 columna', widths: [100] },
  { key: '2', label: '2 columnas', widths: [50, 50] },
  { key: '3', label: '3 columnas', widths: [33.33, 33.34, 33.33] },
  { key: '1-2', label: '1/3 : 2/3', widths: [33.33, 66.67] },
  { key: '2-1', label: '2/3 : 1/3', widths: [66.67, 33.33] },
];

// Solo tipografías con presencia casi universal en clientes de correo: una
// webfont bonita que Outlook no tiene termina renderizando Times New Roman.
export const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'Sistema (recomendada)', value: EMAIL_TOKENS.fuente },
  { label: 'Arial (sans serif)', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia (serif)', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: 'Courier (monoespaciada)', value: "'Courier New', Courier, monospace" },
];

// Sin imágenes alojadas para los íconos de redes, usamos "chapitas" de texto
// con el color de cada marca: una celda con bgcolor y una letra funciona en
// todos los clientes (en Outlook el círculo degrada a cuadrado, aceptable).
export const SOCIAL_NETWORKS: Record<
  SocialNetworkKind,
  { label: string; color: string; abbr: string }
> = {
  facebook: { label: 'Facebook', color: '#1877f2', abbr: 'f' },
  instagram: { label: 'Instagram', color: '#e4405f', abbr: 'IG' },
  x: { label: 'X (Twitter)', color: '#0f172a', abbr: 'X' },
  youtube: { label: 'YouTube', color: '#ff0000', abbr: '▶' },
  tiktok: { label: 'TikTok', color: '#111111', abbr: 'TT' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2', abbr: 'in' },
  whatsapp: { label: 'WhatsApp', color: '#25d366', abbr: 'WA' },
  web: { label: 'Sitio web', color: '#475569', abbr: 'www' },
};

export function defaultSettings(): EmailDocSettings {
  return {
    backgroundColor: EMAIL_TOKENS.color.fondo,
    contentBackground: EMAIL_TOKENS.color.tarjeta,
    contentWidth: 600,
    fontFamily: EMAIL_TOKENS.fuente,
    textColor: EMAIL_TOKENS.color.tinta,
    linkColor: EMAIL_TOKENS.color.acento,
    preheader: '',
  };
}

export function defaultRowProps(): EmailRowProps {
  // El relleno lateral vive en la FILA (no en cada bloque): así el contenido
  // queda alineado aunque se mezclen bloques distintos, y una banda de color
  // llega de borde a borde con su texto bien metido.
  return { background: '', paddingV: 8, paddingH: EMAIL_TOKENS.espacio.l };
}

export function emptyDoc(): EmailDoc {
  return { version: 1, settings: defaultSettings(), rows: [] };
}

/** Crea un bloque con valores por defecto sensatos (en español). */
export function newBlock(type: EmailBlockType, overrides?: Record<string, any>): EmailBlock {
  const T = EMAIL_TOKENS;
  const defaults: Record<EmailBlockType, Record<string, any>> = {
    heading: {
      kicker: '',
      title: 'Un titular que se entiende de una pasada',
      subtitle: '',
      level: 'h2',
      align: 'left',
      color: '',
      kickerColor: '',
    },
    text: { html: 'Escribe aquí tu texto…', align: 'left', fontSize: T.texto.body.size, color: '' },
    image: { url: '', alt: '', width: null, align: 'center', href: '', radius: 0 },
    logo: { url: '', alt: 'Logotipo', width: 140, align: 'center', href: '' },
    button: {
      label: 'Ver más',
      href: '',
      background: '',
      color: T.color.sobreAcento,
      fontSize: T.texto.body.size,
      radius: T.radio,
      align: 'center',
      paddingV: 14,
      paddingH: 32,
    },
    buttons: {
      label: 'Acción principal',
      href: '',
      label2: 'Segunda opción',
      href2: '',
      background: '',
      color: T.color.sobreAcento,
      fontSize: T.texto.body.size,
      radius: T.radio,
      align: 'center',
      paddingV: 14,
      paddingH: 26,
    },
    feature: {
      icon: '✅',
      iconBg: '',
      iconColor: T.color.sobreAcento,
      title: 'Una ventaja concreta',
      text: 'Una línea explicando por qué le conviene al cliente.',
      layout: 'row',
      align: 'left',
    },
    product: {
      url: '',
      alt: 'Foto del producto',
      title: 'Nombre del producto',
      description: 'Dos líneas describiendo qué es y para quién.',
      price: '',
      oldPrice: '',
      label: 'Ver producto',
      href: '',
      background: T.color.tarjeta,
      borderColor: T.color.borde,
      radius: T.radio,
    },
    order: {
      title: 'Resumen de tu pedido',
      items: [
        { name: 'Producto o servicio', qty: '1', price: '' },
      ],
      totals: [{ label: 'Total', value: '', strong: true }],
      note: '',
    },
    quote: {
      text: 'Lo que dijo un cliente contento, con sus palabras.',
      author: 'Nombre del cliente',
      role: '',
      stars: 5,
      background: T.color.acentoSuave,
      accent: '',
    },
    rating: { stars: 5, label: '', color: '#f59e0b', size: 22, align: 'center' },
    coupon: {
      code: 'CODIGO',
      label: 'Tu código de descuento',
      note: '',
      background: T.color.acentoSuave,
      color: '',
      borderColor: '',
    },
    divider: { color: T.color.borde, thickness: 1, paddingV: 12 },
    social: {
      networks: [
        { kind: 'facebook', url: '' },
        { kind: 'instagram', url: '' },
      ],
      size: 34,
      align: 'center',
    },
    footer: {
      html:
        'Recibiste este correo porque estás en nuestra lista de contactos.<br>' +
        'Si ya no deseas recibir estos mensajes, responde con la palabra BAJA.',
      color: T.color.tintaSuave,
      fontSize: T.texto.small.size,
      /** Enlace de baja opcional: si la marca tiene una URL propia se pinta
       *  como enlace; si no, queda la instrucción de responder BAJA, que es
       *  el mecanismo de opt-out que sí existe en el producto. */
      unsubscribeUrl: '',
      unsubscribeLabel: 'Darme de baja',
      address: '',
    },
    spacer: { height: EMAIL_TOKENS.espacio.m },
    html: { html: '' },
  };
  return { id: uid(), type, props: { ...defaults[type], ...(overrides ?? {}) } };
}

export function newRow(
  widths: number[],
  blocksPerCol?: EmailBlock[][],
  props?: Partial<EmailRowProps>,
): EmailRow {
  return {
    id: uid(),
    columns: widths.map((w, i) => ({ id: uid(), widthPct: w, blocks: blocksPerCol?.[i] ?? [] })),
    props: { ...defaultRowProps(), ...(props ?? {}) },
  };
}

// ── Saneo de lo que llega del servidor ──────────────────────────────────────
// El `blocks` es Json libre en la BD: puede venir null, {} o corrupto (otra
// máquina, versiones viejas). El editor jamás debe crashear por eso: se
// normaliza a un doc válido y lo ilegible se descarta.
export function coerceDoc(raw: any): EmailDoc {
  const base = emptyDoc();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settings: EmailDocSettings = { ...base.settings };
  for (const k of Object.keys(settings) as (keyof EmailDocSettings)[]) {
    const v = (s as any)[k];
    if (k === 'contentWidth') {
      if (typeof v === 'number' && v >= 320 && v <= 800) settings.contentWidth = Math.round(v);
    } else if (typeof v === 'string' && v) {
      (settings as any)[k] = v;
    }
  }
  const rows: EmailRow[] = [];
  if (Array.isArray(raw.rows)) {
    for (const r of raw.rows) {
      if (!r || !Array.isArray(r.columns) || r.columns.length === 0) continue;
      const columns: EmailColumn[] = r.columns.map((c: any) => ({
        id: typeof c?.id === 'string' ? c.id : uid(),
        widthPct:
          typeof c?.widthPct === 'number' && c.widthPct > 0 && c.widthPct <= 100
            ? c.widthPct
            : Math.round(100 / r.columns.length),
        blocks: Array.isArray(c?.blocks)
          ? c.blocks
              .filter((b: any) => b && typeof b.type === 'string' && b.type in BLOCK_META)
              .map((b: any) => ({
                id: typeof b.id === 'string' ? b.id : uid(),
                type: b.type as EmailBlockType,
                // Merge sobre los defaults: si un guardado viejo no tiene una
                // prop nueva, el bloque no queda a medio configurar.
                props: {
                  ...newBlock(b.type as EmailBlockType).props,
                  ...(b.props && typeof b.props === 'object' ? b.props : {}),
                },
              }))
          : [],
      }));
      // Las filas guardadas antes de que existieran las props de fila no las
      // traen: heredan los defaults y quedan con el relleno estándar.
      const rp = r.props && typeof r.props === 'object' ? r.props : {};
      const props: EmailRowProps = {
        background: typeof rp.background === 'string' ? rp.background : '',
        paddingV: numOr(rp.paddingV, defaultRowProps().paddingV, 0, 120),
        paddingH: numOr(rp.paddingH, defaultRowProps().paddingH, 0, 60),
      };
      rows.push({ id: typeof r.id === 'string' ? r.id : uid(), columns, props });
    }
  }
  return { version: 1, settings, rows };
}

function numOr(v: any, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ── Guardas anti data:image ─────────────────────────────────────────────────
// El backend rechaza con 400, pero avisar ANTES de intentar guardar da un
// mensaje accionable ("está en tal bloque") en vez de un error genérico.
export function findDataImage(doc: EmailDoc): string | null {
  for (const row of doc.rows) {
    for (const col of row.columns) {
      for (const b of col.blocks) {
        if (/data:\s*image/i.test(JSON.stringify(b.props ?? {}))) {
          return BLOCK_META[b.type]?.label ?? b.type;
        }
      }
    }
  }
  return null;
}

export function containsDataImage(html: string): boolean {
  return /data:\s*image/i.test(html);
}

export function docHasContent(doc: EmailDoc): boolean {
  return doc.rows.some((r) => r.columns.some((c) => c.blocks.length > 0));
}

// ── Render a HTML de correo ─────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Para atributos href/src: escapamos comillas y ángulos; el contenido HTML de
// los bloques de texto va tal cual (es contenido del propio autor del correo).
function escAttr(s: string): string {
  return esc(String(s ?? ''));
}

function wrapTd(td: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${td}</tr></table>`;
}

/** Relleno vertical estándar de un bloque. El lateral lo pone la fila. */
function pad(bottom: number = EMAIL_TOKENS.espacio.s, top: number = 0): string {
  return `padding:${top}px 0 ${bottom}px 0;`;
}

/**
 * Botón "a prueba de balas": VML para Outlook (que ignora padding en <a>) y
 * tabla + <a> inline-block para el resto. Los dos caminos van envueltos en
 * comentarios condicionales para que cada cliente pinte SOLO el suyo.
 */
function bulletproofButton(o: {
  label: string;
  href: string;
  bg: string;
  color: string;
  fontSize: number;
  radius: number;
  paddingV: number;
  paddingH: number;
  font: string;
  outline?: boolean;
}): string {
  const label = esc(o.label || 'Botón');
  const href = escAttr(o.href || '#');
  const fill = o.outline ? '#ffffff' : o.bg;
  const textColor = o.outline ? o.bg : o.color;
  // VML necesita medidas en px: se estiman desde el texto. Pasarse un poco es
  // inofensivo (el botón sale algo más ancho en Outlook); quedarse corto
  // recortaría la etiqueta, así que se redondea hacia arriba.
  const h = Math.round(o.fontSize * 1.4) + o.paddingV * 2;
  const w = Math.max(150, Math.round(o.label.length * o.fontSize * 0.62) + o.paddingH * 2);
  const arc = Math.min(50, Math.round((o.radius / Math.max(h, 1)) * 100));
  const vml =
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `href="${href}" style="height:${h}px;v-text-anchor:middle;width:${w}px;" arcsize="${arc}%" ` +
    `strokecolor="${o.bg}" strokeweight="1px" fillcolor="${fill}">` +
    `<w:anchorlock/>` +
    `<center style="color:${textColor};font-family:${o.font};font-size:${o.fontSize}px;font-weight:bold;">${label}</center>` +
    `</v:roundrect>` +
    `<![endif]-->`;
  const a =
    `<!--[if !mso]><!-- -->` +
    `<table role="presentation" class="cf-btn-wrap" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">` +
    `<tr><td bgcolor="${fill}" style="border-radius:${o.radius}px;${o.outline ? `border:2px solid ${o.bg};` : ''}">` +
    `<a href="${href}" target="_blank" class="cf-btn" style="display:inline-block;padding:${o.paddingV}px ${o.paddingH}px;font-family:${o.font};font-size:${o.fontSize}px;font-weight:700;line-height:1.2;color:${textColor};text-decoration:none;border-radius:${o.radius}px;">${label}</a>` +
    `</td></tr></table>` +
    `<!--<![endif]-->`;
  return vml + a;
}

/** Estrellas ★ llenas + ☆ vacías, en texto: ninguna imagen que bloquear. */
function starsHtml(n: number, color: string, size: number): string {
  const full = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return (
    `<span style="font-size:${size}px;line-height:${Math.round(size * 1.2)}px;color:${color};letter-spacing:2px;">` +
    '★'.repeat(full) +
    `<span style="color:${EMAIL_TOKENS.color.borde};">${'★'.repeat(5 - full)}</span>` +
    `</span>`
  );
}

function renderBlock(b: EmailBlock, st: EmailDocSettings): string {
  const p = b.props ?? {};
  const T = EMAIL_TOKENS;
  const font = st.fontFamily;
  const acento = st.linkColor || T.color.acento;
  switch (b.type) {
    case 'heading': {
      const align = p.align || 'left';
      const isH1 = p.level === 'h1';
      const size = isH1 ? T.texto.h1.size : T.texto.h2.size;
      const line = isH1 ? T.texto.h1.line : T.texto.h2.line;
      const color = p.color || st.textColor;
      const kicker = String(p.kicker || '').trim();
      const subtitle = String(p.subtitle || '').trim();
      const parts: string[] = [];
      if (kicker) {
        parts.push(
          `<div style="font-family:${font};font-size:${T.texto.small.size}px;line-height:${T.texto.small.line}px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${p.kickerColor || acento};padding-bottom:8px;">${esc(kicker)}</div>`,
        );
      }
      parts.push(
        `<div class="${isH1 ? 'cf-h1' : 'cf-h2'}" style="font-family:${font};font-size:${size}px;line-height:${line}px;font-weight:700;color:${color};">${esc(p.title || '')}</div>`,
      );
      if (subtitle) {
        parts.push(
          `<div style="font-family:${font};font-size:${T.texto.body.size}px;line-height:${T.texto.body.line}px;color:${T.color.tintaSuave};padding-top:10px;">${esc(subtitle)}</div>`,
        );
      }
      return wrapTd(
        `<td align="${align}" style="${pad(T.espacio.s)}text-align:${align};">${parts.join('')}</td>`,
      );
    }
    case 'text': {
      const color = p.color || st.textColor;
      const size = Number(p.fontSize) || T.texto.body.size;
      const line = Math.round(size * 1.6);
      return wrapTd(
        `<td style="${pad(T.espacio.s)}font-family:${font};font-size:${size}px;line-height:${line}px;color:${color};text-align:${p.align || 'left'};">${p.html || ''}</td>`,
      );
    }
    case 'image':
    case 'logo': {
      const url = String(p.url || '').trim();
      // Sin URL no hay nada que mandar; un data: jamás entra al documento.
      if (!url || /^data:/i.test(url)) return '';
      const w = p.width ? Number(p.width) : null;
      const radius = Number(p.radius) || 0;
      // alt SIEMPRE presente: con las imágenes bloqueadas (el caso normal en
      // Outlook y Gmail hasta que el lector las activa) es lo único que se lee.
      const alt = escAttr(p.alt || (b.type === 'logo' ? 'Logotipo' : ''));
      const img = `<img src="${escAttr(url)}" alt="${alt}"${w ? ` width="${w}"` : ''} style="display:block;${w ? `width:${w}px;` : 'width:100%;'}max-width:100%;height:auto;border:0;outline:none;text-decoration:none;${radius ? `border-radius:${radius}px;` : ''}" />`;
      const linked = p.href ? `<a href="${escAttr(p.href)}" target="_blank">${img}</a>` : img;
      const inner =
        (p.align || 'center') === 'center'
          ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>${linked}</td></tr></table>`
          : linked;
      return wrapTd(`<td align="${p.align || 'center'}" style="${pad(T.espacio.s)}">${inner}</td>`);
    }
    case 'button': {
      const bg = p.background || acento;
      return wrapTd(
        `<td align="${p.align || 'center'}" style="${pad(T.espacio.m, 8)}">${bulletproofButton({
          label: p.label,
          href: p.href,
          bg,
          color: p.color || '#ffffff',
          fontSize: Number(p.fontSize) || T.texto.body.size,
          radius: Number(p.radius) || 0,
          paddingV: Number(p.paddingV) || 14,
          paddingH: Number(p.paddingH) || 32,
          font,
        })}</td>`,
      );
    }
    case 'buttons': {
      const bg = p.background || acento;
      const common = {
        bg,
        color: p.color || '#ffffff',
        fontSize: Number(p.fontSize) || T.texto.body.size,
        radius: Number(p.radius) || 0,
        paddingV: Number(p.paddingV) || 14,
        paddingH: Number(p.paddingH) || 26,
        font,
      };
      const uno = bulletproofButton({ ...common, label: p.label, href: p.href });
      const dos = bulletproofButton({ ...common, label: p.label2, href: p.href2, outline: true });
      return wrapTd(
        `<td align="${p.align || 'center'}" style="${pad(T.espacio.m, 8)}">` +
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${p.align || 'center'}"><tr>` +
          `<td class="cf-stack" style="padding:0 6px 0 0;">${uno}</td>` +
          `<td class="cf-stack" style="padding:0 0 0 6px;">${dos}</td>` +
          `</tr></table></td>`,
      );
    }
    case 'feature': {
      const bg = p.iconBg || acento;
      const stacked = p.layout === 'stacked';
      const align = stacked ? p.align || 'center' : 'left';
      const chip =
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${stacked ? ` align="${align}"` : ''}><tr>` +
        `<td width="44" height="44" align="center" valign="middle" bgcolor="${bg}" style="width:44px;height:44px;border-radius:22px;font-family:${font};font-size:20px;line-height:44px;color:${p.iconColor || '#ffffff'};text-align:center;">${esc(p.icon || '•')}</td>` +
        `</tr></table>`;
      const titulo = `<div style="font-family:${font};font-size:17px;line-height:24px;font-weight:700;color:${st.textColor};">${esc(p.title || '')}</div>`;
      const cuerpo = p.text
        ? `<div style="font-family:${font};font-size:${T.texto.body.size - 1}px;line-height:24px;color:${T.color.tintaSuave};padding-top:4px;">${esc(p.text)}</div>`
        : '';
      if (stacked) {
        return wrapTd(
          `<td align="${align}" style="${pad(T.espacio.s)}text-align:${align};">${chip}<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>${titulo}${cuerpo}</td>`,
        );
      }
      return wrapTd(
        `<td style="${pad(T.espacio.s)}">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
          `<td width="44" valign="top" style="width:44px;">${chip}</td>` +
          `<td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>` +
          `<td valign="top">${titulo}${cuerpo}</td>` +
          `</tr></table></td>`,
      );
    }
    case 'product': {
      const url = String(p.url || '').trim();
      const radius = Number(p.radius) || 0;
      const foto =
        url && !/^data:/i.test(url)
          ? `<tr><td style="font-size:0;line-height:0;"><img src="${escAttr(url)}" alt="${escAttr(p.alt || 'Foto del producto')}" width="100%" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:${radius}px ${radius}px 0 0;" /></td></tr>`
          : '';
      const precio = p.price
        ? `<div style="font-family:${font};font-size:20px;line-height:28px;font-weight:700;color:${st.textColor};padding-top:8px;">${esc(p.price)}` +
          (p.oldPrice
            ? ` <span style="font-size:15px;font-weight:400;color:${T.color.tintaSuave};text-decoration:line-through;">${esc(p.oldPrice)}</span>`
            : '') +
          `</div>`
        : '';
      const cta = p.label
        ? `<div style="padding-top:14px;">${bulletproofButton({
            label: p.label,
            href: p.href,
            bg: acento,
            color: '#ffffff',
            fontSize: 15,
            radius: T.radio,
            paddingV: 11,
            paddingH: 24,
            font,
          })}</div>`
        : '';
      return wrapTd(
        `<td style="${pad(T.espacio.s)}">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.background || '#ffffff'}" style="border:1px solid ${p.borderColor || T.color.borde};border-radius:${radius}px;">` +
          foto +
          `<tr><td style="padding:18px 20px 20px 20px;">` +
          `<div style="font-family:${font};font-size:17px;line-height:24px;font-weight:700;color:${st.textColor};">${esc(p.title || '')}</div>` +
          (p.description
            ? `<div style="font-family:${font};font-size:15px;line-height:23px;color:${T.color.tintaSuave};padding-top:6px;">${esc(p.description)}</div>`
            : '') +
          precio +
          cta +
          `</td></tr></table></td>`,
      );
    }
    case 'order': {
      const items = Array.isArray(p.items) ? p.items : [];
      const totals = Array.isArray(p.totals) ? p.totals : [];
      const filas = items
        .map(
          (it: any) =>
            `<tr>` +
            `<td style="padding:12px 0;border-bottom:1px solid ${T.color.borde};font-family:${font};font-size:15px;line-height:22px;color:${st.textColor};">${esc(it?.name || '')}` +
            (it?.qty ? `<span style="color:${T.color.tintaSuave};"> × ${esc(it.qty)}</span>` : '') +
            `</td>` +
            `<td align="right" style="padding:12px 0;border-bottom:1px solid ${T.color.borde};font-family:${font};font-size:15px;line-height:22px;color:${st.textColor};white-space:nowrap;">${esc(it?.price || '')}</td>` +
            `</tr>`,
        )
        .join('');
      const sumas = totals
        .map(
          (t: any) =>
            `<tr>` +
            `<td style="padding:8px 0 0 0;font-family:${font};font-size:${t?.strong ? 17 : 15}px;line-height:24px;${t?.strong ? 'font-weight:700;' : ''}color:${t?.strong ? st.textColor : T.color.tintaSuave};">${esc(t?.label || '')}</td>` +
            `<td align="right" style="padding:8px 0 0 0;font-family:${font};font-size:${t?.strong ? 17 : 15}px;line-height:24px;${t?.strong ? 'font-weight:700;' : ''}color:${t?.strong ? st.textColor : T.color.tintaSuave};white-space:nowrap;">${esc(t?.value || '')}</td>` +
            `</tr>`,
        )
        .join('');
      return wrapTd(
        `<td style="${pad(T.espacio.m)}">` +
          (p.title
            ? `<div style="font-family:${font};font-size:${T.texto.h2.size}px;line-height:${T.texto.h2.line}px;font-weight:700;color:${st.textColor};padding-bottom:6px;">${esc(p.title)}</div>`
            : '') +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas}${sumas}</table>` +
          (p.note
            ? `<div style="font-family:${font};font-size:${T.texto.small.size}px;line-height:${T.texto.small.line}px;color:${T.color.tintaSuave};padding-top:12px;">${esc(p.note)}</div>`
            : '') +
          `</td>`,
      );
    }
    case 'quote': {
      const barra = p.accent || acento;
      return wrapTd(
        `<td style="${pad(T.espacio.s)}">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.background || T.color.acentoSuave}" style="border-radius:${T.radio}px;">` +
          `<tr>` +
          `<td width="4" bgcolor="${barra}" style="width:4px;font-size:0;line-height:0;border-radius:${T.radio}px 0 0 ${T.radio}px;">&nbsp;</td>` +
          `<td style="padding:18px 22px;">` +
          (Number(p.stars) > 0 ? `<div style="padding-bottom:8px;">${starsHtml(p.stars, '#f59e0b', 16)}</div>` : '') +
          `<div style="font-family:${font};font-size:${T.texto.body.size}px;line-height:${T.texto.body.line}px;color:${st.textColor};font-style:italic;">«${esc(p.text || '')}»</div>` +
          `<div style="font-family:${font};font-size:${T.texto.small.size}px;line-height:${T.texto.small.line}px;color:${T.color.tintaSuave};padding-top:10px;">${esc(p.author || '')}${p.role ? ` · ${esc(p.role)}` : ''}</div>` +
          `</td></tr></table></td>`,
      );
    }
    case 'rating': {
      const align = p.align || 'center';
      return wrapTd(
        `<td align="${align}" style="${pad(T.espacio.s)}text-align:${align};">` +
          starsHtml(p.stars, p.color || '#f59e0b', Number(p.size) || 22) +
          (p.label
            ? `<div style="font-family:${font};font-size:${T.texto.small.size}px;line-height:${T.texto.small.line}px;color:${T.color.tintaSuave};padding-top:6px;">${esc(p.label)}</div>`
            : '') +
          `</td>`,
      );
    }
    case 'coupon': {
      const borde = p.borderColor || acento;
      const color = p.color || acento;
      return wrapTd(
        `<td align="center" style="${pad(T.espacio.m, 4)}">` +
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" bgcolor="${p.background || T.color.acentoSuave}" style="border-radius:${T.radio}px;">` +
          `<tr><td align="center" style="padding:16px 30px;border:2px dashed ${borde};border-radius:${T.radio}px;">` +
          (p.label
            ? `<div style="font-family:${font};font-size:${T.texto.small.size}px;line-height:${T.texto.small.line}px;color:${T.color.tintaSuave};padding-bottom:6px;">${esc(p.label)}</div>`
            : '') +
          `<div style="font-family:${font};font-size:24px;line-height:30px;font-weight:700;letter-spacing:3px;color:${color};">${esc(p.code || '')}</div>` +
          (p.note
            ? `<div style="font-family:${font};font-size:${T.texto.small.size}px;line-height:${T.texto.small.line}px;color:${T.color.tintaSuave};padding-top:8px;">${esc(p.note)}</div>`
            : '') +
          `</td></tr></table></td>`,
      );
    }
    case 'divider': {
      const t = Number(p.thickness) || 1;
      const pv = Number(p.paddingV) || 12;
      return wrapTd(
        `<td style="padding:${pv}px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:${t}px solid ${p.color || T.color.borde};font-size:0;line-height:0;">&nbsp;</td></tr></table></td>`,
      );
    }
    case 'spacer': {
      const h = Number(p.height) || T.espacio.m;
      return wrapTd(`<td height="${h}" style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td>`);
    }
    case 'social': {
      const size = Number(p.size) || 34;
      const items = (Array.isArray(p.networks) ? p.networks : [])
        .filter((n: any) => n && typeof n.url === 'string' && n.url.trim())
        .map((n: any) => {
          const meta = SOCIAL_NETWORKS[n.kind as SocialNetworkKind] ?? SOCIAL_NETWORKS.web;
          return `<td style="padding:0 5px;"><a href="${escAttr(n.url)}" target="_blank" title="${escAttr(meta.label)}" style="display:inline-block;width:${size}px;height:${size}px;background-color:${meta.color};border-radius:50%;font-family:Arial,Helvetica,sans-serif;font-size:${Math.round(size * 0.38)}px;font-weight:bold;color:#ffffff;text-align:center;line-height:${size}px;text-decoration:none;">${esc(meta.abbr)}</a></td>`;
        })
        .join('');
      if (!items) return '';
      return wrapTd(
        `<td align="${p.align || 'center'}" style="${pad(T.espacio.s)}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${p.align || 'center'}"><tr>${items}</tr></table></td>`,
      );
    }
    case 'footer': {
      const fs = Number(p.fontSize) || T.texto.small.size;
      const color = p.color || T.color.tintaSuave;
      const baja = String(p.unsubscribeUrl || '').trim()
        ? `<div style="padding-top:8px;"><a href="${escAttr(p.unsubscribeUrl)}" target="_blank" style="color:${color};text-decoration:underline;">${esc(p.unsubscribeLabel || 'Darme de baja')}</a></div>`
        : '';
      const dir = p.address
        ? `<div style="padding-top:8px;">${esc(p.address)}</div>`
        : '';
      return wrapTd(
        `<td style="padding:${T.espacio.m}px 0 8px 0;font-family:${font};font-size:${fs}px;line-height:${Math.round(fs * 1.6)}px;color:${color};text-align:center;">${p.html || ''}${dir}${baja}</td>`,
      );
    }
    case 'html':
      return p.html ? wrapTd(`<td>${p.html}</td>`) : '';
    default:
      return '';
  }
}

function renderRow(row: EmailRow, st: EmailDocSettings): string {
  const rp = row.props ?? defaultRowProps();
  const multi = row.columns.length > 1;
  const cols = row.columns
    .map((c, i) => {
      const inner = c.blocks.map((b) => renderBlock(b, st)).filter(Boolean).join('\n');
      // Canalón entre columnas SOLO por dentro: así el contenido de las
      // columnas de los extremos sigue alineado con el de las filas de una
      // sola columna, que es lo que delata una maqueta descuidada.
      const gut = !multi
        ? '0'
        : i === 0
          ? '0 8px 0 0'
          : i === row.columns.length - 1
            ? '0 0 0 8px'
            : '0 8px';
      return `<td class="cf-col" width="${c.widthPct}%" valign="top" style="width:${c.widthPct}%;vertical-align:top;padding:${gut};">${inner || '&nbsp;'}</td>`;
    })
    .join('');
  const bg = rp.background ? ` bgcolor="${rp.background}"` : '';
  return `<tr><td class="cf-pad"${bg} style="${rp.background ? `background-color:${rp.background};` : ''}padding:${rp.paddingV}px ${rp.paddingH}px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cols}</tr></table>
</td></tr>`;
}

/** Genera el documento HTML completo, listo para enviarse por correo. */
export function renderEmailHtml(doc: EmailDoc, opts?: { title?: string }): string {
  const st = doc.settings;
  const width = Number(st.contentWidth) || 600;
  const rowsHtml = doc.rows.map((r) => renderRow(r, st)).join('\n');
  const pre = String(st.preheader || '').trim();
  // El preheader va oculto y seguido de espacios invisibles: sin el relleno,
  // algunos clientes cuelan detrás las primeras palabras del cuerpo.
  const preheader = pre
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${st.backgroundColor};opacity:0;">${esc(pre)}${'&#8199;&#65279;&#847; '.repeat(30)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${esc(opts?.title || 'Correo')}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  /* Mejora progresiva: los clientes que ignoran <style> (Outlook escritorio)
     ven la versión de escritorio, que funciona igual porque todo va inline. */
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media only screen and (max-width: ${width + 20}px) {
    .cf-container { width: 100% !important; }
    /* Apilar columnas: el <td> pasa a bloque al 100% y pierde el canalón. */
    .cf-col { display: block !important; width: 100% !important; padding: 0 !important; }
    .cf-pad { padding-left: 20px !important; padding-right: 20px !important; }
    /* Botón a lo ancho: se toca con el pulgar sin apuntar. */
    .cf-btn-wrap { width: 100% !important; }
    .cf-btn { display: block !important; text-align: center !important; }
    .cf-stack { display: block !important; width: 100% !important; padding: 0 0 10px 0 !important; }
    .cf-h1 { font-size: 26px !important; line-height: 34px !important; }
    .cf-h2 { font-size: 20px !important; line-height: 28px !important; }
  }
  /* Dark mode: solo se retocan los fondos y el texto principal. El resto de
     colores son de marca y deben sobrevivir a la inversión tal cual. */
  @media (prefers-color-scheme: dark) {
    .cf-body, .cf-body-bg { background-color: #0b1220 !important; }
    .cf-card { background-color: #131c2e !important; }
    .cf-ink { color: #e5e7eb !important; }
  }
</style>
</head>
<body class="cf-body" style="margin:0;padding:0;background-color:${st.backgroundColor};">
${preheader}
<center class="cf-body-bg" style="width:100%;background-color:${st.backgroundColor};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${st.backgroundColor};">
<tr><td align="center" style="padding:32px 10px;">
<table role="presentation" class="cf-container cf-card" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:100%;background-color:${st.contentBackground};border-radius:12px;">
${rowsHtml}
</table>
</td></tr>
</table>
</center>
</body>
</html>`;
}

// ── Fallback de texto plano ─────────────────────────────────────────────────
// Se manda como parte `text` del correo: es lo que leen los clientes sin HTML
// y lo que muchos filtros antispam puntúan mejor que un correo solo-HTML.

function stripHtml(s: string): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function blockToText(b: EmailBlock): string {
  const p = b.props ?? {};
  const link = (label: string, href: string) =>
    href ? `${label}: ${href}` : label;
  switch (b.type) {
    case 'heading':
      return [p.kicker, p.title, p.subtitle].filter(Boolean).map(String).join('\n');
    case 'text':
      return stripHtml(p.html);
    case 'image':
      return p.alt ? `[${p.alt}]` : '';
    case 'logo':
      return '';
    case 'button':
      return link(String(p.label || ''), String(p.href || ''));
    case 'buttons':
      return [link(String(p.label || ''), String(p.href || '')), link(String(p.label2 || ''), String(p.href2 || ''))]
        .filter(Boolean)
        .join('\n');
    case 'feature':
      return [p.title, p.text].filter(Boolean).map(String).join('\n');
    case 'product':
      return [p.title, p.description, p.price, link(String(p.label || ''), String(p.href || ''))]
        .filter(Boolean)
        .map(String)
        .join('\n');
    case 'order': {
      const items = (Array.isArray(p.items) ? p.items : []).map(
        (i: any) => `- ${i?.name ?? ''}${i?.qty ? ` x${i.qty}` : ''}${i?.price ? `  ${i.price}` : ''}`,
      );
      const tot = (Array.isArray(p.totals) ? p.totals : []).map(
        (t: any) => `${t?.label ?? ''}: ${t?.value ?? ''}`,
      );
      return [p.title, ...items, ...tot, p.note].filter(Boolean).map(String).join('\n');
    }
    case 'quote':
      return `«${p.text ?? ''}» — ${p.author ?? ''}`;
    case 'rating':
      return `${'★'.repeat(Math.max(0, Math.min(5, Number(p.stars) || 0)))}${p.label ? ` ${p.label}` : ''}`;
    case 'coupon':
      return [p.label, p.code, p.note].filter(Boolean).map(String).join('\n');
    case 'divider':
      return '—';
    case 'social':
      return (Array.isArray(p.networks) ? p.networks : [])
        .filter((n: any) => n?.url)
        .map((n: any) => `${SOCIAL_NETWORKS[n.kind as SocialNetworkKind]?.label ?? 'Web'}: ${n.url}`)
        .join('\n');
    case 'footer':
      return [stripHtml(p.html), p.address, p.unsubscribeUrl].filter(Boolean).map(String).join('\n');
    case 'html':
      return stripHtml(p.html);
    default:
      return '';
  }
}

/** Versión en texto plano del documento (parte `text` del correo). */
export function renderEmailText(doc: EmailDoc): string {
  const partes: string[] = [];
  const pre = String(doc.settings.preheader || '').trim();
  if (pre) partes.push(pre);
  for (const row of doc.rows) {
    for (const col of row.columns) {
      for (const b of col.blocks) {
        const t = blockToText(b).trim();
        if (t) partes.push(t);
      }
    }
  }
  return partes.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Plantillas de arranque (locales) ────────────────────────────────────────
// Puntos de partida que funcionan aunque el backend aún no tenga plantillas
// de fábrica (isPreset). Se materializan como POST normal con estos blocks.
export const STARTERS: { key: string; name: string; description: string; build: () => EmailDoc }[] = [
  {
    key: 'basica',
    name: 'Básica',
    description: 'Logotipo, un texto y un botón. Para anuncios cortos.',
    build: () => {
      const d = emptyDoc();
      d.settings.preheader = 'Un anuncio corto que te interesa.';
      d.rows = [
        newRow([100], [[newBlock('logo')]], { paddingV: 24 }),
        newRow(
          [100],
          [
            [
              newBlock('heading', {
                title: 'Un titular claro',
                subtitle: 'Cuéntale a tus contactos qué hay de nuevo en una línea.',
                align: 'center',
                level: 'h1',
              }),
              newBlock('text', {
                html: 'Un párrafo corto y directo funciona mejor que tres largos.',
                align: 'center',
              }),
              newBlock('button', { label: 'Quiero saber más' }),
            ],
          ],
        ),
        newRow([100], [[newBlock('divider'), newBlock('footer')]]),
      ];
      return d;
    },
  },
  {
    key: 'boletin',
    name: 'Boletín',
    description: 'Dos columnas con imagen y texto. Para novedades del mes.',
    build: () => {
      const d = emptyDoc();
      d.settings.preheader = 'Las novedades del mes, en dos minutos.';
      d.rows = [
        newRow([100], [[newBlock('logo')]], { paddingV: 24 }),
        newRow([100], [[newBlock('heading', { kicker: 'Boletín', title: 'Las novedades del mes', align: 'center', level: 'h1' })]]),
        newRow(
          [50, 50],
          [
            [newBlock('image'), newBlock('heading', { title: 'Primera novedad' }), newBlock('text', { html: 'Describe brevemente de qué se trata.' })],
            [newBlock('image'), newBlock('heading', { title: 'Segunda novedad' }), newBlock('text', { html: 'Describe brevemente de qué se trata.' })],
          ],
        ),
        newRow([100], [[newBlock('button', { label: 'Ver todas las novedades' }), newBlock('divider'), newBlock('social'), newBlock('footer')]]),
      ];
      return d;
    },
  },
  {
    key: 'promocion',
    name: 'Promoción',
    description: 'Banda de color, oferta, cupón y botón destacado.',
    build: () => {
      const d = emptyDoc();
      d.settings.preheader = 'Una oferta por tiempo limitado.';
      d.rows = [
        newRow(
          [100],
          [
            [
              newBlock('heading', {
                kicker: 'Por tiempo limitado',
                title: 'Una oferta difícil de ignorar',
                align: 'center',
                level: 'h1',
                color: '#ffffff',
                kickerColor: '#ffffff',
              }),
            ],
          ],
          { background: EMAIL_TOKENS.color.acento, paddingV: 34 },
        ),
        newRow(
          [100],
          [
            [
              newBlock('image'),
              newBlock('text', { html: 'Explica la promoción en una o dos frases: qué gana el cliente y hasta cuándo.', align: 'center' }),
              newBlock('coupon', { code: 'BIENVENIDO', label: 'Usa este código al pagar' }),
              newBlock('button', { label: 'Aprovechar ahora' }),
            ],
          ],
          { paddingV: 24 },
        ),
        newRow([100], [[newBlock('divider'), newBlock('social'), newBlock('footer')]]),
      ];
      return d;
    },
  },
];
