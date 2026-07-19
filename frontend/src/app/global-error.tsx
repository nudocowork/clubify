"use client";
import { useEffect } from "react";
import { isChunkError, reloadForNewVersion } from "@/components/ChunkReloadGuard";

// Reemplaza el layout raíz → estilos inline (ajusta los colores a tu marca).
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (isChunkError(error?.message)) reloadForNewVersion();
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#0B1F14",
        color: "#F8FAFC", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🔄</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            Actualizando a la versión más reciente
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#CBD5E1", margin: "0 0 20px" }}>
            Hubo un pequeño desajuste al cargar. Recarga para continuar con la última versión.
          </p>
          <button onClick={() => window.location.reload()} style={{ cursor: "pointer",
            border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 15,
            fontWeight: 600, color: "#06251A", background: "#22C55E" }}>
            Recargar
          </button>
        </div>
      </body>
    </html>
  );
}
