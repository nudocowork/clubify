'use client';

import { useState } from 'react';

type Props = {
  publicToken: string;
  businessName: string;
  /** Plan único Elite — incluido en el mensaje pre-armado de share. */
  planLabel: 'Elite';
  /** Color acento del template para el botón share. */
  accent: string;
};

/**
 * Acciones del cliente en la vista pública /q/<token>:
 *  - Compartir con su equipo via WhatsApp (genérico, sin destinatario fijo).
 *  - Imprimir / guardar como PDF via window.print().
 *
 * Se renderiza como banda inline (no sticky) entre el hero y la sección
 * template. Tiene la clase `print-hide` para no aparecer en el PDF
 * impreso. Los estilos de print viven en globals.css.
 */
export function QuotePublicActions({
  publicToken,
  businessName,
  planLabel,
  accent,
}: Props) {
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/q/${publicToken}`
      : `https://soyclubify.com/q/${publicToken}`;

  const shareMsg = `Mira la propuesta de Clubify para ${businessName} (plan ${planLabel}): ${url}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;

  function doPrint() {
    if (typeof window !== 'undefined') window.print();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="print-hide flex flex-wrap items-center justify-center gap-2 px-5 max-w-3xl mx-auto mt-8">
      <a
        href={waHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-pill bg-white border border-line text-xs font-semibold text-ink shadow-sm hover:border-emerald-400 hover:text-emerald-700 active:scale-[0.97] transition"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.711.306 1.265.489 1.697.626.713.226 1.362.194 1.875.118.572-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413z" />
        </svg>
        Compartir con mi equipo
      </a>

      <button
        type="button"
        onClick={doPrint}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-pill bg-white border border-line text-xs font-semibold text-ink shadow-sm hover:border-ink/40 active:scale-[0.97] transition"
        title="Imprimí o guarda como PDF desde el diálogo del navegador"
      >
        🖨 Imprimir / Guardar PDF
      </button>

      <button
        type="button"
        onClick={copyLink}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-pill bg-white border border-line text-xs font-semibold text-ink shadow-sm hover:border-ink/40 active:scale-[0.97] transition"
        style={copied ? { borderColor: accent, color: accent } : undefined}
      >
        {copied ? '✓ Link copiado' : '🔗 Copiar link'}
      </button>
    </div>
  );
}
