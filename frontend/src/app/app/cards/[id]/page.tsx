'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { StampIconPicker } from '@/components/StampIconPicker';
import { CardExpiryPicker } from '@/components/CardExpiryPicker';
import { ImageUploader } from '@/components/ImageUploader';
import { WalletPassPreview } from '@/components/WalletPassPreview';
import { WalletStylesGallery } from '@/components/WalletStylesGallery';

type CardType =
  | 'STAMPS'
  | 'POINTS'
  | 'DISCOUNT'
  | 'MEMBERSHIP'
  | 'CASHBACK'
  | 'VISITS'
  | 'HYBRID'
  | 'COUPON'
  | 'GIFT'
  | 'MULTI';

type Card = {
  id: string;
  name: string;
  description?: string;
  type: CardType;
  rewardText: string;
  terms: string;
  termsEnabled?: boolean;
  primaryColor: string;
  secondaryColor: string;
  stampActiveColor?: string | null;
  stampInactiveColor?: string | null;
  stampContourColor?: string | null;
  centerBgColor?: string | null;
  stampsRequired: number | null;
  stampIcon?: string;
  heroImageUrl?: string | null;
  discountPercent?: number | null;
  pointsPerCurrency?: number | string | null;
  cashbackPercent?: number | null;
  minAmountPerStamp?: number | string | null;
  visitsRequired?: number | null;
  tiers?: Array<{ name: string }>;
  validUntil?: string | null;
  validDaysAfterIssue?: number | null;
  locationId?: string | null;
  howToEarnText?: string;
  businessName?: string;
  rewardDescText?: string;
  stampEarnedMessage?: string;
  rewardEarnedMessage?: string;
  multiRewards?: Array<{ at: number; reward: string }>;
  activeLinks?: Array<{ type: string; url: string; label: string }>;
  utmLinks?: Array<{
    id: string;
    source: string;
    slug: string;
    welcomeStamps: number | null;
    welcomePoints: number | string | null;
    bonusExpiresAt: string | null;
    useCount: number;
  }>;
  isActive: boolean;
  _count?: { passes: number };
};

type TenantInfo = {
  brandName?: string;
  walletLogoUrl?: string | null;
  logoUrl?: string | null;
};

type Customer = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
};

type Pass = {
  id: string;
  serialNumber: string;
  status: string;
  stampsCount: number;
  pointsBalance: number;
  issuedAt: string;
  cardId: string;
  customer: { id: string; fullName: string };
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
  EXPIRED: 'Expirada',
  REVOKED: 'Revocada',
};

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allPasses, setAllPasses] = useState<Pass[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [issuedPass, setIssuedPass] = useState<any>(null);
  const [search, setSearch] = useState('');

  async function load() {
    try {
      const [c, cs, ps, t] = await Promise.all([
        api<Card>(`/cards/${id}`),
        api<Customer[]>('/customers'),
        api<Pass[]>('/passes'),
        api<TenantInfo>('/tenants/me').catch(() => null),
      ]);
      setCard(c);
      setCustomers(cs);
      setAllPasses(ps);
      setTenant(t);
    } catch (e: any) {
      toast(e.message || 'Error cargando tarjeta', 'error');
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  async function issue(customerId: string) {
    setIssuing(true);
    try {
      const p = await api<any>('/passes', {
        method: 'POST',
        body: JSON.stringify({ cardId: id, customerId }),
      });
      setIssuedPass(p);
      toast('Pase emitido', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo emitir el pase', 'error');
    } finally {
      setIssuing(false);
    }
  }

  function copyLink() {
    if (!issuedPass) return;
    const url = `${window.location.origin}/w/${issuedPass.id}`;
    navigator.clipboard.writeText(url).then(
      () => toast('Link copiado', 'success'),
      () => toast('No se pudo copiar', 'error'),
    );
  }

  const passesOfCard = useMemo(
    () => allPasses.filter((p) => p.cardId === id),
    [allPasses, id],
  );

  const [passSearch, setPassSearch] = useState('');
  const [stampingPassId, setStampingPassId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'detail' | 'analytics'>('detail');
  const filteredPasses = useMemo(() => {
    const q = passSearch.trim().toLowerCase();
    if (!q) return passesOfCard;
    return passesOfCard.filter((p) =>
      p.customer.fullName.toLowerCase().includes(q),
    );
  }, [passesOfCard, passSearch]);

  async function changeStamps(passId: string, action: 'STAMP' | 'REFUND', amount = 1) {
    // Fix 2026-06-10: el backend exige `purchaseAmount` cuando
    // action='STAMP' en cards STAMPS/VISITS/HYBRID. Sin esto devolvía
    // "Monto de compra requerido para registrar el sello" y parecía
    // que el botón no funcionaba. REFUND no requiere monto.
    const payload: Record<string, unknown> = { passId, action, amount };
    if (action === 'STAMP') {
      const raw = window.prompt(
        'Monto de la compra (en $) para registrar el sello:',
        '',
      );
      if (raw === null) return; // cancelado
      const purchaseAmount = Number(raw.replace(',', '.'));
      if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
        toast('Monto inválido — debe ser un número mayor a 0', 'error');
        return;
      }
      payload.purchaseAmount = purchaseAmount;
    }
    setStampingPassId(passId);
    try {
      await api('/stamps', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast(action === 'STAMP' ? '+1 sello' : '−1 sello', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    } finally {
      setStampingPassId(null);
    }
  }

  const stats = useMemo(() => {
    const total = passesOfCard.length;
    const active = passesOfCard.filter((p) => p.status === 'ACTIVE').length;
    const completed = passesOfCard.filter((p) => p.status === 'COMPLETED').length;
    const stampsTotal = passesOfCard.reduce(
      (s, p) => s + (p.stampsCount ?? 0),
      0,
    );
    return { total, active, completed, stampsTotal };
  }, [passesOfCard]);

  // Customers que ya tienen pase de esta tarjeta — los ocultamos del picker
  const issuedCustomerIds = useMemo(
    () => new Set(passesOfCard.map((p) => p.customer.id)),
    [passesOfCard],
  );
  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers
      .filter((c) => !issuedCustomerIds.has(c.id))
      .filter((c) => {
        if (!term) return true;
        const hay = `${c.fullName} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase();
        return hay.includes(term);
      });
  }, [customers, issuedCustomerIds, search]);

  if (!card) return <div className="text-mute">Cargando…</div>;
  const required = card.stampsRequired ?? 10;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/cards" className="text-mute hover:text-ink">
            Tarjetas
          </Link>{' '}
          <span className="page-crumb">/ {card.name}</span>
        </h1>
        <div className="flex items-center gap-2">
          <span
            className={`badge ${card.isActive ? 'badge-ok' : 'badge-mute'}`}
          >
            {card.isActive ? 'Activa' : 'Pausada'}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn"
            title="Editar nombre, descripción, recompensa, etc."
          >
            <Icon name="edit" /> Editar
          </button>
          <ToggleActiveButton card={card} onChange={load} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-line">
        <TabBtn active={activeTab === 'detail'} onClick={() => setActiveTab('detail')}>
          📋 Detalle
        </TabBtn>
        <TabBtn active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')}>
          📊 Analytics
        </TabBtn>
      </div>

      {activeTab === 'analytics' && <CardAnalytics cardId={String(id)} />}
      {activeTab === 'detail' && (
        <>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="Pases emitidos" value={stats.total} />
        <Kpi label="Activos" value={stats.active} accent="brand" />
        <Kpi label="Completados" value={stats.completed} accent="ok" />
        <Kpi label="Sellos totales" value={stats.stampsTotal} accent="amber" />
      </div>

      <EnrollLinkCard cardId={String(id)} cardName={card.name} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Preview grande — mismo componente que el wizard y el wallet del cliente */}
        <div className="space-y-4">
          <div className="flex justify-center">
            <WalletPassPreview
              brandName={
                tenant?.brandName ||
                card.businessName ||
                card.name.split('—')[0].trim() ||
                'Tu marca'
              }
              brandLogoUrl={tenant?.walletLogoUrl ?? tenant?.logoUrl ?? null}
              primaryColor={card.primaryColor}
              secondaryColor={card.secondaryColor}
              cardName={card.name}
              cardType={card.type}
              stampsRequired={card.stampsRequired}
              stampsCount={Math.min(3, card.stampsRequired ?? 10)}
              visitsRequired={card.visitsRequired}
              visitsCount={3}
              cashbackBalance={15000}
              pointsBalance={120}
              discountPercent={card.discountPercent}
              currentTier={card.tiers?.[0]?.name}
              tiers={card.tiers}
              stampIcon={card.stampIcon}
              stampActiveColor={card.stampActiveColor}
              stampInactiveColor={card.stampInactiveColor}
              stampContourColor={card.stampContourColor}
              centerBgColor={card.centerBgColor}
              rewardText={card.rewardText}
            />
          </div>

          {card.terms && (
            <div className="card card-pad text-xs text-mute leading-relaxed">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink mb-2">
                Términos y condiciones
              </div>
              {card.terms}
            </div>
          )}

          {/* Pases recientes — con buscador y +/- sellos */}
          <div className="card card-pad">
            <div className="font-semibold mb-2 text-sm">
              Pases ({passesOfCard.length})
            </div>
            {passesOfCard.length > 0 && (
              <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5 mb-2.5">
                <Icon name="search" size={14} className="text-mute" />
                <input
                  className="border-0 outline-none text-sm flex-1 bg-transparent"
                  placeholder="Buscar cliente…"
                  value={passSearch}
                  onChange={(e) => setPassSearch(e.target.value)}
                />
              </div>
            )}
            {passesOfCard.length === 0 ? (
              <div className="text-xs text-mute italic py-3 text-center">
                Aún no se ha emitido ninguno.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-auto">
                {filteredPasses.slice(0, 30).map((p) => {
                  const busyRow = stampingPassId === p.id;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-bg2"
                    >
                      <Link
                        href={`/app/customers/${p.customer.id}`}
                        className="min-w-0 flex-1 hover:text-brand"
                      >
                        <div className="font-medium truncate">
                          {p.customer.fullName}
                        </div>
                        <div className="text-[10px] text-mute font-mono">
                          {p.serialNumber}
                        </div>
                      </Link>
                      {card.type === 'STAMPS' && (
                        <>
                          <div className="text-xs text-mute font-semibold tabular-nums">
                            {p.stampsCount}/{required}
                          </div>
                          <button
                            type="button"
                            onClick={() => changeStamps(p.id, 'REFUND', 1)}
                            disabled={busyRow || p.stampsCount <= 0}
                            className="w-7 h-7 rounded-full border border-line text-mute hover:text-bad hover:border-bad disabled:opacity-30"
                            title="Quitar 1 sello"
                          >
                            −
                          </button>
                          <button
                            type="button"
                            onClick={() => changeStamps(p.id, 'STAMP', 1)}
                            disabled={busyRow}
                            className="w-7 h-7 rounded-full bg-ok text-white hover:bg-ok/90 disabled:opacity-50"
                            title="Sumar 1 sello"
                          >
                            +
                          </button>
                        </>
                      )}
                      <span
                        className={`badge text-[10px] ${
                          p.status === 'ACTIVE'
                            ? 'badge-ok'
                            : p.status === 'COMPLETED'
                            ? 'badge-info'
                            : 'badge-mute'
                        }`}
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </div>
                  );
                })}
                {filteredPasses.length === 0 && passSearch && (
                  <div className="text-xs text-mute italic py-3 text-center">
                    Sin resultados para "{passSearch}"
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Emitir pase */}
        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Emitir nuevo pase</h2>
          <p className="text-sm text-mute mt-1">
            Selecciona un cliente para emitirle esta tarjeta. Los que ya la
            tienen no aparecen.
          </p>

          <div className="mt-3 flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm flex-1 bg-transparent"
              placeholder="Buscar cliente…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-mute hover:text-ink text-sm"
              >
                ✕
              </button>
            )}
          </div>

          <div className="mt-3 max-h-[460px] overflow-auto rounded-lg border border-line2 divide-y divide-line2">
            {filteredCustomers.length === 0 && (
              <div className="p-6 text-sm text-center text-mute">
                {customers.length === 0 ? (
                  <>
                    No tienes clientes aún.{' '}
                    <Link className="text-brand hover:underline" href="/app/customers">
                      Crea uno
                    </Link>
                    .
                  </>
                ) : search ? (
                  `Sin resultados para "${search}"`
                ) : (
                  'Todos los clientes ya tienen esta tarjeta. 🎉'
                )}
              </div>
            )}
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                disabled={issuing}
                onClick={() => issue(c.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-bg2 transition disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium block truncate">
                    {c.fullName}
                  </span>
                  <span className="text-mute text-xs block truncate">
                    {c.email ?? c.phone ?? '—'}
                  </span>
                </span>
                <span className="text-brand text-xs font-medium ml-2 whitespace-nowrap">
                  Emitir →
                </span>
              </button>
            ))}
          </div>

          {issuedPass && (
            <div className="mt-5 rounded-lg bg-ok-soft px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-semibold text-ok-ink">
                <Icon name="check" /> Pase emitido a {issuedPass.customer?.fullName ?? 'cliente'}
              </div>
              <div className="mt-2 text-ok-ink text-xs">
                Comparte este link por WhatsApp para que lo guarden en su Wallet:
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 text-[11px] bg-white/60 px-2 py-1.5 rounded truncate">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/w/{issuedPass.id}
                </code>
                <button
                  onClick={copyLink}
                  className="btn-ghost text-xs whitespace-nowrap"
                >
                  Copiar
                </button>
                <a
                  href={`/w/${issuedPass.id}`}
                  target="_blank"
                  className="btn-primary text-xs whitespace-nowrap"
                >
                  Abrir
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditCardModal
          card={card}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: 'brand' | 'ok' | 'amber';
}) {
  const cls: Record<string, string> = {
    brand: 'text-brand',
    ok: 'text-ok',
    amber: 'text-amber-700',
  };
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${accent ? cls[accent] : ''}`}>
        {value}
      </div>
    </div>
  );
}

// ============================================================
//                 ENROLL LINK + QR (público)
// ============================================================

function EnrollLinkCard({ cardId, cardName }: { cardId: string; cardName: string }) {
  const [appUrl, setAppUrl] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setAppUrl(window.location.origin);
  }, []);
  const enrollUrl = `${appUrl}/c/${cardId}`;

  function copy() {
    if (!enrollUrl || typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(enrollUrl).then(
      () => toast('Link copiado', 'success'),
      () => toast('No se pudo copiar', 'error'),
    );
  }

  function downloadQR() {
    const svg = document.querySelector<SVGElement>('#enroll-qr-svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 800, 800);
      ctx.drawImage(img, 100, 100, 600, 600);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tarjeta-${cardName.replace(/\s+/g, '-').toLowerCase()}-qr.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
  }

  return (
    <div className="card card-pad mb-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
        <div className="bg-white border border-line p-3 rounded-xl flex items-center justify-center self-center sm:self-auto sm:flex-none">
          {enrollUrl ? (
            <QRCodeSVG
              id="enroll-qr-svg"
              value={enrollUrl}
              size={132}
              level="M"
              includeMargin={false}
            />
          ) : (
            <div className="w-[132px] h-[132px] bg-bg2 rounded animate-pulse" />
          )}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-1">
            QR de inscripción
          </div>
          <h3 className="font-semibold text-sm sm:text-base text-ink leading-snug">
            Link para que los clientes obtengan esta tarjeta
          </h3>
          <div className="mt-3 flex items-center gap-2 bg-bg2 border border-line rounded-input px-3 py-2 text-[11px] sm:text-xs font-mono text-mute overflow-hidden">
            <span className="truncate flex-1 text-left" title={enrollUrl}>
              {enrollUrl}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 sm:flex sm:flex-wrap gap-2">
            <button
              onClick={copy}
              className="btn-ghost text-xs justify-center px-2"
            >
              Copiar
            </button>
            <button
              onClick={downloadQR}
              className="btn-ghost text-xs justify-center px-2"
            >
              QR PNG
            </button>
            <a
              href={enrollUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-xs justify-center px-2"
            >
              Previa
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleActiveButton({
  card,
  onChange,
}: {
  card: { id: string; isActive: boolean; name: string };
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !card.isActive;
    if (
      !next &&
      !confirm(
        `Pausar "${card.name}": deja de aparecer en el storefront público y los clientes no podrán inscribirse a nuevas tarjetas. Los pases existentes siguen activos. ¿Continuar?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/cards/${card.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      toast(next ? 'Tarjeta activada' : 'Tarjeta pausada', 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={card.isActive ? 'btn' : 'btn-primary'}
    >
      {busy ? '…' : card.isActive ? '⏸ Pausar' : '▶ Activar'}
    </button>
  );
}

function EditCardModal({
  card,
  onClose,
  onSaved,
}: {
  card: Card;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: card.name,
    // #24 (2026-06-16): nombre de marca mostrado en el pase (independiente del
    // nombre del negocio que ve el dashboard). Vacío = usa el del negocio.
    walletBrandName: (card as any).walletBrandName ?? '',
    description: card.description ?? '',
    rewardText: card.rewardText ?? '',
    terms: card.terms ?? '',
    termsEnabled: card.termsEnabled ?? true,
    primaryColor: card.primaryColor,
    secondaryColor: card.secondaryColor,
    stampActiveColor: card.stampActiveColor ?? (null as string | null),
    stampInactiveColor: card.stampInactiveColor ?? (null as string | null),
    stampContourColor: card.stampContourColor ?? (null as string | null),
    centerBgColor: card.centerBgColor ?? (null as string | null),
    stampsRequired: card.stampsRequired ?? 10,
    minAmountPerStamp:
      card.minAmountPerStamp == null
        ? (null as number | null)
        : Number(card.minAmountPerStamp),
    discountPercent: card.discountPercent ?? 10,
    pointsPerCurrency: Number(card.pointsPerCurrency ?? 0.001),
    stampIcon: card.stampIcon ?? '☕',
    heroImageUrl: card.heroImageUrl ?? (null as string | null),
    validUntil: card.validUntil
      ? card.validUntil.split('T')[0]
      : (null as string | null),
    validDaysAfterIssue: card.validDaysAfterIssue ?? (null as number | null),
    locationId: card.locationId ?? (null as string | null),
    howToEarnText: card.howToEarnText ?? '',
    businessName: card.businessName ?? '',
    rewardDescText: card.rewardDescText ?? '',
    stampEarnedMessage: card.stampEarnedMessage ?? '',
    rewardEarnedMessage: card.rewardEarnedMessage ?? '',
    multiRewards: card.multiRewards ?? [],
    activeLinks: card.activeLinks ?? [],
  });
  // Buffer raw del input de multiRewards: el array `form.multiRewards`
  // solo guarda entradas válidas (at>0 + reward no vacío), pero mientras
  // el user escribe "5:" o "5", el input necesita preservar el texto
  // crudo sino se borra en cada keystroke. Sincronizamos los dos: el
  // raw refleja lo tipeado, form.multiRewards guarda lo parseado limpio
  // (que es lo que persiste el backend).
  const [multiRewardsRaw, setMultiRewardsRaw] = useState(
    (card.multiRewards ?? [])
      .map((m) => `${m.at}:${m.reward}`)
      .join(', '),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdvancedColors, setShowAdvancedColors] = useState(false);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [utmLinks, setUtmLinks] = useState(card.utmLinks ?? []);

  useEffect(() => {
    api<any[]>('/locations')
      .then((rows) =>
        setLocations((rows ?? []).map((r) => ({ id: r.id, name: r.name }))),
      )
      .catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        // #24: '' → null (usa el nombre del negocio en el pase).
        walletBrandName: form.walletBrandName.trim() || null,
        description: form.description,
        rewardText: form.rewardText,
        terms: form.terms,
        termsEnabled: form.termsEnabled,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        stampActiveColor: form.stampActiveColor,
        stampInactiveColor: form.stampInactiveColor,
        stampContourColor: form.stampContourColor,
        centerBgColor: form.centerBgColor,
        validUntil: form.validUntil,
        validDaysAfterIssue: form.validDaysAfterIssue,
        locationId: form.locationId,
        howToEarnText: form.howToEarnText,
        businessName: form.businessName,
        rewardDescText: form.rewardDescText,
        stampEarnedMessage: form.stampEarnedMessage,
        rewardEarnedMessage: form.rewardEarnedMessage,
        multiRewards: form.multiRewards,
        activeLinks: form.activeLinks,
        heroImageUrl: form.heroImageUrl,
      };
      if (card.type === 'STAMPS') {
        payload.stampsRequired = form.stampsRequired;
        payload.stampIcon = form.stampIcon;
        payload.minAmountPerStamp = form.minAmountPerStamp;
      }
      if (card.type === 'DISCOUNT') payload.discountPercent = form.discountPercent;
      if (card.type === 'POINTS') payload.pointsPerCurrency = form.pointsPerCurrency;
      await api(`/cards/${card.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast('Tarjeta actualizada', 'success');
      onSaved();
    } catch (e: any) {
      setErr(e.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  function addLink() {
    setForm({
      ...form,
      activeLinks: [...form.activeLinks, { type: 'URL', url: '', label: '' }],
    });
  }
  function updateLink(i: number, patch: Partial<{ type: string; url: string; label: string }>) {
    const next = [...form.activeLinks];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, activeLinks: next });
  }
  function removeLink(i: number) {
    setForm({ ...form, activeLinks: form.activeLinks.filter((_, j) => j !== i) });
  }

  async function addUtm(source: string, welcomeStamps: number | null, welcomePoints: number | null) {
    if (!source.trim()) return;
    const created = await api<any>(`/cards/${card.id}/utm`, {
      method: 'POST',
      body: JSON.stringify({ source, welcomeStamps, welcomePoints }),
    });
    setUtmLinks([created, ...utmLinks]);
  }
  async function deleteUtm(utmId: string) {
    await api(`/cards/${card.id}/utm/${utmId}`, { method: 'DELETE' });
    setUtmLinks(utmLinks.filter((u) => u.id !== utmId));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold m-0">Editar tarjeta</h2>
          <button type="button" onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          {/* #24 (2026-06-16): nombre de marca en el pase, independiente del
              nombre del negocio (que se mantiene para el dashboard). */}
          <div>
            <label className="label">
              Nombre en la tarjeta (wallet)
              <span className="text-mute font-normal ml-1">(opcional)</span>
            </label>
            <input
              className="input"
              value={form.walletBrandName}
              onChange={(e) => setForm({ ...form, walletBrandName: e.target.value })}
              placeholder="Si lo dejas vacío, usa el nombre del negocio"
            />
            <p className="text-[11px] text-mute mt-1">
              Es la marca que aparece en el pase de Apple/Google Wallet. El
              nombre del negocio del dashboard no cambia.
            </p>
          </div>

          <div>
            <label className="label">
              Sede / Ubicación
              <span className="text-mute font-normal ml-1">(opcional)</span>
            </label>
            <select
              className="input"
              value={form.locationId ?? ''}
              onChange={(e) =>
                setForm({ ...form, locationId: e.target.value || null })
              }
            >
              <option value="">Todas las sedes</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Descripción</label>
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Texto interno o explicativo de la tarjeta"
            />
          </div>
          <div>
            <label className="label">Recompensa</label>
            <input
              className="input"
              value={form.rewardText}
              onChange={(e) => setForm({ ...form, rewardText: e.target.value })}
            />
          </div>

          {card.type === 'STAMPS' && (
            <>
              <div>
                <label className="label">Sellos requeridos</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="input max-w-[160px]"
                  value={form.stampsRequired}
                  onChange={(e) =>
                    setForm({ ...form, stampsRequired: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="label">
                  Monto mínimo por sello
                  <span className="text-mute font-normal ml-1">(opcional)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  placeholder="Vacío = sin mínimo"
                  className="input max-w-[200px]"
                  value={form.minAmountPerStamp ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setForm({
                      ...form,
                      minAmountPerStamp: v === '' ? null : Number(v),
                    });
                  }}
                />
                <div className="text-[11px] text-mute mt-1">
                  El scanner solo otorga sello si la compra es mayor o igual
                  a este monto.
                </div>
              </div>
              <div>
                <label className="label">Icono del sello</label>
                <StampIconPicker
                  value={form.stampIcon}
                  onSelect={(icon) => setForm({ ...form, stampIcon: icon })}
                />
              </div>
              <div>
                <label className="label">
                  📸 Imagen de portada de la tarjeta
                </label>
                <p className="text-xs text-mute leading-relaxed -mt-1 mb-2.5">
                  Foto de fondo en Apple y Google Wallet. Los sellos van encima
                  con overlay oscuro. Recomendado <b>800×400 px</b> o más.
                  Si la quitas, vuelve al gradiente con tus colores.
                </p>
                <ImageUploader
                  value={form.heroImageUrl}
                  onChange={(url) => setForm({ ...form, heroImageUrl: url })}
                  folder="card-hero"
                  crop={false}
                />
              </div>
              <div>
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
                    // Parseo defensivo en paralelo: solo entradas válidas
                    // (at>0 + reward no vacío) terminan en form, que es
                    // lo que se persiste al guardar.
                    const parsed = raw
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((s) => {
                        const [at, ...rest] = s.split(':');
                        return { at: Number(at) || 0, reward: rest.join(':').trim() };
                      })
                      .filter((m) => m.at > 0 && m.reward);
                    setForm({ ...form, multiRewards: parsed });
                  }}
                />
                <div className="text-[11px] text-mute mt-1">
                  Sintaxis: <code className="bg-bg2 px-1 rounded">N:premio</code> separados por coma.
                </div>
              </div>
            </>
          )}

          {card.type === 'DISCOUNT' && (
            <div>
              <label className="label">% de descuento</label>
              <input
                type="number"
                min={1}
                max={100}
                className="input"
                value={form.discountPercent}
                onChange={(e) =>
                  setForm({ ...form, discountPercent: Number(e.target.value) })
                }
              />
            </div>
          )}

          {card.type === 'POINTS' && (
            <div>
              <label className="label">Puntos por cada $1.000 de compra</label>
              <input
                type="number"
                step={0.1}
                min={0.1}
                max={100}
                className="input"
                value={Number((form.pointsPerCurrency * 1000).toFixed(2))}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pointsPerCurrency: Number(e.target.value) / 1000,
                  })
                }
              />
            </div>
          )}

          <div className="pt-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
              ✨ Estilos pre-armados
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Color principal</label>
              <input
                type="color"
                className="input h-11 p-1"
                value={form.primaryColor}
                onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Color secundario</label>
              <input
                type="color"
                className="input h-11 p-1"
                value={form.secondaryColor}
                onChange={(e) =>
                  setForm({ ...form, secondaryColor: e.target.value })
                }
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedColors((v) => !v)}
            className="text-xs text-brand hover:underline"
          >
            {showAdvancedColors ? '▲ Ocultar' : '▼ Colores avanzados'}
          </button>
          {showAdvancedColors && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-bg2/40">
              <ModalAdvancedColor
                label="Sello activo"
                value={form.stampActiveColor}
                onChange={(v) => setForm({ ...form, stampActiveColor: v })}
              />
              <ModalAdvancedColor
                label="Sello inactivo"
                value={form.stampInactiveColor}
                onChange={(v) => setForm({ ...form, stampInactiveColor: v })}
              />
              <ModalAdvancedColor
                label="Contorno"
                value={form.stampContourColor}
                onChange={(v) => setForm({ ...form, stampContourColor: v })}
              />
              <ModalAdvancedColor
                label="Fondo central"
                value={form.centerBgColor}
                onChange={(v) => setForm({ ...form, centerBgColor: v })}
              />
            </div>
          )}

          <div className="pt-3 border-t border-line">
            <div className="flex items-center justify-between">
              <label className="label m-0">Términos y condiciones</label>
              <button
                type="button"
                onClick={() => setForm({ ...form, termsEnabled: !form.termsEnabled })}
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
                className="input min-h-[80px] mt-2"
                value={form.terms}
                onChange={(e) => setForm({ ...form, terms: e.target.value })}
                placeholder="Lo que ven los clientes en el reverso de la tarjeta wallet"
              />
            ) : (
              <div className="text-xs text-mute mt-2">
                Esta tarjeta no muestra términos.
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-line">
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

          <div className="pt-3 border-t border-line space-y-2">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold">
              Información (reverso)
            </div>
            {(() => {
              const isCoupon =
                card.type === 'COUPON' ||
                card.type === 'DISCOUNT' ||
                card.type === 'GIFT';
              return (
                <>
                  <input
                    className="input"
                    placeholder={
                      isCoupon
                        ? 'Cómo canjear un cupón'
                        : 'Cómo ganar un sello'
                    }
                    value={form.howToEarnText}
                    onChange={(e) =>
                      setForm({ ...form, howToEarnText: e.target.value })
                    }
                  />
                  <input
                    className="input"
                    placeholder="Nombre de empresa"
                    value={form.businessName}
                    onChange={(e) =>
                      setForm({ ...form, businessName: e.target.value })
                    }
                  />
                  <input
                    className="input"
                    placeholder="Descripción de la recompensa"
                    value={form.rewardDescText}
                    onChange={(e) =>
                      setForm({ ...form, rewardDescText: e.target.value })
                    }
                  />
                  {/* Mensaje de sello ganado: oculto para cupones (no
                      hay "sello en progreso", se canjea una vez). */}
                  {!isCoupon && (
                    <input
                      className="input"
                      placeholder="Mensaje de sello ganado (usa [#] para sellos restantes)"
                      value={form.stampEarnedMessage}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          stampEarnedMessage: e.target.value,
                        })
                      }
                    />
                  )}
                  <input
                    className="input"
                    placeholder={
                      isCoupon
                        ? '¡Felicidades por canjear tu cupón! Empieza a acumular sellos para seguir obteniendo recompensas.'
                        : 'Mensaje de recompensa ganada'
                    }
                    value={form.rewardEarnedMessage}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rewardEarnedMessage: e.target.value,
                      })
                    }
                  />
                </>
              );
            })()}
          </div>

          <div className="pt-3 border-t border-line">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
              Enlaces activos
            </div>
            {form.activeLinks.map((link, i) => (
              <div key={i} className="grid grid-cols-[100px_1fr_1fr_24px] gap-2 mb-2 items-center">
                <select
                  className="input"
                  value={link.type}
                  onChange={(e) => updateLink(i, { type: e.target.value })}
                >
                  <option value="URL">URL</option>
                  <option value="PHONE">Tel</option>
                  <option value="EMAIL">Email</option>
                  <option value="ADDRESS">Dirección</option>
                </select>
                <input
                  className="input"
                  placeholder="https://..."
                  value={link.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Etiqueta"
                  value={link.label}
                  onChange={(e) => updateLink(i, { label: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="text-mute hover:text-bad"
                  aria-label="Quitar"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addLink} className="btn-ghost w-full text-sm">
              + Añadir enlace
            </button>
          </div>

          <div className="pt-3 border-t border-line">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
              Enlaces UTM (campañas)
            </div>
            <UtmManager
              cardId={card.id}
              links={utmLinks}
              onAdd={addUtm}
              onDelete={deleteUtm}
            />
          </div>
        </div>

        {err && (
          <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            <Icon name="check" /> {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalAdvancedColor({
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
          onClick={() => onChange(enabled ? null : '#000000')}
          className="text-[10px] text-brand hover:underline"
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

function UtmManager({
  cardId,
  links,
  onAdd,
  onDelete,
}: {
  cardId: string;
  links: NonNullable<Card['utmLinks']>;
  onAdd: (source: string, welcomeStamps: number | null, welcomePoints: number | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [source, setSource] = useState('');
  const [stamps, setStamps] = useState<string>('');
  const [points, setPoints] = useState<string>('');
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!source.trim()) return;
    setAdding(true);
    try {
      await onAdd(
        source.trim(),
        stamps ? Number(stamps) : null,
        points ? Number(points) : null,
      );
      setSource('');
      setStamps('');
      setPoints('');
    } finally {
      setAdding(false);
    }
  }

  const baseUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/c/u/` : '/c/u/';

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-mute">
        Crea links únicos por canal (Facebook, IG, TikTok, etc) y asigna sellos
        o puntos de bienvenida que el cliente recibe al inscribirse.
      </div>
      {links.map((u) => (
        <div
          key={u.id}
          className="flex items-center justify-between gap-2 p-2 rounded bg-bg2 text-xs"
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{u.source}</div>
            <a
              href={`${baseUrl}${u.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline truncate block"
            >
              {baseUrl}{u.slug}
            </a>
            <div className="text-mute mt-0.5">
              Bonus: {u.welcomeStamps ? `${u.welcomeStamps} sellos ` : ''}
              {u.welcomePoints ? `${u.welcomePoints} puntos ` : ''}
              {!u.welcomeStamps && !u.welcomePoints && 'sin bonus'} ·{' '}
              {u.useCount} usos
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(u.id)}
            className="text-mute hover:text-bad text-lg leading-none"
            aria-label="Eliminar UTM"
          >
            ×
          </button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_70px_70px_auto] gap-2">
        <input
          className="input"
          placeholder="Origen (Ej: Facebook)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <input
          className="input"
          placeholder="Sellos"
          type="number"
          min={1}
          value={stamps}
          onChange={(e) => setStamps(e.target.value)}
        />
        <input
          className="input"
          placeholder="Puntos"
          type="number"
          min={1}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!source.trim() || adding}
          className="btn-primary disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── Tabs ───
function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition -mb-px ${
        active
          ? 'border-ink text-ink'
          : 'border-transparent text-mute hover:text-ink hover:border-line'
      }`}
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// Analytics dashboard granular por card
// ═══════════════════════════════════════════════════════════

type CardMetrics = {
  cardId: string;
  cardType: string;
  kpis: {
    totalPasses: number;
    activePasses: number;
    completedPasses: number;
    revokedPasses: number;
    activeLast30: number;
    inactiveLast30: number;
    newLast7: number;
    totalScans: number;
    scansLast30: number;
    redemptions: number;
    avgScansPerCustomer: number;
  };
  revenue: {
    total: number;
    last30: number;
    avgTicket: number;
    scansWithPurchase: number;
  };
  scansByDay: Array<{ date: string; count: number }>;
  newPassesByDay: Array<{ date: string; count: number }>;
  revenueByDay: Array<{ date: string; amount: number }>;
  funnel: Array<{ key: string; label: string; count: number; pct: number }>;
  topCustomers: Array<{
    customerId: string;
    fullName: string;
    scans: number;
    revenue: number;
    lastVisit: string | null;
  }>;
  topByRevenue: Array<{
    customerId: string;
    fullName: string;
    scans: number;
    revenue: number;
    lastVisit: string | null;
  }>;
  byType: {
    cashback?: { totalAdded: number; totalRedeemed: number; balanceOutstanding: number };
    points?: { totalAdded: number; totalRedeemed: number; balanceOutstanding: number };
    membership?: {
      distribution: Array<{ name: string; count: number }>;
      avgTierProgress: number;
    };
    progress?: { completionRate: number; avgDaysToComplete: number | null };
  };
};

function CardAnalytics({ cardId }: { cardId: string }) {
  const [data, setData] = useState<CardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<CardMetrics>(`/metrics/cards/${cardId}`)
      .then(setData)
      .catch((e) => setErr(e.message || 'Error cargando analytics'))
      .finally(() => setLoading(false));
  }, [cardId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card card-pad">
              <div className="h-3 w-20 bg-bg2 rounded animate-shimmer" />
              <div className="h-7 w-16 bg-bg2 rounded mt-2 animate-shimmer" />
            </div>
          ))}
        </div>
        <div className="card card-pad">
          <div className="h-32 bg-bg2 rounded animate-shimmer" />
        </div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="card card-pad text-center text-mute">
        {err || 'Sin datos.'}
      </div>
    );
  }

  const k = data.kpis;
  const isProgressType =
    data.cardType === 'STAMPS' ||
    data.cardType === 'HYBRID' ||
    data.cardType === 'VISITS';
  const retentionRate =
    k.totalPasses === 0 ? 0 : Math.round((k.activeLast30 / k.totalPasses) * 100);

  return (
    <div className="space-y-5">
      {/* KPIs principales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi2 label="Pases emitidos" value={k.totalPasses} sub={`${k.newLast7} nuevos esta semana`} />
        <Kpi2
          label="Activos"
          value={k.activeLast30}
          accent="ok"
          sub={`${retentionRate}% retención 30d`}
        />
        <Kpi2
          label="Inactivos 30d"
          value={k.inactiveLast30}
          accent={k.inactiveLast30 > k.activeLast30 ? 'warn' : undefined}
          sub="Riesgo de churn"
        />
        <Kpi2
          label="Redenciones"
          value={k.redemptions}
          accent="brand"
          sub={`${k.totalScans} scans totales`}
        />
      </div>

      {/* Gráfico de actividad */}
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold m-0">📈 Actividad últimos 30 días</h3>
            <p className="text-xs text-mute mt-0.5">
              Scans totales · Promedio {k.avgScansPerCustomer} scans/cliente activo
            </p>
          </div>
          <div className="text-xs text-mute">
            <span className="inline-block w-2 h-2 rounded-full bg-brand mr-1.5" />
            Scans
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 ml-3 mr-1.5" />
            Pases nuevos
          </div>
        </div>
        <DualBarChart
          scans={data.scansByDay}
          newPasses={data.newPassesByDay}
        />
      </div>

      {/* Facturación de tarjetas fidelizadas */}
      {data.revenue.scansWithPurchase > 0 && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold m-0">💵 Facturación generada</h3>
              <p className="text-xs text-mute mt-0.5">
                Monto registrado por el operador en cada scan. Solo informativo —
                no afecta la cantidad de sellos.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Kpi2
              label="Facturación 30d"
              value={`$${data.revenue.last30.toLocaleString('es-CO')}`}
              accent="ok"
            />
            <Kpi2
              label="Facturación total"
              value={`$${data.revenue.total.toLocaleString('es-CO')}`}
            />
            <Kpi2
              label="Ticket promedio"
              value={`$${data.revenue.avgTicket.toLocaleString('es-CO')}`}
              accent="brand"
            />
            <Kpi2
              label="Compras registradas"
              value={data.revenue.scansWithPurchase}
              sub="con monto"
            />
          </div>
          <RevenueBarChart data={data.revenueByDay} />
        </div>
      )}

      {/* Top clientes por facturación */}
      {data.topByRevenue && data.topByRevenue.length > 0 && (
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">
            💎 Top clientes por facturación
          </h3>
          <div className="space-y-1.5">
            {data.topByRevenue.map((c, i) => (
              <Link
                key={c.customerId}
                href={`/app/customers/${c.customerId}`}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg2 transition"
              >
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{c.fullName}</div>
                  <div className="text-[11px] text-mute">
                    {c.scans} {c.scans === 1 ? 'scan' : 'scans'}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-bold text-emerald-700">
                    ${c.revenue.toLocaleString('es-CO')}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Embudo (solo progress types) */}
      {isProgressType && data.funnel.length > 0 && (
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">🎯 Embudo de fidelización</h3>
          <div className="space-y-2">
            {data.funnel.map((stage, i) => (
              <div key={stage.key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="font-semibold">{stage.label}</div>
                  <div className="text-mute">
                    <strong className="text-ink">{stage.count}</strong>
                    <span className="ml-2">{stage.pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-bg2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand to-violet-400"
                    style={{ width: `${stage.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {data.byType.progress && (
            <div className="mt-4 pt-3 border-t border-line grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-mute text-[11px] uppercase tracking-wider font-semibold">
                  Completion rate
                </div>
                <div className="text-lg font-bold mt-1">
                  {data.byType.progress.completionRate}%
                </div>
              </div>
              <div>
                <div className="text-mute text-[11px] uppercase tracking-wider font-semibold">
                  Tiempo promedio
                </div>
                <div className="text-lg font-bold mt-1">
                  {data.byType.progress.avgDaysToComplete != null
                    ? `${data.byType.progress.avgDaysToComplete} días`
                    : '—'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats por tipo */}
      {data.byType.cashback && (
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">💰 Cashback</h3>
          <div className="grid grid-cols-3 gap-3">
            <Kpi2
              label="Total emitido"
              value={`$${data.byType.cashback.totalAdded.toLocaleString('es-CO')}`}
            />
            <Kpi2
              label="Canjeado"
              value={`$${data.byType.cashback.totalRedeemed.toLocaleString('es-CO')}`}
              accent="ok"
            />
            <Kpi2
              label="Saldo cliente"
              value={`$${data.byType.cashback.balanceOutstanding.toLocaleString('es-CO')}`}
              accent="amber"
              sub="Pasivo pendiente"
            />
          </div>
        </div>
      )}

      {data.byType.points && (
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">⭐ Puntos</h3>
          <div className="grid grid-cols-3 gap-3">
            <Kpi2 label="Emitidos" value={data.byType.points.totalAdded} />
            <Kpi2
              label="Canjeados"
              value={data.byType.points.totalRedeemed}
              accent="ok"
            />
            <Kpi2
              label="Saldo cliente"
              value={data.byType.points.balanceOutstanding}
              accent="amber"
            />
          </div>
        </div>
      )}

      {data.byType.membership && (
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-1">👑 Distribución por tier</h3>
          <p className="text-xs text-mute mb-3">
            Progreso promedio acumulado: <strong>{data.byType.membership.avgTierProgress}</strong>
          </p>
          <div className="space-y-2">
            {data.byType.membership.distribution.map((d) => {
              const max = Math.max(
                ...data.byType.membership!.distribution.map((x) => x.count),
                1,
              );
              const pct = Math.round((d.count / max) * 100);
              return (
                <div key={d.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold">{d.name}</span>
                    <span className="text-mute">{d.count} clientes</span>
                  </div>
                  <div className="h-2 bg-bg2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 to-amber-600"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top clientes */}
      <div className="card card-pad">
        <h3 className="text-sm font-semibold m-0 mb-3">🏆 Top 10 clientes</h3>
        {data.topCustomers.length === 0 ? (
          <div className="text-sm text-mute text-center py-6">
            Aún no hay actividad registrada.
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.topCustomers.map((c, i) => (
              <Link
                key={c.customerId}
                href={`/app/customers/${c.customerId}`}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg2 transition"
              >
                <div className="w-8 h-8 rounded-full bg-bg2 flex items-center justify-center text-xs font-bold text-mute">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{c.fullName}</div>
                  <div className="text-[11px] text-mute">
                    {c.lastVisit
                      ? `Última visita ${formatRelative(c.lastVisit)}`
                      : 'Sin actividad'}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-bold">{c.scans}</div>
                  <div className="text-[10px] uppercase tracking-wider text-mute">
                    scans
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dual bar chart inline (sin lib externa) ───
function DualBarChart({
  scans,
  newPasses,
}: {
  scans: Array<{ date: string; count: number }>;
  newPasses: Array<{ date: string; count: number }>;
}) {
  const max = Math.max(
    ...scans.map((s) => s.count),
    ...newPasses.map((p) => p.count),
    1,
  );
  // Combinamos por fecha para que las barras estén en pares (scans + new) por día
  const byDate = new Map<string, { scans: number; newPasses: number }>();
  for (const s of scans) {
    byDate.set(s.date, { scans: s.count, newPasses: 0 });
  }
  for (const p of newPasses) {
    const existing = byDate.get(p.date);
    if (existing) existing.newPasses = p.count;
    else byDate.set(p.date, { scans: 0, newPasses: p.count });
  }
  const sorted = Array.from(byDate.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <div className="flex items-end gap-1 h-32">
      {sorted.map(([date, vals]) => {
        const scanH = (vals.scans / max) * 100;
        const newH = (vals.newPasses / max) * 100;
        const day = new Date(date).getDate();
        return (
          <div
            key={date}
            className="flex-1 flex flex-col items-center gap-0.5 group relative"
            title={`${date} · ${vals.scans} scans · ${vals.newPasses} pases`}
          >
            <div className="flex items-end gap-px h-full w-full">
              <div
                className="flex-1 bg-brand/80 rounded-sm group-hover:bg-brand transition"
                style={{ height: `${scanH}%`, minHeight: vals.scans > 0 ? 2 : 0 }}
              />
              <div
                className="flex-1 bg-emerald-500/80 rounded-sm group-hover:bg-emerald-500 transition"
                style={{ height: `${newH}%`, minHeight: vals.newPasses > 0 ? 2 : 0 }}
              />
            </div>
            {sorted.length <= 30 && day % 5 === 0 && (
              <div className="text-[8px] text-mute mt-0.5">{day}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Kpi2 con sub-texto ───
function Kpi2({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: 'brand' | 'ok' | 'amber' | 'warn';
}) {
  const cls: Record<string, string> = {
    brand: 'text-brand',
    ok: 'text-ok',
    amber: 'text-amber-600',
    warn: 'text-rose-500',
  };
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${accent ? cls[accent] : ''}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-mute mt-1">{sub}</div>}
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return 'hace unos minutos';
  if (hours < 24) return `hace ${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  return d.toLocaleDateString('es-CO');
}

// ─── Bar chart de facturación diaria (30d) ───
function RevenueBarChart({ data }: { data: Array<{ date: string; amount: number }> }) {
  const max = Math.max(...data.map((d) => d.amount), 1);
  return (
    <div>
      <div className="flex items-end gap-1 h-24">
        {data.map((d) => {
          const h = (d.amount / max) * 100;
          const day = new Date(d.date).getDate();
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center gap-0.5 group"
              title={`${d.date} · $${d.amount.toLocaleString('es-CO')}`}
            >
              <div
                className="w-full bg-emerald-500/70 group-hover:bg-emerald-500 rounded-sm transition"
                style={{ height: `${h}%`, minHeight: d.amount > 0 ? 2 : 0 }}
              />
              {data.length <= 30 && day % 5 === 0 && (
                <div className="text-[8px] text-mute">{day}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
