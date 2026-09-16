'use client';

import { enlaceDeWhatsapp, mensajeDeWhatsapp } from '@/lib/whatsapp-del-equipo';

/**
 * «WhatsApp» con el mensaje del equipo ya escrito (lo pone «Configuración»).
 *
 * Lo usan el Banco y Seguimientos. Sin un teléfono que lo parezca no se pinta:
 * un botón que abre un WhatsApp sin destinatario confunde más que no tenerlo.
 */
export function BotonDeWhatsapp({
  telefono,
  plantilla,
  nombre,
  closer,
  equipo,
  sala,
  className,
}: {
  telefono: string | null | undefined;
  plantilla: string | null | undefined;
  nombre?: string | null;
  closer?: string | null;
  equipo?: string | null;
  /** Enlace de la sala de la reunión, para {{sala}}. */
  sala?: string | null;
  className?: string;
}) {
  const href = enlaceDeWhatsapp(telefono, mensajeDeWhatsapp(plantilla, { nombre, closer, equipo, sala }) || undefined);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" title="Escribir por WhatsApp con el mensaje del equipo" className={className}>
      WhatsApp
    </a>
  );
}
