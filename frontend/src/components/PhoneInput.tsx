'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Selector de prefijo de país (bandera + código) + input de número.
 * Devuelve el valor combinado en formato "+57 3001234567".
 *
 * Cobertura: países LATAM principales + España + USA. Suficiente para el
 * caso de uso actual de Clubify (negocios LATAM).
 */
// primary: cuando varios países comparten el mismo dial (NANP +1), este es el
// que se elige por defecto al reparsear un número (no se puede distinguir US de
// CA/DO por el número solo). Evita que "+1 …" reaparezca con otra bandera.
type Country = { code: string; flag: string; name: string; dial: string; primary?: boolean };

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
  { code: 'HN', flag: '🇭🇳', name: 'Honduras', dial: '+504' },
  { code: 'SV', flag: '🇸🇻', name: 'El Salvador', dial: '+503' },
  { code: 'NI', flag: '🇳🇮', name: 'Nicaragua', dial: '+505' },
  { code: 'BZ', flag: '🇧🇿', name: 'Belice', dial: '+501' },
  { code: 'CU', flag: '🇨🇺', name: 'Cuba', dial: '+53' },
  { code: 'HT', flag: '🇭🇹', name: 'Haití', dial: '+509' },
  { code: 'DO', flag: '🇩🇴', name: 'R. Dominicana', dial: '+1' },
  { code: 'PR', flag: '🇵🇷', name: 'Puerto Rico', dial: '+1' },
  { code: 'JM', flag: '🇯🇲', name: 'Jamaica', dial: '+1' },
  { code: 'TT', flag: '🇹🇹', name: 'Trinidad y Tobago', dial: '+1' },
  { code: 'GY', flag: '🇬🇾', name: 'Guyana', dial: '+592' },
  { code: 'SR', flag: '🇸🇷', name: 'Surinam', dial: '+597' },
  { code: 'ES', flag: '🇪🇸', name: 'España', dial: '+34' },
  { code: 'PT', flag: '🇵🇹', name: 'Portugal', dial: '+351' },
  { code: 'FR', flag: '🇫🇷', name: 'Francia', dial: '+33' },
  { code: 'IT', flag: '🇮🇹', name: 'Italia', dial: '+39' },
  { code: 'DE', flag: '🇩🇪', name: 'Alemania', dial: '+49' },
  { code: 'GB', flag: '🇬🇧', name: 'Reino Unido', dial: '+44' },
  { code: 'US', flag: '🇺🇸', name: 'Estados Unidos', dial: '+1', primary: true },
  { code: 'CA', flag: '🇨🇦', name: 'Canadá', dial: '+1' },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil', dial: '+55' },
];

function parseValue(value: string, preferredCode?: string): { country: Country; rest: string } {
  const v = (value ?? '').trim();
  if (v) {
    // Todos los países cuyo dial prefija el número; nos quedamos con el dial
    // más largo (ej. +1 vs +591 para "+591…").
    const matches = COUNTRIES.filter((c) => v.startsWith(c.dial));
    if (matches.length) {
      const maxLen = Math.max(...matches.map((c) => c.dial.length));
      const sameDial = matches.filter((c) => c.dial.length === maxLen);
      // Desempate cuando varios comparten dial (+1): (1) país del negocio si
      // comparte ese dial, (2) el marcado primary (US), (3) el primero.
      const preferred =
        preferredCode && sameDial.find((c) => c.code === preferredCode.toUpperCase());
      const chosen = preferred || sameDial.find((c) => c.primary) || sameDial[0];
      return { country: chosen, rest: v.slice(chosen.dial.length).trim() };
    }
  }
  return { country: COUNTRIES[0], rest: v.replace(/^\+/, '') };
}

export function PhoneInput({
  value,
  onChange,
  placeholder = 'Número sin prefijo',
  disabled,
  defaultCountry,
}: {
  value: string;
  onChange: (combined: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** ISO alpha-2 del país del NEGOCIO (Tenant.country). Cuando el campo está
   *  vacío, la bandera inicial es la de este país en vez del default Colombia.
   *  Si el value ya trae un número con prefijo, se respeta el país de ese valor. */
  defaultCountry?: string;
}) {
  const initial = useMemo(() => {
    if (!(value ?? '').trim() && defaultCountry) {
      const c = COUNTRIES.find((x) => x.code === defaultCountry.toUpperCase());
      if (c) return { country: c, rest: '' };
    }
    return parseValue(value, defaultCountry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState<Country>(initial.country);
  const [number, setNumber] = useState<string>(initial.rest);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Sync con cambios EXTERNOS del value (modo controlado). Si el padre
  // resetea form.whatsapp = '' tras submit, el input también se limpia.
  // Para no entrar en loop infinito, solo aplicamos cuando el value
  // resultante difiere del current (composedValue !== value).
  useEffect(() => {
    const composedValue = number.trim()
      ? `${country.dial} ${number.trim()}`
      : '';
    if (composedValue === value) return;
    const parsed = parseValue(value, defaultCountry);
    setCountry(parsed.country);
    setNumber(parsed.rest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Si el país del negocio (defaultCountry) llega async DESPUÉS del mount y el
  // campo sigue vacío, adoptamos esa bandera — sin pisar lo que el usuario tocó.
  useEffect(() => {
    if (!defaultCountry) return;
    if ((value ?? '').trim() || number.trim()) return;
    const c = COUNTRIES.find((x) => x.code === defaultCountry.toUpperCase());
    if (c && c.code !== country.code) setCountry(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCountry]);

  useEffect(() => {
    // Si el número está vacío, emitir string vacío — NO solo el dial.
    // Sin esto, los validators `if (!form.whatsapp.trim())` pasan con
    // "+57" basura y se persiste data inservible en DB.
    const trimmedNumber = number.trim();
    onChange(trimmedNumber ? `${country.dial} ${trimmedNumber}` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, number]);

  /** Cuando el usuario pega un texto que empieza con un dial code
   *  conocido (ej "+57 300 123 4567"), auto-cambiamos el país y dejamos
   *  solo los dígitos locales en el input. Sin esto, el "+57" pegado se
   *  strip-ea silenciosamente y queda doble prefijo. */
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    if (!pasted.trim().startsWith('+')) return; // sigue camino normal
    const cleaned = pasted.replace(/[^\d+]/g, '');
    const matched = [...COUNTRIES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => cleaned.startsWith(c.dial));
    if (matched) {
      e.preventDefault();
      setCountry(matched);
      setNumber(cleaned.slice(matched.dial.length));
    }
  }

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
          onPaste={handlePaste}
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
