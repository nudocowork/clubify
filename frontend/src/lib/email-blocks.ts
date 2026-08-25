// Tipos, fábricas y render a HTML de CORREO de las plantillas del Email
// Marketing de la marca. Vive separado del editor por dos razones: se puede
// probar sin montar React, y las reglas duras del dominio quedan en un solo
// lugar. Las reglas:
//
// 1. El HTML final va en TABLAS con estilos EN LÍNEA y ancho máximo ~600px.
//    Los clientes de correo (Outlook, Gmail, etc.) no soportan flexbox, grid
//    ni hojas de estilo externas. El único <style> embebido es una media query
//    para apilar columnas en móvil — mejora progresiva: quien la ignora
//    (Outlook escritorio) ve la versión de escritorio, que funciona igual.
// 2. NUNCA un data:image dentro del documento. Las imágenes se suben a S3 y
//    en los bloques viaja solo la URL. El backend rechaza con 400 cualquier
//    guardado que contenga data:image (la tabla QrPoster llegó a pesar el 77%
//    de la base por incrustar imágenes en base64 — ese error no se repite).

export type EmailBlockType =
  | 'text'
  | 'image'
  | 'button'
  | 'logo'
  | 'divider'
  | 'social'
  | 'footer'
  | 'spacer'
  | 'html';

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
export type EmailRow = { id: string; columns: EmailColumn[] };
export type EmailDocSettings = {
  backgroundColor: string;
  contentBackground: string;
  contentWidth: number;
  fontFamily: string;
  textColor: string;
  linkColor: string;
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
  text: { label: 'Texto', icon: '📝' },
  image: { label: 'Imagen', icon: '🖼️' },
  button: { label: 'Botón', icon: '🔘' },
  logo: { label: 'Logotipo', icon: '🏷️' },
  divider: { label: 'Divisor', icon: '➖' },
  social: { label: 'Redes sociales', icon: '🌐' },
  footer: { label: 'Pie de página', icon: '📄' },
  spacer: { label: 'Espaciador', icon: '↕️' },
  html: { label: 'Código HTML', icon: '＜＞' },
};

// Orden del panel de Elementos (espejo del editor de GHL que usa el dueño).
export const ELEMENT_ORDER: EmailBlockType[] = [
  'text',
  'image',
  'button',
  'logo',
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
    backgroundColor: '#f1f5f9',
    contentBackground: '#ffffff',
    contentWidth: 600,
    fontFamily: 'Arial, Helvetica, sans-serif',
    textColor: '#334155',
    linkColor: '#16a34a',
  };
}

export function emptyDoc(): EmailDoc {
  return { version: 1, settings: defaultSettings(), rows: [] };
}

/** Crea un bloque con valores por defecto sensatos (en español). */
export function newBlock(type: EmailBlockType, overrides?: Record<string, any>): EmailBlock {
  const defaults: Record<EmailBlockType, Record<string, any>> = {
    text: { html: 'Escribe aquí tu texto…', align: 'left', fontSize: 15, color: '' },
    image: { url: '', alt: '', width: null, align: 'center', href: '', radius: 0 },
    logo: { url: '', alt: 'Logotipo', width: 140, align: 'center', href: '' },
    button: {
      label: 'Ver más',
      href: '',
      background: '',
      color: '#ffffff',
      fontSize: 15,
      radius: 8,
      align: 'center',
      paddingV: 12,
      paddingH: 28,
    },
    divider: { color: '#e2e8f0', thickness: 1, paddingV: 12 },
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
      color: '#94a3b8',
      fontSize: 12,
    },
    spacer: { height: 24 },
    html: { html: '' },
  };
  return { id: uid(), type, props: { ...defaults[type], ...(overrides ?? {}) } };
}

export function newRow(widths: number[], blocksPerCol?: EmailBlock[][]): EmailRow {
  return {
    id: uid(),
    columns: widths.map((w, i) => ({ id: uid(), widthPct: w, blocks: blocksPerCol?.[i] ?? [] })),
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
      rows.push({ id: typeof r.id === 'string' ? r.id : uid(), columns });
    }
  }
  return { version: 1, settings, rows };
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
  return String(s)
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

function renderBlock(b: EmailBlock, st: EmailDocSettings): string {
  const p = b.props ?? {};
  switch (b.type) {
    case 'text': {
      const color = p.color || st.textColor;
      const size = Number(p.fontSize) || 15;
      return wrapTd(
        `<td style="padding:10px 14px;font-family:${st.fontFamily};font-size:${size}px;line-height:1.55;color:${color};text-align:${p.align || 'left'};">${p.html || ''}</td>`,
      );
    }
    case 'image':
    case 'logo': {
      const url = String(p.url || '').trim();
      // Sin URL no hay nada que mandar; un data: jamás entra al documento.
      if (!url || /^data:/i.test(url)) return '';
      const w = p.width ? Number(p.width) : null;
      const radius = Number(p.radius) || 0;
      const img = `<img src="${escAttr(url)}" alt="${escAttr(p.alt || '')}"${w ? ` width="${w}"` : ''} style="display:block;${w ? `width:${w}px;` : 'width:100%;'}max-width:100%;height:auto;border:0;${radius ? `border-radius:${radius}px;` : ''}" />`;
      const linked = p.href
        ? `<a href="${escAttr(p.href)}" target="_blank">${img}</a>`
        : img;
      return wrapTd(`<td align="${p.align || 'center'}" style="padding:10px 14px;">${linked}</td>`);
    }
    case 'button': {
      const bg = p.background || st.linkColor;
      const r = Number(p.radius) || 0;
      const pv = Number(p.paddingV) || 12;
      const ph = Number(p.paddingH) || 28;
      const fs = Number(p.fontSize) || 15;
      // Botón "a prueba de balas": tabla + td con bgcolor + <a> inline-block.
      // Es el único patrón que pinta bien en Outlook y en móvil a la vez.
      return wrapTd(
        `<td align="${p.align || 'center'}" style="padding:10px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${bg}" style="border-radius:${r}px;"><a href="${escAttr(p.href || '#')}" target="_blank" style="display:inline-block;padding:${pv}px ${ph}px;font-family:${st.fontFamily};font-size:${fs}px;font-weight:bold;color:${p.color || '#ffffff'};text-decoration:none;border-radius:${r}px;">${esc(p.label || 'Botón')}</a></td></tr></table></td>`,
      );
    }
    case 'divider': {
      const t = Number(p.thickness) || 1;
      const pv = Number(p.paddingV) || 12;
      return wrapTd(
        `<td style="padding:${pv}px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:${t}px solid ${p.color || '#e2e8f0'};font-size:0;line-height:0;">&nbsp;</td></tr></table></td>`,
      );
    }
    case 'spacer': {
      const h = Number(p.height) || 24;
      return wrapTd(`<td height="${h}" style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td>`);
    }
    case 'social': {
      const size = Number(p.size) || 34;
      const items = (Array.isArray(p.networks) ? p.networks : [])
        .filter((n: any) => n && typeof n.url === 'string' && n.url.trim())
        .map((n: any) => {
          const meta = SOCIAL_NETWORKS[n.kind as SocialNetworkKind] ?? SOCIAL_NETWORKS.web;
          return `<td style="padding:0 5px;"><a href="${escAttr(n.url)}" target="_blank" style="display:inline-block;width:${size}px;height:${size}px;background-color:${meta.color};border-radius:50%;font-family:Arial,Helvetica,sans-serif;font-size:${Math.round(size * 0.38)}px;font-weight:bold;color:#ffffff;text-align:center;line-height:${size}px;text-decoration:none;">${esc(meta.abbr)}</a></td>`;
        })
        .join('');
      if (!items) return '';
      return wrapTd(
        `<td align="${p.align || 'center'}" style="padding:10px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${items}</tr></table></td>`,
      );
    }
    case 'footer': {
      const fs = Number(p.fontSize) || 12;
      return wrapTd(
        `<td style="padding:16px 14px;font-family:${st.fontFamily};font-size:${fs}px;line-height:1.6;color:${p.color || '#94a3b8'};text-align:center;">${p.html || ''}</td>`,
      );
    }
    case 'html':
      return p.html ? wrapTd(`<td>${p.html}</td>`) : '';
    default:
      return '';
  }
}

function renderRow(row: EmailRow, st: EmailDocSettings): string {
  const cols = row.columns
    .map((c) => {
      const inner = c.blocks.map((b) => renderBlock(b, st)).filter(Boolean).join('\n');
      return `<td class="cf-col" width="${c.widthPct}%" valign="top" style="width:${c.widthPct}%;vertical-align:top;">${inner || '&nbsp;'}</td>`;
    })
    .join('');
  return `<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cols}</tr></table></td></tr>`;
}

/** Genera el documento HTML completo, listo para enviarse por correo. */
export function renderEmailHtml(doc: EmailDoc, opts?: { title?: string }): string {
  const st = doc.settings;
  const width = Number(st.contentWidth) || 600;
  const rowsHtml = doc.rows.map((r) => renderRow(r, st)).join('\n');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts?.title || 'Correo')}</title>
<style>
  /* Mejora progresiva: los clientes que ignoran <style> (Outlook escritorio)
     ven la versión de escritorio, que funciona igual porque todo va inline. */
  @media only screen and (max-width: ${width + 20}px) {
    .cf-container { width: 100% !important; }
    .cf-col { display: block !important; width: 100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${st.backgroundColor};">
<center>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${st.backgroundColor};">
<tr><td align="center" style="padding:24px 8px;">
<table role="presentation" class="cf-container" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:100%;background-color:${st.contentBackground};">
${rowsHtml}
</table>
</td></tr>
</table>
</center>
</body>
</html>`;
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
      d.rows = [
        newRow([100], [[newBlock('logo')]]),
        newRow(
          [100],
          [
            [
              newBlock('text', {
                html: '<b>Un titular claro</b>',
                align: 'center',
                fontSize: 22,
              }),
              newBlock('text', {
                html: 'Cuéntale a tus contactos qué hay de nuevo. Un párrafo corto y directo funciona mejor que tres largos.',
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
      d.rows = [
        newRow([100], [[newBlock('logo'), newBlock('text', { html: '<b>Las novedades del mes</b>', align: 'center', fontSize: 22 }), newBlock('divider')]]),
        newRow(
          [50, 50],
          [
            [newBlock('image'), newBlock('text', { html: '<b>Primera novedad</b><br>Describe brevemente de qué se trata.' })],
            [newBlock('image'), newBlock('text', { html: '<b>Segunda novedad</b><br>Describe brevemente de qué se trata.' })],
          ],
        ),
        newRow([100], [[newBlock('spacer', { height: 16 }), newBlock('button', { label: 'Ver todas las novedades' }), newBlock('footer')]]),
      ];
      return d;
    },
  },
  {
    key: 'promocion',
    name: 'Promoción',
    description: 'Imagen grande, oferta y botón destacado. Para campañas.',
    build: () => {
      const d = emptyDoc();
      d.rows = [
        newRow(
          [100],
          [
            [
              newBlock('image'),
              newBlock('spacer', { height: 12 }),
              newBlock('text', { html: '<b>Una oferta difícil de ignorar</b>', align: 'center', fontSize: 24 }),
              newBlock('text', { html: 'Explica la promoción en una o dos frases: qué gana el cliente y hasta cuándo.', align: 'center' }),
              newBlock('button', { label: 'Aprovechar ahora', fontSize: 17, paddingV: 14, paddingH: 36 }),
              newBlock('spacer', { height: 12 }),
              newBlock('social'),
              newBlock('footer'),
            ],
          ],
        ),
      ];
      return d;
    },
  },
];
