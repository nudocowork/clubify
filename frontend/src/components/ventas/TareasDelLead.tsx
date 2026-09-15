'use client';

/**
 * Las tareas de UN lead, dentro de su ficha: la sección «Tareas» de la ficha de
 * contacto de TeamClubify.
 *
 * La acción se elige del catálogo del equipo (con «+» se añade una nueva, que
 * queda para todos) y el detalle va en la descripción. Si el módulo no responde,
 * la sección no se pinta: la ficha sigue sirviendo sin ella.
 *
 * Colores por tokens: bajo `.brand-panel` / `.brand-auth` la marca pone los suyos.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Tarea = {
  id: string;
  titulo: string;
  descripcion: string | null;
  fecha: string | null;
  hecha: boolean;
  vencida: boolean;
  responsable: string | null;
  creadaPor: string | null;
};

type Respuesta = {
  puedeEscribir: boolean;
  puedeBorrarTodas: boolean;
  yo: string;
  hoy: string;
  responsables: { id: string; nombre: string }[];
  acciones: { id: string; nombre: string }[];
  tareas: Tarea[];
};

export function TareasDelLead({
  teamId,
  leadId,
  onCambio,
}: {
  teamId: string;
  leadId: string;
  /** La tarea deja nota en el historial del lead: la ficha se relee para verla. */
  onCambio?: () => void;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState('');
  const [responsableId, setResponsableId] = useState('');
  const [anadiendo, setAnadiendo] = useState(false);
  const [nuevaAccion, setNuevaAccion] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await api<Respuesta>(`/sales-teams/${teamId}/tareas?lead=${encodeURIComponent(leadId)}`);
    setDatos(r);
    setTitulo((t) => t || r.acciones[0]?.nombre || '');
  }, [teamId, leadId]);

  useEffect(() => {
    cargar().catch(() => setDatos(null));
  }, [cargar]);

  async function correr(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    try {
      await fn();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
      setOcupado(false);
      return;
    }
    if (ok) toast(ok, 'success');
    // Recargar va aparte: si lo guardado entró y la recarga falla, avisar «no se
    // pudo guardar» sería mentira (Fable, 2026-09-14).
    await cargar().catch(() => null);
    onCambio?.();
    setOcupado(false);
  }

  async function guardarAccion() {
    const n = nuevaAccion.trim();
    if (!n) return;
    try {
      const a = await api<{ id: string; nombre: string }>(`/sales-teams/${teamId}/tareas/acciones`, {
        method: 'POST',
        body: JSON.stringify({ nombre: n }),
      });
      setDatos((d) => (d && !d.acciones.some((x) => x.id === a.id) ? { ...d, acciones: [...d.acciones, a] } : d));
      // Queda elegida: casi siempre se crea para usarla ya.
      setTitulo(a.nombre);
      setAnadiendo(false);
      setNuevaAccion('');
    } catch (e: any) {
      toast(e?.message || 'No se pudo añadir la acción', 'error');
    }
  }

  function anadir() {
    if (!titulo.trim()) return;
    void correr(async () => {
      await api(`/sales-teams/${teamId}/tareas`, {
        method: 'POST',
        body: JSON.stringify({
          leadId,
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          fecha: fecha || null,
          responsableId: responsableId || null,
        }),
      });
      setDescripcion('');
      setFecha('');
      setResponsableId('');
    }, 'Tarea añadida.');
  }

  if (!datos) return null;

  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">Tareas</h3>

      {datos.tareas.length > 0 && (
        <ul className="m-0 mb-2 flex list-none flex-col gap-1.5 p-0">
          {datos.tareas.map((t) => {
            const puedeBorrar = datos.puedeEscribir && (datos.puedeBorrarTodas || t.creadaPor === datos.yo);
            return (
              <li key={t.id} className="flex items-start gap-2 rounded-lg border border-line p-2 text-sm">
                <input
                  type="checkbox"
                  checked={t.hecha}
                  disabled={!datos.puedeEscribir || ocupado}
                  onChange={() =>
                    void correr(() =>
                      api(`/sales-teams/${teamId}/tareas/${t.id}/hecha`, {
                        method: 'PATCH',
                        body: JSON.stringify({ hecha: !t.hecha }),
                      }),
                    )
                  }
                  className="mt-0.5 accent-brand"
                  aria-label={t.hecha ? 'Marcar como pendiente' : 'Marcar como hecha'}
                />
                <div className="min-w-0 flex-1">
                  <p className={`m-0 ${t.hecha ? 'text-mute line-through' : 'text-ink'}`}>{t.titulo}</p>
                  {t.descripcion && (
                    <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-xs text-mute">{t.descripcion}</p>
                  )}
                  <p className="m-0 text-[11px] text-mute">
                    <span className={t.vencida ? 'font-medium text-bad-ink' : ''}>{t.fecha ? `📅 ${t.fecha}` : 'sin fecha'}</span>
                    {t.responsable ? ` · ${t.responsable}` : ''}
                  </p>
                </div>
                {puedeBorrar && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      if (!confirm('¿Eliminar esta tarea?')) return;
                      void correr(() => api(`/sales-teams/${teamId}/tareas/${t.id}`, { method: 'DELETE' }));
                    }}
                    className="text-mute hover:text-bad-ink disabled:opacity-50"
                    aria-label="Eliminar tarea"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {datos.puedeEscribir && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-bg2 p-2">
          {anadiendo ? (
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={nuevaAccion}
                onChange={(e) => setNuevaAccion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void guardarAccion();
                  }
                  if (e.key === 'Escape') {
                    setAnadiendo(false);
                    setNuevaAccion('');
                  }
                }}
                maxLength={40}
                placeholder="Nueva acción (ej. Llamar)"
                className="input h-8 flex-1 text-sm"
              />
              <button type="button" onClick={() => void guardarAccion()} disabled={!nuevaAccion.trim()} className="btn-primary text-xs disabled:opacity-50">
                Guardar
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnadiendo(false);
                  setNuevaAccion('');
                }}
                className="btn-ghost text-xs"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <select value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input h-8 flex-1 text-sm" aria-label="Acción">
                {datos.acciones.map((a) => (
                  <option key={a.id} value={a.nombre}>
                    {a.nombre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAnadiendo(true)}
                title="Añadir una acción al catálogo del equipo"
                className="btn-ghost px-2.5 text-sm font-semibold"
              >
                +
              </button>
            </div>
          )}
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="Descripción (ej. pidió que lo llamemos el lunes para hablar con su socio)"
            className="input resize-y text-sm"
          />
          <div className="flex gap-1.5">
            <input
              type="date"
              value={fecha}
              min={datos.hoy}
              onChange={(e) => setFecha(e.target.value)}
              className="input h-8 w-auto text-xs"
              aria-label="Fecha"
            />
            <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)} className="input h-8 flex-1 text-xs" aria-label="Responsable">
              <option value="">Sin responsable</option>
              {datos.responsables.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
            <button type="button" onClick={anadir} disabled={ocupado || !titulo.trim()} className="btn-primary text-xs disabled:opacity-50">
              Añadir
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
