/**
 * Dónde viven la suscripción y el precio dentro de una factura de Stripe.
 *
 * EL FALLO (auditoría del 2026-09-24): la cuenta de Sellea emite en
 * `2026-05-27.dahlia`, y ahí Stripe movió dos campos de sitio:
 *
 *   invoice.subscription        →  invoice.parent.subscription_details.subscription
 *   invoice.lines[0].price.id   →  invoice.lines[0].pricing.price_details.price
 *
 * El backend seguía leyendo los antiguos. Medido sobre los eventos guardados en
 * producción: **0 de 30 facturas** traían el campo donde el código lo buscaba, y
 * las 30 lo traían en el sitio nuevo. Consecuencia: en cada renovación la
 * suscripción y el precio salían nulos, `findTenant` perdía su primer criterio,
 * y quedaron 5 compras pagadas sin cuenta creada.
 *
 * Se leen los dos sitios a propósito: el viejo sigue llegando de cuentas o
 * endpoints que aún no migraron, y el nuevo de los que sí. Cuando no quede
 * ninguna cuenta en versión antigua, se puede borrar la primera rama — no antes.
 */

/** Lo que llega en `event.data.object` de una factura. Sin tipar de más. */
type FacturaCruda = {
  subscription?: unknown;
  parent?: { subscription_details?: { subscription?: unknown } | null } | null;
  lines?: {
    data?: Array<{
      price?: { id?: unknown } | null;
      pricing?: { price_details?: { price?: unknown } | null } | null;
    }>;
  } | null;
};

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** El id de la suscripción (`sub_…`) de una factura, venga como venga. */
export function suscripcionDeLaFactura(obj: FacturaCruda | null | undefined): string | null {
  if (!obj) return null;
  return (
    texto(obj.subscription) ??
    texto(obj.parent?.subscription_details?.subscription)
  );
}

/** El id del precio (`price_…`) de la primera línea de una factura. */
export function precioDeLaFactura(obj: FacturaCruda | null | undefined): string | null {
  const linea = obj?.lines?.data?.[0];
  if (!linea) return null;
  return texto(linea.price?.id) ?? texto(linea.pricing?.price_details?.price);
}
