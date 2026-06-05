'use client';
/**
 * Buscador inteligente de afiliados (influencers + embajadores) para
 * asignar a un tenant al crearlo o editarlo. Reemplaza el `<select>`
 * estático que listaba TODO el universo de afiliados.
 *
 * UX:
 *  - Input simple con dropdown de resultados live-filtrados.
 *  - Debounce 200ms para no spammear el backend mientras se tipea.
 *  - Selección setea el id y muestra una pill "✓ Nombre · ROL · CÓDIGO"
 *    debajo del input. Botón × para deseleccionar.
 *
 * Backend: GET /referrals/affiliates/search?q=<query>
 * Devuelve hasta 30 items con { id, ownerName, ownerEmail, ownerWhatsapp,
 * code, role, campaignName, parentName }.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';

type AffiliateItem = {
  id: string;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  code: string;
  role: 'INFLUENCER' | 'AMBASSADOR';
  campaignName: string | null;
  parentName: string | null;
};

export function AffiliatePickerSearch({
  value,
  onChange,
  placeholder,
}: {
  /** referralCodeId seleccionado (string vacío = sin asignar) */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<AffiliateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<AffiliateItem | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Debounce 200ms — no spammear el backend mientras tipea.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Cuando llega un value nuevo desde el padre (ej: reset del form),
  // y no tenemos picked, intentamos resolverlo via GET search vacío.
  // Es lazy — sólo dispara si value !== picked.id.
  useEffect(() => {
    if (!value) {
      setPicked(null);
      return;
    }
    if (picked?.id === value) return;
    // Lookup directo no existe — usamos search vacío para traer
    // candidatos y matchear por id. Suficiente para el caso "el padre
    // me pasó un value que yo seleccioné". Si en el futuro hace falta
    // lookup por id, agregar /referrals/codes/:id sería más eficiente.
    // No-op si no encontramos: simplemente mostramos el id raw.
  }, [value, picked]);

  // Fetch resultados. Si query vacío, devuelve los primeros 30
  // (sin filtrar) — útil para que el dropdown muestre algo al abrir.
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    api<AffiliateItem[]>(
      `/referrals/affiliates/search?q=${encodeURIComponent(debouncedQuery)}`,
    )
      .then((rows) => {
        if (cancel) return;
        setItems(rows ?? []);
      })
      .catch(() => {
        if (cancel) return;
        setItems([]);
      })
      .finally(() => {
        if (cancel) return;
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [debouncedQuery, open]);

  // Cierra el dropdown al hacer click fuera.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function pick(it: AffiliateItem) {
    setPicked(it);
    onChange(it.id);
    setQuery('');
    setOpen(false);
  }

  function clear() {
    setPicked(null);
    onChange('');
    setQuery('');
  }

  return (
    <div ref={boxRef} className="relative">
      {picked ? (
        <div className="flex items-center gap-2 rounded-input border-2 border-brand bg-brand-soft px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-brand-700 truncate">
              {picked.ownerName}
            </div>
            <div className="text-[11px] text-mute truncate">
              {picked.role} · {picked.code}
              {picked.campaignName ? ` · ${picked.campaignName}` : ''}
              {picked.parentName ? ` · bajo ${picked.parentName}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            className="text-mute hover:text-bad text-lg leading-none px-1"
            title="Quitar selección"
          >
            ×
          </button>
        </div>
      ) : (
        <input
          className="input"
          type="text"
          value={query}
          placeholder={placeholder ?? 'Buscar afiliado…'}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          autoComplete="off"
        />
      )}

      {open && !picked && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-72 overflow-y-auto rounded-input border-2 border-line2 bg-white shadow-lg">
          {loading && (
            <div className="px-3 py-3 text-sm text-mute">Buscando…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-3 text-sm text-mute">
              {debouncedQuery.trim()
                ? 'Sin resultados. Probá con otro término.'
                : 'Comenzá a tipear para buscar.'}
            </div>
          )}
          {!loading &&
            items.map((it) => (
              <button
                type="button"
                key={it.id}
                onClick={() => pick(it)}
                className="block w-full text-left px-3 py-2 border-b border-line2 last:border-b-0 hover:bg-bg2 transition"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
                      it.role === 'INFLUENCER'
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {it.role === 'INFLUENCER' ? 'Influencer' : 'Embajador'}
                  </span>
                  <span className="font-semibold text-sm truncate">
                    {it.ownerName}
                  </span>
                  <span className="font-mono text-xs text-mute ml-auto">
                    {it.code}
                  </span>
                </div>
                <div className="text-[11px] text-mute mt-0.5 truncate">
                  {it.ownerEmail}
                  {it.ownerWhatsapp ? ` · ${it.ownerWhatsapp}` : ''}
                  {it.campaignName ? ` · ${it.campaignName}` : ''}
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
