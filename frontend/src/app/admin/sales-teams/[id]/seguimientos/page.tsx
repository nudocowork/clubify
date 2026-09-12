'use client';

/**
 * Seguimientos del equipo: lo que hay que volver a tocar y cuándo.
 *
 * Ordenados por vencimiento y con los pendientes primero, porque lo primero de
 * la lista tiene que ser lo que ya se pasó de fecha. Una lista de seguimientos
 * ordenada por creación no sirve para trabajar con ella.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

type Seguimiento = {
  id: string;
  dueAt: string;
  channel: string | null;
  note: string | null;
  done: boolean;
  doneAt: string | null;
  outcome: string | null;
  asignadoA: string | null;
  vencido: boolean;
  lead: { id: string; name: string | null; phone: string | null } | null;
};

type Respuesta = {
  estado: 'pendientes' | 'hechos' | 'todos';
  total: number;
  seguimientos: Seguimiento[];
};

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

const ESTADOS = [
  ['pendientes', 'Pendientes'],
  ['hechos', 'Hechos'],
  ['todos', 'Todos'],
] as const;

export default function SeguimientosPage() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [equipo, setEquipo] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<Respuesta['estado']>('pendientes');

  const cargar = useCallback(async () => {
    if (!teamId) return;
    setError(null);
    try {
      const [lista, resumen] = await Promise.all([
        api<Respuesta>(`/sales-teams/${teamId}/seguimientos?estado=${estado}`),
        api<{ team: { id: string; name: string } | null }>(
          `/sales-teams/${teamId}/resumen`,
        ).catch(() => null),
      ]);
      setDatos(lista);
      if (resumen?.team) setEquipo(resumen.team);
    } catch (e: any) {
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudieron cargar los seguimientos',
      );
    }
  }, [teamId, estado]);

  useEffect(() => { void cargar(); }, [cargar]);

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

  const vencidos = datos?.seguimientos.filter((s) => s.vencido).length ?? 0;

  return (
    <div>
      {equipo && <CabeceraDeEquipo equipo={equipo} />}

      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="font-semibold">Seguimientos</div>
          <p className="text-xs text-mute mt-0.5">
            A quién hay que volver a escribir, y cuándo. Lo vencido va primero.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-bg2 rounded-pill">
          {ESTADOS.map(([id, etiqueta]) => (
            <button
              key={id}
              onClick={() => setEstado(id)}
              className={`px-3.5 py-1.5 rounded-pill text-sm font-semibold transition ${
                estado === id ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
              }`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {vencidos > 0 && (
        <p className="text-sm text-warn font-medium mb-3">
          {vencidos} {vencidos === 1 ? 'seguimiento vencido' : 'seguimientos vencidos'}.
        </p>
      )}

      {!datos ? (
        <div className="h-32 bg-bg2 rounded animate-shimmer" />
      ) : datos.seguimientos.length === 0 ? (
        <div className="card card-pad text-center text-mute py-12">
          <div className="text-3xl mb-2">✅</div>
          <div className="font-semibold mb-1 text-ink">Nada pendiente</div>
          <div className="text-sm">
            {estado === 'pendientes'
              ? 'No hay seguimientos abiertos en este equipo.'
              : 'No hay seguimientos que enseñar con este filtro.'}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">Cuándo</th>
                  <th className="px-4 py-3 font-semibold">Persona</th>
                  <th className="px-4 py-3 font-semibold">Nota</th>
                  <th className="px-4 py-3 font-semibold">Canal</th>
                  <th className="px-4 py-3 font-semibold">Responsable</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.seguimientos.map((s) => (
                  <tr key={s.id} className="border-t border-line2 hover:bg-bg2/40">
                    <td className={`px-4 py-3 whitespace-nowrap ${s.vencido ? 'text-warn font-semibold' : ''}`}>
                      {cuando(s.dueAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium block truncate max-w-[200px]">
                        {s.lead?.name || 'Sin nombre'}
                      </span>
                      {s.lead?.phone && (
                        <span className="text-xs text-mute tabular-nums">{s.lead.phone}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">
                      <span className="block truncate max-w-[280px]">{s.note || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">{s.channel || '—'}</td>
                    <td className="px-4 py-3 text-xs">{s.asignadoA || <span className="text-mute2">—</span>}</td>
                    <td className="px-4 py-3">
                      {s.done ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                          Hecho{s.doneAt ? ` · ${cuando(s.doneAt)}` : ''}
                        </span>
                      ) : s.vencido ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                          Vencido
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-600">
                          Pendiente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
