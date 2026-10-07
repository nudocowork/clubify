/**
 * Sube la imagen de portada de una sección (o de un evento de reservas) y
 * devuelve la URL pública. Es el `onUpload` del SectionCoverEditor.
 *
 * Pasa por `subirArchivo`: el peso y el formato se comprueban con la política
 * de PORTADA antes de transmitir, y el servidor publica el maestro optimizado
 * (antes el tope era «15 MB» binarios y el error llegaba como JSON crudo).
 */
import { subirArchivo } from '@/lib/subir-archivo';

/** Sube un File y devuelve la URL pública. Lanza un Error con el motivo en español. */
export async function uploadCoverImage(file: File, folder = 'sections'): Promise<string> {
  const r = await subirArchivo(file, { uso: 'PORTADA', folder });
  if (!r.url) throw new Error('El servidor no devolvió la URL de la imagen.');
  return r.url;
}
