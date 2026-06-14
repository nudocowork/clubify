'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { PhoneInput } from '@/components/PhoneInput';
import {
  BUSINESS_CATEGORIES,
  DEFAULT_CATEGORY_SLUG,
} from '@/lib/business-categories';
import { AffiliatePickerSearch } from '@/components/AffiliatePickerSearch';

export default function NewTenant() {
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  type BillingMode = 'pending' | 'free' | 'trial' | 'paid';
  const [billingMode, setBillingMode] = useState<BillingMode>('pending');
  const [form, setForm] = useState({
    brandName: '',
    email: '',
    phone: '',
    ownerFullName: '',
    ownerPassword: '',
    planId: '',
    // M9: periodicidad del plan elegida por el admin. Informativo (no
    // altera billing real). Default vacío hasta que el admin elija.
    planPeriodicity: '' as '' | 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL',
    businessCategorySlug: DEFAULT_CATEGORY_SLUG,
    trialDays: 7,
    nextChargeDate: '',
    hotmartSubscriberCode: '',
    // B5: asignar este negocio (al crearlo) a un INFLUENCER/AMBASSADOR.
    // string vacío = sin asignación. El POST inicial no acepta esto, así
    // que después de crear el tenant disparamos PATCH al endpoint de
    // assignment (B3).
    referralCodeId: '',
  });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api('/tenants').then((arr: any[]) => {
      const seen = new Map();
      arr.forEach((t) => seen.set(t.plan.id, t.plan));
      setPlans(Array.from(seen.values()));
    });
  }, []);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm({ ...form, [k]: v });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const body: any = {
        brandName: form.brandName,
        email: form.email,
        phone: form.phone || undefined,
        ownerFullName: form.ownerFullName,
        ownerPassword: form.ownerPassword || undefined,
        planId: form.planId,
        planPeriodicity: form.planPeriodicity || undefined,
        businessCategorySlug: form.businessCategorySlug,
      };
      if (billingMode === 'free') {
        body.freeAccount = true;
      } else if (billingMode === 'trial') {
        body.trialDays = Math.max(1, Math.min(365, Number(form.trialDays) || 7));
      } else if (billingMode === 'paid') {
        if (form.nextChargeDate)
          body.nextChargeDate = new Date(form.nextChargeDate).toISOString();
        if (form.hotmartSubscriberCode.trim())
          body.hotmartSubscriberCode = form.hotmartSubscriberCode.trim();
      }
      const res = await api<any>('/tenants', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      // B5: si el admin eligió un afiliado, lo asignamos en una segunda
      // request al endpoint de assignment (B3). No bloqueamos la creación
      // del tenant si la asignación falla — solo warneamos.
      if (form.referralCodeId && res?.tenant?.id) {
        try {
          await api(`/referrals/tenants/${res.tenant.id}/assignment`, {
            method: 'PATCH',
            body: JSON.stringify({ referralCodeId: form.referralCodeId }),
          });
        } catch (assignErr: any) {
          console.warn('Asignación referral falló:', assignErr?.message);
        }
      }
      setResult(res);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (result) {
    // La contraseña a mostrar: si la generó el backend → result.ownerTempPassword;
    // si el admin la entró manualmente → form.ownerPassword (la guardamos en
    // memoria al submit, no se pierde al cambiar el state).
    const password = result.ownerTempPassword || form.ownerPassword || '';
    const email = result.tenant.email;
    const brand = result.tenant.brandName;
    const phone = form.phone;
    return (
      <div className="max-w-xl">
        <div className="page-head">
          <h1 className="page-title">Negocio creado</h1>
        </div>
        <div className="card card-pad">
          <div className="flex items-center gap-2 text-ok">
            <Icon name="check" size={22} />
            <h3 className="m-0 text-lg font-semibold">{brand} listo</h3>
          </div>
          <p className="text-sm text-mute mt-1.5 mb-4">
            Comparte estas credenciales con el dueño. La contraseña no se vuelve
            a mostrar después de salir de esta pantalla.
          </p>

          <div className="space-y-2.5">
            <CredentialRow label="Usuario / Email" value={email} />
            {password && (
              <CredentialRow label="Contraseña" value={password} mono highlight />
            )}
            {phone && <CredentialRow label="Teléfono" value={phone} />}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <SendButton
              kind="email"
              email={email}
              brand={brand}
              password={password}
              loginUrl="https://soyclubify.com/login"
            />
            <SendButton
              kind="whatsapp"
              phone={phone}
              email={email}
              brand={brand}
              password={password}
              loginUrl="https://soyclubify.com/login"
            />
          </div>

          <div className="mt-6 flex gap-2.5 pt-4 border-t border-line">
            <button className="btn-ghost" onClick={() => setResult(null)}>
              Crear otro
            </button>
            <button
              className="btn-primary"
              onClick={() => router.push('/admin/tenants')}
            >
              Volver a la lista
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="page-head">
        <h1 className="page-title">
          Nuevo negocio <span className="page-crumb">/ Negocios</span>
        </h1>
      </div>

      <form onSubmit={submit} className="card card-pad grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <label className="label">Nombre comercial</label>
          <input
            className="input"
            value={form.brandName}
            onChange={(e) => set('brandName', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Email del dueño</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Teléfono</label>
          <PhoneInput
            value={form.phone}
            onChange={(v) => set('phone', v)}
            placeholder="3001234567"
          />
          <div className="text-[11px] text-mute mt-1">
            Solo informativo · no enviamos notificaciones a este número.
          </div>
        </div>
        <div>
          <label className="label">Nombre del dueño</label>
          <input
            className="input"
            value={form.ownerFullName}
            onChange={(e) => set('ownerFullName', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Contraseña (opcional)</label>
          <input
            className="input"
            placeholder="Auto si lo dejas vacío"
            value={form.ownerPassword}
            onChange={(e) => set('ownerPassword', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Plan</label>
          <select
            className="input"
            value={form.planId}
            onChange={(e) => set('planId', e.target.value)}
            required
          >
            <option value="">Selecciona…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">
            Periodicidad{' '}
            <span className="text-mute font-normal">— informativo, NO altera el billing real (lo dicta Hotmart)</span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { v: 'MENSUAL', label: 'Mensual' },
                { v: 'TRIMESTRAL', label: 'Trimestral' },
                { v: 'SEMESTRAL', label: 'Semestral' },
                { v: 'ANUAL', label: 'Anual' },
              ] as const
            ).map((opt) => {
              const active = form.planPeriodicity === opt.v;
              return (
                <button
                  type="button"
                  key={opt.v}
                  onClick={() => set('planPeriodicity', active ? '' : opt.v)}
                  className={`rounded-input border-2 p-2.5 text-sm font-semibold transition ${
                    active
                      ? 'border-brand bg-brand-soft text-brand-700'
                      : 'border-line bg-white text-ink hover:border-brand/40'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-mute mt-1">
            Útil para CRM, reporting y filtros. Editable después desde la
            página del negocio.
          </div>
        </div>
        <div className="col-span-2">
          <label className="label">
            Asignar a embajador / influencer{' '}
            <span className="text-mute font-normal">— opcional</span>
          </label>
          <AffiliatePickerSearch
            value={form.referralCodeId}
            onChange={(id) => set('referralCodeId', id)}
            placeholder="Buscar por nombre, correo, teléfono o código…"
          />
          <div className="text-[11px] text-mute mt-1 leading-snug">
            Si el negocio fue traído por un afiliado offline, elegilo aquí.
            Las comisiones futuras se atribuyen automáticamente. Puedes
            cambiar esto después desde la página del negocio.
          </div>
        </div>

        <div className="col-span-2">
          <label className="label">Categoría del negocio</label>
          <select
            className="input"
            value={form.businessCategorySlug}
            onChange={(e) => set('businessCategorySlug', e.target.value)}
            required
          >
            {BUSINESS_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-mute mt-1 leading-relaxed">
            Define qué módulos verá el dueño en su panel (menú, pedidos,
            servicios, etc). Lista completa en{' '}
            <a
              href="/admin/business-categories"
              target="_blank"
              className="text-brand hover:underline"
            >
              /admin/business-categories
            </a>.
          </div>
        </div>
        {/* Facturación / Hotmart */}
        <div className="col-span-2 mt-2 border-t border-line2 pt-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-3">
            Facturación · Tipo de cuenta
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {(
              [
                {
                  v: 'pending',
                  emoji: '🔒',
                  label: 'Sin pago aún',
                  hint: 'Debe pagar en Hotmart antes de entrar',
                },
                {
                  v: 'free',
                  emoji: '🎁',
                  label: 'Cuenta sin costo',
                  hint: 'Cortesía indefinida, sin Hotmart',
                },
                {
                  v: 'trial',
                  emoji: '⏱',
                  label: 'Trial gratuito',
                  hint: 'Acceso por X días, luego pago',
                },
                {
                  v: 'paid',
                  emoji: '💳',
                  label: 'Hotmart activo',
                  hint: 'Ya pagó · enlazar fecha/código',
                },
              ] as const
            ).map((opt) => {
              const active = billingMode === opt.v;
              return (
                <button
                  type="button"
                  key={opt.v}
                  onClick={() => setBillingMode(opt.v)}
                  className={`text-left rounded-input border-2 p-3 transition ${
                    active
                      ? 'border-brand bg-brand-soft'
                      : 'border-line bg-white hover:border-brand/40'
                  }`}
                >
                  <div className="text-xl mb-0.5">{opt.emoji}</div>
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-mute mt-0.5">{opt.hint}</div>
                </button>
              );
            })}
          </div>

          {billingMode === 'trial' && (
            <div>
              <label className="label">Días de trial</label>
              <input
                className="input"
                type="number"
                min={1}
                max={365}
                value={form.trialDays}
                onChange={(e) =>
                  set('trialDays', Number(e.target.value) as any)
                }
              />
              <div className="text-[11px] text-mute mt-1">
                El negocio podrá usar el panel sin restricciones por{' '}
                <strong>{form.trialDays || 0}</strong> día
                {form.trialDays === 1 ? '' : 's'}. Cuando termine el trial,
                pasa a SUSPENDIDO automáticamente y debe pagar en Hotmart
                para reactivar.
              </div>
            </div>
          )}

          {billingMode === 'paid' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Próxima fecha de pago Hotmart</label>
                <input
                  className="input"
                  type="date"
                  value={form.nextChargeDate}
                  onChange={(e) => set('nextChargeDate', e.target.value)}
                />
                <div className="text-[11px] text-mute mt-1">
                  Cuando vence se renueva por webhook (si el código está
                  enlazado) o pasa a PAST_DUE.
                </div>
              </div>
              <div>
                <label className="label">Código suscriptor Hotmart</label>
                <input
                  className="input"
                  placeholder="opcional · si lo conoces del panel Hotmart"
                  value={form.hotmartSubscriberCode}
                  onChange={(e) =>
                    set('hotmartSubscriberCode', e.target.value)
                  }
                />
                <div className="text-[11px] text-mute mt-1">
                  Permite que el webhook de renovaciones encuentre este
                  tenant. Si no lo tienes, generamos uno manual.
                </div>
              </div>
            </div>
          )}

          {billingMode === 'pending' && (
            <div className="rounded-lg bg-bg2/60 px-3 py-2.5 text-xs text-mute">
              El dueño verá la pantalla de bloqueo apenas haga login. Tendrá
              que completar el pago en Hotmart para entrar al panel.
            </div>
          )}

          {billingMode === 'free' && (
            <div className="rounded-lg bg-ok-soft/50 border border-ok/20 px-3 py-2.5 text-xs text-ok-ink">
              Cuenta de cortesía: queda activa indefinidamente sin pasar por
              Hotmart. Para revocar acceso, suspende manualmente el tenant.
            </div>
          )}
        </div>

        {err && (
          <div className="col-span-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}
        <div className="col-span-2 mt-2">
          <button className="btn-primary" type="submit">
            <Icon name="check" /> Crear negocio
          </button>
        </div>
      </form>
    </div>
  );
}

function CredentialRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${
        highlight ? 'bg-warn-soft' : 'bg-bg2/50'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div
          className={`text-[10px] uppercase tracking-wider font-semibold ${
            highlight ? 'text-warn-ink' : 'text-mute'
          }`}
        >
          {label}
        </div>
        <div
          className={`text-sm truncate ${mono ? 'font-mono' : ''} ${
            highlight ? 'text-warn-ink font-semibold' : 'text-ink'
          }`}
        >
          {value}
        </div>
      </div>
      <button
        onClick={copy}
        className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-white border border-line hover:bg-bg2"
        type="button"
      >
        {copied ? '✓ Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function SendButton({
  kind,
  email,
  phone,
  brand,
  password,
  loginUrl,
}: {
  kind: 'email' | 'whatsapp';
  email?: string;
  phone?: string;
  brand: string;
  password: string;
  loginUrl: string;
}) {
  const body =
    `Hola, te creamos el panel de ${brand}.\n\n` +
    `Usuario: ${email}\n` +
    `Contraseña: ${password}\n\n` +
    `Entra acá: ${loginUrl}\n\n` +
    `Te recomendamos cambiar la contraseña al primer login.`;
  if (kind === 'email') {
    const href = `mailto:${encodeURIComponent(email ?? '')}?subject=${encodeURIComponent(
      `Credenciales de ${brand}`,
    )}&body=${encodeURIComponent(body)}`;
    return (
      <a
        href={href}
        className="text-center text-sm font-semibold py-2.5 rounded-lg bg-white border border-line hover:bg-bg2"
      >
        ✉ Enviar por email
      </a>
    );
  }
  // WhatsApp: requiere teléfono. Si no hay, deshabilitamos.
  if (!phone) {
    return (
      <button
        disabled
        className="text-sm font-semibold py-2.5 rounded-lg bg-bg2/50 text-mute cursor-not-allowed"
      >
        WhatsApp · sin teléfono
      </button>
    );
  }
  const cleanPhone = phone.replace(/\D/g, '');
  const href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-center text-sm font-semibold py-2.5 rounded-lg bg-[#25D366] text-white hover:opacity-95"
    >
      💬 Enviar por WhatsApp
    </a>
  );
}
