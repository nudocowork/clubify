'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { StampIconPicker } from '@/components/StampIconPicker';
import { CardExpiryPicker } from '@/components/CardExpiryPicker';
import { ImageUploader } from '@/components/ImageUploader';
import { WalletPassPreview } from '@/components/WalletPassPreview';
import { WalletStripRealPreview } from '@/components/WalletStripRealPreview';
import { FreeRewardsEditor, type FreeReward } from '@/components/FreeRewardsEditor';
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
  // PDF Software(8): casilla de políticas de datos en el registro. Default on.
  dataPolicyEnabled: true,
  primaryColor: '#22C55E',
  secondaryColor: '#15803D',
  stampActiveColor: null as string | null,
  stampInactiveColor: null as string | null,
  stampContourColor: null as string | null,
  centerBgColor: null as string | null,
  // Wallet V3 — tarjetas nuevas nacen con color uniforme (SOLID).
  stampBgType: 'SOLID' as 'GRADIENT' | 'SOLID' | 'IMAGE',
  stampBgImageUrl: null as string | null,
  stampIconImageUrl: null as string | null,
  freeRewards: [] as FreeReward[],
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
  // COUPON/DISCOUNT/GIFT: tarjeta de sellos destino al redeem. null
  // = auto (primera stamps activa, o se crea).
  transformIntoCardId: null as string | null,
  // false = no se convierte en nada: se canjea y la tarjeta queda usada.
  // Hace falta aparte porque transformIntoCardId=null ya significa "auto".
  transformOnRedeem: true,
};

type LocationLite = { id: string; name: string };

export default function NewCardWizard() {
  const t = useTranslations('app_cards_new');
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
  // Wallet V3 — permisos de la marca (para gatear la opción de imagen).
  const [walletAdv, setWalletAdv] = useState<Record<string, boolean> | null>(null);
  /**
   * Qué módulos tiene ENCENDIDOS este negocio.
   *
   * Gatea las dos tarjetas nuevas del paso 2. Se enseñaban a todo el mundo «de
   * escaparate», y eso significa que un negocio de Sellea —o de cualquier otra
   * marca blanca— veía Alianzas y Tarjeta de Club antes de que su marca las
   * tuviera. Adelantar funciones a otra marca no es nuestro para adelantarlo.
   *
   * Arranca en `false`: mientras `/tenants/me` no conteste, no se pinta nada
   * que el negocio no tenga. Es el mismo criterio del menú lateral.
   */
  const [modulos, setModulos] = useState({ convenios: false, club: false });

  const [locations, setLocations] = useState<LocationLite[]>([]);
  // Cargar categoría del tenant + sedes
  useEffect(() => {
    api<any>('/tenants/me')
      .then((me) => {
        if (me?.businessCategorySlug) setTenantCategorySlug(me.businessCategorySlug);
        if (me?.walletAdvanced) setWalletAdv(me.walletAdvanced);
        setModulos({
          convenios: me?.conveniosEnabled === true,
          club: me?.clubEnabled === true,
        });
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
      // Normalización por type antes del POST. Cupón no tiene "sello
      // en progreso" → vacía stampEarnedMessage. Si rewardEarnedMessage
      // sigue siendo el default de sellos, lo cambiamos al default de
      // cupón.
      const isCoupon =
        form.type === 'COUPON' ||
        form.type === 'DISCOUNT' ||
        form.type === 'GIFT';
      const STAMP_DEFAULT_REWARD = '¡Has ganado tu recompensa!';
      // Si el cupón NO se convierte en tarjeta de sellos, invitar a "acumular
      // sellos" sería mentirle al cliente: no va a acumular nada.
      const COUPON_DEFAULT_REWARD = form.transformOnRedeem
        ? '¡Felicidades por canjear tu cupón! Empieza a acumular sellos para seguir obteniendo recompensas.'
        : '¡Felicidades por canjear tu cupón! Gracias por tu visita.';
      const payload = isCoupon
        ? {
            ...form,
            stampEarnedMessage: '',
            rewardEarnedMessage:
              form.rewardEarnedMessage.trim() === '' ||
              form.rewardEarnedMessage.trim() === STAMP_DEFAULT_REWARD
                ? COUPON_DEFAULT_REWARD
                : form.rewardEarnedMessage,
          }
        : form;
      const created = await api<any>('/cards', {
        method: 'POST',
        body: JSON.stringify(payload),
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
      setErr(t('errNameRequired'));
      return;
    }
    setErr(null);
    setConfirmActivate(true);
  }

  const cardName = form.name.trim() || t('untitled');

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
          modulos={modulos}
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
        <Step4Design
          form={form}
          setForm={(f) => setForm(f)}
          err={err}
          allowCustomBg={walletAdv?.customBackgrounds !== false}
          allowFreeRewards={walletAdv?.freeRewards !== false}
          showNextReward={walletAdv?.showNextReward !== false}
        />
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
  const t = useTranslations('app_cards_new');
  const steps = [
    { n: 1, label: t('stepTemplate') },
    { n: 2, label: t('stepType') },
    { n: 3, label: t('stepConfigure') },
    { n: 4, label: t('stepDesign') },
    { n: 5, label: t('stepInformation') },
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
          {t('cancel')}
        </button>
        {canBack && (
          <button className="btn-ghost" onClick={onBack}>
            ← {t('previous')}
          </button>
        )}
        {step < 5 && (
          <button className="btn-primary" onClick={onNext} disabled={!canNext}>
            {t('next')} →
          </button>
        )}
        {step === 5 && (
          <button
            className="btn-primary"
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
          >
            <Icon name="check" /> {submitting ? t('creating') : t('createCard')}
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
  const t = useTranslations('app_cards_new');
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
          <h2 className="text-base font-semibold m-0">{t('chooseTemplate')}</h2>
          <p className="text-xs text-mute mt-1">
            {t('chooseTemplateDesc')}
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
                {t('forMyIndustry')}
              </button>
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-full transition ${
                  filterMode === 'all' ? 'bg-white text-ink shadow-sm' : 'text-mute'
                }`}
              >
                {t('all')}
              </button>
            </div>
          )}
          <input
            className="input w-56"
            placeholder={t('searchTemplate')}
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
          <div className="font-semibold text-sm">{t('fromScratch')}</div>
          <div className="text-xs text-mute px-3 text-center leading-snug">
            {t('fromScratchDesc')}
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
          {t('noTemplates')}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 2: Tipo de tarjeta
// ═══════════════════════════════════════════════════════════

/**
 * La tarjeta de ALIANZA en el selector de tipo.
 *
 * No es un `CardType` y no se selecciona: LLEVA a `/app/alianzas`. Dos motivos,
 * los dos aprendidos aquí:
 *
 *  · Meter tipos nuevos en este asistente ya salió mal (ver el comentario de
 *    arriba: un `DISCOUNT` que se pintaba como sellos y al canjear no hacía
 *    nada). Una alianza no tiene sellos, ni premio, ni recompensa que
 *    configurar en los pasos 3 a 5 — su plantilla de pase se crea sola.
 *  · El alta de alianzas ya existe y funciona, con su cupo, sus tres modos de
 *    verificación y sus avisos. Duplicarla aquí garantizaba que los dos
 *    formularios acabaran diciendo cosas distintas.
 *
 * Solo se muestra si el negocio TIENE el módulo encendido. Antes se enseñaba
 * siempre, «de escaparate», y eso se lo estaba enseñando también a los negocios
 * de las otras marcas blancas: un cliente de Sellea veía Alianzas antes de que
 * su marca la tuviera. Lo que aún no se ha lanzado en una marca no se le
 * adelanta a sus negocios.
 */
function TarjetaAlianza() {
  return (
    <Link
      href="/app/alianzas?nueva=1"
      className="text-left p-4 rounded-2xl border-2 border-line hover:border-ink/40 bg-white transition block"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl shrink-0">🤝</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Alianza con una empresa</div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-violet-100 text-violet-700 px-2 py-0.5 shrink-0">
          Nuevo
        </span>
      </div>
      <p className="text-xs leading-snug mt-2 text-mute">
        Acuerdo con una empresa para que sus empleados tengan un beneficio
        permanente en tu local. Ella recibe su propio enlace para repartir.
      </p>
      <p className="text-xs mt-2 font-medium text-ink">Te llevamos a Alianzas →</p>
    </Link>
  );
}

/**
 * La tarjeta de CLUB en el selector de tipo.
 *
 * Igual que la de alianza: no es un `CardType`, LLEVA a `/app/club`. Sus pasos
 * son otros —cupo del mes, unidad, tramos de alta— y ninguno de los 3 a 5 de
 * este asistente le sirve: no tiene sellos que configurar ni premio al final.
 * Su plantilla de pase se crea sola al dar de alta al primer socio.
 */
function TarjetaClub() {
  return (
    <Link
      href="/app/club?nuevo=1"
      className="text-left p-4 rounded-2xl border-2 border-line hover:border-ink/40 bg-white transition block"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl shrink-0">🎟️</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Tarjeta de club</div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-violet-100 text-violet-700 px-2 py-0.5 shrink-0">
          Nuevo
        </span>
      </div>
      <p className="text-xs leading-snug mt-2 text-mute">
        Una suscripción que tu cliente te paga a ti: cada mes recibe un cupo de
        beneficios —diez cafés, cuatro lavadas— que gasta en el local y que
        vuelve a llenarse el día 1.
      </p>
      <p className="text-xs mt-2 font-medium text-ink">Te llevamos a Tarjeta de Club →</p>
    </Link>
  );
}

function Step2Type({
  selected,
  onSelect,
  onContinue,
  modulos,
}: {
  selected: CardType;
  onSelect: (t: CardType) => void;
  onContinue: () => void;
  /** Módulos encendidos para ESTE negocio. Gatean las dos tarjetas nuevas. */
  modulos: { convenios: boolean; club: boolean };
}) {
  const t = useTranslations('app_cards_new');
  return (
    <div className="card card-pad">
      <h2 className="text-base font-semibold m-0">{t('typeQuestion')}</h2>
      <p className="text-xs text-mute mt-1">
        {t('typeDesc')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
        {modulos.convenios && <TarjetaAlianza />}
        {modulos.club && <TarjetaClub />}
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
        {t('doubleClickHint')}
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
  const t = useTranslations('app_cards_new');
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
  const brand = (form.name.split('—')[0] || t('yourBrand')).trim();
  const visibleStamps = Math.min(form.stampsRequired, 7);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
      <div className="card card-pad">
        <div className="text-xs text-mute mb-2">
          {t('selectedType')} <span className="font-semibold text-ink">{TYPE_EMOJI[form.type]} {TYPE_LABEL[form.type]}</span>
        </div>

        <div className="mt-3">
          <label className="label">{t('cardName')}</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
            placeholder={t('cardNamePlaceholder')}
          />
        </div>

        <div className="mt-3">
          <label className="label">
            {t('locationLabel')}
            <span className="text-mute font-normal ml-1">{t('optional')}</span>
          </label>
          <select
            className="input"
            value={form.locationId ?? ''}
            onChange={(e) => set('locationId', e.target.value || null)}
          >
            <option value="">{t('allLocations')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-mute mt-1">
            {t('locationHint')}{' '}
            {locations.length === 0 && (
              <a href="/app/locations" className="text-brand hover:underline">
                {t('createLocation')} →
              </a>
            )}
          </div>
        </div>

        <div className="mt-3">
          <label className="label">{t('description')}</label>
          <textarea
            className="input"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div className="mt-3">
          <label className="label">{t('reward')}</label>
          <input
            className="input"
            value={form.rewardText}
            onChange={(e) => set('rewardText', e.target.value)}
          />
        </div>

        {form.type === 'STAMPS' && (
          <>
            <div className="mt-3">
              <label className="label">{t('stampsRequired')}</label>
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
                {t('intermediateRewards')}
                <span className="text-mute font-normal ml-1">{t('optional')}</span>
              </label>
              <input
                className="input"
                placeholder={t('intermediateRewardsPlaceholder')}
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
                {t('syntax')} <code className="bg-bg2 px-1 rounded">{t('syntaxFormat')}</code>{' '}
                {t('separatedByComma')} <code className="bg-bg2 px-1 rounded">5:5% off, 10:10% off</code>.
                {' '}{t('intermediateRewardsHint')}
              </div>
            </div>
          </>
        )}
        {/* DISCOUNT branch removido — el wizard ya no ofrece DISCOUNT.
            Cards DISCOUNT existentes se editan desde /app/cards/[id]. */}
        {form.type === 'POINTS' && (
          <div className="mt-3">
            <label className="label">{t('pointsPerThousand')}</label>
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
              {t('pointsHint')}
            </div>
          </div>
        )}
        {form.type === 'CASHBACK' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('cashbackPercent')}</label>
              <input
                type="number"
                className="input"
                min={1}
                max={50}
                value={form.cashbackPercent ?? 5}
                onChange={(e) => set('cashbackPercent', Number(e.target.value))}
              />
              <div className="text-[11px] text-mute mt-1">
                {t('cashbackPercentHint')}
              </div>
            </div>
            <div>
              <label className="label">{t('minPurchase')}</label>
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
                {t('cashbackMinHint')}
              </div>
            </div>
          </div>
        )}
        {form.type === 'VISITS' && (
          <>
            <div className="mt-3">
              <label className="label">{t('visitsRequired')}</label>
              <input
                type="number"
                className="input"
                min={1}
                max={50}
                value={form.visitsRequired ?? 10}
                onChange={(e) => set('visitsRequired', Number(e.target.value))}
              />
              <div className="text-[11px] text-mute mt-1">
                {t('visitsHint')}
              </div>
            </div>
          </>
        )}
        {form.type === 'HYBRID' && (
          <div className="mt-3 space-y-3">
            <div className="text-xs p-3 rounded-lg bg-brand/10 border border-brand/30">
              💡 {t('hybridHint')}
            </div>
            <div>
              <label className="label">{t('stampsRequired')}</label>
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
              <label className="label">{t('permanentDiscount')}</label>
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
              {t('minAmountPerStamp')}
              <span className="text-mute font-normal ml-1">{t('optional')}</span>
            </label>
            <input
              type="number"
              className="input"
              min={0}
              step={1000}
              placeholder={t('noMinPlaceholder')}
              value={form.minAmountPerStamp ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim();
                set('minAmountPerStamp', v === '' ? null : Number(v));
              }}
            />
            <div className="text-[11px] text-mute mt-1">
              {t('minAmountPerStampHint')}
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

        {/* COUPON/DISCOUNT/GIFT: elegir la tarjeta de sellos destino. */}
        {(form.type === 'COUPON' ||
          form.type === 'DISCOUNT' ||
          form.type === 'GIFT') && (
          <CouponTransformTargetPicker
            value={form.transformIntoCardId}
            transformOnRedeem={form.transformOnRedeem}
            onChange={(id, transformar) =>
              setForm({
                ...form,
                transformIntoCardId: id,
                transformOnRedeem: transformar,
              })
            }
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
          💡 {t('nextStepDesignHint')}
        </div>

        {err && (
          <div className="mt-4 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
          {t('iphonePreview')}
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
            stampBgType={form.stampBgType}
            stampBgImageUrl={form.stampBgImageUrl}
            stampIconImageUrl={form.stampIconImageUrl}
            freeRewards={form.freeRewards}
            rewardText={form.rewardText}
            customerName="RICARDO PÉREZ"
            barcodeValue="DEMO123456"
          />
        </div>

        {/* Preview REAL del cartón de sellos: imagen PNG del generador de
            producción (Sharp) — lo que el cliente ve en su Wallet — en los 3
            estados. Solo para tarjetas con grilla de sellos. */}
        {(form.type === 'STAMPS' ||
          form.type === 'HYBRID' ||
          form.type === 'VISITS') && (
          <div className="mt-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
              Imagen real en el Wallet
            </div>
            <WalletStripRealPreview
              config={{
                primaryColor: form.primaryColor,
                secondaryColor: form.secondaryColor,
                stampsRequired:
                  form.type === 'VISITS'
                    ? form.visitsRequired ?? 10
                    : form.stampsRequired,
                stampIcon: form.stampIcon,
                stampIconImageUrl: form.stampIconImageUrl,
                stampActiveColor: form.stampActiveColor,
                stampInactiveColor: form.stampInactiveColor,
                stampContourColor: form.stampContourColor,
                centerBgColor: form.centerBgColor,
                stampBgType: form.stampBgType,
                stampBgImageUrl: form.stampBgImageUrl,
                freeRewards: form.freeRewards,
              }}
            />
          </div>
        )}

        <div className="card card-pad mt-4 flex items-start gap-3">
          <Icon name="spark" size={18} className="text-brand flex-none mt-0.5" />
          <div className="text-sm">
            <strong>{t('tip')}</strong> {t('tipBrandColors')}
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
  allowCustomBg,
  allowFreeRewards,
  showNextReward,
}: {
  form: typeof FROM_SCRATCH_DEFAULTS;
  setForm: (f: typeof FROM_SCRATCH_DEFAULTS) => void;
  err: string | null;
  allowCustomBg: boolean;
  allowFreeRewards: boolean;
  showNextReward: boolean;
}) {
  const t = useTranslations('app_cards_new');
  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }
  const brand = (form.name.split('—')[0] || t('yourBrand')).trim();
  const visibleStamps = Math.min(form.stampsRequired, 7);
  const isProgress = form.type === 'STAMPS' || form.type === 'HYBRID' || form.type === 'VISITS';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
      <div className="card card-pad space-y-4">
        <div>
          <h3 className="font-semibold text-base m-0">✨ {t('presetStyles')}</h3>
          <p className="text-xs text-mute mt-1">
            {t('presetStylesDesc')}
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
          <h3 className="font-semibold text-base m-0">🎨 {t('brandColors')}</h3>
          <p className="text-xs text-mute mt-1">
            {t('brandColorsDesc')}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t('primaryColor')}</label>
            <input
              type="color"
              className="input h-11 p-1"
              value={form.primaryColor}
              onChange={(e) => set('primaryColor', e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('secondaryColor')}</label>
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
            <h4 className="text-sm font-semibold m-0 mb-2">🎯 {t('advancedStampColors')}</h4>
            <p className="text-[11px] text-mute mb-3">
              {t('advancedStampColorsDesc')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <AdvancedColorInput
                label={t('stampActive')}
                value={form.stampActiveColor}
                onChange={(v) => set('stampActiveColor', v)}
              />
              <AdvancedColorInput
                label={t('stampInactive')}
                value={form.stampInactiveColor}
                onChange={(v) => set('stampInactiveColor', v)}
              />
              <AdvancedColorInput
                label={t('stampContour')}
                value={form.stampContourColor}
                onChange={(v) => set('stampContourColor', v)}
              />
              <AdvancedColorInput
                label={t('centerBg')}
                value={form.centerBgColor}
                onChange={(v) => set('centerBgColor', v)}
              />
            </div>
          </div>
        )}

        {(form.type === 'STAMPS' || form.type === 'HYBRID' || form.type === 'VISITS') && (
          <div className="pt-2 border-t border-line">
            <label className="label">{t('stampIcon')}</label>
            <StampIconPicker
              value={form.stampIcon}
              onSelect={(icon) => set('stampIcon', icon)}
              imageUrl={form.stampIconImageUrl}
              onImageChange={(url) => set('stampIconImageUrl', url)}
            />
          </div>
        )}

        {isProgress && (
          <div className="pt-2 border-t border-line">
            <label className="label">Fondo del área de sellos</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {([
                { v: 'GRADIENT', label: 'Degradado', hint: 'Clásico' },
                { v: 'SOLID', label: 'Color sólido', hint: 'Uniforme' },
                ...(allowCustomBg ? [{ v: 'IMAGE', label: 'Imagen', hint: 'Personalizada' }] : []),
              ] as const).map((o) => {
                const on = form.stampBgType === o.v;
                return (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => set('stampBgType', o.v)}
                    className={`rounded-lg px-2 py-2 text-center transition border-2 ${
                      on ? 'border-brand bg-brand/10' : 'border-line bg-transparent'
                    }`}
                  >
                    <div className={`text-xs font-semibold ${on ? 'text-brand' : 'text-ink'}`}>{o.label}</div>
                    <div className="text-[10px] text-mute">{o.hint}</div>
                  </button>
                );
              })}
            </div>
            {form.stampBgType === 'IMAGE' && allowCustomBg && (
              <div className="mt-3">
                <ImageUploader
                  value={form.stampBgImageUrl}
                  onChange={(url) => set('stampBgImageUrl', url)}
                  folder="card-stamp-bg"
                  crop={false}
                />
                <div className="text-[11px] text-mute mt-2 leading-relaxed">
                  Recomendado <b>1200×420 px</b> · PNG/JPG/WEBP · &lt;500 KB · relación{' '}
                  <b>20:7</b> · modo <b>cubrir</b> centrado (nunca se deforma). Solo afecta el
                  área de los sellos.
                </div>
              </div>
            )}
          </div>
        )}

        {isProgress && allowFreeRewards && (
          <FreeRewardsEditor
            value={form.freeRewards}
            onChange={(v) => set('freeRewards', v)}
            maxPos={form.stampsRequired}
          />
        )}

        <div className="pt-2 border-t border-line">
          <label className="label">📸 {t('coverImage')}</label>
          <p className="text-xs text-mute leading-relaxed -mt-1 mb-2.5">
            {t('coverImageDesc')} <b>800×400 px</b> {t('coverImageDescEnd')}
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
            <label className="label m-0">{t('termsAndConditions')}</label>
            <button
              type="button"
              onClick={() => set('termsEnabled', !form.termsEnabled)}
              className={`relative w-10 h-5 rounded-full transition ${
                form.termsEnabled ? 'bg-brand' : 'bg-bg2 border border-line'
              }`}
              aria-label={t('toggleTerms')}
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
              placeholder={t('termsPlaceholder')}
            />
          ) : (
            <div className="text-xs text-mute mt-2">
              {t('noTerms')}
            </div>
          )}
        </div>

        {/* PDF Software(8): toggle de la casilla de políticas de datos. El
            documento se sube en Configuración → Documento de políticas de datos. */}
        <div className="pt-2 border-t border-line">
          <div className="flex items-center justify-between">
            <label className="label m-0">{t('dataPolicyToggle')}</label>
            <button
              type="button"
              onClick={() => set('dataPolicyEnabled', !form.dataPolicyEnabled)}
              className={`relative w-10 h-5 rounded-full transition ${
                form.dataPolicyEnabled ? 'bg-brand' : 'bg-bg2 border border-line'
              }`}
              aria-label={t('dataPolicyToggle')}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${
                  form.dataPolicyEnabled ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <p className="text-xs text-mute mt-2">{t('dataPolicyToggleHint')}</p>
        </div>

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
          {t('preview')}
        </div>
        <div className="flex justify-center">
          <WalletPassPreview
            showNextReward={showNextReward}
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
            stampBgType={form.stampBgType}
            stampBgImageUrl={form.stampBgImageUrl}
            stampIconImageUrl={form.stampIconImageUrl}
            freeRewards={form.freeRewards}
            rewardText={form.rewardText}
            customerName="RICARDO PÉREZ"
            barcodeValue="DEMO123456"
          />
        </div>
        <div className="card card-pad mt-4 flex items-start gap-3">
          <Icon name="spark" size={18} className="text-brand flex-none mt-0.5" />
          <div className="text-sm">
            <strong>{t('tip')}</strong> {t('tipExactColors')}
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
  const t = useTranslations('app_cards_new');
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
          {t('backInfoNote')}
        </div>

        {(() => {
          // Cupón/Descuento/Regalo: separar texts y ocultar campos
          // exclusivos de sellos. Decisión del founder: el wizard de
          // cupón NO debe heredar copy/campos de la tarjeta de sellos.
          const isCoupon =
            form.type === 'COUPON' ||
            form.type === 'DISCOUNT' ||
            form.type === 'GIFT';
          return (
            <>
              <div>
                <label className="label">
                  {isCoupon ? t('howToRedeemCoupon') : t('howToEarnStamp')}
                </label>
                <input
                  className="input"
                  placeholder={
                    isCoupon
                      ? t('howToRedeemCouponPlaceholder')
                      : t('howToEarnStampPlaceholder')
                  }
                  value={form.howToEarnText}
                  onChange={(e) => set('howToEarnText', e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('businessName')}</label>
                <input
                  className="input"
                  placeholder={t('businessNamePlaceholder')}
                  value={form.businessName}
                  onChange={(e) => set('businessName', e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('rewardDescription')}</label>
                <input
                  className="input"
                  placeholder={
                    isCoupon
                      ? t('rewardDescCouponPlaceholder')
                      : t('rewardDescStampPlaceholder')
                  }
                  value={form.rewardDescText}
                  onChange={(e) => set('rewardDescText', e.target.value)}
                />
              </div>
              {/* Mensaje de sello ganado — solo aplica a STAMPS/VISITS/
                  HYBRID. Cupón no tiene "sello en progreso", se canjea
                  una vez. */}
              {!isCoupon && (
                <div>
                  <label className="label">
                    {t('stampEarnedMessage')}
                    <span className="text-mute font-normal ml-1">
                      {t('stampsRemainingHint')}
                    </span>
                  </label>
                  <input
                    className="input"
                    placeholder={t('stampEarnedPlaceholder')}
                    value={form.stampEarnedMessage}
                    onChange={(e) => set('stampEarnedMessage', e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="label">
                  {isCoupon
                    ? t('couponRedeemMessage')
                    : t('rewardEarnedMessage')}
                </label>
                <input
                  className="input"
                  placeholder={
                    isCoupon
                      ? t('couponRedeemPlaceholder')
                      : t('rewardEarnedPlaceholder')
                  }
                  value={form.rewardEarnedMessage}
                  onChange={(e) =>
                    set('rewardEarnedMessage', e.target.value)
                  }
                />
              </div>
            </>
          );
        })()}

        <div className="pt-3 border-t border-line">
          <label className="label">{t('activeLinks')}</label>
          <div className="text-[11px] text-mute mb-2">
            {t('activeLinksHint')}
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
                <option value="URL">{t('linkTypeUrl')}</option>
                <option value="PHONE">{t('linkTypePhone')}</option>
                <option value="EMAIL">{t('linkTypeEmail')}</option>
                <option value="ADDRESS">{t('linkTypeAddress')}</option>
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
                    : t('addressPlaceholder')
                }
                value={link.url}
                onChange={(e) => updateLink(i, { url: e.target.value })}
              />
              <input
                className="input"
                placeholder={t('linkLabelPlaceholder')}
                value={link.label}
                onChange={(e) => updateLink(i, { label: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeLink(i)}
                className="text-mute hover:text-bad text-lg leading-none"
                aria-label={t('remove')}
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
            + {t('addLink')}
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
          {t('backPreview')}
        </div>
        <div className="bg-bg2 rounded-lg p-4 space-y-2 text-sm">
          {form.howToEarnText && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                {form.type === 'COUPON' ||
                form.type === 'DISCOUNT' ||
                form.type === 'GIFT'
                  ? t('howToRedeemCoupon')
                  : t('howToEarnStamp')}
              </div>
              <div>{form.howToEarnText}</div>
            </div>
          )}
          {form.businessName && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('company')}
              </div>
              <div>{form.businessName}</div>
            </div>
          )}
          {form.rewardDescText && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('reward')}
              </div>
              <div>{form.rewardDescText}</div>
            </div>
          )}
          {form.activeLinks.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('links')}
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
                {t('terms')}
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
  const t = useTranslations('app_cards_new');
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
          {enabled ? t('clear') : t('useCustom')}
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
  const t = useTranslations('app_cards_new');
  const lockedItems = [
    { icon: '📱', label: t('lockedType') },
    { icon: 'ℹ️', label: t('lockedTerms') },
    { icon: '🕓', label: t('lockedExpiry') },
    { icon: '🧾', label: t('lockedIssuance') },
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
          aria-label={t('close')}
          className="absolute top-4 right-4 text-mute hover:text-ink text-xl"
        >
          ×
        </button>
        <h2 className="text-xl font-bold m-0">{t('activateCard')}</h2>
        <p className="text-sm text-mute mt-1.5">
          {t('activateWarning')}
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
            {submitting ? t('activating') : t('activate')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl border border-line text-ink font-semibold hover:bg-bg2 transition"
          >
            {t('cancel')}
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
  const t = useTranslations('app_cards_new');
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
    spend: t('metricSpend'),
    visits: t('metricVisits'),
    stamps: t('metricStamps'),
  };

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="label">{t('tierMetricLabel')}</label>
        <select
          className="input"
          value={metric}
          onChange={(e) => onChangeMetric(e.target.value as any)}
        >
          <option value="spend">{t('metricSpendTotal')}</option>
          <option value="visits">{t('metricVisits')}</option>
          <option value="stamps">{t('metricStamps')}</option>
        </select>
        <div className="text-[11px] text-mute mt-1">
          {t('tierThresholdHint', { metric: metricLabel[metric].toLowerCase() })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="label m-0">{t('vipTiers')}</label>
        <button
          type="button"
          onClick={addTier}
          className="text-xs text-brand hover:underline"
        >
          + {t('addTier')}
        </button>
      </div>

      {tiers.length === 0 && (
        <div className="text-xs text-mute p-3 rounded-lg bg-bg2/40 border border-dashed border-line">
          {t('noTiersHint')}
        </div>
      )}

      {tiers.map((tier, i) => (
        <div key={i} className="p-3 rounded-lg border border-line bg-bg2/30 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              placeholder={t('tierNamePlaceholder')}
              value={tier.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <input
              className="input w-16 text-center"
              placeholder="🥈"
              value={tier.icon ?? ''}
              onChange={(e) => patch(i, { icon: e.target.value })}
            />
            <input
              type="color"
              className="input h-10 p-1 w-12"
              value={tier.color ?? '#9CA3AF'}
              onChange={(e) => patch(i, { color: e.target.value })}
            />
            <button
              type="button"
              onClick={() => removeTier(i)}
              className="text-xs text-rose-500 hover:underline"
            >
              {t('remove')}
            </button>
          </div>
          <div>
            <label className="label">
              {t('threshold')} ({metricLabel[metric]})
            </label>
            <input
              type="number"
              className="input"
              min={0}
              step={metric === 'spend' ? 10000 : 1}
              value={tier.threshold}
              onChange={(e) =>
                patch(i, { threshold: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="label">{t('perksLabel')}</label>
            <textarea
              className="input"
              rows={2}
              value={(tier.perks ?? []).join('\n')}
              onChange={(e) =>
                patch(i, {
                  perks: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder={t('perksPlaceholder')}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Selector de la tarjeta de SELLOS destino para COUPON/DISCOUNT/GIFT.
 * Al redeem del cupón, el pass se transforma in-place en una stamps
 * card. Por default (null) usa la primera stamps activa del tenant, o
 * la crea si no existe. El user puede elegir explícitamente otra para
 * conectar el cupón a una tarjeta de fidelización específica.
 */
/**
 * A qué se convierte el cupón al canjearse.
 *
 * Tres estados, no dos. `transformIntoCardId = null` NO servía para decir
 * "a ninguna": null ya significa "auto, la primera tarjeta de sellos activa".
 * Por eso el backend tiene un campo aparte, `transformOnRedeem`, y aquí un
 * valor centinela para el desplegable.
 */
const SIN_CONVERTIR = '__none__';

function CouponTransformTargetPicker({
  value,
  transformOnRedeem,
  onChange,
}: {
  value: string | null;
  transformOnRedeem: boolean;
  onChange: (id: string | null, transformOnRedeem: boolean) => void;
}) {
  const t = useTranslations('app_cards_new');
  const [options, setOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Array<{ id: string; name: string; type: string; isActive: boolean }>>(
      '/cards',
    )
      .then((all) => {
        const stamps = all
          .filter((c) => c.type === 'STAMPS' && c.isActive)
          .map((c) => ({ id: c.id, name: c.name }));
        setOptions(stamps);
      })
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mt-3 pt-3 border-t border-line">
      <label className="label">
        {t('transformInto')}{' '}
        <span className="text-mute font-normal">
          {t('targetStampsCard')}
        </span>
      </label>
      <select
        className="input"
        value={!transformOnRedeem ? SIN_CONVERTIR : (value ?? '')}
        onChange={(e) => {
          const v = e.target.value;
          if (v === SIN_CONVERTIR) onChange(null, false);
          else onChange(v || null, true);
        }}
        disabled={loading}
      >
        <option value="">{t('autoFirstStampsCard')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        <option value={SIN_CONVERTIR}>{t('noTransform')}</option>
      </select>
      <div className="text-[11px] text-mute mt-1 leading-snug">
        {!transformOnRedeem
          ? 'El cliente canjea el cupón y su tarjeta queda marcada como usada. No entra al programa de sellos ni se le crea ninguna tarjeta.'
          : t('transformHint')}
      </div>
    </div>
  );
}
