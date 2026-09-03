'use client';
/**
 * PDF Soft(9) C5: filtro de negocio BUSCABLE. Reemplaza el <select> que solo
 * listaba los negocios de las filas cargadas. Muestra TODOS los negocios + una
 * opción "Todos", y permite escribir las primeras letras para filtrar y elegir
 * (Enter selecciona el primero de la lista). El padre provee la lista completa.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export type BusinessOption = { id: string; brandName: string };

export function BusinessFilterPicker({
  businesses,
  value,
  onChange,
  allLabel = 'Todos',
  placeholder = 'Buscar negocio…',
}: {
  businesses: BusinessOption[];
  /** tenantId seleccionado ('' = Todos) */
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => businesses.find((b) => b.id === value) ?? null,
    [businesses, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return businesses;
    return businesses.filter((b) => b.brandName.toLowerCase().includes(q));
  }, [businesses, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(id: string) {
    onChange(id);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input w-full"
        value={open ? query : selected?.brandName ?? ''}
        placeholder={value && selected ? selected.brandName : placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered.length > 0) pick(filtered[0].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-line2 bg-white shadow-lg text-sm">
          <button
            type="button"
            onClick={() => pick('')}
            className={`block w-full text-left px-3 py-2 hover:bg-bg2 ${
              !value ? 'font-semibold text-brand' : ''
            }`}
          >
            {allLabel}
          </button>
          {filtered.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => pick(b.id)}
              className={`block w-full text-left px-3 py-2 hover:bg-bg2 ${
                b.id === value ? 'font-semibold text-brand' : ''
              }`}
            >
              {b.brandName}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-mute">Sin resultados</div>
          )}
        </div>
      )}
    </div>
  );
}
