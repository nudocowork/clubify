'use client';
/**
 * «Instalar en mi celular»: pide al servidor un pase de PRUEBA con el diseño en
 * pantalla (POST /wallet/laboratorio/pase) y muestra dos QR, uno para iPhone y
 * otro para Android. El pase no queda atado a ningún negocio ni cliente.
 *
 * Solo funciona con sesión del equipo de la plataforma (SUPER_ADMIN, MARKETING,
 * PLATFORM_OWNER): el servidor firma con el certificado de Clubify.
 */
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import type { ConfigFranja } from '@/lib/cards/estilos-de-franja';

type Resultado = { id: string; appleUrl: string | null; googleUrl: string | null; franjaUrl: string };

/**
 * Achica una imagen antes de mandarla: el servidor acepta hasta 2,5 MB por
 * imagen, y una foto del celular pesa más. PNG para íconos (transparencia),
 * JPEG para la portada (es una foto).
 */
async function achicar(url: string | null | undefined, lado: number, tipo: 'image/png' | 'image/jpeg') {
  if (!url || !url.startsWith('data:image/')) return url ?? null;
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = Math.min(1, lado / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * k));
  cv.height = Math.max(1, Math.round(img.height * k));
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL(tipo, 0.85);
}

async function prepararConfig(c: ConfigFranja): Promise<ConfigFranja> {
  return {
    ...c,
    portada: await achicar(c.portada, 1200, 'image/jpeg'),
    iconoImagen: await achicar(c.iconoImagen, 400, 'image/png'),
    posiciones: c.posiciones
      ? await Promise.all(c.posiciones.map(async (p) => ({ ...p, imagen: await achicar(p.imagen, 400, 'image/png') })))
      : undefined,
  };
}

export function InstalarEnCelular({ c, negocio, titular }: { c: ConfigFranja; negocio: string; titular: string }) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);

  const crear = async () => {
    setAbierto(true);
    setCargando(true);
    setError(null);
    setRes(null);
    try {
      const config = await prepararConfig(c);
      const r = await api<Resultado>('/wallet/laboratorio/pase', {
        method: 'POST',
        body: JSON.stringify({ config, negocio, titular }),
      });
      setRes(r);
    } catch (e: any) {
      const m = String(e?.message ?? e);
      setError(
        /401|403|unauthor|forbidden|denegad/i.test(m)
          ? 'Para instalar necesitas haber iniciado sesión con tu cuenta del equipo de Clubify en este navegador. Entra al panel de administración y vuelve a esta página.'
          : m,
      );
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-primary" onClick={crear} disabled={cargando}>
        {cargando ? 'Armando el pase…' : 'Instalar en mi celular'}
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAbierto(false);
          }}
        >
          <div className="card card-pad w-full max-w-lg space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-base font-semibold">Instalar la tarjeta de prueba</div>
                <p className="text-xs text-mute mt-0.5">
                  Escanea el código con la cámara del celular. Es una tarjeta de prueba: no suma sellos ni se actualiza;
                  si cambias el diseño, arma otra.
                </p>
              </div>
              <button type="button" className="text-mute hover:text-ink" aria-label="Cerrar" onClick={() => setAbierto(false)}>
                ✕
              </button>
            </div>

            {cargando && <div className="pulse-soft h-48" />}
            {error && <p className="text-sm text-bad bg-red-50 rounded-input px-3 py-2">{error}</p>}

            {res && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Codigo titulo="iPhone · Apple Wallet" url={res.appleUrl} faltante="Apple Wallet no está configurado en el servidor." />
                <Codigo titulo="Android · Google Wallet" url={res.googleUrl} faltante="Google Wallet no está configurado en el servidor." />
              </div>
            )}
            {res && (
              <p className="text-[11px] text-mute">
                En Google la franja va abajo, en grande; en Apple, en el centro. Las letras Elegante e Impacto salen con la
                letra que tenga instalada el servidor, que puede no ser la misma de la vista previa.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Codigo({ titulo, url, faltante }: { titulo: string; url: string | null; faltante: string }) {
  return (
    <div className="rounded-card border border-line p-3 flex flex-col items-center gap-2 text-center">
      <div className="text-sm font-semibold">{titulo}</div>
      {url ? (
        <>
          <div className="bg-white p-2 rounded-lg">
            <QRCodeSVG value={url} size={168} />
          </div>
          <a href={url} target="_blank" rel="noreferrer" className="btn-link text-xs">
            ¿Estás en el celular? Ábrelo aquí
          </a>
        </>
      ) : (
        <p className="text-xs text-mute">{faltante}</p>
      )}
    </div>
  );
}
