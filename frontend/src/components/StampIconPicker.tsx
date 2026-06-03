'use client';
import { useState } from 'react';
import { EmojiPicker } from './EmojiPicker';

/**
 * Picker curado de iconos para sellos de tarjetas wallet. Se muestran
 * los más usados agrupados por rubro (inspirado en los icon fonts más
 * descargados de Flaticon: comida, belleza, servicios, premios).
 *
 * El picker completo (emoji-mart con miles de emojis) sigue accesible
 * via "Más opciones" como fallback.
 *
 * Por qué emoji y no SVG: el render del .pkpass de Apple Wallet usa
 * sharp con SVG `<text>` y la familia Apple Color Emoji para colorear.
 * Cambiar a SVG icons requiere reescribir wallet.service.ts y manejar
 * rasterización propia. Los emojis cubren bien todos los rubros.
 */

const SECTIONS: { name: string; icons: string[] }[] = [
  {
    name: '🍽 Comida y bebida',
    icons: [
      '☕', '🍵', '🧋', '🥤', '🍺', '🍷', '🍸', '🍹',
      '🍕', '🍔', '🌮', '🌯', '🥪', '🌭', '🍝', '🍣',
      '🍜', '🍛', '🥘', '🍲', '🥗', '🍱', '🍤', '🦞',
      '🥐', '🥖', '🍞', '🧁', '🍰', '🎂', '🍪', '🍩',
      '🍦', '🍨', '🍧', '🍫', '🍬', '🍭', '🍯', '🥞',
    ],
  },
  {
    name: '💈 Belleza y estética',
    icons: [
      '💈', '✂️', '💇', '💇‍♀️', '💇‍♂️', '💆', '💆‍♀️', '💅',
      '💄', '💋', '👁️', '👄', '🪒', '🧴', '🪞', '🧖',
      '🧖‍♀️', '🌸', '🌺', '🌷',
    ],
  },
  {
    name: '🔧 Servicios',
    icons: [
      '🚗', '🚙', '🛻', '🏍', '🚲', '🛵', '🚿', '🧺',
      '🧼', '🧽', '🧹', '🧴', '🔧', '🔨', '🛠', '⚙️',
      '🪛', '🔩', '🪚', '🧰',
    ],
  },
  {
    name: '⭐ Premios y recompensas',
    icons: [
      '⭐', '🌟', '✨', '💫', '🏆', '🥇', '🏅', '🎖',
      '👑', '💎', '💍', '🎁', '🎀', '🎟', '🎫', '🎯',
      '🎉', '🎊', '🪄', '✦', '✓', '❤️', '💖', '💯',
    ],
  },
  {
    name: '🐾 Mascotas y salud',
    icons: [
      '🐾', '🐶', '🐱', '🐰', '🐭', '🐹', '🐢', '🦴',
      '🦷', '💊', '🩺', '🩹', '🌡', '👓', '🕶', '🥼',
    ],
  },
  {
    name: '🛍 Retail y otros',
    icons: [
      '🛍', '👕', '👗', '👟', '👜', '🎒', '🧣', '🧢',
      '📚', '🖋', '🎨', '🎬', '🎵', '🎤', '🏋', '⚽',
      '💐', '🌹', '🌻', '🪴', '📦', '🚚',
    ],
  },
];

export function StampIconPicker({
  value,
  onSelect,
}: {
  value?: string;
  onSelect: (icon: string) => void;
}) {
  const [showFull, setShowFull] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        {/* Preview del icono seleccionado, grande */}
        <div className="w-16 h-16 rounded-2xl border-2 border-bd bg-bg2 flex items-center justify-center text-3xl shrink-0">
          {value || '☕'}
        </div>
        <div className="text-xs text-mute leading-snug">
          Elige el icono que aparecerá en cada sello dentro de la tarjeta
          wallet del cliente. Inspirado en los iconos más usados (Flaticon).
        </div>
      </div>

      {/* Grid de iconos curados por rubro */}
      <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
        {SECTIONS.map((s) => (
          <div key={s.name}>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5 sticky top-0 bg-white/95 backdrop-blur py-1 -mx-1 px-1">
              {s.name}
            </div>
            <div className="grid grid-cols-8 sm:grid-cols-10 gap-1">
              {s.icons.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => onSelect(icon)}
                  className={`aspect-square rounded-lg text-xl flex items-center justify-center transition ${
                    value === icon
                      ? 'bg-brand text-white scale-110 shadow'
                      : 'bg-bg2 hover:bg-line'
                  }`}
                  title={icon}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Toggle al picker completo */}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-line">
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="text-xs text-brand hover:underline"
        >
          {showFull ? '▲ Ocultar picker completo' : '▼ ¿No encuentras tu icono? Buscar entre miles de emojis'}
        </button>
      </div>
      {showFull && (
        <div className="mt-3">
          <EmojiPicker
            value={value}
            onSelect={onSelect}
            size="md"
            placeholder="Buscar icono"
          />
        </div>
      )}
    </div>
  );
}
