'use client';
/**
 * Automatizaciones del negocio: los flujos del constructor visual.
 *
 * Las predeterminadas (bienvenida, cumpleaños…) viven en /app/automations y
 * no se tocan desde aquí: esta pantalla solo las enlaza y cuenta, para que el
 * negocio sepa que siguen funcionando junto a sus flujos.
 */
import { PanelHeader } from '@/components/PanelHeader';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { useTextos } from '@/components/flujos-visuales/textos';
import { IconoFlujo, PildoraEstado } from '@/components/flujos-visuales/IconoFlujo';

type Fila = {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused';
  triggerType: string;
  triggerDays: number | null;
  schemaVersion: number;
  pasos: number;
  createdAt: string;
  lastActivityAt: string | null;
  stats: { inscritos: number; enCurso: number; enviados: number; fallidos: number };
};

type Plantilla = {
  key: string;
  categoria: string;
  icono: string;
  nombre: string;
  descripcion: string;
  objetivo: string;
  triggerType: string;
  pasos: number;
};

type Catalogo = { plantillas: Plantilla[]; predeterminadasActivas: number };

type Pestana = 'todas' | 'active' | 'draft' | 'paused' | 'plantillas';

const fecha = (s: string | null, locale: string) =>
  s ? new Date(s).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

export default function AutomatizacionesPage() {
  const t = useTextos();
  const router = useRouter();
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [pestana, setPestana] = useState<Pestana>('todas');
  const [eligiendo, setEligiendo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'es';

  async function cargar() {
    try {
      const [f, c] = await Promise.all([api<Fila[]>('/automations/flujos'), api<Catalogo>('/automations/flujos/catalogo')]);
      setFilas(f);
      setCat(c);
    } catch (e: any) {
      setFilas([]);
      toast(e.message, 'error');
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  async function crear(plantilla: string) {
    setOcupado(plantilla);
    try {
      const wf = await api<{ id: string }>('/automations/flujos', {
        method: 'POST',
        body: JSON.stringify({ plantilla }),
      });
      router.push(`/app/automations/workflows/${wf.id}`);
    } catch (e: any) {
      toast(e.message, 'error');
      setOcupado(null);
    }
  }

  async function accion(f: Fila, que: 'activar' | 'pausar' | 'duplicar' | 'eliminar') {
    if (que === 'eliminar' && !window.confirm(t.confirmarEliminar(f.name))) return;
    if (que === 'activar') {
      // Activar valida en el editor (lista de errores clicable): se va allí.
      router.push(`/app/automations/workflows/${f.id}?activar=1`);
      return;
    }
    setOcupado(f.id);
    try {
      if (que === 'eliminar') {
        await api(`/automations/flujos/${f.id}`, { method: 'DELETE' });
        toast(t.eliminado, 'success');
      } else if (que === 'pausar') {
        await api(`/automations/flujos/${f.id}/pausar`, { method: 'POST' });
        toast(t.pausado, 'success');
      } else {
        await api(`/automations/flujos/${f.id}/duplicar`, { method: 'POST' });
        toast(t.duplicado, 'success');
      }
      await cargar();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setOcupado(null);
    }
  }

  const visibles = useMemo(
    () => (filas ?? []).filter((f) => pestana === 'todas' || f.status === pestana),
    [filas, pestana],
  );
  const cuenta = (s: Pestana) => (filas ?? []).filter((f) => s === 'todas' || f.status === s).length;

  const pestanas: Array<[Pestana, string]> = [
    ['todas', t.todas],
    ['active', t.activas],
    ['draft', t.borradores],
    ['paused', t.pausadas],
    ['plantillas', t.plantillas],
  ];

  return (
    <div>
      <PanelHeader tutorial="automatizaciones" title={t.titulo} subtitle={t.subtitulo} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1" role="tablist">
          {pestanas.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={pestana === k}
              onClick={() => setPestana(k)}
              className={`px-3.5 py-1.5 rounded-pill text-sm whitespace-nowrap transition ${
                pestana === k ? 'bg-ink text-white' : 'text-mute hover:bg-bg2'
              }`}
            >
              {label}
              {k !== 'plantillas' && filas && <span className="ml-1.5 tabular-nums opacity-60">{cuenta(k)}</span>}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setEligiendo(true)}>
          + {t.crear}
        </button>
      </div>

      {cat && cat.predeterminadasActivas > 0 && pestana !== 'plantillas' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-input border border-line bg-surface px-4 py-3 mb-4 text-sm">
          <span className="text-mute">
            <b className="text-ink font-semibold">{t.predeterminadas}.</b> {t.predeterminadasTexto(cat.predeterminadasActivas)}
          </span>
          <Link href="/app/automations" className="text-brand-700 font-semibold whitespace-nowrap hover:underline">
            {t.verPredeterminadas} →
          </Link>
        </div>
      )}

      {pestana === 'plantillas' ? (
        <GaleriaPlantillas plantillas={cat?.plantillas ?? []} onUsar={crear} ocupado={ocupado} />
      ) : filas === null ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[76px] rounded-input bg-surface border border-line animate-pulse" />
          ))}
        </div>
      ) : visibles.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-lg font-semibold text-ink">{filas.length ? t.nadaEnFiltro : t.vacioTitulo}</div>
          {!filas.length && (
            <>
              <p className="text-mute mt-1">{t.vacioTexto}</p>
              <div className="flex justify-center gap-2 mt-5">
                <button className="btn-ghost" onClick={() => setPestana('plantillas')}>
                  {t.plantillas}
                </button>
                <button className="btn-primary" onClick={() => crear('vacio')}>
                  {t.desdeCero}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-input border border-line bg-surface divide-y divide-line overflow-hidden">
          {visibles.map((f) => (
            <div key={f.id} className="flex flex-wrap md:flex-nowrap items-center gap-x-5 gap-y-2 px-4 py-3.5 hover:bg-bg/60">
              <Link href={`/app/automations/workflows/${f.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                <PildoraEstado estado={f.status} t={t} />
                <div className="min-w-0">
                  <div className="font-semibold text-ink truncate">{f.name}</div>
                  <div className="text-xs text-mute truncate">
                    {t.disparadores[f.triggerType] ?? '—'}
                    {f.triggerType === 'INACTIVITY' && f.triggerDays ? ` · ${f.triggerDays} ${t.unidades.days}` : ''}
                    {' · '}
                    {t.pasos(f.pasos)}
                    {f.schemaVersion < 2 && ` · ${t.version1}`}
                  </div>
                </div>
              </Link>
              <dl className="flex gap-5 text-xs tabular-nums">
                <Dato label={t.inscritos} valor={f.stats.inscritos} />
                <Dato label={t.enviados} valor={f.stats.enviados} />
                <Dato label={t.creada} valor={fecha(f.createdAt, locale) ?? '—'} />
                <Dato label={t.ultimaActividad} valor={fecha(f.lastActivityAt, locale) ?? t.nunca} />
              </dl>
              <div className="flex gap-1 ml-auto">
                <Link href={`/app/automations/workflows/${f.id}`} className="btn-ghost !px-3 !py-1.5 text-xs">
                  {t.editar}
                </Link>
                {f.status === 'active' ? (
                  <button disabled={ocupado === f.id} onClick={() => accion(f, 'pausar')} className="btn-ghost !px-3 !py-1.5 text-xs">
                    {t.pausar}
                  </button>
                ) : (
                  <button disabled={ocupado === f.id} onClick={() => accion(f, 'activar')} className="btn-ghost !px-3 !py-1.5 text-xs">
                    {t.activar}
                  </button>
                )}
                <button disabled={ocupado === f.id} onClick={() => accion(f, 'duplicar')} className="btn-ghost !px-3 !py-1.5 text-xs">
                  {t.duplicar}
                </button>
                <button
                  disabled={ocupado === f.id}
                  onClick={() => accion(f, 'eliminar')}
                  className="btn-ghost !px-3 !py-1.5 text-xs !text-bad"
                >
                  {t.eliminar}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {eligiendo && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-4" onClick={() => setEligiendo(false)}>
          <div className="bg-surface rounded-input w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold text-ink mb-4">{t.crear}</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                onClick={() => crear('vacio')}
                disabled={!!ocupado}
                className="text-left rounded-input border border-line p-4 hover:border-brand hover:bg-brand-soft/40 transition"
              >
                <IconoFlujo nombre="plus" className="text-brand-700" />
                <div className="font-semibold text-ink mt-2">{t.desdeCero}</div>
                <div className="text-sm text-mute mt-0.5">{t.desdeCeroTexto}</div>
              </button>
              <button
                onClick={() => {
                  setEligiendo(false);
                  setPestana('plantillas');
                }}
                className="text-left rounded-input border border-line p-4 hover:border-brand hover:bg-brand-soft/40 transition"
              >
                <IconoFlujo nombre="sparkles" className="text-brand-700" />
                <div className="font-semibold text-ink mt-2">{t.desdePlantilla}</div>
                <div className="text-sm text-mute mt-0.5">{t.desdePlantillaTexto}</div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string | number }) {
  return (
    <div className="min-w-[56px]">
      <dt className="text-mute2 uppercase tracking-wide text-[10px]">{label}</dt>
      <dd className="text-ink font-medium whitespace-nowrap">{valor}</dd>
    </div>
  );
}

function GaleriaPlantillas({
  plantillas,
  onUsar,
  ocupado,
}: {
  plantillas: Plantilla[];
  onUsar: (k: string) => void;
  ocupado: string | null;
}) {
  const t = useTextos();
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {plantillas.map((p) => (
        <div key={p.key} className="flex flex-col rounded-input border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="grid place-items-center w-9 h-9 rounded-full bg-brand-soft text-brand-700">
              <IconoFlujo nombre={p.icono} />
            </span>
            <span className="text-[11px] uppercase tracking-wide text-mute2">{t.categorias[p.categoria] ?? p.categoria}</span>
          </div>
          <div className="font-semibold text-ink mt-3">{p.nombre}</div>
          <p className="text-sm text-mute mt-1 flex-1">{p.descripcion}</p>
          <div className="text-xs text-mute mt-3 space-y-0.5">
            <div>
              {p.triggerType ? t.disparadores[p.triggerType] : t.elegirActivador} · {t.pasos(p.pasos)}
            </div>
            <div>
              {t.objetivo}: <span className="text-ink">{p.objetivo}</span>
            </div>
          </div>
          <button className="btn-primary mt-4 justify-center" disabled={!!ocupado} onClick={() => onUsar(p.key)}>
            {ocupado === p.key ? '…' : t.usarPlantilla}
          </button>
        </div>
      ))}
    </div>
  );
}
