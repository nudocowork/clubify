'use client';
/**
 * Vista previa de la tarjeta con selector de teléfono: iPhone y Android.
 *
 * El negocio solo veía la tarjeta en iPhone y tenía que adivinar el resto: en
 * Android Google Wallet la arma distinto (ver `WalletPassPreview`,
 * `plataforma="ANDROID"`).
 *
 * Hubo una pestaña «WhatsApp» con el mensaje «Te emitimos tu tarjeta…». Se
 * quitó el 2026-11-09 (Javier): la plataforma NO envía la tarjeta por WhatsApp
 * —solo el negocio, a mano, desde su propio WhatsApp— y la vista hacía creer
 * que sí. Al cliente lo único automático que le llega es la push.
 */
import { useState } from 'react';
import { WalletPassPreview, type WalletPassPreviewProps } from '@/components/WalletPassPreview';

type Plataforma = 'IPHONE' | 'ANDROID';

const PESTANAS: Array<{ id: Plataforma; label: string }> = [
  { id: 'IPHONE', label: 'iPhone' },
  { id: 'ANDROID', label: 'Android' },
];

export function VistaPreviaPorPlataforma(props: Omit<WalletPassPreviewProps, 'plataforma' | 'bare'>) {
  const [plataforma, setPlataforma] = useState<Plataforma>('IPHONE');

  return (
    <div className="flex flex-col items-center gap-3">
      <div role="tablist" aria-label="Ver la tarjeta en" className="bg-bg2 rounded-full p-0.5 flex text-xs font-semibold">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={plataforma === p.id}
            onClick={() => setPlataforma(p.id)}
            className={`px-3 py-1.5 rounded-full transition ${
              plataforma === p.id ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <WalletPassPreview {...props} plataforma={plataforma} />
    </div>
  );
}
