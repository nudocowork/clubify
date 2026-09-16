import { esDeLaPlataforma } from './lab-access';

/**
 * Aviso al equipo de Clubify cuando el administrador de una marca blanca deja
 * algo en su Lab.
 *
 * Por qué existe. El Lab de una marca blanca es el canal por el que su
 * administrador (Humberto, en Sellea) pide cambios: Javier los revisa y los
 * hace. Sin aviso, la propuesta se quedaba esperando a que alguien entrara a
 * mirar la moderación. Javier pidió (2026-09-16) un SMS a su línea con la
 * marca, quién escribió, el título y el enlace para abrirla.
 *
 * Lo que NO debe avisar:
 *  - Las propuestas de la plataforma (Clubify) ni las históricas sin marca: las
 *    escriben los negocios y afiliados de Clubify, que ya tienen su cauce y son
 *    muchas más. El SMS dejaría de mirarse en una semana.
 *  - Nada dos veces por el mismo hecho: `sendInternalAlert` no tiene
 *    anti-repetición propia (a diferencia de `sendTeamAlert`), así que la pone
 *    `MemoriaDeAvisos`.
 */

/**
 * La línea de soporte a la que pidió Javier que llegue. Es un número interno
 * del equipo de Clubify, no el de nadie de la marca: el aviso dice quién es la
 * marca, y nunca sale hacia ella.
 */
export const TELEFONO_EQUIPO_LAB = '+573248088401';

/** Qué pasó. Cambia el verbo del SMS, nada más. */
export type HechoLab = 'propuesta' | 'comentario';

/**
 * Solo avisan las marcas blancas. Una propuesta de Clubify o una histórica sin
 * marca se queda como estaba.
 */
export function debeAvisarAlEquipo(
  whiteLabelId: string | null | undefined,
  clubifyId: string | null,
): boolean {
  return !esDeLaPlataforma(whiteLabelId, clubifyId);
}

/** Recorta sin partir el texto a la mitad de una palabra si se puede evitar. */
function recorta(texto: string, max: number): string {
  const limpio = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  return `${limpio.slice(0, max - 1).trimEnd()}…`;
}

/**
 * El texto del SMS. Va a un móvil: la marca y el verbo primero —que es lo que
 * se lee en la notificación— y el enlace al final, entero, porque es lo que se
 * toca. El título se recorta para que el enlace no se pierda de vista.
 */
export function textoAvisoLab(p: {
  /** Nombre de la marca. null solo si no se pudo resolver: nunca «Clubify». */
  marca: string | null;
  autor: string | null;
  titulo: string;
  enlace: string;
  hecho: HechoLab;
}): string {
  const lab = p.marca ? `Lab de ${p.marca}` : 'Lab (marca sin resolver)';
  const quien = p.autor?.trim() || 'Alguien';
  const titulo = recorta(p.titulo, 60);
  const verbo =
    p.hecho === 'propuesta'
      ? `creó la propuesta «${titulo}»`
      : `comentó en «${titulo}»`;
  return `${lab}: ${quien} ${verbo}. Revisar: ${p.enlace}`;
}

/** Normaliza un texto para poder compararlo como clave. */
function paraClave(texto: string): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
}

/**
 * Clave del aviso de una PROPUESTA nueva: quién y con qué título.
 *
 * NO puede ser el id de la propuesta: es nuevo en cada intento, así que la
 * memoria no cortaba nada. Lo que hay que callar es el doble clic en «Crear»,
 * que deja DOS filas con el mismo título del mismo autor. Dos propuestas
 * distintas avisan las dos, aunque sean del mismo autor y del mismo minuto:
 * cada una es algo que revisar, y perder la segunda sería perder trabajo.
 */
export function claveDePropuesta(autorId: string, titulo: string): string {
  return `propuesta::${autorId}::${paraClave(titulo)}`;
}

/**
 * Clave del aviso de un COMENTARIO: quién y en qué propuesta, SIN el texto.
 *
 * Un comentario suelto vale poco y llegan en ráfaga: quince en cinco minutos
 * eran quince SMS al móvil de Javier. Uno por conversación y ventana basta —el
 * SMS solo dice «ve a mirar», y en el panel están todos los comentarios—.
 * Comentar en OTRA propuesta sí vuelve a avisar: es otra conversación.
 */
export function claveDeComentario(autorId: string, proposalId: string): string {
  return `comentario::${autorId}::${proposalId}`;
}

/** Enlace a la propuesta EN LA MODERACIÓN, que es donde Javier la trabaja. */
export function enlaceDeModeracion(appUrl: string, proposalId: string): string {
  return `${appUrl.replace(/\/$/, '')}/admin/lab/${proposalId}`;
}

/**
 * Anti-repetición en memoria, igual que el circuit-breaker de
 * `PreregAlertsService`: corta el mismo aviso repetido (un reintento del
 * cliente, un doble clic, un redeploy que reprocesa) dentro de una ventana
 * corta. Con varias instancias del backend el peor caso es un SMS repetido,
 * nunca una propuesta perdida.
 *
 * La ventana NO se desliza: se cuenta desde el primer aviso y no se refresca en
 * cada intento. Así una conversación larga recibe un SMS cada diez minutos, en
 * vez de quedarse muda para siempre mientras alguien siga escribiendo.
 */
export class MemoriaDeAvisos {
  private vistos = new Map<string, number>();

  constructor(private ventanaMs = 10 * 60 * 1000) {}

  /** true si este mismo hecho ya se avisó dentro de la ventana. */
  esRepetido(clave: string, ahora = Date.now()): boolean {
    const ultimo = this.vistos.get(clave);
    if (ultimo !== undefined && ahora - ultimo < this.ventanaMs) return true;
    this.vistos.set(clave, ahora);
    // Poda: el mapa no puede crecer sin fin en un proceso que vive semanas.
    if (this.vistos.size > 500) {
      for (const [k, t] of this.vistos) {
        if (ahora - t > this.ventanaMs) this.vistos.delete(k);
      }
    }
    return false;
  }
}
