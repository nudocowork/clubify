'use client';
import { ListaDeLeads } from '@/components/ventas/ListaDeLeads';

/** Clientes: los leads que se ganaron. */
export default function ClientesPage() {
  return <ListaDeLeads filtro="clientes" />;
}
