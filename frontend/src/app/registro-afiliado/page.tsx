'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { PhoneInput } from '@/components/PhoneInput';
import { setSession } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Config = {
  enabled: boolean;
  allowInfluencer: boolean;
  allowAmbassador: boolean;
  influencerCommissionPct: number;
  ambassadorCommissionPct: number;
};

type Role = 'INFLUENCER' | 'AMBASSADOR';

export default function RegistroAfiliadoPage() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/public/affiliate-signup/config`)
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        if (c.allowInfluencer && c.allowAmbassador) {
          setRole('INFLUENCER');
        } else if (c.allowInfluencer) {
          setRole('INFLUENCER');
        } else if (c.allowAmbassador) {
          setRole('AMBASSADOR');
        }
      })
      .catch(() => setConfig({ enabled: false, allowInfluencer: false, allowAmbassador: false, influencerCommissionPct: 0, ambassadorCommissionPct: 0 }))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/public/affiliate-signup/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, fullName, email, phone, password }),
      });
      if (!res.ok) {
        const txt = await res.text();
        try {
          const j = JSON.parse(txt);
          throw new Error(j.message ?? txt);
        } catch {
          throw new Error(txt || 'No se pudo crear la cuenta');
        }
      }
      const data = await res.json();
      setSession(data.accessToken, data.user, { refreshToken: data.refreshToken });
      router.push('/affiliate?welcome=affiliate');
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo registrar');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-mute">
        Cargando…
      </main>
    );
  }

  if (!config?.enabled || (!config.allowInfluencer && !config.allowAmbassador)) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center px-4">
        <div className="w-full max-w-md card card-pad text-center">
          <Logo size={32} />
          <h1 className="text-xl font-bold mt-4">Registro no disponible</h1>
          <p className="text-sm text-mute mt-2">
            El registro público de afiliados no está habilitado por ahora.
            Contáctanos para más información.
          </p>
          <Link href="/" className="btn-ghost w-full justify-center mt-5">
            ← Volver al inicio
          </Link>
        </div>
      </main>
    );
  }

  const pct = role === 'INFLUENCER' ? config.influencerCommissionPct : config.ambassadorCommissionPct;

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md card card-pad">
        <Link href="/" className="flex items-center mb-4">
          <Logo size={32} />
        </Link>

        <h1 className="text-xl font-bold">Únete como afiliado</h1>
        <p className="text-sm text-mute mt-1.5">
          Genera ingresos refiriendo negocios a Clubify. Tu comisión se acredita
          automáticamente con cada venta.
        </p>

        {config.allowInfluencer && config.allowAmbassador && (
          <div className="mt-5">
            <label className="label">Tipo de afiliado</label>
            <div className="grid grid-cols-2 gap-2">
              <RoleCard
                active={role === 'INFLUENCER'}
                onClick={() => setRole('INFLUENCER')}
                emoji="📣"
                title="Influencer"
                description="Refiere desde tus redes"
                pct={config.influencerCommissionPct}
              />
              <RoleCard
                active={role === 'AMBASSADOR'}
                onClick={() => setRole('AMBASSADOR')}
                emoji="🤝"
                title="Embajador"
                description="Coordina un equipo de vendedores"
                pct={config.ambassadorCommissionPct}
              />
            </div>
          </div>
        )}

        {!config.allowInfluencer && config.allowAmbassador && (
          <div className="mt-4 p-3 rounded-lg bg-bg2/60 text-sm">
            <span className="font-semibold">🤝 Embajador</span> · Comisión {pct}%
          </div>
        )}
        {config.allowInfluencer && !config.allowAmbassador && (
          <div className="mt-4 p-3 rounded-lg bg-bg2/60 text-sm">
            <span className="font-semibold">📣 Influencer</span> · Comisión {pct}%
          </div>
        )}

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="label">Nombre completo</label>
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder="María Pérez"
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="tu@email.com"
            />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <PhoneInput value={phone} onChange={setPhone} placeholder="3001234567" />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          {error && (
            <div className="text-sm text-bad-ink bg-bad-soft rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !role || !fullName || !email || !phone || password.length < 8}
            className="btn-primary w-full justify-center mt-2"
          >
            {submitting ? 'Creando cuenta…' : `Registrarme · ${pct}% comisión`}
          </button>
        </form>

        <p className="text-[11px] text-mute mt-4 text-center">
          Al registrarte aceptas los{' '}
          <a href="https://soyclubify.com/terminos" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
            términos y condiciones
          </a>
          .
        </p>
      </div>
    </main>
  );
}

function RoleCard({
  active,
  onClick,
  emoji,
  title,
  description,
  pct,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  title: string;
  description: string;
  pct: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-lg border-2 transition ${
        active ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-brand/40'
      }`}
    >
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold text-sm mt-1">{title}</div>
      <div className="text-[11px] text-mute mt-0.5 leading-tight">{description}</div>
      <div className="text-[11px] font-bold text-brand mt-1">{pct}% comisión</div>
    </button>
  );
}
