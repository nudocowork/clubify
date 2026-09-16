'use client';

/**
 * El adjunto de una propuesta, pintado.
 *
 * Antes solo había un enlace «📎 Ver adjunto»: para ver la pantalla que te
 * están enseñando había que abrir otra pestaña. Ahora la imagen y el video se
 * ven en el sitio —en la propuesta y en la moderación— porque es justo lo que
 * se mira para entender lo que se pide.
 *
 * Solo se pinta `http(s)`. El backend ya lo valida al guardar
 * (`lab-adjuntos.ts`), pero las propuestas viejas se guardaron sin ese candado
 * y un `javascript:` en el `href` sería un XSS servido desde nuestro panel.
 */

function esEnlaceSeguro(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** El tipo guardado es una pista; si falta, se deduce de la extensión. */
function claseDe(url: string, kind: string | null | undefined): string {
  const declarado = (kind ?? '').toLowerCase();
  if (['image', 'video', 'pdf', 'document'].includes(declarado)) return declarado;
  const ruta = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/\.(png|jpe?g|webp|gif)$/.test(ruta)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(ruta)) return 'video';
  if (/\.pdf$/.test(ruta)) return 'pdf';
  return 'document';
}

export function AdjuntoLab({
  url,
  kind,
  compacto = false,
}: {
  url: string | null | undefined;
  kind?: string | null;
  /** En la lista de la moderación: miniatura, no el adjunto a tamaño completo. */
  compacto?: boolean;
}) {
  if (!url || !esEnlaceSeguro(url)) return null;
  const clase = claseDe(url, kind);

  if (compacto) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 no-underline"
        title="Ver el adjunto"
      >
        {clase === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Adjunto de la propuesta"
            className="w-16 h-16 rounded-lg object-cover border border-line bg-bg2"
            loading="lazy"
          />
        ) : (
          <span className="w-16 h-16 rounded-lg border border-line bg-bg2 flex items-center justify-center text-xl">
            {clase === 'video' ? '🎬' : '📎'}
          </span>
        )}
      </a>
    );
  }

  return (
    <div className="mt-4">
      {clase === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Adjunto de la propuesta"
          className="rounded-xl border border-line max-h-96 w-auto max-w-full object-contain bg-bg2"
          loading="lazy"
        />
      )}
      {clase === 'video' && (
        <video
          src={url}
          controls
          preload="metadata"
          className="rounded-xl border border-line max-h-96 w-full bg-ink"
        />
      )}
      <div className="mt-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-brand text-sm hover:underline"
        >
          📎 {clase === 'video' ? 'Abrir el video' : clase === 'image' ? 'Abrir la imagen' : 'Ver adjunto'}
        </a>
      </div>
    </div>
  );
}
