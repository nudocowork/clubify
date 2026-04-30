'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

export default function ReferPage() {
  const [form, setForm] = useState({ fullName: '', email: '', whatsapp: '' });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api('/referrals/codes', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(r);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-lg mx-auto px-6 py-8">
        <Link href="/" className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center font-bold">
            C
          </div>
          <div className="font-bold text-lg">Clubify</div>
        </Link>

        {result ? (
          <>
            <div className="page-head">
              <h1 className="page-title">¡Tu código está listo!</h1>
            </div>
            <div className="card card-pad">
              <div className="flex items-center gap-2 text-ok">
                <Icon name="check" size={22} />
                <h3 className="m-0 text-lg font-semibold">Generado</h3>
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mt-4">
                Código
              </div>
              <div className="text-5xl font-bold text-brand tracking-wider mt-1">
                {result.code}
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mt-4">
                Link para compartir
              </div>
              <div className="flex items-center gap-2 mt-2 bg-brand-soft rounded-input p-3">
                <code className="text-xs text-brand-700 flex-1 break-all">
                  {result.shareLink}
                </code>
                <button
                  className="btn-link"
                  onClick={() => navigator.clipboard.writeText(result.shareLink)}
                >
                  Copiar
                </button>
              </div>
              <div className="text-sm text-mute mt-4">
                Comisión:{' '}
                <strong>{Number(result.commissionPercent)}%</strong> por cada negocio
                que se vuelva cliente pago.
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="page-head">
              <h1 className="page-title">Programa de referidos</h1>
            </div>
            <p className="text-mute mb-5 leading-relaxed">
              Recomienda Clubify y gana <strong className="text-brand">20% de comisión</strong> por
              cada negocio que se vuelva cliente pago.
            </p>
            <form onSubmit={submit} className="card card-pad space-y-3">
              <div>
                <label className="label">Nombre completo</label>
                <input
                  className="input"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">WhatsApp</label>
                <input
                  className="input"
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Correo electrónico</label>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              {err && (
                <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
                  {err}
                </div>
              )}
              <button className="btn-primary w-full justify-center">
                <Icon name="spark" /> Generar mi código
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
