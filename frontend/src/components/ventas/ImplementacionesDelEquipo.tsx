'use client';

/**
 * «Clientes» del equipo: la implementación de cada venta cerrada.
 *
 * Antes esta pestaña era la lista de leads ganados — la misma tabla que
 * Contactos con otro filtro. Después de vender, lo que el equipo necesita ver
 * es por dónde va la puesta en marcha de cada cliente y qué falta. Por eso una
 * lista de comprobación por cliente, como la de TeamClubify: contadores
 * arriba, filtro por estado, y una tarjeta con su barra de progreso.
 *
 * Las implementaciones nacen solas al mover un lead a la columna de clientes
 * del CRM; aquí no se crean a mano.
 *
 * Colores por tokens (brand/ok/warn/bad): bajo `.brand-panel` la marca pone los
 * suyos — en Sellea, su coral — sin tocar este archivo.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

type Paso = { id: string; titulo: string; hecho: boolean };
type Implementacion = {
  id: string;
  nombre: string;
  cliente: string | null;
  plan: string | null;
  estado: string;
  entrega: string | null;
  hechos: number;
  total: number;
  pasos: Paso[];
};
type Respuesta = {
  puedeEscribir: boolean;
  kpis: { activas: number; completadas: number; total: number };
  implementaciones: Implementacion[];
};

const ESTADOS: Record<string, { etiqueta: string; clase: string }> = {
  pendiente: { etiqueta: 'Pendiente', clase: 'bg-warn-soft text-warn-ink' },
  en_progreso: { etiqueta: 'En progreso', clase: 'bg-brand-soft text-brand' },
  completada: { etiqueta: 'Completada', clase: 'bg-ok-soft text-ok-ink' },
  cancelada: { etiqueta: 'Cancelada', clase: 'bg-bg2 text-mute' },
};
const FILTROS = ['', 'pendiente', 'en_progreso', 'completada', 'cancelada'] as const;

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

export function ImplementacionesDelEquipo() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [equipo, setEquipo] = useState<{ id: string; name: string } | null>(null);
  const [filtro, setFiltro] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!teamId) return;
    setError(null);
    try {
      const q = filtro ? `?estado=${filtro}` : '';
      const [lista, resumen] = await Promise.all([
        api<Respuesta>(`/sales-teams/${teamId}/implementaciones${q}`),
        api<{ team: { id: string; name: string } | null }>(`/sales-teams/${teamId}/resumen`).catch(
          () => null,
        ),
      ]);
      setDatos(lista);
      if (resumen?.team) setEquipo(resumen.team);
    } catch (e: any) {
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudieron cargar los clientes',
      );
    }
  }, [teamId, filtro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Marca un paso. Se pinta ANTES de que conteste el servidor —marcar una
   * casilla y esperar a que se tilde se siente roto— y se recarga después,
   * porque el servidor puede cambiar el estado de la implementación (todos los
   * pasos hechos → completada) y esa regla vive allí, no aquí.
   */
  async function marcar(implId: string, pasoId: string, hecho: boolean) {
    setDatos((d) =>
      d
        ? {
            ...d,
            implementaciones: d.implementaciones.map((i) =>
              i.id !== implId
                ? i
                : {
                    ...i,
                    pasos: i.pasos.map((p) => (p.id === pasoId ? { ...p, hecho } : p)),
                    hechos: i.pasos.filter((p) => (p.id === pasoId ? hecho : p.hecho)).length,
                  },
            ),
          }
        : d,
    );
    try {
      await api(`/sales-teams/${teamId}/implementaciones/pasos/${pasoId}`, {
        method: 'PATCH',
        body: JSON.stringify({ hecho }),
      });
    } catch (e: any) {
      // Sin esto la casilla se marcaba y medio segundo después se desmarcaba
      // sola (la recarga trae la verdad del servidor), sin decir por qué.
      toast(e?.message || 'No se pudo guardar el paso', 'error');
    } finally {
      void cargar();
    }
  }

  async function cambiarEstado(implId: string, estado: string) {
    setDatos((d) =>
      d
        ? {
            ...d,
            implementaciones: d.implementaciones.map((i) =>
              i.id === implId ? { ...i, estado } : i,
            ),
          }
        : d,
    );
    try {
      await api(`/sales-teams/${teamId}/implementaciones/${implId}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado }),
      });
    } catch (e: any) {
      toast(e?.message || 'No se pudo cambiar el estado', 'error');
    } finally {
      void cargar();
    }
  }

  if (error) {
    return (
      <div className="card card-pad text-center py-12">
        <div className="text-3xl mb-2">⚠️</div>
        <div className="font-semibold mb-1">No se pudo cargar</div>
        <div className="text-sm text-mute mb-4">{error}</div>
        <Link href="/admin/sales-teams" className="btn-ghost text-sm inline-flex">
          Volver a los equipos
        </Link>
      </div>
    );
  }

  return (
    <div>
      {equipo && <CabeceraDeEquipo equipo={equipo} soloLectura={datos ? !datos.puedeEscribir : undefined} />}

      <div className="mb-3">
        <div className="font-semibold">Clientes</div>
        <p className="text-xs text-mute mt-0.5">
          La implementación de cada venta cerrada. Nace sola al mover un lead a la
          columna de clientes del CRM.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Kpi etiqueta="Activas" valor={datos?.kpis.activas} />
        <Kpi etiqueta="Completadas" valor={datos?.kpis.completadas} />
        <Kpi etiqueta="Total" valor={datos?.kpis.total} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Filtrar por estado">
        {FILTROS.map((k) => (
          <button
            key={k || 'todas'}
            role="tab"
            aria-selected={filtro === k}
            onClick={() => setFiltro(k)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              filtro === k
                ? 'border-brand bg-brand text-white'
                : 'border-line text-mute hover:border-mute2'
            }`}
          >
            {k ? ESTADOS[k].etiqueta : 'Todas'}
          </button>
        ))}
      </div>

      {!datos ? (
        <div className="card card-pad text-sm text-mute text-center py-10">Cargando…</div>
      ) : datos.implementaciones.length === 0 ? (
        <div className="card card-pad text-sm text-mute text-center py-10">
          {filtro
            ? `No hay implementaciones en «${ESTADOS[filtro].etiqueta}».`
            : 'Sin implementaciones todavía. Se crean solas al cerrar una venta.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {datos.implementaciones.map((i) => {
            const pct = i.total ? Math.round((i.hechos / i.total) * 100) : 0;
            const meta = ESTADOS[i.estado] ?? { etiqueta: i.estado, clase: 'bg-bg2 text-mute' };
            return (
              <div key={i.id} className="card card-pad">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {i.cliente ?? i.nombre}
                      {i.plan ? <span className="font-normal text-mute"> · {i.plan}</span> : null}
                    </p>
                    <p className="text-[11px] text-mute">
                      {i.hechos}/{i.total} pasos ·{' '}
                      {i.entrega ? `entrega ${fecha(i.entrega)}` : 'sin fecha'}
                    </p>
                  </div>
                  {datos.puedeEscribir ? (
                    <select
                      value={i.estado}
                      onChange={(e) => void cambiarEstado(i.id, e.target.value)}
                      className="input text-xs py-1 w-auto"
                      aria-label={`Estado de ${i.cliente ?? i.nombre}`}
                    >
                      {Object.keys(ESTADOS).map((s) => (
                        <option key={s} value={s}>
                          {ESTADOS[s].etiqueta}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.clase}`}>
                      {meta.etiqueta}
                    </span>
                  )}
                </div>

                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg2"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
                </div>

                <div className="mt-3 flex flex-col gap-1">
                  {i.pasos.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.hecho}
                        disabled={!datos.puedeEscribir}
                        onChange={(e) => void marcar(i.id, p.id, e.target.checked)}
                        className="accent-brand"
                      />
                      <span className={p.hecho ? 'text-mute line-through' : 'text-ink'}>{p.titulo}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ etiqueta, valor }: { etiqueta: string; valor: number | undefined }) {
  return (
    <div className="card card-pad py-3">
      <p className="text-[11px] text-mute">{etiqueta}</p>
      <p className="mt-0.5 text-lg font-bold text-ink tabular-nums">{valor ?? '—'}</p>
    </div>
  );
}
