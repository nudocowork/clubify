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
        </>
      )}
    </div>
  );
}
