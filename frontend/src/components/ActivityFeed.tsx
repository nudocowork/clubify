'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Event = {
  id: string;
  kind: 'order' | 'stamp' | 'redeem' | 'pass' | 'customer';
  at: string;
  emoji: string;
  title: string;
  detail?: string;
  href?: string;
};

function timeAgo(iso: string): string {
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'ahora';
  const diffMin = diffSec / 60;
  if (diffMin < 60) return `hace ${Math.floor(diffMin)} min`;
  const diffH = diffMin / 60;
  if (diffH < 24) return `hace ${Math.floor(diffH)} h`;
  const diffD = diffH / 24;
  if (diffD < 7) return `hace ${Math.floor(diffD)} d`;
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
  });
}

const KIND_TINT: Record<Event['kind'], string> = {
  order: 'bg-brand-soft text-brand-700',
  stamp: 'bg-amber-100 text-amber-800',
  redeem: 'bg-ok-soft text-ok',
  pass: 'bg-brand-100 text-brand-700',
  customer: 'bg-emerald-100 text-emerald-700',
};

export function ActivityFeed() {
  const [events, setEvents] = useState<Event[] | null>(null);

  useEffect(() => {
    let alive = true;
    function fetchOnce() {
      api<{ events: Event[] }>('/metrics/activity')
        .then((r) => alive && setEvents(r.events))
        .catch(() => alive && setEvents([]));
    }
    fetchOnce();
    const t = setInterval(fetchOnce, 30000); // refresh suave cada 30s
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm">Actividad reciente</div>
        <span className="text-[10px] uppercase tracking-wider text-mute font-semibold">
          últimos 14 días
        </span>
      </div>
      {!events ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-bg2 rounded animate-shimmer" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-3xl mb-1">📋</div>
          <div className="text-sm text-mute">
            Sin actividad todavía. Aquí verás pedidos, sellos y nuevos
            clientes en cuanto empiecen a llegar.
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-auto -mx-2">
          {events.map((e) => {
            const inner = (
              <div className="flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-bg2/50 transition">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-none ${KIND_TINT[e.kind]}`}
                >
                  {e.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.title}</div>
                  {e.detail && (
                    <div className="text-xs text-mute truncate">{e.detail}</div>
                  )}
                </div>
                <div className="text-[10px] text-mute2 whitespace-nowrap mt-1">
                  {timeAgo(e.at)}
                </div>
              </div>
            );
            return e.href ? (
              <Link key={e.id} href={e.href} className="block">
                {inner}
              </Link>
            ) : (
              <div key={e.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
