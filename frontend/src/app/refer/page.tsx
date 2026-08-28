'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { PhoneInput } from '@/components/PhoneInput';
import { useAuthBrand, BrandMark } from '@/components/AuthBrand';

// useSearchParams requiere Suspense boundary en Next 14 para que el build
// estático no falle (CSR bailout). Wrap del export default.
export default function ReferPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <ReferInner />
    </Suspense>
  );
}

function ReferInner() {
  const searchParams = useSearchParams();
  const source = searchParams?.get('source')?.trim().slice(0, 60) || undefined;
  const [form, setForm] = useState({ fullName: '', email: '', whatsapp: '', password: '' });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  // Marca blanca por host (Sellea, Fideliso…): null en Clubify → branding default.
  const { brand } = useAuthBrand();
  // Términos de comisión de la marca (EXCLUSIVO Sellea = monto fijo pago único).
  // fixedOnce=false → % clásico. Resuelto por Origin/Referer en el backend.
  const [terms, setTerms] = useState<{ fixedOnce: boolean; negocioAmount?: number } | null>(null);

  useEffect(() => {
    api('/referrals/public-terms')
      .then((t: any) => setTerms(t))
      .catch(() => setTerms(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api('/referrals/codes', {
        method: 'POST',
        body: JSON.stringify({ ...form, source }),
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
          <BrandMark brand={brand} size={28} />
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
                {result.fixedCommissionUsd != null ? (
                  <>
                    Comisión:{' '}
                    <strong>${Number(result.fixedCommissionUsd)} por negocio</strong>{' '}
                    (pago único) que se vuelva cliente.
                  </>
                ) : (
                  <>
                    Comisión:{' '}
                    <strong>{Number(result.commissionPercent)}%</strong> por cada
                    negocio que se vuelva cliente pago.
                  </>
                )}
              </div>
              {result.accountReady && (
                <div className="mt-5 rounded-lg bg-brand-soft p-4">
                  <div className="text-sm font-semibold mb-2">
                    Tu cuenta está lista
                  </div>
                  <p className="text-xs text-mute mb-3">
                    Ya puedes entrar a tu panel con el correo que registraste y la contraseña que elegiste.
                  </p>
                  <Link href="/login" className="btn-primary w-full justify-center text-sm">
                    Entrar a mi panel
                  </Link>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="page-head">
              <h1 className="page-title">Programa de referidos</h1>
            </div>
            <p className="text-mute mb-5 leading-relaxed">
              Recomienda {brand?.name ?? 'Clubify'} y gana{' '}
              {terms?.fixedOnce && terms.negocioAmount != null ? (
                <strong className="text-brand">
                  ${terms.negocioAmount} por negocio (pago único)
                </strong>
              ) : (
                <strong className="text-brand">25% de comisión</strong>
              )}{' '}
              por cada negocio que se vuelva cliente pago.
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
                <PhoneInput
                  value={form.whatsapp}
                  onChange={(v) => setForm({ ...form, whatsapp: v })}
                  placeholder="300 000 0000"
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
              <div>
                <label className="label">Contraseña de acceso</label>
                <input
                  className="input"
                  type="password"
                  minLength={8}
                  maxLength={64}
                  placeholder="Mínimo 8 caracteres"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
                <p className="text-xs text-mute mt-1">
                  Con esta contraseña vas a poder entrar a tu panel de referidos en /login con tu correo.
                </p>
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
