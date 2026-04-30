'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function WalletPage() {
  const { passId } = useParams<{ passId: string }>();
  const [data, setData] = useState<any>(null);
  const [google, setGoogle] = useState<string | null>(null);

  useEffect(() => {
    api(`/passes/${passId}/public`).then(setData).catch(() => null);
    api<{ saveUrl: string }>(`/passes/${passId}/google`)
      .then((r) => setGoogle(r.saveUrl))
      .catch(() => null);
  }, [passId]);

  if (!data) return <div className="p-6 text-mute">Cargando…</div>;

  const required = data.card.stampsRequired ?? 10;
  const stamped = data.stampsCount ?? 0;
  const visibleStamps = Math.min(required, 7);
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-center gap-2.5 mb-5">
          <div
            className="w-9 h-9 rounded-lg text-white flex items-center justify-center font-bold"
            style={{ background: data.tenant.primaryColor || '#6366F1' }}
          >
            {(data.tenant.brandName[0] || 'C').toUpperCase()}
          </div>
          <div>
            <div className="font-bold leading-tight">{data.tenant.brandName}</div>
            <div className="text-xs text-mute">{data.card.name}</div>
          </div>
        </div>

        {/* iPhone frame */}
        <div className="flex justify-center">
          <div className="iphone">
            <div className="iphone-notch" />
            <div className="iphone-screen">
              <div className="iphone-bar">
                <span>
                  {new Date().toLocaleTimeString('es-CO', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="text-[10px]">●●● 100%</span>
              </div>
              <div className="wallet-actions">
                <span className="wallet-ok">OK</span>
                <span className="text-mute2 text-xs">↑ ···</span>
              </div>
              <div className="mx-2 mb-2">
                <div
                  className="pass"
                  style={{
                    background: `linear-gradient(135deg, ${data.card.primaryColor}, ${data.card.secondaryColor})`,
                  }}
                >
                  <div className="pass-head">
                    <div className="pass-logo">
                      <span className="pass-logo-mark">
                        {(data.tenant.brandName[0] || 'C').toUpperCase()}
                      </span>{' '}
                      {data.tenant.brandName}
                    </div>
                    <div className="pass-side">
                      <div className="pass-side-lbl">SELLOS</div>
                      <div className="pass-side-val">
                        {stamped}/{required}
                      </div>
                    </div>
                  </div>
                  <div
                    className="pass-strip"
                    style={{
                      background:
                        'linear-gradient(135deg,rgba(0,0,0,.15),rgba(0,0,0,.05))',
                    }}
                  >
                    <div className="strip-stamps">
                      {Array.from({ length: visibleStamps }).map((_, i) => (
                        <div
                          key={i}
                          className={`strip-stamp ${i < stamped ? 'full' : ''}`}
                          style={{
                            color: i < stamped ? data.card.primaryColor : '#fff',
                          }}
                        >
                          {i < stamped ? '✓' : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="pass-fields">
                    <div>
                      <div className="pf-lbl">TITULAR</div>
                      <div className="pf-val">
                        {data.customer.fullName.toUpperCase()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="pf-lbl">RECOMPENSA</div>
                      <div className="pf-val text-xs">{data.card.rewardText}</div>
                    </div>
                  </div>
                  <div className="pass-bar">
                    <QRCodeCanvas value={data.qrToken} size={150} />
                    <div className="pager">
                      <span className="pager-dot" />
                      <span className="pager-dot on" />
                      <span className="pager-dot" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 mt-6">
          <a
            href={`${apiBase}/api/passes/${passId}/apple.pkpass`}
            className="btn-primary w-full justify-center"
            style={{ background: '#000', borderColor: '#000' }}
            download
          >
            <Icon name="apple" />  Add to Apple Wallet
          </a>
          {google && (
            <a
              href={google}
              className="btn-ghost w-full justify-center"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="google" /> Save to Google Wallet
            </a>
          )}
        </div>

        {data.card.terms && (
          <div className="card card-pad mt-6">
            <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold">
              Condiciones
            </div>
            <div className="text-sm mt-2 leading-relaxed">{data.card.terms}</div>
          </div>
        )}
      </div>
    </div>
  );
}
