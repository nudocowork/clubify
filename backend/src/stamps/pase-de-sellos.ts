import type { Prisma } from '@prisma/client';

/**
 * Reglas del ESTADO de una tarjeta de sellos o de visitas, y de qué se hereda
 * cuando dos pases del mismo cliente se funden en uno.
 */

/** Lo mínimo de la tarjeta que hace falta para decidir su estado. */
export type TarjetaConTope = {
  type: string;
  stampsRequired: number | null;
  visitsRequired: number | null;
  clubPlanId?: string | null;
  convenioId?: string | null;
};

export type ReglaDeEstado = { columna: 'stampsCount' | 'visitsCount'; tope: number };

/**
 * Contra qué contador y qué tope se decide ACTIVE/COMPLETED, o `null` si esta
 * tarjeta no tiene un estado que decidir.
 *
 * Solo STAMPS y VISITS: son las únicas en las que COMPLETED quiere decir
 * «cartón lleno, esperando canje» y por tanto puede deshacerse.
 *
 *  · Un CUPÓN en COMPLETED significa USADO. Reabrirlo lo dejaría canjear otra
 *    vez: el guard de re-redención mira justo ese estado.
 *  · Una tarjeta de CLUB también es STAMPS por dentro, pero va al revés: su
 *    contador es un cupo que BAJA, así que «por debajo del tope» es su estado
 *    normal y no dice nada. Las de ALIANZA nacen con tope 1 y su beneficio se
 *    lleva desde el escáner de convenios.
 *  · Sin tope configurado no hay contra qué decidir. `record` nunca completa
 *    esas tarjetas (usa MAX_SAFE_INTEGER), así que tampoco se reabren: si otro
 *    camino las cerró, no es este quien sabe cuándo abrirlas.
 */
export function reglaDeEstado(card: TarjetaConTope): ReglaDeEstado | null {
  if (card.clubPlanId || card.convenioId) return null;
  if (card.type === 'STAMPS' && card.stampsRequired != null) {
    return { columna: 'stampsCount', tope: card.stampsRequired };
  }
  if (card.type === 'VISITS' && card.visitsRequired != null) {
    return { columna: 'visitsCount', tope: card.visitsRequired };
  }
  return null;
}

export type Transicion = 'REABIERTO' | 'COMPLETADO' | null;

/**
 * Deja el estado del pase de acuerdo con el contador que HAY EN LA FILA.
 *
 * Antes el estado se escribía como `completed ? 'COMPLETED' : pass.status`,
 * con `pass.status` leído antes de la transacción. Dos defectos:
 *
 *  1. Canjear el premio bajaba el contador, pero `pass.status` ya era
 *     COMPLETED, así que se reescribía COMPLETED para siempre. Todo lo que
 *     filtra `status: 'ACTIVE'` (envíos masivos, recurrentes, cumpleaños,
 *     refresco de diseño, búsqueda por teléfono) dejaba fuera justo a los
 *     clientes que completaron y volvieron: 56 pases de 11 negocios.
 *  2. Leer-decidir-escribir: con dos escaneos a la vez, cada uno decidía con
 *     su foto vieja, y PASS_COMPLETED podía salir dos veces o ninguna.
 *
 * Ahora son dos `updateMany` condicionales: la condición se evalúa sobre la
 * fila en el mismo UPDATE, y el `count` dice si hubo transición. Solo quien la
 * produce la anuncia. Se excluyen entre sí (menor que / mayor o igual), así que
 * a lo sumo una escribe. `cardId` va en el `where` porque el tope es de ESA
 * tarjeta: si el pase ya no está en ella, no se decide nada.
 */
export async function sincronizarEstado(
  tx: Prisma.TransactionClient,
  passId: string,
  cardId: string,
  card: TarjetaConTope,
): Promise<Transicion> {
  const regla = reglaDeEstado(card);
  if (!regla) return null;
  // Sin clave calculada: Prisma no acepta un literal con clave de tipo unión.
  const contador = (cond: { lt: number } | { gte: number }): Prisma.PassWhereInput =>
    regla.columna === 'stampsCount' ? { stampsCount: cond } : { visitsCount: cond };
  const reabierto = await tx.pass.updateMany({
    where: {
      id: passId,
      cardId,
      status: 'COMPLETED',
      ...contador({ lt: regla.tope }),
    },
    data: { status: 'ACTIVE' },
  });
  if (reabierto.count > 0) return 'REABIERTO';
  // Solo desde ACTIVE: un pase REVOCADO no se «completa» por sumarle sellos.
  const completado = await tx.pass.updateMany({
    where: {
      id: passId,
      cardId,
      status: 'ACTIVE',
      ...contador({ gte: regla.tope }),
    },
    data: { status: 'COMPLETED' },
  });
  return completado.count > 0 ? 'COMPLETADO' : null;
}

type ConQr = { qrToken: string; legacyQrTokens: string[] };

/**
 * Los QR que el superviviente tiene que seguir reconociendo cuando otro pase
 * del mismo cliente se funde en él: los suyos de antes, el del absorbido y los
 * que el absorbido ya había heredado.
 *
 * Es lo mismo que hace la fusión de clientes (`customers.service` → merge). El
 * escáner resuelve también por `legacyQrTokens`, así que la tarjeta que el
 * cliente tiene en el teléfono sigue escaneando aunque su fila ya no exista.
 * Sin esto, el cajero lee «Pase no encontrado».
 */
export function qrHeredados(superviviente: ConQr, absorbido: ConQr): string[] {
  return Array.from(
    new Set([
      ...superviviente.legacyQrTokens,
      absorbido.qrToken,
      ...absorbido.legacyQrTokens,
    ]),
  ).filter((t) => Boolean(t) && t !== superviviente.qrToken);
}
