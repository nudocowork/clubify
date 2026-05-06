'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(^|;\s*)clubify_token=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

export function setSession(token: string, user: any) {
  // Sesión fija de 1 hora — luego expira y debe volver a loguear
  document.cookie = `clubify_token=${encodeURIComponent(token)}; path=/; max-age=${60 * 60}; samesite=lax`;
  localStorage.setItem('clubify_user', JSON.stringify(user));
}

export function clearSession() {
  document.cookie = 'clubify_token=; path=/; max-age=0';
  localStorage.removeItem('clubify_user');
  localStorage.removeItem('clubify_admin_backup');
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('clubify_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // localStorage corrupto (rare pero pasa post-crash) — limpiar y forzar
    // re-login en lugar de crashear toda la app.
    localStorage.removeItem('clubify_user');
    return null;
  }
}

/**
 * Inicia una sesión "como tenant" desde la cuenta admin actual.
 * Guarda la sesión admin en backup, switchea al token nuevo, redirige a /app.
 */
export function startImpersonation(opts: {
  accessToken: string;
  user: any;
  tenant: { id: string; brandName: string };
}) {
  const currentToken = getToken();
  const currentUser = getUser();
  if (currentToken && currentUser) {
    localStorage.setItem(
      'clubify_admin_backup',
      JSON.stringify({
        token: currentToken,
        user: currentUser,
        tenant: opts.tenant,
        startedAt: new Date().toISOString(),
      }),
    );
  }
  setSession(opts.accessToken, opts.user);
}

export function getImpersonationBackup():
  | { token: string; user: any; tenant: { id: string; brandName: string }; startedAt: string }
  | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('clubify_admin_backup');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem('clubify_admin_backup');
    return null;
  }
}

/** Restaura la sesión admin guardada en startImpersonation. */
export function stopImpersonation() {
  const backup = getImpersonationBackup();
  if (!backup) return false;
  setSession(backup.token, backup.user);
  localStorage.removeItem('clubify_admin_backup');
  return true;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let body: any = text;
    let msg = text;
    try {
      body = JSON.parse(text);
      msg = body?.message ?? text;
    } catch {}

    // Cuenta suspendida: redirige a billing para que reactive
    if (res.status === 402 || body?.code === 'TENANT_SUSPENDED') {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/app/billing')) {
        window.location.href = '/app/billing?suspended=1';
      }
    }
    // 401 con token: sesión vencida → forzar login
    if (res.status === 401 && token && typeof window !== 'undefined') {
      const onLogin = window.location.pathname.startsWith('/login');
      if (!onLogin) {
        clearSession();
        window.location.href = '/login?expired=1';
      }
    }

    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

/** Descarga un archivo desde un endpoint protegido por JWT y lo guarda con `filename`. */
export async function downloadFile(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(`${API}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
