'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

export default function CardsList() {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    api('/cards').then(setList);
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Tarjetas <span className="page-crumb">/ {list.length} activas</span>
        </h1>
        <Link className="btn-primary" href="/app/cards/new">
          <Icon name="plus" /> Crear tarjeta
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {list.length === 0 && (
          <div className="card card-pad text-mute md:col-span-2 lg:col-span-3">
            Crea tu primera tarjeta para empezar a fidelizar clientes.
          </div>
        )}
        {list.map((c) => (
          <Link key={c.id} href={`/app/cards/${c.id}`} className="block">
            <div className="card card-pad hover:shadow-md2 transition cursor-pointer">
              <div
                className="rounded-2xl p-4 text-white shadow-md2"
                style={{
                  background: `linear-gradient(135deg, ${c.primaryColor}, ${c.secondaryColor})`,
                }}
              >
                <div className="text-[10px] tracking-[0.18em] uppercase opacity-85">
                  {c.type}
                </div>
                <div className="font-semibold text-lg mt-1 leading-tight">{c.name}</div>
                {c.type === 'STAMPS' && (
                  <div className="flex flex-wrap gap-1.5 mt-3.5">
                    {Array.from({ length: c.stampsRequired ?? 10 }).map((_, i) => (
                      <span key={i} className="stamp sm" />
                    ))}
                  </div>
                )}
                <div className="text-xs opacity-90 mt-3.5">{c.rewardText || '—'}</div>
              </div>
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="font-medium">
                  {c.type === 'STAMPS' ? `${c.stampsRequired ?? 10} sellos` : c.type}
                </span>
                <span className="text-mute text-xs">
                  {c._count?.passes ?? 0} pases
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
