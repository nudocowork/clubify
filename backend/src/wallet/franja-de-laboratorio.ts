/**
 * Validación del diseño que manda el laboratorio de tarjetas para armar un pase
 * de PRUEBA (`POST /wallet/laboratorio/pase`).
 *
 * POR QUÉ TAN ESTRICTA: lo que llega aquí se mete en un SVG que rasteriza
 * librsvg. Un «color» como `"/><image href="file:///etc/passwd` o una imagen
 * `https://…` haría que el servidor lea archivos o pida URLs ajenas al dibujar.
 * Por eso: colores solo `#RGB`/`#RRGGBB`, imágenes solo `data:image/…;base64`,
 * números finitos y acotados, y todo lo demás por lista blanca. Lo que no está
 * aquí no llega a `dibujarFranja`.
 */
import { BadRequestException } from '@nestjs/common';
import {
  ESTILOS,
  NIVELES_POR_DEFECTO,
  nivelActual,
  type Acomodo,
  type ConfigFranja,
  type EstiloFranja,
  type Faltantes,
  type Letra,
  type Nivel,
  type Porcion,
  type PosSello,
  type PremioIntermedio,
  type Recipiente,
} from './estilos-de-franja';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const IMAGEN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Por imagen. El laboratorio achica la portada a 1200 px antes de mandarla. */
const MAX_IMAGEN = 2_500_000;
/** Todas las imágenes juntas: un pase de prueba no necesita más. */
const MAX_IMAGENES_TOTAL = 6_000_000;

const ACOMODOS: Acomodo[] = ['FILA', 'CUADRICULA', 'ENCIMADO', 'ARCO'];
const FALTANTES: Faltantes[] = ['TRANSPARENTES', 'CONTORNO', 'OCULTOS'];
const LETRAS: Letra[] = ['MODERNA', 'ELEGANTE', 'IMPACTO'];
const RECIPIENTES: Recipiente[] = ['TAZA', 'VASO'];
const PORCIONES: Porcion[] = ['PIZZA', 'TORTA', 'LISA'];

function mal(campo: string): never {
  throw new BadRequestException(`El diseño trae un valor inválido en «${campo}».`);
}

function texto(v: unknown, campo: string, max: number, porDefecto = ''): string {
  if (v == null) return porDefecto;
  if (typeof v !== 'string') mal(campo);
  // Sin caracteres de control: no deben llegar ni al SVG ni al pase.
  return v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
}

function color(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !HEX.test(v.trim())) mal(campo);
  return v.trim();
}

function numero(v: unknown, campo: string, min: number, max: number, porDefecto?: number): number {
  if (v == null && porDefecto != null) return porDefecto;
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) mal(campo);
  return Math.min(max, Math.max(min, n));
}

function entero(v: unknown, campo: string, min: number, max: number, porDefecto?: number): number {
  return Math.round(numero(v, campo, min, max, porDefecto));
}

function opcion<T extends string>(v: unknown, campo: string, lista: readonly T[]): T | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string' || !lista.includes(v as T)) mal(campo);
  return v as T;
}

function lista(v: unknown, campo: string, max: number): unknown[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) mal(campo);
  return v;
}

export type PaseDeLaboratorio = {
  config: ConfigFranja;
  negocio: string;
  titular: string;
};

export function validarPaseDeLaboratorio(cuerpo: unknown): PaseDeLaboratorio {
  if (!cuerpo || typeof cuerpo !== 'object') mal('cuerpo');
  const b = cuerpo as Record<string, unknown>;
  const c = (b.config ?? null) as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || Array.isArray(c)) mal('config');

  let pesoImagenes = 0;
  const imagen = (v: unknown, campo: string): string | null => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || v.length > MAX_IMAGEN || !IMAGEN.test(v)) mal(campo);
    pesoImagenes += v.length;
    if (pesoImagenes > MAX_IMAGENES_TOTAL) {
      throw new BadRequestException('Las imágenes del diseño pesan demasiado para un pase de prueba.');
    }
    return v;
  };

  const estilos = ESTILOS.map((e) => e.id) as EstiloFranja[];
  const estilo = opcion(c.estilo, 'estilo', estilos);
  if (!estilo) mal('estilo');

  const requeridos = entero(c.requeridos, 'requeridos', 1, 30);
  const sellados = entero(c.sellados, 'sellados', 0, requeridos);

  const premiosIntermedios: PremioIntermedio[] = lista(c.premiosIntermedios, 'premiosIntermedios', 10).map(
    (p, i) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return {
        pos: entero(o.pos, `premiosIntermedios[${i}].pos`, 1, 30),
        texto: texto(o.texto, `premiosIntermedios[${i}].texto`, 30),
      };
    },
  );

  const posiciones: PosSello[] = lista(c.posiciones, 'posiciones', 30).map((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return {
      x: numero(o.x, `posiciones[${i}].x`, -200, 840),
      y: numero(o.y, `posiciones[${i}].y`, -200, 446),
      tam: numero(o.tam, `posiciones[${i}].tam`, 8, 400),
      giro: numero(o.giro, `posiciones[${i}].giro`, -360, 360, 0),
      imagen: imagen(o.imagen, `posiciones[${i}].imagen`),
    };
  });

  const niveles: Nivel[] = lista(c.niveles, 'niveles', 6).map((n, i) => {
    const o = (n ?? {}) as Record<string, unknown>;
    return {
      nombre: texto(o.nombre, `niveles[${i}].nombre`, 20) || `Nivel ${i + 1}`,
      desde: numero(o.desde, `niveles[${i}].desde`, 0, 10_000_000),
      beneficio: texto(o.beneficio, `niveles[${i}].beneficio`, 40),
    };
  });

  const config: ConfigFranja = {
    estilo,
    fondo: color(c.fondo, 'fondo'),
    texto: color(c.texto, 'texto'),
    sello: color(c.sello, 'sello'),
    area: color(c.area, 'area'),
    requeridos,
    sellados,
    premio: texto(c.premio, 'premio', 40, 'tu premio'),
    unidad: texto(c.unidad, 'unidad', 20, 'visitas'),
    emoji: texto(c.emoji, 'emoji', 16, '⭐') || '⭐',
    iconoImagen: imagen(c.iconoImagen, 'iconoImagen'),
    portada: imagen(c.portada, 'portada'),
    portadaDetrasDeSellos: c.portadaDetrasDeSellos === true,
    numerarVacios: c.numerarVacios === true,
    premiosIntermedios,
    posiciones: posiciones.length ? posiciones : undefined,
    acomodo: opcion(c.acomodo, 'acomodo', ACOMODOS),
    faltantes: opcion(c.faltantes, 'faltantes', FALTANTES),
    letra: opcion(c.letra, 'letra', LETRAS),
    recipiente: opcion(c.recipiente, 'recipiente', RECIPIENTES),
    porcion: opcion(c.porcion, 'porcion', PORCIONES),
    niveles: niveles.length ? niveles : undefined,
    gastado: numero(c.gastado, 'gastado', 0, 10_000_000, 0),
    saldo: numero(c.saldo, 'saldo', -1_000_000_000, 1_000_000_000, 0),
    porcentaje: numero(c.porcentaje, 'porcentaje', 0, 100, 0),
    moneda: texto(c.moneda, 'moneda', 3, '$') || '$',
  };

  return {
    config,
    negocio: texto(b.negocio, 'negocio', 40, 'Mi negocio') || 'Mi negocio',
    titular: texto(b.titular, 'titular', 40, 'Cliente') || 'Cliente',
  };
}

/** El campo de arriba a la derecha del pase, según el estilo (igual que la vista previa). */
export function cabeceraDelPase(c: ConfigFranja): { etiqueta: string; valor: string } {
  if (c.estilo === 'SALDO') {
    return { etiqueta: 'SALDO', valor: `${c.moneda ?? '$'}${(c.saldo ?? 0).toFixed(2)}` };
  }
  if (c.estilo === 'VIP') {
    const n = (c.niveles?.length ? c.niveles : NIVELES_POR_DEFECTO).slice().sort((a, b) => a.desde - b.desde);
    return { etiqueta: 'NIVEL', valor: n[nivelActual(n, c.gastado ?? 0)].nombre };
  }
  return { etiqueta: c.unidad.toUpperCase(), valor: `${c.sellados}/${c.requeridos}` };
}

/** Lo que se puede mover en una prueba ya instalada: el avance, nada del diseño. */
export type ProgresoDeLaboratorio = { sellados: number; gastado: number; saldo: number };

/**
 * Aplica un cambio de progreso pedido desde el laboratorio. Solo valores
 * absolutos y acotados: el cuerpo viene del navegador.
 */
export function aplicarProgreso(c: ConfigFranja, cuerpo: unknown): ConfigFranja {
  if (!cuerpo || typeof cuerpo !== 'object') mal('cuerpo');
  const b = cuerpo as Record<string, unknown>;
  return {
    ...c,
    sellados: b.sellados == null ? c.sellados : entero(b.sellados, 'sellados', 0, c.requeridos),
    gastado: b.gastado == null ? c.gastado : numero(b.gastado, 'gastado', 0, 10_000_000),
    saldo: b.saldo == null ? c.saldo : numero(b.saldo, 'saldo', -1_000_000_000, 1_000_000_000),
  };
}

/**
 * El aviso que ve el cliente cuando cambia su tarjeta, para probar también eso.
 * `null` si no cambió nada que se anuncie.
 */
export function avisoDelCambio(antes: ConfigFranja, despues: ConfigFranja): string | null {
  const a = cabeceraDelPase(antes);
  const d = cabeceraDelPase(despues);
  if (a.valor === d.valor) return null;
  if (despues.estilo === 'VIP') {
    return (despues.gastado ?? 0) > (antes.gastado ?? 0) ? `¡Subiste a nivel ${d.valor}!` : `Tu nivel ahora es ${d.valor}`;
  }
  if (despues.estilo === 'SALDO') return `Tu saldo ahora es ${d.valor}`;
  if (despues.sellados >= despues.requeridos) return `¡Completaste tu tarjeta! Pide tu ${despues.premio}`;
  if (despues.sellados > antes.sellados) return `¡Nuevo sello! Llevas ${d.valor}`;
  return `Tu tarjeta ahora marca ${d.valor}`;
}
