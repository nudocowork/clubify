'use client';
import { BancoDelEquipo } from '@/components/ventas/BancoDelEquipo';

/**
 * Banco: la cola de CITAS por asignar y por confirmar.
 *
 * Antes era `<ListaDeLeads filtro="banco" />` —los leads sin vendedor—. En
 * TeamClubify el banco es donde quien coordina reparte las citas entre los
 * closers y persigue que el cliente confirme; es lo que se pidió.
 */
export default function BancoPage() {
  return <BancoDelEquipo />;
}
