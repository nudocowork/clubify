/**
 * Estilos de la franja central del pase (laboratorio).
 *
 * Hoy el backend dibuja UNA sola franja (`generateStampsStrip`: rejilla de
 * sellos). Aquí se prueban varias formas de contar el progreso sin tocar
 * producción: cada estilo devuelve un SVG de 640×246, el MISMO lienzo que el
 * backend rasteriza con Sharp a strip.png / @2x / @3x.
 *
 * Por eso este módulo es puro (sin React, sin DOM) y solo usa primitivas que
 * librsvg entiende: rect, circle, path, text, clipPath, linearGradient,
 * stroke-dasharray. Nada de foreignObject ni CSS. Si un estilo se aprueba, se
 * copia al backend casi sin cambios.
 *
 * Lo único que NO viaja tal cual es el ícono: el navegador pinta emoji a color
 * con <text>, librsvg no (sale una silueta negra). Por eso el ícono entra por
 * `dibujarIcono`, y el backend le pasará sus renderers de `stamp-icons.ts`.
 */

export type EstiloFranja =
  | 'SELLOS'
  | 'PRODUCTO'
  | 'FOTO_NUMERO'
  | 'COLOR_SOLIDO'
  | 'PORCIONES'
  | 'TAZA'
  | 'ANILLO'
  | 'CAMINO'
  | 'PERFORADA'
  | 'VIP'
  | 'SALDO';

export type Nivel = { nombre: string; desde: number; beneficio?: string };

/**
 * Letra de la franja. En el panel la pone el navegador; en el pase la pone
 * librsvg, que solo conoce las fuentes INSTALADAS en el servidor: si un estilo
 * pasa a producción, hay que instalar Poppins, Fraunces y Bebas Neue allá.
 */
export type Letra = 'MODERNA' | 'ELEGANTE' | 'IMPACTO';
export type Recipiente = 'TAZA' | 'VASO';
export type Porcion = 'PIZZA' | 'TORTA' | 'LISA';

/**
 * Un sello colocado a mano en «Tu producto». Coordenadas del lienzo 640×246:
 * (x, y) es el CENTRO, `tam` el lado en px, `giro` en grados. `imagen` deja
 * poner una foto distinta en ese sello (p. ej. un regalo en el último).
 */
export type PosSello = { x: number; y: number; tam: number; giro: number; imagen?: string | null };
/** Cómo se ven los sellos que el cliente aún no tiene. */
export type Faltantes = 'TRANSPARENTES' | 'CONTORNO' | 'OCULTOS';
export type Acomodo = 'FILA' | 'CUADRICULA' | 'ENCIMADO' | 'ARCO';
export type PremioIntermedio = { pos: number; texto: string };

export type ConfigFranja = {
  estilo: EstiloFranja;
  /** Color de la tarjeta (fondo del pase). */
  fondo: string;
  /** Texto sobre la franja. */
  texto: string;
  /** Sello lleno / relleno del progreso. */
  sello: string;
  /** Fondo de la franja. */
  area: string;
  requeridos: number;
  sellados: number;
  premio: string;
  /** «visitas», «sellos», «cafés»… va en mayúsculas pequeñas. */
  unidad: string;
  emoji: string;
  /** Ícono propio (data URL o https). Si está, manda sobre el emoji. */
  iconoImagen?: string | null;
  /** Foto de portada: fondo de FOTO_NUMERO y, si se pide, detrás de los sellos. */
  portada?: string | null;
  portadaDetrasDeSellos?: boolean;
  /** Número dentro de los sellos vacíos (1, 2, 3…): se lee cuánto falta. */
  numerarVacios?: boolean;
  premiosIntermedios?: PremioIntermedio[];
  /** Solo «Tu producto»: dónde va cada sello. Si faltan, se completan con `acomodo`. */
  posiciones?: PosSello[];
  acomodo?: Acomodo;
  faltantes?: Faltantes;
  /** Todos menos Sellos y Tu producto, que no llevan texto grande. */
  letra?: Letra;
  recipiente?: Recipiente;
  porcion?: Porcion;
  niveles?: Nivel[];
  /** Gastado acumulado, para VIP. */
  gastado?: number;
  saldo?: number;
  porcentaje?: number;
  moneda?: string;
};

export type DibujarIcono = (cx: number, cy: number, tam: number, id: string) => string;

export const ANCHO = 640;
export const ALTO = 246;

export const ESTILOS: Array<{ id: EstiloFranja; nombre: string; ayuda: string; nuevo?: boolean }> = [
  { id: 'SELLOS', nombre: 'Sellos', ayuda: 'La rejilla clásica, un ícono por visita.' },
  { id: 'PRODUCTO', nombre: 'Tu producto', ayuda: 'Tu propia foto del producto en cada sello.' },
  { id: 'FOTO_NUMERO', nombre: 'Foto + número', ayuda: 'Tu foto de fondo y el número en grande.' },
  { id: 'COLOR_SOLIDO', nombre: 'Color sólido', ayuda: 'Número grande y barras de progreso.' },
  { id: 'PORCIONES', nombre: 'Por porciones', ayuda: 'Pizza o torta que se completa por rebanadas.' },
  { id: 'TAZA', nombre: 'Taza que se llena', ayuda: 'Ideal para cafeterías y bebidas.' },
  { id: 'ANILLO', nombre: 'Anillo de progreso', ayuda: 'El premio en grande y un anillo que se cierra.' },
  { id: 'CAMINO', nombre: 'Camino de premios', ayuda: 'Muestra los premios intermedios en el recorrido.', nuevo: true },
  { id: 'PERFORADA', nombre: 'Tarjeta perforada', ayuda: 'La tarjeta de papel de toda la vida.', nuevo: true },
  { id: 'VIP', nombre: 'VIP por niveles', ayuda: 'Plata, Oro, Platino según lo que gasta.' },
  { id: 'SALDO', nombre: 'Saldo / cashback', ayuda: 'El saldo disponible y el % que devuelves.' },
];

export const LETRAS: Record<Letra, { nombre: string; familia: string }> = {
  MODERNA: { nombre: 'Moderna', familia: "Poppins, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" },
  ELEGANTE: { nombre: 'Elegante', familia: "Fraunces, 'Playfair Display', Georgia, 'Times New Roman', serif" },
  IMPACTO: { nombre: 'Impacto', familia: "'Bebas Neue', Oswald, Impact, 'Arial Narrow', sans-serif" },
};

// La letra de la franja que se está dibujando. dibujarFranja es síncrona, así
// que fijarla al entrar no se cruza con otra llamada; evita pasarla por las
// once funciones de estilo.
let letraActual: Letra = 'MODERNA';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `#RRGGBB` + opacidad → rgba(). Acepta #RGB. Si no se entiende, devuelve el color tal cual. */
export function alfa(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Luminancia relativa simple: decide si sobre un color va texto claro u oscuro. */
export function esClaro(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 165;
}

/** Ícono por defecto en el navegador: emoji con <text>. */
export function iconoEmojiNavegador(emoji: string): DibujarIcono {
  return (cx, cy, tam) =>
    `<text x="${cx}" y="${cy + tam * 0.36}" text-anchor="middle" font-size="${tam}">${esc(emoji)}</text>`;
}

function iconoImagen(url: string, opacidad: number): DibujarIcono {
  return (cx, cy, tam, id) => {
    const r = tam / 2;
    return (
      `<clipPath id="ci${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>` +
      `<image href="${esc(url)}" x="${cx - r}" y="${cy - r}" width="${tam}" height="${tam}" ` +
      `preserveAspectRatio="xMidYMid slice" clip-path="url(#ci${id})" opacity="${opacidad}"/>`
    );
  };
}

function texto(
  x: number,
  y: number,
  s: string,
  o: { size: number; color: string; peso?: number; ancla?: 'start' | 'middle' | 'end'; espaciado?: number; opacidad?: number },
): string {
  const impacto = letraActual === 'IMPACTO';
  // Bebas solo trae mayúsculas y una sola grosura: se agranda un poco para que
  // pese lo mismo que las otras dos.
  const size = impacto ? Math.round(o.size * 1.12) : o.size;
  return (
    `<text x="${x}" y="${y}" font-family="${LETRAS[letraActual].familia}" font-size="${size}" font-weight="${impacto ? 400 : (o.peso ?? 600)}" ` +
    `fill="${o.color}" text-anchor="${o.ancla ?? 'start'}"` +
    (o.espaciado ? ` letter-spacing="${o.espaciado}"` : '') +
    (o.opacidad != null ? ` opacity="${o.opacidad}"` : '') +
    `>${esc(impacto ? s.toUpperCase() : s)}</text>`
  );
}

/** Corta un texto a `max` caracteres con «…»: sin medir fuentes, es lo más seguro. */
function cortar(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

export function fraseDeFaltan(c: ConfigFranja): string {
  const faltan = Math.max(0, c.requeridos - c.sellados);
  // Corta a propósito: va al lado del número grande y no cabe una frase larga.
  if (faltan === 0) return '¡Completa! Pide tu premio';
  return `Te faltan ${faltan} para ${c.premio}`;
}

function sanear(c: ConfigFranja): ConfigFranja {
  const requeridos = Math.max(1, Math.min(30, Math.round(c.requeridos || 1)));
  const sellados = Math.max(0, Math.min(requeridos, Math.round(c.sellados || 0)));
  return { ...c, requeridos, sellados, premio: c.premio?.trim() || 'tu premio', unidad: c.unidad?.trim() || 'visitas' };
}

function fondoBase(c: ConfigFranja, conFoto: boolean): string {
  if (conFoto && c.portada) {
    return (
      `<rect width="${ANCHO}" height="${ALTO}" fill="${c.area}"/>` +
      `<image href="${esc(c.portada)}" x="0" y="0" width="${ANCHO}" height="${ALTO}" preserveAspectRatio="xMidYMid slice"/>` +
      `<rect width="${ANCHO}" height="${ALTO}" fill="url(#velo)"/>`
    );
  }
  return `<rect width="${ANCHO}" height="${ALTO}" fill="${c.area}"/>`;
}

const DEFS_COMUNES = `
<linearGradient id="velo" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0%" stop-color="rgba(0,0,0,0.72)"/>
  <stop offset="65%" stop-color="rgba(0,0,0,0.35)"/>
  <stop offset="100%" stop-color="rgba(0,0,0,0.15)"/>
</linearGradient>`;

function envolver(defs: string, cuerpo: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">` +
    `<defs>${DEFS_COMUNES}${defs}</defs>${cuerpo}</svg>`
  );
}

/* ───────────────────────── estilos ───────────────────────── */

function rejilla(c: ConfigFranja, icono: DibujarIcono, iconoTenue: DibujarIcono, regalo: DibujarIcono): string {
  const filas = c.requeridos > 6 ? 2 : 1;
  const porFila = Math.ceil(c.requeridos / filas);
  const padX = 34;
  const padY = filas === 2 ? 26 : 40;
  const gap = filas === 2 ? 14 : 20;
  const cw = (ANCHO - padX * 2 - gap * (porFila - 1)) / porFila;
  const ch = (ALTO - padY * 2 - gap * (filas - 1)) / filas;
  const r = Math.min(cw, ch) / 2;
  const premios = new Map((c.premiosIntermedios ?? []).map((p) => [p.pos, p]));
  const out: string[] = [];
  for (let i = 0; i < c.requeridos; i++) {
    const fila = Math.floor(i / porFila);
    const col = i % porFila;
    // La última fila se centra si viene incompleta (7 sellos = 4 + 3).
    const enFila = fila === filas - 1 ? c.requeridos - porFila * (filas - 1) : porFila;
    const offset = ((porFila - enFila) * (cw + gap)) / 2;
    const cx = padX + offset + col * (cw + gap) + cw / 2;
    const cy = padY + fila * (ch + gap) + ch / 2;
    const lleno = i < c.sellados;
    const id = `s${i}`;
    if (lleno) {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.sello}"/>`);
      out.push(icono(cx, cy, r * 1.15, id));
    } else {
      out.push(
        `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="${alfa(c.texto, 0.06)}" stroke="${alfa(c.texto, 0.35)}" stroke-width="2" stroke-dasharray="5 5"/>`,
      );
      if (c.numerarVacios) {
        out.push(texto(cx, cy + r * 0.3, String(i + 1), { size: r * 0.85, color: c.texto, peso: 700, ancla: 'middle', opacidad: 0.45 }));
      } else {
        out.push(iconoTenue(cx, cy, r * 1.15, id));
      }
    }
    const p = premios.get(i + 1);
    if (p) {
      const bx = cx + r * 0.68;
      const by = cy - r * 0.68;
      out.push(`<circle cx="${bx}" cy="${by}" r="${r * 0.38}" fill="#FFFFFF" stroke="${c.area}" stroke-width="2"/>`);
      out.push(regalo(bx, by, r * 0.5, `g${i}`));
    }
  }
  return out.join('');
}

/* ── «Tu producto»: sellos sueltos, cada uno con su sitio, tamaño y giro ── */

const R = (n: number) => Math.round(n * 10) / 10;

/**
 * Los acomodos de partida. Después cada sello se mueve a mano; estos solo
 * dan un punto de arranque que ya se ve bien con cualquier cantidad.
 */
export function acomodar(tipo: Acomodo, n: number): PosSello[] {
  const out: PosSello[] = [];
  if (n <= 0) return out;
  if (tipo === 'FILA') {
    const paso = (ANCHO - 40) / n;
    const tam = Math.min(ALTO * 0.62, paso * 0.96);
    for (let i = 0; i < n; i++) out.push({ x: R(20 + paso * i + paso / 2), y: ALTO / 2, tam: R(tam), giro: 0 });
    return out;
  }
  if (tipo === 'CUADRICULA') {
    const filas = n > 14 ? 3 : n > 6 ? 2 : 1;
    const porFila = Math.ceil(n / filas);
    const cw = (ANCHO - 40) / porFila;
    const ch = (ALTO - 24) / filas;
    const tam = Math.min(cw, ch) * 0.92;
    for (let i = 0; i < n; i++) {
      const f = Math.floor(i / porFila);
      const enFila = f === filas - 1 ? n - porFila * (filas - 1) : porFila;
      const off = ((porFila - enFila) * cw) / 2;
      out.push({ x: R(20 + off + cw * (i % porFila) + cw / 2), y: R(12 + ch * f + ch / 2), tam: R(tam), giro: 0 });
    }
    return out;
  }
  if (tipo === 'ENCIMADO') {
    // Dos filas que se pisan, la de abajo corrida medio paso: se ve «amontonado»
    // a propósito, como fichas sobre la mesa.
    const porFila = Math.ceil(n / 2);
    const tam = Math.min(ALTO * 0.54, ((ANCHO - 40) / porFila) * 1.3);
    const paso = porFila > 1 ? (ANCHO - 40 - tam * 1.25) / (porFila - 1) : 0;
    for (let i = 0; i < n; i++) {
      const f = i < porFila ? 0 : 1;
      const k = f === 0 ? i : i - porFila;
      out.push({
        x: R(20 + tam / 2 + paso * k + (f === 1 ? tam * 0.25 : 0)),
        y: R(f === 0 ? tam / 2 + 10 : ALTO - tam / 2 - 10),
        tam: R(tam),
        giro: 0,
      });
    }
    return out;
  }
  // ARCO: sobre una parábola, cada sello girado según la curva.
  const tam = Math.min(ALTO * 0.42, ((ANCHO - 40) / n) * 1.15);
  // Con pocos sellos el arco se angosta: si no, 4 sellos quedan regados de
  // punta a punta con huecos enormes entre ellos.
  const medio = Math.min((ANCHO - 40 - tam) / 2, (n - 1) * tam * 0.62);
  const x0 = ANCHO / 2 - medio;
  const x1 = ANCHO / 2 + medio;
  const base = ALTO - tam / 2 - 10;
  // Tope a la curva: con pocos sellos un arco alto los deja casi de lado.
  const alto = Math.min(Math.max(0, base - tam / 2 - 10), medio * 0.45);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
    const x = x0 + ((t + 1) / 2) * (x1 - x0);
    const y = base - alto * (1 - t * t);
    // Con un solo sello `medio` es 0: sin la guarda, el giro sale NaN.
    const pendiente = medio > 0 ? (2 * alto * t) / medio : 0;
    out.push({ x: R(x), y: R(y), tam: R(tam), giro: R((Math.atan(pendiente) * 180) / Math.PI) });
  }
  return out;
}

/** Las posiciones guardadas, completadas con el acomodo si sobran sellos. */
export function posicionesDe(c: ConfigFranja): PosSello[] {
  const base = acomodar(c.acomodo ?? 'FILA', c.requeridos);
  const propias = c.posiciones ?? [];
  return base.map((b, i) => propias[i] ?? b);
}

function producto(c: ConfigFranja, emoji: DibujarIcono): string {
  const faltantes = c.faltantes ?? 'TRANSPARENTES';
  const out: string[] = [];
  posicionesDe(c).forEach((p, i) => {
    const lleno = i < c.sellados;
    if (!lleno && faltantes === 'OCULTOS') return;
    const img = p.imagen || c.iconoImagen || null;
    const giro = p.giro ? ` transform="rotate(${p.giro} ${p.x} ${p.y})"` : '';
    const h = p.tam / 2;
    let cuerpo: string;
    if (img) {
      // Foto del producto sin recorte: con el fondo quitado, la forma ES el sello.
      cuerpo = `<image href="${esc(img)}" x="${R(p.x - h)}" y="${R(p.y - h)}" width="${p.tam}" height="${p.tam}" preserveAspectRatio="xMidYMid meet"/>`;
    } else {
      cuerpo = `<circle cx="${p.x}" cy="${p.y}" r="${h}" fill="${c.sello}"/>` + emoji(p.x, p.y, p.tam * 0.6, `p${i}`);
    }
    if (lleno) {
      out.push(`<g${giro}>${cuerpo}</g>`);
    } else if (faltantes === 'CONTORNO') {
      out.push(
        `<circle cx="${p.x}" cy="${p.y}" r="${R(h - 2)}" fill="none" stroke="${alfa(c.texto, 0.45)}" stroke-width="2.5" stroke-dasharray="6 6"/>`,
      );
    } else {
      out.push(`<g opacity="0.28"${giro}>${cuerpo}</g>`);
    }
  });
  return out.join('');
}

function numeroGrande(c: ConfigFranja, x: number, conFoto: boolean): string {
  const n = String(c.sellados);
  const size = n.length > 1 ? 150 : 170;
  const anchoNum = n.length * size * 0.58;
  return (
    texto(x, 178, n, { size, color: c.texto, peso: 300 }) +
    texto(x + anchoNum + 12, 112, `/ ${c.requeridos} ${c.unidad.toUpperCase()}`, {
      size: 17,
      color: c.texto,
      peso: 800,
      espaciado: 1.5,
      opacidad: conFoto ? 0.95 : 0.85,
    }) +
    texto(x + anchoNum + 12, 140, cortar(fraseDeFaltan(c), 34), { size: 17, color: c.texto, peso: 600, opacidad: 0.8 })
  );
}

/**
 * La foto ocupa la derecha y se FUNDE con el color del área hacia la izquierda,
 * donde va el número: así el texto siempre cae sobre color liso y se lee, sin
 * el velo negro que apaga la foto entera.
 */
function fotoNumero(c: ConfigFranja): string {
  if (!c.portada) return fondoBase(c, false) + numeroGrande(c, 40, false);
  const x0 = Math.round(ANCHO * 0.4);
  return (
    `<rect width="${ANCHO}" height="${ALTO}" fill="${c.area}"/>` +
    `<image href="${esc(c.portada)}" x="${x0}" y="0" width="${ANCHO - x0}" height="${ALTO}" preserveAspectRatio="xMidYMid slice"/>` +
    `<linearGradient id="funde" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0.42" stop-color="${c.area}" stop-opacity="1"/>` +
    `<stop offset="0.7" stop-color="${c.area}" stop-opacity="0.35"/>` +
    `<stop offset="1" stop-color="${c.area}" stop-opacity="0"/></linearGradient>` +
    `<rect width="${ANCHO}" height="${ALTO}" fill="url(#funde)"/>` +
    numeroGrande(c, 40, false)
  );
}

function colorSolido(c: ConfigFranja): string {
  const n = String(c.sellados);
  const x0 = 300;
  const ancho = ANCHO - x0 - 36;
  const gap = c.requeridos > 15 ? 4 : 7;
  const bw = (ancho - gap * (c.requeridos - 1)) / c.requeridos;
  const barras: string[] = [];
  for (let i = 0; i < c.requeridos; i++) {
    barras.push(
      `<rect x="${x0 + i * (bw + gap)}" y="106" width="${bw}" height="36" rx="${Math.min(8, bw / 2)}" fill="${i < c.sellados ? c.sello : alfa(c.texto, 0.18)}"/>`,
    );
  }
  return (
    fondoBase(c, false) +
    texto(150, 190, n, { size: n.length > 1 ? 160 : 190, color: c.texto, peso: 300, ancla: 'middle' }) +
    texto(ANCHO - 36, 96, c.unidad.toUpperCase(), { size: 15, color: c.texto, peso: 800, ancla: 'end', espaciado: 2, opacidad: 0.8 }) +
    barras.join('') +
    texto(x0, 172, cortar(fraseDeFaltan(c), 32), { size: 17, color: c.texto, peso: 600, opacidad: 0.85 })
  );
}

function bloqueDerecho(c: ConfigFranja, x: number): string {
  return (
    texto(x, 118, `${c.sellados} de ${c.requeridos}`, { size: 46, color: c.texto, peso: 800 }) +
    texto(x, 152, cortar(fraseDeFaltan(c), 36), { size: 17, color: c.texto, peso: 600, opacidad: 0.8 })
  );
}

function porciones(c: ConfigFranja): string {
  const cx = 132;
  const cy = ALTO / 2;
  const r = 98;
  const n = c.requeridos;
  const tipo = c.porcion ?? 'PIZZA';
  // PIZZA tiene sus colores propios (masa, queso, pepperoni): con el color de
  // «Sellos» deja de parecer pizza. TORTA y LISA sí usan el color de la marca.
  const relleno = tipo === 'PIZZA' ? '#F2C14E' : c.sello;
  const out: string[] = [`<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="${alfa(c.texto, 0.08)}"/>`];
  const punto =
    tipo === 'PIZZA'
      ? '#B3261E'
      : tipo === 'TORTA'
        ? 'rgba(255,255,255,0.85)'
        : esClaro(c.sello)
          ? 'rgba(0,0,0,0.25)'
          : 'rgba(255,255,255,0.5)';
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const a1 = a0 + (2 * Math.PI) / n;
    const lleno = i < c.sellados;
    const fill = lleno ? relleno : alfa(c.texto, 0.12);
    if (n === 1) {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`);
    } else {
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
      const grande = a1 - a0 > Math.PI ? 1 : 0;
      out.push(
        `<path d="M${cx} ${cy} L${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r} ${r} 0 ${grande} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} Z" ` +
          `fill="${fill}" stroke="${c.area}" stroke-width="4" stroke-linejoin="round"/>`,
      );
    }
    if (lleno && tipo !== 'LISA') {
      // Pizza: pepperoni. Torta: crema. Que no parezca un gráfico de Excel.
      const am = (a0 + a1) / 2;
      const puntos: ReadonlyArray<readonly [number, number]> =
        tipo === 'PIZZA'
          ? [[0.66, -0.2], [0.4, 0.18]]
          : [[0.84, -0.25], [0.84, 0.25], [0.84, 0]];
      const radio = Math.max(3, (tipo === 'PIZZA' ? 22 : 12) / Math.sqrt(n));
      for (const [k, d] of puntos) {
        const aa = am + d * ((2 * Math.PI) / n);
        out.push(
          `<circle cx="${(cx + r * k * Math.cos(aa)).toFixed(2)}" cy="${(cy + r * k * Math.sin(aa)).toFixed(2)}" r="${radio}" fill="${punto}"/>`,
        );
      }
    }
  }
  if (tipo === 'PIZZA' && c.sellados > 0) {
    // La orilla de masa solo donde ya hay porciones: el arco crece con las visitas.
    const C = 2 * Math.PI * r;
    const frac = c.sellados / n;
    out.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#C68642" stroke-width="10" ` +
        `stroke-dasharray="${(C * frac).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`,
    );
  }
  return fondoBase(c, false) + out.join('') + bloqueDerecho(c, 268);
}

function taza(c: ConfigFranja): string {
  const p = c.sellados / c.requeridos;
  const vaso = c.recipiente === 'VASO';
  const top = vaso ? 30 : 52;
  const bottom = vaso ? 216 : 206;
  const cuerpo = vaso
    ? `M66 ${top} L178 ${top} L162 ${bottom - 8} Q161 ${bottom} 153 ${bottom} L91 ${bottom} Q83 ${bottom} 82 ${bottom - 8} Z`
    : `M48 ${top} L196 ${top} L196 166 Q196 ${bottom} 156 ${bottom} L88 ${bottom} Q48 ${bottom} 48 166 Z`;
  const nivel = top + 8 + (bottom - top - 8) * (1 - p);
  const vapor =
    p >= 1 && !vaso
      ? [80, 122, 164]
          .map(
            (x) =>
              `<path d="M${x} 40 q-10 -10 0 -18 q10 -8 0 -18" fill="none" stroke="${alfa(c.texto, 0.55)}" stroke-width="4" stroke-linecap="round"/>`,
          )
          .join('')
      : '';
  return (
    fondoBase(c, false) +
    `<clipPath id="tazaClip"><path d="${cuerpo}"/></clipPath>` +
    `<path d="${cuerpo}" fill="${alfa(c.texto, 0.1)}"/>` +
    `<rect x="40" y="${nivel.toFixed(1)}" width="170" height="${bottom - nivel + 4}" fill="${c.sello}" clip-path="url(#tazaClip)"/>` +
    (p > 0 && p < 1
      ? `<rect x="40" y="${nivel.toFixed(1)}" width="170" height="5" fill="${alfa('#FFFFFF', 0.35)}" clip-path="url(#tazaClip)"/>`
      : '') +
    `<path d="${cuerpo}" fill="none" stroke="${c.texto}" stroke-width="6" stroke-linejoin="round"/>` +
    // El vaso lleva pajilla: se lee como bebida fría aunque esté vacío.
    (vaso
      ? `<path d="M150 ${top + 70} L178 6" stroke="${c.texto}" stroke-width="7" stroke-linecap="round"/>`
      : `<path d="M196 82 h14 a34 34 0 0 1 0 68 h-14" fill="none" stroke="${c.texto}" stroke-width="6" stroke-linecap="round"/>`) +
    vapor +
    bloqueDerecho(c, 268)
  );
}

function anillo(c: ConfigFranja): string {
  const p = c.sellados / c.requeridos;
  const cx = ANCHO - 120;
  const cy = ALTO / 2;
  const r = 80;
  const C = 2 * Math.PI * r;
  return (
    fondoBase(c, false) +
    texto(36, 82, 'PRÓXIMO PREMIO', { size: 15, color: c.texto, peso: 800, espaciado: 2, opacidad: 0.75 }) +
    texto(36, 134, cortar(c.premio, 16), { size: 44, color: c.texto, peso: 800 }) +
    texto(36, 170, cortar(fraseDeFaltan(c), 32), { size: 17, color: c.texto, peso: 600, opacidad: 0.8 }) +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${alfa(c.texto, 0.15)}" stroke-width="18"/>` +
    (p > 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.sello}" stroke-width="18" stroke-linecap="round" ` +
        `stroke-dasharray="${(C * p).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
      : '') +
    texto(cx, cy + 26, String(c.sellados), { size: 72, color: c.texto, peso: 700, ancla: 'middle' })
  );
}

/**
 * Lo que Sellea no tiene: los premios intermedios se VEN en el recorrido. Con la
 * rejilla, un regalo en el sello 5 es un puntito en una esquina; aquí es una
 * parada del camino con su nombre.
 */
function camino(c: ConfigFranja, icono: DibujarIcono, regalo: DibujarIcono): string {
  const n = c.requeridos;
  const x0 = 44;
  const x1 = ANCHO - 44;
  const y = 150;
  const paso = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const premios = new Map((c.premiosIntermedios ?? []).map((p) => [p.pos, p]));
  const xLleno = c.sellados > 0 ? x0 + paso * (c.sellados - 1) : x0;
  const out: string[] = [
    `<rect x="${x0}" y="${y - 5}" width="${x1 - x0}" height="10" rx="5" fill="${alfa(c.texto, 0.15)}"/>`,
  ];
  if (c.sellados > 1) out.push(`<rect x="${x0}" y="${y - 5}" width="${xLleno - x0}" height="10" rx="5" fill="${c.sello}"/>`);
  const proximo = [...premios.values(), { pos: n, texto: c.premio }]
    .filter((p) => p.pos > c.sellados)
    .sort((a, b) => a.pos - b.pos)[0];
  for (let i = 1; i <= n; i++) {
    const x = x0 + paso * (i - 1);
    const lleno = i <= c.sellados;
    const esPremio = premios.has(i) || i === n;
    const r = esPremio ? 22 : n > 14 ? 7 : 10;
    out.push(
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${lleno ? c.sello : c.area}" stroke="${lleno ? c.sello : alfa(c.texto, 0.4)}" stroke-width="3"/>`,
    );
    if (esPremio) {
      out.push(
        lleno
          ? icono(x, y, 26, `c${i}`)
          : regalo(x, y, 26, `g${i}`),
      );
      const etiqueta = i === n ? c.premio : premios.get(i)!.texto;
      out.push(texto(x, y + 50, cortar(etiqueta, 14), { size: 14, color: c.texto, peso: 700, ancla: i === n ? 'end' : 'middle', opacidad: 0.85 }));
    }
  }
  const titulo = proximo
    ? `Próximo: ${cortar(proximo.texto, 18)} en el ${proximo.pos}`
    : `¡Completaste! Pide tu ${cortar(c.premio, 18)}`;
  return (
    fondoBase(c, false) +
    texto(x0, 70, `${c.sellados} de ${n}`, { size: 40, color: c.texto, peso: 800 }) +
    texto(x1, 70, titulo, { size: 17, color: c.texto, peso: 600, ancla: 'end', opacidad: 0.85 }) +
    out.join('')
  );
}

/** La cartulina de toda la vida: un hueco «perforado» por visita, numerada. */
function perforada(c: ConfigFranja): string {
  const filas = c.requeridos > 8 ? 2 : 1;
  const porFila = Math.ceil(c.requeridos / filas);
  const padX = 44;
  const padY = filas === 2 ? 74 : 104;
  const gapY = 64;
  const paso = (ANCHO - padX * 2) / porFila;
  const r = Math.min(20, paso * 0.3);
  const out: string[] = [
    `<rect x="14" y="14" width="${ANCHO - 28}" height="${ALTO - 28}" rx="16" fill="none" stroke="${alfa(c.texto, 0.35)}" stroke-width="2" stroke-dasharray="8 6"/>`,
    texto(36, 52, c.premio.toUpperCase(), { size: 16, color: c.texto, peso: 800, espaciado: 2, opacidad: 0.8 }),
    texto(ANCHO - 36, 52, `${c.sellados}/${c.requeridos}`, { size: 16, color: c.texto, peso: 800, ancla: 'end', opacidad: 0.8 }),
  ];
  for (let i = 0; i < c.requeridos; i++) {
    const fila = Math.floor(i / porFila);
    const col = i % porFila;
    const cx = padX + paso * col + paso / 2;
    const cy = padY + fila * gapY;
    if (i < c.sellados) {
      // El hueco deja ver el color de la tarjeta, como un sacabocados de verdad.
      // El hueco: oscuro por dentro y con el borde del color del sello, para que
      // se lea «ya está perforado» también en paletas oscuras.
      out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(0,0,0,0.55)" stroke="${c.sello}" stroke-width="4"/>`);
      out.push(`<circle cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.28}" fill="${alfa(c.sello, 0.45)}"/>`);
    } else {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${alfa(c.texto, 0.4)}" stroke-width="2"/>`);
      out.push(texto(cx, cy + r * 0.38, String(i + 1), { size: r * 1.05, color: c.texto, peso: 700, ancla: 'middle', opacidad: 0.5 }));
    }
  }
  return fondoBase(c, false) + out.join('');
}

export const NIVELES_POR_DEFECTO: Nivel[] = [
  { nombre: 'Plata', desde: 0 },
  { nombre: 'Oro', desde: 200 },
  { nombre: 'Platino', desde: 500 },
];

export function nivelActual(niveles: Nivel[], gastado: number): number {
  let k = 0;
  niveles.forEach((n, i) => {
    if (gastado >= n.desde) k = i;
  });
  return k;
}

function vip(c: ConfigFranja): string {
  const niveles = (c.niveles?.length ? c.niveles : NIVELES_POR_DEFECTO).slice().sort((a, b) => a.desde - b.desde);
  const gastado = c.gastado ?? 0;
  const k = nivelActual(niveles, gastado);
  const mon = c.moneda ?? '$';
  const sig = niveles[k + 1];
  const frase = sig ? `Te faltan ${mon}${Math.ceil(sig.desde - gastado)} para ${sig.nombre}` : 'Estás en el nivel más alto';
  const x0 = 330;
  const ancho = ANCHO - x0 - 36;
  const gap = 10;
  const bw = (ancho - gap * (niveles.length - 1)) / niveles.length;
  const barras = niveles
    .map((n, i) => {
      const x = x0 + i * (bw + gap);
      let p = 0;
      if (i < k) p = 1;
      else if (i === k) p = sig ? Math.min(1, (gastado - n.desde) / (sig.desde - n.desde)) : 1;
      return (
        `<rect x="${x}" y="118" width="${bw}" height="14" rx="7" fill="none" stroke="${alfa(c.texto, 0.45)}" stroke-width="2"/>` +
        (p > 0 ? `<rect x="${x}" y="118" width="${(bw * p).toFixed(1)}" height="14" rx="7" fill="${c.sello}"/>` : '') +
        texto(x, 156, n.nombre, { size: 13, color: c.texto, peso: i === k ? 800 : 500, opacidad: i === k ? 1 : 0.6 })
      );
    })
    .join('');
  return (
    fondoBase(c, false) +
    texto(36, 88, 'TU NIVEL', { size: 15, color: c.texto, peso: 800, espaciado: 2, opacidad: 0.75 }) +
    texto(32, 160, cortar(niveles[k].nombre, 9), { size: 76, color: c.texto, peso: 400 }) +
    (niveles[k].beneficio?.trim()
      ? texto(36, 196, cortar(niveles[k].beneficio!, 34), { size: 16, color: c.texto, peso: 600, opacidad: 0.8 })
      : '') +
    texto(x0, 98, cortar(frase, 30), { size: 16, color: c.texto, peso: 600, opacidad: 0.85 }) +
    barras
  );
}

function saldo(c: ConfigFranja): string {
  const mon = c.moneda ?? '$';
  const s = (c.saldo ?? 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cx = ANCHO - 110;
  const cy = 112;
  return (
    fondoBase(c, false) +
    texto(36, 84, 'SALDO DISPONIBLE', { size: 15, color: c.texto, peso: 800, espaciado: 2, opacidad: 0.75 }) +
    texto(32, 168, `${mon}${s}`, { size: s.length > 8 ? 68 : 84, color: c.texto, peso: 400 }) +
    `<circle cx="${cx}" cy="${cy}" r="54" fill="${c.sello}"/>` +
    texto(cx, cy + 12, `${c.porcentaje ?? 0}%`, { size: 34, color: esClaro(c.sello) ? '#111111' : '#FFFFFF', peso: 800, ancla: 'middle' }) +
    texto(cx, cy + 86, 'de cada compra', { size: 15, color: c.texto, peso: 600, ancla: 'middle', opacidad: 0.8 })
  );
}

/**
 * Devuelve el SVG de la franja. `dibujarIcono` permite al backend pasar sus
 * renderers (librsvg no pinta emoji a color); sin él, se usa <text> con emoji.
 */
export function dibujarFranja(entrada: ConfigFranja, dibujarIcono?: DibujarIcono, dibujarRegalo?: DibujarIcono): string {
  const c = sanear(entrada);
  letraActual = c.letra ?? 'MODERNA';
  const icono: DibujarIcono = c.iconoImagen
    ? iconoImagen(c.iconoImagen, 1)
    : dibujarIcono ?? iconoEmojiNavegador(c.emoji || '⭐');
  // El 🎁 de los premios intermedios, por la misma razón que el ícono: el
  // backend le pasa su dibujo, porque librsvg lo pinta como silueta negra.
  const regalo: DibujarIcono = dibujarRegalo ?? iconoEmojiNavegador('🎁');
  const iconoTenue: DibujarIcono = c.iconoImagen
    ? iconoImagen(c.iconoImagen, 0.4)
    : (cx, cy, tam, id) => `<g opacity="0.28">${icono(cx, cy, tam, id)}</g>`;

  switch (c.estilo) {
    case 'SELLOS':
      return envolver('', fondoBase(c, !!c.portadaDetrasDeSellos) + rejilla(c, icono, iconoTenue, regalo));
    case 'PRODUCTO':
      return envolver('', fondoBase(c, !!c.portadaDetrasDeSellos) + producto(c, dibujarIcono ?? iconoEmojiNavegador(c.emoji || '⭐')));
    case 'FOTO_NUMERO':
      return envolver('', fotoNumero(c));
    case 'COLOR_SOLIDO':
      return envolver('', colorSolido(c));
    case 'PORCIONES':
      return envolver('', porciones(c));
    case 'TAZA':
      return envolver('', taza(c));
    case 'ANILLO':
      return envolver('', anillo(c));
    case 'CAMINO':
      return envolver('', camino(c, icono, regalo));
    case 'PERFORADA':
      return envolver('', perforada(c));
    case 'VIP':
      return envolver('', vip(c));
    case 'SALDO':
      return envolver('', saldo(c));
    default:
      return envolver('', fondoBase(c, false));
  }
}

export function svgComoDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ───────────────────────── paletas ───────────────────────── */

export type Paleta = { id: string; nombre: string; fondo: string; texto: string; sello: string; area: string };

/** Paletas listas: los 4 colores a la vez, probadas para que el texto se lea. */
export const PALETAS: Paleta[] = [
  { id: 'clubify', nombre: 'Clubify', fondo: '#0F1B14', texto: '#FFFFFF', sello: '#22C55E', area: '#16261C' },
  { id: 'noche', nombre: 'Noche', fondo: '#1A1033', texto: '#FFF6F0', sello: '#F4B6A6', area: '#2A2047' },
  { id: 'mocha', nombre: 'Mocha', fondo: '#3B2418', texto: '#FFF4E6', sello: '#E9C9A0', area: '#5A3A28' },
  { id: 'burdeos', nombre: 'Burdeos', fondo: '#4A0E1C', texto: '#FFEFF2', sello: '#F3B8C4', area: '#6B1A2C' },
  { id: 'rosa', nombre: 'Rosa', fondo: '#FCE4EC', texto: '#5B1235', sello: '#C2185B', area: '#F8BBD0' },
  { id: 'lila', nombre: 'Lila', fondo: '#EDE7F6', texto: '#311B92', sello: '#7E57C2', area: '#D1C4E9' },
  { id: 'volt', nombre: 'Volt', fondo: '#111111', texto: '#F5F5F5', sello: '#E6FF3B', area: '#1E1E1E' },
  { id: 'menta', nombre: 'Menta', fondo: '#0F3D2E', texto: '#ECFDF5', sello: '#6EE7B7', area: '#1B5641' },
  { id: 'oro', nombre: 'Oro', fondo: '#141210', texto: '#F8EBD0', sello: '#D4AF37', area: '#221E18' },
  { id: 'tropical', nombre: 'Tropical', fondo: '#0E7C7B', texto: '#FFFFFF', sello: '#FF8C42', area: '#11908F' },
  { id: 'oceano', nombre: 'Océano', fondo: '#0B2A5B', texto: '#EAF2FF', sello: '#4FA3FF', area: '#123A7A' },
  { id: 'papel', nombre: 'Papel', fondo: '#F6EFE6', texto: '#3A2E26', sello: '#C0392B', area: '#EFE4D6' },
];
