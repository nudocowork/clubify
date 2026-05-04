'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';

type Action = {
  id: string;
  emoji: string;
  label: string;
  href: string;
  hint?: string;
};

const ACTIONS: Action[] = [
  { id: 'order', emoji: '📦', label: 'Ver pedidos', href: '/app/orders', hint: 'Kanban en vivo' },
  { id: 'product', emoji: '🍴', label: 'Nuevo producto', href: '/app/menu' },
  { id: 'customer', emoji: '🙋', label: 'Nuevo cliente', href: '/app/customers' },
  { id: 'card', emoji: '💳', label: 'Nueva tarjeta', href: '/app/cards/new' },
  { id: 'promo', emoji: '🎁', label: 'Nueva promoción', href: '/app/promos' },
  { id: 'scan', emoji: '🔍', label: 'Escanear cliente', href: '/scan', hint: 'Sumar sello' },
];

export function QuickCreateFAB() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-fab-root]')) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div
      data-fab-root
      className="fixed bottom-4 right-20 z-30 lg:hidden"
    >
      {/* Menú expandido */}
      {open && (
        <div className="absolute bottom-14 right-0 mb-2 flex flex-col gap-2 items-end animate-in">
          {ACTIONS.map((a, i) => (
            <button
              key={a.id}
              onClick={() => {
                setOpen(false);
                router.push(a.href);
              }}
              className="flex items-center gap-2 bg-white rounded-full shadow-lg pl-3 pr-4 py-2 border border-line hover:border-brand/40 transition"
              style={{
                animation: `fab-pop 280ms cubic-bezier(.34,1.56,.64,1) ${i * 35}ms both`,
              }}
            >
              <span className="text-lg">{a.emoji}</span>
              <div className="text-left">
                <div className="text-xs font-semibold text-ink leading-tight">
                  {a.label}
                </div>
                {a.hint && (
                  <div className="text-[10px] text-mute leading-tight">
                    {a.hint}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Botón principal */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition ${
          open
            ? 'bg-ink text-white rotate-45'
            : 'bg-brand text-white hover:bg-brand-700'
        }`}
        aria-label={open ? 'Cerrar menú' : 'Abrir acciones rápidas'}
        title="Crear o ir a…"
      >
        <Icon name="plus" size={22} />
      </button>

      <style jsx>{`
        @keyframes fab-pop {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
