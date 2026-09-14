'use client';
import { ContactosDelEquipo } from '@/components/ventas/ContactosDelEquipo';

/**
 * Contactos: la base del equipo, filtrable y trabajable en lote.
 *
 * Antes era `<ListaDeLeads filtro="contactos" />` —la lista plana con un
 * buscador—. Ahora tiene filtros, listas guardadas, acciones en lote y aviso de
 * duplicado al crear, como en TeamClubify.
 */
export default function ContactosPage() {
  return <ContactosDelEquipo />;
}
