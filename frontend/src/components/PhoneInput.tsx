'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Selector de prefijo de país (bandera + código) + input de número.
 * Devuelve el valor combinado en formato "+57 3001234567".
 *
 * Cobertura: países LATAM principales + España + USA. Suficiente para el
 * caso de uso actual de Clubify (negocios LATAM).
 */
type Country = { code: string; flag: string; name: string; dial: string };

const COUNTRIES: Country[] = [
  { code: 'CO', flag: '🇨🇴', name: 'Colombia', dial: '+57' },
  { code: 'MX', flag: '🇲🇽', name: 'México', dial: '+52' },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina', dial: '+54' },
  { code: 'CL', flag: '🇨🇱', name: 'Chile', dial: '+56' },
  { code: 'PE', flag: '🇵🇪', name: 'Perú', dial: '+51' },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador', dial: '+593' },
  { code: 'VE', flag: '🇻🇪', name: 'Venezuela', dial: '+58' },
  { code: 'BO', flag: '🇧🇴', name: 'Bolivia', dial: '+591' },
  { code: 'PY', flag: '🇵🇾', name: 'Paraguay', dial: '+595' },
  { code: 'UY', flag: '🇺🇾', name: 'Uruguay', dial: '+598' },
  { code: 'CR', flag: '🇨🇷', name: 'Costa Rica', dial: '+506' },
  { code: 'PA', flag: '🇵🇦', name: 'Panamá', dial: '+507' },
  { code: 'GT', flag: '🇬🇹', name: 'Guatemala', dial: '+502' },
  { code: 'DO', flag: '🇩🇴', name: 'R. Dominicana', dial: '+1' },
  { code: 'PR', flag: '🇵🇷', name: 'Puerto Rico', dial: '+1' },
  { code: 'ES', flag: '🇪🇸', name: 'España', dial: '+34' },
  { code: 'US', flag: '🇺🇸', name: 'Estados Unidos', dial: '+1' },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil', dial: '+55' },
];

function parseValue(value: string): { country: Country; rest: string } {
  const v = (value ?? '').trim();
  if (v) {
    // Match el dial code más largo posible
    const matched = [...COUNTRIES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => v.startsWith(c.dial));
    if (matched) {
      return {
        country: matched,
        rest: v.slice(matched.dial.length).trim(),
      };
    }
  }
  return { country: COUNTRIES[0], rest: v.replace(/^\+/, '') };
}

export function PhoneInput({
  value,
  onChange,
  placeholder = 'Número sin prefijo',
  disabled,
}: {
  value: string;
  onChange: (combined: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const initial = useMemo(() => parseValue(value), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState<Country>(initial.country);
  const [number, setNumber] = useState<string>(initial.rest);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Si el número está vacío, emitir string vacío — NO solo el dial.
    // Sin esto, los validators `if (!form.whatsapp.trim())` pasan con
    // "+57" basura y se persiste data inservible en DB.
    const trimmedNumber = number.trim();
    onChange(trimmedNumber ? `${country.dial} ${trimmedNumber}` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, number]);

  // Click fuera para cerrar dropdown
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="input flex items-center gap-1.5 w-[120px] flex-none disabled:opacity-50 hover:border-brand/40 transition"
        >
          <span className="text-base leading-none">{country.flag}</span>
          <span className="font-medium text-sm">{country.dial}</span>
          <span className="ml-auto text-xs text-mute">▾</span>
        </button>
        <input
          className="input flex-1"
          inputMode="tel"
          placeholder={placeholder}
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/[^\d\s-]/g, ''))}
          disabled={disabled}
        />
      </div>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-line rounded-input shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-line2">
            <input
              autoFocus
              type="text"
              placeholder="Buscar país…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input text-sm"
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-mute text-center">
                Sin resultados
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    setCountry(c);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-bg2/60 flex items-center gap-2.5 border-b border-line2 last:border-b-0 ${
                    c.code === country.code ? 'bg-brand-soft/40' : ''
                  }`}
                >
                  <span className="text-lg leading-none">{c.flag}</span>
                  <span className="font-medium text-sm flex-1">{c.name}</span>
                  <span className="text-mute text-xs font-mono">{c.dial}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
