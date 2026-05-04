'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const TEMPLATES = [
  {
    id: 'minimal',
    name: 'Minimal',
    bg: '#FFFFFF',
    text: '#0a0a0a',
    accent: '#22C55E',
  },
  {
    id: 'brand',
    name: 'Brand',
    bg: 'linear-gradient(135deg,#22C55E,#4ADE80)',
    text: '#FFFFFF',
    accent: '#FFFFFF',
  },
  {
    id: 'ink',
    name: 'Ink',
    bg: '#0a0a0a',
    text: '#FFFFFF',
    accent: '#FBBF24',
  },
  {
    id: 'warm',
    name: 'Warm',
    bg: 'linear-gradient(135deg,#FB923C,#EC4899)',
    text: '#FFFFFF',
    accent: '#FFFFFF',
  },
];

const HEADLINES: { id: string; line1: string; line2: string }[] = [
  { id: 'menu', line1: 'Escanea para ver', line2: 'el menú y pedir' },
  { id: 'card', line1: 'Suma sellos', line2: 'gratis con cada pedido' },
  { id: 'order', line1: 'Pide desde tu mesa', line2: 'sin esperar al mesero' },
  { id: 'wifi', line1: 'Escanéame', line2: 'y recibe tu pedido por WhatsApp' },
];

export default function QRPoster() {
  const [tenant, setTenant] = useState<any>(null);
  const [template, setTemplate] = useState(TEMPLATES[0]);
  const [headline, setHeadline] = useState(HEADLINES[0]);
  // Logo Clubify siempre visible (parte de la marca, no removible)
  const showLogo = true;
  const [tableNum, setTableNum] = useState('');

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
  }, []);

  if (!tenant) return <div className="text-mute">Cargando…</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const url = `${origin}/m/${slug}${tableNum ? `?mesa=${tableNum}` : ''}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=2&data=${encodeURIComponent(url)}`;

  return (
    <div>
      <div className="page-head print-hide">
        <h1 className="page-title">
          <Link href="/app/storefront" className="text-mute hover:text-ink">
            Mi sitio
          </Link>{' '}
          <span className="page-crumb">/ Cartel QR</span>
        </h1>
        <button onClick={() => window.print()} className="btn-primary">
          🖨 Imprimir / Guardar PDF
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 print-hide">
        {/* Controles */}
        <div className="space-y-4">
          <div className="card card-pad">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
              Estilo
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t)}
                  className={`rounded-lg p-2 text-xs font-medium border-2 transition ${
                    template.id === t.id
                      ? 'border-brand'
                      : 'border-line hover:border-mute'
                  }`}
                  style={{
                    background: t.bg,
                    color: t.text,
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
              Mensaje
            </div>
            <div className="space-y-1">
              {HEADLINES.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setHeadline(h)}
                  className={`w-full text-left text-xs px-3 py-2 rounded-lg ${
                    headline.id === h.id
                      ? 'bg-brand-soft text-brand-700 font-semibold'
                      : 'bg-bg2/50 hover:bg-bg2'
                  }`}
                >
                  <div>{h.line1}</div>
                  <div className="text-mute">{h.line2}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <label className="label">Número de mesa (opcional)</label>
            <input
              type="text"
              value={tableNum}
              onChange={(e) => setTableNum(e.target.value)}
              placeholder="ej: 5"
              className="input text-sm"
              maxLength={6}
            />
            <p className="text-[11px] text-mute mt-1.5">
              Si imprimes uno por mesa, agrega el número aquí. El cliente lo
              verá pre-rellenado al ordenar.
            </p>
          </div>

          <div className="text-[11px] text-mute">
            💡 Tip: imprime en cartulina, agrégale tape transparente y pégalo
            en cada mesa. Si quieres uno por mesa con número distinto, cambia
            el número antes de cada impresión.
          </div>
        </div>

        {/* Preview */}
        <div className="flex justify-center">
          <div className="bg-bg2/40 p-8 rounded-2xl">
            <Poster
              template={template}
              headline={headline}
              brandName={tenant.brandName ?? 'Mi Negocio'}
              url={url}
              qrSrc={qrSrc}
              tableNum={tableNum}
              showLogo={showLogo}
              preview
            />
          </div>
        </div>
      </div>

      {/* Versión imprimible — solo visible en print */}
      <div className="poster-print-only">
        <Poster
          template={template}
          headline={headline}
          brandName={tenant.brandName ?? 'Mi Negocio'}
          url={url}
          qrSrc={qrSrc}
          tableNum={tableNum}
          showLogo={showLogo}
        />
      </div>
    </div>
  );
}

function Poster({
  template,
  headline,
  brandName,
  url,
  qrSrc,
  tableNum,
  showLogo,
  preview,
}: {
  template: (typeof TEMPLATES)[number];
  headline: (typeof HEADLINES)[number];
  brandName: string;
  url: string;
  qrSrc: string;
  tableNum: string;
  showLogo: boolean;
  preview?: boolean;
}) {
  return (
    <div
      className={`poster ${preview ? 'poster-preview' : ''}`}
      style={{
        background: template.bg,
        color: template.text,
      }}
    >
      <div className="poster-brand">{brandName}</div>
      {tableNum && (
        <div
          className="poster-table"
          style={{ background: template.accent, color: template.bg.includes('gradient') ? template.text : template.bg }}
        >
          MESA {tableNum}
        </div>
      )}
      <div className="poster-headline">
        <div className="poster-line1">{headline.line1}</div>
        <div className="poster-line2" style={{ color: template.accent }}>
          {headline.line2}
        </div>
      </div>
      <div className="poster-qr-wrap" style={{ background: '#fff' }}>
        <img src={qrSrc} alt="QR" className="poster-qr" />
      </div>
      <div className="poster-arrow" style={{ color: template.accent }}>
        ↑
      </div>
      <div className="poster-url">{url.replace(/^https?:\/\//, '')}</div>
      {showLogo && (
        <div
          className="poster-foot"
          style={{ opacity: template.bg === '#FFFFFF' ? 0.5 : 0.7 }}
        >
          Powered by Clubify
        </div>
      )}
    </div>
  );
}
