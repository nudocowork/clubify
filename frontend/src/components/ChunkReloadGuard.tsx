"use client";
import { useEffect } from "react";

const RELOAD_KEY = "__chunk_reload_at__";
const COOLDOWN_MS = 20_000; // anti-bucle: no recargar dos veces seguidas

export function isChunkError(message?: string | null): boolean {
  if (!message) return false;
  return (
    /ChunkLoadError/i.test(message) ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

export function reloadForNewVersion(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
    if (Date.now() - last < COOLDOWN_MS) return; // ya recargamos hace poco → parar
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* modo privado: recargamos igual una vez */
  }
  window.location.reload();
}

export function ChunkReloadGuard() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.message) || isChunkError((e.error as Error | undefined)?.message)) {
        reloadForNewVersion();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as unknown;
      const msg = typeof r === "string" ? r : (r as Error | undefined)?.message;
      if (isChunkError(msg)) reloadForNewVersion();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
