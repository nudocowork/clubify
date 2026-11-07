'use client';
/**
 * Vista previa de la tarjeta con selector de teléfono: iPhone, Android y
 * WhatsApp.
 *
 * El negocio solo veía la tarjeta en iPhone y tenía que adivinar el resto: en
 * Android Google Wallet la arma distinto (ver `WalletPassPreview`,
 * `plataforma="ANDROID"`), y lo primero que ve su cliente casi siempre es el
 * mensaje de WhatsApp con el enlace, no la tarjeta.
 *
 * La pestaña WhatsApp copia lo que de verdad llega:
 *  · el texto que arma `passes.service.ts` al emitir («¡Hola, Ana! Te emitimos
 *    tu tarjeta «…» de …. Ábrela aquí…»);
 *  · la vista previa del enlace que pinta WhatsApp con el `og:title`
 *    («{tarjeta} · {negocio}») y el `og:description` de `app/w/[passId]/layout.tsx`.
 *    No lleva imagen grande porque esa página no publica `og:image`; si algún
 *    día la publica, esta vista tiene que cambiar con ella.
 */
import { useEffect, useState } from 'react';
import { WalletPassPreview, type WalletPassPreviewProps } from '@/components/WalletPassPreview';

type Plataforma = 'IPHONE' | 'ANDROID' | 'WHATSAPP';

const PESTANAS: Array<{ id: Plataforma; label: string }> = [
  { id: 'IPHONE', label: 'iPhone' },
  { id: 'ANDROID', label: 'Android' },
  { id: 'WHATSAPP', label: 'WhatsApp' },
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

      {plataforma === 'WHATSAPP' ? (
        <WhatsappPreview
          brandName={props.brandName}
          brandLogoUrl={props.brandLogoUrl}
          cardName={props.cardName}
          primaryColor={props.primaryColor}
          customerName={props.customerName}
          size={props.size}
        />
      ) : (
        <WalletPassPreview {...props} plataforma={plataforma} />
      )}
    </div>
  );
}

function WhatsappPreview({
  brandName,
  brandLogoUrl,
  cardName,
  primaryColor,
  customerName,
  size = 'md',
}: {
  brandName: string;
  brandLogoUrl?: string | null;
  cardName: string;
  primaryColor: string;
  customerName?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  // El enlace sale con el dominio desde el que se abrió el panel: es el de la
  // marca del negocio (mismo criterio que `issuedPass` en la ficha de la tarjeta).
  const [host, setHost] = useState('');
  useEffect(() => setHost(window.location.host), []);

  const negocio = brandName?.trim() || 'tu negocio';
  const tarjeta = cardName?.trim() || 'Tu tarjeta';
  const enlace = `https://${host || 'tu-dominio'}/w/…`;
  // Mismo saludo que arma el backend: el nombre de pila, o «¡Hola!» a secas.
  const pila = (customerName ?? '').trim().split(/\s+/)[0] ?? '';
  const saludo = pila ? `¡Hola, ${pila.charAt(0).toUpperCase()}${pila.slice(1).toLowerCase()}!` : '¡Hola!';
  const inicial = (brandName?.[0] || '·').toUpperCase();
  const ancho = size === 'sm' ? 'w-[200px]' : size === 'lg' ? 'w-[300px]' : 'w-[260px]';

  return (
    <div
      className={`${ancho} mx-auto`}
      style={{
        background: '#0F172A',
        borderRadius: 38,
        padding: 8,
        boxShadow: '0 30px 60px -15px rgba(15, 23, 42, 0.35), 0 0 0 1px #1E293B, 0 0 0 4px #0B1220',
      }}
    >
      <div className="rounded-[30px] overflow-hidden flex flex-col" style={{ minHeight: 500, background: '#EFEAE2' }}>
        {/* Cabecera del chat: el cliente ve el WhatsApp del NEGOCIO. */}
        <div className="flex items-center gap-2 px-3 pt-7 pb-2" style={{ background: '#F0F2F5' }}>
          <span className="text-[#54656F] text-sm leading-none">‹</span>
          <div
            className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ background: primaryColor }}
          >
            {brandLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandLogoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              inicial
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-[#111B21] truncate">{negocio}</div>
            <div className="text-[10px] text-[#667781]">en línea</div>
          </div>
        </div>

        <div className="flex-1 px-2.5 py-3 flex flex-col justify-end">
          {/* Mensaje saliente del negocio, con la vista previa del enlace encima. */}
          <div className="ml-auto max-w-[92%] rounded-lg rounded-tr-none p-1 shadow-sm" style={{ background: '#D9FDD3' }}>
            <div className="rounded-md overflow-hidden flex gap-2 p-2" style={{ background: '#CFF3C6' }}>
              <div
                className="w-10 h-10 rounded-md overflow-hidden shrink-0 flex items-center justify-center text-white text-sm font-bold"
                style={{ background: primaryColor }}
              >
                {brandLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brandLogoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  inicial
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-[#111B21] leading-snug line-clamp-2">
                  {tarjeta} · {negocio}
                </div>
                <div className="text-[10px] text-[#667781] leading-snug line-clamp-2 mt-0.5">
                  Tu tarjeta wallet en {negocio}. Suma sellos y reclama tu premio.
                </div>
                <div className="text-[9px] text-[#667781] mt-0.5 truncate">{host || 'tu-dominio'}</div>
              </div>
            </div>
            <p className="text-[11.5px] text-[#111B21] leading-snug px-1.5 pt-1.5 m-0 break-words">
              {saludo} Te emitimos tu tarjeta «{tarjeta}» de {negocio}. Ábrela aquí para guardarla en tu
              teléfono: <span className="text-[#027EB5]">{enlace}</span>
            </p>
            <div className="text-right text-[9px] text-[#667781] px-1.5 pb-0.5">
              11:42 <span className="text-[#53BDEB]">✓✓</span>
            </div>
          </div>
          <p className="text-center text-[10px] text-[#667781] mt-3 mb-0">
            Al tocar el enlace, tu cliente guarda la tarjeta en su Wallet.
          </p>
        </div>
      </div>
    </div>
  );
}
