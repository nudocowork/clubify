'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { StampIconPicker } from '@/components/StampIconPicker';
import {
  CARD_TEMPLATES,
  TYPE_LABEL,
  TYPE_EMOJI,
  TYPE_DESCRIPTION,
  type CardType,
  type CardTemplate,
} from '@/lib/card-templates';

const ALL_TYPES: CardType[] = [
  'STAMPS',
  'MEMBERSHIP',
  'GIFT',
  'COUPON',
  'DISCOUNT',
  'POINTS',
];

type Step = 1 | 2 | 3;

const FROM_SCRATCH_DEFAULTS = {
  type: 'STAMPS' as CardType,
  name: '',
  description: '',
  terms: '',
  primaryColor: '#22C55E',
  secondaryColor: '#15803D',
  stampsRequired: 10,
  rewardText: '1 producto gratis',
  discountPercent: 10,
  pointsPerCurrency: 0.001,
  stampIcon: '☕',
};

export default function NewCardWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [tenantCategorySlug, setTenantCategorySlug] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'mine' | 'all'>('mine');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<CardTemplate | null>(null);
  const [form, setForm] = useState(FROM_SCRATCH_DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmActivate, setConfirmActivate] = useState(false);

  // Cargar categoría del tenant para filtrar plantillas relevantes
  useEffect(() => {
    api<any>('/tenants/me')
      .then((me) => {
        if (me?.businessCategorySlug) setTenantCategorySlug(me.businessCategorySlug);
      })
      .catch(() => {});
  }, []);

  function applyTemplate(t: CardTemplate | null) {
    setPicked(t);
    if (t) {
      setForm({
        ...FROM_SCRATCH_DEFAULTS,
        ...t.defaults,
        type: t.type,
      });
    } else {
      setForm(FROM_SCRATCH_DEFAULTS);
    }
  }

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }

  async function submit() {
    setErr(null);
    setSubmitting(true);
    try {
      const created = await api<any>('/cards', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      router.push(`/app/cards/${created.id}`);
    } catch (e: any) {
      setErr(e.message);
      setConfirmActivate(false); // si falla, cerrar modal para mostrar el error
    } finally {
      setSubmitting(false);
    }
  }

  function attemptSubmit() {
    if (!form.name.trim()) {
      setErr('Falta el nombre de la tarjeta');
      return;
    }
    setErr(null);
    setConfirmActivate(true);
  }

  const cardName = form.name.trim() || 'Sin nombre';

  return (
    <div>
      <WizardHeader
        step={step}
        cardName={cardName}
        canBack={step > 1}
        canNext={step < 3 && (step === 1 || (step === 2 && !!form.type))}
        canSubmit={step === 3 && !!form.name.trim()}
        submitting={submitting}
        onBack={() => setStep((s) => (s === 3 ? 2 : 1) as Step)}
        onNext={() => setStep((s) => (s === 1 ? 2 : 3) as Step)}
        onCancel={() => router.push('/app/cards')}
        onSubmit={attemptSubmit}
      />

      {confirmActivate && (
        <ActivateConfirmModal
          submitting={submitting}
          onCancel={() => setConfirmActivate(false)}
          onConfirm={submit}
        />
      )}

      {step === 1 && (
        <Step1Templates
          tenantCategorySlug={tenantCategorySlug}
          filterMode={filterMode}
          setFilterMode={setFilterMode}
          search={search}
          setSearch={setSearch}
          pickedId={picked?.id ?? null}
          onPick={(t) => {
            applyTemplate(t);
            setStep(2);
          }}
          onScratch={() => {
            applyTemplate(null);
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <Step2Type
          selected={form.type}
          onSelect={(t) => {
            set('type', t);
          }}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <Step3Configure form={form} setForm={(f) => setForm(f)} err={err} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Header con breadcrumb
// ═══════════════════════════════════════════════════════════

function WizardHeader({
  step,
  cardName,
  canBack,
  canNext,
  canSubmit,
  submitting,
  onBack,
  onNext,
  onCancel,
  onSubmit,
}: {
  step: Step;
  cardName: string;
  canBack: boolean;
  canNext: boolean;
  canSubmit: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const steps = [
    { n: 1, label: 'Plantilla' },
    { n: 2, label: 'Tipo' },
    { n: 3, label: 'Configurar' },
  ];

  return (
    <div className="page-head flex-wrap gap-3">
      <div className="flex-1 min-w-[260px]">
        <h1 className="page-title m-0">{cardName}</h1>
        <div className="flex items-center gap-1.5 mt-1.5 text-xs">
          {steps.map((s, i) => (
            <span key={s.n} className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                  step === s.n
                    ? 'bg-ink text-white'
                    : step > s.n
                    ? 'bg-ok text-white'
                    : 'bg-bg2 text-mute'
                }`}
              >
                {step > s.n ? '✓' : s.n}
              </span>
              <span className={step === s.n ? 'font-semibold text-ink' : 'text-mute'}>
                {s.label}
              </span>
              {i < steps.length - 1 && <span className="text-line">·</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        {canBack && (
          <button className="btn-ghost" onClick={onBack}>
            ← Anterior
          </button>
        )}
        {step < 3 && (
          <button className="btn-primary" onClick={onNext} disabled={!canNext}>
            Siguiente →
          </button>
        )}
        {step === 3 && (
          <button
            className="btn-primary"
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
          >
            <Icon name="check" /> {submitting ? 'Creando…' : 'Crear tarjeta'}
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 1: Plantillas
// ═══════════════════════════════════════════════════════════

function Step1Templates({
  tenantCategorySlug,
  filterMode,
  setFilterMode,
  search,
  setSearch,
  pickedId,
  onPick,
  onScratch,
}: {
  tenantCategorySlug: string | null;
  filterMode: 'mine' | 'all';
  setFilterMode: (m: 'mine' | 'all') => void;
  search: string;
  setSearch: (s: string) => void;
  pickedId: string | null;
  onPick: (t: CardTemplate) => void;
  onScratch: () => void;
}) {
  const filtered = useMemo(() => {
    let list = CARD_TEMPLATES;
    if (filterMode === 'mine' && tenantCategorySlug) {
      list = list.filter((t) => t.categorySlug === tenantCategorySlug);
      if (list.length === 0) list = CARD_TEMPLATES; // fallback si no hay match
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.displayName.toLowerCase().includes(q) ||
          t.defaults.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [filterMode, search, tenantCategorySlug]);

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-base font-semibold m-0">Elegí una plantilla</h2>
          <p className="text-xs text-mute mt-1">
            Plantillas pre-armadas para tu rubro. También podés empezar desde cero.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tenantCategorySlug && (
            <div className="bg-bg2 rounded-full p-0.5 flex text-xs font-semibold">
              <button
                onClick={() => setFilterMode('mine')}
                className={`px-3 py-1.5 rounded-full transition ${
                  filterMode === 'mine' ? 'bg-white text-ink shadow-sm' : 'text-mute'
                }`}
              >
                Para mi rubro
              </button>
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-full transition ${
                  filterMode === 'all' ? 'bg-white text-ink shadow-sm' : 'text-mute'
                }`}
              >
                Todas
              </button>
            </div>
          )}
          <input
            className="input w-56"
            placeholder="Buscar plantilla…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {/* Crear desde cero — siempre primero */}
        <button
          onClick={onScratch}
          className="aspect-[3/4] rounded-2xl border-2 border-dashed border-line hover:border-brand bg-bg2/40 flex flex-col items-center justify-center gap-2 transition"
        >
          <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-brand">
            <Icon name="spark" size={18} />
          </div>
          <div className="font-semibold text-sm">Desde cero</div>
          <div className="text-xs text-mute px-3 text-center leading-snug">
            Configurá todo manualmente
          </div>
        </button>

        {filtered.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            className={`aspect-[3/4] rounded-2xl text-left flex flex-col overflow-hidden border-2 transition ${
              pickedId === t.id ? 'border-ink shadow-md' : 'border-transparent hover:border-line'
            }`}
            style={{
              background: `linear-gradient(135deg, ${t.defaults.primaryColor}, ${t.defaults.secondaryColor})`,
            }}
          >
            <div className="flex-1 p-3 text-white relative overflow-hidden">
              <div className="text-[10px] uppercase tracking-wider opacity-80 font-semibold">
                {TYPE_LABEL[t.type]}
              </div>
              <div className="text-sm font-bold mt-1 leading-tight line-clamp-3">
                {t.defaults.name}
              </div>
              <div
                className="absolute -right-2 -bottom-2 text-6xl opacity-20 select-none pointer-events-none"
                aria-hidden
              >
                {t.defaults.stampIcon ?? TYPE_EMOJI[t.type]}
              </div>
            </div>
            <div className="bg-white px-3 py-2 text-[11px] text-ink">
              <div className="font-semibold truncate">{t.displayName}</div>
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-mute text-sm py-8">
          No encontramos plantillas. Probá con otro filtro o "Desde cero".
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 2: Tipo de tarjeta
// ═══════════════════════════════════════════════════════════

function Step2Type({
  selected,
  onSelect,
  onContinue,
}: {
  selected: CardType;
  onSelect: (t: CardType) => void;
  onContinue: () => void;
}) {
  return (
    <div className="card card-pad">
      <h2 className="text-base font-semibold m-0">¿Qué tipo de tarjeta querés crear?</h2>
      <p className="text-xs text-mute mt-1">
        Cambia cómo se acumulan recompensas y qué ven tus clientes en el wallet.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
        {ALL_TYPES.map((t) => {
          const active = selected === t;
          return (
            <button
              key={t}
              onClick={() => onSelect(t)}
              onDoubleClick={onContinue}
              className={`text-left p-4 rounded-2xl border-2 transition ${
                active
                  ? 'border-ink bg-ink text-white shadow-md'
                  : 'border-line hover:border-ink/40 bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl shrink-0">{TYPE_EMOJI[t]}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{TYPE_LABEL[t]}</div>
                </div>
              </div>
              <p
                className={`text-xs leading-snug mt-2 ${
                  active ? 'text-white/75' : 'text-mute'
                }`}
              >
                {TYPE_DESCRIPTION[t]}
              </p>
            </button>
          );
        })}
      </div>

      <div className="text-xs text-mute mt-4 text-center">
        Doble click en un tipo para confirmar y continuar.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 3: Configurar
// ═══════════════════════════════════════════════════════════

function Step3Configure({
  form,
  setForm,
  err,
}: {
  form: typeof FROM_SCRATCH_DEFAULTS;
  setForm: (f: typeof FROM_SCRATCH_DEFAULTS) => void;
  err: string | null;
}) {
  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }
  const brand = (form.name.split('—')[0] || 'Tu marca').trim();
  const visibleStamps = Math.min(form.stampsRequired, 7);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
      <div className="card card-pad">
        <div className="text-xs text-mute mb-2">
          Tipo seleccionado: <span className="font-semibold text-ink">{TYPE_EMOJI[form.type]} {TYPE_LABEL[form.type]}</span>
        </div>

        <div className="mt-3">
          <label className="label">Nombre de la tarjeta</label>
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
          <>
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
            <div className="mt-3">
              <label className="label">Icono del sello</label>
              <StampIconPicker
                value={form.stampIcon}
                onSelect={(icon) => set('stampIcon', icon)}
              />
            </div>
          </>
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
        {form.type === 'POINTS' && (
          <div className="mt-3">
            <label className="label">Puntos por cada $1.000 de compra</label>
            <input
              type="number"
              step={0.1}
              className="input"
              min={0.1}
              max={100}
              value={Number((form.pointsPerCurrency * 1000).toFixed(2))}
              onChange={(e) =>
                set('pointsPerCurrency', Number(e.target.value) / 1000)
              }
            />
            <div className="text-[11px] text-mute mt-1">
              Ej: 1 punto por cada $1.000 → un pedido de $50.000 acumula 50
              puntos automáticamente al confirmar.
            </div>
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
      </div>

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
                        {TYPE_LABEL[form.type].toUpperCase()}
                      </div>
                      <div className="pass-side-val">
                        {form.type === 'STAMPS'
                          ? `3/${form.stampsRequired}`
                          : form.type === 'POINTS'
                          ? '120'
                          : form.type === 'DISCOUNT'
                          ? `${form.discountPercent}%`
                          : form.type === 'MEMBERSHIP'
                          ? 'Activa'
                          : '—'}
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
                          {i < 3 ? form.stampIcon || '✓' : ''}
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
  );
}

// ═══════════════════════════════════════════════════════════
// Modal de confirmación al activar la tarjeta
// ═══════════════════════════════════════════════════════════

function ActivateConfirmModal({
  submitting,
  onCancel,
  onConfirm,
}: {
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const lockedItems = [
    { icon: '📱', label: 'Tipo de tarjeta' },
    { icon: 'ℹ️', label: 'Términos del programa de fidelización' },
    { icon: '🕓', label: 'Fecha de vencimiento de la tarjeta' },
    { icon: '🧾', label: 'Detalles del formulario de emisión' },
  ];
  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          aria-label="Cerrar"
          className="absolute top-4 right-4 text-mute hover:text-ink text-xl"
        >
          ×
        </button>
        <h2 className="text-xl font-bold m-0">Activar tarjeta</h2>
        <p className="text-sm text-mute mt-1.5">
          Después de la activación, no puedes editar algunas configuraciones de la tarjeta.
        </p>

        <div className="mt-5 space-y-2">
          {lockedItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-line"
            >
              <span className="text-lg shrink-0" aria-hidden>{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl bg-ink text-white font-semibold hover:bg-ink/90 transition disabled:opacity-50"
          >
            {submitting ? 'Activando…' : 'Activar'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl border border-line text-ink font-semibold hover:bg-bg2 transition"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
