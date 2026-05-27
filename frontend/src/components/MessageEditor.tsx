'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const EmojiMartPicker = dynamic(
  () => import('@emoji-mart/react').then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="p-4 text-center text-mute text-sm w-[320px]">
        Cargando…
      </div>
    ),
  },
);

const ES_I18N = {
  search: 'Buscar',
  search_no_results_1: 'Sin resultados',
  search_no_results_2: 'Probá con otra palabra',
  categories: {
    activity: 'Actividades',
    custom: 'Personalizados',
    flags: 'Banderas',
    foods: 'Comida y bebida',
    frequent: 'Recientes',
    nature: 'Animales y naturaleza',
    objects: 'Objetos',
    people: 'Personas y rostros',
    places: 'Lugares y viajes',
    search: 'Resultados',
    symbols: 'Símbolos',
  },
};

export type Variable = {
  /** Token a insertar (incluye llaves), ej. "{nombre}" */
  token: string;
  /** Label legible mostrado en el chip */
  label: string;
};

/** Variables default para mensajes del CRM (matchea renderTemplate del backend). */
export const CRM_DEFAULT_VARIABLES: Variable[] = [
  { token: '{nombre}', label: 'Nombre' },
  { token: '{telefono}', label: 'Teléfono' },
  { token: '{instagram}', label: 'Instagram' },
  { token: '{direccion}', label: 'Dirección' },
  { token: '{pipeline}', label: 'Etapa' },
  { token: '{fecha}', label: 'Fecha' },
];

/**
 * Editor de mensaje premium (F5): textarea + toolbar con emoji picker
 * (insertable en cursor) + chips de variables clickeables. Reemplaza
 * los textareas planos en StepEditor del SequenceBuilder y en
 * /affiliate/crm/buttons.
 *
 * Inserción en cursor: usa `selectionStart` y reemplaza el rango
 * `[start, end)` con el token elegido. Mantiene el foco al textarea
 * y mueve el cursor al final de la inserción.
 */
export function MessageEditor({
  value,
  onChange,
  placeholder,
  rows = 5,
  variables = CRM_DEFAULT_VARIABLES,
  className = '',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  variables?: Variable[];
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiData, setEmojiData] = useState<any>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Carga lazy de data del picker
  useEffect(() => {
    if (pickerOpen && !emojiData) {
      import('@emoji-mart/data').then((m) => setEmojiData(m.default));
    }
  }, [pickerOpen, emojiData]);

  // Close on outside click / ESC
  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  function insertAtCursor(text: string) {
    const ta = textareaRef.current;
    if (!ta) {
      // Sin ref: agregamos al final.
      onChange(value + text);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    // Restaurar selección post-insert.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className={className}>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 mb-2 items-center">
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen(!pickerOpen)}
            className="text-xs px-2 py-1 rounded-full bg-bg2 border border-line hover:bg-brand-soft hover:border-brand flex items-center gap-1"
            title="Insertar emoji"
          >
            😀 <span className="hidden sm:inline">Emoji</span>
          </button>
          {pickerOpen && (
            <div className="absolute z-50 left-0 top-full mt-1 shadow-2xl rounded-xl overflow-hidden">
              {emojiData ? (
                <EmojiMartPicker
                  data={emojiData}
                  onEmojiSelect={(e: any) => {
                    insertAtCursor(e.native);
                    setPickerOpen(false);
                  }}
                  theme="light"
                  locale="es"
                  i18n={ES_I18N}
                  previewPosition="none"
                  skinTonePosition="search"
                  perLine={9}
                  maxFrequentRows={2}
                  navPosition="top"
                  autoFocus
                />
              ) : (
                <div className="bg-white p-4 text-center text-mute text-sm w-[320px]">
                  Cargando emojis…
                </div>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-mute mx-1">·</span>
        {variables.map((v) => (
          <button
            key={v.token}
            type="button"
            className="text-xs px-2 py-1 rounded-full bg-brand-soft text-brand hover:bg-brand hover:text-white transition"
            onClick={() => insertAtCursor(v.token)}
            title={`Inserta ${v.token}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full"
        rows={rows}
        placeholder={placeholder}
      />
      <div className="text-xs text-mute mt-1">
        💡 Tip: hacé click en una variable para insertarla en el cursor.
      </div>
    </div>
  );
}
