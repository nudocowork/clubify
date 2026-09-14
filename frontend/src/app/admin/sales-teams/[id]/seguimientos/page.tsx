'use client';
import { SeguimientosDelEquipo } from '@/components/ventas/SeguimientosDelEquipo';

/**
 * Seguimientos: la lista de trabajo del día, por grupos.
 *
 * Antes era una tabla plana con filtro de estado y sin forma de registrar qué
 * pasó. Ahora agrupa en vencidos, para hoy y programados, y cada paso se cierra
 * con un resultado, como en TeamClubify.
 */
export default function SeguimientosPage() {
  return <SeguimientosDelEquipo />;
}
