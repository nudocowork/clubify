'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// PDF Soft 10: panel de "pagó pero no activó". Lista unificada de los 3
// Pending*Payment sin consumir + datos del comprador + link de activación.
type PendingRow = {
  gateway: 'HOTMART' | 'STRIPE' | 'CROSS';
  email: string;
  name: string | null;
  phone: string | null;
  amountUsd: number | null;
  purchaseDate: string | null;
  activationLink: string;
  createdAt: string;
  ageHours: number;
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
function fmtAge(h: number) {
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
function gwBadge(g: string) {
  const map: Record<string, string> = {
    HOTMART: 'bg-orange-100 text-orange-700',
    STRIPE: 'bg-indigo-100 text-indigo-700',
    CROSS: 'bg-emerald-100 text-emerald-700',
  };
  return map[g] ?? 'bg-bg2 text-mute';
}

export default function PendingPaymentsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<PendingRow[]>('/admin/pending-payments');
      setRows(data ?? []);
    } catch {
      toast('No se pudieron cargar los pagos pendientes', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link de activación copiado', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }

  async function resend(r: PendingRow) {
    // Stripe/Cross: no hay reenvío automático aún → copiar el link.
    if (r.gateway !== 'HOTMART') {
      copyLink(r.activationLink);
      return;
    }
    setResending(r.email);
    try {
      const res = await api<{ ok: boolean; found: boolean }>(
        '/admin/pending-payments/resend',
        { method: 'POST', body: JSON.stringify({ email: r.email, gateway: r.gateway }) },
      );
      if (res?.ok)
        toast('Enlace reenviado al comprador (email + WhatsApp/SMS)', 'success');
      else toast('No se encontró el pago pendiente para reenviar', 'info');
    } catch {
      toast('Error al reenviar', 'error');
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Pagos sin activar</h1>
        <button className="btn-ghost text-sm" onClick={load}>
          Actualizar
        </button>
      </div>
      <p className="text-sm text-mute mb-4">
        Compradores que pagaron (Hotmart o la pasarela de la marca) pero aún no
        terminaron de crear su cuenta. Reenvíales el enlace de activación o
        complétales el registro.
      </p>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">Pasarela</th>
                <th className="px-4 py-3 font-semibold">Comprador</th>
                <th className="px-4 py-3 font-semibold">Contacto</th>
                <th className="px-4 py-3 font-semibold text-right">Monto</th>
                <th className="px-4 py-3 font-semibold">Fecha de compra</th>
                <th className="px-4 py-3 font-semibold text-center">Espera</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-mute">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-mute">
                    <div className="text-3xl mb-2">✅</div>
                    No hay pagos pendientes de activación.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, i) => (
                  <tr
                    key={`${r.gateway}-${r.email}-${i}`}
                    className="border-t border-line2 hover:bg-bg2/40"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${gwBadge(r.gateway)}`}
                      >
                        {r.gateway}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name ?? '—'}</div>
                      <div className="text-[11px] text-mute">{r.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.phone ? (
                        <a
                          className="text-brand hover:underline"
                          href={`https://wa.me/${r.phone.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.phone}
                        </a>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {r.amountUsd != null ? `$${r.amountUsd.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {fmtDate(r.purchaseDate)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          r.ageHours >= 24
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-bg2 text-mute'
                        }`}
                      >
                        {fmtAge(r.ageHours)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        className="btn-ghost text-xs mr-1"
                        onClick={() => copyLink(r.activationLink)}
                        title={r.activationLink}
                      >
                        Copiar link
                      </button>
                      <button
                        className="btn-primary text-xs"
                        disabled={resending === r.email}
                        onClick={() => resend(r)}
                      >
                        {resending === r.email
                          ? 'Enviando…'
                          : r.gateway === 'HOTMART'
                            ? 'Reenviar'
                            : 'Copiar'}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
