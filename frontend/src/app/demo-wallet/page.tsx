'use client';
/**
 * Demo wallet flow — landing pública para que prospects experimenten
 * Clubify en su propio teléfono. El afiliado/embajador comparte el link
 * (opcional con ?ref=<su-code>) y el prospect:
 *   1. Ve el pitch
 *   2. Llena nombre + WhatsApp
 *   3. Recibe un pase de fidelización REAL en Apple/Google Wallet
 *
 * Backend usa la card configurada vía Setting `demo.cardId`. Si no está
 * configurada, mostramos error explicando el setup pendiente.
 */
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PhoneInput } from '@/components/PhoneInput';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export default function DemoWalletPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const ref = sp?.get('ref') ?? null;

  const [form, setForm] = useState({ fullName: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Capturar ref en localStorage para que si el prospect vuelve después
  // y compra Clubify, podamos atribuirlo al afiliado original.
  useEffect(() => {
    if (ref) {
      try {
        localStorage.setItem('clubify_demo_ref', ref);
      } catch {}
    }
  }, [ref]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.fullName.trim()) {
      setErr('Necesitamos tu nombre para la tarjeta');
      return;
    }
    if (!form.phone.trim() || form.phone.replace(/\D/g, '').length < 8) {
      setErr('Necesitamos tu WhatsApp para enviarte tu tarjeta');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/passes/demo-wallet/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          ref: ref ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.message ??
            `Error ${res.status}. Intentá de nuevo en unos minutos.`,
        );
      }
      if (!data?.passId) {
        throw new Error('No se pudo emitir el pase. Intentá de nuevo.');
      }
      router.push(`/w/${data.passId}`);
    } catch (e: any) {
      setErr(e?.message ?? 'Error');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-bg via-bg to-bg2/40">
      <div className="max-w-md mx-auto px-5 py-10 animate-in fade-in duration-300">
        <Link href="/" className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center font-bold">
            C
          </div>
          <div className="font-bold text-lg">Clubify</div>
        </Link>

        <div className="card card-pad mb-4 bg-gradient-to-br from-brand-soft to-bg2/30">
          <div className="text-[10px] uppercase tracking-wider text-brand font-bold mb-1">
            Demo en vivo
          </div>
          <h1 className="font-bold text-2xl leading-tight mb-2">
            Probá una tarjeta de fidelización Clubify en tu celular
          </h1>
          <p className="text-sm text-mute leading-relaxed">
            En 10 segundos vas a tener un pase real en tu Apple Wallet o
            Google Wallet — igual al que reciben los clientes de los
            negocios que usan Clubify.
          </p>
        </div>

        <div className="card card-pad">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">Tu nombre</label>
              <input
                className="input"
                placeholder="Ej: Sara Pérez"
                value={form.fullName}
                onChange={(e) =>
                  setForm({ ...form, fullName: e.target.value })
                }
                autoComplete="name"
                maxLength={80}
              />
            </div>
            <div>
              <label className="label">Tu WhatsApp</label>
              <PhoneInput
                value={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
                placeholder="300 000 0000"
              />
              <div className="text-[11px] text-mute mt-1 leading-snug">
                Solo lo usamos para vincular tu pase. No te vamos a llamar.
              </div>
            </div>

            {err && (
              <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full justify-center disabled:opacity-50"
            >
              {submitting ? 'Generando tu pase…' : '✨ Quiero mi tarjeta demo'}
            </button>
          </form>

          <div className="text-[11px] text-mute mt-3 leading-relaxed text-center">
            Al continuar aceptás recibir tu pase wallet de demostración.
            No vas a recibir mensajes promocionales — esto es solo para
            que veas cómo se ve en tu teléfono.
          </div>
        </div>

        <div className="mt-6 card card-pad bg-bg2/30">
          <div className="text-xs font-semibold mb-2">¿Qué viene después?</div>
          <ol className="text-xs text-mute space-y-1.5 leading-relaxed pl-4 list-decimal">
            <li>
              Te llevamos a una pantalla con los botones <strong>Agregar a
              Apple Wallet</strong> y <strong>Save to Google Wallet</strong>.
            </li>
            <li>
              Tocás el de tu teléfono y el pase queda guardado en tu wallet
              real, como cualquier tarjeta de boleto de avión.
            </li>
            <li>
              Eso es exactamente lo que viven los clientes de cualquier
              negocio que usa Clubify.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
