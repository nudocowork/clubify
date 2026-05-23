'use client';
/**
 * BannerStylePicker — muestra 5 previews del mismo coverImage con los 5
 * estilos disponibles. El admin elige uno con click → callback.
 *
 * Se monta en el modal de create/edit de Industry, debajo del upload
 * del coverImage. Solo aparece si hay coverImage cargada (sino no hay
 * nada que previsualizar).
 */

import {
  IndustryCoverCard,
  COVER_STYLES,
  type IndustryCardData,
  type IndustryCoverStyle,
} from './IndustryCoverCard';

export function BannerStylePicker({
  industry,
  selected,
  onSelect,
}: {
  /** Datos de la industria que se está editando — usados para renderear
   *  los 5 previews con los datos reales. */
  industry: IndustryCardData;
  /** Estilo actualmente seleccionado. */
  selected: IndustryCoverStyle;
  onSelect: (style: IndustryCoverStyle) => void;
}) {
  if (!industry.coverImage) {
    return (
      <div className="text-xs text-mute italic">
        Subí una imagen de portada para ver los 5 estilos disponibles.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-mute">
        Elegí un estilo de portada — los 5 usan la misma imagen.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {COVER_STYLES.map((s) => {
          const active = selected === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`group relative text-left rounded-xl overflow-hidden transition-all ring-offset-2 focus:outline-none ${
                active
                  ? 'ring-2 ring-brand ring-offset-bg shadow-md'
                  : 'ring-1 ring-line2 hover:ring-mute'
              }`}
              title={s.hint}
            >
              <IndustryCoverCard
                industry={industry}
                styleOverride={s.id}
                preview
                ratio="square"
              />
              <div
                className={`absolute top-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-brand text-white' : 'bg-white/90 text-ink'
                }`}
              >
                {active ? '✓ ' : ''}
                {s.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
