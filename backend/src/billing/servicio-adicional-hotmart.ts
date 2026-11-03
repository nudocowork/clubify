/**
 * Ofertas de Hotmart que NO son un plan: servicios que el negocio compra
 * aparte de su suscripción («Paquete de Alianzas», «Automatización de
 * WhatsApp»). Viven en el MISMO producto que los planes, así que el webhook
 * las tomaba por un cobro del plan.
 *
 * Caso ALTIERI (2026-10-16): pagó USD 16,85 del Paquete de Alianzas y el
 * sistema lo registró como RENOVACIÓN semestral de USD 278, le cambió el
 * código de suscriptor por el de la suscripción del paquete y le movió el
 * vencimiento al 16-nov, cuando su semestral corría hasta enero. Sin este
 * corte, el 16-nov se le habría suspendido el negocio estando al día.
 *
 * Regla de Javier (2026-11-03): un servicio adicional es un ingreso más de esa
 * marca. No toca la fecha de vencimiento, no cuenta como renovación y no le
 * genera comisión al closer; sí suma a Contabilidad, y por eso al 2 % de Sara
 * y a la línea del socio, que salen de ahí.
 */

/** Ajuste con más códigos de oferta, si se venden servicios nuevos. */
export const CLAVE_OFERTAS_ADICIONALES = 'hotmart.ofertasAdicionales';

/** Paquete de Alianzas y Automatización de WhatsApp. */
export const OFERTAS_ADICIONALES_POR_DEFECTO = ['ticqog5c', 'eswd2iir'] as const;

/**
 * Los códigos de oferta adicionales: los de siempre más los del ajuste.
 * Acepta el ajuste como lista JSON o como texto separado por comas.
 */
export function codigosDeOfertasAdicionales(ajuste: string | null | undefined): string[] {
  const out = new Set<string>(OFERTAS_ADICIONALES_POR_DEFECTO);
  const texto = (ajuste ?? '').trim();
  if (!texto) return [...out];
  let crudos: unknown = null;
  try {
    crudos = JSON.parse(texto);
  } catch {
    crudos = texto.split(/[\s,;]+/);
  }
  if (Array.isArray(crudos)) {
    for (const c of crudos) {
      if (typeof c === 'string' && c.trim()) out.add(c.trim().toLowerCase());
    }
  }
  return [...out];
}

export function esOfertaAdicional(
  codigoDeOferta: string | null | undefined,
  codigos: readonly string[],
): boolean {
  const c = (codigoDeOferta ?? '').trim().toLowerCase();
  return !!c && codigos.includes(c);
}

/** Cómo se llama en Contabilidad: el plan de Hotmart, o la oferta. */
export function nombreDelServicio(payload: {
  data?: {
    subscription?: { plan?: { name?: string } };
    purchase?: { offer?: { description?: string } };
  };
}): string {
  return (
    payload.data?.subscription?.plan?.name?.trim() ||
    payload.data?.purchase?.offer?.description?.trim() ||
    'Servicio adicional'
  );
}
