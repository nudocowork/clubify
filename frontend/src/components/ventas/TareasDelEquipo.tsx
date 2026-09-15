'use client';

/**
 * «Tareas del CRM» del equipo, como en TeamClubify (`TasksBoard`).
 *
 * Lo que hay que hacer con cada contacto, con fecha y responsable, en cinco
 * vistas: Pendientes, Vencidas, Hoy, Mías y Completadas. La acción sale de un
 * catálogo del equipo («Seguimiento», «Llamar») y el detalle va en la
 * descripción: «Seguimiento» solo no dice nada dentro de un mes.
 *
 * Colores por tokens: bajo `.brand-panel` / `.brand-auth` la marca pone los suyos.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';

type Vista = 'pendientes' | 'vencidas' | 'hoy' | 'mias' | 'completadas';

const VISTAS: { valor: Vista; label: string }[] = [
  { valor: 'pendientes', label: 'Pendientes' },
  { valor: 'vencidas', label: 'Vencidas' },
  { valor: 'hoy', label: 'Hoy' },
  { valor: 'mias', label: 'Mías' },
  { valor: 'completadas', label: 'Completadas' },
];

type Tarea = {
  id: string;
  titulo: string;
  descripcion: string | null;
  fecha: string | null;
  hecha: boolean;
  vencida: boolean;
  responsableId: string | null;
  responsable: string | null;
  creadaPor: string | null;
  lead: { id: string; nombre: string | null; telefono: string | null; empresa: string | null } | null;
};

type Datos = {
  team: { id: string; name: string; isActive?: boolean };
  puedeEscribir: boolean;
  puedeBorrarTodas: boolean;
  yo: string;
  hoy: string;
  vista: Vista;
  pendientes: number;
  truncado: boolean;
  responsables: { id: string; nombre: string }[];
  acciones: { id: string; nombre: string }[];
  tareas: Tarea[];
};

type Contacto = { id: string; nombre: string | null; empresa: string | null; telefono: string | null };

const nombreDe = (l: { nombre: string | null; telefono: string | null } | null) => l?.nombre || l?.telefono || 'Sin nombre';

export function TareasDelEquipo() {
  const rutaEquipos = useBaseDeEquipos();
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('pendientes');
  const [cargando, setCargando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<Tarea | null>(null);
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(
    async (v: Vista) => {
      if (!teamId) return;
      setCargando(true);
      try {
        setDatos(await api<Datos>(`/sales-teams/${teamId}/tareas?vista=${v}`));
        setError(null);
      } catch (e: any) {
        setError(
          e?.status === 404
            ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
            : e?.message || 'No se pudieron cargar las tareas',
        );
      } finally {
        setCargando(false);
      }
    },
    [teamId],
  );

  useEffect(() => {
    void cargar(vista);
  }, [cargar, vista]);

  async function marcar(t: Tarea) {
    setOcupado(t.id);
    try {
      await api(`/sales-teams/${teamId}/tareas/${t.id}/hecha`, {
        method: 'PATCH',
        body: JSON.stringify({ hecha: !t.hecha }),
      });
      await cargar(vista);
    } catch (e: any) {
      toast(e?.message || 'No se pudo marcar', 'error');
    } finally {
      setOcupado(null);
    }
  }

  async function borrar(t: Tarea) {
    if (!confirm('¿Eliminar esta tarea?')) return;
    setOcupado(t.id);
    try {
      await api(`/sales-teams/${teamId}/tareas/${t.id}`, { method: 'DELETE' });
      toast('Tarea eliminada.', 'success');
      await cargar(vista);
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
    } finally {
      setOcupado(null);
    }
  }

  if (error) {
    return (
      <div className="card card-pad text-center py-12">
        <div className="text-3xl mb-2">⚠️</div>
        <div className="font-semibold mb-1">No se pudo cargar</div>
        <div className="text-sm text-mute mb-4">{error}</div>
        <Link href={rutaEquipos} className="btn-ghost text-sm inline-flex">
          Volver a los equipos
        </Link>
      </div>
    );
  }

  if (!datos) {
    return <div className="h-32 bg-bg2 rounded animate-shimmer" />;
  }

  const puedeBorrar = (t: Tarea) => datos.puedeEscribir && (datos.puedeBorrarTodas || t.creadaPor === datos.yo);

  return (
    <div>
      <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {VISTAS.map((v) => (
          <button
            key={v.valor}
            type="button"
            onClick={() => setVista(v.valor)}
            className={`rounded-pill px-3 py-1.5 text-sm font-medium ${
              vista === v.valor ? 'bg-brand text-white' : 'bg-bg2 text-mute hover:text-ink'
            }`}
          >
            {v.label}
          </button>
        ))}
        <span className="ml-auto rounded-pill bg-bg2 px-2.5 py-1 text-xs text-mute tabular-nums">
          {datos.pendientes} pendiente{datos.pendientes === 1 ? '' : 's'} en total
        </span>
        {datos.puedeEscribir && (
          <button type="button" className="btn-primary text-sm" onClick={() => setNueva(true)}>
            + Nueva tarea
          </button>
        )}
      </div>

      {datos.truncado && (
        <p className="mb-3 mt-0 text-xs text-warn-ink">Se muestran las primeras 300 de esta vista.</p>
      )}

      <div className="card overflow-hidden p-0">
        {cargando && !datos.tareas.length ? (
          <p className="m-0 p-8 text-center text-sm text-mute">Cargando…</p>
        ) : datos.tareas.length === 0 ? (
          <p className="m-0 p-8 text-center text-sm text-mute">Sin tareas en esta vista.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {datos.tareas.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={t.hecha}
                  disabled={!datos.puedeEscribir || ocupado === t.id}
                  onChange={() => void marcar(t)}
                  className="mt-1 accent-brand"
                  aria-label={t.hecha ? 'Marcar como pendiente' : 'Marcar como hecha'}
                />
                <div className="min-w-0 flex-1">
                  <p className={`m-0 text-sm ${t.hecha ? 'text-mute line-through' : 'text-ink'}`}>{t.titulo}</p>
                  {t.descripcion && (
                    <p className="m-0 mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-mute">
                      {t.descripcion}
                    </p>
                  )}
                  <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-mute">
                    {t.lead && (
                      <Link href={`${rutaEquipos}/${teamId}/board?lead=${t.lead.id}`} className="font-medium text-ink hover:underline">
                        {nombreDe(t.lead)}
                      </Link>
                    )}
                    <span className={t.vencida ? 'font-medium text-bad-ink' : ''}>
                      {t.fecha ? `📅 ${t.fecha}` : 'sin fecha'}
                    </span>
                    <span>{t.responsable ?? 'sin responsable'}</span>
                    {t.lead && (
                      <Link
                        href={`${rutaEquipos}/${teamId}/conversaciones?lead=${t.lead.id}`}
                        className="hover:text-ink hover:underline"
                      >
                        💬 Abrir chat
                      </Link>
                    )}
                    <button type="button" onClick={() => setAbierta(t)} className="hover:text-ink hover:underline">
                      {t.descripcion ? (t.descripcion.length > 90 ? 'Ver tarea' : 'Abrir') : '+ descripción'}
                    </button>
                  </p>
                </div>
                {puedeBorrar(t) && (
                  <button
                    type="button"
                    onClick={() => void borrar(t)}
                    disabled={ocupado === t.id}
                    className="text-mute hover:text-bad-ink disabled:opacity-50"
                    aria-label="Eliminar tarea"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {abierta && (
        <DetalleDeTarea
          key={abierta.id}
          teamId={teamId}
          datos={datos}
          tarea={abierta}
          onCerrar={() => setAbierta(null)}
          onGuardado={async () => {
            setAbierta(null);
            await cargar(vista);
          }}
        />
      )}

      {nueva && (
        <NuevaTarea
          teamId={teamId}
          datos={datos}
          onCerrar={() => setNueva(false)}
          onCreada={async () => {
            setNueva(false);
            await cargar(vista);
          }}
        />
      )}
    </div>
  );
}

// ── Detalle: la descripción larga no cabe en la fila ────────────────────────

function DetalleDeTarea({
  teamId,
  datos,
  tarea,
  onCerrar,
  onGuardado,
}: {
  teamId: string;
  datos: Datos;
  tarea: Tarea;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [titulo, setTitulo] = useState(tarea.titulo);
  const [descripcion, setDescripcion] = useState(tarea.descripcion ?? '');
  const [fecha, setFecha] = useState(tarea.fecha ?? '');
  const [responsableId, setResponsableId] = useState(tarea.responsableId ?? '');
  const [guardando, setGuardando] = useState(false);
  const soloLectura = !datos.puedeEscribir;

  async function guardar() {
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/tareas/${tarea.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(titulo !== tarea.titulo ? { titulo } : {}),
          descripcion: descripcion.trim() || null,
          fecha: fecha || null,
          // Solo si cambió: un responsable que ya salió del equipo no deja guardar.
          ...(responsableId !== (tarea.responsableId ?? '') ? { responsableId: responsableId || null } : {}),
        }),
      });
      toast('Tarea guardada.', 'success');
      onGuardado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative w-full max-w-md card card-pad">
        <h3 className="m-0 text-base font-semibold text-ink">{tarea.titulo}</h3>
        <p className="m-0 mt-0.5 text-xs text-mute">
          {nombreDe(tarea.lead)}
          {tarea.lead?.telefono ? ` · ${tarea.lead.telefono}` : ''}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <label className="label">Acción</label>
            <select value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input" disabled={soloLectura}>
              {datos.acciones.map((a) => (
                <option key={a.id} value={a.nombre}>
                  {a.nombre}
                </option>
              ))}
              {!datos.acciones.some((a) => a.nombre === tarea.titulo) && (
                <option value={tarea.titulo}>{tarea.titulo}</option>
              )}
            </select>
          </div>
          <div>
            <label className="label">Descripción</label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="Qué pasó y qué sigue…"
              className="input resize-y"
              disabled={soloLectura}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="input" disabled={soloLectura} />
            </div>
            <div>
              <label className="label">Responsable</label>
              <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)} className="input" disabled={soloLectura}>
                <option value="">Sin responsable</option>
                {datos.responsables.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
                {tarea.responsableId && !datos.responsables.some((r) => r.id === tarea.responsableId) && (
                  <option value={tarea.responsableId}>{tarea.responsable ?? 'Fuera del equipo'}</option>
                )}
              </select>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
            {soloLectura ? 'Cerrar' : 'Cancelar'}
          </button>
          {!soloLectura && (
            <button type="button" onClick={() => void guardar()} disabled={guardando} className="btn-primary text-sm disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Nueva tarea: contacto, acción del catálogo, descripción, fecha, responsable

function NuevaTarea({
  teamId,
  datos,
  onCerrar,
  onCreada,
}: {
  teamId: string;
  datos: Datos;
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Contacto[]>([]);
  const [contacto, setContacto] = useState<Contacto | null>(null);
  const [acciones, setAcciones] = useState(datos.acciones);
  const [titulo, setTitulo] = useState(datos.acciones[0]?.nombre ?? '');
  const [anadiendo, setAnadiendo] = useState(false);
  const [nuevaAccion, setNuevaAccion] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState('');
  const [responsableId, setResponsableId] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Con una pausa: una petición por palabra escrita y no una por tecla.
  useEffect(() => {
    if (contacto) return;
    const t = busqueda.trim();
    if (t.length < 2) {
      setResultados([]);
      return;
    }
    let vivo = true;
    const h = setTimeout(() => {
      api<{ filas: Contacto[] }>(`/sales-teams/${teamId}/contactos?q=${encodeURIComponent(t)}`)
        .then((r) => {
          if (vivo) setResultados(r.filas.slice(0, 8));
        })
        .catch(() => {
          if (vivo) setResultados([]);
        });
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(h);
    };
  }, [busqueda, contacto, teamId]);

  async function guardarAccion() {
    const n = nuevaAccion.trim();
    if (!n) return;
    try {
      const a = await api<{ id: string; nombre: string }>(`/sales-teams/${teamId}/tareas/acciones`, {
        method: 'POST',
        body: JSON.stringify({ nombre: n }),
      });
      setAcciones((p) => (p.some((x) => x.id === a.id) ? p : [...p, a]));
      // Queda elegida: casi siempre se crea para usarla ya.
      setTitulo(a.nombre);
      setAnadiendo(false);
      setNuevaAccion('');
    } catch (e: any) {
      toast(e?.message || 'No se pudo añadir la acción', 'error');
    }
  }

  async function crear() {
    if (!contacto) {
      toast('Elige el contacto de la tarea', 'error');
      return;
    }
    if (!titulo.trim()) {
      toast('Elige la acción', 'error');
      return;
    }
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/tareas`, {
        method: 'POST',
        body: JSON.stringify({
          leadId: contacto.id,
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          fecha: fecha || null,
          responsableId: responsableId || null,
        }),
      });
      toast('Tarea creada.', 'success');
      onCreada();
    } catch (e: any) {
      toast(e?.message || 'No se pudo crear la tarea', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto card card-pad">
        <h3 className="m-0 mb-3 text-base font-semibold text-ink">Nueva tarea</h3>

        <label className="label">Contacto</label>
        {contacto ? (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-ink">
              {nombreDe(contacto)}
              {contacto.empresa ? ` · ${contacto.empresa}` : ''}
            </span>
            <button
              type="button"
              className="text-xs text-mute underline"
              onClick={() => {
                setContacto(null);
                setBusqueda('');
              }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <div className="mb-3">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, empresa o teléfono…"
              className="input"
              autoFocus
            />
            {resultados.length > 0 && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line">
                {resultados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setContacto(c);
                      setResultados([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-bg2"
                  >
                    <span className="font-medium text-ink">{nombreDe(c)}</span>
                    {(c.empresa || c.telefono) && <span className="text-mute"> · {c.empresa || c.telefono}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="label">Acción</label>
        {anadiendo ? (
          <div className="mb-3 flex gap-1.5">
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
              className="input flex-1"
            />
            <button type="button" onClick={() => void guardarAccion()} disabled={!nuevaAccion.trim()} className="btn-primary text-sm disabled:opacity-50">
              Guardar
            </button>
            <button
              type="button"
              onClick={() => {
                setAnadiendo(false);
                setNuevaAccion('');
              }}
              className="btn-ghost text-sm"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="mb-3 flex gap-1.5">
            <select value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input flex-1">
              {acciones.map((a) => (
                <option key={a.id} value={a.nombre}>
                  {a.nombre}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setAnadiendo(true)}
              title="Añadir una acción al catálogo del equipo"
              className="btn-ghost px-3 text-sm font-semibold"
            >
              +
            </button>
          </div>
        )}

        <label className="label">Descripción</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Ej.: pidió que lo llamemos el lunes para hablar con su socio"
          className="input mb-3 resize-y"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Fecha</label>
            <input type="date" value={fecha} min={datos.hoy} onChange={(e) => setFecha(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Responsable</label>
            <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)} className="input">
              <option value="">Sin responsable</option>
              {datos.responsables.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
            Cancelar
          </button>
          <button type="button" onClick={() => void crear()} disabled={guardando} className="btn-primary text-sm disabled:opacity-50">
            {guardando ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}
