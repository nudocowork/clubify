'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Item = {
  key: string;
  label: string;
  sub: string;
  done: boolean;
  href: string;
};

type Status = {
  items: Item[];
  completedCount: number;
  totalCount: number;
  percent: number;
  complete: boolean;
};

const HIDDEN_KEY = 'clubify:onboarding:hidden';

/**
 * Quick Start checklist para tenants nuevos. Aparece en /app dashboard
 * mientras no estén completos. Si el usuario lo cierra (X), se oculta
 * permanentemente. Si lo completan al 100%, también desaparece.
 */
export function OnboardingChecklist() {
  const [data, setData] = useState<Status | null>(null);
  const [hiddenByUser, setHiddenByUser] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHiddenByUser(localStorage.getItem(HIDDEN_KEY) === '1');
    api<Status>('/metrics/onboarding-status')
      .then(setData)
      .catch(() => null);
  }, []);

  if (!data || data.complete || hiddenByUser) return null;

  function dismiss() {
    localStorage.setItem(HIDDEN_KEY, '1');
    setHiddenByUser(true);
  }

  return (
    <div className="card overflow-hidden mb-4 bg-gradient-to-br from-brand-soft to-white border-brand/20">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div className="relative w-12 h-12 flex-none">
          <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-bg2"
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${(data.percent / 100) * 94.25} 94.25`}
              strokeLinecap="round"
              className="text-brand transition-all"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-brand">
            {data.percent}%
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            Configura tu negocio en {data.totalCount} pasos
          </div>
          <div className="text-xs text-mute mt-0.5">
            {data.completedCount} de {data.totalCount} completados
          </div>
        </div>
        <div className="flex items-center gap-1 flex-none">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-xs text-mute hover:text-ink px-2 py-1 rounded-md hover:bg-bg2 transition"
            title={collapsed ? 'Mostrar' : 'Ocultar'}
          >
            {collapsed ? '▼' : '▲'}
          </button>
          <button
            onClick={dismiss}
            className="text-mute hover:text-ink w-7 h-7 rounded-md hover:bg-bg2 transition flex items-center justify-center"
            title="Cerrar permanentemente"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Items */}
      {!collapsed && (
        <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition group ${
                item.done
                  ? 'bg-white/40 hover:bg-white/60'
                  : 'bg-white hover:bg-white shadow-sm hover:shadow-md border border-line'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex-none flex items-center justify-center text-[12px] font-bold ${
                  item.done
                    ? 'bg-ok text-white'
                    : 'bg-bg2 border-2 border-line text-mute group-hover:border-brand'
                }`}
              >
                {item.done ? '✓' : ''}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm font-medium ${
                    item.done ? 'text-mute line-through' : 'text-ink'
                  }`}
                >
                  {item.label}
                </div>
                <div className="text-[11px] text-mute mt-0.5 leading-tight">
                  {item.sub}
                </div>
              </div>
              {!item.done && (
                <div className="text-brand text-xs font-semibold opacity-0 group-hover:opacity-100 transition self-center">
                  →
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
