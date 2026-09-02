/**
 * /superadmin/living-card — redirección (2026-09-01).
 *
 * Acá vivía el editor de la campaña "Living Card". Era el editor de UNA sola
 * cuponera —la primera— porque los endpoints `/cuponera/admin/*` que usaba
 * llaman `ensureLivingCampaign()` por dentro: aunque se abriera desde otra
 * cuponera, habría editado siempre esa. Con varias cuponeras en el producto,
 * dos entradas en el menú para lo mismo confundían más de lo que ayudaban.
 *
 * Todo lo que tenía está ahora en /superadmin/cuponeras → «Entrar al panel»,
 * que abre /cuponera/admin?campaignId=<id>, scopeado por campaña de verdad.
 * Lo último que faltaba —diseño de la tarjeta Wallet, MercadoPago y el mapeo
 * a Hotmart/Stripe— se portó al panel en ese mismo cambio.
 *
 * La ruta se deja viva porque estaba en el menú desde junio y hay marcadores
 * apuntando acá. El contenido está en git si hiciera falta mirarlo.
 */
import { redirect } from 'next/navigation';

export default function LivingCardRedirect() {
  redirect('/superadmin/cuponeras');
}
