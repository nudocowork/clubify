'use client';
import { useMemo, useState } from 'react';
import {
  WALLET_STYLES,
  WALLET_STYLE_CATEGORY_LABELS,
  type WalletStyle,
} from '@/lib/cards/wallet-templates';

/**
 * Galería de estilos pre-armados para wallet pass (Apple/Google).
 * El usuario elige un estilo y se aplican los 6 colores a la card
 * en un click. Luego puede ajustar individualmente con los color pickers.
 *
 * Detección de "estilo activo": comparamos los 6 colores actuales con
 * cada template — si matchean exactamente, mostramos el badge. Esto
 * permite editar colores después de aplicar sin que el badge mienta.
 */

type Colors = {
  primaryColor: string;
  secondaryColor: string;
  stampActiveColor: string | null;
  stampInactiveColor: string | null;
  stampContourColor: string | null;
  centerBgColor: string | null;
};

export function WalletStylesGallery({
  current,
  onApply,
}: {
  current: Colors;
  onApply: (style: WalletStyle) => void;
}) {
  const [category, setCategory] = useState<WalletStyle['category'] | 'all'>(
    'all',
  );

  const filtered = useMemo(
    () =>
      category === 'all'
        ? WALLET_STYLES
        : WALLET_STYLES.filter((s) => s.category === category),
    [category],
  );

  const activeId = useMemo(() => {
    // Match solo si los 6 colores actuales matchean exactamente con
    // los del template. Si algún color del current es null (auto),
    // ese slot no puede matchear porque los templates siempre tienen
    // los 6 hex strings. Esto es intencional: el badge "activo" solo
    // aparece cuando el usuario aplicó un template y NO modificó
    // colores avanzados a "auto" después.
    const eq = (a: string | null | undefined, b: string) =>
      typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
    return (
      WALLET_STYLES.find(
        (s) =>
          eq(current.primaryColor, s.colors.primaryColor) &&
          eq(current.secondaryColor, s.colors.secondaryColor) &&
          eq(current.stampActiveColor, s.colors.stampActiveColor) &&
          eq(current.stampInactiveColor, s.colors.stampInactiveColor) &&
          eq(current.stampContourColor, s.colors.stampContourColor) &&
          eq(current.centerBgColor, s.colors.centerBgColor),
      )?.id ?? null
    );
  }, [current]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <CategoryPill
          active={category === 'all'}
          onClick={() => setCategory('all')}
        >
          Todos
        </CategoryPill>
        {(
          Object.keys(WALLET_STYLE_CATEGORY_LABELS) as WalletStyle['category'][]
        ).map((c) => (
          <CategoryPill
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
          >
            {WALLET_STYLE_CATEGORY_LABELS[c]}
          </CategoryPill>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {filtered.map((s) => {
          const isActive = activeId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onApply(s)}
              className={`group relative rounded-xl overflow-hidden border transition text-left ${
                isActive
                  ? 'border-brand ring-2 ring-brand/40'
                  : 'border-line hover:border-brand/60'
              }`}
              title={s.name}
            >
              <div
                className="h-14 w-full relative"
                style={{
                  background: `linear-gradient(135deg, ${s.swatch.from}, ${s.swatch.to})`,
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center gap-1">
                  <span
                    className="w-4 h-4 rounded-full border border-white/40"
                    style={{ background: s.colors.stampActiveColor }}
                  />
                  <span
                    className="w-4 h-4 rounded-full border border-white/40"
                    style={{ background: s.colors.stampInactiveColor }}
                  />
                  <span
                    className="w-4 h-4 rounded-full border border-white/40"
                    style={{ background: s.colors.centerBgColor }}
                  />
                </div>
                {isActive && (
                  <span className="absolute top-1.5 right-1.5 text-[10px] font-bold bg-brand text-white px-1.5 py-0.5 rounded-full">
                    ✓
                  </span>
                )}
              </div>
              <div className="px-2 py-1.5 bg-bg">
                <div className="text-[12px] font-semibold leading-tight truncate">
                  {s.name}
                </div>
                <div className="text-[10px] text-mute mt-0.5">
                  {WALLET_STYLE_CATEGORY_LABELS[s.category]}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CategoryPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-bg2 text-ink border-line hover:border-brand/50'
      }`}
    >
      {children}
    </button>
  );
}
