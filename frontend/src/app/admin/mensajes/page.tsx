'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getUser } from '@/lib/api';

/**
 * Historial de envíos (SMS / WhatsApp / correo) de la marca: la pantalla que
 * responde «¿se enviaron los recordatorios de cobro?» sin correr scripts.
 *
 * El backend (/admin/message-log) ya aísla por marca: un admin de marca ve
 * solo lo suyo aunque manipule los query params; PLATFORM_OWNER ve todo y
 * puede filtrar por marca. Acá solo decidimos qué controles mostrar.
 *
 * Estados de la tabla: distinguimos SIEMPRE «cargando» / «falló la consulta» /
 * «vacío de verdad». Un vacío falso se lee como «no se envió nada» y eso es
 * peor que un error — por eso el catch guarda el mensaje y muestra Reintentar,
 * nunca deja la lista en [] como si fuera un resultado.
 */

type LogItem = {
  id: string;
  createdAt: string;
  channel: 'SMS' | 'WhatsApp' | 'Email';
  status: 'sent' | 'failed';
  toPhone: string | null;
  toEmail: string | null;
  subject: string | null;
  preview: string | null;
  templateId: string | null;
  templateLabel: string | null;
  feature: string | null;
  tenantId: string | null;
  tenantName: string | null;
  whiteLabelId: string | null;
  whiteLabelName: string | null;
  locationId: string;
  providerMessageId: string | null;
  error: string | null;
};

type ListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: LogItem[];
};

type SummaryResponse = {
  totals: { sent: number; failed: number };
  rows: {
    templateId: string | null;
    templateLabel: string | null;
    channel: string;
    sent: number;
    failed: number;
    lastAt: string | null;
  }[];
};

type FilterOptions = {
  templates: { id: string; label: string }[];
  tenants: { id: string; name: string }[];
  brands: { id: string; name: string; slug: string }[];
};

type Fetch<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; data: T };

const PAGE_SIZE = 50;

function fmtFecha(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 'YYYY-MM-DD' del <input type="date"> → ISO en hora LOCAL del que mira.
 *  new Date('YYYY-MM-DD') sería medianoche UTC y correría el día en América. */
function dayToIso(day: string, endOfDay: boolean): string | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = endOfDay
    ? new Date(y, mo - 1, d, 23, 59, 59, 999)
    : new Date(y, mo - 1, d, 0, 0, 0, 0);
  return date.toISOString();
}

function canalBadge(channel: string) {
  const cls =
    channel === 'Email'
      ? 'badge badge-info'
      : channel === 'WhatsApp'
        ? 'badge badge-ok'
        : 'badge badge-mute';
  return <span className={cls}>{channel}</span>;
}

export default function MensajesPage() {
  const me = getUser();
  const isPlatformOwner = me?.role === 'PLATFORM_OWNER';

  const [tab, setTab] = useState<'historial' | 'resumen'>('historial');

  // Filtros. `q` viaja con debounce (server-side) vía qDebounced.
  const [wl, setWl] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [qRaw, setQRaw] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const [list, setList] = useState<Fetch<ListResponse>>({ state: 'loading' });
  const [summary, setSummary] = useState<Fetch<SummaryResponse>>({ state: 'loading' });
  const [options, setOptions] = useState<Fetch<FilterOptions>>({ state: 'loading' });
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQDebounced(qRaw.trim()), 300);
    return () => clearTimeout(id);
  }, [qRaw]);

  // Buscar distinto = volver a página 1 (la actual puede no existir ya). En el
  // mount setPage(1) con page ya en 1 es un no-op (React hace bail out).
  useEffect(() => {
    setPage(1);
  }, [qDebounced]);

  const hasActiveFilters = !!(
    wl || channel || status || templateId || tenantId || qDebounced || from || to
  );

  // Query string común a historial y resumen.
  const filtersQS = useMemo(() => {
    const p = new URLSearchParams();
    if (wl) p.set('whiteLabelId', wl);
    if (channel) p.set('channel', channel);
    if (status) p.set('status', status);
    if (templateId) p.set('templateId', templateId);
    if (tenantId) p.set('tenantId', tenantId);
    if (qDebounced) p.set('q', qDebounced);
    const fromIso = from ? dayToIso(from, false) : null;
    const toIso = to ? dayToIso(to, true) : null;
    if (fromIso) p.set('from', fromIso);
    if (toIso) p.set('to', toIso);
    return p.toString();
  }, [wl, channel, status, templateId, tenantId, qDebounced, from, to]);

  // Guard contra respuestas fuera de orden: solo la última request "gana".
  const listReq = useRef(0);
  const loadList = useCallback(async () => {
    const id = ++listReq.current;
    setList({ state: 'loading' });
    setExpanded(null);
    try {
      const qs = new URLSearchParams(filtersQS);
      qs.set('page', String(page));
      qs.set('pageSize', String(PAGE_SIZE));
      const data = await api<ListResponse>(`/admin/message-log?${qs}`);
      if (listReq.current === id) setList({ state: 'ok', data });
    } catch (e: any) {
      if (listReq.current === id)
        setList({ state: 'error', message: e?.message || 'Error de conexión' });
    }
  }, [filtersQS, page]);

  const summaryReq = useRef(0);
  const loadSummary = useCallback(async () => {
    const id = ++summaryReq.current;
    setSummary({ state: 'loading' });
    try {
      const data = await api<SummaryResponse>(
        `/admin/message-log/summary?${filtersQS}`,
      );
      if (summaryReq.current === id) setSummary({ state: 'ok', data });
    } catch (e: any) {
      if (summaryReq.current === id)
        setSummary({ state: 'error', message: e?.message || 'Error de conexión' });
    }
  }, [filtersQS]);

  const loadOptions = useCallback(async () => {
    setOptions({ state: 'loading' });
    try {
      const data = await api<FilterOptions>('/admin/message-log/filters');
      setOptions({ state: 'ok', data });
    } catch (e: any) {
      setOptions({ state: 'error', message: e?.message || 'Error de conexión' });
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  // Cada cambio de filtro vuelve a página 1 (la actual puede no existir ya).
  const filterAnd = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const setChannelF = filterAnd(setChannel);
  const setStatusF = filterAnd(setStatus);
  const setTemplateF = filterAnd(setTemplateId);
  const setTenantF = filterAnd(setTenantId);
  const setWlF = filterAnd(setWl);
  const setFromF = filterAnd(setFrom);
  const setToF = filterAnd(setTo);

  function clearFilters() {
    setWl('');
    setChannel('');
    setStatus('');
    setTemplateId('');
    setTenantId('');
    setQRaw('');
    setQDebounced('');
    setFrom('');
    setTo('');
    setPage(1);
  }

  const opts = options.state === 'ok' ? options.data : null;
  const totalCols = isPlatformOwner ? 7 : 6;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Mensajes enviados</h1>
          <p className="text-mute text-sm mt-1 mb-0">
            Todo lo que salió por SMS, WhatsApp y correo — incluidos los que
            fallaron y por qué.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            loadList();
            loadSummary();
          }}
        >
          ↻ Actualizar
        </button>
      </div>

      <div className="tabs w-fit mb-4">
        <button
          type="button"
          className={`tab ${tab === 'historial' ? 'tab-active' : ''}`}
          onClick={() => setTab('historial')}
        >
          Historial
        </button>
        <button
          type="button"
          className={`tab ${tab === 'resumen' ? 'tab-active' : ''}`}
          onClick={() => setTab('resumen')}
        >
          Resumen por automatización
        </button>
      </div>

      {/* Filtros (aplican a las dos pestañas) */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-4 py-2">
          <span className="text-mute2">🔎</span>
          <input
            value={qRaw}
            onChange={(e) => setQRaw(e.target.value)}
            placeholder="Buscar por correo, teléfono, asunto o texto del mensaje…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-mute2"
          />
          {qRaw && (
            <button
              type="button"
              onClick={() => setQRaw('')}
              className="text-mute hover:text-ink text-lg leading-none shrink-0"
              aria-label="Limpiar búsqueda"
            >
              ×
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {isPlatformOwner && (
            <select
              value={wl}
              onChange={(e) => setWlF(e.target.value)}
              className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
            >
              <option value="">Todas las marcas</option>
              {(opts?.brands ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value="none">Sin marca</option>
            </select>
          )}
          <select
            value={channel}
            onChange={(e) => setChannelF(e.target.value)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="">Todos los canales</option>
            <option value="SMS">SMS</option>
            <option value="WhatsApp">WhatsApp</option>
            <option value="Email">Correo</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatusF(e.target.value)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="">Enviados y fallidos</option>
            <option value="sent">Solo enviados</option>
            <option value="failed">Solo fallidos</option>
          </select>
          <select
            value={templateId}
            onChange={(e) => setTemplateF(e.target.value)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2 max-w-[240px]"
          >
            <option value="">Todas las plantillas</option>
            {(opts?.templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={tenantId}
            onChange={(e) => setTenantF(e.target.value)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2 max-w-[220px]"
          >
            <option value="">Todos los negocios</option>
            {(opts?.tenants ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-mute">
            Desde
            <input
              type="date"
              value={from}
              onChange={(e) => setFromF(e.target.value)}
              className="bg-white border border-line rounded-pill px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-mute">
            Hasta
            <input
              type="date"
              value={to}
              onChange={(e) => setToF(e.target.value)}
              className="bg-white border border-line rounded-pill px-3 py-2 text-sm"
            />
          </label>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="btn-link text-xs"
            >
              Limpiar filtros
            </button>
          )}
        </div>
        {options.state === 'error' && (
          <div className="text-xs text-mute">
            No se pudieron cargar las listas de plantillas y negocios.{' '}
            <button type="button" onClick={loadOptions} className="btn-link text-xs">
              Reintentar
            </button>
          </div>
        )}
      </div>

      {/* Totales del rango filtrado — visibles siempre */}
      {summary.state === 'ok' && (
        <div className="flex gap-2 mb-3 text-sm">
          <span className="badge badge-ok">
            Enviados: {summary.data.totals.sent}
          </span>
          <span className="badge badge-bad">
            Fallidos: {summary.data.totals.failed}
          </span>
        </div>
      )}

      {tab === 'historial' ? (
        <HistorialTable
          list={list}
          isPlatformOwner={isPlatformOwner}
          totalCols={totalCols}
          hasActiveFilters={hasActiveFilters}
          expanded={expanded}
          setExpanded={setExpanded}
          page={page}
          setPage={setPage}
          onRetry={loadList}
          onClearFilters={clearFilters}
        />
      ) : (
        <ResumenTable
          summary={summary}
          hasActiveFilters={hasActiveFilters}
          onRetry={loadSummary}
          onClearFilters={clearFilters}
        />
      )}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="text-3xl mb-1">⚠️</div>
      <div className="font-semibold">No se pudo cargar</div>
      <div className="text-mute text-xs mt-1 max-w-md mx-auto break-words">
        {message}
      </div>
      <button type="button" onClick={onRetry} className="btn-primary mt-4">
        Reintentar
      </button>
    </div>
  );
}

function HistorialTable(props: {
  list: Fetch<ListResponse>;
  isPlatformOwner: boolean;
  totalCols: number;
  hasActiveFilters: boolean;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  page: number;
  setPage: (p: number) => void;
  onRetry: () => void;
  onClearFilters: () => void;
}) {
  const {
    list,
    isPlatformOwner,
    totalCols,
    hasActiveFilters,
    expanded,
    setExpanded,
    page,
    setPage,
    onRetry,
    onClearFilters,
  } = props;

  const heads = [
    'Fecha',
    'Canal',
    'Estado',
    'Destino',
    'Plantilla',
    'Negocio',
    ...(isPlatformOwner ? ['Marca'] : []),
  ];

  const data = list.state === 'ok' ? list.data : null;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="card overflow-hidden p-0">
      {/* La tabla scrollea en su contenedor: en móvil no desborda la página */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[820px]">
          <thead className="bg-bg2">
            <tr>
              {heads.map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.state === 'loading' &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line2">
                  <td colSpan={totalCols} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-pulse" />
                  </td>
                </tr>
              ))}

            {list.state === 'error' && (
              <tr>
                <td colSpan={totalCols}>
                  <ErrorBox message={list.message} onRetry={onRetry} />
                </td>
              </tr>
            )}

            {list.state === 'ok' && data!.items.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={totalCols}>
                  <div className="text-3xl mb-1">📭</div>
                  <div className="font-semibold">
                    {hasActiveFilters
                      ? 'Nada coincide con estos filtros'
                      : 'Todavía no hay envíos registrados'}
                  </div>
                  <div className="text-mute text-xs mt-1">
                    {hasActiveFilters ? (
                      <>
                        Probá ampliar el rango de fechas o{' '}
                        <button
                          type="button"
                          onClick={onClearFilters}
                          className="btn-link text-xs"
                        >
                          limpiar los filtros
                        </button>
                        .
                      </>
                    ) : (
                      'Cuando salga un SMS, WhatsApp o correo automático, va a aparecer acá.'
                    )}
                  </div>
                </td>
              </tr>
            )}

            {list.state === 'ok' &&
              data!.items.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <FragmentRow
                    key={r.id}
                    r={r}
                    isOpen={isOpen}
                    isPlatformOwner={isPlatformOwner}
                    totalCols={totalCols}
                    onToggle={() => setExpanded(isOpen ? null : r.id)}
                  />
                );
              })}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line2 text-sm">
          <span className="text-mute text-xs">
            Mostrando {(data.page - 1) * data.pageSize + 1}–
            {Math.min(data.page * data.pageSize, data.total)} de {data.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-default"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ← Anterior
            </button>
            <button
              type="button"
              className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-default"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  r,
  isOpen,
  isPlatformOwner,
  totalCols,
  onToggle,
}: {
  r: LogItem;
  isOpen: boolean;
  isPlatformOwner: boolean;
  totalCols: number;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-t border-line2 hover:bg-bg2/60 cursor-pointer"
        title={isOpen ? 'Ocultar detalle' : 'Ver detalle'}
      >
        <td className="px-4 py-3.5 whitespace-nowrap">{fmtFecha(r.createdAt)}</td>
        <td className="px-4 py-3.5">{canalBadge(r.channel)}</td>
        <td className="px-4 py-3.5">
          {r.status === 'sent' ? (
            <span className="badge badge-ok">Enviado</span>
          ) : (
            <div>
              <span className="badge badge-bad">Falló</span>
              {r.error && (
                <div
                  className="text-bad text-[11px] mt-1 max-w-[220px] truncate"
                  title={r.error}
                >
                  {r.error}
                </div>
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-3.5 max-w-[220px] truncate" title={r.toEmail ?? r.toPhone ?? undefined}>
          {r.toEmail ?? r.toPhone ?? '—'}
        </td>
        <td className="px-4 py-3.5 max-w-[240px]">
          <div className="truncate" title={r.templateLabel ?? undefined}>
            {r.templateLabel ?? '(sin plantilla)'}
          </div>
          {r.feature && (
            <div className="text-mute2 text-[11px]">{r.feature}</div>
          )}
        </td>
        <td className="px-4 py-3.5 max-w-[180px] truncate" title={r.tenantName ?? undefined}>
          {r.tenantName ?? (r.tenantId ? `${r.tenantId.slice(0, 8)}…` : '—')}
        </td>
        {isPlatformOwner && (
          <td className="px-4 py-3.5 max-w-[140px] truncate">
            {r.whiteLabelName ?? (r.whiteLabelId ? `${r.whiteLabelId.slice(0, 8)}…` : '—')}
          </td>
        )}
      </tr>
      {isOpen && (
        <tr className="border-t border-line2 bg-bg2/40">
          <td colSpan={totalCols} className="px-4 py-3.5">
            <div className="grid gap-2 text-[13px] sm:grid-cols-2">
              {r.subject && (
                <div>
                  <span className="text-mute text-xs uppercase tracking-wide">Asunto</span>
                  <div>{r.subject}</div>
                </div>
              )}
              {r.preview && (
                <div className="sm:col-span-2">
                  <span className="text-mute text-xs uppercase tracking-wide">Mensaje</span>
                  <div className="whitespace-pre-wrap break-words">{r.preview}</div>
                </div>
              )}
              {r.error && (
                <div className="sm:col-span-2">
                  <span className="text-mute text-xs uppercase tracking-wide">Motivo del fallo</span>
                  <div className="text-bad break-words">{r.error}</div>
                </div>
              )}
              <div className="text-mute2 text-xs sm:col-span-2">
                Subcuenta: {r.locationId}
                {r.providerMessageId ? ` · ID del proveedor: ${r.providerMessageId}` : ''}
                {r.templateId ? ` · Plantilla: ${r.templateId}` : ''}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ResumenTable({
  summary,
  hasActiveFilters,
  onRetry,
  onClearFilters,
}: {
  summary: Fetch<SummaryResponse>;
  hasActiveFilters: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
}) {
  const heads = ['Plantilla', 'Canal', 'Enviados', 'Fallidos', 'Último envío'];
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[640px]">
          <thead className="bg-bg2">
            <tr>
              {heads.map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.state === 'loading' &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line2">
                  <td colSpan={5} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-pulse" />
                  </td>
                </tr>
              ))}

            {summary.state === 'error' && (
              <tr>
                <td colSpan={5}>
                  <ErrorBox message={summary.message} onRetry={onRetry} />
                </td>
              </tr>
            )}

            {summary.state === 'ok' && summary.data.rows.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={5}>
                  <div className="text-3xl mb-1">📭</div>
                  <div className="font-semibold">
                    {hasActiveFilters
                      ? 'Nada coincide con estos filtros'
                      : 'Todavía no hay envíos registrados'}
                  </div>
                  <div className="text-mute text-xs mt-1">
                    {hasActiveFilters ? (
                      <>
                        Probá ampliar el rango de fechas o{' '}
                        <button
                          type="button"
                          onClick={onClearFilters}
                          className="btn-link text-xs"
                        >
                          limpiar los filtros
                        </button>
                        .
                      </>
                    ) : (
                      'Cuando salga un SMS, WhatsApp o correo automático, va a aparecer acá.'
                    )}
                  </div>
                </td>
              </tr>
            )}

            {summary.state === 'ok' &&
              summary.data.rows.map((row) => (
                <tr
                  key={`${row.templateId ?? 'none'}-${row.channel}`}
                  className="border-t border-line2"
                >
                  <td className="px-4 py-3.5">
                    <div>{row.templateLabel ?? '(sin plantilla)'}</div>
                    {row.templateId && (
                      <div className="text-mute2 text-[11px]">{row.templateId}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">{canalBadge(row.channel)}</td>
                  <td className="px-4 py-3.5">
                    <span className={row.sent > 0 ? 'font-semibold' : 'text-mute2'}>
                      {row.sent}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    {row.failed > 0 ? (
                      <span className="badge badge-bad">{row.failed}</span>
                    ) : (
                      <span className="text-mute2">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {row.lastAt ? fmtFecha(row.lastAt) : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
