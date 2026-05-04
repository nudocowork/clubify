/**
 * Beep sintético con Web Audio API — no requiere asset.
 * Tres tonos cortos ascendentes para alertar pedido nuevo sin ser molesto.
 */
let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  try {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    audioCtx = new C();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * "Ka-ching" corto para confirmación de scaneo. Dos notas brillantes.
 */
export function playScanSuccess() {
  const c = ctx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const now = c.currentTime;
  const tones = [1320, 1760]; // E6, A6
  tones.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(c.destination);
    const t0 = now + i * 0.06;
    const t1 = t0 + 0.22;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t1);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  });
}

/**
 * Buzz grave breve para error de scaneo (QR inválido o de otro tenant).
 */
export function playScanError() {
  const c = ctx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
  osc.connect(gain);
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.start(now);
  osc.stop(now + 0.32);
}

export function playOrderBeep() {
  const c = ctx();
  if (!c) return;
  // Resume si está suspended (autoplay policy)
  if (c.state === 'suspended') {
    c.resume().catch(() => {});
  }
  const now = c.currentTime;
  const tones = [880, 1100, 1320]; // La5, Do#6, Mi6 — acorde A mayor agradable
  tones.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(c.destination);
    const t0 = now + i * 0.13;
    const t1 = t0 + 0.18;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t1);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  });
}

/**
 * Notificación nativa del navegador (con permiso). Best-effort:
 * si el usuario no concedió permiso o el browser no la soporta, no hace nada.
 */
export async function browserNotify(
  title: string,
  body: string,
  href?: string,
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  let perm = Notification.permission;
  if (perm === 'default') {
    try {
      perm = await Notification.requestPermission();
    } catch {
      return;
    }
  }
  if (perm !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    });
    if (href) {
      n.onclick = () => {
        window.focus();
        window.location.href = href;
      };
    }
    setTimeout(() => n.close(), 8000);
  } catch {}
}

/**
 * Pide permiso de notificación si aún no se decidió. Llamar una vez tras
 * un click del usuario para cumplir la política de gesto.
 */
export function ensureNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}
