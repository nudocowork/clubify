'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function AdminReferrals() {
  const [list, setList] = useState<any[]>([]);
  async function load() {
    setList(await api('/referrals'));
  }
  useEffect(() => {
    load();
  }, []);

  async function addCommission(useId: string) {
    const amount = Number(prompt('Monto de comisión (USD):') ?? 0);
    if (!amount) return;
    await api(`/referrals/uses/${useId}/commission`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    load();
  }
  async function setStatus(commId: string, status: string) {
    await api(`/referrals/commissions/${commId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Referidos <span className="page-crumb">/ {list.length} códigos</span>
        </h1>
      </div>

      <div className="space-y-3.5">
        {list.length === 0 && (
          <div className="card card-pad text-mute">
            Sin códigos de referido aún.
          </div>
        )}
        {list.map((r) => (
          <div key={r.id} className="card card-pad">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">
                  {r.ownerName}{' '}
                  <span className="text-mute font-normal">— {r.code}</span>
                </div>
                <div className="text-xs text-mute mt-0.5">
                  {r.ownerEmail} · {r.ownerWhatsapp}
                </div>
              </div>
              <div className="text-sm">
                <span className="badge badge-info">
                  {Number(r.commissionPercent)}% comisión
                </span>
              </div>
            </div>
            <div className="mt-3 divide-y divide-line2">
              {r.uses.length === 0 && (
                <div className="py-3 text-sm text-mute">Sin conversiones aún.</div>
              )}
              {r.uses.map((u: any) => (
                <div
                  key={u.id}
                  className="grid grid-cols-12 items-center gap-2 py-3 text-sm"
                >
                  <div className="col-span-3 font-medium">
                    {u.tenant?.brandName ?? '—'}
                  </div>
                  <div className="col-span-2 text-mute">{u.status}</div>
                  <div className="col-span-5">
                    {u.commissions.length === 0 && (
                      <span className="text-mute text-xs">Sin comisiones</span>
                    )}
                    {u.commissions.map((c: any) => (
                      <span
                        key={c.id}
                        className={`badge mr-1.5 ${
                          c.status === 'PAID' ? 'badge-ok' : 'badge-warn'
                        }`}
                      >
                        ${Number(c.amount)} · {c.status}
                        {c.status !== 'PAID' && (
                          <button
                            className="ml-1.5 underline"
                            onClick={() => setStatus(c.id, 'PAID')}
                          >
                            marcar pagada
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="col-span-2 text-right">
                    <button className="btn-link text-xs" onClick={() => addCommission(u.id)}>
                      + comisión
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
