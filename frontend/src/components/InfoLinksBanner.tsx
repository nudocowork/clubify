/* eslint-disable @next/next/no-img-element */
// Banner promocional del feature InfoLinks: dos iPhones tilted con
// capturas reales (iframes scaled) de INFOLINKS creados con Clubify
// (Nudo Cowork + Motilart) — la mini-página estilo Linktree, no el menú.
// Botón "Ver ejemplo →" debajo de cada uno abre el InfoLink público real
// en una nueva pestaña.

import Link from 'next/link';

function Phone({
  width = 220,
  children,
}: {
  width?: number;
  children: React.ReactNode;
}) {
  const height = (width * 640) / 320;
  return (
    <div
      className="relative bg-[#0a0a0a] rounded-[36px] p-[7px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.4),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]"
      style={{ width, height }}
    >
      <div className="absolute top-[7px] left-1/2 -translate-x-1/2 w-[80px] h-[20px] bg-black rounded-b-[14px] z-20" />
      <div className="w-full h-full rounded-[28px] overflow-hidden relative bg-white">
        {children}
      </div>
    </div>
  );
}

/**
 * Iframe escalado al tamaño del Phone. Renderiza la URL real con un
 * viewport mobile (375×812 ~ iPhone Pro) y usa transform scale para
 * encajarlo dentro del frame chico de la landing. Cada visitante de
 * la landing carga 2 iframes; usamos `loading="lazy"` para diferir el
 * fetch hasta que el banner entra en viewport y NO bloquear LCP.
 *
 * El ?mesa=1 que pasa el user en las URLs activa el modo informativo
 * del storefront (sin botón "agregar al carrito"), ideal para preview
 * comercial.
 */
function ScreenIframe({
  src,
  phoneWidth,
  title,
}: {
  src: string;
  phoneWidth: number;
  title: string;
}) {
  // Phone interior (sin border padding): width-14, height-14
  const innerW = phoneWidth - 14;
  const innerH = (phoneWidth * 640) / 320 - 14;
  // Viewport mobile real
  const realW = 375;
  const realH = (realW * innerH) / innerW;
  const scale = innerW / realW;
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      // pointer-events-none evita que el iframe capture scroll/click
      // de los visitantes — el botón "Ver ejemplo" abajo es el CTA real.
      style={{ pointerEvents: 'none' }}
    >
      <iframe
        src={src}
        title={title}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        scrolling="no"
        style={{
          width: realW,
          height: realH,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          border: 0,
          background: '#fff',
        }}
      />
    </div>
  );
}

// Los mockups CSS (ScreenNudoCowork / ScreenMotilart) fueron
// reemplazados por iframes reales con el contenido del menú publicado
// — ver `ScreenIframe` arriba.

export type InfolinkDemo = {
  rotate: number;
  floatDelay: number;
  brandName: string;
  demoHref: string;
  title: string;
};

// Demos por DEFAULT (marca Clubify): menús reales de clientes de Clubify.
// ⚠️ NO usar en marcas blancas — apuntan a soyclubify.com (fuga de marca). Las
// marcas blancas deben pasar sus propios demos o `[]` para ocultar los iPhones.
const CLUBIFY_DEMOS: InfolinkDemo[] = [
  {
    rotate: -8,
    floatDelay: 0,
    brandName: 'Nudo Cowork',
    demoHref: 'https://soyclubify.com/i/nudocowork/mi-nuevo-link-4',
    title: 'InfoLink de Nudo Cowork',
  },
  {
    rotate: 8,
    floatDelay: 1,
    brandName: 'Motilart',
    demoHref: 'https://soyclubify.com/i/motilart/mi-nuevo-link-1',
    title: 'InfoLink de Motilart',
  },
];

export function InfoLinksBanner({
  demos = CLUBIFY_DEMOS,
  hideCtas,
}: {
  /** Menús de ejemplo (iPhones). Default = clientes de Clubify. Una marca
   *  blanca debe pasar los suyos o `[]` para no mostrar dominios ajenos. */
  demos?: InfolinkDemo[];
  /** Oculta el CTA "Ver planes y comenzar" (clon de /informacion). Default false. */
  hideCtas?: boolean;
} = {}) {
  const showDemos = demos.length > 0;
  return (
    <>
      <style>{`
        @keyframes clb-info-floaty {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
      <section className="relative overflow-hidden bg-bg2/40 border-y border-line/80 py-12 sm:py-16 lg:py-20">
        <div
          className={`mx-auto max-w-7xl px-5 sm:px-6 grid grid-cols-1 gap-10 lg:gap-12 items-center ${
            showDemos ? 'lg:grid-cols-[1fr_1.2fr]' : ''
          }`}
        >
          {/* Columna izquierda: descripción + beneficios + CTA */}
          <div className="text-center lg:text-left">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              InfoLinks
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]">
              Tu InfoLink se crea en{' '}
              <span className="text-brand">menos de 2 minutos</span>
            </h2>
            <p className="text-mute text-sm sm:text-base mt-4 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Comparte el link en tu bio de Instagram, WhatsApp y QR de mesa.
              Adentro: menú, eventos, promociones, ubicación, redes y tarjeta
              de fidelización — todo en un solo lugar.
            </p>

            {!hideCtas && (
            <div className="flex justify-center lg:justify-start mt-6 sm:mt-8">
              <Link
                href="#precios"
                className="inline-flex items-center justify-center px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-ink text-white font-semibold shadow-md hover:opacity-90 transition text-sm sm:text-base"
              >
                Ver planes y comenzar
              </Link>
            </div>
            )}
          </div>

          {/* Columna derecha: iPhones tilted con infolinks reales. Cada phone
              incluye un botón "Ver ejemplo" que abre el link público real. Solo
              se renderiza si la marca tiene demos (las blancas pasan [] para no
              mostrar dominios ajenos). */}
          {showDemos && (
            <div className="relative flex items-end justify-center gap-2 sm:gap-4 lg:gap-6">
              {demos.map((d) => (
                <InfolinkCard
                  key={d.demoHref}
                  rotate={d.rotate}
                  floatDelay={d.floatDelay}
                  brandName={d.brandName}
                  demoHref={d.demoHref}
                  title={d.title}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** Card que envuelve un iPhone tilted con iframe del menú real + label
 *  "Ver ejemplo →" debajo. Renderea 3 iframes (uno por breakpoint) — el
 *  iframe oculto via `hidden` no se monta DOM tampoco no carga el src.
 *  Eso evita 6 cargas paralelas; lazy + sandbox completan el budget. */
function InfolinkCard({
  rotate,
  floatDelay,
  brandName,
  demoHref,
  title,
}: {
  rotate: number;
  floatDelay: number;
  brandName: string;
  demoHref: string;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative"
        style={{ transform: `rotate(${rotate}deg)`, zIndex: 1 }}
      >
        <div
          style={{
            animation: `clb-info-floaty 4s ease-in-out ${floatDelay}s infinite`,
          }}
        >
          <div className="hidden lg:block">
            <Phone width={200}>
              <ScreenIframe src={demoHref} phoneWidth={200} title={title} />
            </Phone>
          </div>
          <div className="hidden sm:block lg:hidden">
            <Phone width={170}>
              <ScreenIframe src={demoHref} phoneWidth={170} title={title} />
            </Phone>
          </div>
          <div className="block sm:hidden">
            <Phone width={140}>
              <ScreenIframe src={demoHref} phoneWidth={140} title={title} />
            </Phone>
          </div>
        </div>
      </div>

      <a
        href={demoHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-ink hover:text-brand transition"
        title={`Abrir el InfoLink real de ${brandName}`}
      >
        <span className="text-mute font-medium">{brandName}</span>
        <span className="text-brand">· Ver ejemplo →</span>
      </a>
    </div>
  );
}
