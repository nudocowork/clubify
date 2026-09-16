'use client';

import { useParams } from 'next/navigation';
import { AgendaDelDia } from '@/components/ventas/AgendaDelDia';

/**
 * La pestaña Agenda del equipo: la cuadrícula del día, como en TeamClubify.
 *
 * Aquí estaban también el enlace público, el horario, los ajustes y «Próximas
 * citas». La referencia no los tiene en esta pestaña: el enlace, el horario y los
 * ajustes son ahora de cada agenda de reserva, en «Configuración», y las citas
 * por repartir o confirmar viven en el Banco.
 *
 * El panel del afiliado monta esta misma página (`/affiliate/equipos/[id]/agenda`).
 */
export default function AgendaDelEquipo() {
  const params = useParams<{ id: string }>();
  return <AgendaDelDia teamId={params?.id ?? ''} />;
}
