'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Insight = {
  id: string;
  severity: 'urgent' | 'attention' | 'success' | 'info' | 'tip';
  emoji: string;
  title: string;
  body: string;
  href?: string;
  ctaLabel?: string;
};

const STYLE: Record<Insight['severity'], { ring: string; accent: string; chip: string; chipText: string }> = {
  urgent: {
    ring: 'ring-red-200',
    accent: 'border-l-4 border-red-500',
    chip: 'bg-red-100',
    chipText: 'text-red-800',
  },
  attention: {
    ring: 'ring-amber-200',
    accent: 'border-l-4 border-amber-500',
    chip: 'bg-amber-100',
    chipText: 'text-amber-800',
  },
  success: {
    ring: 'ring-ok/20',
    accent: 'border-l-4 border-ok',
    chip: 'bg-ok-soft',
    chipText: 'text-ok',
  },
  tip: {
    ring: 'ring-brand/20',
    accent: 'border-l-4 border-brand',
    chip: 'bg-brand-soft',
    chipText: 'text-brand-700',
  },
  info: {
    ring: 'ring-line',
    accent: 'border-l-4 border-line',
    chip: 'bg-bg2',
    chipText: 'text-mute',
  },
};

const SEVERITY_LABEL: Record<Insight['severity'], string> = {
  urgent: 'Urgente',
  attention: 'Atención',
  success: 'Buen dato',
  tip: 'Sugerencia',
  info: 'Info',
};

export function InsightsCard() {
  const [items, setItems] = useState<Insight[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('clubify:insights:dismissed');
        if (raw) setDismissed(new Set(JSON.parse(raw)));
      } catch {}
    }
    api<{ insights: Insight[] }>('/metrics/insights')
      .then((r) => setItems(r.insights))
      .catch(() => setItems([]));
  }, []);

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try {
      localStorage.setItem(
        'clubify:insights:dismissed',
        JSON.stringify(Array.from(next)),
      );
    } catch {}
  }

  if (!items) return null;
  const visible = items.filter((i) => !dismissed.has(i.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2 flex items-center justify-between">
        <span>Tu negocio hoy</span>
        <span className="text-mute2">
          {visible.length} insight{visible.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {visible.map((it) => {
          const s = STYLE[it.severity];
          return (
            <div
              key={it.id}
              className={`card card-pad ring-1 ${s.ring} ${s.accent} relative`}
            >
              <button
                onClick={() => dismiss(it.id)}
                className="absolute top-2 right-2 text-mute hover:text-ink text-xs w-6 h-6 rounded flex items-center justify-center"
                title="Ocultar"
                aria-label="Ocultar insight"
              >
                ✕
              </button>
              <div className="flex items-start gap-3 pr-5">
                <div className="text-xl leading-none mt-0.5" aria-hidden>
                  {it.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${s.chip} ${s.chipText}`}
                    >
                      {SEVERITY_LABEL[it.severity]}
                    </span>
                  </div>
                  <div className="font-semibold text-sm leading-tight">
                    {it.title}
                  </div>
                  <p className="text-xs text-mute mt-1 leading-relaxed">
                    {it.body}
                  </p>
                  {it.href && it.ctaLabel && (
                    <Link
                      href={it.href}
                      className={`inline-flex items-center gap-1 mt-2 text-xs font-semibold ${s.chipText} hover:underline`}
                    >
                      {it.ctaLabel} →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
