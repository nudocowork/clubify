/**
 * El WhatsApp con el que el closer escribe a un contacto, del lado de la
 * pantalla.
 *
 * `mensajeDeWhatsapp` es copia de la de `backend/src/sales-teams/configuracion-de-equipo.ts`
 * (el frontend no puede importar el backend). Si cambias una, cambia la otra.
 */

/**
 * El texto con el que se abre WhatsApp. Admite {{nombre}}, {{closer}},
 * {{equipo}} y {{sala}} (el enlace de Google Meet de la cita). La plantilla la manda el servidor ya resuelta (la del equipo o la
 * de siempre).
 */
export function mensajeDeWhatsapp(
  plantilla: string | null | undefined,
  vars: { nombre?: string | null; closer?: string | null; equipo?: string | null; sala?: string | null },
): string {
  const t = (typeof plantilla === 'string' && plantilla.trim()) || '';
  return t
    .replace(/\{\{\s*nombre\s*\}\}/gi, () => (vars.nombre ?? '').trim())
    .replace(/\{\{\s*closer\s*\}\}/gi, () => (vars.closer ?? '').trim())
    .replace(/\{\{\s*equipo\s*\}\}/gi, () => (vars.equipo ?? '').trim())
    .replace(/\{\{\s*sala\s*\}\}/gi, () => (vars.sala ?? '').trim())
    // Sin nombre, «Hola , ¿cómo estás?» se lee roto.
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Enlace `wa.me` al chat del contacto. Solo dígitos, como el resto del producto
 * (`EntregarTarjeta`): wa.me rechaza espacios, guiones y el «+». Sin un número
 * que parezca un teléfono, null: un botón que abre un WhatsApp vacío confunde.
 */
export function enlaceDeWhatsapp(telefono: string | null | undefined, texto?: string): string | null {
  const digitos = (telefono ?? '').replace(/\D/g, '');
  if (digitos.length < 7) return null;
  return texto ? `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}` : `https://wa.me/${digitos}`;
}
