/**
 * Qué dice una Tarjeta Informativa (`CardType.INFO`).
 *
 * ESTO ES UN ESPEJO DEL BACKEND, como `horario-de-domicilios.mjs` y
 * `solo-infolink.ts`. La misma frase la calculan tres sitios distintos:
 *
 *   · el pase de Apple      — backend/src/wallet/wallet.service.ts
 *   · el pase de Google     — backend/src/wallet/google-wallet.service.ts
 *   · lo que se ve en pantalla — este archivo (vista previa del panel y
 *     página pública de la tarjeta)
 *
 * Si los tres no dicen lo mismo, el negocio configura mirando una cosa y el
 * cliente recibe otra. Por eso la regla vive en un módulo puro y con pruebas
 * (`npm run pruebas:credencial`) en vez de repetida dentro de tres JSX.
 *
 * LO QUE NO ESTÁ AQUÍ, a propósito: los colores. `src/lib/contrast.ts` ya
 * tiene `safeBrandColor`, `autoTextColor` y `meetsAA`, y duplicarlos en un
 * `.mjs` sería crear el mismo problema que este archivo existe para evitar.
 */

/** Lo que el negocio ve cuando una credencial está retirada. */
export const REVOCADA = 'DESACTIVADA';
/** El respaldo de quien no escribió nada en su tarjeta. */
export const ACTIVA = 'ACTIVA';

/**
 * El texto que se lee en la credencial, bajo el nombre del cliente.
 *
 * El orden importa y es este:
 *
 *  1. **Revocada gana siempre.** Un texto bonito puesto por el negocio no
 *     puede tapar que la credencial ya no vale. Si esto se invirtiera, un
 *     cliente al que le retiraron la tarjeta seguiría viendo «Socio fundador»
 *     en su móvil y la enseñaría en la puerta.
 *  2. **Lo que escribió el negocio.** Es lo que hace que esta tarjeta sirva
 *     para un restaurante, una clínica o un club, y no solo para el primero
 *     que la pidió. Nada de textos cableados.
 *  3. **«ACTIVA»**, para quien dejó el campo vacío.
 *
 * @param {{ revocada?: boolean, textoDelNegocio?: string|null }} [estado]
 * @returns {string}
 */
export function textoDeLaCredencial(estado = {}) {
  if (estado.revocada) return REVOCADA;
  const suyo = typeof estado.textoDelNegocio === 'string'
    ? estado.textoDelNegocio.trim()
    : '';
  return suyo || ACTIVA;
}

/**
 * ¿Esta tarjeta lleva cartón de sellos?
 *
 * Las tres que NO son un cartón —alianza, club con cupo grande e informativa—
 * han acabado dibujando círculos vacíos alguna vez, y siempre por la misma
 * razón: la condición estaba escrita dentro de un JSX y alguien añadió un caso
 * sin acordarse. Aquí se responde una vez.
 *
 * @param {{ tipo?: string, alianza?: unknown, club?: {cupo:number}|null }} tarjeta
 * @returns {boolean}
 */
export function llevaCarton(tarjeta = {}) {
  if (tarjeta.tipo === 'INFO') return false;
  if (tarjeta.alianza) return false;
  if (tarjeta.club && tarjeta.club.cupo > 20) return false;
  return true;
}
