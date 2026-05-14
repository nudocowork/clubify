/**
 * Helper para subir imágenes de portada de sección a R2 via el
 * endpoint /api/media/upload. Mismo flow que ImageUploader pero con
 * API funcional para usar como `onUpload` del SectionCoverEditor.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

function getToken(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(^|;\s*)clubify_token=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

/** Sube un File a R2 y devuelve la URL pública. Throws si falla. */
export async function uploadCoverImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Solo imágenes (JPG/PNG/WebP)');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Máximo 5 MB');
  }
  const fd = new FormData();
  fd.append('file', file, file.name);
  const headers: HeadersInit = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}/api/media/upload?folder=sections`, {
    method: 'POST',
    headers,
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  const data: { url: string } = await res.json();
  if (!data.url) throw new Error('Respuesta sin URL');
  return data.url;
}
