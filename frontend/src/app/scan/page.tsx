'use client';
import { useEffect, useRef, useState } from 'react';
import { api, getUser } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { InstallPWAButton } from '@/components/InstallPWAButton';
import { playScanSuccess, playScanError } from '@/lib/notify';

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function ScanPage() {
  const router = useRouter();
  const scannerRef = useRef<any>(null);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);

  // Inicia (o re-inicia) el scanner. Idempotente.
  async function startScanner() {
    setErr(null);
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import(
        'html5-qrcode',
      );
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode('qr-reader', {
          // Formatos: QR + códigos de barra de wallets (PDF417 = Apple
          // Wallet, Code128/EAN13/Code39 = tarjetas físicas, etc.)
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.PDF_417,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.AZTEC,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
          ],
          verbose: false,
        });
      }
      await scannerRef.current.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (vw: number, vh: number) => {
            const minSide = Math.min(vw, vh);
            const width = Math.min(vw - 30, Math.round(minSide * 1.1));
            const height = Math.round(width * 0.4);
            return { width, height };
          },
          aspectRatio: 1.5,
        },
        async (text: string) => {
          // Detener primero para evitar callbacks duplicados
          try {
            await scannerRef.current?.stop();
          } catch {}
          setScanning(false);
          await verify(text);
        },
        () => {},
      );
      setScanning(true);
    } catch (e: any) {
      const msg = e?.message ?? '';
      setErr(
        msg.includes('permission') || e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilitalo desde el icono del candado en la URL y volvé a intentar.'
          : 'No se pudo acceder a la cámara. Pegá el código manualmente abajo.',
      );
      setScanning(false);
    }
  }

  async function stopScanner() {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.stop();
    } catch {}
    setScanning(false);
  }

  // "Escanear otro" — re-arranca la cámara sobre el mismo div
  async function scanAnother() {
    setData(null);
    setErr(null);
    setTimeout(() => startScanner(), 50);
  }

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.push('/login');
      return;
    }
    startScanner();
    return () => {
      stopScanner();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      playScanSuccess();
      // Vibración táctil corta si está disponible (Android/PWA)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(60);
        } catch {}
      }
    } catch (e: any) {
      setErr(e.message);
      playScanError();
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([80, 60, 80]);
        } catch {}
      }
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
      // El backend devuelve `pass` sin includes (solo campos del Pass).
      // Conservamos card/customer/tenant del state previo, solo
      // sobreescribimos los campos numéricos que cambiaron.
      setData({
        ...data,
        pass: {
          ...data.pass,
          stampsCount: res.pass.stampsCount,
          pointsBalance: res.pass.pointsBalance,
          status: res.pass.status,
          lastActivityAt: res.pass.lastActivityAt,
        },
      });
      playScanSuccess();
    } catch (e: any) {
      setErr(e.message);
      playScanError();
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
          <div className="text-center text-xs text-mute mb-2">
            📷 Apuntá la cámara al{' '}
            <strong className="text-ink">código de barras</strong> o QR del
            cliente. Funciona con tarjetas en Apple/Google Wallet.
          </div>
        )}

        {/* Mantenemos el div SIEMPRE montado para que el scanner no
            pierda referencia al DOM cuando se muestra el resultado. */}
        <div
          id="qr-reader"
          className="rounded-card overflow-hidden bg-ink relative"
          style={{
            minHeight: data ? 0 : 320,
            display: data ? 'none' : 'block',
          }}
        />

        {!data && err && !scanning && (
          <button
            type="button"
            className="btn-primary w-full mt-3 justify-center"
            onClick={() => startScanner()}
          >
            <Icon name="check" /> Reintentar cámara
          </button>
        )}

        {!data && (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              verify(manual);
            }}
          >
            <input
              className="input flex-1"
              placeholder="Pegar código manualmente (CLB-…)"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button className="btn-primary">Verificar</button>
          </form>
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
                            i < data.pass.stampsCount ? '#22C55E' : 'transparent',
                          borderColor:
                            i < data.pass.stampsCount ? '#22C55E' : '#E5E7EB',
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
              onClick={scanAnother}
            >
              Escanear otro
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
