'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [issuedPass, setIssuedPass] = useState<any>(null);

  async function load() {
    setCard(await api(`/cards/${id}`));
    setCustomers(await api('/customers'));
  }
  useEffect(() => {
    load();
  }, [id]);

  async function issue(customerId: string) {
    setIssuing(true);
    try {
      const p = await api('/passes', {
        method: 'POST',
        body: JSON.stringify({ cardId: id, customerId }),
      });
      setIssuedPass(p);
    } finally {
      setIssuing(false);
    }
  }

  if (!card) return <div className="text-mute">Cargando…</div>;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {card.name} <span className="page-crumb">/ Tarjetas</span>
        </h1>
        <div className="text-mute text-sm">
          {card.type} · {card._count?.passes ?? 0} pases emitidos
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
        <div>
          <div
            className="rounded-2xl p-6 text-white shadow-md2"
            style={{
              background: `linear-gradient(135deg, ${card.primaryColor}, ${card.secondaryColor})`,
            }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] opacity-85">
              {card.type}
            </div>
            <div className="text-xl font-semibold mt-1 leading-tight">{card.name}</div>
            {card.type === 'STAMPS' && (
              <div className="flex flex-wrap gap-2 mt-5">
                {Array.from({ length: card.stampsRequired ?? 10 }).map((_, i) => (
                  <span key={i} className="stamp" />
                ))}
              </div>
            )}
            <div className="text-xs uppercase tracking-[0.18em] opacity-70 mt-5">
              Recompensa
            </div>
            <div>{card.rewardText || '—'}</div>
          </div>
        </div>

        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Emitir pase</h2>
          <p className="text-sm text-mute mt-1">
            Selecciona un cliente para enviarle esta tarjeta.
          </p>

          <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-line2 divide-y divide-line2">
            {customers.length === 0 && (
              <div className="p-4 text-sm text-mute">
                No hay clientes.{' '}
                <Link className="btn-link" href="/app/customers">
                  Crea uno
                </Link>
                .
              </div>
            )}
            {customers.map((c) => (
              <button
                key={c.id}
                disabled={issuing}
                onClick={() => issue(c.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-bg2 transition disabled:opacity-50"
              >
                <span>
                  <span className="font-medium">{c.fullName}</span>
                  <span className="ml-2 text-mute text-xs">
                    {c.email ?? c.phone}
                  </span>
                </span>
                <span className="text-brand text-xs font-medium">Emitir →</span>
              </button>
            ))}
          </div>

          {issuedPass && (
            <div className="mt-5 rounded-input bg-ok-soft px-3 py-3 text-sm">
              <div className="flex items-center gap-2 font-semibold text-ok-ink">
                <Icon name="check" /> Pase emitido
              </div>
              <div className="mt-2 text-ok-ink">
                Comparte este link con el cliente:
              </div>
              <a
                className="mt-1 block break-all text-ok-ink underline text-xs"
                href={`/w/${issuedPass.id}`}
                target="_blank"
              >{`${typeof window !== 'undefined' ? window.location.origin : ''}/w/${issuedPass.id}`}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
