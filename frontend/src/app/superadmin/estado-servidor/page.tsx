'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// ===========================================================================
//  Estado del Servidor — centro de monitoreo de infraestructura (/superadmin).
//  Solo PLATFORM_OWNER (el layout ya gatea). Español, estilo de la casa.
//  Consume /api/admin/server-status/* (todo solo-lectura salvo /config y
//  /snapshot). Cada tab carga su endpoint la primera vez que se abre.
// ===========================================================================

type Level = 'ok' | 'warn' | 'high' | 'crit' | 'emergency';

const LEVEL_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  ok: { bg: '#dcfce7', fg: '#15803d', label: 'Normal' },
  warn: { bg: '#fef3c7', fg: '#b45309', label: 'Advertencia' },
  high: { bg: '#ffedd5', fg: '#c2410c', label: 'Alta prioridad' },
  crit: { bg: '#fee2e2', fg: '#b91c1c', label: 'Crítico' },
  emergency: { bg: '#fecaca', fg: '#7f1d1d', label: 'Emergencia' },
};
const SEMAFORO_COLOR: Record<string, string> = {
  verde: '#16a34a',
  amarillo: '#eab308',
  naranja: '#f97316',
  rojo: '#dc2626',
};

const CARD: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e7e9ec',
  boxShadow: '0 1px 2px rgba(16,24,40,.04)',
};

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('es-MX');
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

const TABS = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'postgres', label: 'PostgreSQL' },
  { key: 'tablas', label: 'Tablas' },
  { key: 'marcas', label: 'Marcas' },
  { key: 'servicios', label: 'Servicios' },
  { key: 'pesados', label: 'Datos pesados' },
  { key: 'config', label: 'Configuración' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function EstadoServidorPage() {
  const [tab, setTab] = useState<TabKey>('resumen');
  const [overview, setOverview] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [snapBusy, setSnapBusy] = useState(false);

  // caches por tab
  const [tables, setTables] = useState<any>(null);
  const [brands, setBrands] = useState<any>(null);
  const [services, setServices] = useState<any>(null);
  const [heavy, setHeavy] = useState<any>(null);
  const [slow, setSlow] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);

  async function loadOverview() {
    setErr(null);
    try {
      setOverview(await api('/admin/server-status/overview'));
    } catch (e: any) {
      setErr(e?.message ?? 'Error cargando el panel');
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  // Carga perezosa por tab.
  useEffect(() => {
    if (tab === 'tablas' && !tables) api('/admin/server-status/tables').then(setTables).catch(() => null);
    if (tab === 'marcas' && !brands) api('/admin/server-status/brands').then(setBrands).catch(() => null);
    if (tab === 'servicios' && !services) api('/admin/server-status/services').then(setServices).catch(() => null);
    if (tab === 'pesados' && !heavy) api('/admin/server-status/heavy-data').then(setHeavy).catch(() => null);
    if (tab === 'postgres' && !slow) api('/admin/server-status/slow-queries').then(setSlow).catch(() => null);
    if (tab === 'config' && !config) api('/admin/server-status/config').then(setConfig).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function takeSnapshot() {
    setSnapBusy(true);
    try {
      await api('/admin/server-status/snapshot', { method: 'POST' });
      await loadOverview();
      alert('Snapshot guardado. La proyección se afina con cada snapshot diario.');
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo tomar el snapshot');
    } finally {
      setSnapBusy(false);
    }
  }

  const sem = overview?.semaforo;
  const semColor = sem ? SEMAFORO_COLOR[sem.color] ?? '#9aa4af' : '#9aa4af';

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
            Estado del Servidor
          </h1>
          <div className="text-sm mt-1" style={{ color: '#6b7785' }}>
            Monitoreo de infraestructura · {overview ? `actualizado ${fmtDate(overview.generatedAt)}` : 'cargando…'}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadOverview}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold"
            style={{ background: 'white', border: '1px solid #d7dbe0', color: '#2b3a30' }}
          >
            ↻ Actualizar
          </button>
          <button
            onClick={takeSnapshot}
            disabled={snapBusy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm font-bold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(180deg, #28c95f, #16a34a)', boxShadow: '0 2px 6px rgba(22,163,74,.35)' }}
          >
            {snapBusy ? 'Guardando…' : '📸 Tomar snapshot'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-[14px] p-4 text-sm mb-4" style={{ ...CARD, borderColor: '#fecaca', color: '#b91c1c' }}>
          {err}
        </div>
      )}

      {/* Semáforo grande */}
      {sem && (
        <div className="rounded-[14px] p-5 mb-5 flex items-center gap-4" style={{ ...CARD, borderLeft: `6px solid ${semColor}` }}>
          <div className="w-14 h-14 rounded-full flex-none" style={{ background: semColor, boxShadow: `0 0 0 6px ${semColor}22` }} />
          <div>
            <div className="text-[12px] font-bold uppercase" style={{ letterSpacing: 0.8, color: '#9aa4af' }}>
              Estado general
            </div>
            <div className="text-[22px] font-extrabold" style={{ color: '#16241c' }}>
              {sem.label}
            </div>
          </div>
          {overview?.alerts?.length > 0 && (
            <div className="ml-auto text-sm font-semibold" style={{ color: semColor }}>
              {overview.alerts.length} alerta{overview.alerts.length === 1 ? '' : 's'} activa{overview.alerts.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {TABS.map((tt) => {
          const active = tab === tt.key;
          return (
            <button
              key={tt.key}
              onClick={() => setTab(tt.key)}
              className="px-3.5 py-2 rounded-[10px] text-sm font-semibold transition"
              style={active ? { background: '#16241c', color: 'white' } : { background: 'white', color: '#2b3a30', border: '1px solid #d7dbe0' }}
            >
              {tt.label}
            </button>
          );
        })}
      </div>

      {/* Contenido */}
      {tab === 'resumen' && <ResumenTab o={overview} />}
      {tab === 'postgres' && <PostgresTab o={overview} slow={slow} />}
      {tab === 'tablas' && <TablasTab data={tables} />}
      {tab === 'marcas' && <MarcasTab data={brands} />}
      {tab === 'servicios' && <ServiciosTab data={services} />}
      {tab === 'pesados' && <PesadosTab data={heavy} />}
      {tab === 'config' && <ConfigTab data={config} onSaved={(c) => { setConfig(c); loadOverview(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- helpers UI

function Loading() {
  return <div className="text-sm" style={{ color: '#6b7785' }}>Cargando…</div>;
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-bold uppercase mb-3" style={{ letterSpacing: 0.8, color: '#9aa4af' }}>{children}</div>;
}
function LevelPill({ level }: { level?: string }) {
  const s = LEVEL_STYLE[level ?? 'ok'] ?? LEVEL_STYLE.ok;
  return (
    <span className="inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full uppercase" style={{ background: s.bg, color: s.fg, letterSpacing: 0.4 }}>
      {s.label}
    </span>
  );
}
function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 rounded-full overflow-hidden mt-2" style={{ background: '#eef0f2' }}>
      <div className="h-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}
function MetricCard({ label, value, sub, level, pct }: { label: string; value: string; sub?: string; level?: string; pct?: number }) {
  const color = LEVEL_STYLE[level ?? 'ok']?.fg ?? '#16a34a';
  return (
    <div className="rounded-[14px] p-5" style={CARD}>
      <div className="flex items-start justify-between mb-1">
        <div className="text-[11.5px] font-bold uppercase" style={{ color: '#9aa4af', letterSpacing: 0.5 }}>{label}</div>
        {level && <LevelPill level={level} />}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, color: '#16241c' }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: '#6b7785' }}>{sub}</div>}
      {pct !== undefined && <Bar pct={pct} color={color} />}
    </div>
  );
}

// ------------------------------------------------------------------ Resumen

function ResumenTab({ o }: { o: any }) {
  if (!o) return <Loading />;
  const db = o.database, mem = o.memory, cpu = o.cpu, conn = o.connections, st = o.storage, proj = o.projection, gr = o.growth;
  return (
    <div>
      <SectionLabel>Métricas principales</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Base de datos"
          value={`${db.percent}%`}
          sub={`${db.usedPretty} de ${db.limitPretty ?? '—'} · ${capLabel(db.capacitySource)}`}
          level={db.level}
          pct={db.percent}
        />
        <MetricCard
          label="Memoria (RAM)"
          value={`${mem.percent}%`}
          sub={`${mem.usedPretty} de ${mem.limitPretty ?? '—'} · ${mem.source}`}
          level={mem.level}
          pct={mem.percent}
        />
        <MetricCard
          label="CPU"
          value={cpu.available ? `${cpu.vcpu} vCPU` : '—'}
          sub={cpu.available ? 'Railway API' : (cpu.note ?? 'requiere token')}
        />
        <MetricCard
          label="Conexiones"
          value={`${conn.active}/${conn.max}`}
          sub={`${conn.percent}% del máximo`}
          level={conn.level}
          pct={conn.percent}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Uptime backend" value={humanUptime(o.uptime?.backendSeconds)} sub={`${o.uptime?.nodeVersion ?? ''} · ${o.uptime?.env ?? ''}`} />
        <MetricCard label="Storage (R2)" value={st?.estimatePretty ?? '—'} sub={`${fmt(st?.fileCount)} archivos · estimado`} />
        <MetricCard label="Último VACUUM" value={fmtDate(o.maintenance?.lastVacuum)} />
        <MetricCard label="Último ANALYZE" value={fmtDate(o.maintenance?.lastAnalyze)} />
      </div>

      {/* Proyección */}
      <SectionLabel>Crecimiento y proyección</SectionLabel>
      <div className="rounded-[14px] p-5 mb-6" style={CARD}>
        {proj?.status === 'ok' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs" style={{ color: '#9aa4af' }}>Crecimiento diario</div>
              <div className="text-lg font-bold" style={{ color: '#16241c' }}>{gr?.perDayPretty ?? '—'}/día</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: '#9aa4af' }}>Llega al 90%</div>
              <div className="text-lg font-bold" style={{ color: proj.daysTo90 <= 30 ? '#c2410c' : '#16241c' }}>~{proj.daysTo90} días</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: '#9aa4af' }}>Se llena (100%)</div>
              <div className="text-lg font-bold" style={{ color: '#16241c' }}>{fmtDate(proj.fullDate)}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm" style={{ color: '#6b7785' }}>
            {proj?.message ?? 'Sin datos suficientes para proyectar.'} {gr?.samples ? `(${gr.samples} snapshot${gr.samples === 1 ? '' : 's'})` : ''}
          </div>
        )}
      </div>

      {/* Alertas */}
      {o.alerts?.length > 0 && (
        <>
          <SectionLabel>Alertas activas</SectionLabel>
          <div className="space-y-2 mb-6">
            {o.alerts.map((a: any, i: number) => {
              const s = LEVEL_STYLE[a.level] ?? LEVEL_STYLE.warn;
              return (
                <div key={i} className="rounded-[14px] p-4" style={{ ...CARD, borderLeft: `4px solid ${s.fg}` }}>
                  <div className="font-bold text-sm" style={{ color: '#16241c' }}>{a.title}</div>
                  <div className="text-sm mt-1" style={{ color: '#2b3a30' }}>{a.body}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Recomendaciones */}
      <SectionLabel>Recomendaciones</SectionLabel>
      <div className="space-y-2 mb-6">
        {o.recommendations?.map((r: any, i: number) => (
          <div key={i} className="rounded-[14px] p-4 flex items-start gap-3" style={CARD}>
            <span>{r.level === 'crit' ? '🔴' : r.level === 'warn' ? '🟠' : '💡'}</span>
            <div className="text-sm" style={{ color: '#2b3a30' }}>{r.text}</div>
          </div>
        ))}
      </div>

      {/* Nota Railway */}
      {o.railway?.note && (
        <div className="rounded-[14px] p-4 text-sm" style={{ ...CARD, borderColor: '#fde68a', background: '#fffbeb', color: '#92400e' }}>
          ⚙️ {o.railway.note}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Postgres

function PostgresTab({ o, slow }: { o: any; slow: any }) {
  if (!o) return <Loading />;
  const db = o.database, conn = o.connections;
  return (
    <div>
      <SectionLabel>Base de datos PostgreSQL</SectionLabel>
      <div className="rounded-[14px] p-5 mb-6" style={CARD}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-lg" style={{ color: '#16241c' }}>{db.usedPretty} <span className="text-sm font-normal" style={{ color: '#9aa4af' }}>de {db.limitPretty ?? '—'}</span></div>
          <LevelPill level={db.level} />
        </div>
        <Bar pct={db.percent} color={LEVEL_STYLE[db.level]?.fg ?? '#16a34a'} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
          <KV k="Uso" v={`${db.percent}%`} />
          <KV k="Disponible" v={db.availableBytes != null ? prettyLocal(db.availableBytes) : '—'} />
          <KV k="Tamaño lógico (pg)" v={db.logicalSizePretty} />
          <KV k="Capacidad" v={`${db.limitPretty ?? '—'} (${capLabel(db.capacitySource)})`} />
          <KV k="Conexiones" v={`${conn.active}/${conn.max}`} />
          <KV k="Último VACUUM" v={fmtDate(o.maintenance?.lastVacuum)} />
          <KV k="Último ANALYZE" v={fmtDate(o.maintenance?.lastAnalyze)} />
          <KV k="Crecimiento/día" v={o.growth?.perDayPretty ?? '—'} />
        </div>
      </div>

      <SectionLabel>Consultas lentas</SectionLabel>
      <div className="rounded-[14px] p-5" style={CARD}>
        {!slow ? (
          <Loading />
        ) : !slow.available ? (
          <div className="text-sm" style={{ color: '#6b7785' }}>{slow.reason}</div>
        ) : slow.queries.length === 0 ? (
          <div className="text-sm" style={{ color: '#6b7785' }}>Sin consultas lentas registradas.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #eef0f2', color: '#9aa4af' }} className="text-[11px] uppercase">
                  <th className="py-2 pr-3">Consulta</th>
                  <th className="py-2 px-2">Llamadas</th>
                  <th className="py-2 px-2">Prom (ms)</th>
                </tr>
              </thead>
              <tbody>
                {slow.queries.map((q: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f4f5f7' }}>
                    <td className="py-2 pr-3 font-mono text-[11px]" style={{ color: '#2b3a30', maxWidth: 480 }}>{q.query}</td>
                    <td className="py-2 px-2" style={{ color: '#6b7785' }}>{fmt(q.calls)}</td>
                    <td className="py-2 px-2 font-semibold" style={{ color: q.meanMs > 500 ? '#b91c1c' : '#16241c' }}>{q.meanMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Tablas

function TablasTab({ data }: { data: any }) {
  if (!data) return <Loading />;
  return (
    <div>
      <SectionLabel>Tablas que más consumen ({data.totals?.tableCount} tablas · índices {data.totals?.indexPretty})</SectionLabel>
      <div className="rounded-[14px] overflow-hidden" style={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ background: '#fafbfc', borderBottom: '1px solid #eef0f2', color: '#9aa4af' }} className="text-[11px] uppercase">
                <th className="py-2.5 px-4">Tabla</th>
                <th className="py-2.5 px-2">Total</th>
                <th className="py-2.5 px-2">Índices</th>
                <th className="py-2.5 px-2">Filas</th>
                <th className="py-2.5 px-2">VACUUM</th>
              </tr>
            </thead>
            <tbody>
              {data.tables?.map((t: any) => (
                <tr key={t.name} style={{ borderBottom: '1px solid #f4f5f7' }}>
                  <td className="py-2 px-4 font-semibold" style={{ color: '#16241c' }}>{t.name}</td>
                  <td className="py-2 px-2 font-semibold" style={{ color: '#2b3a30' }}>{t.totalPretty}</td>
                  <td className="py-2 px-2" style={{ color: '#6b7785' }}>{t.indexPretty}</td>
                  <td className="py-2 px-2" style={{ color: '#6b7785' }}>{fmt(t.rows)}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: '#9aa4af' }}>{fmtDate(t.lastVacuum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Marcas

function MarcasTab({ data }: { data: any }) {
  if (!data) return <Loading />;
  return (
    <div>
      <SectionLabel>Consumo por marca blanca · {fmt(data.grandRows)} registros totales</SectionLabel>
      <div className="rounded-[14px] overflow-hidden" style={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ background: '#fafbfc', borderBottom: '1px solid #eef0f2', color: '#9aa4af' }} className="text-[11px] uppercase">
                <th className="py-2.5 px-4">Marca</th>
                <th className="py-2.5 px-2">Negocios</th>
                <th className="py-2.5 px-2">Clientes</th>
                <th className="py-2.5 px-2">Pedidos</th>
                <th className="py-2.5 px-2">Registros</th>
                <th className="py-2.5 px-2">% BD</th>
                <th className="py-2.5 px-2">Est.</th>
              </tr>
            </thead>
            <tbody>
              {data.brands?.map((b: any) => (
                <tr key={b.id} style={{ borderBottom: '1px solid #f4f5f7' }}>
                  <td className="py-2 px-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.primaryColor }} />
                      <span className="font-semibold" style={{ color: '#16241c' }}>{b.name}</span>
                    </span>
                  </td>
                  <td className="py-2 px-2" style={{ color: '#2b3a30' }}>{fmt(b.businesses)}</td>
                  <td className="py-2 px-2" style={{ color: '#6b7785' }}>{fmt(b.customers)}</td>
                  <td className="py-2 px-2" style={{ color: '#6b7785' }}>{fmt(b.orders)}</td>
                  <td className="py-2 px-2 font-semibold" style={{ color: '#2b3a30' }}>{fmt(b.rowsTotal)}</td>
                  <td className="py-2 px-2" style={{ color: '#6b7785' }}>{b.sharePct}%</td>
                  <td className="py-2 px-2" style={{ color: '#9aa4af' }}>{b.estPretty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-xs mt-2" style={{ color: '#9aa4af' }}>{data.note}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Servicios

function ServiciosTab({ data }: { data: any }) {
  if (!data) return <Loading />;
  const statusColor: Record<string, string> = { operativo: '#16a34a', lento: '#b45309', caido: '#b91c1c' };
  return (
    <div>
      <SectionLabel>Salud de servicios</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        {data.services?.map((s: any) => (
          <div key={s.key} className="rounded-[14px] p-4 flex items-center gap-3" style={CARD}>
            <span className="w-3 h-3 rounded-full flex-none" style={{ background: statusColor[s.status] ?? '#9aa4af' }} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm" style={{ color: '#16241c' }}>{s.name}</div>
              <div className="text-xs" style={{ color: '#9aa4af' }}>{s.detail ?? ''}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold" style={{ color: statusColor[s.status] ?? '#9aa4af' }}>{s.status}</div>
              <div className="text-xs" style={{ color: '#9aa4af' }}>{s.latencyMs} ms</div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs" style={{ color: '#9aa4af' }}>{data.note}</div>
    </div>
  );
}

// ------------------------------------------------------------- Datos pesados

function PesadosTab({ data }: { data: any }) {
  if (!data) return <Loading />;
  if (!data.available) return <div className="rounded-[14px] p-5 text-sm" style={{ ...CARD, color: '#6b7785' }}>{data.reason}</div>;
  return (
    <div>
      <SectionLabel>Columnas más pesadas (posibles blobs / base64 en Postgres)</SectionLabel>
      <div className="rounded-[14px] overflow-hidden" style={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ background: '#fafbfc', borderBottom: '1px solid #eef0f2', color: '#9aa4af' }} className="text-[11px] uppercase">
                <th className="py-2.5 px-4">Tabla</th>
                <th className="py-2.5 px-2">Columna</th>
                <th className="py-2.5 px-2">Tipo</th>
                <th className="py-2.5 px-2">Ancho prom.</th>
                <th className="py-2.5 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.findings?.map((f: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid #f4f5f7', background: f.suspect ? '#fffbeb' : undefined }}>
                  <td className="py-2 px-4 font-semibold" style={{ color: '#16241c' }}>{f.table}</td>
                  <td className="py-2 px-2 font-mono text-xs" style={{ color: '#2b3a30' }}>{f.column}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: '#6b7785' }}>{f.type}</td>
                  <td className="py-2 px-2 font-semibold" style={{ color: f.suspect ? '#c2410c' : '#2b3a30' }}>{f.avgWidthPretty}</td>
                  <td className="py-2 px-2">{f.suspect && <span className="text-xs font-bold" style={{ color: '#c2410c' }}>⚠ revisar</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-xs mt-2" style={{ color: '#9aa4af' }}>{data.note}</div>
    </div>
  );
}

// ------------------------------------------------------------------- Config

function ConfigTab({ data, onSaved }: { data: any; onSaved: (c: any) => void }) {
  const [gb, setGb] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setGb(data.dbLimitBytes ? String(Math.round(data.dbLimitBytes / (1024 * 1024 * 1024))) : '');
      setEmail(data.alertEmail ?? '');
    }
  }, [data]);

  if (!data) return <Loading />;
  const rw = data.railway ?? {};

  async function save() {
    setBusy(true);
    try {
      const body: any = {};
      body.dbLimitBytes = gb.trim() ? Math.round(parseFloat(gb) * 1024 * 1024 * 1024) : 0;
      body.alertEmail = email.trim();
      const c = await api('/admin/server-status/config', { method: 'PATCH', body: JSON.stringify(body) });
      onSaved(c);
      alert('Configuración guardada.');
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <SectionLabel>Configuración</SectionLabel>
      <div className="rounded-[14px] p-5 space-y-4" style={CARD}>
        <div>
          <label className="text-sm font-semibold" style={{ color: '#16241c' }}>Capacidad de la base de datos (GB)</label>
          <input value={gb} onChange={(e) => setGb(e.target.value)} placeholder="ej. 10" inputMode="decimal"
            className="mt-1 w-full rounded-[10px] px-3 py-2 text-sm" style={{ border: '1px solid #d7dbe0' }} />
          <div className="text-xs mt-1" style={{ color: '#9aa4af' }}>
            Vacío = usar la capacidad real de Railway (si hay token) o el estimado por defecto.
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold" style={{ color: '#16241c' }}>Email para alertas de capacidad</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alertas@tudominio.com" inputMode="email"
            className="mt-1 w-full rounded-[10px] px-3 py-2 text-sm" style={{ border: '1px solid #d7dbe0' }} />
        </div>
        <button onClick={save} disabled={busy}
          className="px-4 py-2 rounded-[10px] text-sm font-bold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(180deg, #28c95f, #16a34a)' }}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      <SectionLabel><span className="block mt-6">Railway API</span></SectionLabel>
      <div className="rounded-[14px] p-5 text-sm" style={CARD}>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: rw.hasToken ? '#16a34a' : '#b45309' }} />
          <span className="font-semibold" style={{ color: '#16241c' }}>
            {rw.hasToken ? `Token activo (${rw.tokenKind})` : 'Sin token — capacidad/CPU/backups estimados'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: '#6b7785' }}>
          <KV k="Project ID" v={rw.projectId ?? '—'} />
          <KV k="Environment ID" v={rw.environmentId ?? '—'} />
          <KV k="Service ID (backend)" v={rw.backendServiceId ?? '—'} />
          <KV k="Postgres Service ID" v={rw.postgresServiceId ?? '—'} />
        </div>
        {!rw.hasToken && (
          <div className="text-xs mt-3" style={{ color: '#9aa4af' }}>
            Para datos reales de capacidad de volumen y CPU, seteá <code>RAILWAY_API_TOKEN</code> (y <code>RAILWAY_POSTGRES_SERVICE_ID</code>) en las variables de entorno del backend en Railway.
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- misc

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs" style={{ color: '#9aa4af' }}>{k}</div>
      <div className="font-semibold" style={{ color: '#2b3a30' }}>{v}</div>
    </div>
  );
}
function capLabel(src?: string) {
  return src === 'railway' ? 'Railway (real)' : src === 'manual' ? 'configurado' : 'estimado';
}
function humanUptime(sec?: number) {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function prettyLocal(bytes: number) {
  if (!isFinite(bytes)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 2 : 1)} ${u[i]}`;
}
