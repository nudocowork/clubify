'use client';
// Botón de descarga del PDF de cotización. Usa @react-pdf/renderer en
// modo imperativo (pdf(...).toBlob) y dispara la descarga manualmente —
// preferimos esto sobre <PDFDownloadLink> porque permite manejar errores
// con toasts y mostrar estado de loading consistente con el resto del panel.

import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { QuotePDF, type QuotePDFProps } from '@/components/QuotePDF';

type Props = QuotePDFProps & {
  /** Texto del botón. Default "Descargar PDF". */
  label?: string;
  /** Clase tailwind extra. Default "btn-primary". */
  className?: string;
  /** Si true, renderiza solo el ícono (uso en tablas). */
  iconOnly?: boolean;
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function DownloadQuotePDFButton({
  label = 'Descargar PDF',
  className = 'btn-primary',
  iconOnly = false,
  ...quoteProps
}: Props) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const doc = <QuotePDF {...quoteProps} />;
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = (quoteProps.date ?? new Date()).toISOString().slice(0, 10);
      a.href = url;
      a.download = `clubify-cotizacion-${slugify(quoteProps.businessName)}-${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('PDF generado', 'success');
    } catch (e: any) {
      console.error(e);
      toast(e?.message || 'No se pudo generar el PDF', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        className={`btn-ghost ${busy ? 'opacity-60' : ''}`}
        onClick={download}
        disabled={busy}
        title={label}
      >
        <Icon name="send" />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`${className} ${busy ? 'opacity-70 cursor-wait' : ''}`}
      onClick={download}
      disabled={busy}
    >
      <Icon name="send" />
      {busy ? 'Generando…' : label}
    </button>
  );
}
