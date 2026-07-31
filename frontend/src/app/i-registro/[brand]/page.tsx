'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, setSession } from '@/lib/api';

type Brand = {
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  backgroundColor: string | null;
  hasCredits: boolean;
};

/**
 * Auto-registro de un negocio "Solo InfoLink" desde el link de una marca:
 *   soyclubify.com/i-registro/<marca>
 * El cliente se registra → se crea el negocio INFOLINK bajo la marca y se
 * descuenta 0.25 créditos de la marca. Al terminar, auto-login a /app.
 */
export default function InfoLinkSignupPage() {
  const params = useParams();
  const router = useRouter();
  const brandSlug = String(params?.brand ?? '');

  const [brand, setBrand] = useState<Brand | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ brandName: '', fullName: '', email: '', password: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ blocked: boolean } | null>(null);

  useEffect(() => {
    if (!brandSlug) return;
    api<Brand>(`/auth/infolink-brand/${encodeURIComponent(brandSlug)}`)
      .then(setBrand)
      .catch(() => setNotFound(true));
  }, [brandSlug]);

  const primary = brand?.primaryColor || '#0F3D2E';
  const bg = brand?.backgroundColor || '#f7fbf8';

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!form.brandName.trim() || !form.fullName.trim() || !form.email.trim() || form.password.length < 6) {
      setErr('Completa todos los campos (contraseña mínimo 6 caracteres).');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{
        accessToken: string;
        refreshToken?: string;
        blocked: boolean;
        user: any;
      }>('/auth/infolink-signup', {
        method: 'POST',
        body: JSON.stringify({
          brandSlug,
          brandName: form.brandName.trim(),
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          password: form.password,
          phone: form.phone.trim() || undefined,
        }),
      });
      setSession(res.accessToken, res.user, { refreshToken: res.refreshToken });
      if (res.blocked) {
        setDone({ blocked: true });
      } else {
        router.replace('/app');
      }
    } catch (e: any) {
      setErr(e?.message || 'No se pudo completar el registro.');
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: bg, padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 40 }}>🔗</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '8px 0' }}>Enlace no válido</h1>
          <p style={{ color: '#6b7785', fontSize: 14 }}>Este enlace de registro no existe o la marca no está disponible.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: bg, padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 18, boxShadow: '0 12px 40px rgba(0,0,0,.12)', padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          {brand?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} style={{ height: 44, objectFit: 'contain', margin: '0 auto 10px' }} />
          ) : (
            <div style={{ fontSize: 34, marginBottom: 6 }}>🔗</div>
          )}
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Crea tu InfoLink</h1>
          <p style={{ color: '#6b7785', fontSize: 13.5, marginTop: 6 }}>
            {brand ? `Tu mini-página con ${brand.name}. Lista en minutos.` : 'Cargando…'}
          </p>
        </div>

        {done?.blocked ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 38 }}>✅</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '8px 0' }}>¡Cuenta creada!</h2>
            <p style={{ color: '#6b7785', fontSize: 14, lineHeight: 1.5 }}>
              Tu InfoLink está lista pero pendiente de activación por la marca. Te avisaremos apenas quede activa.
            </p>
            <button
              onClick={() => router.replace('/app')}
              style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: primary, color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              Ir a mi panel
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            {brand && !brand.hasCredits && (
              <div style={{ marginBottom: 12, fontSize: 12.5, color: '#92610a', background: '#fef3c7', borderRadius: 10, padding: '8px 10px' }}>
                Podrás registrarte, pero la marca deberá activar tu InfoLink (sin cupo disponible ahora).
              </div>
            )}
            {[
              { k: 'brandName', label: 'Nombre de tu negocio', type: 'text', ph: 'Ej: Café del Centro' },
              { k: 'fullName', label: 'Tu nombre', type: 'text', ph: 'Nombre y apellido' },
              { k: 'email', label: 'Email', type: 'email', ph: 'tucorreo@ejemplo.com' },
              { k: 'phone', label: 'WhatsApp (opcional)', type: 'tel', ph: '+57…' },
              { k: 'password', label: 'Contraseña', type: 'password', ph: 'Mínimo 6 caracteres' },
            ].map((f) => (
              <label key={f.k} style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 5 }}>{f.label}</span>
                <input
                  type={f.type}
                  value={(form as any)[f.k]}
                  onChange={(e) => set(f.k as keyof typeof form, e.target.value)}
                  placeholder={f.ph}
                  required={f.k !== 'phone'}
                  autoComplete={f.k === 'password' ? 'new-password' : 'off'}
                  style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 14, outline: 'none' }}
                />
              </label>
            ))}

            {err && (
              <div style={{ marginBottom: 12, fontSize: 13, color: '#b91c1c', background: '#fee2e2', borderRadius: 10, padding: '8px 10px' }}>{err}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: primary, color: '#fff', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Creando…' : 'Crear mi InfoLink'}
            </button>
            <p style={{ textAlign: 'center', color: '#9aa5b1', fontSize: 11.5, marginTop: 12 }}>
              Al registrarte aceptas los términos del servicio.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
