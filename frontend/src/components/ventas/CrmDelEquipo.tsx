'use client';

/**
 * «CRM» del equipo: embudos de OPORTUNIDADES, como en TeamClubify.
 *
 * No es el tablero de leads (eso es «Leads»): aquí cada tarjeta es un negocio
 * abierto con un contacto —con su valor, su responsable y su estado— y un
 * contacto puede tener varias, en embudos distintos. Ganar una pasa el lead a
 * Clientes con ese valor; lo hace el servidor, por la misma puerta del tablero.
 *
 * Colores por tokens; el color de cada etapa es dato del equipo y va en línea.
 * Nada de `hover:border-brand…`: el tema de marca casa `border-brand` por
 * subcadena y lo pintaría siempre.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

type Estado = 'abierta' | 'ganada' | 'perdida' | 'abandonada';

const ESTADOS: { valor: Estado; label: string; clase: string }[] = [
  { valor: 'abierta', label: 'Abierta', clase: 'bg-bg2 text-mute' },
  { valor: 'ganada', label: 'Ganada', clase: 'bg-ok-soft text-ok-ink' },
  { valor: 'perdida', label: 'Perdida', clase: 'bg-bad-soft text-bad-ink' },
  { valor: 'abandonada', label: 'Abandonada', clase: 'bg-warn-soft text-warn-ink' },
];
const SIN_RESPONSABLE = '__sin__';
const GRIS = '#94a3b8';

type Etapa = { id: string; nombre: string; color: string | null; cuantas: number; valor: number };

type Oportunidad = {
  id: string;
  nombre: string;
  valor: number;
  estado: Estado;
  etapaId: string;
  posicion: number;
  origen: string | null;
  motivo: string | null;
  responsableId: string | null;
  responsable: string | null;
  ganadaEl: string | null;
  perdidaEl: string | null;
  creadaEl: string;
  lead: { id: string; nombre: string | null; empresa: string | null; telefono: string | null } | null;
};

type Filtros = { responsable?: string; estado?: string; q?: string };

type Tablero = {
  team: { id: string; name: string; isActive?: boolean };
  puedeEscribir: boolean;
  puedeConfigurar: boolean;
  filtros: Filtros;
  embudos: { id: string; nombre: string }[];
  embudo: { id: string; nombre: string };
  etapas: Etapa[];
  abierto: number;
  total: number;
  truncado: boolean;
  responsables: { id: string; nombre: string }[];
  oportunidades: Oportunidad[];
};

type Contacto = { id: string; nombre: string | null; empresa: string | null; telefono: string | null };

const dinero = (n: number) => `$${(Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;

// El último embudo abierto, UNO POR EQUIPO: con una sola memoria para todos, al
// entrar al CRM de otro equipo se abría un embudo que no es suyo (le pasó a la
// referencia).
const claveDeEmbudo = (teamId: string) => `crm-embudo:${teamId}`;
function embudoRecordado(teamId: string): string | null {
  try {
    return localStorage.getItem(claveDeEmbudo(teamId));
  } catch {
    return null;
  }
}
function recordarEmbudo(teamId: string, id: string) {
  try {
    localStorage.setItem(claveDeEmbudo(teamId), id);
  } catch {
    /* sin almacenamiento se abre el primero, que también vale */
  }
}

export function CrmDelEquipo() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Tablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embudoId, setEmbudoId] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({});
  const [q, setQ] = useState('');
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [destino, setDestino] = useState<{ etapaId: string; antesDe: string | null } | null>(null);
  const [modal, setModal] = useState<{ tipo: 'crear'; etapaId: string } | { tipo: 'editar'; id: string } | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const secuencia = useRef(0);

  const cargar = useCallback(
    async (embudo: string | null, f: Filtros) => {
      if (!teamId) return;
      const esta = ++secuencia.current;
      const p = new URLSearchParams();
      if (embudo) p.set('embudo', embudo);
      for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
      const s = p.toString();
      try {
        const r = await api<Tablero>(`/sales-teams/${teamId}/crm${s ? `?${s}` : ''}`);
        if (esta !== secuencia.current) return;
        setDatos(r);
        setEmbudoId(r.embudo.id);
        recordarEmbudo(teamId, r.embudo.id);
        setError(null);
      } catch (e: any) {
        if (esta !== secuencia.current) return;
        setError(
          e?.status === 404
            ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
            : e?.message || 'No se pudo cargar el CRM',
        );
      }
    },
    [teamId],
  );

  useEffect(() => {
    void cargar(embudoRecordado(teamId), {});
  }, [cargar, teamId]);

  const recargar = useCallback(() => cargar(embudoId, filtros), [cargar, embudoId, filtros]);

  const porEtapa = useMemo(() => {
    const m = new Map<string, Oportunidad[]>();
    for (const e of datos?.etapas ?? []) m.set(e.id, []);
    for (const o of datos?.oportunidades ?? []) {
      if (!m.has(o.etapaId)) m.set(o.etapaId, []);
      m.get(o.etapaId)!.push(o);
    }
    for (const lista of m.values()) lista.sort((a, b) => a.posicion - b.posicion);
    return m;
  }, [datos]);

  function aplicar(cambio: Filtros) {
    const f = { ...filtros, ...cambio };
    setFiltros(f);
    void cargar(embudoId, f);
  }

  /**
   * Suelta la tarjeta que se arrastra en una etapa, antes de la tarjeta sobre la
   * que se soltó (o al final). Se pinta antes de que responda el servidor
   * —arrastrar y esperar se siente roto— mandando la etapa de la que venía: si
   * otra persona la movió antes, el servidor no pisa su cambio.
   */
  async function soltar(etapaId: string) {
    const id = arrastrando;
    const d = destino;
    setArrastrando(null);
    setDestino(null);
    if (!id || !datos?.puedeEscribir) return;
    const o = datos.oportunidades.find((x) => x.id === id);
    if (!o) return;
    // Soltarla sobre sí misma no es moverla: antes la mandaba al final de la
    // columna con cualquier arrastre de dos píxeles (Fable, 2026-09-14).
    if (d?.antesDe === id) return;
    const completa = porEtapa.get(etapaId) ?? [];
    const columna = completa.filter((x) => x.id !== id);
    const antesDe = d && d.etapaId === etapaId ? d.antesDe : null;
    const idx = antesDe ? columna.findIndex((x) => x.id === antesDe) : -1;
    const posicion = idx >= 0 ? idx : columna.length;
    if (o.etapaId === etapaId && completa.findIndex((x) => x.id === id) === posicion) return;

    const orden = [...columna.slice(0, posicion), o, ...columna.slice(posicion)];
    const nuevas = new Map(orden.map((x, i) => [x.id, i]));
    setDatos((prev) =>
      prev
        ? {
            ...prev,
            oportunidades: prev.oportunidades.map((x) =>
              x.id === id
                ? { ...x, etapaId, posicion: nuevas.get(x.id) ?? 0 }
                : nuevas.has(x.id)
                  ? { ...x, posicion: nuevas.get(x.id) ?? x.posicion }
                  : x,
            ),
          }
        : prev,
    );
    try {
      const r = await api<{ ok?: boolean; sinCambios?: boolean }>(
        `/sales-teams/${teamId}/crm/oportunidades/${id}/mover`,
        {
          method: 'PATCH',
          // Antes de qué tarjeta, no el índice: con un filtro puesto aquí solo se
          // ve parte de la columna, y el índice lo calcula el servidor.
          body: JSON.stringify({ etapaId, antesDeId: idx >= 0 ? antesDe : null, etapaActualId: o.etapaId }),
        },
      );
      if (r.sinCambios) toast('Otra persona movió esta oportunidad antes. Te dejo la versión buena.', 'error');
    } catch (e: any) {
      toast(e?.message || 'No se pudo mover', 'error');
    }
    // Siempre se relee: los totales de cada columna los calcula el servidor.
    await recargar();
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

  const editando = modal?.tipo === 'editar' ? (datos.oportunidades.find((o) => o.id === modal.id) ?? null) : null;

  return (
    <div>
      <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={datos.embudo.id}
          onChange={(e) => e.target.value !== datos.embudo.id && void cargar(e.target.value, filtros)}
          className="input h-9 w-auto text-sm font-medium"
          aria-label="Embudo"
        >
          {datos.embudos.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <span className="rounded-pill bg-bg2 px-2.5 py-1 text-xs text-mute tabular-nums">
          {datos.total} oportunidad(es) · {dinero(datos.abierto)} abierto
        </span>
        <div className="ml-auto flex gap-2">
          {datos.puedeConfigurar && (
            <button type="button" className="btn-ghost text-sm" onClick={() => setConfigurando(true)}>
              ⚙ Embudos
            </button>
          )}
          {datos.puedeEscribir && datos.etapas.length > 0 && (
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => setModal({ tipo: 'crear', etapaId: datos.etapas[0].id })}
            >
              + Oportunidad
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') aplicar({ q: q.trim() || undefined });
          }}
          placeholder="Buscar oportunidad o contacto… (Enter)"
          className="input h-9 w-full max-w-xs text-sm"
        />
        <select
          value={filtros.responsable ?? ''}
          onChange={(e) => aplicar({ responsable: e.target.value || undefined })}
          className="input h-9 w-auto text-sm"
          aria-label="Responsable"
        >
          <option value="">Todos los responsables</option>
          <option value={SIN_RESPONSABLE}>Sin responsable</option>
          {datos.responsables.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
        <select
          value={filtros.estado ?? ''}
          onChange={(e) => aplicar({ estado: e.target.value || undefined })}
          className="input h-9 w-auto text-sm"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {datos.truncado && (
        <p className="mb-3 text-xs text-warn-ink">
          Se ven {datos.oportunidades.length} de {datos.total}. Los totales de cada columna sí las cuentan
          todas; filtra para ver el resto.
        </p>
      )}

      {datos.etapas.length === 0 ? (
        <div className="card card-pad py-10 text-center text-sm text-mute">
          Este embudo no tiene etapas.{datos.puedeConfigurar ? ' Abre «⚙ Embudos» para crearlas.' : ''}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {datos.etapas.map((etapa) => {
            const lista = porEtapa.get(etapa.id) ?? [];
            return (
              <section
                key={etapa.id}
                onDragOver={(e) => {
                  if (!datos.puedeEscribir || !arrastrando) return;
                  e.preventDefault();
                  setDestino((d) =>
                    d?.etapaId === etapa.id && d.antesDe === null ? d : { etapaId: etapa.id, antesDe: null },
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void soltar(etapa.id);
                }}
                className={`w-72 shrink-0 rounded-xl border p-2 transition ${
                  destino?.etapaId === etapa.id ? 'border-brand bg-brand-soft' : 'border-line'
                }`}
              >
                <header className="flex items-center gap-2 px-1 pb-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: etapa.color || GRIS }} />
                  <span className="truncate text-sm font-semibold">{etapa.nombre}</span>
                  <span className="ml-auto shrink-0 text-xs text-mute tabular-nums">
                    {etapa.cuantas} · {dinero(etapa.valor)}
                  </span>
                </header>

                <div className="flex min-h-[60px] flex-col gap-2">
                  {lista.map((o) => {
                    const est = ESTADOS.find((s) => s.valor === o.estado);
                    return (
                      <article
                        key={o.id}
                        draggable={datos.puedeEscribir}
                        onDragStart={(e) => {
                          // Firefox no empieza a arrastrar sin datos en `dataTransfer`.
                          e.dataTransfer.setData('text/plain', o.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setArrastrando(o.id);
                        }}
                        onDragEnd={() => {
                          setArrastrando(null);
                          setDestino(null);
                        }}
                        onDragOver={(e) => {
                          if (!datos.puedeEscribir || !arrastrando) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (destino?.antesDe !== o.id) setDestino({ etapaId: etapa.id, antesDe: o.id });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void soltar(etapa.id);
                        }}
                        onClick={() => setModal({ tipo: 'editar', id: o.id })}
                        className={`cursor-pointer rounded-lg border bg-bg p-2.5 transition hover:bg-bg2 ${
                          destino?.antesDe === o.id && arrastrando !== o.id ? 'border-t-2 border-t-brand' : 'border-line'
                        } ${arrastrando === o.id ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-ink">{o.nombre}</div>
                            <div className="truncate text-[11px] text-mute">
                              {o.lead?.nombre || o.lead?.telefono || 'Sin contacto'}
                              {o.lead?.empresa ? ` · ${o.lead.empresa}` : ''}
                            </div>
                          </div>
                          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink">
                            {dinero(o.valor)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-mute">
                          {o.estado !== 'abierta' && est && (
                            <span className={`rounded-pill px-1.5 py-0.5 font-medium ${est.clase}`}>{est.label}</span>
                          )}
                          <span className="ml-auto truncate">{o.responsable ?? 'Sin responsable'}</span>
                        </div>
                      </article>
                    );
                  })}

                  {datos.puedeEscribir && (
                    <button
                      type="button"
                      className="rounded-lg border border-dashed border-line py-1.5 text-xs text-mute hover:text-ink"
                      onClick={() => setModal({ tipo: 'crear', etapaId: etapa.id })}
                    >
                      + Añadir
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {modal && (modal.tipo === 'crear' || editando) && (
        <ModalDeOportunidad
          key={modal.tipo === 'crear' ? `crear:${modal.etapaId}` : modal.id}
          teamId={teamId}
          datos={datos}
          etapaInicial={modal.tipo === 'crear' ? modal.etapaId : undefined}
          oportunidad={editando}
          onCerrar={() => setModal(null)}
          onGuardado={async () => {
            setModal(null);
            await recargar();
          }}
        />
      )}

      {configurando && (
        <ConfigDeEmbudos
          key={datos.embudo.id}
          teamId={teamId}
          datos={datos}
          onCerrar={() => setConfigurando(false)}
          onCambio={async (embudo) => {
            if (embudo === undefined) await recargar();
            else await cargar(embudo, filtros);
          }}
        />
      )}
    </div>
  );
}

// ── Oportunidad: crear y editar ─────────────────────────────────────────────

function ModalDeOportunidad({
  teamId,
  datos,
  etapaInicial,
  oportunidad,
  onCerrar,
  onGuardado,
}: {
  teamId: string;
  datos: Tablero;
  etapaInicial?: string;
  oportunidad: Oportunidad | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const creando = !oportunidad;
  const soloLectura = !datos.puedeEscribir;
  const [nombre, setNombre] = useState(oportunidad?.nombre ?? '');
  const [valor, setValor] = useState(oportunidad && oportunidad.valor ? String(oportunidad.valor) : '');
  const [etapaId, setEtapaId] = useState(oportunidad?.etapaId ?? etapaInicial ?? datos.etapas[0]?.id ?? '');
  const [responsableId, setResponsableId] = useState(oportunidad?.responsableId ?? '');
  const [modoContacto, setModoContacto] = useState<'buscar' | 'nuevo'>('buscar');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Contacto[]>([]);
  const [elegido, setElegido] = useState<Contacto | null>(null);
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoTelefono, setContactoTelefono] = useState('');
  const [motivoPara, setMotivoPara] = useState<'perdida' | 'abandonada' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Con una pausa: una petición por palabra escrita y no una por tecla.
  useEffect(() => {
    if (!creando || modoContacto !== 'buscar' || elegido) return;
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
  }, [busqueda, creando, modoContacto, elegido, teamId]);

  /** Guarda lo escrito. Devuelve false si algo no deja guardar (ya avisado). */
  async function guardarFormulario(): Promise<boolean> {
    const n = valor.trim() === '' ? 0 : Number(valor);
    if (!Number.isFinite(n) || n < 0) {
      toast('El valor tiene que ser un número positivo', 'error');
      return false;
    }
    if (creando) {
      if (modoContacto === 'buscar' && !elegido) {
        toast('Elige un contacto o usa «Nuevo contacto»', 'error');
        return false;
      }
      if (modoContacto === 'nuevo' && !contactoNombre.trim() && !contactoTelefono.trim()) {
        toast('Escribe el nombre o el teléfono del contacto', 'error');
        return false;
      }
      await api(`/sales-teams/${teamId}/crm/oportunidades`, {
        method: 'POST',
        body: JSON.stringify({
          embudoId: datos.embudo.id,
          etapaId,
          nombre: nombre.trim() || undefined,
          valor: n,
          responsableId: responsableId || null,
          ...(modoContacto === 'buscar' && elegido
            ? { leadId: elegido.id }
            : {
                contactoNombre: contactoNombre.trim() || undefined,
                contactoTelefono: contactoTelefono.trim() || undefined,
              }),
        }),
      });
      return true;
    }
    if (!oportunidad) return false;
    await api(`/sales-teams/${teamId}/crm/oportunidades/${oportunidad.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nombre: nombre.trim() || oportunidad.nombre,
        valor: n,
        // Solo si cambió: un responsable que ya salió del equipo no deja guardar,
        // y editar el valor no puede tropezar con eso.
        ...(responsableId !== (oportunidad.responsableId ?? '') ? { responsableId: responsableId || null } : {}),
      }),
    });
    // La etapa va por «mover», no por editar: reordena la columna y no pisa a
    // quien la movió mientras tanto.
    if (etapaId && etapaId !== oportunidad.etapaId) {
      const r = await api<{ sinCambios?: boolean }>(
        `/sales-teams/${teamId}/crm/oportunidades/${oportunidad.id}/mover`,
        { method: 'PATCH', body: JSON.stringify({ etapaId, posicion: 0, etapaActualId: oportunidad.etapaId }) },
      );
      if (r.sinCambios) toast('Otra persona la cambió de etapa antes; se guardó el resto.', 'error');
    }
    return true;
  }

  async function guardar() {
    setGuardando(true);
    try {
      if (await guardarFormulario()) {
        toast(creando ? 'Oportunidad creada.' : 'Guardado.', 'success');
        onGuardado();
      }
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(estado: Estado, conMotivo?: string) {
    if (!oportunidad) return;
    setGuardando(true);
    try {
      // Primero lo escrito: si no, «Ganar» con un valor recién tecleado cerraba
      // la venta con el valor viejo (le pasó a la referencia).
      if (!(await guardarFormulario())) return;
      await api(`/sales-teams/${teamId}/crm/oportunidades/${oportunidad.id}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado, motivo: conMotivo ?? null }),
      });
      toast(
        estado === 'ganada'
          ? '🏆 Ganada. El lead pasa a Clientes.'
          : estado === 'abierta'
            ? 'Oportunidad reabierta.'
            : 'Estado guardado.',
        'success',
      );
      onGuardado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo cambiar el estado', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!oportunidad || !confirm('¿Eliminar esta oportunidad? El contacto no se borra.')) return;
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/crm/oportunidades/${oportunidad.id}`, { method: 'DELETE' });
      toast('Oportunidad eliminada.', 'success');
      onGuardado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  const estadoActual = oportunidad ? ESTADOS.find((s) => s.valor === oportunidad.estado) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto card card-pad">
        <h3 className="m-0 text-base font-semibold text-ink">{creando ? 'Nueva oportunidad' : 'Oportunidad'}</h3>
        {oportunidad && oportunidad.estado !== 'abierta' && estadoActual && (
          <p className="mb-0 mt-1 text-xs text-mute">
            Estado: <span className={`rounded-pill px-1.5 py-0.5 font-medium ${estadoActual.clase}`}>{estadoActual.label}</span>
            {oportunidad.motivo ? ` — ${oportunidad.motivo}` : ''}
          </p>
        )}

        {creando && (
          <div className="mt-3 rounded-lg border border-line p-3">
            <div className="mb-2 flex gap-1 text-xs">
              {(['buscar', 'nuevo'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModoContacto(m)}
                  className={`rounded-pill px-2.5 py-1 font-medium ${
                    modoContacto === m ? 'bg-brand text-white' : 'bg-bg2 text-mute'
                  }`}
                >
                  {m === 'buscar' ? 'Contacto existente' : 'Nuevo contacto'}
                </button>
              ))}
            </div>
            {modoContacto === 'buscar' ? (
              elegido ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {elegido.nombre || elegido.telefono || 'Sin nombre'}
                    {elegido.empresa ? ` · ${elegido.empresa}` : ''}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-mute underline"
                    onClick={() => {
                      setElegido(null);
                      setBusqueda('');
                    }}
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
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
                            setElegido(c);
                            setResultados([]);
                            if (!nombre.trim()) setNombre(c.nombre || '');
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-bg2"
                        >
                          <span className="font-medium text-ink">{c.nombre || c.telefono || 'Sin nombre'}</span>
                          {(c.empresa || c.telefono) && <span className="text-mute"> · {c.empresa || c.telefono}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={contactoNombre}
                  onChange={(e) => setContactoNombre(e.target.value)}
                  placeholder="Nombre"
                  className="input"
                />
                <input
                  value={contactoTelefono}
                  onChange={(e) => setContactoTelefono(e.target.value)}
                  placeholder="Teléfono"
                  className="input"
                />
                <p className="col-span-2 m-0 text-[11px] text-mute">
                  Si ese teléfono ya está en el equipo, se usa el contacto que hay.
                </p>
              </div>
            )}
          </div>
        )}

        {oportunidad?.lead && (
          <p className="mb-0 mt-2 text-xs text-mute">
            Contacto:{' '}
            <span className="font-medium text-ink">
              {oportunidad.lead.nombre || oportunidad.lead.telefono || 'Sin nombre'}
            </span>{' '}
            ·{' '}
            <Link href={`/admin/sales-teams/${teamId}/board?lead=${oportunidad.lead.id}`} className="underline">
              Abrir ficha del lead →
            </Link>
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="label">Nombre de la oportunidad</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Plan PRO – Pizzería Luna"
              className="input"
              maxLength={120}
              disabled={soloLectura}
            />
          </div>
          <div>
            <label className="label">Valor</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="input tabular-nums"
              disabled={soloLectura}
            />
            {Number(valor) > 0 && <p className="m-0 mt-0.5 text-[11px] text-mute tabular-nums">{dinero(Number(valor))}</p>}
          </div>
          <div>
            <label className="label">Etapa</label>
            <select value={etapaId} onChange={(e) => setEtapaId(e.target.value)} className="input" disabled={soloLectura}>
              {datos.etapas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Responsable</label>
            <select
              value={responsableId}
              onChange={(e) => setResponsableId(e.target.value)}
              className="input"
              disabled={soloLectura}
            >
              <option value="">Sin responsable</option>
              {datos.responsables.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
              {oportunidad?.responsableId && !datos.responsables.some((r) => r.id === oportunidad.responsableId) && (
                <option value={oportunidad.responsableId}>{oportunidad.responsable ?? 'Fuera del equipo'}</option>
              )}
            </select>
          </div>
        </div>

        {oportunidad && !soloLectura && (
          <div className="mt-4 border-t border-line pt-3">
            {motivoPara ? (
              <div className="flex flex-col gap-2">
                <label className="label">
                  Motivo {motivoPara === 'perdida' ? 'por el que se perdió' : 'del abandono'} (opcional)
                </label>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="input" maxLength={200} autoFocus />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost text-sm" onClick={() => setMotivoPara(null)}>
                    Volver
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-sm disabled:opacity-50"
                    disabled={guardando}
                    onClick={() => void cambiarEstado(motivoPara, motivo.trim() || undefined)}
                  >
                    Marcar {motivoPara}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {oportunidad.estado !== 'ganada' && (
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => void cambiarEstado('ganada')}
                      className="rounded-lg bg-ok-soft px-3 py-1.5 text-sm font-semibold text-ok-ink disabled:opacity-50"
                    >
                      🏆 Ganar
                    </button>
                  )}
                  {oportunidad.estado !== 'perdida' && (
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => {
                        setMotivo('');
                        setMotivoPara('perdida');
                      }}
                      className="rounded-lg bg-bad-soft px-3 py-1.5 text-sm font-semibold text-bad-ink disabled:opacity-50"
                    >
                      Perder
                    </button>
                  )}
                  {oportunidad.estado !== 'abandonada' && (
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => {
                        setMotivo('');
                        setMotivoPara('abandonada');
                      }}
                      className="btn-ghost text-sm"
                    >
                      Abandonar
                    </button>
                  )}
                  {oportunidad.estado !== 'abierta' && (
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => void cambiarEstado('abierta')}
                      className="btn-ghost text-sm"
                    >
                      Reabrir
                    </button>
                  )}
                </div>
                {oportunidad.estado !== 'ganada' && (
                  <p className="mb-0 mt-2 text-[11px] text-mute">
                    Ganar la pasa a Clientes con el valor de arriba y arranca su implementación.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          {oportunidad && datos.puedeConfigurar && (
            <button
              type="button"
              onClick={() => void eliminar()}
              disabled={guardando}
              className="text-xs text-bad-ink underline disabled:opacity-50"
            >
              Eliminar
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
              {soloLectura ? 'Cerrar' : 'Cancelar'}
            </button>
            {!soloLectura && (
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={guardando}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {guardando ? 'Guardando…' : creando ? 'Crear' : 'Guardar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Embudos y etapas ────────────────────────────────────────────────────────

function ConfigDeEmbudos({
  teamId,
  datos,
  onCerrar,
  onCambio,
}: {
  teamId: string;
  datos: Tablero;
  onCerrar: () => void;
  /** `undefined` relee el embudo actual; un id (o `null`, el primero) cambia de embudo. */
  onCambio: (embudo?: string | null) => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [nombreEmbudo, setNombreEmbudo] = useState(datos.embudo.nombre);
  const [nuevaEtapa, setNuevaEtapa] = useState('');
  const base = `/sales-teams/${teamId}/crm`;
  const etapas = datos.etapas;

  async function correr(fn: () => Promise<string | null | undefined>, ok?: string) {
    setOcupado(true);
    try {
      const embudo = await fn();
      if (ok) toast(ok, 'success');
      await onCambio(embudo);
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
    } finally {
      setOcupado(false);
    }
  }

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= etapas.length) return;
    const ids = etapas.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void correr(async () => {
      await api(`${base}/embudos/${datos.embudo.id}/etapas/orden`, { method: 'PATCH', body: JSON.stringify({ ids }) });
      return undefined;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto card card-pad">
        <h3 className="m-0 mb-3 text-base font-semibold text-ink">Embudos del equipo</h3>

        <label className="label">Nombre de este embudo</label>
        <div className="flex gap-2">
          <input value={nombreEmbudo} onChange={(e) => setNombreEmbudo(e.target.value)} className="input" maxLength={60} />
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={ocupado || !nombreEmbudo.trim() || nombreEmbudo.trim() === datos.embudo.nombre}
            onClick={() =>
              void correr(async () => {
                await api(`${base}/embudos/${datos.embudo.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ nombre: nombreEmbudo.trim() }),
                });
                return undefined;
              }, 'Embudo renombrado.')
            }
          >
            Renombrar
          </button>
        </div>

        <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-mute">Etapas</p>
        <div className="flex flex-col gap-1.5">
          {etapas.map((s, i) => (
            <FilaDeEtapa
              key={`${s.id}:${s.nombre}:${s.color ?? ''}`}
              etapa={s}
              primera={i === 0}
              ultima={i === etapas.length - 1}
              ocupado={ocupado}
              onGuardar={(cambio) =>
                void correr(async () => {
                  await api(`${base}/etapas/${s.id}`, { method: 'PATCH', body: JSON.stringify(cambio) });
                  return undefined;
                })
              }
              onSubir={() => mover(i, -1)}
              onBajar={() => mover(i, 1)}
              onBorrar={() => {
                if (!confirm(`¿Eliminar la etapa «${s.nombre}»?`)) return;
                void correr(async () => {
                  await api(`${base}/etapas/${s.id}`, { method: 'DELETE' });
                  return undefined;
                }, 'Etapa eliminada.');
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={nuevaEtapa}
            onChange={(e) => setNuevaEtapa(e.target.value)}
            placeholder="Nueva etapa"
            className="input"
            maxLength={40}
          />
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={ocupado || !nuevaEtapa.trim()}
            onClick={() =>
              void correr(async () => {
                await api(`${base}/embudos/${datos.embudo.id}/etapas`, {
                  method: 'POST',
                  body: JSON.stringify({ nombre: nuevaEtapa.trim() }),
                });
                setNuevaEtapa('');
                return undefined;
              }, 'Etapa añadida.')
            }
          >
            Añadir
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={ocupado}
            onClick={() => {
              const nombre = window.prompt('Nombre del embudo nuevo:');
              if (!nombre?.trim()) return;
              void correr(async () => {
                const r = await api<{ id: string }>(`${base}/embudos`, {
                  method: 'POST',
                  body: JSON.stringify({ nombre: nombre.trim() }),
                });
                return r.id;
              }, 'Embudo creado.');
            }}
          >
            + Nuevo embudo
          </button>
          {datos.embudos.length > 1 && (
            <button
              type="button"
              className="ml-auto text-xs text-bad-ink underline disabled:opacity-50"
              disabled={ocupado}
              onClick={() => {
                if (
                  !confirm(
                    `¿Eliminar el embudo «${datos.embudo.nombre}» y TODAS sus oportunidades?\n\n` +
                      'Los contactos no se borran. No se puede deshacer.',
                  )
                )
                  return;
                void correr(async () => {
                  await api(`${base}/embudos/${datos.embudo.id}`, { method: 'DELETE' });
                  return null;
                }, 'Embudo eliminado.');
              }}
            >
              Eliminar este embudo
            </button>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onCerrar} className="btn-primary text-sm">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

function FilaDeEtapa({
  etapa,
  primera,
  ultima,
  ocupado,
  onGuardar,
  onSubir,
  onBajar,
  onBorrar,
}: {
  etapa: Etapa;
  primera: boolean;
  ultima: boolean;
  ocupado: boolean;
  onGuardar: (cambio: { nombre?: string; color?: string }) => void;
  onSubir: () => void;
  onBajar: () => void;
  onBorrar: () => void;
}) {
  const [nombre, setNombre] = useState(etapa.nombre);
  // El color se guarda al soltar el selector, no en cada paso: arrastrar por la
  // paleta dispara decenas de cambios y serían decenas de peticiones.
  const [color, setColor] = useState(etapa.color || GRIS);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        onBlur={() => {
          if (color !== (etapa.color || GRIS)) onGuardar({ color });
        }}
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-line bg-bg p-0.5"
        aria-label={`Color de ${etapa.nombre}`}
        disabled={ocupado}
      />
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onBlur={() => {
          const n = nombre.trim();
          if (n && n !== etapa.nombre) onGuardar({ nombre: n });
          else setNombre(etapa.nombre);
        }}
        className="input h-8 text-sm"
        maxLength={40}
        disabled={ocupado}
      />
      <span className="w-6 shrink-0 text-right text-[11px] text-mute tabular-nums" title="Oportunidades en esta etapa">
        {etapa.cuantas}
      </span>
      <button
        type="button"
        onClick={onSubir}
        disabled={ocupado || primera}
        className="h-7 w-7 shrink-0 rounded text-xs text-mute hover:bg-bg2 disabled:opacity-30"
        aria-label={`Subir ${etapa.nombre}`}
      >
        ↑
      </button>
      <button
        type="button"
        onClick={onBajar}
        disabled={ocupado || ultima}
        className="h-7 w-7 shrink-0 rounded text-xs text-mute hover:bg-bg2 disabled:opacity-30"
        aria-label={`Bajar ${etapa.nombre}`}
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onBorrar}
        disabled={ocupado}
        className="h-7 w-7 shrink-0 rounded text-xs text-bad-ink hover:bg-bad-soft disabled:opacity-30"
        aria-label={`Eliminar ${etapa.nombre}`}
      >
        ✕
      </button>
    </div>
  );
}
