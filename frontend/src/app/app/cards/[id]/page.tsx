'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Card = {
  id: string;
  name: string;
  type: 'STAMPS' | 'POINTS' | 'DISCOUNT' | 'MEMBERSHIP';
  rewardText: string;
  terms: string;
  primaryColor: string;
  secondaryColor: string;
  stampsRequired: number | null;
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

          {/* Pases recientes */}
          <div className="card card-pad">
            <div className="font-semibold mb-2 text-sm">
              Pases recientes ({passesOfCard.length})
            </div>
            {passesOfCard.length === 0 ? (
              <div className="text-xs text-mute italic py-3 text-center">
                Aún no se ha emitido ninguno.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-auto">
                {passesOfCard.slice(0, 12).map((p) => (
                  <Link
                    key={p.id}
                    href={`/app/customers/${p.customer.id}`}
                    className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-bg2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {p.customer.fullName}
                      </div>
                      <div className="text-[10px] text-mute font-mono">
                        {p.serialNumber}
                      </div>
                    </div>
                    {card.type === 'STAMPS' && (
                      <div className="text-xs text-mute">
                        {p.stampsCount}/{required}
                      </div>
                    )}
                    <span
                      className={`ml-2 badge text-[10px] ${
                        p.status === 'ACTIVE'
                          ? 'badge-ok'
                          : p.status === 'COMPLETED'
                          ? 'badge-info'
                          : 'badge-mute'
                      }`}
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </Link>
                ))}
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
