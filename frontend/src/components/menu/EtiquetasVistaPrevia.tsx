'use client';
/**
 * Botón «i» junto al campo «Etiquetas» del editor de producto: abre una vista
 * previa de cómo se verán ESAS etiquetas en el menú público, con el ESTILO de
 * menú que el negocio tiene elegido y su color.
 *
 * Por qué: el campo es texto libre y el negocio no tenía forma de saber qué
 * hacía con lo que escribía. En casi todos los estilos la tarjeta del producto
 * enseña SOLO la primera etiqueta (o «Recomendado» si está destacado) y el
 * resto aparece al abrir el producto; y solo algunas palabras (nuevo, popular,
 * promo…) tienen color propio. Sin verlo, se escribían cinco etiquetas
 * esperando ver cinco.
 *
 * La vista reutiliza los MISMOS componentes de etiqueta del menú público
 * (`ProductBadge` / `PrimaryProductBadge`) y replica el marcado de cada
 * estilo de `app/m/[slug]/storefront-client.tsx`. Si allí cambia cómo se
 * pinta una etiqueta, hay que cambiarlo aquí también.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ProductBadge, PrimaryProductBadge } from '@/components/storefront/ProductBadge';

export type EstiloDeMenu =
  | 'CLASSIC'
  | 'GRID'
  | 'CAROUSELS'
  | 'CLEAN'
  | 'COMPACT'
  | 'CLUVI'
  | 'SECTIONS'
  | 'FLIPBOOK';

/** Estilos en los que la tarjeta pinta TODAS las etiquetas (el resto, solo la
 *  primera). Sale de leer cada Layout* del menú público. */
const TODAS_EN_LA_TARJETA: EstiloDeMenu[] = ['CLASSIC'];

export function EtiquetasVistaPrevia({
  tags,
  estilo,
  color,
  destacado,
  nombre,
  precio,
  imagen,
}: {
  tags: string[];
  /** null = aún no se sabe (cargando): se asume el estilo por defecto. */
  estilo: EstiloDeMenu | null;
  /** Color del negocio (el mismo `primaryColor` que usa el menú público). */
  color: string;
  /** `isRecommended`: en la tarjeta antepone «Recomendado» a las etiquetas. */
  destacado: boolean;
  nombre: string;
  precio: string;
  imagen?: string | null;
}) {
  const t = useTranslations('app_menu');
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const tituloId = useId();

  // FLIPBOOK ya no es un estilo de la carta (el libro vive en otra ruta): una
  // carta antigua con ese valor se ve como la clásica.
  const e: EstiloDeMenu = !estilo || estilo === 'FLIPBOOK' ? 'CLASSIC' : estilo;
  const etiquetas = tags.length > 0 ? tags : [];
  const nombreVisible = nombre.trim() || t('tagsPreviewSampleName');

  useEffect(() => {
    if (!abierto) return;
    cerrarRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setAbierto(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [abierto]);

  function cerrar() {
    setAbierto(false);
    // Devolver el foco al «i»: quien navega con teclado no pierde su sitio
    // dentro del formulario del producto.
    requestAnimationFrame(() => botonRef.current?.focus());
  }

  const nombreDelEstilo = t(`tagsPreviewLayout_${e}`);
  const soloLaPrimera = !TODAS_EN_LA_TARJETA.includes(e);

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        aria-label={t('tagsPreviewOpen')}
        title={t('tagsPreviewOpen')}
        className="ml-1.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line bg-white align-[-3px] text-[11px] font-bold italic leading-none text-mute transition hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        i
      </button>

      {/* Portal a <body>: el editor de producto es un panel lateral con su
          propio apilado y opacidad; dentro de él la ventana salía apagada y
          podía quedar recortada. */}
      {abierto && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          // El portal sigue burbujeando por el árbol de React: sin cortar
          // aquí, el clic de fuera llegaría al panel del producto.
          onClick={(ev) => {
            ev.stopPropagation();
            cerrar();
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={tituloId}
            onClick={(ev) => ev.stopPropagation()}
            className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 text-ink shadow-md2 sm:max-w-md sm:rounded-card"
          >
            <button
              ref={cerrarRef}
              type="button"
              onClick={cerrar}
              aria-label={t('tagsPreviewClose')}
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-sm text-ink hover:bg-bg2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              ✕
            </button>
            <h3 id={tituloId} className="m-0 pr-10 text-base font-semibold">
              {t('tagsPreviewTitle')}
            </h3>
            <p className="m-0 mt-1 text-xs text-mute">
              {t('tagsPreviewStyle')}{' '}
              <span className="rounded-pill bg-bg2 px-2 py-0.5 font-semibold text-ink">
                {nombreDelEstilo}
              </span>
            </p>

            {etiquetas.length === 0 && !destacado ? (
              <div className="mt-4 rounded-input border border-dashed border-line bg-bg2/50 px-4 py-6 text-center text-sm text-mute">
                {t('tagsPreviewEmpty')}
              </div>
            ) : (
              <>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
                  {t('tagsPreviewCard')}
                </div>
                <div
                  className={`mt-2 rounded-xl p-3 ${e === 'CLUVI' ? 'bg-[#0a0a0a]' : 'bg-[#FAFBFC] border border-line2'}`}
                >
                  <TarjetaDeEstilo
                    estilo={e}
                    tags={etiquetas}
                    destacado={destacado}
                    color={color}
                    nombre={nombreVisible}
                    precio={precio}
                    imagen={imagen ?? null}
                  />
                </div>

                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
                  {t('tagsPreviewDetail')}
                </div>
                {/* Igual que el detalle del producto del menú público: todas
                    las etiquetas libres, en el color del negocio. */}
                <div className="mt-2 rounded-xl border border-line2 bg-white p-3">
                  <div className="text-base font-bold leading-tight">{nombreVisible}</div>
                  {etiquetas.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {etiquetas.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                          style={{ background: `${color}1A`, color }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-mute">{t('tagsPreviewDetailNone')}</div>
                  )}
                </div>

                <ul className="m-0 mt-4 list-disc space-y-1 pl-4 text-xs leading-snug text-mute">
                  <li>{soloLaPrimera ? t('tagsPreviewOnlyFirst') : t('tagsPreviewAllInline')}</li>
                  {destacado && soloLaPrimera && <li>{t('tagsPreviewRecommended')}</li>}
                  <li>{t('tagsPreviewColors')}</li>
                </ul>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Foto del producto o el plato de relleno del menú público. */
function Foto({ imagen, className }: { imagen: string | null; className: string }) {
  return (
    <div className={`relative overflow-hidden bg-bg2 ${className}`}>
      {imagen ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagen} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl text-mute">🍽</div>
      )}
    </div>
  );
}

/** Una tarjeta de producto con el marcado del estilo elegido (versión
 *  estática de cada Layout* de storefront-client). */
function TarjetaDeEstilo({
  estilo,
  tags,
  destacado,
  color,
  nombre,
  precio,
  imagen,
}: {
  estilo: EstiloDeMenu;
  tags: string[];
  destacado: boolean;
  color: string;
  nombre: string;
  precio: string;
  imagen: string | null;
}) {
  switch (estilo) {
    case 'GRID':
      return (
        <div className="w-[min(100%,180px)]">
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg2">
            <Foto imagen={imagen} className="h-full w-full" />
            <PrimaryProductBadge tags={tags} recommended={destacado} variant="overlay" />
            <div
              className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full text-xl text-white shadow-lg"
              style={{ background: color }}
            >
              +
            </div>
          </div>
          <div className="mt-1.5 px-1">
            <div className="line-clamp-1 text-sm font-semibold leading-tight">{nombre}</div>
            <div className="mt-0.5 text-sm font-bold" style={{ color }}>
              {precio}
            </div>
          </div>
        </div>
      );
    case 'CAROUSELS':
      return (
        <div className="w-[140px]">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-bg2">
            <Foto imagen={imagen} className="h-full w-full" />
            <PrimaryProductBadge tags={tags} recommended={destacado} variant="overlay" />
          </div>
          <div className="mt-1 px-0.5">
            <div className="line-clamp-2 min-h-[2.4em] text-xs font-semibold leading-tight">{nombre}</div>
            <div className="mt-0.5 text-sm font-bold" style={{ color }}>
              {precio}
            </div>
          </div>
        </div>
      );
    case 'CLEAN':
      return (
        <div className="px-1 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 text-[15px] font-semibold">{nombre}</div>
            <div className="text-sm tracking-tight">{precio}</div>
          </div>
          {(tags[0] || destacado) && (
            <div className="mt-1.5">
              <PrimaryProductBadge tags={tags} recommended={destacado} variant="inline" />
            </div>
          )}
        </div>
      );
    case 'COMPACT':
      return (
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <div className="px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold">
                {nombre}
                <PrimaryProductBadge tags={tags} recommended={destacado} variant="inline" />
              </div>
              <div className="whitespace-nowrap text-sm font-bold">{precio}</div>
            </div>
          </div>
        </div>
      );
    case 'CLUVI':
      return (
        <div className="flex items-stretch overflow-hidden rounded-2xl bg-white text-left text-ink shadow-md">
          <div className="relative h-28 w-28 flex-none">
            <Foto imagen={imagen} className="h-full w-full" />
            <PrimaryProductBadge tags={tags} recommended={destacado} variant="overlay" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-3">
            <div className="text-base font-bold leading-tight">{nombre}</div>
            <div className="mt-2 flex flex-1 items-end justify-between gap-2">
              <div className="text-sm font-bold">{precio}</div>
              <span
                className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-ink"
                style={{ background: color }}
              >
                VER
              </span>
            </div>
          </div>
        </div>
      );
    case 'SECTIONS':
      return (
        <div className="w-[min(100%,170px)] overflow-hidden rounded-xl border border-line2 bg-white shadow-sm">
          <Foto imagen={imagen} className="aspect-square w-full" />
          <div className="p-2.5">
            <div className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight">{nombre}</div>
            {(tags[0] || destacado) && (
              <div className="mt-1">
                <PrimaryProductBadge tags={tags} recommended={destacado} variant="inline" />
              </div>
            )}
            <div className="mt-1.5 text-sm font-bold text-ink">{precio}</div>
          </div>
        </div>
      );
    case 'CLASSIC':
    default:
      // El clásico NO antepone «Recomendado»: pinta las etiquetas libres tal
      // cual, todas, junto al precio.
      return (
        <div className="flex overflow-hidden rounded-card border border-line bg-white">
          <Foto imagen={imagen} className="h-24 w-24 flex-none" />
          <div className="min-w-0 flex-1 p-3">
            <div className="text-sm font-semibold">{nombre}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-sm font-bold">{precio}</div>
              <div className="flex flex-wrap justify-end gap-1">
                {tags.map((tag) => (
                  <ProductBadge key={tag} tag={tag} variant="inline" />
                ))}
              </div>
            </div>
          </div>
          <div
            className="flex w-12 flex-none items-center justify-center text-xl text-white"
            style={{ background: color }}
          >
            +
          </div>
        </div>
      );
  }
}
