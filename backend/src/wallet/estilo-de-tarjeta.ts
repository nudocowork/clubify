/**
 * El estilo de franja de una tarjeta REAL (`Card.stripStyle`).
 *
 * Mismo criterio que `franja-de-laboratorio.ts`: lo guardado termina dentro de
 * un SVG que rasteriza librsvg, así que solo entra lo que está en lista blanca.
 * La diferencia es que aquí las imágenes son URLs de NUESTRO almacenamiento
 * (las imágenes no van a la base) y se descargan con el mismo filtro que los
 * íconos de sello propios, antes de dibujar.
 */
import { BadRequestException } from '@nestjs/common';
import {
  ESTILOS_DE_TARJETA_REAL,
  ESTILOS_POR_TIPO,
  type Acomodo,
  type EstiloDeTarjeta,
  type EstiloFranja,
  type Faltantes,
  type Letra,
  type Porcion,
  type PosSello,
  type Recipiente,
} from './estilos-de-franja';
import { MAX_LARGO_URL_ICONO, urlDeIconoPermitida } from './stamp-icons';

const ACOMODOS: Acomodo[] = ['FILA', 'CUADRICULA', 'ENCIMADO', 'ARCO'];
const FALTANTES: Faltantes[] = ['TRANSPARENTES', 'CONTORNO', 'OCULTOS'];
const LETRAS: Letra[] = ['MODERNA', 'ELEGANTE', 'IMPACTO'];
const RECIPIENTES: Recipiente[] = ['TAZA', 'VASO', 'CONO'];
const PORCIONES: Porcion[] = ['PIZZA', 'TORTA', 'LISA'];

class EstiloInvalido extends Error {}

function mal(campo: string): never {
  throw new EstiloInvalido(`El estilo de la tarjeta trae un valor inválido en «${campo}».`);
}

function opcion<T extends string>(v: unknown, campo: string, lista: readonly T[]): T | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string' || !lista.includes(v as T)) mal(campo);
  return v as T;
}

function numero(v: unknown, campo: string, min: number, max: number, porDefecto?: number): number {
  if (v == null && porDefecto != null) return porDefecto;
  if (typeof v !== 'number' || !Number.isFinite(v)) mal(campo);
  return Math.min(max, Math.max(min, v));
}

function imagen(v: unknown, campo: string): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > MAX_LARGO_URL_ICONO || !urlDeIconoPermitida(v)) mal(campo);
  return v;
}

function leer(raw: unknown): EstiloDeTarjeta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) mal('estilo');
  const o = raw as Record<string, unknown>;
  // Cualquier estilo de tarjeta real; si le corresponde a ESTE tipo lo decide
  // quien dibuja (`ESTILOS_POR_TIPO`), así el validador no necesita el tipo.
  const estilo = opcion(o.estilo, 'estilo', ESTILOS_DE_TARJETA_REAL);
  if (!estilo) mal('estilo');
  let posiciones: PosSello[] | undefined;
  if (o.posiciones != null) {
    if (!Array.isArray(o.posiciones) || o.posiciones.length > 30) mal('posiciones');
    posiciones = o.posiciones.map((p, i) => {
      const q = (p ?? {}) as Record<string, unknown>;
      return {
        x: numero(q.x, `posiciones[${i}].x`, -200, 840),
        y: numero(q.y, `posiciones[${i}].y`, -200, 446),
        tam: numero(q.tam, `posiciones[${i}].tam`, 8, 400),
        giro: numero(q.giro, `posiciones[${i}].giro`, -360, 360, 0),
        imagen: imagen(q.imagen, `posiciones[${i}].imagen`),
      };
    });
  }
  const r: EstiloDeTarjeta = { estilo };
  // Solo las opciones que existen, para que el JSON guardado no crezca con
  // `undefined`s ni con opciones de otro estilo que no se usan.
  const letra = opcion(o.letra, 'letra', LETRAS);
  const recipiente = opcion(o.recipiente, 'recipiente', RECIPIENTES);
  const porcion = opcion(o.porcion, 'porcion', PORCIONES);
  const acomodo = opcion(o.acomodo, 'acomodo', ACOMODOS);
  const faltantes = opcion(o.faltantes, 'faltantes', FALTANTES);
  const portada = imagen(o.portada, 'portada');
  if (letra) r.letra = letra;
  if (recipiente) r.recipiente = recipiente;
  if (porcion) r.porcion = porcion;
  if (acomodo) r.acomodo = acomodo;
  if (faltantes) r.faltantes = faltantes;
  if (posiciones?.length) r.posiciones = posiciones;
  if (portada) r.portada = portada;
  return r;
}

/**
 * Para GUARDAR (panel): `null` = «Clásico». Lo inválido es un 400 con el campo,
 * porque hay alguien delante que puede corregirlo.
 */
export function validarEstiloDeTarjeta(raw: unknown): EstiloDeTarjeta | null {
  if (raw == null) return null;
  try {
    return leer(raw);
  } catch (e) {
    if (e instanceof EstiloInvalido) throw new BadRequestException(e.message);
    throw e;
  }
}

/**
 * Para DIBUJAR (pase): lo guardado se vuelve a pasar por la lista blanca, y si
 * algo no cuadra la tarjeta cae al cartón clásico en vez de quedarse sin franja.
 */
export function leerEstiloDeTarjeta(raw: unknown): EstiloDeTarjeta | null {
  if (raw == null) return null;
  try {
    return leer(raw);
  } catch {
    return null;
  }
}

/**
 * ¿Esta tarjeta lleva franja con estilo? La MISMA regla en el pase de Apple, en
 * `strip.png` y en el objeto de Google: si Google pidiera una franja que luego
 * no existe, recibiría un 404 y abortaría el guardado del pase entero.
 */
export function estiloQueSeDibuja(card: {
  type: string;
  stripStyle?: unknown;
  tierMetric?: string | null;
  convenioId?: string | null;
  clubPlanId?: string | null;
}): EstiloDeTarjeta | null {
  if (card.convenioId || card.clubPlanId) return null;
  const estilo = leerEstiloDeTarjeta(card.stripStyle);
  // Un estilo de otro tipo (p. ej. la tarjeta cambió de tipo) no se dibuja.
  if (!estilo || !(ESTILOS_POR_TIPO[card.type] ?? []).includes(estilo.estilo)) return null;
  // VIP dibuja PLATA («Te faltan $300.000 para Oro»). Con niveles por visitas
  // o por sellos diría montos que no son: ahí va el pase de siempre.
  if (estilo.estilo === 'VIP' && (card.tierMetric || 'spend') !== 'spend') return null;
  return estilo;
}
