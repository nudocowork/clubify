'use client';

/**
 * El tablero de un equipo de ventas de marca — fase 3.
 *
 * POR QUÉ NO REUTILIZA `CrmKanban`
 * --------------------------------
 * El kanban de afiliados (`/affiliate/crm/CrmKanban.tsx`, 1.400 líneas) tiene
 * catorce llamadas con la ruta `/crm/...` escrita a mano y repartidas por sus
 * subcomponentes. Parametrizarlo obliga a hilar una prop por dentro de un
 * fichero vivo del CRM de Jhon, que además se sincroniza por OneDrive entre las
 * dos máquinas. El riesgo no compensa: esto es la mitad de código y no toca
 * nada suyo.
 *
 * Lo que sí se comparte es la FORMA de la API, así que si algún día conviene
 * unificarlos, el trabajo es de la interfaz y no del backend.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Columna = {
  id: string;
  name: string;
  kind: string | null;
  color: string | null;
  position: number;
};

type Lead = {
  id: string;
  stageId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  source: string | null;
  value: number | null;
  tags: string[];
  wonAt: string | null;
  assignedUserId: string | null;
  assignedTo: string | null;
  lastActivityAt: string;
  createdAt: string;
};

type Actividad = {
  id: string;
  kind: string;
  body: string | null;
  createdAt: string;
};

type Tablero = {
  team: { id: string; name: string; whiteLabelId: string | null; isActive: boolean };
  puedeEscribir: boolean;
  esAdminDeMarca: boolean;
  misRoles: string[];
  columnas: Columna[];
  leads: Lead[];
  total: number;
  truncado: boolean;
};

const GRIS = '#64748b';

/** Iniciales para el avatar de la tarjeta. «Ana Ruiz» → «AR». */
function iniciales(nombre: string | null): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return partes.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** «hace 3 días», que es lo que el vendedor necesita saber de un vistazo. */
function desdeHace(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  const m = Math.floor(d / 30);
  return m === 1 ? 'hace 1 mes' : `hace ${m} meses`;
}

export default function TableroDelEquipo() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';

  const [datos, setDatos] = useState<Tablero | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [nuevoEn, setNuevoEn] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  // En móvil las columnas no caben en fila: se ven de una en una.
  const [columnaMovil, setColumnaMovil] = useState(0);

  const cargar = useCallback(async () => {
    if (!teamId) return;
    try {
      const r = await api<Tablero>(`/sales-teams/${teamId}/board`);
      setDatos(r);
      setError(null);
    } catch (e: any) {
      // Un 404 aquí casi siempre es el módulo apagado para esa marca, no un id
      // mal escrito. Decirlo ahorra el viaje de ida y vuelta.
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : (e?.message ?? 'No se pudo cargar el tablero.'),
      );
    } finally {
      setCargando(false);
    }
  }, [teamId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const porColumna = useMemo(() => {
    const mapa = new Map<string, Lead[]>();
    for (const c of datos?.columnas ?? []) mapa.set(c.id, []);
    for (const l of datos?.leads ?? []) {
      if (!mapa.has(l.stageId)) mapa.set(l.stageId, []);
      mapa.get(l.stageId)!.push(l);
    }
    return mapa;
  }, [datos]);

  /**
   * Mueve la tarjeta.
   *
   * Se pinta el cambio antes de que responda el servidor —arrastrar y esperar
   * medio segundo se siente roto— pero mandando de dónde venía. Si otro
   * vendedor la movió mientras tanto, el servidor no pisa su cambio y devuelve
   * la columna real: se recarga y se avisa, en vez de dejar la pantalla
   * mintiendo.
   */
  async function mover(leadId: string, stageId: string) {
    if (!datos?.puedeEscribir) return;
    const lead = datos.leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const origen = lead.stageId;

    setDatos((d) =>
      d
        ? { ...d, leads: d.leads.map((l) => (l.id === leadId ? { ...l, stageId } : l)) }
        : d,
    );
    try {
      const r = await api<Lead & { sinCambios?: boolean }>(
        `/sales-teams/${teamId}/leads/${leadId}/stage`,
        { method: 'PATCH', body: JSON.stringify({ stageId, stageIdActual: origen }) },
      );
      if (r.sinCambios) {
        toast('Otra persona movió esta tarjeta antes. Te dejo la versión buena.', 'error');
        await cargar();
      }
    } catch (e: any) {
      setDatos((d) =>
        d
          ? {
              ...d,
              leads: d.leads.map((l) => (l.id === leadId ? { ...l, stageId: origen } : l)),
            }
          : d,
      );
      toast(e?.message ?? 'No se pudo mover.', 'error');
    }
  }

  if (cargando) return <div className="text-mute">Cargando el tablero…</div>;
  if (error) {
    return (
      <div className="card p-6">
        <p className="text-sm">{error}</p>
        <Link href="/admin/sales-teams" className="btn-ghost mt-4 inline-flex">
          Volver a los equipos
        </Link>
      </div>
    );
  }
  if (!datos) return null;

  const columnas = datos.columnas;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/admin/sales-teams" className="text-mute hover:text-ink">
            Equipos de ventas
          </Link>{' '}
          <span className="page-crumb">/ {datos.team.name}</span>
        </h1>
        {!datos.puedeEscribir && (
          <span className="text-xs text-mute">Tu rol aquí es de solo lectura</span>
        )}
      </div>

      {datos.truncado && (
        <p className="text-xs text-amber-700 mb-3">
          Se ven {datos.leads.length} de {datos.total} leads. El tablero todavía
          no pagina — usa el buscador del equipo para los que faltan.
        </p>
      )}

      {/* Móvil: una columna cada vez, con pestañas. */}
      <div className="flex md:hidden gap-1 overflow-x-auto mb-3 pb-1">
        {columnas.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setColumnaMovil(i)}
            className={`px-3 py-1.5 rounded-pill text-xs font-semibold whitespace-nowrap transition ${
              i === columnaMovil ? 'bg-brand text-white' : 'bg-bg2 text-mute'
            }`}
          >
            {c.name} · {porColumna.get(c.id)?.length ?? 0}
          </button>
        ))}
      </div>

      <div className="md:grid md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        {/* Se pintan TODAS y en móvil se esconden con CSS las que no tocan.
            Decidirlo con `window.innerWidth` en el render daría un HTML en el
            servidor distinto del que monta el navegador, y React lo tira. */}
        {columnas.map((c, i) => {
          const leads = porColumna.get(c.id) ?? [];
          return (
            <section
              key={c.id}
              onDragOver={(e) => {
                if (!datos.puedeEscribir) return;
                e.preventDefault();
                setSobre(c.id);
              }}
              onDragLeave={() => setSobre((s) => (s === c.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setSobre(null);
                if (arrastrando) mover(arrastrando, c.id);
                setArrastrando(null);
              }}
              className={`rounded-xl border p-2 transition ${
                sobre === c.id ? 'border-brand bg-brand/5' : 'border-line'
              } ${i === columnaMovil ? '' : 'hidden md:block'}`}
            >
              <header className="flex items-center gap-2 px-1 pb-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: c.color || GRIS }}
                />
                <span className="text-sm font-semibold truncate">{c.name}</span>
                <span className="text-xs text-mute tabular-nums ml-auto">
                  {leads.length}
                </span>
              </header>

              <div className="flex flex-col gap-2 min-h-[60px]">
                {leads.map((l) => (
                  <article
                    key={l.id}
                    draggable={datos.puedeEscribir}
                    onDragStart={() => setArrastrando(l.id)}
                    onDragEnd={() => setArrastrando(null)}
                    onClick={() => setAbierto(l.id)}
                    className={`rounded-lg border border-line bg-bg p-2.5 cursor-pointer hover:border-brand transition ${
                      arrastrando === l.id ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-7 h-7 rounded-full bg-bg2 text-[11px] font-bold grid place-items-center shrink-0">
                        {iniciales(l.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">
                          {l.name || l.phone || 'Sin nombre'}
                        </div>
                        {l.company && (
                          <div className="text-[11px] text-mute truncate">{l.company}</div>
                        )}
                      </div>
                      {l.value != null && l.value > 0 && (
                        <span className="text-[11px] font-semibold tabular-nums">
                          ${l.value.toLocaleString('es-CO')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-mute">
                      <span>{desdeHace(l.lastActivityAt)}</span>
                      {l.assignedTo && (
                        <span className="truncate ml-auto">{l.assignedTo}</span>
                      )}
                    </div>
                  </article>
                ))}

                {datos.puedeEscribir && (
                  <button
                    type="button"
                    className="text-xs text-mute hover:text-ink py-1.5 rounded-lg border border-dashed border-line"
                    onClick={() => setNuevoEn(c.id)}
                  >
                    + Añadir
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {nuevoEn && (
        <NuevoLead
          teamId={teamId}
          stageId={nuevoEn}
          onCerrar={() => setNuevoEn(null)}
          onCreado={async () => {
            setNuevoEn(null);
            await cargar();
          }}
        />
      )}

      {abierto && (
        <FichaDelLead
          teamId={teamId}
          leadId={abierto}
          puedeEscribir={datos.puedeEscribir}
          onCerrar={() => setAbierto(null)}
          onCambio={cargar}
        />
      )}
    </div>
  );
}

// ── Alta rápida ───────────────────────────────────────────────────────────

function NuevoLead({
  teamId,
  stageId,
  onCerrar,
  onCreado,
}: {
  teamId: string;
  stageId: string;
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [f, setF] = useState({ name: '', phone: '', email: '', company: '' });
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    // Todos los campos son opcionales menos tener ALGO: un vendedor apunta lo
    // que tiene —a veces solo un teléfono— y completa después.
    if (!f.name.trim() && !f.phone.trim() && !f.email.trim()) {
      toast('Pon al menos un nombre o un teléfono.', 'error');
      return;
    }
    setGuardando(true);
    try {
      const r = await api<{ yaExistia?: boolean }>(`/sales-teams/${teamId}/leads`, {
        method: 'POST',
        body: JSON.stringify({ ...f, stageId }),
      });
      toast(
        r.yaExistia
          ? 'Ese teléfono ya estaba en el tablero. Te llevo al que hay.'
          : 'Lead creado.',
        r.yaExistia ? 'error' : 'success',
      );
      onCreado();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo crear.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onCerrar}>
      <div className="card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-3">Nuevo lead</h2>
        <div className="flex flex-col gap-3">
          <input
            className="input"
            placeholder="Nombre"
            autoFocus
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Teléfono"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
          <input
            className="input"
            placeholder="Correo"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          <input
            className="input"
            placeholder="Empresa"
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-ghost flex-1" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="btn flex-1" disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ficha ─────────────────────────────────────────────────────────────────

function FichaDelLead({
  teamId,
  leadId,
  puedeEscribir,
  onCerrar,
  onCambio,
}: {
  teamId: string;
  leadId: string;
  puedeEscribir: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [lead, setLead] = useState<(Lead & { actividades: Actividad[] }) | null>(null);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await api<Lead & { actividades: Actividad[] }>(
      `/sales-teams/${teamId}/leads/${leadId}`,
    );
    setLead(r);
  }, [teamId, leadId]);

  useEffect(() => {
    cargar().catch(() => onCerrar());
  }, [cargar, onCerrar]);

  async function anotar() {
    const texto = nota.trim();
    if (!texto) return;
    setEnviando(true);
    try {
      await api(`/sales-teams/${teamId}/leads/${leadId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: texto }),
      });
      setNota('');
      await cargar();
      onCambio();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo guardar la nota.', 'error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onCerrar}>
      <aside
        className="bg-bg w-full max-w-md h-full overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {!lead ? (
          <div className="text-mute">Cargando…</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold truncate">
                  {lead.name || lead.phone || 'Sin nombre'}
                </h2>
                {lead.company && <p className="text-sm text-mute">{lead.company}</p>}
              </div>
              <button className="btn-ghost" onClick={onCerrar}>
                Cerrar
              </button>
            </div>

            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 mt-4 text-sm">
              {lead.phone && (
                <>
                  <dt className="text-mute">Teléfono</dt>
                  <dd>
                    <a className="hover:underline" href={`tel:${lead.phone}`}>
                      {lead.phone}
                    </a>
                  </dd>
                </>
              )}
              {lead.email && (
                <>
                  <dt className="text-mute">Correo</dt>
                  <dd className="truncate">
                    <a className="hover:underline" href={`mailto:${lead.email}`}>
                      {lead.email}
                    </a>
                  </dd>
                </>
              )}
              {lead.assignedTo && (
                <>
                  <dt className="text-mute">Vendedor</dt>
                  <dd>{lead.assignedTo}</dd>
                </>
              )}
              {lead.source && (
                <>
                  <dt className="text-mute">Origen</dt>
                  <dd>{lead.source}</dd>
                </>
              )}
              {lead.wonAt && (
                <>
                  <dt className="text-mute">Cerrado</dt>
                  <dd>{new Date(lead.wonAt).toLocaleDateString('es-CO')}</dd>
                </>
              )}
            </dl>

            {puedeEscribir && (
              <div className="mt-5">
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Qué pasó en esta gestión…"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                />
                <button
                  className="btn mt-2 w-full"
                  disabled={enviando || !nota.trim()}
                  onClick={anotar}
                >
                  {enviando ? 'Guardando…' : 'Anotar'}
                </button>
              </div>
            )}

            <h3 className="text-sm font-semibold mt-6 mb-2">Historial</h3>
            <ol className="flex flex-col gap-2">
              {lead.actividades.map((a) => (
                <li key={a.id} className="text-sm border-l-2 border-line pl-3">
                  <div className="text-[11px] text-mute">
                    {a.kind} · {desdeHace(a.createdAt)}
                  </div>
                  <div>{a.body}</div>
                </li>
              ))}
              {!lead.actividades.length && (
                <li className="text-sm text-mute">Todavía no hay nada anotado.</li>
              )}
            </ol>
          </>
        )}
      </aside>
    </div>
  );
}
