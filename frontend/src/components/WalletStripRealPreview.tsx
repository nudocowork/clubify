'use client';
/**
 * Preview REAL del cartón de sellos del Wallet.
 *
 * A diferencia del mock en CSS (círculos con ✓), este componente muestra la
 * imagen PNG EXACTA que el servidor (Sharp) genera y que el cliente recibe en
 * su Apple/Google Wallet — el mismo generador de producción (`generateStampsStrip`),
 * expuesto vía `POST /cards/preview-strips`. Renderiza los 3 estados: vacío,
 * a mitad y completo.
 *
 * - Usa el helper `api()` (agrega el Bearer automáticamente) → sin problemas de
 *   auth en <img> (las imágenes vienen como data URLs base64 en el JSON).
 * - Debounce ~400ms: re-genera cuando cambian color / cantidad / ícono, sin
 *   martillar el backend en cada tecla.
 * - Degradación: si el endpoint falla, no rompe la pantalla — muestra un aviso
 *   sutil y el caller mantiene su mock CSS como respaldo.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/** Config que espera `POST /cards/preview-strips` (DTO PreviewStripsBody). Solo
 *  estas claves se envían — el backend usa whitelist + forbidNonWhitelisted. */
export type StripPreviewConfig = {
  primaryColor?: string;
  secondaryColor?: string;
  stampsRequired?: number;
  stampIcon?: string;
  stampIconImageUrl?: string | null;
  stampActiveColor?: string | null;
  stampInactiveColor?: string | null;
  stampContourColor?: string | null;
  centerBgColor?: string | null;
  heroImageUrl?: string | null;
  stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
  stampBgImageUrl?: string | null;
  freeRewards?: Array<{
    pos: number;
    text?: string | null;
    emoji?: string | null;
    circleColor?: string | null;
    textColor?: string | null;
    active?: boolean;
  }>;
};

type Strips = { empty: string; half: string; full: string };

const STRIP_KEYS: (keyof StripPreviewConfig)[] = [
  'primaryColor',
  'secondaryColor',
  'stampsRequired',
  'stampIcon',
  'stampIconImageUrl',
  'stampActiveColor',
  'stampInactiveColor',
  'stampContourColor',
  'centerBgColor',
  'heroImageUrl',
  'stampBgType',
  'stampBgImageUrl',
  'freeRewards',
];

/** Deja solo las claves del DTO (evita mandar campos extra → 400 por whitelist). */
function pickConfig(cfg: StripPreviewConfig): StripPreviewConfig {
  const out: Record<string, unknown> = {};
  for (const k of STRIP_KEYS) {
    const v = cfg[k];
    if (v !== undefined) out[k] = v;
  }
  return out as StripPreviewConfig;
}

export function WalletStripRealPreview({
  config,
  className = '',
  debounceMs = 400,
}: {
  config: StripPreviewConfig;
  className?: string;
  debounceMs?: number;
}) {
  const [strips, setStrips] = useState<Strips | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Cancela respuestas viejas cuando la config cambió mientras se generaba.
  const reqId = useRef(0);

  // Serializamos la config para dispararnos solo cuando algo relevante cambia.
  const payload = pickConfig(config);
  const key = JSON.stringify(payload);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(false);
    const t = setTimeout(() => {
      api<Strips>('/cards/preview-strips', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
        .then((res) => {
          if (id !== reqId.current) return; // llegó una config más nueva
          if (res && res.empty && res.half && res.full) {
            setStrips(res);
            setError(false);
          } else {
            setError(true);
          }
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setError(true);
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, debounceMs);
    return () => clearTimeout(t);
    // key resume toda la config relevante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);

  const states: { label: string; src: keyof Strips }[] = [
    { label: 'Vacío', src: 'empty' },
    { label: 'A mitad', src: 'half' },
    { label: 'Completo', src: 'full' },
  ];

  return (
    <div className={className}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {states.map((s) => (
          <div key={s.src} className="flex flex-col items-center gap-1.5">
            <div className="relative w-full overflow-hidden rounded-xl bg-black/5 aspect-[640/246]">
              {strips && !error ? (
                <img
                  src={strips[s.src]}
                  alt={`Cartón de sellos ${s.label.toLowerCase()}`}
                  className="w-full h-full object-cover"
                  style={{
                    opacity: loading ? 0.55 : 1,
                    transition: 'opacity .2s ease',
                  }}
                />
              ) : (
                <div className="w-full h-full grid place-items-center">
                  {error ? (
                    <span className="text-[10px] text-mute px-2 text-center">
                      Preview no disponible
                    </span>
                  ) : (
                    <span className="inline-block w-5 h-5 rounded-full border-2 border-black/15 border-t-black/40 animate-spin" />
                  )}
                </div>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
              {s.label}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <div className="mt-2 text-[10px] text-mute text-center">
          No se pudo generar la imagen real — se muestra la vista previa aproximada.
        </div>
      )}
    </div>
  );
}
