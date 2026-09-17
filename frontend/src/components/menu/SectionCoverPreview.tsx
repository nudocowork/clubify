'use client';

import { useMemo } from 'react';
import {
  normalizeCoverConfig,
  type SectionCoverConfig,
  type CoverTextStyle,
} from '@/lib/menu/section-cover-config';
import {
  IMAGEN_DE_PORTADA,
  ajusteDeLaPortada,
  imagenDelMenu,
  posicionDeLaPortada,
} from '@/lib/menu/imagen-del-menu.mjs';

/**
 * Render visual de la portada de una sección. Mismo componente para:
 * - storefront público (layout SECTIONS)
 * - admin tab "Secciones" (thumbnails del grid)
 * - editor live preview
 *
 * CSS puro — sin Konva, sin canvas. La idea es que sea ligero y
 * rinda bien en mobile (las cards van a aparecer en listas largas).
 *
 * Props:
 * - config: SectionCoverConfig (puede ser null/objeto raw — se
 *   normaliza adentro)
 * - title: nombre de la sección a mostrar
 * - tagline: subtítulo opcional (override del config.tagline)
 * - badgeText: override del config.badgeText
 * - scale: factor de escala para el thumbnail (0.4 para mini, 1
 *   para storefront)
 */
export function SectionCoverPreview({
  config,
  title,
  tagline,
  badgeText,
  scale = 1,
  className,
}: {
  config: unknown;
  title: string;
  tagline?: string | null;
  badgeText?: string | null;
  scale?: number;
  className?: string;
}) {
  const cfg = useMemo(() => normalizeCoverConfig(config), [config]);

  const align = cfg.align;
  const vAlign = cfg.verticalAlign;

  // Justify horizontal del flex.
  const justifyContent =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const alignItems =
    vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center';
  const textAlign = align;

  const height = cfg.height * scale;

  const containerStyle: React.CSSProperties = {
    height,
    borderRadius: cfg.borderRadius * scale,
    backgroundColor: cfg.bgColor,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  };

  // La portada era un `background-image` con la URL cruda del bucket: el
  // cliente se bajaba la original (las 15 de Konys, 5 MB) y TODAS a la vez,
  // también las que quedaban muy por debajo en la lista de secciones. Como
  // `<img>` pasa por el optimizador con `srcset` —el navegador elige el ancho—
  // y es perezosa. `object-fit`/`object-position` la pintan igual que el fondo.
  const imagen = cfg.bgImageUrl
    ? imagenDelMenu(cfg.bgImageUrl, IMAGEN_DE_PORTADA)
    : null;
  const bgImageStyle: React.CSSProperties | null = imagen?.src
    ? {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: ajusteDeLaPortada(cfg.bgFit),
        objectPosition: posicionDeLaPortada(cfg.bgPosition),
        // Un fondo no se arrastra ni abre el menú de «guardar imagen» al
        // mantener pulsado; el `<img>` tampoco debe.
        pointerEvents: 'none',
        userSelect: 'none',
      }
    : null;

  const overlayStyle: React.CSSProperties | null = cfg.overlay
    ? {
        position: 'absolute',
        inset: 0,
        background: cfg.overlay.color,
        opacity: cfg.overlay.opacity,
        pointerEvents: 'none',
      }
    : null;

  const contentStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: alignItems,
    alignItems: justifyContent,
    paddingLeft: cfg.paddingX * scale,
    paddingRight: cfg.paddingX * scale,
    paddingTop: cfg.paddingY * scale,
    paddingBottom: cfg.paddingY * scale,
    textAlign,
    gap: 6 * scale,
  };

  const effectiveTagline = tagline ?? null;
  const effectiveBadge = badgeText ?? cfg.badgeText;

  return (
    <div style={containerStyle} className={className}>
      {imagen && bgImageStyle && (
        // `<img>` y no `next/image`: `next/image` exige que el host esté en
        // `remotePatterns`, y hay portadas reales de Unsplash que no lo están.
        // `imagenDelMenu` decide cuándo optimizar y, si no se puede, la deja
        // cruda en vez de en blanco.
        <img
          {...imagen}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          draggable={false}
          style={bgImageStyle}
        />
      )}
      {overlayStyle && <div style={overlayStyle} aria-hidden />}
      <div style={contentStyle}>
        {effectiveBadge && cfg.badge && (
          <span style={textStyleToCss(cfg.badge, scale)}>{effectiveBadge}</span>
        )}
        {title && (
          <h3 style={{ ...textStyleToCss(cfg.title, scale), margin: 0 }}>
            {title}
          </h3>
        )}
        {effectiveTagline && cfg.tagline && (
          <p style={{ ...textStyleToCss(cfg.tagline, scale), margin: 0 }}>
            {effectiveTagline}
          </p>
        )}
      </div>
    </div>
  );
}

function textStyleToCss(s: CoverTextStyle, scale: number): React.CSSProperties {
  return {
    color: s.color,
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight,
    fontSize: s.fontSize * scale,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : undefined,
    lineHeight: s.lineHeight ?? 1.1,
    textTransform: s.transform ?? 'none',
    textShadow: s.shadow
      ? `0 ${s.shadow.offsetY * scale}px ${s.shadow.blur * scale}px ${s.shadow.color}`
      : undefined,
  };
}

/** Helper para renderizar el SectionCoverPreview con scale automático
 *  basado en el contenedor (usa el atributo style width del config,
 *  no width real DOM). Útil para thumbnails. */
export function SectionCoverThumb({
  config,
  title,
  tagline,
  /** Ancho objetivo del thumbnail en px. Calcula scale para que
   *  encaje. Default 280. */
  width = 280,
}: {
  config: unknown;
  title: string;
  tagline?: string | null;
  width?: number;
}) {
  // Usamos un viewport ref de 360px (ancho mobile típico) — el config
  // está pensado para ese ancho. Escalamos para que matchee width.
  const REF_WIDTH = 360;
  const scale = width / REF_WIDTH;
  return (
    <SectionCoverPreview
      config={config}
      title={title}
      tagline={tagline}
      scale={scale}
    />
  );
}

export type { SectionCoverConfig };
