'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Pricing = {
  eliteCost: number;
  proCost: number;
  currency: string;
};

const CURRENCIES = ['USD', 'COP', 'MXN', 'ARS', 'EUR'];

export default function CotizacionesPreciosPage() {
  const [p, setP] = useState<Pricing>({ eliteCost: 50, proCost: 99, currency: 'USD' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setP(await api<Pricing>('/admin/pricing'));
    } catch (e: any) {
      toast(e.message || 'Error cargando precios', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!Number.isFinite(p.eliteCost) || p.eliteCost < 0) {
      toast('Precio Elite inválido', 'error');
      return;
    }
    if (!Number.isFinite(p.proCost) || p.proCost < 0) {
      toast('Precio Pro inválido', 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await api<Pricing>('/admin/pricing', {
        method: 'PATCH',
        body: JSON.stringify(p),
      });
      setP(next);
      toast('Precios guardados', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Precios de cotización{' '}
          <span className="page-crumb">/ Super Admin</span>
        </h1>
        <div className="flex gap-2">
          <Link className="btn-ghost" href="/admin/cotizaciones">
            <span className="inline-block" style={{ transform: 'scaleX(-1)' }}>
              <Icon name="arrow-right" />
            </span>
            Volver
          </Link>
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || loading}
          >
            <Icon name="check" /> {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card card-pad">
          <div className="h-4 bg-bg2 rounded animate-shimmer mb-3" />
          <div className="h-32 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="card card-pad">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold m-0">Plan Elite</h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-bg2 text-fg">
                  ELITE
                </span>
              </div>
              <p className="text-xs text-mute mt-1 leading-relaxed">
                Incluye tarjetas de fidelización, menú digital, infolinks y
                reseñas de Google.
              </p>
              <label className="label mt-3.5">Precio mensual</label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="input pl-12 text-lg font-semibold"
                  value={Number.isFinite(p.eliteCost) ? p.eliteCost : ''}
                  onChange={(e) =>
                    setP({ ...p, eliteCost: Number(e.target.value) })
                  }
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-mono text-sm">
                  {p.currency}
                </span>
              </div>
            </div>

            <div className="card card-pad bg-brand-soft border-brand/30">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold m-0">Plan Pro</h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand text-white">
                  PRO
                </span>
              </div>
              <p className="text-xs text-mute mt-1 leading-relaxed">
                Todo Elite + automatizaciones WhatsApp, menú delivery, toma de
                pedidos por WA y administrativo (recordatorios, proveedores).
              </p>
              <label className="label mt-3.5">Precio mensual</label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="input pl-12 text-lg font-semibold"
                  value={Number.isFinite(p.proCost) ? p.proCost : ''}
                  onChange={(e) =>
                    setP({ ...p, proCost: Number(e.target.value) })
                  }
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-mono text-sm">
                  {p.currency}
                </span>
              </div>
            </div>
          </div>

          <div className="card card-pad mt-5">
            <h2 className="text-base font-semibold m-0">Moneda</h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              Código ISO de 3 letras. Se muestra en la cotización generada y en
              el PDF descargado.
            </p>
            <div className="mt-3.5 max-w-xs">
              <select
                className="input"
                value={p.currency}
                onChange={(e) => setP({ ...p, currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card card-pad mt-5 bg-bg2/40 border-line">
            <h3 className="text-sm font-semibold m-0">¿Cómo se aplica?</h3>
            <ul className="text-xs text-mute mt-2 leading-relaxed space-y-1.5 list-disc pl-4">
              <li>
                Los cambios afectan SOLO a las cotizaciones que se generen
                desde ahora en adelante.
              </li>
              <li>
                Las cotizaciones ya creadas mantienen el precio que tenían
                cuando se generaron (snapshot), así los PDFs descargados
                siguen siendo válidos.
              </li>
              <li>
                Si querés cotizar a un precio especial puntual para un cliente,
                editá acá temporalmente y volvé al valor original después.
              </li>
            </ul>
          </div>

          <HotmartCouponCard />
        </>
      )}
    </div>
  );
}

/** Card para configurar el cupón Hotmart global. Item 28 del spec —
 *  permite aplicar un descuento manual a TODOS los checkouts sin tener
 *  que crear una offer pre-configurada en Hotmart. La offer
 *  pre-configurada sigue siendo el método A (env vars
 *  HOTMART_OFFER_CODE_*) — este input es el método B (cupón manual). */
function HotmartCouponCard() {
  const [loaded, setLoaded] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [original, setOriginal] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ couponCode: string | null }>('/admin/billing/hotmart-coupon')
      .then((r) => {
        const v = r.couponCode ?? '';
        setCoupon(v);
        setOriginal(v);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ couponCode: string | null }>(
        '/admin/billing/hotmart-coupon',
        {
          method: 'PATCH',
          body: JSON.stringify({ couponCode: coupon.trim() || null }),
        },
      );
      const v = r.couponCode ?? '';
      setOriginal(v);
      toast(v ? `Cupón activo: ${v}` : 'Cupón removido — sin descuento', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="card card-pad mt-5">
      <h3 className="text-sm font-semibold m-0 flex items-center gap-2">
        🎟 Cupón Hotmart global
      </h3>
      <p className="text-xs text-mute mt-1.5 leading-relaxed">
        Cupón manual que se agrega a TODOS los checkouts vía{' '}
        <code>?couponCode=X</code>. Hotmart aplica el descuento al cargar
        la página de pago. Es la opción <strong>B</strong> de descuentos —
        la opción A son las offers pre-configuradas en Hotmart vía env
        vars (<code>HOTMART_OFFER_CODE_ELITE</code>, etc) y pueden
        coexistir con un cupón aquí.
      </p>
      <div className="flex gap-2 items-center mt-3 flex-wrap">
        <input
          value={coupon}
          onChange={(e) => setCoupon(e.target.value.toUpperCase())}
          placeholder="DESCUENTO20"
          className="input font-mono text-sm flex-1 min-w-[180px]"
          maxLength={40}
        />
        <button
          onClick={save}
          disabled={busy || coupon.trim() === original.trim()}
          className="btn-primary disabled:opacity-50 text-sm"
        >
          {busy ? 'Guardando…' : original ? 'Actualizar' : 'Aplicar cupón'}
        </button>
        {original && (
          <button
            onClick={() => {
              setCoupon('');
              save();
            }}
            disabled={busy}
            className="btn-ghost text-xs"
          >
            Quitar
          </button>
        )}
      </div>
      {original && (
        <div className="text-[11px] text-ok mt-2">
          ✓ Cupón activo: <code className="text-ink">{original}</code> —
          se aplica a Elite y Pro
        </div>
      )}
    </div>
  );
}
