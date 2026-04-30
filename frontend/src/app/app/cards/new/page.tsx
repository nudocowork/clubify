'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

const TYPES = ['STAMPS', 'POINTS', 'DISCOUNT', 'MEMBERSHIP', 'COUPON', 'GIFT', 'MULTI'] as const;
type CardType = (typeof TYPES)[number];

const TYPE_LABEL: Record<CardType, string> = {
  STAMPS: 'Sellos',
  POINTS: 'Puntos',
  DISCOUNT: 'Descuento',
  MEMBERSHIP: 'Membresía',
  COUPON: 'Cupón',
  GIFT: 'Regalo',
  MULTI: 'Múltiple',
};

export default function NewCard() {
  const router = useRouter();
  const [form, setForm] = useState({
    type: 'STAMPS' as CardType,
    name: '',
    description: '',
    terms: '',
    primaryColor: '#5B5EEE',
    secondaryColor: '#C026D3',
    stampsRequired: 10,
    rewardText: '1 producto gratis',
    discountPercent: 10,
  });
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const created = await api<any>('/cards', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      router.push(`/app/cards/${created.id}`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const brand = (form.name.split('—')[0] || 'Tu marca').trim();
  const visibleStamps = Math.min(form.stampsRequired, 7);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Nueva tarjeta <span className="page-crumb">/ Tarjetas</span>
        </h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => router.push('/app/cards')}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={submit}>
            <Icon name="check" /> Crear tarjeta
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
        <form onSubmit={submit} className="card card-pad">
          <div>
            <label className="label">Tipo de tarjeta</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => set('type', t)}
                  className={`px-2.5 py-2 rounded-input text-[11px] font-semibold uppercase tracking-[0.1em] transition ${
                    form.type === t
                      ? 'bg-brand text-white'
                      : 'bg-bg2 text-ink hover:bg-line'
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3.5">
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder="Café del Día — 10 sellos"
            />
          </div>
          <div className="mt-3">
            <label className="label">Descripción</label>
            <textarea
              className="input"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="mt-3">
            <label className="label">Recompensa</label>
            <input
              className="input"
              value={form.rewardText}
              onChange={(e) => set('rewardText', e.target.value)}
            />
          </div>

          {form.type === 'STAMPS' && (
            <div className="mt-3">
              <label className="label">Sellos requeridos</label>
              <input
                type="number"
                className="input"
                min={1}
                max={30}
                value={form.stampsRequired}
                onChange={(e) => set('stampsRequired', Number(e.target.value))}
              />
            </div>
          )}
          {form.type === 'DISCOUNT' && (
            <div className="mt-3">
              <label className="label">% descuento</label>
              <input
                type="number"
                className="input"
                min={1}
                max={100}
                value={form.discountPercent}
                onChange={(e) => set('discountPercent', Number(e.target.value))}
              />
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Color principal</label>
              <input
                type="color"
                className="input h-11 p-1"
                value={form.primaryColor}
                onChange={(e) => set('primaryColor', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Color secundario</label>
              <input
                type="color"
                className="input h-11 p-1"
                value={form.secondaryColor}
                onChange={(e) => set('secondaryColor', e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label">Condiciones</label>
            <textarea
              className="input"
              value={form.terms}
              onChange={(e) => set('terms', e.target.value)}
            />
          </div>

          {err && (
            <div className="mt-4 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
              {err}
            </div>
          )}
        </form>

        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
            Así se verá en el iPhone
          </div>
          <div className="flex justify-center">
            <div className="iphone">
              <div className="iphone-notch" />
              <div className="iphone-screen">
                <div className="iphone-bar">
                  <span>11:42</span>
                  <span className="text-[10px]">●●● 100%</span>
                </div>
                <div className="wallet-actions">
                  <span className="wallet-ok">OK</span>
                  <span className="text-mute2 text-xs">↑ ···</span>
                </div>
                <div className="mx-2 mb-2">
                  <div
                    className="pass"
                    style={{
                      background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`,
                    }}
                  >
                    <div className="pass-head">
                      <div className="pass-logo">
                        <span className="pass-logo-mark">
                          {(brand[0] || 'C').toUpperCase()}
                        </span>{' '}
                        {brand}
                      </div>
                      <div className="pass-side">
                        <div className="pass-side-lbl">
                          {form.type === 'STAMPS' ? 'SELLOS' : form.type}
                        </div>
                        <div className="pass-side-val">
                          {form.type === 'STAMPS' ? `3/${form.stampsRequired}` : '—'}
                        </div>
                      </div>
                    </div>
                    <div
                      className="pass-strip"
                      style={{
                        background:
                          'linear-gradient(135deg,rgba(0,0,0,.15),rgba(0,0,0,.05))',
                      }}
                    >
                      <div className="strip-stamps">
                        {Array.from({ length: visibleStamps }).map((_, i) => (
                          <div
                            key={i}
                            className={`strip-stamp ${i < 3 ? 'full' : ''}`}
                            style={{ color: i < 3 ? form.primaryColor : '#fff' }}
                          >
                            {i < 3 ? '✓' : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="pass-fields">
                      <div>
                        <div className="pf-lbl">TITULAR</div>
                        <div className="pf-val">RICARDO PÉREZ</div>
                      </div>
                      <div className="text-right">
                        <div className="pf-lbl">RECOMPENSA</div>
                        <div className="pf-val text-xs">{form.rewardText}</div>
                      </div>
                    </div>
                    <div className="pass-bar">
                      <div className="w-32 h-32 bg-ink/10 rounded grid place-items-center text-mute text-xs">
                        QR
                      </div>
                      <div className="pager">
                        <span className="pager-dot" />
                        <span className="pager-dot on" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card card-pad mt-4 flex items-start gap-3">
            <Icon name="spark" size={18} className="text-brand flex-none mt-0.5" />
            <div className="text-sm">
              <strong>Tip:</strong> usa los colores de tu marca para que tus clientes
              te reconozcan al primer vistazo en su Wallet.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
