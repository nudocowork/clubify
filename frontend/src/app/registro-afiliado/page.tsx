'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthBrand, BrandMark } from '@/components/AuthBrand';
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

// Países principales (LATAM + España/USA). El code de 2 letras se persiste
// en ReferralCode.country. Alineado con PhoneInput.
const COUNTRIES: { code: string; name: string }[] = [
  { code: 'CO', name: 'Colombia' },
  { code: 'MX', name: 'México' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'PE', name: 'Perú' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'PA', name: 'Panamá' },
  { code: 'BZ', name: 'Belice' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'DO', name: 'R. Dominicana' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'ES', name: 'España' },
  { code: 'US', name: 'Estados Unidos' },
];

export default function RegistroAfiliadoPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center text-sm text-mute">
          Cargando…
        </main>
      }
    >
      <RegistroAfiliadoInner />
    </Suspense>
  );
}

function RegistroAfiliadoInner() {
  const router = useRouter();
  // #35 (2026-06-16): links de registro específicos por rol. Si la URL trae
  // ?role=influencer|ambassador, se pre-selecciona ese rol y se oculta el
  // picker — así la empresa comparte "Link de Registro Influencer" y "Link
  // de Registro Embajador" por separado.
  const searchParams = useSearchParams();
  const roleParam = (searchParams.get('role') ?? '').toLowerCase();
  const forcedRole: Role | null =
    roleParam === 'influencer'
      ? 'INFLUENCER'
      : roleParam === 'ambassador' || roleParam === 'embajador'
        ? 'AMBASSADOR'
        : null;
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('CO');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Logo/nombre de la marca del host (Sellea en selleala.com) → nunca Clubify.
  const { brand } = useAuthBrand();

  useEffect(() => {
    fetch(`${API}/api/public/affiliate-signup/config`)
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        // Si la URL fuerza un rol válido y habilitado, respetarlo.
        if (forcedRole === 'INFLUENCER' && c.allowInfluencer) {
          setRole('INFLUENCER');
        } else if (forcedRole === 'AMBASSADOR' && c.allowAmbassador) {
          setRole('AMBASSADOR');
        } else if (c.allowInfluencer) {
          setRole('INFLUENCER');
        } else if (c.allowAmbassador) {
          setRole('AMBASSADOR');
        }
      })
      .catch(() => setConfig({ enabled: false, allowInfluencer: false, allowAmbassador: false, influencerCommissionPct: 0, ambassadorCommissionPct: 0 }))
      .finally(() => setLoading(false));
  }, []);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/public/affiliate-signup/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, fullName, email, phone, password, country }),
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
          <BrandMark brand={brand} size={32} />
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
          <BrandMark brand={brand} size={32} />
        </Link>

        <h1 className="text-xl font-bold">Únete como afiliado</h1>
        <p className="text-sm text-mute mt-1.5">
          Genera ingresos refiriendo negocios a {brand?.name ?? 'Clubify'}. Tu
          comisión se acredita automáticamente con cada venta.
        </p>

        {config.allowInfluencer &&
          config.allowAmbassador &&
          !(forcedRole === 'INFLUENCER' && config.allowInfluencer) &&
          !(forcedRole === 'AMBASSADOR' && config.allowAmbassador) && (
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

        {config.allowInfluencer &&
          config.allowAmbassador &&
          role &&
          ((forcedRole === 'INFLUENCER' && config.allowInfluencer) ||
            (forcedRole === 'AMBASSADOR' && config.allowAmbassador)) && (
            <div className="mt-4 p-3 rounded-lg bg-bg2/60 text-sm">
              <span className="font-semibold">
                {role === 'INFLUENCER' ? '📣 Influencer' : '🤝 Embajador'}
              </span>{' '}
              · Comisión {pct}%
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                minLength={2}
                maxLength={40}
                placeholder="María"
              />
            </div>
            <div>
              <label className="label">Apellido</label>
              <input
                className="input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                minLength={2}
                maxLength={40}
                placeholder="Pérez"
              />
            </div>
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
            <label className="label">País</label>
            <select
              className="input"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              required
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">WhatsApp</label>
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
          <div>
            <label className="label">Confirmar contraseña</label>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Repite tu contraseña"
            />
            {confirmPassword.length > 0 && confirmPassword !== password && (
              <p className="text-xs text-bad-ink mt-1">Las contraseñas no coinciden</p>
            )}
          </div>

          {error && (
            <div className="text-sm text-bad-ink bg-bad-soft rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              !role ||
              !firstName.trim() ||
              !lastName.trim() ||
              !email ||
              !phone ||
              password.length < 8 ||
              password !== confirmPassword
            }
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
