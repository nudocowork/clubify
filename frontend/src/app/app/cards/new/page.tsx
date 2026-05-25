'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { StampIconPicker } from '@/components/StampIconPicker';
import { CardExpiryPicker } from '@/components/CardExpiryPicker';
import { ImageUploader } from '@/components/ImageUploader';
import { WalletPassPreview } from '@/components/WalletPassPreview';
import { WalletStylesGallery } from '@/components/WalletStylesGallery';
import {
  CARD_TEMPLATES,
  TYPE_LABEL,
  TYPE_EMOJI,
  TYPE_DESCRIPTION,
  type CardType,
  type CardTemplate,
} from '@/lib/card-templates';

// Sistema oficial Clubify: SOLO 2 tipos de tarjetas — STAMPS (fidelización
// por sellos) + COUPON (beneficio de bienvenida, single-use). El resto de
// tipos (DISCOUNT, CASHBACK, VISITS, HYBRID, MEMBERSHIP, POINTS, GIFT) están
// deprecados pero el backend los sigue soportando para cards existentes
// (legacy passes siguen renderizando + escaneando). Para reactivar alguno
// el resto del flujo ya está preparado (ver lib/card-templates → CardType).
//
// DISCOUNT: eliminado del wizard porque generaba inconsistencias (el wallet
// lo mostraba como sellos pero el REDEEM era no-op). El flow correcto ahora
// es COUPON → al redimirse, auto-genera una stamps card (ver Fase 2-4).
const ALL_TYPES: CardType[] = ['STAMPS', 'COUPON'];

type Step = 1 | 2 | 3 | 4 | 5;

const FROM_SCRATCH_DEFAULTS = {
  type: 'STAMPS' as CardType,
  name: '',
  description: '',
  terms: '',
  termsEnabled: true,
  primaryColor: '#22C55E',
  secondaryColor: '#15803D',
  stampActiveColor: null as string | null,
  stampInactiveColor: null as string | null,
  stampContourColor: null as string | null,
  centerBgColor: null as string | null,
  stampsRequired: 10,
  rewardText: '1 producto gratis',
  discountPercent: 10,
  pointsPerCurrency: 0.001,
  cashbackPercent: 5 as number | null,
  cashbackMinPurchase: 0 as number | null,
  minAmountPerStamp: null as number | null,
  visitsRequired: 10 as number | null,
  tiers: [] as Array<{
    name: string;
    threshold: number;
    perks?: string[];
    color?: string;
    icon?: string;
  }>,
  tierMetric: 'spend' as 'spend' | 'visits' | 'stamps',
  stampIcon: '☕',
  heroImageUrl: null as string | null,
  validUntil: null as string | null,
  validDaysAfterIssue: null as number | null,
  locationId: null as string | null,
  // Información (paso 4)
  howToEarnText: '',
  businessName: '',
  rewardDescText: '',
  stampEarnedMessage: '¡Solo [#] para tu recompensa!',
  rewardEarnedMessage: '¡Has ganado tu recompensa!',
  multiRewards: [] as Array<{ at: number; reward: string }>,
  activeLinks: [] as Array<{ type: string; url: string; label: string }>,
};

type LocationLite = { id: string; name: string };

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

  const [locations, setLocations] = useState<LocationLite[]>([]);
  // Cargar categoría del tenant + sedes
  useEffect(() => {
    api<any>('/tenants/me')
      .then((me) => {
        if (me?.businessCategorySlug) setTenantCategorySlug(me.businessCategorySlug);
      })
      .catch(() => {});
    api<any[]>('/locations')
      .then((rows) => setLocations((rows ?? []).map((r) => ({ id: r.id, name: r.name }))))
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
        canNext={
          step < 5 &&
          (step === 1 ||
            (step === 2 && !!form.type) ||
            (step === 3 && !!form.name.trim()) ||
            step === 4)
        }
        canSubmit={step === 5 && !!form.name.trim()}
        submitting={submitting}
        onBack={() => setStep((s) => Math.max(1, s - 1) as Step)}
        onNext={() => setStep((s) => Math.min(5, s + 1) as Step)}
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
        <Step3Configure
          form={form}
          setForm={(f) => setForm(f)}
          err={err}
          locations={locations}
        />
      )}

      {step === 4 && (
        <Step4Design form={form} setForm={(f) => setForm(f)} err={err} />
      )}

      {step === 5 && (
        <Step5Information form={form} setForm={(f) => setForm(f)} err={err} />
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
    { n: 4, label: 'Diseño' },
    { n: 5, label: 'Información' },
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
        {step < 5 && (
          <button className="btn-primary" onClick={onNext} disabled={!canNext}>
            Siguiente →
          </button>
        )}
        {step === 5 && (
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
    // Filtramos plantillas a tipos expuestos en el wizard. Si un template
    // usa CASHBACK/VISITS/HYBRID/etc no se muestra hasta que se reactiven.
    let list = CARD_TEMPLATES.filter((t) => ALL_TYPES.includes(t.type));
    if (filterMode === 'mine' && tenantCategorySlug) {
      const scoped = list.filter((t) => t.categorySlug === tenantCategorySlug);
      if (scoped.length > 0) list = scoped;
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
  locations,
}: {
  form: typeof FROM_SCRATCH_DEFAULTS;
  setForm: (f: typeof FROM_SCRATCH_DEFAULTS) => void;
  err: string | null;
  locations: LocationLite[];
}) {
  // Buffer raw del input multiRewards — preservar texto crudo mientras
  // el user tipea "5:" o "5" (sin reward todavía). form.multiRewards
  // solo guarda entradas válidas (at + reward).
  const [multiRewardsRaw, setMultiRewardsRaw] = useState(
    (form.multiRewards ?? [])
      .map((m: { at: number; reward: string }) => `${m.at}:${m.reward}`)
      .join(', '),
  );

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
          <label className="label">
            Sede / Ubicación
            <span className="text-mute font-normal ml-1">(opcional)</span>
          </label>
          <select
            className="input"
            value={form.locationId ?? ''}
            onChange={(e) => set('locationId', e.target.value || null)}
          >
            <option value="">Todas las sedes</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-mute mt-1">
            Si tu negocio tiene varias sedes, asociar la tarjeta a una sede te
            permite filtrar clientes por origen.{' '}
            {locations.length === 0 && (
              <a href="/app/locations" className="text-brand hover:underline">
                Crear una sede →
              </a>
            )}
          </div>
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
              <label className="label">
                Recompensas intermedias
                <span className="text-mute font-normal ml-1">(opcional)</span>
              </label>
              <input
                className="input"
                placeholder="Ej: 5:5% off, 10:10% off"
                value={multiRewardsRaw}
                onChange={(e) => {
                  const raw = e.target.value;
                  setMultiRewardsRaw(raw);
                  const parsed = raw
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s) => {
                      const [at, ...rest] = s.split(':');
                      return {
                        at: Number(at) || 0,
                        reward: rest.join(':').trim(),
                      };
                    })
                    .filter((m) => m.at > 0 && m.reward);
                  set('multiRewards', parsed);
                }}
              />
              <div className="text-[11px] text-mute mt-1">
                Sintaxis: <code className="bg-bg2 px-1 rounded">N:premio</code>{' '}
                separados por coma. Ej: <code className="bg-bg2 px-1 rounded">5:5% off, 10:10% off</code>.
                Si lo dejas vacío, solo hay recompensa al alcanzar los sellos requeridos.
              </div>
            </div>
          </>
        )}
        {/* DISCOUNT branch removido — el wizard ya no ofrece DISCOUNT.
            Cards DISCOUNT existentes se editan desde /app/cards/[id]. */}
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
        {form.type === 'CASHBACK' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">% de cashback</label>
              <input
                type="number"
                className="input"
                min={1}
                max={50}
                value={form.cashbackPercent ?? 5}
                onChange={(e) => set('cashbackPercent', Number(e.target.value))}
              />
              <div className="text-[11px] text-mute mt-1">
                % devuelto en saldo de moneda en cada compra.
              </div>
            </div>
            <div>
              <label className="label">Compra mínima</label>
              <input
                type="number"
                className="input"
                min={0}
                step={1000}
                value={form.cashbackMinPurchase ?? 0}
                onChange={(e) =>
                  set('cashbackMinPurchase', Number(e.target.value))
                }
              />
              <div className="text-[11px] text-mute mt-1">
                Mínimo a gastar para activar cashback (0 = sin mínimo).
              </div>
            </div>
          </div>
        )}
        {form.type === 'VISITS' && (
          <>
            <div className="mt-3">
              <label className="label">Visitas requeridas</label>
              <input
                type="number"
                className="input"
                min={1}
                max={50}
                value={form.visitsRequired ?? 10}
                onChange={(e) => set('visitsRequired', Number(e.target.value))}
              />
              <div className="text-[11px] text-mute mt-1">
                Cada scan suma 1 visita, sin importar el monto. Al alcanzar el
                tope, se libera la recompensa.
              </div>
            </div>
          </>
        )}
        {form.type === 'HYBRID' && (
          <div className="mt-3 space-y-3">
            <div className="text-xs p-3 rounded-lg bg-brand/10 border border-brand/30">
              💡 Tarjeta híbrida: combina sellos + descuento permanente.
              Configura ambos.
            </div>
            <div>
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
            <div>
              <label className="label">% descuento permanente</label>
              <input
                type="number"
                className="input"
                min={1}
                max={50}
                value={form.discountPercent}
                onChange={(e) => set('discountPercent', Number(e.target.value))}
              />
            </div>
          </div>
        )}
        {(form.type === 'STAMPS' ||
          form.type === 'VISITS' ||
          form.type === 'HYBRID') && (
          <div className="mt-3">
            <label className="label">
              Monto mínimo por sello
              <span className="text-mute font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="number"
              className="input"
              min={0}
              step={1000}
              placeholder="0 = sin mínimo"
              value={form.minAmountPerStamp ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim();
                set('minAmountPerStamp', v === '' ? null : Number(v));
              }}
            />
            <div className="text-[11px] text-mute mt-1">
              Si lo seteas, el scanner solo otorga sello si la compra es
              mayor o igual a este monto. Útil para evitar sellos por
              compras chicas.
            </div>
          </div>
        )}
        {form.type === 'MEMBERSHIP' && (
          <TiersEditor
            tiers={form.tiers}
            metric={form.tierMetric}
            onChangeTiers={(t) => set('tiers', t)}
            onChangeMetric={(m) => set('tierMetric', m)}
          />
        )}

        <div className="mt-4 pt-4 border-t border-line">
          <CardExpiryPicker
            value={{
              validUntil: form.validUntil,
              validDaysAfterIssue: form.validDaysAfterIssue,
            }}
            onChange={(v) =>
              setForm({
                ...form,
                validUntil: v.validUntil,
                validDaysAfterIssue: v.validDaysAfterIssue,
              })
            }
          />
        </div>

        <div className="mt-3 text-[11px] text-mute p-3 rounded-lg bg-bg2/40">
          💡 En el siguiente paso configuras los <b>colores y diseño</b> visual.
          Acá solo definimos lo funcional (qué hace la tarjeta).
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
          <WalletPassPreview
            brandName={brand}
            primaryColor={form.primaryColor}
            secondaryColor={form.secondaryColor}
            cardName={form.name}
            cardType={form.type}
            stampsRequired={form.stampsRequired}
            stampsCount={Math.min(3, form.stampsRequired)}
            visitsRequired={form.visitsRequired}
            visitsCount={3}
            cashbackBalance={15000}
            pointsBalance={120}
            discountPercent={form.discountPercent}
            currentTier={form.tiers[0]?.name}
            tiers={form.tiers}
            stampIcon={form.stampIcon}
            stampActiveColor={form.stampActiveColor}
            stampInactiveColor={form.stampInactiveColor}
            stampContourColor={form.stampContourColor}
            centerBgColor={form.centerBgColor}
            rewardText={form.rewardText}
            customerName="RICARDO PÉREZ"
            barcodeValue="DEMO123456"
          />
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
// Step 4: Diseño (colores, T&C — solo visual)
// ═══════════════════════════════════════════════════════════

function Step4Design({
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
      <div className="card card-pad space-y-4">
        <div>
          <h3 className="font-semibold text-base m-0">✨ Estilos pre-armados</h3>
          <p className="text-xs text-mute mt-1">
            Elige un estilo y aplicamos los 6 colores del wallet pass de una
            vez. Después puedes ajustar cualquiera abajo.
          </p>
        </div>
        <WalletStylesGallery
          current={{
            primaryColor: form.primaryColor,
            secondaryColor: form.secondaryColor,
            stampActiveColor: form.stampActiveColor,
            stampInactiveColor: form.stampInactiveColor,
            stampContourColor: form.stampContourColor,
            centerBgColor: form.centerBgColor,
          }}
          onApply={(style) => {
            setForm({
              ...form,
              primaryColor: style.colors.primaryColor,
              secondaryColor: style.colors.secondaryColor,
              stampActiveColor: style.colors.stampActiveColor,
              stampInactiveColor: style.colors.stampInactiveColor,
              stampContourColor: style.colors.stampContourColor,
              centerBgColor: style.colors.centerBgColor,
            });
          }}
        />

        <div className="pt-2 border-t border-line">
          <h3 className="font-semibold text-base m-0">🎨 Colores de marca</h3>
          <p className="text-xs text-mute mt-1">
            Estos colores aplican al fondo del wallet pass del cliente.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
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

        {(form.type === 'STAMPS' || form.type === 'HYBRID' || form.type === 'VISITS') && (
          <div className="pt-2 border-t border-line">
            <h4 className="text-sm font-semibold m-0 mb-2">🎯 Colores avanzados del sello</h4>
            <p className="text-[11px] text-mute mb-3">
              Personaliza cada elemento del sello individualmente. Si los dejas
              vacíos, se calculan desde los colores de marca.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <AdvancedColorInput
                label="Sello activo"
                value={form.stampActiveColor}
                onChange={(v) => set('stampActiveColor', v)}
              />
              <AdvancedColorInput
                label="Sello inactivo"
                value={form.stampInactiveColor}
                onChange={(v) => set('stampInactiveColor', v)}
              />
              <AdvancedColorInput
                label="Contorno del sello"
                value={form.stampContourColor}
                onChange={(v) => set('stampContourColor', v)}
              />
              <AdvancedColorInput
                label="Fondo central"
                value={form.centerBgColor}
                onChange={(v) => set('centerBgColor', v)}
              />
            </div>
          </div>
        )}

        {(form.type === 'STAMPS' || form.type === 'HYBRID' || form.type === 'VISITS') && (
          <div className="pt-2 border-t border-line">
            <label className="label">Icono del sello</label>
            <StampIconPicker
              value={form.stampIcon}
              onSelect={(icon) => set('stampIcon', icon)}
            />
          </div>
        )}

        <div className="pt-2 border-t border-line">
          <label className="label">📸 Imagen de portada de la tarjeta</label>
          <p className="text-xs text-mute leading-relaxed -mt-1 mb-2.5">
            Se muestra como fondo del banner en Apple y Google Wallet (estilo
            premium glassmorphism, con los sellos encima). Subí una foto de tu
            producto o local — recomendado <b>800×400 px</b> o más.
            Si no subís, se usa un gradiente con tus colores.
          </p>
          <ImageUploader
            value={form.heroImageUrl}
            onChange={(url) => set('heroImageUrl', url)}
            folder="card-hero"
            crop={false}
          />
        </div>

        <div className="pt-2 border-t border-line">
          <div className="flex items-center justify-between">
            <label className="label m-0">Términos y condiciones</label>
            <button
              type="button"
              onClick={() => set('termsEnabled', !form.termsEnabled)}
              className={`relative w-10 h-5 rounded-full transition ${
                form.termsEnabled ? 'bg-brand' : 'bg-bg2 border border-line'
              }`}
              aria-label="Toggle T&C"
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${
                  form.termsEnabled ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          {form.termsEnabled ? (
            <textarea
              className="input mt-2"
              rows={3}
              value={form.terms}
              onChange={(e) => set('terms', e.target.value)}
              placeholder="Aparecen en el reverso de la tarjeta wallet"
            />
          ) : (
            <div className="text-xs text-mute mt-2">
              Esta tarjeta no muestra términos y condiciones.
            </div>
          )}
        </div>

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
          Vista previa
        </div>
        <div className="flex justify-center">
          <WalletPassPreview
            brandName={brand}
            primaryColor={form.primaryColor}
            secondaryColor={form.secondaryColor}
            cardName={form.name}
            cardType={form.type}
            stampsRequired={form.stampsRequired}
            stampsCount={Math.min(3, form.stampsRequired)}
            visitsRequired={form.visitsRequired}
            visitsCount={3}
            cashbackBalance={15000}
            pointsBalance={120}
            discountPercent={form.discountPercent}
            currentTier={form.tiers[0]?.name}
            tiers={form.tiers}
            stampIcon={form.stampIcon}
            stampActiveColor={form.stampActiveColor}
            stampInactiveColor={form.stampInactiveColor}
            stampContourColor={form.stampContourColor}
            centerBgColor={form.centerBgColor}
            rewardText={form.rewardText}
            customerName="RICARDO PÉREZ"
            barcodeValue="DEMO123456"
          />
        </div>
        <div className="card card-pad mt-4 flex items-start gap-3">
          <Icon name="spark" size={18} className="text-brand flex-none mt-0.5" />
          <div className="text-sm">
            <strong>Tip:</strong> usá los colores exactos de tu identidad de marca. El
            cliente reconoce tu negocio en su Wallet al primer vistazo.
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 5: Información (reverso del .pkpass + enlaces activos)
// ═══════════════════════════════════════════════════════════

function Step5Information({
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

  function addLink() {
    set('activeLinks', [
      ...form.activeLinks,
      { type: 'URL', url: '', label: '' },
    ]);
  }
  function updateLink(i: number, patch: Partial<{ type: string; url: string; label: string }>) {
    const next = [...form.activeLinks];
    next[i] = { ...next[i], ...patch };
    set('activeLinks', next);
  }
  function removeLink(i: number) {
    set('activeLinks', form.activeLinks.filter((_, j) => j !== i));
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
      <div className="card card-pad space-y-3">
        <div className="text-xs text-mute mb-1">
          Esta información va al reverso de la tarjeta wallet del cliente.
        </div>

        <div>
          <label className="label">Cómo ganar un sello</label>
          <input
            className="input"
            placeholder="Ej: Comprar cualquier producto para obtener un sello"
            value={form.howToEarnText}
            onChange={(e) => set('howToEarnText', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Nombre de empresa</label>
          <input
            className="input"
            placeholder="Como se ve en el reverso"
            value={form.businessName}
            onChange={(e) => set('businessName', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Descripción de la recompensa</label>
          <input
            className="input"
            placeholder="Ej: Café gratis al completar 10 sellos"
            value={form.rewardDescText}
            onChange={(e) => set('rewardDescText', e.target.value)}
          />
        </div>
        <div>
          <label className="label">
            Mensaje de sello ganado
            <span className="text-mute font-normal ml-1">
              ({'['}#{']'} = sellos restantes)
            </span>
          </label>
          <input
            className="input"
            placeholder="¡Solo [#] para tu recompensa!"
            value={form.stampEarnedMessage}
            onChange={(e) => set('stampEarnedMessage', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Mensaje de recompensa ganada</label>
          <input
            className="input"
            placeholder="¡Has ganado tu recompensa!"
            value={form.rewardEarnedMessage}
            onChange={(e) => set('rewardEarnedMessage', e.target.value)}
          />
        </div>

        <div className="pt-3 border-t border-line">
          <label className="label">Enlaces activos</label>
          <div className="text-[11px] text-mute mb-2">
            Aparecen en el reverso del pass y el cliente puede tocarlos.
          </div>
          {form.activeLinks.map((link, i) => (
            <div
              key={i}
              className="grid grid-cols-[110px_1fr_1fr_28px] gap-2 mb-2 items-center"
            >
              <select
                className="input"
                value={link.type}
                onChange={(e) => updateLink(i, { type: e.target.value })}
              >
                <option value="URL">URL</option>
                <option value="PHONE">Teléfono</option>
                <option value="EMAIL">Correo</option>
                <option value="ADDRESS">Dirección</option>
              </select>
              <input
                className="input"
                placeholder={
                  link.type === 'URL'
                    ? 'https://...'
                    : link.type === 'PHONE'
                    ? '+57...'
                    : link.type === 'EMAIL'
                    ? 'tu@email.com'
                    : 'Dirección'
                }
                value={link.url}
                onChange={(e) => updateLink(i, { url: e.target.value })}
              />
              <input
                className="input"
                placeholder="Etiqueta (Ej: Instagram)"
                value={link.label}
                onChange={(e) => updateLink(i, { label: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeLink(i)}
                className="text-mute hover:text-bad text-lg leading-none"
                aria-label="Quitar"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addLink}
            className="btn-ghost w-full mt-1 text-sm"
          >
            + Añadir enlace
          </button>
        </div>

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-3">
          Vista previa del reverso
        </div>
        <div className="bg-bg2 rounded-lg p-4 space-y-2 text-sm">
          {form.howToEarnText && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                Cómo ganar un sello
              </div>
              <div>{form.howToEarnText}</div>
            </div>
          )}
          {form.businessName && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                Empresa
              </div>
              <div>{form.businessName}</div>
            </div>
          )}
          {form.rewardDescText && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                Recompensa
              </div>
              <div>{form.rewardDescText}</div>
            </div>
          )}
          {form.activeLinks.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                Enlaces
              </div>
              <ul className="list-disc list-inside">
                {form.activeLinks
                  .filter((l) => l.url)
                  .map((l, i) => (
                    <li key={i} className="truncate">
                      {l.label || l.url}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {form.termsEnabled && form.terms && (
            <div className="pt-2 border-t border-line">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                Términos
              </div>
              <div className="whitespace-pre-line text-xs">{form.terms}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Color avanzado con toggle "usar default"
function AdvancedColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const enabled = value != null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label m-0 text-xs">{label}</label>
        <button
          type="button"
          className="text-[10px] text-brand hover:underline"
          onClick={() => onChange(enabled ? null : '#000000')}
        >
          {enabled ? 'Limpiar' : 'Usar custom'}
        </button>
      </div>
      <input
        type="color"
        className="input h-9 p-1 w-full"
        disabled={!enabled}
        value={value ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
      />
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

// ─── Tiers VIP editor (MEMBERSHIP) ───
type Tier = {
  name: string;
  threshold: number;
  perks?: string[];
  color?: string;
  icon?: string;
};

function TiersEditor({
  tiers,
  metric,
  onChangeTiers,
  onChangeMetric,
}: {
  tiers: Tier[];
  metric: 'spend' | 'visits' | 'stamps';
  onChangeTiers: (t: Tier[]) => void;
  onChangeMetric: (m: 'spend' | 'visits' | 'stamps') => void;
}) {
  function addTier() {
    onChangeTiers([
      ...tiers,
      {
        name: tiers.length === 0 ? 'Silver' : tiers.length === 1 ? 'Gold' : 'Black',
        threshold: tiers.length === 0 ? 0 : (tiers[tiers.length - 1].threshold + 100000),
        perks: [],
        color: tiers.length === 0 ? '#9CA3AF' : tiers.length === 1 ? '#F59E0B' : '#111827',
        icon: tiers.length === 0 ? '🥈' : tiers.length === 1 ? '🥇' : '⚫',
      },
    ]);
  }
  function patch(i: number, p: Partial<Tier>) {
    onChangeTiers(tiers.map((t, idx) => (idx === i ? { ...t, ...p } : t)));
  }
  function removeTier(i: number) {
    onChangeTiers(tiers.filter((_, idx) => idx !== i));
  }

  const metricLabel: Record<typeof metric, string> = {
    spend: 'Monto gastado',
    visits: 'Cantidad de visitas',
    stamps: 'Sellos acumulados',
  };

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="label">Métrica para subir de tier</label>
        <select
          className="input"
          value={metric}
          onChange={(e) => onChangeMetric(e.target.value as any)}
        >
          <option value="spend">Monto total gastado</option>
          <option value="visits">Cantidad de visitas</option>
          <option value="stamps">Sellos acumulados</option>
        </select>
        <div className="text-[11px] text-mute mt-1">
          El cliente sube de tier al alcanzar el umbral de {metricLabel[metric].toLowerCase()}.
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="label m-0">Tiers VIP</label>
        <button
          type="button"
          onClick={addTier}
          className="text-xs text-brand hover:underline"
        >
          + Añadir tier
        </button>
      </div>

      {tiers.length === 0 && (
        <div className="text-xs text-mute p-3 rounded-lg bg-bg2/40 border border-dashed border-line">
          Sin tiers configurados. Añade Silver/Gold/Black para gamificar la
          membresía. Si no agregas ninguno, la tarjeta se comporta como
          membresía única sin niveles.
        </div>
      )}

      {tiers.map((t, i) => (
        <div key={i} className="p-3 rounded-lg border border-line bg-bg2/30 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              placeholder="Nombre (ej. Silver)"
              value={t.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <input
              className="input w-16 text-center"
              placeholder="🥈"
              value={t.icon ?? ''}
              onChange={(e) => patch(i, { icon: e.target.value })}
            />
            <input
              type="color"
              className="input h-10 p-1 w-12"
              value={t.color ?? '#9CA3AF'}
              onChange={(e) => patch(i, { color: e.target.value })}
            />
            <button
              type="button"
              onClick={() => removeTier(i)}
              className="text-xs text-rose-500 hover:underline"
            >
              Quitar
            </button>
          </div>
          <div>
            <label className="label">
              Umbral ({metricLabel[metric]})
            </label>
            <input
              type="number"
              className="input"
              min={0}
              step={metric === 'spend' ? 10000 : 1}
              value={t.threshold}
              onChange={(e) =>
                patch(i, { threshold: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="label">Beneficios (uno por línea)</label>
            <textarea
              className="input"
              rows={2}
              value={(t.perks ?? []).join('\n')}
              onChange={(e) =>
                patch(i, {
                  perks: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="5% descuento&#10;Cumpleaños con regalo"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
