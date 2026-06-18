/**
 * Logo de Sellea según el manual de identidad: isotipo (un sello en proceso
 * de estamparse) + wordmark "sellea." en minúsculas con punto coral.
 *
 * ⚠️ El manual dice "usa siempre las versiones oficiales; nunca lo recrees".
 * Este es un SVG de APROXIMACIÓN para el preview — reemplazar por el asset
 * oficial (SVG/PNG) cuando esté disponible (subir a /public o pasar `src`).
 *
 * Colores: Coral #FF4D3D · Tinta #1A1033 · Blanco #FFFFFF.
 */
export function SelleaMark({
  size = 40,
  variant = 'light',
}: {
  size?: number;
  /** 'light' = ring tinta (fondos claros) · 'dark' = ring blanco (fondos oscuros). */
  variant?: 'light' | 'dark';
}) {
  const ring = variant === 'dark' ? '#FFFFFF' : '#1A1033';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {/* anillo base (sello) */}
      <circle cx="24" cy="24" r="18" stroke={ring} strokeWidth="3" />
      {/* arco coral "estampándose" (arriba-derecha) */}
      <path
        d="M24 6 A18 18 0 0 1 41 18"
        stroke="#FF4D3D"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* centro coral (la tinta del sello) */}
      <circle cx="24" cy="24" r="10" fill="#FF4D3D" />
    </svg>
  );
}

export function SelleaLogo({
  size = 34,
  variant = 'light',
}: {
  size?: number;
  variant?: 'light' | 'dark';
}) {
  const word = variant === 'dark' ? '#FFFFFF' : '#1A1033';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32 }}>
      <SelleaMark size={size} variant={variant} />
      <span
        style={{
          fontFamily: "'Poppins', sans-serif",
          fontWeight: 800,
          fontSize: size * 0.86,
          letterSpacing: '-1px',
          color: word,
          lineHeight: 1,
        }}
      >
        sellea<span style={{ color: '#FF4D3D' }}>.</span>
      </span>
    </span>
  );
}
