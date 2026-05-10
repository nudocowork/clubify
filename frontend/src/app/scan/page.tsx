'use client';
import { useEffect, useRef, useState } from 'react';
import { api, getUser, setSession, clearSession } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { InstallPWAButton } from '@/components/InstallPWAButton';
import { playScanSuccess, playScanError } from '@/lib/notify';

const SCANNER_SESSION_HOURS = 6;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

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
  // Sesión: si no hay user, mostrar login inline (no redirect a /login,
  // así el staff con dispositivo del local no sale del scan)
  const [user, setUser] = useState<any>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  // Modal "agregar más sellos" (requiere PIN del super admin)
  const [showMoreModal, setShowMoreModal] = useState(false);
  const [moreForm, setMoreForm] = useState({ amount: 2, pin: '' });
  const [moreErr, setMoreErr] = useState<string | null>(null);
  // Modal de compra: aparece al tocar "Agregar sello / Registrar visita".
  // Pide el monto pagado (regla de negocio: 1 scan = 1 sello, monto solo
  // informativo para analytics). Si action=VISIT, el botón dice "registrar visita".
  const [showPurchase, setShowPurchase] = useState<null | 'STAMP' | 'VISIT'>(null);
  const [purchaseAmount, setPurchaseAmount] = useState<string>('');
  const [purchaseErr, setPurchaseErr] = useState<string | null>(null);

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
    setUser(u);
    if (!u) return; // muestra login inline en vez de redirect
    startScanner();
    return () => {
      stopScanner();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(null);
    setLoggingIn(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginForm.email.trim(),
          password: loginForm.password,
          scope: 'scanner', // backend firma JWT 6h en vez del default
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || 'Credenciales inválidas');
      setSession(body.accessToken, body.user, {
        maxAgeSeconds: SCANNER_SESSION_HOURS * 3600,
      });
      setUser(body.user);
      setLoginForm({ email: '', password: '' });
      // Iniciar scanner después del login
      setTimeout(() => startScanner(), 50);
    } catch (e: any) {
      setLoginErr(e.message || 'Error de login');
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    if (!confirm('¿Cerrar sesión del escáner?')) return;
    await stopScanner();
    clearSession();
    setUser(null);
    setData(null);
    setErr(null);
  }

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

  async function act(
    action: string,
    amount = 1,
    pin?: string,
    purchaseAmount?: number,
  ) {
    if (!data?.pass) return;
    setBusy(true);
    try {
      const res = await api('/stamps', {
        method: 'POST',
        body: JSON.stringify({
          passId: data.pass.id,
          action,
          amount,
          ...(pin ? { pin } : {}),
          ...(purchaseAmount !== undefined ? { purchaseAmount } : {}),
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
          cashbackBalance: res.pass.cashbackBalance,
          visitsCount: res.pass.visitsCount,
          currentTier: res.pass.currentTier,
          tierProgress: res.pass.tierProgress,
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

  // ─── Login inline cuando no hay sesión ───
  if (!user) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-5">
        <div className="card card-pad max-w-sm w-full">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">📷</div>
            <h1 className="text-xl font-bold m-0">Iniciar sesión</h1>
            <p className="text-xs text-mute mt-1.5">
              La sesión del escáner dura {SCANNER_SESSION_HOURS} horas — alcanza
              para todo un turno.
            </p>
          </div>
          <form onSubmit={doLogin} className="space-y-3">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Contraseña</label>
              <input
                type="password"
                className="input"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </div>
            {loginErr && (
              <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">
                {loginErr}
              </div>
            )}
            <button className="btn-primary w-full justify-center" disabled={loggingIn}>
              {loggingIn ? 'Entrando…' : `Iniciar (sesión ${SCANNER_SESSION_HOURS}h)`}
            </button>
          </form>
          <div className="text-center mt-4">
            <a href="/login" className="text-xs text-mute hover:text-ink">
              Login normal del panel →
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="w-full max-w-lg mx-auto p-3 sm:p-5">
        {/* Header — compacto en mobile */}
        <div className="flex items-center justify-between mb-2 sm:mb-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold leading-tight">Escáner</h1>
            <div className="text-[10px] text-mute truncate">
              👤 {user.fullName ?? user.email}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <InstallPWAButton className="btn-ghost text-xs hidden sm:inline-flex" label="Instalar" />
            <button
              type="button"
              onClick={logout}
              className="btn-ghost text-xs"
              title="Cerrar sesión"
            >
              <Icon name="out" size={12} /> Salir
            </button>
          </div>
        </div>

        {!data && (
          <div className="text-center text-xs text-mute mb-2">
            📷 Apuntá la cámara al{' '}
            <strong className="text-ink">código de barras</strong> o QR
          </div>
        )}

        {/* Camera viewport — ocupa el espacio disponible. En mobile usa
            casi toda la pantalla; en desktop se mantiene en proporción. */}
        <div
          id="qr-reader"
          className="rounded-card overflow-hidden bg-ink relative w-full"
          style={{
            display: data ? 'none' : 'block',
            // mobile portrait: hasta 65vh; cap a 560px en pantallas grandes
            height: data ? 0 : 'min(65vh, 560px)',
            minHeight: data ? 0 : 280,
          }}
        />

        {!data && err && !scanning && (
          <button
            type="button"
            className="btn-primary w-full mt-3 justify-center py-3.5"
            onClick={() => startScanner()}
          >
            <Icon name="check" /> Reintentar cámara
          </button>
        )}

        {!data && (
          <form
            className="mt-3 flex gap-2"
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
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
            />
            <button className="btn-primary px-4">Verificar</button>
          </form>
        )}

        {err && (
          <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}

        {data && (
          <div className="card card-pad mt-3">
            <div className="flex items-center gap-3">
              <div
                className={`avatar w-12 h-12 text-base ${avatarClass(
                  data.pass.customer.fullName,
                )}`}
              >
                {initials(data.pass.customer.fullName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{data.pass.customer.fullName}</div>
                <div className="text-xs text-mute truncate">{data.pass.card.name}</div>
              </div>
              <span className="badge badge-info shrink-0">✓</span>
            </div>

            {(data.pass.card.type === 'STAMPS' || data.pass.card.type === 'HYBRID') && (
              <>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-4 justify-center">
                  {Array.from({ length: data.pass.card.stampsRequired ?? 10 }).map(
                    (_, i) => (
                      <span
                        key={i}
                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 flex items-center justify-center text-base shrink-0"
                        style={{
                          background:
                            i < data.pass.stampsCount ? '#22C55E' : 'transparent',
                          borderColor:
                            i < data.pass.stampsCount ? '#22C55E' : '#E5E7EB',
                          color: i < data.pass.stampsCount ? '#fff' : 'transparent',
                        }}
                      >
                        ✓
                      </span>
                    ),
                  )}
                </div>
                <div className="flex items-center justify-between mt-3 text-sm">
                  <strong className="text-base">
                    {data.pass.stampsCount} / {data.pass.card.stampsRequired ?? 10}
                  </strong>
                  <span className="text-mute text-xs">
                    faltan{' '}
                    {Math.max(
                      0,
                      (data.pass.card.stampsRequired ?? 10) - data.pass.stampsCount,
                    )}
                  </span>
                </div>
              </>
            )}

            {data.pass.card.type === 'VISITS' && (
              <div className="mt-4 p-4 rounded-xl bg-bg2/50 text-center">
                <div className="text-4xl font-bold">
                  {data.pass.visitsCount ?? 0}
                  <span className="text-mute text-base"> / {data.pass.card.visitsRequired ?? 10}</span>
                </div>
                <div className="text-xs text-mute mt-1">visitas registradas</div>
              </div>
            )}

            {data.pass.card.type === 'CASHBACK' && (
              <div className="mt-4 p-4 rounded-xl bg-emerald-50 text-center">
                <div className="text-3xl font-bold text-emerald-700">
                  ${Number(data.pass.cashbackBalance ?? 0).toLocaleString('es-CO')}
                </div>
                <div className="text-xs text-emerald-700/70 mt-1">
                  saldo de cashback disponible
                </div>
              </div>
            )}

            {data.pass.card.type === 'POINTS' && (
              <div className="mt-4 p-4 rounded-xl bg-bg2/50 text-center">
                <div className="text-3xl font-bold">
                  {Math.round(Number(data.pass.pointsBalance ?? 0))} <span className="text-mute text-base">pts</span>
                </div>
              </div>
            )}

            {data.pass.card.type === 'MEMBERSHIP' && data.pass.currentTier && (
              <div className="mt-4 p-4 rounded-xl bg-amber-50 text-center">
                <div className="text-3xl font-bold text-amber-700">
                  {data.pass.currentTier}
                </div>
                <div className="text-xs text-amber-700/70 mt-1">
                  tier actual · acumulado: $
                  {Number(data.pass.tierProgress ?? 0).toLocaleString('es-CO')}
                </div>
              </div>
            )}

            {/* Acciones según el tipo de tarjeta */}
            {(data.pass.card.type === 'STAMPS' || data.pass.card.type === 'HYBRID') && (
              <>
                <button
                  className="btn-primary w-full justify-center py-5 text-lg mt-5"
                  disabled={busy}
                  onClick={() => {
                    setPurchaseAmount('');
                    setPurchaseErr(null);
                    setShowPurchase('STAMP');
                  }}
                >
                  <Icon name="plus" /> Confirmar compra y agregar sello
                </button>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    className="btn-ghost justify-center py-3.5 text-sm"
                    disabled={busy}
                    onClick={() => act('REDEEM')}
                  >
                    <Icon name="gift" /> Redimir
                  </button>
                  <button
                    className="btn-ghost justify-center py-3.5 text-sm text-mute"
                    disabled={busy}
                    onClick={() => {
                      setMoreErr(null);
                      setMoreForm({ amount: 2, pin: '' });
                      setShowMoreModal(true);
                    }}
                    title="Requiere PIN del super admin"
                  >
                    🔐 Más sellos
                  </button>
                </div>
              </>
            )}

            {data.pass.card.type === 'VISITS' && (
              <>
                <button
                  className="btn-primary w-full justify-center py-5 text-lg mt-5"
                  disabled={busy}
                  onClick={() => {
                    setPurchaseAmount('');
                    setPurchaseErr(null);
                    setShowPurchase('VISIT');
                  }}
                >
                  <Icon name="plus" /> Confirmar compra y registrar visita
                </button>
                <button
                  className="btn-ghost w-full justify-center py-3.5 text-sm mt-2"
                  disabled={busy}
                  onClick={() => act('REDEEM')}
                >
                  <Icon name="gift" /> Canjear recompensa
                </button>
              </>
            )}

            {data.pass.card.type === 'CASHBACK' && (
              <CashbackActions
                onAdd={(amt, purchaseAmt) =>
                  act('CASHBACK_ADD', amt, undefined, purchaseAmt)
                }
                onRedeem={(amt) => act('CASHBACK_REDEEM', amt)}
                cashbackPercent={data.pass.card.cashbackPercent ?? 5}
                busy={busy}
              />
            )}

            {data.pass.card.type === 'POINTS' && (
              <PointsActions
                onAdd={(amt) => act('POINTS_ADD', amt)}
                onDeduct={(amt) => act('POINTS_DEDUCT', amt)}
                pointsPerCurrency={Number(data.pass.card.pointsPerCurrency ?? 0.001)}
                busy={busy}
              />
            )}

            {data.pass.card.type === 'MEMBERSHIP' && (
              <button
                className="btn-primary w-full justify-center py-5 text-lg mt-5"
                disabled={busy}
                onClick={() => act('VISIT', 1)}
              >
                <Icon name="plus" /> Registrar visita
              </button>
            )}

            <button
              className="btn-link mt-4 w-full justify-center text-sm"
              onClick={scanAnother}
            >
              📷 Escanear otro
            </button>
          </div>
        )}

        {/* Modal: agregar varios sellos (requiere PIN) */}
        {showMoreModal && data && (
          <div
            className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowMoreModal(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-semibold text-lg m-0">🔐 Agregar más sellos</h3>
              <p className="text-xs text-mute mt-1.5 leading-relaxed">
                Cada escaneada normal agrega 1 sello. Para agregar varios
                ingresá el <b>PIN</b> que te dio el super admin.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setMoreErr(null);
                  if (!moreForm.pin.trim()) {
                    setMoreErr('Ingresá el PIN');
                    return;
                  }
                  if (moreForm.amount < 2 || moreForm.amount > 30) {
                    setMoreErr('Cantidad entre 2 y 30');
                    return;
                  }
                  setBusy(true);
                  try {
                    await act('STAMP', moreForm.amount, moreForm.pin);
                    setShowMoreModal(false);
                  } catch (err: any) {
                    setMoreErr(err?.message ?? 'Error');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="mt-4 space-y-3"
              >
                <div>
                  <label className="label">Cantidad de sellos</label>
                  <input
                    type="number"
                    min={2}
                    max={30}
                    className="input"
                    value={moreForm.amount}
                    onChange={(e) =>
                      setMoreForm({ ...moreForm, amount: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="label">PIN del super admin</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    className="input font-mono tracking-widest"
                    value={moreForm.pin}
                    onChange={(e) =>
                      setMoreForm({ ...moreForm, pin: e.target.value })
                    }
                    autoFocus
                  />
                </div>
                {moreErr && (
                  <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">
                    {moreErr}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="btn-ghost flex-1 justify-center"
                    onClick={() => setShowMoreModal(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn-primary flex-1 justify-center"
                    disabled={busy}
                  >
                    {busy ? 'Agregando…' : `Agregar ${moreForm.amount}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: confirmar compra y agregar 1 sello / 1 visita */}
        {showPurchase && data && (
          <div
            className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowPurchase(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-semibold text-lg m-0">
                {showPurchase === 'STAMP' ? '🛍 Registrar compra' : '🚶 Registrar visita'}
              </h3>
              <p className="text-xs text-mute mt-1.5 leading-relaxed">
                Cliente: <strong>{data.pass.customer.fullName}</strong>
                <br />
                Tarjeta: <strong>{data.pass.card.name}</strong>
                <br />
                {showPurchase === 'STAMP'
                  ? `Sellos: ${data.pass.stampsCount} / ${data.pass.card.stampsRequired ?? 10}`
                  : `Visitas: ${data.pass.visitsCount ?? 0} / ${data.pass.card.visitsRequired ?? 10}`}
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setPurchaseErr(null);
                  const amt = Number(purchaseAmount);
                  if (!amt || amt <= 0) {
                    setPurchaseErr('Ingresá el monto de la compra');
                    return;
                  }
                  setBusy(true);
                  try {
                    await act(showPurchase, 1, undefined, amt);
                    setShowPurchase(null);
                    setPurchaseAmount('');
                  } catch (err: any) {
                    setPurchaseErr(err?.message ?? 'Error');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="mt-4 space-y-3"
              >
                <div>
                  <label className="label">Monto de la compra</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-semibold">
                      $
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      autoFocus
                      inputMode="decimal"
                      className="input pl-7 text-lg font-semibold"
                      value={purchaseAmount}
                      onChange={(e) => setPurchaseAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="text-[11px] text-mute mt-1.5 leading-snug">
                    El monto es <b>solo informativo</b> (alimenta los KPIs de
                    facturación). No cambia cuántos sellos se otorgan: 1 compra = 1 sello.
                  </div>
                </div>
                {purchaseErr && (
                  <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">
                    {purchaseErr}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-primary flex-1 justify-center"
                  >
                    {busy
                      ? 'Procesando…'
                      : showPurchase === 'STAMP'
                      ? 'Confirmar y agregar sello'
                      : 'Confirmar y registrar visita'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPurchase(null)}
                    disabled={busy}
                    className="btn-ghost"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Acciones cashback (sumar/canjear saldo) ───
function CashbackActions({
  onAdd,
  onRedeem,
  cashbackPercent,
  busy,
}: {
  onAdd: (amt: number, purchaseAmount: number) => void;
  onRedeem: (amt: number) => void;
  cashbackPercent: number;
  busy: boolean;
}) {
  const [purchase, setPurchase] = useState<number>(0);
  const [redeem, setRedeem] = useState<number>(0);
  const earned = Math.round((purchase * cashbackPercent) / 100);
  return (
    <div className="mt-5 space-y-3">
      <div className="p-3 rounded-xl border border-line">
        <div className="text-xs font-semibold mb-2">💰 Sumar cashback</div>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="Monto compra"
            className="input flex-1"
            value={purchase || ''}
            onChange={(e) => setPurchase(Number(e.target.value))}
          />
          <button
            className="btn-primary px-4"
            disabled={busy || earned <= 0}
            onClick={() => {
              onAdd(earned, purchase);
              setPurchase(0);
            }}
          >
            +${earned.toLocaleString('es-CO')}
          </button>
        </div>
        <div className="text-[11px] text-mute mt-1">
          {cashbackPercent}% sobre la compra → saldo del cliente. El monto
          alimenta los KPIs de facturación del programa.
        </div>
      </div>
      <div className="p-3 rounded-xl border border-line">
        <div className="text-xs font-semibold mb-2">🎁 Canjear saldo</div>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="Monto a usar"
            className="input flex-1"
            value={redeem || ''}
            onChange={(e) => setRedeem(Number(e.target.value))}
          />
          <button
            className="btn-ghost px-4"
            disabled={busy || redeem <= 0}
            onClick={() => {
              onRedeem(redeem);
              setRedeem(0);
            }}
          >
            -${redeem.toLocaleString('es-CO')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Acciones puntos ───
function PointsActions({
  onAdd,
  onDeduct,
  pointsPerCurrency,
  busy,
}: {
  onAdd: (amt: number) => void;
  onDeduct: (amt: number) => void;
  pointsPerCurrency: number;
  busy: boolean;
}) {
  const [purchase, setPurchase] = useState<number>(0);
  const [deduct, setDeduct] = useState<number>(0);
  const earnedPts = Math.round(purchase * pointsPerCurrency);
  return (
    <div className="mt-5 space-y-3">
      <div className="p-3 rounded-xl border border-line">
        <div className="text-xs font-semibold mb-2">⭐ Sumar puntos</div>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="Monto compra"
            className="input flex-1"
            value={purchase || ''}
            onChange={(e) => setPurchase(Number(e.target.value))}
          />
          <button
            className="btn-primary px-4"
            disabled={busy || earnedPts <= 0}
            onClick={() => {
              onAdd(earnedPts);
              setPurchase(0);
            }}
          >
            +{earnedPts} pts
          </button>
        </div>
      </div>
      <div className="p-3 rounded-xl border border-line">
        <div className="text-xs font-semibold mb-2">🎁 Canjear puntos</div>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step={10}
            placeholder="Puntos a quitar"
            className="input flex-1"
            value={deduct || ''}
            onChange={(e) => setDeduct(Number(e.target.value))}
          />
          <button
            className="btn-ghost px-4"
            disabled={busy || deduct <= 0}
            onClick={() => {
              onDeduct(deduct);
              setDeduct(0);
            }}
          >
            -{deduct} pts
          </button>
        </div>
      </div>
    </div>
  );
}
