/**
 * Maquetador ÚNICO de los correos que firma una marca (o un negocio).
 *
 * Existe porque cada plantilla armaba su HTML a mano sobre un marco mínimo, y
 * así llegaban los correos de Sellea (arqueo del 2026-09-15):
 *  - La cabecera y el botón salían del NEGOCIO, no de la marca. Los negocios
 *    que nunca tocaron su color tienen el `#22C55E` por defecto — el verde de
 *    Clubify —, así que un aviso de Sellea llegaba con el botón verde y la
 *    inicial del negocio en un cuadro verde.
 *  - Los recuadros de «Pago confirmado» eran texto blanco sobre un degradado:
 *    Outlook de escritorio no pinta degradados y el texto quedaba invisible.
 *  - El texto plano que viaja junto al HTML (y el historial de envíos) llevaba
 *    los `**` del Markdown sin convertir.
 *
 * Reglas de este archivo:
 *  - Quien llama pasa TEXTO, nunca HTML. Todo se escapa aquí; el cuerpo admite
 *    `**negrita**`, listas «1.» / «-» y enlaces sueltos, nada más.
 *  - Sin identidad resuelta no se pinta ningún nombre, logo ni «Enviado por», y
 *    los colores son neutros. Nunca un color o un nombre por defecto de otra
 *    marca: un pie ausente no delata a nadie, uno inventado sí.
 *  - Solo tablas y estilos en línea (Outlook usa el motor de Word), 600 px de
 *    ancho, sin fuentes web (no cargan en Gmail ni Outlook, y Outlook cae a
 *    Times) y sin imágenes que no sean de la marca.
 *  - Modo oscuro: el logo va sobre una «ficha» blanca que sobrevive a la
 *    inversión de colores; si no, un logo oscuro sobre fondo oscuro desaparece.
 */

// ─────────── Tipos ───────────

export type IdentidadDeCorreo = {
  /** Nombre visible. Vacío = identidad no resuelta: no se pinta nada. */
  nombre: string;
  /** Logo horizontal (lockup ~3:1). Va solo, sin el nombre al lado. */
  logoUrl?: string | null;
  /** Ícono cuadrado. Se usa cuando no hay logo horizontal, junto al nombre. */
  iconoUrl?: string | null;
  /** Color principal: barra superior, botón y acentos. */
  color?: string | null;
  /** Color de tinta para títulos. Solo se usa si contrasta de verdad. */
  colorTinta?: string | null;
  /** Sitio de la marca, para el pie. */
  sitioUrl?: string | null;
  /** Correo de contacto, para el pie. */
  correoContacto?: string | null;
};

export type DatoDelCorreo = {
  etiqueta: string;
  valor: string;
  /** Contraseñas y códigos: letra de ancho fijo para no confundir 0/O, l/1. */
  monoespaciado?: boolean;
  /** Fila de cierre (un total). */
  fuerte?: boolean;
};

export type BloqueDelCorreo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'datos'; filas: DatoDelCorreo[] }
  | { tipo: 'destacado'; titulo: string; texto?: string | null }
  | { tipo: 'codigo'; etiqueta: string; valor: string }
  | { tipo: 'nota'; texto: string };

/** Todo lo del correo MENOS la identidad: así el transporte, que es quien
 *  conoce la marca, puede ponerle el marco (ver `BrandEmailService.sendRaw`). */
export type ContenidoDelCorreo = {
  preheader: string;
  antetitulo?: string | null;
  titulo?: string | null;
  bloques: BloqueDelCorreo[];
  boton?: { texto: string; url: string } | null;
  /** Repite la URL del botón en texto: para enlaces que no se pueden perder
   *  (restablecer contraseña, activar cuenta) cuando el botón no abre. */
  enlaceVisible?: boolean;
  /** Bloques que van DESPUÉS del botón (primeros pasos, notas). */
  bloquesFinales?: BloqueDelCorreo[];
  /** Por qué le llega. `{marca}` se cambia por el nombre de la identidad; sin
   *  identidad la línea no se pinta. */
  motivo?: string | null;
  /** «Hecho con X» cuando quien firma es un negocio alojado en la marca X. */
  credito?: string | null;
};

export type CorreoParaMaquetar = ContenidoDelCorreo & {
  identidad: IdentidadDeCorreo | null;
};

/** Forma mínima de una fila de `WhiteLabel` para firmar un correo. */
export type MarcaParaCorreo = {
  name?: string | null;
  logoUrl?: string | null;
  iconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  contactEmail?: string | null;
  domain?: string | null;
  appDomain?: string | null;
};

// ─────────── Paleta ───────────

const FUENTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

/** Neutros del marco. `suave` da 5:1 sobre el fondo gris: legible en 12 px. */
const CLARO = {
  fondo: '#F4F4F5',
  tarjeta: '#FFFFFF',
  pie: '#FAFAFA',
  borde: '#E4E4E7',
  tinta: '#18181B',
  texto: '#3F3F46',
  suave: '#66666E',
} as const;

const OSCURO = {
  fondo: '#0B0B0F',
  tarjeta: '#18181B',
  pie: '#131316',
  borde: '#2E2E35',
  tinte: '#232329',
  tinta: '#FAFAFA',
  texto: '#D4D4D8',
  suave: '#A1A1AA',
} as const;

type Tema = {
  primario: string;
  textoBoton: string;
  tinta: string;
  /** Primario oscurecido hasta 4,5:1 sobre el tinte: textos y enlaces. */
  acento: string;
  /** Primario aclarado hasta 4,5:1 sobre la tarjeta oscura. */
  acentoOscuro: string;
  tinte: string;
  bordeTinte: string;
};

// ─────────── Utilidades ───────────

export function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const limpiar = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Solo http(s). Un `javascript:` o un `data:` en un enlace o un logo no pasa:
 *  Gmail bloquea las imágenes `data:` y un enlace así es una inyección. */
export function urlSegura(u: unknown): string | null {
  const v = String(u ?? '').trim();
  return /^https?:\/\/[^\s"'<>`]+$/i.test(v) ? v : null;
}

const RE_CORREO = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** `#RGB` o `#RRGGBB`. Cualquier otra cosa (incluido CSS inyectado) es null. */
export function normalizarColor(c: unknown): string | null {
  const v = String(c ?? '').trim();
  const corto = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (corto) {
    return `#${corto[1]}${corto[1]}${corto[2]}${corto[2]}${corto[3]}${corto[3]}`.toUpperCase();
  }
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
}

function aRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function aHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function luminancia(hex: string): number {
  const [r, g, b] = aRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores `#RRGGBB`. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function mezclar(a: string, b: string, peso: number): string {
  const [r1, g1, b1] = aRgb(a);
  const [r2, g2, b2] = aRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * peso);
  return aHex([m(r1, r2), m(g1, g2), m(b1, b2)]);
}

function ajustarContraste(color: string, fondo: string, minimo: number, hacia: string): string {
  for (let paso = 0; paso <= 20; paso++) {
    const c = paso === 0 ? color : mezclar(color, hacia, paso / 20);
    if (contraste(c, fondo) >= minimo) return c;
  }
  return hacia;
}

function temaDe(id: IdentidadDeCorreo | null): Tema {
  const primario = normalizarColor(id?.color) ?? CLARO.tinta;
  const tintaMarca = normalizarColor(id?.colorTinta);
  const tinta =
    tintaMarca && contraste(tintaMarca, CLARO.tarjeta) >= 7 ? tintaMarca : CLARO.tinta;
  const tinte = mezclar(primario, '#FFFFFF', 0.94);
  // Blanco sobre el color de la marca mientras se lea (3:1, texto grande y en
  // negrita); con colores claros (un amarillo) el texto pasa a oscuro.
  const textoBoton =
    contraste(primario, '#FFFFFF') >= 3
      ? '#FFFFFF'
      : contraste(primario, tinta) >= 4.5
        ? tinta
        : '#000000';
  return {
    primario,
    textoBoton,
    tinta,
    acento: ajustarContraste(primario, tinte, 4.5, '#000000'),
    acentoOscuro: ajustarContraste(primario, OSCURO.tinte, 4.5, '#FFFFFF'),
    tinte,
    bordeTinte: mezclar(primario, '#FFFFFF', 0.84),
  };
}

function identidadResuelta(id: IdentidadDeCorreo | null | undefined): IdentidadDeCorreo | null {
  const nombre = limpiar(id?.nombre);
  return id && nombre ? { ...id, nombre } : null;
}

/** Identidad de una MARCA a partir de su fila de `WhiteLabel`. */
export function identidadDeMarca(
  wl: MarcaParaCorreo | null | undefined,
  nombre?: string | null,
): IdentidadDeCorreo | null {
  const n = limpiar(nombre ?? wl?.name);
  if (!n) return null;
  const host = limpiar(wl?.domain || wl?.appDomain)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return {
    nombre: n,
    logoUrl: wl?.logoUrl ?? null,
    iconoUrl: wl?.iconUrl ?? null,
    color: wl?.primaryColor ?? null,
    colorTinta: wl?.secondaryColor ?? null,
    correoContacto: wl?.contactEmail ?? null,
    sitioUrl: host ? `https://${host}` : null,
  };
}

/** Quita emojis del principio: el asunto «🎉 Tu panel…» sirve de título. */
export function sinEmojiInicial(s: unknown): string {
  return limpiar(s).replace(/^[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u, '');
}

// ─────────── Texto → HTML ───────────

const VACIA = /\*\*\s*\*\*/g; // `**{platform}**` con el token vacío
const NEGRITA = /\*\*(.+?)\*\*/g;
// Solo URLs. Los correos se quedan en texto: el cuerpo nombra sobre todo el
// correo de acceso del propio cliente, y como `mailto:` salía resaltado en
// color sin servir para nada.
const ENLACE = /\bhttps?:\/\/[^\s<>"'`]+/g;

/** El cuerpo tal como lo leería alguien sin HTML: sin `**`. Es lo que viaja
 *  en el texto plano del correo y lo que guarda el historial de envíos. */
export function textoPlano(texto: unknown): string {
  return String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(VACIA, '')
    .replace(NEGRITA, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto de vista previa de la bandeja: el cuerpo en una línea, recortado. */
export function resumenParaVistaPrevia(texto: unknown, max = 140): string {
  const plano = textoPlano(texto)
    .split('\n')
    .map((l) => l.replace(/^(\d{1,2}[.)]|[-•*])\s+/, '').trim())
    .filter(Boolean)
    .join(' ');
  if (plano.length <= max) return plano;
  const corte = plano.slice(0, max);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.—-]+$/, '')}…`;
}

function enlazar(texto: string, t: Tema): string {
  let out = '';
  let ultimo = 0;
  for (const m of texto.matchAll(ENLACE)) {
    const inicio = m.index ?? 0;
    let token = m[0];
    const cola = /[.,;:!?)\]]+$/.exec(token)?.[0] ?? '';
    if (cola) token = token.slice(0, -cola.length);
    const href = urlSegura(token);
    if (!token || !href) continue;
    out += escaparHtml(texto.slice(ultimo, inicio));
    out += `<a class="c-enlace" href="${escaparHtml(href)}" target="_blank" style="color:${t.acento};text-decoration:underline">${escaparHtml(token)}</a>${escaparHtml(cola)}`;
    ultimo = inicio + m[0].length;
  }
  return out + escaparHtml(texto.slice(ultimo));
}

function enLinea(linea: string, t: Tema): string {
  const fuente = linea.replace(VACIA, '');
  let out = '';
  let ultimo = 0;
  for (const m of fuente.matchAll(NEGRITA)) {
    const inicio = m.index ?? 0;
    out += enlazar(fuente.slice(ultimo, inicio), t);
    out += `<strong class="c-titulo" style="font-weight:700;color:${t.tinta}">${enlazar(m[1], t)}</strong>`;
    ultimo = inicio + m[0].length;
  }
  return out + enlazar(fuente.slice(ultimo), t);
}

type TipoDeLinea = 'parrafo' | 'numero' | 'vineta';

function tipoDeLinea(l: string): TipoDeLinea {
  if (/^\d{1,2}[.)]\s+\S/.test(l)) return 'numero';
  if (/^[-•*]\s+\S/.test(l)) return 'vineta';
  return 'parrafo';
}

function parrafo(lineas: string[], t: Tema, extra = ''): string {
  return `<p class="c-texto" style="margin:0;font-family:${FUENTE};font-size:16px;line-height:26px;color:${CLARO.texto};mso-line-height-rule:exactly${extra}">${lineas.map((l) => enLinea(l, t)).join('<br>')}</p>`;
}

function lista(items: string[], numerada: boolean, inicio: number, t: Tema): string {
  const filas = items
    .map((item, i) => {
      const abajo = i === items.length - 1 ? 0 : 12;
      const marca = numerada
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="c-tinte" width="26" height="26" align="center" valign="middle" bgcolor="${t.tinte}" style="width:26px;height:26px;border-radius:13px;background-color:${t.tinte};font-family:${FUENTE};font-size:13px;line-height:26px;font-weight:700;color:${t.acento};text-align:center;mso-line-height-rule:exactly"><span class="c-acento">${inicio + i}</span></td></tr></table>`
        : `<span class="c-acento" style="font-family:${FUENTE};font-size:20px;line-height:24px;font-weight:700;color:${t.acento}">&bull;</span>`;
      return `<tr><td width="${numerada ? 40 : 22}" valign="top" style="padding:0 0 ${abajo}px">${marca}</td><td class="c-texto" valign="top" style="padding:${numerada ? 1 : 0}px 0 ${abajo}px;font-family:${FUENTE};font-size:16px;line-height:24px;color:${CLARO.texto};mso-line-height-rule:exactly">${enLinea(item, t)}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas}</table>`;
}

/** Texto con `**negrita**`, listas y enlaces → piezas de HTML ya escapado. */
function piezasDeTexto(texto: string, t: Tema): string[] {
  const piezas: string[] = [];
  const bloques = String(texto ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const bloque of bloques) {
    const lineas = bloque.split('\n').map((l) => l.trim()).filter(Boolean);
    const tipos = lineas.map(tipoDeLinea);
    // Una sola línea «1. …» suelta no es una lista: es una frase que empieza
    // con un número, y se queda en su párrafo.
    tipos.forEach((tipo, i) => {
      if (tipo === 'numero' && tipos[i - 1] !== 'numero' && tipos[i + 1] !== 'numero') {
        tipos[i] = 'parrafo';
      }
    });
    let i = 0;
    while (i < lineas.length) {
      let j = i;
      while (j < lineas.length && tipos[j] === tipos[i]) j++;
      const tramo = lineas.slice(i, j);
      if (tipos[i] === 'parrafo') {
        piezas.push(parrafo(tramo, t));
      } else {
        const numerada = tipos[i] === 'numero';
        const inicio = numerada ? parseInt(tramo[0], 10) || 1 : 1;
        const items = tramo.map((l) => l.replace(/^(\d{1,2}[.)]|[-•*])\s+/, ''));
        piezas.push(lista(items, numerada, inicio, t));
      }
      i = j;
    }
  }
  return piezas;
}

/** Texto del cuerpo → HTML con el tema de la identidad. Exportado para tests. */
export function textoAHtml(texto: string, identidad: IdentidadDeCorreo | null = null): string {
  return apilar(piezasDeTexto(texto, temaDe(identidadResuelta(identidad))), 16);
}

// ─────────── Piezas del marco ───────────

/** Apila piezas con separación vertical. Filas de tabla y no márgenes: Outlook
 *  ignora el margen de un `<div>`. */
function apilar(piezas: string[], separacion: number): string {
  const vivas = piezas.filter(Boolean);
  if (!vivas.length) return '';
  const filas = vivas
    .map((p, i) => `<tr><td style="padding:0 0 ${i === vivas.length - 1 ? 0 : separacion}px">${p}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas}</table>`;
}

function datosHtml(filas: DatoDelCorreo[], t: Tema): string {
  const vivas = filas
    .map((f) => ({ ...f, etiqueta: limpiar(f.etiqueta), valor: limpiar(f.valor) }))
    .filter((f) => f.etiqueta && f.valor);
  if (!vivas.length) return '';
  const celdas = vivas
    .map((f, i) => {
      const ultima = i === vivas.length - 1;
      const borde = ultima ? '' : `border-bottom:1px solid ${t.bordeTinte};`;
      const linea = ultima ? '' : ' c-linea';
      return `<tr><td class="c-suave c-dato-e${linea}" valign="top" style="padding:12px 16px 12px 0;${borde}font-family:${FUENTE};font-size:14px;line-height:20px;color:${CLARO.suave}">${escaparHtml(f.etiqueta)}</td><td class="c-titulo c-dato-v${linea}" valign="top" align="right" style="padding:12px 0;${borde}font-family:${f.monoespaciado ? MONO : FUENTE};font-size:${f.fuerte ? 16 : 15}px;line-height:20px;font-weight:${f.fuerte ? 800 : 600};color:${t.tinta};text-align:right;word-break:break-word">${escaparHtml(f.valor)}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="c-tinte" bgcolor="${t.tinte}" style="padding:4px 20px;background-color:${t.tinte};border:1px solid ${t.bordeTinte};border-radius:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${celdas}</table></td></tr></table>`;
}

/** Recuadro con acento. El acento va en su propia celda y no como borde: en
 *  modo oscuro la regla de `.c-tinte` pisa el color de los bordes. */
function destacadoHtml(titulo: string, texto: string | null | undefined, t: Tema): string {
  const tit = limpiar(titulo);
  if (!tit) return '';
  const sub = limpiar(texto);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="4" bgcolor="${t.primario}" style="width:4px;background-color:${t.primario};border-radius:12px 0 0 12px;font-size:0;line-height:0">&nbsp;</td><td class="c-tinte" bgcolor="${t.tinte}" style="padding:18px 20px;background-color:${t.tinte};border-radius:0 12px 12px 0"><p class="c-titulo" style="margin:0;font-family:${FUENTE};font-size:18px;line-height:24px;font-weight:800;color:${t.tinta}">${escaparHtml(tit)}</p>${sub ? `<p class="c-texto" style="margin:6px 0 0;font-family:${FUENTE};font-size:14px;line-height:21px;color:${CLARO.texto}">${escaparHtml(sub)}</p>` : ''}</td></tr></table>`;
}

function codigoHtml(etiqueta: string, valor: string, t: Tema): string {
  const v = limpiar(valor);
  if (!v) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="c-tinte" align="center" bgcolor="${t.tinte}" style="padding:18px 20px;background-color:${t.tinte};border:1px dashed ${t.bordeTinte};border-radius:12px;text-align:center"><p class="c-suave" style="margin:0 0 6px;font-family:${FUENTE};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${CLARO.suave}">${escaparHtml(limpiar(etiqueta))}</p><p class="c-titulo" style="margin:0;font-family:${MONO};font-size:28px;line-height:34px;font-weight:700;letter-spacing:3px;color:${t.tinta}">${escaparHtml(v)}</p></td></tr></table>`;
}

function piezasDeBloques(bloques: BloqueDelCorreo[] | undefined, t: Tema): string[] {
  return (bloques ?? []).flatMap((b) => {
    switch (b.tipo) {
      case 'texto':
        return piezasDeTexto(b.texto, t);
      case 'datos':
        return [datosHtml(b.filas, t)];
      case 'destacado':
        return [destacadoHtml(b.titulo, b.texto, t)];
      case 'codigo':
        return [codigoHtml(b.etiqueta, b.valor, t)];
      case 'nota': {
        const lineas = String(b.texto ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
        return lineas.length
          ? [parrafo(lineas, t, `;font-size:14px;line-height:22px;color:${CLARO.suave}`).replace('class="c-texto"', 'class="c-suave"')]
          : [];
      }
      default:
        return [];
    }
  });
}

function cabeceraHtml(id: IdentidadDeCorreo | null, t: Tema): string {
  if (!id) return '';
  const nombre = escaparHtml(id.nombre);
  const logo = urlSegura(id.logoUrl);
  // La «ficha» (c-chip) es blanca también en modo oscuro. En Gmail, que invierte
  // los colores de fondo pero no las imágenes de fondo, lo que la mantiene
  // blanca es el `linear-gradient`.
  const ficha = (contenido: string, radio: number) =>
    `<td class="c-chip" style="background-image:linear-gradient(#FFFFFF,#FFFFFF);border-radius:${radio}px">${contenido}</td>`;
  if (logo) {
    // `width` para Outlook, que ignora el CSS de las imágenes; el resto respeta
    // la proporción dentro de 200×56.
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${ficha(`<img src="${escaparHtml(logo)}" width="148" alt="${nombre}" style="display:block;width:auto;height:auto;max-width:200px;max-height:56px;border:0;outline:none;text-decoration:none;font-family:${FUENTE};font-size:20px;font-weight:800;color:${t.tinta}">`, 10)}</tr></table>`;
  }
  const marca = `<span class="c-titulo" style="font-family:${FUENTE};font-size:20px;line-height:24px;font-weight:800;letter-spacing:-0.3px;color:${t.tinta}">${nombre}</span>`;
  const icono = urlSegura(id.iconoUrl);
  if (!icono) return marca;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${ficha(`<img src="${escaparHtml(icono)}" width="44" height="44" alt="" style="display:block;height:44px;width:auto;max-width:160px;border:0;outline:none;border-radius:10px">`, 12)}<td valign="middle" style="padding:0 0 0 12px">${marca}</td></tr></table>`;
}

function botonHtml(
  boton: ContenidoDelCorreo['boton'],
  enlaceVisible: boolean | undefined,
  t: Tema,
): string {
  const url = urlSegura(boton?.url);
  const texto = limpiar(boton?.texto);
  if (!url || !texto) return '';
  const href = escaparHtml(url);
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="c-boton"><tr><td align="center" bgcolor="${t.primario}" style="border-radius:12px;background-color:${t.primario};mso-padding-alt:15px 30px"><a href="${href}" target="_blank" class="c-boton-a" style="display:inline-block;padding:15px 30px;font-family:${FUENTE};font-size:16px;line-height:20px;font-weight:700;color:${t.textoBoton};text-decoration:none;border-radius:12px;mso-line-height-rule:exactly">${escaparHtml(texto)}</a></td></tr></table>`;
  if (!enlaceVisible) return html;
  return `${html}<p class="c-suave" style="margin:16px 0 0;font-family:${FUENTE};font-size:13px;line-height:20px;color:${CLARO.suave}">¿El botón no abre? Copia y pega este enlace en tu navegador:<br><a class="c-enlace" href="${href}" target="_blank" style="color:${t.acento};text-decoration:underline;word-break:break-all">${escaparHtml(url)}</a></p>`;
}

function hostVisible(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

function firmaHtml(id: IdentidadDeCorreo | null, t: Tema): string {
  if (!id) return '';
  const sitio = urlSegura(id.sitioUrl);
  const correo = limpiar(id.correoContacto);
  const contacto = [
    sitio
      ? `<a class="c-suave" href="${escaparHtml(sitio)}" target="_blank" style="color:${CLARO.suave};text-decoration:none">${escaparHtml(hostVisible(sitio))}</a>`
      : '',
    RE_CORREO.test(correo)
      ? `<a class="c-suave" href="mailto:${escaparHtml(correo)}" style="color:${CLARO.suave};text-decoration:none">${escaparHtml(correo)}</a>`
      : '',
  ]
    .filter(Boolean)
    .join('&nbsp;&nbsp;·&nbsp;&nbsp;');
  return `<tr><td class="c-px c-pie c-linea" bgcolor="${CLARO.pie}" style="padding:22px 40px;background-color:${CLARO.pie};border-top:1px solid ${CLARO.borde};border-radius:0 0 16px 16px"><p class="c-titulo" style="margin:0;font-family:${FUENTE};font-size:15px;line-height:20px;font-weight:700;color:${t.tinta}">${escaparHtml(id.nombre)}</p>${contacto ? `<p class="c-suave" style="margin:4px 0 0;font-family:${FUENTE};font-size:13px;line-height:19px;color:${CLARO.suave}">${contacto}</p>` : ''}</td></tr>`;
}

function preheaderHtml(texto: string): string {
  const p = limpiar(texto);
  if (!p) return '';
  // El relleno invisible evita que la bandeja complete la vista previa con el
  // texto del cuerpo (o con el alt del logo).
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:transparent">${escaparHtml(p)}${'&#8199;&#65279;&#847;'.repeat(40)}</div>`;
}

function estilos(t: Tema): { base: string; outlookCom: string } {
  const oscuras: [string, string, 'fondo' | 'texto'][] = [
    ['.c-fondo', `background-color:${OSCURO.fondo}!important`, 'fondo'],
    ['.c-tarjeta', `background-color:${OSCURO.tarjeta}!important;border-color:${OSCURO.borde}!important`, 'fondo'],
    ['.c-pie', `background-color:${OSCURO.pie}!important`, 'fondo'],
    ['.c-linea', `border-color:${OSCURO.borde}!important`, 'fondo'],
    ['.c-tinte', `background-color:${OSCURO.tinte}!important;border-color:${OSCURO.borde}!important`, 'fondo'],
    ['.c-chip', 'background-color:#FFFFFF!important;padding:8px 12px!important', 'fondo'],
    ['.c-titulo', `color:${OSCURO.tinta}!important`, 'texto'],
    ['.c-texto', `color:${OSCURO.texto}!important`, 'texto'],
    ['.c-suave', `color:${OSCURO.suave}!important`, 'texto'],
    ['.c-acento', `color:${t.acentoOscuro}!important`, 'texto'],
    ['.c-enlace', `color:${t.acentoOscuro}!important`, 'texto'],
    ['.c-boton-a', `color:${t.textoBoton}!important`, 'texto'],
  ];
  const base = [
    ':root{color-scheme:light dark;supported-color-schemes:light dark}',
    'body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}',
    'table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}',
    'img{-ms-interpolation-mode:bicubic}',
    'a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}',
    '@media only screen and (max-width:620px){.c-marco{padding:16px 10px 28px!important}.c-px{padding-left:24px!important;padding-right:24px!important}.c-h1{font-size:24px!important;line-height:31px!important}.c-boton{width:100%!important}.c-boton a{display:block!important}.c-dato-e,.c-dato-v{display:block!important;width:auto!important;text-align:left!important}.c-dato-e{padding:12px 0 2px!important;border-bottom:0!important}.c-dato-v{padding:0 0 12px!important}}',
    `@media (prefers-color-scheme:dark){${oscuras.map(([s, d]) => `${s}{${d}}`).join('')}}`,
  ].join('\n');
  // Outlook.com marca el modo oscuro con atributos. Va en su propio <style>:
  // Gmail descarta el bloque entero si encuentra un selector que no entiende.
  const outlookCom = oscuras
    .map(([s, d, tipo]) => `[data-ogs${tipo === 'fondo' ? 'b' : 'c'}] ${s}{${d}}`)
    .join('\n');
  return { base, outlookCom };
}

// ─────────── Documento ───────────

export function maquetarCorreo(c: CorreoParaMaquetar): string {
  const id = identidadResuelta(c.identidad);
  const t = temaDe(id);
  const fila = (html: string, padding: string) =>
    html ? `<tr><td class="c-px" style="padding:${padding}">${html}</td></tr>` : '';

  const cabecera = cabeceraHtml(id, t);
  const antetitulo = limpiar(c.antetitulo);
  const titulo = limpiar(c.titulo);
  const encabezado =
    (antetitulo
      ? `<p class="c-acento" style="margin:0 0 10px;font-family:${FUENTE};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${t.acento}">${escaparHtml(antetitulo)}</p>`
      : '') +
    (titulo
      ? `<h1 class="c-titulo c-h1" style="margin:0;font-family:${FUENTE};font-size:28px;line-height:36px;font-weight:800;letter-spacing:-0.4px;color:${t.tinta};mso-line-height-rule:exactly">${escaparHtml(titulo)}</h1>`
      : '');

  const filas = [
    `<tr><td height="6" bgcolor="${t.primario}" style="height:6px;line-height:6px;font-size:0;mso-line-height-rule:exactly;background-color:${t.primario};border-radius:16px 16px 0 0">&nbsp;</td></tr>`,
    fila(cabecera, '30px 40px 0'),
    fila(encabezado, `${cabecera ? 28 : 36}px 40px 0`),
    fila(apilar(piezasDeBloques(c.bloques, t), 18), '20px 40px 0'),
    fila(botonHtml(c.boton, c.enlaceVisible, t), '28px 40px 0'),
    fila(apilar(piezasDeBloques(c.bloquesFinales, t), 18), '32px 40px 0'),
    '<tr><td height="40" style="height:40px;line-height:40px;font-size:0">&nbsp;</td></tr>',
    firmaHtml(id, t),
  ].filter(Boolean);

  const motivo = id && c.motivo ? limpiar(c.motivo.replace(/\{marca\}/g, id.nombre)) : '';
  const lineasPie = [motivo, id ? `Enviado por ${id.nombre}` : '', limpiar(c.credito)].filter(Boolean);
  const pie = lineasPie.length
    ? `<tr><td align="center" class="c-px" style="padding:22px 40px 0;font-family:${FUENTE};font-size:12px;line-height:18px;color:${CLARO.suave};text-align:center"><span class="c-suave">${lineasPie.map(escaparHtml).join('<br>')}</span></td></tr>`
    : '';

  const css = estilos(t);
  return `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escaparHtml(titulo || id?.nombre || '')}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if mso]><style>table,td,p,a,h1,span,strong{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
${css.base}
</style>
<style>
${css.outlookCom}
</style>
</head>
<body class="c-fondo" style="margin:0;padding:0;width:100%;background-color:${CLARO.fondo}">
${preheaderHtml(c.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="c-fondo" bgcolor="${CLARO.fondo}" style="background-color:${CLARO.fondo}">
<tr><td align="center" class="c-marco" style="padding:32px 16px 40px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto">
<tr><td class="c-tarjeta" bgcolor="${CLARO.tarjeta}" style="background-color:${CLARO.tarjeta};border:1px solid ${CLARO.borde};border-radius:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${filas.join('\n')}
</table>
</td></tr>
${pie}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
