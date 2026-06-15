'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Backend default: JWT_EXPIRES=15m, JWT_REFRESH_EXPIRES=30d.
// Cookie del access vence con la del JWT (15m) — pero puede vencer ANTES si
// el refresh ya tiene 30d. La cookie del refresh dura más para que el user
// no tenga que re-loguearse cada hora.
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // 30d, igual al backend

export function getToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(^|;\s*)clubify_token=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

function getRefreshToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(^|;\s*)clubify_refresh=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

function writeAccessCookie(token: string, maxAgeSeconds: number) {
  document.cookie = `clubify_token=${encodeURIComponent(token)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

function writeRefreshCookie(token: string) {
  document.cookie = `clubify_refresh=${encodeURIComponent(token)}; path=/; max-age=${REFRESH_MAX_AGE}; samesite=lax`;
}

export function setSession(
  token: string,
  user: any,
  opts?: { maxAgeSeconds?: number; refreshToken?: string },
) {
  // Default 1 hora para la cookie del access (el JWT por dentro vive 15m,
  // pero mantener la cookie un poco más permite que el wrapper detecte
  // hadSession=true para disparar el refresh en lugar de mandar al login).
  // Para sesión scanner pasamos maxAgeSeconds: 6 * 3600.
  const maxAge = opts?.maxAgeSeconds ?? 60 * 60;
  writeAccessCookie(token, maxAge);
  if (opts?.refreshToken) {
    writeRefreshCookie(opts.refreshToken);
  }
  localStorage.setItem('clubify_user', JSON.stringify(user));
}

export function clearSession() {
  document.cookie = 'clubify_token=; path=/; max-age=0';
  document.cookie = 'clubify_refresh=; path=/; max-age=0';
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

type ImpersonationBackup = {
  token: string;
  refreshToken?: string | null;
  user: any;
  tenant?: { id: string; brandName: string };
  affiliate?: { codeId: string; code: string; ownerName: string; role: string };
  startedAt: string;
};

// PILA de impersonación (2026-06-15): permite drill-down anidado del Master
// Admin → admin de marca blanca → negocio, volviendo nivel por nivel. Antes
// era un único backup que se pisaba al anidar (perdías la vuelta a Fidelia).
// Compat: si encuentra el formato viejo (objeto único) lo envuelve como pila
// de 1. Se persiste en la MISMA key `clubify_admin_backup`.
function readImpersonationStack(): ImpersonationBackup[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem('clubify_admin_backup');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    // Formato viejo (objeto único) → pila de 1.
    if (parsed && parsed.token) return [parsed];
    return [];
  } catch {
    localStorage.removeItem('clubify_admin_backup');
    return [];
  }
}

function writeImpersonationStack(stack: ImpersonationBackup[]) {
  if (stack.length === 0) {
    localStorage.removeItem('clubify_admin_backup');
  } else {
    localStorage.setItem('clubify_admin_backup', JSON.stringify(stack));
  }
}

/**
 * Inicia una sesión "como tenant" o "como afiliado" desde la cuenta actual.
 * APILA la sesión actual (no la pisa) para soportar anidamiento: Fidelia →
 * admin de marca → negocio. Switchea al token nuevo. Para tenant pasá
 * `tenant`, para afiliado pasá `affiliate` (uno u otro, no ambos).
 */
export function startImpersonation(opts: {
  accessToken: string;
  user: any;
  tenant?: { id: string; brandName: string };
  affiliate?: { codeId: string; code: string; ownerName: string; role: string };
}) {
  const currentToken = getToken();
  const currentUser = getUser();
  const currentRefresh = getRefreshToken();
  if (currentToken && currentUser) {
    const stack = readImpersonationStack();
    stack.push({
      token: currentToken,
      refreshToken: currentRefresh,
      user: currentUser,
      tenant: opts.tenant,
      affiliate: opts.affiliate,
      startedAt: new Date().toISOString(),
    });
    writeImpersonationStack(stack);
  }
  // Borrar refresh actual: el access que recibimos de impersonate NO viene
  // con un refresh propio del owner impersonado, así que dejar el del super
  // admin haría que el refresh-on-401 cambie el contexto al super admin.
  document.cookie = 'clubify_refresh=; path=/; max-age=0';
  setSession(opts.accessToken, opts.user);
}

/** Devuelve el TOPE de la pila (el nivel al que se vuelve), o null. */
export function getImpersonationBackup(): ImpersonationBackup | null {
  const stack = readImpersonationStack();
  return stack.length ? stack[stack.length - 1] : null;
}

/**
 * Restaura UN nivel: saca el tope de la pila y vuelve a esa sesión. Devuelve
 * true si quedó restaurada. Permite volver Fidelia ← marca ← negocio paso a
 * paso (cada click sube un nivel).
 */
export function stopImpersonation() {
  const stack = readImpersonationStack();
  const backup = stack.pop();
  if (!backup) return false;
  writeImpersonationStack(stack);
  setSession(backup.token, backup.user, {
    refreshToken: backup.refreshToken ?? undefined,
  });
  return true;
}

/** Promesa de refresh en curso — si dos requests fallan con 401 al mismo
 *  tiempo, ambos esperan al MISMO refresh en lugar de disparar dos. */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Intenta cambiar el refreshToken por un accessToken nuevo. Retorna el
 * access nuevo o null si el refresh es inválido/ausente. Single-flight para
 * evitar tormenta de refreshes ante un burst de 401s.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = getRefreshToken();
  if (!refresh) return null;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!data?.accessToken) return null;
      writeAccessCookie(data.accessToken, 60 * 60);
      if (data.refreshToken) writeRefreshCookie(data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  return apiWithRefresh<T>(path, init, true);
}

async function apiWithRefresh<T>(
  path: string,
  init: RequestInit,
  allowRetry: boolean,
): Promise<T> {
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

    // Cuenta suspendida: redirige a billing para que reactive. Salimos
    // con un promise pendiente — la página está navegando y no queremos
    // que el throw genere un unhandled rejection en consola.
    if (res.status === 402 || body?.code === 'TENANT_SUSPENDED') {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/app/billing')) {
        window.location.href = '/app/billing?suspended=1';
        return new Promise<T>(() => {}); // never resolves — page is unloading
      }
    }
    // 401: el JWT default expira a los 15min y la cookie a los 60min.
    // Antes el wrapper limpiaba la sesión y mandaba al login a la primera
    // 401 — sacando al user cada cuarto de hora aunque el refresh siguiera
    // vivo (30d). Ahora intentamos UN refresh y reintentamos el request
    // original. Si el refresh falla (refresh ausente/expirado/revocado)
    // recién ahí limpiamos la sesión.
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      allowRetry &&
      !path.startsWith('/auth/refresh') &&
      !path.startsWith('/auth/login')
    ) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return apiWithRefresh<T>(path, init, false);
      }
      const onLogin = window.location.pathname.startsWith('/login');
      const hadSession = !!token || !!localStorage.getItem('clubify_user');
      if (hadSession && !onLogin) {
        clearSession();
        window.location.href = '/login?expired=1';
      }
    }

    const err: any = new Error(
      typeof msg === 'string' ? msg : JSON.stringify(msg),
    );
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }
  if (res.status === 204) return undefined as unknown as T;
  // NestJS serializa `null` como body VACÍO (no como string "null"), así
  // que cualquier endpoint que devuelva null cuando no hay datos (ej.
  // findFirst sin row) rompía con "Unexpected end of JSON input" al
  // intentar res.json() directo. Leemos como texto y parseamos defensivo
  // — vacío → null, "null" → null, JSON válido → parse OK.
  const text = await res.text();
  if (!text) return null as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
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
