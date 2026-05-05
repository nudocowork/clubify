'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const Picker = dynamic(
  () => import('@emoji-mart/react').then((m) => m.default),
  { ssr: false, loading: () => <div className="p-6 text-center text-mute text-sm">Cargando…</div> },
);

const ES_I18N = {
  search: 'Buscar',
  search_no_results_1: 'Sin resultados',
  search_no_results_2: 'Probá con otra palabra',
  pick: 'Elegí un emoji',
  add_custom: 'Agregar personalizado',
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
  skins: {
    1: 'Por defecto',
    2: 'Claro',
    3: 'Medio claro',
    4: 'Medio',
    5: 'Medio oscuro',
    6: 'Oscuro',
    choose: 'Elegir tono de piel',
  },
};

export function EmojiPicker({
  value,
  onSelect,
  placeholder = 'Elegí un emoji',
  size = 'md',
}: {
  value?: string;
  onSelect: (emoji: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !data) {
      import('@emoji-mart/data').then((m) => setData(m.default));
    }
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sizeCls =
    size === 'lg'
      ? 'text-4xl w-20 h-20'
      : size === 'sm'
        ? 'text-xl w-10 h-10'
        : 'text-3xl w-14 h-14';

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${sizeCls} rounded-2xl border-2 border-bd bg-bg2 hover:border-brand transition flex items-center justify-center`}
        aria-label={placeholder}
      >
        {value || '😀'}
      </button>
      {open && (
        <div className="absolute z-50 mt-2 left-0 shadow-2xl rounded-xl overflow-hidden">
          {data ? (
            <Picker
              data={data}
              onEmojiSelect={(e: any) => {
                onSelect(e.native);
                setOpen(false);
              }}
              theme="light"
              locale="es"
              i18n={ES_I18N}
              previewPosition="none"
              skinTonePosition="search"
              maxFrequentRows={2}
              perLine={9}
              navPosition="top"
              autoFocus
            />
          ) : (
            <div className="bg-white p-6 text-center text-mute text-sm w-[340px]">
              Cargando emojis…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
