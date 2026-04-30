'use client';
import { useEffect, useRef, useState } from 'react';
import { api, getUser } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { InstallPWAButton } from '@/components/InstallPWAButton';

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function ScanPage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.push('/login');
      return;
    }
    let scanner: any;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        scanner = new Html5Qrcode('qr-reader');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          async (text: string) => {
            await verify(text);
            await scanner.stop();
          },
          () => {},
        );
      } catch {
        setErr('No se pudo acceder a la cámara. Pega el QR manualmente abajo.');
      }
    })();
    return () => {
      scanner?.stop?.().catch(() => null);
    };
  }, [router]);

  async function verify(qrToken: string) {
    setErr(null);
    setBusy(true);
    try {
      const res = await api('/scanner/verify', {
        method: 'POST',
        body: JSON.stringify({ qrToken }),
      });
      setData(res);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, amount = 1) {
    if (!data?.pass) return;
    setBusy(true);
    try {
      const res = await api('/stamps', {
        method: 'POST',
        body: JSON.stringify({
          passId: data.pass.id,
          action,
          amount,
        }),
      });
      setData({ ...data, pass: res.pass });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-md mx-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Escáner</h1>
          <InstallPWAButton className="btn-ghost text-xs" label="Instalar" />
        </div>

        {!data && (
          <>
            <div
              id="qr-reader"
              ref={containerRef}
              className="rounded-card overflow-hidden bg-ink relative"
              style={{ minHeight: 320 }}
            />
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                verify(manual);
              }}
            >
              <input
                className="input flex-1"
                placeholder="Pegar QR token manualmente"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
              <button className="btn-primary">Verificar</button>
            </form>
          </>
        )}

        {err && (
          <div className="mt-4 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}

        {data && (
          <div className="card card-pad mt-4">
            <div className="flex items-center gap-3">
              <div
                className={`avatar w-11 h-11 text-sm ${avatarClass(
                  data.pass.customer.fullName,
                )}`}
              >
                {initials(data.pass.customer.fullName)}
              </div>
              <div className="flex-1">
                <div className="font-semibold">{data.pass.customer.fullName}</div>
                <div className="text-xs text-mute">{data.pass.card.name}</div>
              </div>
              <span className="badge badge-info">Verificado</span>
            </div>

            {data.pass.card.type === 'STAMPS' && (
              <>
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {Array.from({ length: data.pass.card.stampsRequired ?? 10 }).map(
                    (_, i) => (
                      <span
                        key={i}
                        className="w-7 h-7 rounded-full border-2"
                        style={{
                          background:
                            i < data.pass.stampsCount ? '#6366F1' : 'transparent',
                          borderColor:
                            i < data.pass.stampsCount ? '#6366F1' : '#E5E7EB',
                        }}
                      />
                    ),
                  )}
                </div>
                <div className="flex items-center justify-between mt-3 text-sm">
                  <strong>
                    {data.pass.stampsCount} / {data.pass.card.stampsRequired ?? 10}
                  </strong>
                  <span className="text-mute text-xs">
                    faltan{' '}
                    {Math.max(
                      0,
                      (data.pass.card.stampsRequired ?? 10) - data.pass.stampsCount,
                    )}{' '}
                    sellos
                  </span>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-2 mt-5">
              <button
                className="btn-primary justify-center"
                disabled={busy}
                onClick={() => act('STAMP', 1)}
              >
                <Icon name="plus" /> 1 sello
              </button>
              <button
                className="btn-ghost justify-center"
                disabled={busy}
                onClick={() => act('STAMP', 5)}
              >
                + 5 sellos
              </button>
              <button
                className="btn-ghost justify-center"
                disabled={busy}
                onClick={() => act('REDEEM')}
              >
                <Icon name="gift" /> Redimir
              </button>
              <button
                className="btn-ghost justify-center"
                disabled={busy}
                onClick={() => act('VISIT')}
              >
                <Icon name="check" /> Visita
              </button>
            </div>

            <button
              className="btn-link mt-4 text-center w-full"
              onClick={() => setData(null)}
            >
              Escanear otro
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
