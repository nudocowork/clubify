import type { Metadata } from 'next';
import { SelleaLanding } from '@/components/sellea/SelleaLanding';

/**
 * Landing de marketing de Sellea (marca blanca) — réplica de la de Clubify
 * con la identidad de Sellea (manual v1.0): paleta coral / tinta / crema,
 * Poppins, voz "Cada compra deja su sello".
 *
 * Preview: /sellea  ·  Producción futura: www.selleala.com.
 * ⚠️ El logo es una aproximación SVG — reemplazar por el asset oficial.
 */
export const metadata: Metadata = {
  title: 'Sellea · Tarjetas de fidelización en Apple y Google Wallet',
  description:
    'Sistema de fidelización digital. Sellos, cupones y recompensas en el wallet del cliente, menús con IA e InfoLinks. Cada compra deja su sello.',
};

export default function Page() {
  return <SelleaLanding />;
}
