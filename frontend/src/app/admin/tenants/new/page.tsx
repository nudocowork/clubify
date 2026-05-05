'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

export default function NewTenant() {
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  const [form, setForm] = useState({
    brandName: '',
    email: '',
    phone: '',
    ownerFullName: '',
    ownerPassword: '',
    planId: '',
    primaryColor: '#22C55E',
    secondaryColor: '#15803D',
    freeAccount: false,
    nextChargeDate: '',
    hotmartSubscriberCode: '',
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
      // Construir body limpiando campos vacíos para que el backend respete defaults
      const body: any = {
        brandName: form.brandName,
        email: form.email,
        phone: form.phone || undefined,
        ownerFullName: form.ownerFullName,
        ownerPassword: form.ownerPassword || undefined,
        planId: form.planId,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
      };
      if (form.freeAccount) {
        body.freeAccount = true;
      } else {
        // ISO datestring si admin escogió fecha
        if (form.nextChargeDate)
          body.nextChargeDate = new Date(form.nextChargeDate).toISOString();
        if (form.hotmartSubscriberCode.trim())
          body.hotmartSubscriberCode = form.hotmartSubscriberCode.trim();
      }
      const res = await api('/tenants', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResult(res);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (result) {
    return (
      <div className="max-w-xl">
        <div className="page-head">
          <h1 className="page-title">Negocio creado</h1>
        </div>
        <div className="card card-pad">
          <div className="flex items-center gap-2 text-ok">
            <Icon name="check" size={22} />
            <h3 className="m-0 text-lg font-semibold">Listo</h3>
          </div>
          <div className="mt-4 text-sm space-y-1">
            <div>
              <span className="text-mute">Marca:</span>{' '}
              <strong>{result.tenant.brandName}</strong>
            </div>
            <div>
              <span className="text-mute">Email del dueño:</span> {result.tenant.email}
            </div>
            {result.ownerTempPassword && (
              <div className="mt-3 rounded-lg bg-warn-soft px-3 py-3">
                <div className="text-[11px] uppercase tracking-wider text-warn-ink font-semibold">
                  Contraseña temporal
                </div>
                <code className="text-base text-warn-ink">{result.ownerTempPassword}</code>
              </div>
            )}
          </div>
          <div className="mt-6 flex gap-2.5">
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
          <input
            className="input"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
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
        <div>
          <label className="label">Color principal</label>
          <input
            className="input h-11"
            type="color"
            value={form.primaryColor}
            onChange={(e) => set('primaryColor', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Color secundario</label>
          <input
            className="input h-11"
            type="color"
            value={form.secondaryColor}
            onChange={(e) => set('secondaryColor', e.target.value)}
          />
        </div>

        {/* Facturación / Hotmart */}
        <div className="col-span-2 mt-2 border-t border-line2 pt-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-3">
            Facturación
          </div>

          <label className="flex items-start gap-2.5 text-sm cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={form.freeAccount}
              onChange={(e) => set('freeAccount', e.target.checked)}
              className="mt-1 accent-brand"
            />
            <span>
              <span className="font-medium">Cuenta sin costo (cortesía)</span>
              <div className="text-xs text-mute mt-0.5">
                El negocio queda activo sin pasar por Hotmart. Se omite el
                lockscreen y nunca se cobra. Útil para internos, partners,
                beta testers o regalos.
              </div>
            </span>
          </label>

          {!form.freeAccount && (
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
                  Si la dejas, el tenant arranca <strong>activo</strong> con
                  esa fecha de renovación. Si la dejas vacía, queda como
                  prueba y debe pagar en Hotmart para entrar.
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
                  Permite que el webhook futuro de renovaciones encuentre
                  este tenant. Si no lo tienes, generamos uno manual.
                </div>
              </div>
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
