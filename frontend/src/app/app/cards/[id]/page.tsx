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

type Card = {
  id: string;
  name: string;
  description?: string;
  type: 'STAMPS' | 'POINTS' | 'DISCOUNT' | 'MEMBERSHIP';
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
  discountPercent?: number | null;
  pointsPerCurrency?: number | string | null;
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allPasses, setAllPasses] = useState<Pass[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [issuedPass, setIssuedPass] = useState<any>(null);
  const [search, setSearch] = useState('');

  async function load() {
    try {
      const [c, cs, ps] = await Promise.all([
        api<Card>(`/cards/${id}`),
        api<Customer[]>('/customers'),
        api<Pass[]>('/passes'),
      ]);
      setCard(c);
      setCustomers(cs);
      setAllPasses(ps);
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
  const filteredPasses = useMemo(() => {
    const q = passSearch.trim().toLowerCase();
    if (!q) return passesOfCard;
    return passesOfCard.filter((p) =>
      p.customer.fullName.toLowerCase().includes(q),
    );
  }, [passesOfCard, passSearch]);

  async function changeStamps(passId: string, action: 'STAMP' | 'REFUND', amount = 1) {
    setStampingPassId(passId);
    try {
      await api('/stamps', {
        method: 'POST',
        body: JSON.stringify({ passId, action, amount }),
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

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="Pases emitidos" value={stats.total} />
        <Kpi label="Activos" value={stats.active} accent="brand" />
        <Kpi label="Completados" value={stats.completed} accent="ok" />
        <Kpi label="Sellos totales" value={stats.stampsTotal} accent="amber" />
      </div>

      <EnrollLinkCard cardId={String(id)} cardName={card.name} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Preview grande */}
        <div className="space-y-4">
          <div
            className="rounded-2xl p-6 text-white shadow-md2 relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${card.primaryColor}, ${card.secondaryColor})`,
              minHeight: 280,
            }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">
              {card.type}
            </div>
            <div className="text-2xl font-bold mt-1.5 leading-tight">
              {card.name}
            </div>

            {card.type === 'STAMPS' && (
              <>
                <div className="mt-6">
                  <div className="text-[11px] uppercase tracking-[0.18em] opacity-80 mb-2">
                    Progreso
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: required }).map((_, i) => {
                      // Mostramos los primeros 3 sellos rellenos como demo
                      const filled = i < Math.min(3, required);
                      return (
                        <span
                          key={i}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{
                            background: filled ? '#fff' : 'rgba(255,255,255,0.15)',
                            border:
                              '1.5px solid ' +
                              (filled ? '#fff' : 'rgba(255,255,255,0.4)'),
                            color: filled ? card.primaryColor : '#fff',
                          }}
                        >
                          {i + 1}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="text-[11px] uppercase tracking-[0.18em] opacity-80 mt-5">
                  Recompensa al completar
                </div>
                <div className="text-base font-semibold">
                  {card.rewardText || `Premio al completar ${required} sellos`}
                </div>
              </>
            )}

            {card.type !== 'STAMPS' && (
              <div className="mt-6">
                <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">
                  Recompensa
                </div>
                <div className="text-base font-semibold">
                  {card.rewardText || '—'}
                </div>
              </div>
            )}
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
    discountPercent: card.discountPercent ?? 10,
    pointsPerCurrency: Number(card.pointsPerCurrency ?? 0.001),
    stampIcon: card.stampIcon ?? '☕',
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
      };
      if (card.type === 'STAMPS') {
        payload.stampsRequired = form.stampsRequired;
        payload.stampIcon = form.stampIcon;
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
                <label className="label">Icono del sello</label>
                <StampIconPicker
                  value={form.stampIcon}
                  onSelect={(icon) => setForm({ ...form, stampIcon: icon })}
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
                  value={form.multiRewards.map((m) => `${m.at}:${m.reward}`).join(', ')}
                  onChange={(e) => {
                    const parsed = e.target.value
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
            <input
              className="input"
              placeholder="Cómo ganar un sello"
              value={form.howToEarnText}
              onChange={(e) => setForm({ ...form, howToEarnText: e.target.value })}
            />
            <input
              className="input"
              placeholder="Nombre de empresa"
              value={form.businessName}
              onChange={(e) => setForm({ ...form, businessName: e.target.value })}
            />
            <input
              className="input"
              placeholder="Descripción de la recompensa"
              value={form.rewardDescText}
              onChange={(e) => setForm({ ...form, rewardDescText: e.target.value })}
            />
            <input
              className="input"
              placeholder="Mensaje de sello ganado (usa [#] para sellos restantes)"
              value={form.stampEarnedMessage}
              onChange={(e) => setForm({ ...form, stampEarnedMessage: e.target.value })}
            />
            <input
              className="input"
              placeholder="Mensaje de recompensa ganada"
              value={form.rewardEarnedMessage}
              onChange={(e) => setForm({ ...form, rewardEarnedMessage: e.target.value })}
            />
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
