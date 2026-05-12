'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Props = {
  publicToken: string;
  customerName: string;
  businessName: string;
  /** WhatsApp del cliente sin formato — usado para abrir wa.me directo
   *  con el chat ya abierto. Si no hay, el botón abre un wa.me genérico
   *  donde el asesor elige al destinatario. */
  customerPhone?: string | null;
  /** Email del cliente — habilita el botón Email con mailto pre-armado. */
  customerEmail?: string | null;
  /** Plan cotizado — incluido en el mensaje pre-armado. */
  planLabel: 'Elite' | 'Pro';
  /** Override opcional del origin (útil para testing). En prod usa
   *  window.location.origin → soyclubify.com / app.soyclubify.com / etc. */
  origin?: string;
  variant?: 'inline' | 'card';
};

export function ShareQuoteButtons({
  publicToken,
  customerName,
  businessName,
  customerPhone,
  customerEmail,
  planLabel,
  origin,
  variant = 'inline',
}: Props) {
  const [copied, setCopied] = useState(false);

  // Construimos el URL público en client para que respete el host actual
  // (soyclubify.com en prod, localhost en dev). El servidor no conoce el host.
  const publicUrl =
    typeof window !== 'undefined'
      ? `${origin ?? window.location.origin}/q/${publicToken}`
      : `https://soyclubify.com/q/${publicToken}`;

  // Mensaje pre-armado — primer nombre del cliente para que se sienta personal
  // sin invadir. Plan visible para que el cliente reconozca de qué se trata
  // antes de abrir el link.
  const firstName = customerName.split(' ')[0] || customerName;
  const message = `Hola ${firstName}! Te dejo la cotización del plan ${planLabel} de Clubify para ${businessName}: ${publicUrl}`;

  const waPhone = (customerPhone ?? '').replace(/\D/g, '');
  const waHref = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  const mailSubject = `Tu cotización ${planLabel} de Clubify`;
  const mailBody = `Hola ${firstName},\n\nTe comparto la cotización del plan ${planLabel} de Clubify para ${businessName}:\n\n${publicUrl}\n\nQuedo atento a tus comentarios.`;
  const mailHref = customerEmail
    ? `mailto:${customerEmail}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`
    : null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      toast('Link copiado', 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('No se pudo copiar — copialo manualmente', 'error');
    }
  }

  const wrapperCls =
    variant === 'card'
      ? 'card card-pad space-y-2.5'
      : 'flex flex-wrap gap-2 items-center';

  return (
    <div className={wrapperCls}>
      {variant === 'card' && (
        <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold">
          Compartir cotización
        </div>
      )}
      <a
        href={waHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-pill text-white text-xs font-semibold shadow-sm hover:opacity-90 active:scale-[0.97] transition"
        style={{ background: '#25D366' }}
        title={
          waPhone
            ? `Enviar a ${customerPhone}`
            : 'Abrir WhatsApp y elegir destinatario'
        }
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.711.306 1.265.489 1.697.626.713.226 1.362.194 1.875.118.572-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413z" />
        </svg>
        WhatsApp
      </a>

      {mailHref && (
        <a
          href={mailHref}
          className="btn-ghost text-xs"
          title={`Email a ${customerEmail}`}
        >
          <Icon name="send" size={14} /> Email
        </a>
      )}

      <button
        type="button"
        onClick={copyLink}
        className="btn-ghost text-xs"
        title="Copiar link al portapapeles"
      >
        <Icon name={copied ? 'check' : 'clipboard'} size={14} />
        {copied ? '¡Copiado!' : 'Copiar link'}
      </button>

      {variant === 'card' && (
        <div
          className="text-[11px] text-mute font-mono break-all bg-bg2/40 rounded px-2 py-1.5"
          title="Vista pública del cliente"
        >
          {publicUrl.replace(/^https?:\/\//, '')}
        </div>
      )}
    </div>
  );
}
