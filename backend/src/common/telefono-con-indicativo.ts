/**
 * Un teléfono con su indicativo de país («+573225998240»).
 *
 * POR QUÉ EXISTE (La Burguesía, 2026-10-27): el WhatsApp del negocio estaba
 * guardado como «3225998240», sin indicativo. Al mandar el SMS, Grow Business
 * le ponía un «+» delante —«+3225998240»—, que es un número de BÉLGICA (+32).
 * Los cinco avisos de cobro de octubre salieron «enviados» a Bélgica y el
 * dueño no recibió ninguno.
 *
 * Reglas:
 *  - Con «+» o «00» delante, ya trae indicativo: se respeta.
 *  - Sin indicativo y con el largo de un número nacional (≤ 10 cifras): se le
 *    pone el del país del negocio, quitando el 0 de troncal si lo trae.
 *  - Con más de 10 cifras y sin «+», se asume que el indicativo ya va dentro.
 *  - Sin país conocido, o sin dígitos: se devuelve tal cual (no se adivina).
 */
export const INDICATIVO_POR_PAIS: Record<string, string> = {
  CO: '57', MX: '52', AR: '54', CL: '56', PE: '51', EC: '593', VE: '58',
  BO: '591', PY: '595', UY: '598', CR: '506', PA: '507', GT: '502',
  HN: '504', SV: '503', NI: '505', BZ: '501', DO: '1', PR: '1', US: '1',
  CA: '1', ES: '34', BR: '55', PT: '351', IT: '39', FR: '33', DE: '49', GB: '44',
};

export function telefonoConIndicativo(
  raw: string | null | undefined,
  pais: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (t.startsWith('+')) {
    const d = t.slice(1).replace(/\D/g, '');
    return d ? `+${d}` : null;
  }
  const digitos = t.replace(/\D/g, '');
  if (!digitos) return t;
  if (digitos.startsWith('00')) return `+${digitos.slice(2)}`;
  if (digitos.length > 10) return `+${digitos}`;
  const ind = INDICATIVO_POR_PAIS[(pais ?? '').toUpperCase()];
  if (!ind) return t;
  return `+${ind}${digitos.replace(/^0+/, '')}`;
}
