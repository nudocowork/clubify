'use client';
import { useEffect, useRef, useState } from 'react';
import { api, getUser, setSession, clearSession } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { InstallPWAButton } from '@/components/InstallPWAButton';
import { playScanSuccess, playScanError } from '@/lib/notify';

const SCANNER_SESSION_HOURS = 6;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

// Cards single-use: COUPON (oficial post 2026-05-15) + DISCOUNT/GIFT
// (legacy creados antes de la simplificación del wizard). Todos comparten
// la misma UX en el scanner: botón "Redimir cupón" + auto-promote a
// stamps card al redimir.
function isCouponLike(type: string | null | undefined): boolean {
  return type === 'COUPON' || type === 'DISCOUNT' || type === 'GIFT';
}

// Cámara elegida a mano por el negocio. Se persiste por dispositivo: en
// varios Samsung la cámara que entrega facingMode:'environment' es la ultra
// gran angular, que tiene FOCO FIJO y nunca enfoca un código de cerca.
const CAMERA_KEY = 'clubify.scan.cameraId';

// Formatos para el BarcodeDetector nativo. PDF417 va primero porque es el
// que usan los pases de Clubify en Apple y en Google Wallet.
const NATIVE_FORMATS = [
  'pdf417',
  'qr_code',
  'code_128',
  'ean_13',
  'code_39',
  'aztec',
  'data_matrix',
];

function isPermissionError(e: any) {
  return e?.name === 'NotAllowedError' || /permission|denied/i.test(e?.message ?? '');
}

// Elige la cámara TRASERA por etiqueta. Acá antes iba cams[0], que en móvil
// suele ser la frontal → el escáner quedaba apuntando al lado equivocado.
function pickBackCamera(cams: Array<{ id: string; label: string }>) {
  return (
    cams.find((c) => /back|rear|trasera|traseira|environment/i.test(c.label ?? '')) ??
    cams[0]
  );
}

// BarcodeDetector nativo del sistema, si existe (Android Chrome con Google
// Play Services, macOS). Devuelve null en iOS/Safari y en navegadores sin
// Shape Detection API — ahí seguimos con el decodificador JS de html5-qrcode.
async function makeNativeDetector(): Promise<any | null> {
  const BD = (globalThis as any).BarcodeDetector;
  if (!BD) return null;
  try {
    const supported: string[] = await BD.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return null;
    return new BD({ formats });
  } catch {
    return null;
  }
}

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
  // Linterna (torch) + su disponibilidad. El botón solo se muestra si el
  // equipo la soporta. Ayuda al autofocus por contraste en locales con poca
  // luz, donde muchas cámaras Android no enfocan bien.
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // Loop del detector nativo + guard para que los dos motores (nativo y JS)
  // no procesen el mismo código y disparen dos /scanner/verify.
  const nativeLoopRef = useRef<any>(null);
  const handledRef = useRef(false);
  // Zoom óptico/digital del track, si el equipo lo expone.
  const [zoom, setZoom] = useState<
    { min: number; max: number; step: number; value: number } | null
  >(null);
  // Selector de cámara + línea de diagnóstico (qué cámara, qué motor y a qué
  // resolución está corriendo) para poder depurar por screenshot.
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [activeCamId, setActiveCamId] = useState<string | null>(null);
  const [diag, setDiag] = useState<string>('');
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

  function stopNativeLoop() {
    if (nativeLoopRef.current) {
      clearTimeout(nativeLoopRef.current);
      nativeLoopRef.current = null;
    }
  }

  // Punto ÚNICO de entrada para un código leído, venga del detector nativo o
  // del decodificador JS de html5-qrcode.
  async function handleResult(text: string) {
    if (handledRef.current) return;
    handledRef.current = true;
    stopNativeLoop();
    // Detener primero para evitar callbacks duplicados
    try {
      await scannerRef.current?.stop();
    } catch {}
    setScanning(false);
    await verify(text);
  }

  // Loop del detector NATIVO — lee el <video> a resolución completa.
  //
  // Por qué existe: html5-qrcode NO decodifica el video, decodifica un canvas
  // que dimensiona en píxeles CSS del qrbox (`foreverScan`: drawImage del
  // recorte del video hacia un canvas de qrRegion.width × qrRegion.height).
  // En un celular eso son ~310×160 px. Un PDF417 corto tiene ~136 módulos de
  // ancho: si el código ocupa medio cuadro quedan ~1.1 px por módulo →
  // imposible de decodificar. Y como `scanContext` le pasa ESE canvas al
  // BarcodeDetector, activarlo dentro de la librería tampoco resolvía nada.
  // Leyendo el <video> directo trabajamos con los 1920×1080 reales.
  //
  // Efecto lateral bueno: este loop es independiente de `foreverScan`, así que
  // sigue escaneando aunque el setupUi de la librería falle (su validación de
  // qrbox corre dentro del listener 'playing', DESPUÉS de que start() ya
  // resolvió — si tira, la cámara se ve encendida pero nunca decodifica).
  function startNativeLoop(detector: any) {
    const tick = async () => {
      nativeLoopRef.current = null;
      if (handledRef.current || !detector) return;
      const video = document.querySelector<HTMLVideoElement>('#qr-reader video');
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const codes = await detector.detect(video);
          const raw = codes?.[0]?.rawValue;
          if (raw) {
            await handleResult(raw);
            return;
          }
        } catch {
          // Frame no legible o detector ocupado: se reintenta al próximo tick.
        }
      }
      if (!handledRef.current) nativeLoopRef.current = setTimeout(tick, 120);
    };
    stopNativeLoop();
    nativeLoopRef.current = setTimeout(tick, 300);
  }

  // Post-arranque, todo best-effort: nada de acá puede tumbar una cámara que
  // ya está funcionando.
  async function afterStart(detector: any) {
    const inst = scannerRef.current as any;
    // Resolución alta SOLO si hay detector nativo, porque solo él lee el video
    // completo. Con el decodificador JS es CONTRAPRODUCENTE: su canvas mide lo
    // mismo (~310 px) pidas la resolución que pidas, así que 1920 px de origen
    // implican un submuestreo de 5.7× que se come las barras finas del PDF417.
    // Sin detector nativo dejamos la que elija el driver (~640×480, ~1.9×).
    if (detector) {
      try {
        await inst?.applyVideoConstraints({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        });
      } catch (e) {
        console.warn('[scan] resolución ideal no aplicada:', e);
      }
    }
    // Enfoque continuo: soporte parcial en Android, se ignora solo si no está.
    try {
      await inst?.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (e) {
      console.warn('[scan] focusMode continuous no soportado:', e);
    }

    let caps: any = null;
    try {
      caps = inst?.getRunningTrackCameraCapabilities?.();
    } catch {}
    try {
      setTorchSupported(!!caps?.torchFeature?.().isSupported?.());
    } catch {
      setTorchSupported(false);
    }
    setTorchOn(false);
    // Zoom: acercar hace que el código ocupe más cuadro = más píxeles reales
    // por módulo del barcode. Es el mejor remedio cuando al equipo le tocó una
    // cámara gran angular.
    try {
      const z = caps?.zoomFeature?.();
      if (z?.isSupported?.()) {
        const min = z.min() ?? 1;
        const max = Math.min(z.max() ?? 1, 5);
        const step = z.step() || 0.1;
        setZoom(max > min ? { min, max, step, value: z.value() ?? min } : null);
      } else {
        setZoom(null);
      }
    } catch {
      setZoom(null);
    }

    let settings: any = {};
    try {
      settings = inst?.getRunningTrackSettings?.() ?? {};
    } catch {}
    setActiveCamId(settings.deviceId ?? null);
    setDiag(
      `${detector ? 'nativo' : 'JS'} · ${settings.width ?? '?'}×${settings.height ?? '?'}`,
    );
    // enumerateDevices y NO Html5Qrcode.getCameras(): este último abre un
    // getUserMedia temporal para forzar el permiso, y pedir un segundo stream
    // con la cámara ya andando la puede robar en varios Android. Como el
    // permiso ya está dado, enumerateDevices trae las etiquetas igual.
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      setCameras(
        devs
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Cámara ${i + 1}` })),
      );
    } catch {
      setCameras([]);
    }

    if (detector) startNativeLoop(detector);
  }

  // Inicia (o re-inicia) el scanner. Idempotente.
  async function startScanner() {
    setErr(null);
    handledRef.current = false;
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
          // Ojo: esto ya viene en true por default y sirve de poco — la
          // librería le pasa al BarcodeDetector su canvas reducido, no el
          // video. El detector nativo que sí mueve la aguja es el loop propio
          // de startNativeLoop(). Se deja explícito para que no se lea como
          // "falta activarlo".
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        });
      }
      // Se resuelve ANTES de arrancar porque decide dos cosas del arranque:
      // los fps del decodificador JS (que pasa a ser respaldo) y si conviene
      // pedirle resolución alta a la cámara.
      const detector = await makeNativeDetector();
      const scanConfig = {
        // Con detector nativo, html5-qrcode queda de red de seguridad: bajamos
        // sus fps y le sacamos el reintento espejado para no comernos la CPU
        // decodificando 1080p dos veces por frame en paralelo al loop nativo.
        fps: detector ? 4 : 10,
        disableFlip: !!detector,
        qrbox: (vw: number, vh: number) => {
          // Región de ESCANEO generosa (casi todo el cuadro). El "recuadro de
          // mira" VISIBLE ya NO lo dibuja html5-qrcode (su #qr-shaded-region se
          // oculta por CSS) — lo pintamos nosotros en el render.
          // El clamp a 50 no es cosmético: validateQrboxSize LANZA por debajo
          // de MIN_QR_BOX_SIZE, y ese throw ocurre dentro del listener
          // 'playing', o sea DESPUÉS de que start() resolvió → quedaría la
          // cámara encendida sin decodificar nunca, sin error visible.
          const width = Math.min(vw, Math.max(50, Math.round(vw * 0.92)));
          const height = Math.min(vh, Math.max(50, Math.round(vh * 0.85)));
          return { width, height };
        },
        aspectRatio: 1.5,
      };
      // OJO: html5-qrcode 2.3.8 NO acepta constraints extra en start() — su
      // createVideoConstraints exige un objeto de EXACTAMENTE 1 clave
      // (facingMode|deviceId) o un string deviceId; pasar width/height/advanced
      // lanzaba y caía al fallback = primera cámara (FRONTAL en móvil) →
      // escáner inservible. El resto se aplica post-start en afterStart().
      const tryStart = (source: any) =>
        scannerRef.current.start(source, scanConfig, handleResult, () => {});

      let saved: string | null = null;
      try {
        saved = localStorage.getItem(CAMERA_KEY);
      } catch {}

      let started = false;
      let lastErr: any = null;
      // 1) Cámara que el negocio eligió a mano (si la guardó).
      if (saved) {
        try {
          await tryStart(saved);
          started = true;
        } catch (e: any) {
          lastErr = e;
          if (isPermissionError(e)) throw e;
        }
      }
      // 2) Trasera por facingMode — el caso normal (celular del local).
      if (!started) {
        try {
          await tryStart({ facingMode: 'environment' });
          started = true;
        } catch (e: any) {
          lastErr = e;
          if (isPermissionError(e)) throw e; // no insistir, mostrar el mensaje claro
        }
      }
      // 3) Fallback (#scan 2026-06-19): en laptops/desktops sin cámara trasera
      // facingMode:'environment' falla y la cámara queda NEGRA. Elegimos por
      // etiqueta en vez de cams[0], que en móvil es la frontal.
      if (!started) {
        const cams = await Html5Qrcode.getCameras();
        if (!cams || cams.length === 0) throw lastErr ?? new Error('Sin cámaras');
        await tryStart(pickBackCamera(cams).id);
      }
      setScanning(true);
      afterStart(detector);
    } catch (e: any) {
      const msg = e?.message ?? '';
      setErr(
        msg.includes('permission') || e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilitalo desde el icono del candado en la URL y vuelve a intentar.'
          : 'No se pudo acceder a la cámara. Pega el código manualmente abajo.',
      );
      setScanning(false);
    }
  }

  async function stopScanner() {
    stopNativeLoop();
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.stop();
    } catch {}
    setScanning(false);
    setTorchSupported(false);
    setTorchOn(false);
    setZoom(null);
  }

  async function applyZoom(v: number) {
    try {
      const z = (scannerRef.current as any)
        ?.getRunningTrackCameraCapabilities?.()
        ?.zoomFeature?.();
      if (!z?.isSupported?.()) return;
      await z.apply(v);
      setZoom((prev) => (prev ? { ...prev, value: v } : prev));
    } catch (e) {
      console.warn('[scan] zoom no aplicado:', e);
    }
  }

  // Cambiar de cámara. Se persiste para que el negocio no tenga que elegirla
  // en cada turno: en Samsung la cámara "trasera" por defecto puede ser la
  // ultra gran angular (foco fijo), y ninguna cantidad de enfoque la arregla.
  async function switchCamera(id: string) {
    try {
      localStorage.setItem(CAMERA_KEY, id);
    } catch {}
    setActiveCamId(id);
    await stopScanner();
    setTimeout(() => startScanner(), 50);
  }

  // Linterna: la enciende/apaga sobre el track ya activo. Solo se llama desde
  // el botón, que a su vez solo se muestra si torchSupported === true.
  async function toggleTorch() {
    try {
      const caps = (scannerRef.current as any)?.getRunningTrackCameraCapabilities?.();
      const torch = caps?.torchFeature?.();
      if (!torch?.isSupported?.()) {
        setTorchSupported(false);
        return;
      }
      const next = !torchOn;
      await torch.apply(next);
      setTorchOn(next);
    } catch (e) {
      console.warn('[scan] no se pudo alternar la linterna:', e);
    }
  }

  // Tap-para-enfocar: si el enfoque continuo no dispara (común en gama media
  // Android), tocar la imagen fuerza un re-enfoque puntual (single-shot) y
  // luego vuelve a continuo. single-shot tiene soporte parcial → try/catch.
  async function tapToFocus() {
    if (!scanning) return;
    try {
      await (scannerRef.current as any)?.applyVideoConstraints({
        advanced: [{ focusMode: 'single-shot' }],
      });
      setTimeout(() => {
        // applyVideoConstraints LANZA sincrónicamente (getRenderedCameraOrFail)
        // si el scanner ya se detuvo — un .catch() encadenado no lo agarra y
        // quedaba como excepción suelta al escanear dentro de estos 1.2s.
        try {
          (scannerRef.current as any)
            ?.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] })
            ?.catch(() => {});
        } catch {}
      }, 1200);
    } catch (e) {
      console.warn('[scan] tap-para-enfocar no soportado:', e);
    }
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
        refreshToken: body.refreshToken,
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
      // Diagnóstico (2026-06-19): si no resuelve, mostramos el valor leído
      // (truncado) para identificar el formato del barcode del pase viejo.
      const shown =
        qrToken.length > 50 ? `${qrToken.slice(0, 50)}…(${qrToken.length})` : qrToken;
      setErr(`${e.message}  ·  [código leído: ${shown}]`);
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
      // Si el cupón fue transformado in-place a stamps card, el
      // backend devuelve el pass completo (incluido el card nuevo
      // tipo STAMPS). Pisamos el state con el response — el spread
      // de `res.pass` SOBREESCRIBE el card viejo con el nuevo;
      // `data.pass.tenant` se conserva porque no viene en res.pass.
      if (res.transformedToStamps) {
        setData({
          ...data,
          pass: {
            ...data.pass,
            ...res.pass,
          },
          justTransformedFromCoupon: true,
        });
      } else {
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
      }
      playScanSuccess();
    } catch (e: any) {
      setErr(e.message);
      playScanError();
    } finally {
      setBusy(false);
    }
  }

  // Wallet V3 — restar un sello (-1) con confirmación. Piso 0 (el backend
  // también lo garantiza). Gateado por la marca (walletAdvanced.removeStamps).
  async function removeStamp() {
    if (!data?.pass) return;
    const isVisits = data.pass.card?.type === 'VISITS';
    const current = isVisits ? data.pass.visitsCount ?? 0 : data.pass.stampsCount ?? 0;
    if (current <= 0) {
      setErr(isVisits ? 'El cliente no tiene visitas que restar.' : 'El cliente no tiene sellos que restar.');
      playScanError();
      return;
    }
    if (!confirm(isVisits ? '¿Seguro que deseas eliminar una visita?' : '¿Seguro que deseas eliminar un sello?')) {
      return;
    }
    await act('STAMP_REMOVE', 1);
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
            📷 Apunta la cámara al{' '}
            <strong className="text-ink">código de barras</strong> o QR
          </div>
        )}

        {/* Camera viewport — se ajusta EXACTO al video (ver el style de
            abajo), así el recuadro de mira queda centrado sobre la imagen y no
            sobre relleno negro. El wrapper 'relative' aloja los controles
            sobrepuestos (linterna, hint) sin que html5-qrcode los borre al
            inyectar el <video>. */}
        <div className="relative w-full" style={{ display: data ? 'none' : 'block' }}>
          <div
            id="qr-reader"
            onClick={tapToFocus}
            className="rounded-card overflow-hidden bg-ink relative w-full"
            style={{
              // Altura AUTOMÁTICA: la define el <video> que inyecta
              // html5-qrcode (ancho = el del contenedor, alto intrínseco del
              // stream). Antes era min(65vh,560px) fija y el video —siempre
              // apaisado— llenaba solo el tercio superior: el recuadro de mira,
              // centrado en el contenedor, caía ENTERO sobre la zona negra de
              // abajo y la persona terminaba apuntando el código a la nada.
              // El minHeight es solo el placeholder previo a que abra la cámara.
              minHeight: scanning ? undefined : 240,
              cursor: scanning ? 'pointer' : 'default',
            }}
          />
          {/* Ocultamos el recuadro que dibuja html5-qrcode (#qr-shaded-region):
              se veía como una "línea finita" por el desajuste de coordenadas.
              En su lugar pintamos el nuestro (abajo), grueso y parejo en iOS y
              Android. */}
          <style>{`#qr-shaded-region{display:none!important}`}</style>
          {/* Recuadro de mira PROPIO — grueso, tamaño de código de barras de
              tarjeta. La región de escaneo real es más grande que esta guía,
              así que si el código cae dentro, siempre se detecta. */}
          {scanning && (
            <div className="pointer-events-none absolute inset-0 z-[5] rounded-card overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="relative"
                  style={{ width: '86%', maxWidth: 440, aspectRatio: '2.3 / 1' }}
                >
                  {/* Oscurece alrededor del recuadro y deja la guía más clara */}
                  <div
                    className="absolute inset-0 rounded-lg"
                    style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.34)' }}
                  />
                  {/* 4 esquinas tipo mira */}
                  <span className="absolute -top-px -left-px w-9 h-9 border-t-[5px] border-l-[5px] border-white rounded-tl-lg" />
                  <span className="absolute -top-px -right-px w-9 h-9 border-t-[5px] border-r-[5px] border-white rounded-tr-lg" />
                  <span className="absolute -bottom-px -left-px w-9 h-9 border-b-[5px] border-l-[5px] border-white rounded-bl-lg" />
                  <span className="absolute -bottom-px -right-px w-9 h-9 border-b-[5px] border-r-[5px] border-white rounded-br-lg" />
                </div>
              </div>
            </div>
          )}
          {scanning && (
            <div className="absolute bottom-3 left-3 z-10 text-[10px] text-white/80 bg-black/50 rounded-full px-2.5 py-1 pointer-events-none select-none">
              Toca para enfocar
            </div>
          )}
          {scanning && torchSupported && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleTorch();
              }}
              className="absolute bottom-3 right-3 z-10 w-11 h-11 rounded-full flex items-center justify-center shadow-lg text-lg"
              style={{
                background: torchOn ? '#fbbf24' : 'rgba(0,0,0,0.55)',
                color: torchOn ? '#000' : '#fff',
              }}
              title={torchOn ? 'Apagar linterna' : 'Encender linterna'}
              aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
            >
              💡
            </button>
          )}
        </div>

        {/* Controles de cámara. El selector es clave en Samsung: la cámara que
            entrega facingMode:'environment' puede ser la ultra gran angular,
            que en varios modelos tiene FOCO FIJO y nunca enfoca un código de
            cerca — ahí no hay enfoque ni linterna que sirva, hay que cambiar
            de lente. La elección queda guardada en el equipo. */}
        {!data && scanning && (
          <div className="mt-2 space-y-2">
            {cameras.length > 1 && (
              <select
                className="input text-xs py-2"
                value={activeCamId ?? ''}
                onChange={(e) => switchCamera(e.target.value)}
                aria-label="Cámara"
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            {zoom && (
              <label className="flex items-center gap-2 text-[11px] text-mute">
                🔍
                <input
                  type="range"
                  className="flex-1"
                  min={zoom.min}
                  max={zoom.max}
                  step={zoom.step}
                  value={zoom.value}
                  onChange={(e) => applyZoom(Number(e.target.value))}
                  aria-label="Zoom"
                />
                <span className="w-9 text-right tabular-nums">
                  {zoom.value.toFixed(1)}x
                </span>
              </label>
            )}
            {diag && (
              <div className="text-[10px] text-mute text-center">
                detector {diag}
              </div>
            )}
          </div>
        )}

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
              // Guard: no mandar el verify si está vacío (evita el 400
              // "Código vacío" confuso cuando el campo quedó en blanco).
              let v = manual.trim();
              if (!v) {
                setErr('Escaneá un código o pegá el código del pase (CLB-…).');
                return;
              }
              // El serial siempre es mayúscula; el qrToken (QR-<nanoid>) NO
              // — por eso se normaliza solo el CLB- en vez de forzar
              // autoCapitalize sobre todo el campo, que rompía los QR-.
              if (/^clb-/i.test(v)) v = v.toUpperCase();
              verify(v);
            }}
          >
            <input
              className="input flex-1"
              placeholder="Pegar código manualmente (CLB-…)"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
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

            {/* Mensaje post-transformación: aparece cuando el cupón se acaba
                de redimir y se transformó in-place a stamps card. El
                pass.card.type ya cambió a 'STAMPS' a este punto. */}
            {data.justTransformedFromCoupon && (
              <div className="mt-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm leading-relaxed text-center">
                <div className="text-2xl mb-1">🎉</div>
                <div className="font-semibold text-base mb-1">
                  Cupón redimido correctamente
                </div>
                <div className="text-xs text-emerald-800/80">
                  La tarjeta del cliente se actualizó automáticamente
                  a sellos. Ya puede empezar a acumular.
                </div>
              </div>
            )}

            {isCouponLike(data.pass.card.type) && (
              <>
                {/* Display central del cupón: estado + recompensa + descuento */}
                <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 text-center">
                  <div className="text-3xl mb-1">🎟</div>
                  <div className="text-[10px] uppercase tracking-wider text-amber-700/70 font-semibold">
                    Cupón
                  </div>
                  <div className="text-lg font-bold text-amber-900 mt-1 leading-tight">
                    {data.pass.card.rewardText || 'Beneficio especial'}
                  </div>
                  {/* El "% OFF" solo se muestra si NO hay premio custom: cuando el
                      negocio define un premio (ej. "Reclama Gratis 1 Americano"),
                      ese es el beneficio y el % sería incongruente. */}
                  {data.pass.card.discountPercent &&
                  !data.pass.card.rewardText?.trim() ? (
                    <div className="text-2xl font-extrabold text-amber-700 mt-1">
                      {data.pass.card.discountPercent}% OFF
                    </div>
                  ) : null}
                  <div
                    className={`inline-block mt-3 px-3 py-1 rounded-full text-xs font-semibold ${
                      data.pass.status === 'COMPLETED'
                        ? 'bg-mute/20 text-mute'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {data.pass.status === 'COMPLETED'
                      ? '✓ Redimido'
                      : '● Disponible'}
                  </div>
                </div>

              </>
            )}

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
            {isCouponLike(data.pass.card.type) && (
              <>
                {data.pass.status === 'COMPLETED' ? (
                  <button
                    className="w-full justify-center py-5 text-lg mt-5 rounded-lg bg-mute/10 text-mute font-semibold cursor-not-allowed flex items-center gap-2"
                    disabled
                    title="Este cupón ya fue redimido y no se puede usar de nuevo"
                  >
                    🚫 Cupón ya redimido
                  </button>
                ) : (
                  <button
                    className="btn-primary w-full justify-center py-5 text-lg mt-5"
                    disabled={busy}
                    onClick={() => act('REDEEM')}
                  >
                    <Icon name="gift" /> Redimir cupón
                  </button>
                )}
              </>
            )}

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
                {/* Wallet V3 — restar sello (-1). Solo si la marca lo permite. */}
                {data.walletAdvanced?.removeStamps !== false && (
                  <button
                    className="btn-ghost w-full justify-center py-3 text-sm mt-2"
                    style={{ color: '#dc2626' }}
                    disabled={busy || (data.pass.stampsCount ?? 0) <= 0}
                    onClick={removeStamp}
                  >
                    − Restar sello
                  </button>
                )}
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
                {/* Wallet V3 — restar visita (-1). Solo si la marca lo permite. */}
                {data.walletAdvanced?.removeStamps !== false && (
                  <button
                    className="btn-ghost w-full justify-center py-3 text-sm mt-2"
                    style={{ color: '#dc2626' }}
                    disabled={busy || (data.pass.visitsCount ?? 0) <= 0}
                    onClick={removeStamp}
                  >
                    − Restar visita
                  </button>
                )}
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
                ingresa el <b>PIN</b> que te dio el super admin.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setMoreErr(null);
                  if (!moreForm.pin.trim()) {
                    setMoreErr('Ingresa el PIN');
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
                    setPurchaseErr('Ingresa el monto de la compra');
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
