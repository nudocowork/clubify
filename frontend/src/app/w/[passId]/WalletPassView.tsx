'use client';
import { Barcode } from '@/components/Barcode';
import { Icon } from '@/components/Icon';
import { ClubifyBadge } from '@/components/ClubifyBadge';

type Props = {
  passId: string;
  data: any;
  googleSaveUrl: string | null;
};

export function WalletPassView({ passId, data, googleSaveUrl }: Props) {
  const required = data.card.stampsRequired ?? 10;
  const stamped = data.stampsCount ?? 0;
  const stampIcon: string = data.card.stampIcon || '☕';
  // Distribuir en grid auto: si son ≤6 → una sola fila; si son más → 2 filas
  // partidas a la mitad (ej. 10 = 5+5, 8 = 4+4, 12 = 6+6).
  const rows = required > 6 ? 2 : 1;
  const perRow = Math.ceil(required / rows);

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-center gap-2.5 mb-5">
          <div
            className="w-9 h-9 rounded-lg text-white flex items-center justify-center font-bold"
            style={{ background: data.tenant.primaryColor || '#22C55E' }}
          >
            {(data.tenant.brandName[0] || 'C').toUpperCase()}
          </div>
          <div>
            <div className="font-bold leading-tight">{data.tenant.brandName}</div>
            <div className="text-xs text-mute">{data.card.name}</div>
          </div>
        </div>

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
                      padding: '14px 12px',
                    }}
                  >
                    <div
                      className="grid gap-1.5 mx-auto"
                      style={{
                        gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`,
                        maxWidth: `${perRow * 38}px`,
                      }}
                    >
                      {Array.from({ length: required }).map((_, i) => {
                        const filled = i < stamped;
                        return (
                          <div
                            key={i}
                            className="aspect-square rounded-full flex items-center justify-center text-base font-bold transition"
                            style={{
                              background: filled
                                ? 'rgba(255,255,255,.92)'
                                : 'rgba(255,255,255,.18)',
                              border: `1.5px solid rgba(255,255,255,${
                                filled ? '.95' : '.45'
                              })`,
                              color: filled ? data.card.primaryColor : 'rgba(255,255,255,.5)',
                              fontSize: required > 8 ? '14px' : '16px',
                            }}
                          >
                            {filled ? stampIcon : ''}
                          </div>
                        );
                      })}
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
                  <div className="pass-bar" style={{ flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div className="rounded-md bg-white px-3 py-2 shadow-sm w-full max-w-[220px] flex justify-center">
                      <Barcode
                        value={data.serialNumber ?? data.qrToken}
                        format="CODE128"
                        height={56}
                        width={1.3}
                        displayValue={false}
                      />
                    </div>
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
            href={`/w/${passId}/apple`}
            className="btn-primary w-full justify-center"
            style={{ background: '#000', borderColor: '#000' }}
            download
          >
            <Icon name="apple" />  Add to Apple Wallet
          </a>
          {googleSaveUrl && (
            <a
              href={googleSaveUrl}
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
        <ClubifyBadge />
      </div>
    </div>
  );
}
