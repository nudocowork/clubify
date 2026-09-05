'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from '@/components/Toast';

/**
 * Un enlace para compartir, con su QR.
 *
 * El negocio reparte estas cosas de dos maneras y hay que darle las dos: pega
 * el enlace en un WhatsApp, o imprime el QR y lo pone en la barra. Nació en la
 * página de alianzas y se sacó aquí al necesitarlo también los eventos —
 * duplicar el bloque garantizaba que uno de los dos acabara con el QR más
 * pequeño o sin el botón de copiar.
 */
export function EnlaceConQr({
  titulo,
  nota,
  url,
  accion,
  archivo,
}: {
  titulo: string;
  nota: string;
  url?: string;
  accion?: React.ReactNode;
  /** Nombre del PNG al descargar el QR. */
  archivo: string;
}) {
  const [verQr, setVerQr] = useState(false);

  /**
   * Descarga el QR en PNG grande.
   *
   * 1024 px y corrección de errores alta: estos códigos acaban impresos en una
   * cartelera o pegados en la pared, y un QR pequeño o con poca redundancia
   * deja de leerse en cuanto se raya o se imprime mal.
   */
  async function descargar() {
    if (!url) return;
    const QR = (await import('qrcode')).default;
    const png = await QR.toDataURL(url, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'H',
    });
    const a = document.createElement('a');
    a.href = png;
    a.download = `${archivo}.png`;
    a.click();
    toast('QR descargado', 'success');
  }

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{titulo}</p>
        {accion}
      </div>
      <p className="mt-0.5 text-xs text-mute leading-snug">{nota}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          className="input font-mono text-xs min-w-0 flex-1"
          readOnly
          value={url ?? ''}
        />
        <button
          type="button"
          className="btn btn-sm shrink-0"
          disabled={!url}
          onClick={() => {
            if (!url) return;
            navigator.clipboard.writeText(url);
            toast('Enlace copiado', 'success');
          }}
        >
          Copiar
        </button>
        <button
          type="button"
          className="btn btn-sm shrink-0"
          disabled={!url}
          onClick={() => setVerQr((v) => !v)}
        >
          {verQr ? 'Ocultar QR' : 'Ver QR'}
        </button>
      </div>

      {verQr && url && (
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-input bg-bg2 p-4">
          {/* Fondo blanco siempre: sobre el gris del panel un QR pierde
              contraste y hay lectores que dejan de cogerlo. */}
          <div className="rounded-input bg-white p-3">
            <QRCodeSVG value={url} size={148} level="H" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-mute leading-snug">
              Imprímelo o pásalo por WhatsApp. Lleva al mismo sitio que el
              enlace.
            </p>
            <button type="button" className="btn btn-sm mt-2" onClick={descargar}>
              Descargar PNG
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
