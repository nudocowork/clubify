// Preview de opciones de íconos / formatos de sellos para la wallet.
// La idea: los emojis renderizan como silueta negra en el .pkpass (limitación
// de librsvg). Aquí comparamos varias alternativas inline-SVG que SIEMPRE se
// ven bien en Apple/Google Wallet.

type StampVariant = {
  name: string;
  hint: string;
  iconFilled: React.ReactNode;
};

// Tamaño base del círculo dentro del strip preview (px).
const R = 36;
const ICON_SIZE = R * 1.05; // ~50% del diámetro

function Circle({ filled, children }: { filled: boolean; children?: React.ReactNode }) {
  return (
    <div
      className="rounded-full flex items-center justify-center"
      style={{
        width: R * 2,
        height: R * 2,
        background: filled ? '#FFFFFF' : 'rgba(255,255,255,.13)',
        boxShadow: filled
          ? '0 4px 10px -2px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.55)'
          : 'none',
      }}
    >
      {children}
    </div>
  );
}

// === COOKIES === (cinco estilos distintos para el caso del usuario actual)

function CookieClassic({ size = ICON_SIZE }: { size?: number }) {
  // Galleta clásica color marrón + chips de chocolate
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="26" fill="#C48B57" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="#8C5A2E" strokeWidth="1.5" opacity=".5" />
      <circle cx="22" cy="24" r="3.5" fill="#3E2723" />
      <circle cx="40" cy="22" r="2.8" fill="#3E2723" />
      <circle cx="36" cy="38" r="3.2" fill="#3E2723" />
      <circle cx="22" cy="40" r="2.5" fill="#3E2723" />
      <circle cx="44" cy="36" r="2.2" fill="#3E2723" />
    </svg>
  );
}

function CookieMonoBrand({ size = ICON_SIZE, color = '#16A34A' }: { size?: number; color?: string }) {
  // Galleta monocromática en color de marca — minimalista plano
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="26" fill={color} />
      <circle cx="23" cy="25" r="3" fill="#FFFFFF" />
      <circle cx="41" cy="24" r="2.5" fill="#FFFFFF" />
      <circle cx="36" cy="38" r="3" fill="#FFFFFF" />
      <circle cx="22" cy="40" r="2.2" fill="#FFFFFF" />
    </svg>
  );
}

function CookieOutline({ size = ICON_SIZE, color = '#16A34A' }: { size?: number; color?: string }) {
  // Estilo línea — outlined, sin relleno
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="32" cy="32" r="24" />
      <circle cx="24" cy="26" r="2.5" fill={color} />
      <circle cx="40" cy="24" r="2" fill={color} />
      <circle cx="36" cy="38" r="2.8" fill={color} />
      <circle cx="22" cy="40" r="1.8" fill={color} />
    </svg>
  );
}

function CookieBite({ size = ICON_SIZE }: { size?: number }) {
  // Galleta con mordida — más juguetona
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <defs>
        <mask id="bite">
          <rect width="100%" height="100%" fill="white" />
          <path d="M50 14 a 10 10 0 0 1 0 14 a 6 6 0 0 0 -6 6 a 8 8 0 0 1 -10 -2 Z" fill="black" />
        </mask>
      </defs>
      <g mask="url(#bite)">
        <circle cx="32" cy="32" r="26" fill="#C48B57" />
        <circle cx="32" cy="32" r="26" fill="none" stroke="#8C5A2E" strokeWidth="1.5" opacity=".5" />
      </g>
      <circle cx="22" cy="26" r="3" fill="#3E2723" />
      <circle cx="28" cy="40" r="2.5" fill="#3E2723" />
      <circle cx="40" cy="36" r="2.8" fill="#3E2723" />
      <circle cx="20" cy="36" r="2.2" fill="#3E2723" />
    </svg>
  );
}

function CookieGourmet({ size = ICON_SIZE }: { size?: number }) {
  // Galleta con sombra interna + gradiente — look "premium"
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <defs>
        <radialGradient id="gourmet" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#E2B07C" />
          <stop offset="100%" stopColor="#A26B3C" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="url(#gourmet)" />
      <circle cx="22" cy="24" r="3.2" fill="#2D1810" />
      <circle cx="40" cy="22" r="2.5" fill="#2D1810" />
      <circle cx="36" cy="38" r="3" fill="#2D1810" />
      <circle cx="22" cy="40" r="2.2" fill="#2D1810" />
      <circle cx="44" cy="34" r="2" fill="#2D1810" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="1" />
    </svg>
  );
}

// === FORMATOS DE SELLOS === (cinco formatos completamente diferentes)

function StampCheck({ size = ICON_SIZE, color = '#16A34A' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 12 10 18 20 6" />
    </svg>
  );
}

function StampStar({ size = ICON_SIZE, color = '#F59E0B' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <polygon points="12 2 14.9 8.6 22 9.3 16.7 14.1 18.3 21.1 12 17.5 5.7 21.1 7.3 14.1 2 9.3 9.1 8.6" fill={color} />
    </svg>
  );
}

function StampLetter({ size = ICON_SIZE, color = '#16A34A', letter = 'C' }: { size?: number; color?: string; letter?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 800,
        fontSize: size * 0.7,
        color,
      }}
    >
      {letter}
    </div>
  );
}

function StampDot({ size = ICON_SIZE, color = '#16A34A' }: { size?: number; color?: string }) {
  return (
    <div
      style={{
        width: size * 0.5,
        height: size * 0.5,
        borderRadius: '50%',
        background: color,
      }}
    />
  );
}

function StampNumber({ size = ICON_SIZE, color = '#16A34A', n = 1 }: { size?: number; color?: string; n?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 700,
        fontSize: size * 0.55,
        color,
      }}
    >
      {n}
    </div>
  );
}

// === STRIP RENDERER === recrea el strip del wallet para cada variante

function StripRow({
  required = 10,
  filled = 2,
  IconComp,
  iconProps = {},
}: {
  required?: number;
  filled?: number;
  IconComp: React.ComponentType<any>;
  iconProps?: Record<string, any>;
}) {
  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, #16A34A 0%, #22C55E 100%)',
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 55%, rgba(0,0,0,.10) 100%)',
        }}
      />
      <div className="relative flex flex-wrap items-center justify-center gap-3">
        {Array.from({ length: required }).map((_, i) => {
          const isFilled = i < filled;
          return (
            <Circle key={i} filled={isFilled}>
              {isFilled ? <IconComp {...iconProps} /> : null}
            </Circle>
          );
        })}
      </div>
    </div>
  );
}

function VariantCard({
  title,
  subtitle,
  recommended,
  children,
}: {
  title: string;
  subtitle: string;
  recommended?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card card-pad relative">
      {recommended && (
        <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-900 px-2 py-1 rounded-full">
          Recomendado
        </span>
      )}
      <h3 className="font-bold text-lg">{title}</h3>
      <p className="text-sm text-mute mt-1 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

export default function WalletStampIconsPreview() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <header className="mb-10">
          <div className="text-[11px] tracking-[0.2em] uppercase text-mute font-semibold">
            Preview · paso 1
          </div>
          <h1 className="text-2xl font-bold mt-1">
            Formatos de sello para Apple/Google Wallet
          </h1>
          <p className="text-sm text-mute mt-2 max-w-2xl leading-relaxed">
            El emoji <strong>🍪</strong> renderiza como silueta negra dentro del
            .pkpass por limitaciones de librsvg. Reemplazándolo por SVG inline
            podemos garantizar look limpio en cualquier dispositivo. Aquí
            comparamos opciones. Elige una y la implemento server-side.
          </p>
        </header>

        <section className="mb-10">
          <h2 className="font-bold text-lg mb-4">A · Variantes de cookie (5 estilos)</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <VariantCard
              title="A1 · Clásica color"
              subtitle="Marrón con chocolate chips. Reconocible al primer vistazo."
              recommended
            >
              <StripRow IconComp={CookieClassic} />
            </VariantCard>
            <VariantCard
              title="A2 · Mono color de marca"
              subtitle="Galleta plana en color de la marca + chips blancos. Minimalista."
            >
              <StripRow IconComp={CookieMonoBrand} />
            </VariantCard>
            <VariantCard
              title="A3 · Outline (línea)"
              subtitle="Línea fina. Look editorial. Funciona mejor en cards oscuras."
            >
              <StripRow IconComp={CookieOutline} />
            </VariantCard>
            <VariantCard
              title="A4 · Cookie con mordida"
              subtitle="Más juguetona. Brief: 'amigable'. Detalle reconocible."
            >
              <StripRow IconComp={CookieBite} />
            </VariantCard>
            <VariantCard
              title="A5 · Gourmet (gradient)"
              subtitle="Sombra interna + gradiente radial. Look premium tipo Starbucks."
            >
              <StripRow IconComp={CookieGourmet} />
            </VariantCard>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="font-bold text-lg mb-4">B · Formatos alternativos (no necesariamente galletas)</h2>
          <p className="text-sm text-mute mb-4 -mt-2">
            Si quieres algo todavía más minimalista — independiente del rubro.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <VariantCard
              title="B1 · Check ✓"
              subtitle="El más limpio. Starbucks-style. Universal."
            >
              <StripRow IconComp={StampCheck} />
            </VariantCard>
            <VariantCard
              title="B2 · Estrella"
              subtitle="Gamificación. Funciona para programas de puntos."
            >
              <StripRow IconComp={StampStar} />
            </VariantCard>
            <VariantCard
              title="B3 · Letra de la marca"
              subtitle="Primera letra del nombre del negocio (aquí: 'C' de Café)."
            >
              <StripRow IconComp={StampLetter} iconProps={{ letter: 'C' }} />
            </VariantCard>
            <VariantCard
              title="B4 · Punto sólido"
              subtitle="Mínimo absoluto. Solo un círculo más pequeño centrado."
            >
              <StripRow IconComp={StampDot} />
            </VariantCard>
            <VariantCard
              title="B5 · Numerado"
              subtitle="Muestra el número del sello. Útil para programas largos."
            >
              <StripRow
                IconComp={StampNumber}
                iconProps={{ n: 1 }}
              />
            </VariantCard>
          </div>
        </section>

        <section className="card card-pad bg-white">
          <h2 className="font-bold text-lg">Próximo paso</h2>
          <p className="text-sm text-mute mt-2">
            Dime el código (ej. <strong>A1</strong>, <strong>A5</strong>,{' '}
            <strong>B1</strong>…) y lo cableo al generador del .pkpass
            server-side. El tenant podrá seguir cambiando el ícono por categoría
            (cookie / coffee / fitness / etc.) pero el render usará SVG inline
            en vez de emoji, garantizando consistencia visual en cualquier
            dispositivo.
          </p>
        </section>
      </div>
    </div>
  );
}
