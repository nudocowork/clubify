'use client';
/**
 * Landing pública para postularse como embajador de una campaña.
 * URL: /refer/[ownerCode] — donde ownerCode es el código del
 * influencer titular. Cualquier persona con el link puede ver la info
 * de la campaña + dejar sus datos. Se crea un AFFILIATE_AMBASSADOR
 * ligado a la campaña (parentCode = código del influencer).
 *
 * Si la Setting referrals.requireAmbassadorApproval está activa, el
 * embajador queda en estado pendiente hasta que el admin lo apruebe
 * desde el panel — feedback explícito en la respuesta.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PhoneInput } from '@/components/PhoneInput';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type CampaignInfo = {
  campaignId: string;
  campaignName: string;
  influencerName: string;
  influencerCode: string;
  ambassadorsCount: number;
  defaultCommissionPercent: number;
};

type ApplyResponse = {
  ok: boolean;
  code?: string;
  pendingApproval?: boolean;
  alreadyExists?: boolean;
  message?: string;
};

export default function ApplyAmbassadorPage() {
  const { code } = useParams<{ code: string }>();
  const ownerCode = (code || '').toUpperCase();

  const [info, setInfo] = useState<CampaignInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', whatsapp: '' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    fetch(`${API}/api/public/campaigns/by-owner-code/${encodeURIComponent(ownerCode)}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.message ?? 'Campaña no encontrada');
        }
        return r.json();
      })
      .then((data: CampaignInfo) => setInfo(data))
      .catch((e) => setLoadError(e.message));
  }, [ownerCode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.fullName.trim() || !form.email.trim() || !form.whatsapp.trim()) {
      setErr('Completá todos los campos');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(
        `${API}/api/public/campaigns/by-owner-code/${encodeURIComponent(ownerCode)}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      // r.json() crashea con "Unexpected token <" si el response es HTML
      // (502/504 de un proxy o CDN). Hacemos catch para devolver mensaje
      // útil en vez de un SyntaxError opaco.
      const data: ApplyResponse = await r.json().catch(() => ({ ok: false } as any));
      if (!r.ok) {
        throw new Error(
          (data as any)?.message ??
            `Error ${r.status}. Intentá de nuevo en unos minutos.`,
        );
      }
      setResult(data);
    } catch (e: any) {
      setErr(e.message ?? 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="max-w-lg mx-auto px-6 py-12 text-center">
          <BrandHeader />
          <div className="text-4xl mb-3">🤷</div>
          <div className="font-semibold text-lg mb-1">{loadError}</div>
          <div className="text-sm text-mute mb-4">
            Revisá el link con quien te invitó o pedile uno nuevo.
          </div>
          <Link href="/" className="text-brand underline text-sm">
            Ir al inicio
          </Link>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-mute">Cargando…</div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="max-w-lg mx-auto px-6 py-12">
          <BrandHeader />
          <div className="card card-pad text-center">
            <div className="text-5xl mb-3">{result.pendingApproval ? '⏳' : '🎉'}</div>
            <div className="font-bold text-2xl mb-2">
              {result.alreadyExists
                ? 'Ya eras embajador'
                : result.pendingApproval
                ? '¡Solicitud enviada!'
                : '¡Bienvenido al equipo!'}
            </div>
            <div className="text-sm text-mute mb-4 leading-relaxed">
              {result.message}
            </div>
            {result.code && (
              <div className="bg-bg2 rounded-lg px-4 py-3 inline-block mb-4">
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
                  Tu código
                </div>
                <div className="font-mono font-bold text-2xl">{result.code}</div>
              </div>
            )}
            <div className="text-xs text-mute">
              Te enviamos un email a <strong>{form.email}</strong> con las
              instrucciones para acceder a tu panel.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-lg mx-auto px-6 py-8">
        <BrandHeader />

        <div className="card card-pad mb-4 bg-gradient-to-br from-brand-soft to-bg2/30">
          <div className="text-[10px] uppercase tracking-wider text-brand font-bold mb-1">
            Campaña Clubify
          </div>
          <div className="font-bold text-2xl leading-tight">
            {info.campaignName}
          </div>
          <div className="text-sm text-mute mt-1">
            Liderada por <strong>{info.influencerName}</strong>
            {info.ambassadorsCount > 0 && (
              <>
                {' '}· {info.ambassadorsCount} embajador{info.ambassadorsCount === 1 ? '' : 'es'} ya sumado{info.ambassadorsCount === 1 ? '' : 's'}
              </>
            )}
          </div>
        </div>

        <div className="card card-pad mb-4">
          <h1 className="font-bold text-xl mb-1">Sumate como embajador</h1>
          <p className="text-sm text-mute mb-4 leading-relaxed">
            Recibí <strong>{info.defaultCommissionPercent}% de comisión</strong>{' '}
            por cada negocio que se suscriba con tu código. Dejá tus datos y te
            enviamos acceso al panel donde podés trackear tus ventas.
          </p>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">Nombre completo</label>
              <input
                className="input"
                placeholder="Sara Pérez"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                autoComplete="name"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="sara@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoComplete="email"
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
              {submitting ? 'Enviando…' : 'Sumarme'}
            </button>
          </form>

          <div className="text-[11px] text-mute mt-3 leading-relaxed text-center">
            Al enviarlo aceptás recibir comunicaciones de Clubify y de la
            campaña <strong>{info.campaignName}</strong>. Podés darte de baja
            cuando quieras.
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandHeader() {
  return (
    <Link href="/" className="flex items-center gap-2.5 mb-6">
      <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center font-bold">
        C
      </div>
      <div className="font-bold text-lg">Clubify</div>
    </Link>
  );
}
