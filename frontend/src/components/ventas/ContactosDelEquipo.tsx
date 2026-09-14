'use client';

/**
 * «Contactos» del equipo: la base completa, filtrable y trabajable en lote.
 *
 * Antes era la lista plana de leads con un buscador. En TeamClubify es donde se
 * trabaja la base, y es lo que se pidió:
 *  · filtros por etiqueta, columna del CRM y origen, y listas guardadas;
 *  · selección de la página o de TODOS los del filtro, y acciones en lote:
 *    etiquetar, inscribir en un flujo, eliminar;
 *  · «+ Nuevo» que avisa si esa persona ya la tiene otro equipo de la marca.
 *
 * Colores por tokens: bajo `.brand-panel` Sellea pone su coral sin tocar esto.
 * Ojo: nada de `hover:border-brand…` — el tema de marca casa `border-brand` por
 * subcadena y lo pintaría siempre.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

const SIN_ETIQUETA = '__sin__';

type Filtros = { q?: string; etiqueta?: string; columna?: string; origen?: string };

type Fila = {
  id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  empresa: string | null;
  etiquetas: string[];
  columna: { id: string; name: string; color: string | null } | null;
  origen: string | null;
  vendedor: string | null;
  valor: number | null;
  ganado: boolean;
  ultimaActividad: string;
};

type Respuesta = {
  team: { id: string; name: string };
  puedeEscribir: boolean;
  puedeBorrar: boolean;
  pagina: number;
  porPagina: number;
  total: number;
  etiquetas: string[];
  origenes: string[];
  columnas: { id: string; name: string; color: string | null }[];
  filas: Fila[];
};

type Vista = { id: string; nombre: string; filtros: Filtros };

type Duplicado =
  | { encontrado: false }
  | {
      encontrado: true;
      leadNombre: string | null;
      equipoNombre: string;
      equipoColor: string | null;
      lider: string | null;
      ultimaActividad: string | null;
      columna: string | null;
      valor: number | null;
    };

const aQuery = (f: Filtros, pagina?: number) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (pagina) p.set('pagina', String(pagina));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : 'sin registro';

export function ContactosDelEquipo() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({});
  const [q, setQ] = useState('');
  const [cargando, setCargando] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [vistas, setVistas] = useState<Vista[]>([]);
  const [flujos, setFlujos] = useState<{ id: string; nombre: string }[]>([]);
  const [etiquetaLote, setEtiquetaLote] = useState('');
  const [flujoLote, setFlujoLote] = useState('');
  const [seleccionandoTodos, setSeleccionandoTodos] = useState(false);
  const [creando, setCreando] = useState(false);
  /** Acción en lote en curso, con su progreso («200 / 3000»). null = libre. */
  const [ocupado, setOcupado] = useState<string | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(
    async (f: Filtros, pagina = 1, mantenerSeleccion = false) => {
      if (!teamId) return;
      const esta = ++secuencia.current;
      setCargando(true);
      try {
        const r = await api<Respuesta>(`/sales-teams/${teamId}/contactos${aQuery(f, pagina)}`);
        if (esta !== secuencia.current) return;
        setDatos(r);
        // Al paginar se conserva: tras «seleccionar los 3.000 del filtro», mirar
        // la página 2 no puede deshacer la selección (Fable, 2026-09-14).
        if (!mantenerSeleccion) setSel(new Set());
        setError(null);
      } catch (e: any) {
        if (esta !== secuencia.current) return;
        setError(
          e?.status === 404
            ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
            : e?.message || 'No se pudieron cargar los contactos',
        );
      } finally {
        if (esta === secuencia.current) setCargando(false);
      }
    },
    [teamId],
  );

  useEffect(() => {
    void cargar({}, 1);
    if (!teamId) return;
    api<{ vistas: Vista[] }>(`/sales-teams/${teamId}/contactos/vistas`)
      .then((r) => setVistas(r.vistas))
      .catch(() => null);
    api<{ flujos: { id: string; nombre: string }[] }>(`/sales-teams/${teamId}/contactos/flujos`)
      .then((r) => setFlujos(r.flujos))
      .catch(() => null);
  }, [cargar, teamId]);

  function aplicar(cambio: Filtros) {
    const f = { ...filtros, ...cambio };
    setFiltros(f);
    void cargar(f, 1);
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

  if (!datos) {
    return <div className="h-32 bg-bg2 rounded animate-shimmer" />;
  }

  const paginas = Math.max(1, Math.ceil(datos.total / datos.porPagina));
  const todosMarcados = datos.filas.length > 0 && datos.filas.every((r) => sel.has(r.id));
  const puedeSeleccionarTodos = todosMarcados && datos.total > sel.size;

  const alternarTodos = () => setSel(todosMarcados ? new Set() : new Set(datos.filas.map((r) => r.id)));
  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function seleccionarTodosDelFiltro() {
    setSeleccionandoTodos(true);
    try {
      const r = await api<{ ids: string[]; tope: boolean }>(`/sales-teams/${teamId}/contactos/ids${aQuery(filtros)}`);
      setSel(new Set(r.ids));
      if (r.tope) toast(`Se seleccionaron los primeros ${r.ids.length}. Afina el filtro para el resto.`, 'info');
    } catch (e: any) {
      toast(e?.message || 'No se pudo seleccionar', 'error');
    } finally {
      setSeleccionandoTodos(false);
    }
  }

  /**
   * Una acción en lote, TROCEADA y en serie, con progreso.
   *
   * Mandarlo todo en una petición tenía dos problemas (Fable, 2026-09-14): el
   * servidor acepta como mucho 5.000 ids —y «seleccionar los del filtro» deja
   * 20.000—, e inscribir en un flujo puede tardar un segundo por lead. Una
   * petición de minutos la corta el proxy, la persona reintenta, y un segundo
   * bucle en paralelo duplica inscripciones. Por trozos, cada petición es
   * corta, el botón queda bloqueado mientras corre y se ve cuánto falta.
   */
  async function lote(ruta: string, body: Record<string, unknown>, tamano: number) {
    const ids = [...sel];
    const suma: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += tamano) {
      setOcupado(`${Math.min(i + tamano, ids.length)} / ${ids.length}`);
      const r = await api<Record<string, number>>(`/sales-teams/${teamId}/contactos/lote/${ruta}`, {
        method: 'POST',
        body: JSON.stringify({ ids: ids.slice(i, i + tamano), ...body }),
      });
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') suma[k] = (suma[k] ?? 0) + v;
    }
    return suma;
  }

  async function etiquetar() {
    if (ocupado || !etiquetaLote.trim() || !sel.size) return;
    try {
      const r = await lote('etiquetar', { etiqueta: etiquetaLote.trim() }, 5000);
      toast(`Etiqueta añadida a ${r.cuenta ?? 0} contacto(s).`, 'success');
      setEtiquetaLote('');
      void cargar(filtros, datos!.pagina);
    } catch (e: any) {
      toast(e?.message || 'No se pudo etiquetar', 'error');
    } finally {
      setOcupado(null);
    }
  }

  async function inscribir() {
    if (ocupado || !flujoLote || !sel.size) return;
    try {
      // De 100 en 100: cada lead puede disparar un envío en línea.
      const r = await lote('inscribir', { flujoId: flujoLote }, 100);
      const partes = [`${r.inscritos ?? 0} inscrito(s)`];
      if (r.omitidos) partes.push(`${r.omitidos} ya estaban o no aceptan mensajes`);
      if (r.sinContacto) partes.push(`${r.sinContacto} sin teléfono ni correo`);
      if (r.fallidos) partes.push(`${r.fallidos} con error`);
      toast(partes.join(' · '), r.fallidos ? 'error' : 'success');
      setFlujoLote('');
    } catch (e: any) {
      toast(e?.message || 'No se pudo inscribir', 'error');
    } finally {
      setOcupado(null);
    }
  }

  async function eliminar() {
    if (ocupado || !sel.size) return;
    if (
      !confirm(
        `¿Eliminar ${sel.size} contacto(s)?\n\nSe borran también su historial, seguimientos y mensajes. ` +
          'Se omiten los que tienen una venta cerrada. No se puede deshacer.',
      )
    )
      return;
    try {
      const r = await lote('eliminar', {}, 5000);
      toast(
        `${r.eliminados ?? 0} eliminado(s)${r.omitidos ? `, ${r.omitidos} omitido(s) por tener una venta` : ''}.`,
        'success',
      );
      void cargar(filtros, 1);
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
    } finally {
      setOcupado(null);
    }
  }

  async function guardarLista() {
    const nombre = window.prompt('Nombre de la lista:');
    if (!nombre?.trim()) return;
    try {
      const v = await api<Vista>(`/sales-teams/${teamId}/contactos/vistas`, {
        method: 'POST',
        // Los filtros APLICADOS, no el cuadro de búsqueda: si alguien escribió sin
        // pulsar Enter, la lista guardaría un filtro distinto del que está viendo.
        body: JSON.stringify({ nombre: nombre.trim(), filtros }),
      });
      setVistas((vs) => [...vs, v]);
      toast('Lista guardada.', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar la lista', 'error');
    }
  }

  async function borrarLista(id: string) {
    if (!confirm('¿Eliminar esta lista guardada?')) return;
    try {
      await api(`/sales-teams/${teamId}/contactos/vistas/${id}`, { method: 'DELETE' });
      setVistas((vs) => vs.filter((v) => v.id !== id));
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar la lista', 'error');
    }
  }

  const fichaDe = (id: string) => `/admin/sales-teams/${teamId}/board?lead=${id}`;

  return (
    <div className="flex flex-col gap-3">
      <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />

      {vistas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-mute">Listas:</span>
          {vistas.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs"
            >
              <button
                onClick={() => {
                  setFiltros(v.filtros);
                  setQ(v.filtros.q ?? '');
                  void cargar(v.filtros, 1);
                }}
                className="text-ink hover:underline"
              >
                {v.nombre}
              </button>
              {datos.puedeEscribir && (
                <button
                  onClick={() => void borrarLista(v.id)}
                  className="text-mute2 hover:text-bad-ink"
                  aria-label={`Eliminar la lista ${v.nombre}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            aplicar({ q: q.trim() || undefined });
          }}
          className="contents"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nombre, empresa, correo, teléfono…"
            className="input h-9 text-sm w-full max-w-xs"
          />
        </form>
        <select
          value={filtros.etiqueta ?? ''}
          onChange={(e) => aplicar({ etiqueta: e.target.value || undefined })}
          className="input h-9 text-sm w-auto"
          aria-label="Filtrar por etiqueta"
        >
          <option value="">Todas las etiquetas</option>
          <option value={SIN_ETIQUETA}>— Sin etiqueta —</option>
          {datos.etiquetas.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={filtros.columna ?? ''}
          onChange={(e) => aplicar({ columna: e.target.value || undefined })}
          className="input h-9 text-sm w-auto"
          aria-label="Filtrar por columna del CRM"
        >
          <option value="">Todas las columnas</option>
          {datos.columnas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filtros.origen ?? ''}
          onChange={(e) => aplicar({ origen: e.target.value || undefined })}
          className="input h-9 text-sm w-auto"
          aria-label="Filtrar por origen"
        >
          <option value="">Todos los orígenes</option>
          {datos.origenes.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {datos.puedeEscribir && (
          <button onClick={() => void guardarLista()} className="btn-ghost text-xs h-9">
            ☆ Guardar lista
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-mute tabular-nums">{datos.total} contacto(s)</span>
          {datos.puedeEscribir && (
            <button onClick={() => setCreando(true)} className="btn-primary text-sm">
              + Nuevo
            </button>
          )}
        </div>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-brand-soft px-3 py-2">
          <span className="text-xs font-medium text-brand">{sel.size} seleccionado(s)</span>
          {ocupado && <span className="text-xs text-mute tabular-nums">Procesando {ocupado}…</span>}
          {puedeSeleccionarTodos && (
            <button
              onClick={() => void seleccionarTodosDelFiltro()}
              disabled={seleccionandoTodos}
              className="text-xs font-medium text-brand underline disabled:opacity-50"
            >
              {seleccionandoTodos ? 'Seleccionando…' : `Seleccionar los ${datos.total} del filtro`}
            </button>
          )}
          {datos.puedeEscribir && (
            <>
              <div className="flex items-center gap-1">
                <input
                  value={etiquetaLote}
                  onChange={(e) => setEtiquetaLote(e.target.value)}
                  placeholder="Etiqueta…"
                  className="input h-8 text-xs w-32"
                />
                <button
                  onClick={() => void etiquetar()}
                  disabled={!!ocupado}
                  className="btn-ghost h-8 text-xs bg-white disabled:opacity-50"
                >
                  🏷 Etiquetar
                </button>
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={flujoLote}
                  onChange={(e) => setFlujoLote(e.target.value)}
                  className="input h-8 text-xs w-auto"
                  aria-label="Flujo en el que inscribir"
                >
                  <option value="">{flujos.length ? 'Inscribir en flujo…' : 'Sin flujos publicados'}</option>
                  {flujos.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.nombre}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void inscribir()}
                  disabled={!flujoLote || !!ocupado}
                  className="btn-ghost h-8 text-xs bg-white disabled:opacity-50"
                >
                  Inscribir
                </button>
              </div>
            </>
          )}
          {datos.puedeBorrar && (
            <button
              onClick={() => void eliminar()}
              disabled={!!ocupado}
              className="h-8 rounded-md border border-line bg-white px-2 text-xs font-medium text-bad-ink hover:bg-bad-soft disabled:opacity-50"
            >
              🗑 Eliminar
            </button>
          )}
          <button onClick={() => setSel(new Set())} className="ml-auto text-xs text-mute hover:underline">
            Deseleccionar
          </button>
        </div>
      )}

      {/* Móvil: una tarjeta por contacto. La tabla pide 720 px y en un teléfono
          había que arrastrar de lado para leer una fila. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {cargando ? (
          <p className="card card-pad text-center text-mute">Cargando…</p>
        ) : datos.filas.length === 0 ? (
          <p className="card card-pad text-center text-mute">Sin contactos.</p>
        ) : (
          datos.filas.map((r) => (
            <div key={r.id} className={`card p-3 ${sel.has(r.id) ? 'bg-brand-soft' : ''}`}>
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={sel.has(r.id)}
                  onChange={() => alternar(r.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-brand"
                  aria-label={`Seleccionar ${r.nombre ?? 'contacto'}`}
                />
                <Link href={fichaDe(r.id)} className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{r.nombre ?? 'Sin nombre'}</p>
                  {r.telefono && <p className="text-sm tabular-nums text-mute">{r.telefono}</p>}
                  {r.empresa && <p className="truncate text-xs text-mute">{r.empresa}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {r.columna && <Columna c={r.columna} />}
                    {r.origen && <span className="text-[11px] text-mute">· {r.origen}</span>}
                    {r.etiquetas.slice(0, 2).map((t) => (
                      <span key={t} className="rounded-full bg-bg2 px-2 py-0.5 text-[10px] text-mute">
                        {t}
                      </span>
                    ))}
                    {r.etiquetas.length > 2 && <span className="text-[10px] text-mute">+{r.etiquetas.length - 2}</span>}
                  </div>
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card overflow-hidden p-0 hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={todosMarcados}
                    onChange={alternarTodos}
                    className="accent-brand"
                    aria-label="Seleccionar la página"
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Nombre</th>
                <th className="px-3 py-2 font-semibold">Teléfono</th>
                <th className="px-3 py-2 font-semibold">Empresa</th>
                <th className="px-3 py-2 font-semibold">Etiquetas</th>
                <th className="px-3 py-2 font-semibold">Columna</th>
                <th className="px-3 py-2 font-semibold">Origen</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-mute">
                    Cargando…
                  </td>
                </tr>
              ) : datos.filas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-mute">
                    Sin contactos.
                  </td>
                </tr>
              ) : (
                datos.filas.map((r) => (
                  <tr key={r.id} className={`border-t border-line2 hover:bg-bg2/40 ${sel.has(r.id) ? 'bg-brand-soft' : ''}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={sel.has(r.id)}
                        onChange={() => alternar(r.id)}
                        className="accent-brand"
                        aria-label={`Seleccionar ${r.nombre ?? 'contacto'}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={fichaDe(r.id)} className="font-medium text-ink hover:underline">
                        {r.nombre ?? 'Sin nombre'}
                      </Link>
                      {r.email && <p className="text-xs text-mute">{r.email}</p>}
                    </td>
                    <td className="px-3 py-2 text-mute tabular-nums">{r.telefono || '—'}</td>
                    <td className="px-3 py-2 text-mute">{r.empresa || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.etiquetas.slice(0, 3).map((t) => (
                          <span key={t} className="rounded-full bg-bg2 px-2 py-0.5 text-[10px] text-mute">
                            {t}
                          </span>
                        ))}
                        {r.etiquetas.length > 3 && <span className="text-[10px] text-mute">+{r.etiquetas.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.columna ? <Columna c={r.columna} /> : <span className="text-mute2">—</span>}</td>
                    <td className="px-3 py-2 text-xs text-mute">{r.origen || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            disabled={datos.pagina <= 1}
            onClick={() => void cargar(filtros, datos.pagina - 1, true)}
            className="btn-ghost px-3 py-1 disabled:opacity-40"
            aria-label="Página anterior"
          >
            ←
          </button>
          <span className="text-mute tabular-nums">
            {datos.pagina} / {paginas}
          </span>
          <button
            disabled={datos.pagina >= paginas}
            onClick={() => void cargar(filtros, datos.pagina + 1, true)}
            className="btn-ghost px-3 py-1 disabled:opacity-40"
            aria-label="Página siguiente"
          >
            →
          </button>
        </div>
      )}

      {creando && (
        <NuevoContacto
          teamId={teamId}
          equipoNombre={datos.team.name}
          onCerrar={() => setCreando(false)}
          onCreado={() => {
            setCreando(false);
            void cargar(filtros, 1);
          }}
        />
      )}
    </div>
  );
}

function Columna({ c }: { c: { name: string; color: string | null } }) {
  // El color de la columna lo elige el equipo en el CRM: es dato, no tema.
  const color = c.color || '#94a3b8';
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${color}22`, color }}
    >
      {c.name}
    </span>
  );
}

/**
 * «+ Nuevo» con aviso de duplicado.
 *
 * Antes de crear pregunta si otro equipo de la marca ya tiene a esa persona.
 * No se crea nada por su cuenta: quien lo ve decide cancelar o crearlo aquí de
 * todos modos, sabiendo que dos equipos le podrían escribir.
 */
function NuevoContacto({
  teamId,
  equipoNombre,
  onCerrar,
  onCreado,
}: {
  teamId: string;
  equipoNombre: string;
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [dup, setDup] = useState<Extract<Duplicado, { encontrado: true }> | null>(null);

  async function crear(saltarAviso = false) {
    if (!nombre.trim()) {
      toast('El nombre es obligatorio', 'error');
      return;
    }
    setGuardando(true);
    try {
      if (!saltarAviso && telefono.trim()) {
        const d = await api<Duplicado>(
          `/sales-teams/${teamId}/contactos/duplicado?telefono=${encodeURIComponent(telefono.trim())}`,
        );
        if (d.encontrado) {
          setDup(d);
          return;
        }
      }
      const r = await api<{ yaExistia?: boolean }>(`/sales-teams/${teamId}/leads`, {
        method: 'POST',
        body: JSON.stringify({
          name: nombre.trim(),
          phone: telefono.trim() || null,
          email: email.trim() || null,
          company: empresa.trim() || null,
        }),
      });
      toast(r.yaExistia ? 'Esa persona ya estaba en este equipo.' : 'Contacto creado.', r.yaExistia ? 'info' : 'success');
      onCreado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo crear el contacto', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative w-full max-w-md card card-pad">
        {dup ? (
          <>
            <h3 className="m-0 text-base font-semibold text-ink">Este contacto ya lo tiene otro equipo</h3>
            <p className="mt-2 text-sm text-ink">
              <b>{dup.leadNombre ?? 'Esta persona'}</b> es de{' '}
              <span className="font-semibold">{dup.equipoNombre}</span>. Si lo creas aquí, dos equipos podrían
              escribirle.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-bg2 p-3 text-xs">
              <Dato etiqueta="Líder del equipo" valor={dup.lider} />
              <Dato etiqueta="Columna" valor={dup.columna} />
              <Dato etiqueta="Última actividad" valor={fecha(dup.ultimaActividad)} />
              <Dato
                etiqueta="Valor"
                valor={dup.valor ? `$${dup.valor.toLocaleString('es-CO')}` : null}
              />
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={onCerrar} className="btn-ghost text-sm">
                Cancelar
              </button>
              <button onClick={() => setDup(null)} className="btn-ghost text-sm">
                Volver a editar
              </button>
              <button
                onClick={() => void crear(true)}
                disabled={guardando}
                className="btn-primary text-sm disabled:opacity-50"
              >
                Crear en {equipoNombre} de todos modos
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void crear();
            }}
            className="flex flex-col gap-2"
          >
            <h3 className="m-0 mb-1 text-base font-semibold text-ink">Nuevo contacto</h3>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido *" className="input" autoFocus />
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="WhatsApp (+57…)" className="input" inputMode="tel" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" className="input" type="email" />
            <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Empresa" className="input" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
                Cancelar
              </button>
              <button type="submit" disabled={guardando} className="btn-primary text-sm disabled:opacity-50">
                {guardando ? 'Guardando…' : 'Crear'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-mute">{etiqueta}</p>
      <p className="truncate text-ink">{valor || '—'}</p>
    </div>
  );
}
