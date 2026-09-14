'use client';
import { ImplementacionesDelEquipo } from '@/components/ventas/ImplementacionesDelEquipo';

/**
 * Clientes: la implementación de cada venta cerrada.
 *
 * Antes era `<ListaDeLeads filtro="clientes" />` —los leads ganados, la misma
 * tabla que Contactos—. Ahora es la lista de comprobación de la puesta en
 * marcha, como en TeamClubify.
 */
export default function ClientesPage() {
  return <ImplementacionesDelEquipo />;
}
