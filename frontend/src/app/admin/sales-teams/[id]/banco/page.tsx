'use client';
import { ListaDeLeads } from '@/components/ventas/ListaDeLeads';

/** Banco: los leads que todavía no tiene ningún vendedor. */
export default function BancoPage() {
  return <ListaDeLeads filtro="banco" />;
}
