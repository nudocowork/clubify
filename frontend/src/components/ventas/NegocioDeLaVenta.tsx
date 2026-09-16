'use client';

/**
 * «Negocio de <marca>» en la tarjeta de un cliente: a qué negocio de la marca se
 * convirtió el lead ganado, quién lo cerró (closer) y quién agendó la cita
 * (setter).
 *
 * SIN una palabra de dinero, a propósito: esto TODAVÍA NO PAGA NADA. El pago lo
 * engancha después el motor de comisiones; hasta entonces, hablar de comisiones
 * o importes aquí sería prometer algo que no pasa.
 *
 * No se pinta nada si la marca no tiene nombre (nunca «Negocio de Clubify» por
 * defecto) ni si la ruta no responde: un backend sin este cambio da 404, y sin
 * la tabla aplicada, error — en los dos casos la tarjeta desaparece en vez de
 * enseñar algo roto.
 *
 * Vincular, cambiar y desvincular: el líder del equipo o un admin de la marca.
 * Una sugerencia NO vincula sola: solo la elige; confirma el botón. Buscar por
 * texto es solo del admin (el líder es un afiliado y no tiene por qué recorrer
 * los negocios de la marca).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type EstadoDelCodigo = 'aprobado' | 'sin_codigo' | 'sin_aprobar' | 'varios';
type Aviso = Exclude<EstadoDelCodigo, 'aprobado'> | 'codigo_nuevo';
type Persona = { userId: string; nombre: string; aviso: Aviso | null };

type Venta = {
  id: string;
  leadId: string | null;
  negocio: { id: string; nombre: string | null };
  closer: Persona | null;
  setter: Persona | null;
  vinculadaEl: string;
  vinculadaPor: string | null;
};

export type VentasDelEquipo = { puedeVincular: boolean; marca: { nombre: string } | null; ventas: Venta[] };

type Sugerencia = {
  id: string;
  nombre: string;
  motivo: 'telefono_y_correo' | 'telefono' | 'correo';
  /** Otro negocio coincide por lo mismo: con estos datos no se distinguen. */
  ambigua?: boolean;
};

type Preparacion = {
  lead: { id: string; nombre: string | null; ganado: boolean };
  marca: { nombre: string } | null;
  puedeBuscar: boolean;
  venta: Venta | null;
  sugerencias: Sugerencia[];
  precarga: { closerUserId: string | null; setterUserId: string | null };
  miembros: { userId: string; nombre: string; roles: string[]; codigo: EstadoDelCodigo }[];
};

const MOTIVO: Record<Sugerencia['motivo'], string> = {
  telefono_y_correo: 'coinciden el teléfono y el correo',
  telefono: 'coincide el teléfono',
  correo: 'coincide el correo',
};

/**
 * Lo que se añade al nombre de cada persona en los desplegables. «(sin código
 * aprobado)» valía para tres estados menos para `varios`, que es justo el que
 * TIENE varios aprobados: decía lo contrario de su propio aviso.
 */
const CODIGO_EN_LA_LISTA: Record<EstadoDelCodigo, string> = {
  aprobado: '',
  sin_codigo: ' (sin código de afiliado)',
  sin_aprobar: ' (código sin aprobar)',
  varios: ' (varios códigos aprobados)',
};

function textoDeAviso(aviso: Aviso, marca: string): string {
  switch (aviso) {
    case 'sin_codigo':
      return `No tiene código de afiliado en ${marca}`;
    case 'sin_aprobar':
      return `Su código de afiliado en ${marca} no está aprobado`;
    case 'varios':
      return `Tiene varios códigos de afiliado aprobados en ${marca}`;
    case 'codigo_nuevo':
      return `Ya tiene código aprobado en ${marca}: vuelve a guardar para tomarlo`;
  }
}

/** Las ventas del equipo, en UNA petición para toda la pantalla de Clientes. */
export function useVentasDelEquipo(teamId: string) {
  const [ventas, setVentas] = useState<VentasDelEquipo | null>(null);
  const cargadoAlguna = useRef(false);

  const recargarVentas = useCallback(async () => {
    if (!teamId) return;
    try {
      setVentas(await api<VentasDelEquipo>(`/sales-teams/${teamId}/ventas`));
      cargadoAlguna.current = true;
    } catch {
      // Un fallo al releer no borra lo que ya se está viendo; el primero, sí:
      // sin la ruta no hay nada que enseñar.
      if (!cargadoAlguna.current) setVentas(null);
    }
  }, [teamId]);

  useEffect(() => {
    void recargarVentas();
  }, [recargarVentas]);

  return { ventas, recargarVentas };
}

export function NegocioDeLaVenta({
  teamId,
  leadId,
  ventas,
  alCambiar,
}: {
  teamId: string;
  leadId: string;
  ventas: VentasDelEquipo | null;
  alCambiar: () => Promise<void>;
}) {
  const [modo, setModo] = useState<'ver' | 'vincular' | 'personas'>('ver');
  const marca = ventas?.marca?.nombre ?? null;
  const venta = ventas?.ventas.find((v) => v.leadId === leadId) ?? null;

  async function desvincular() {
    if (!window.confirm('¿Desvincular el negocio de este cliente? El closer y el setter dejan de estar asociados a esta venta.')) {
      return;
    }
    try {
      await api(`/sales-teams/${teamId}/ventas/leads/${leadId}`, { method: 'DELETE' });
    } catch (e: any) {
      toast(e?.message || 'No se pudo desvincular', 'error');
      return;
    }
    toast('Negocio desvinculado.', 'success');
    await alCambiar();
  }

  if (!ventas || !marca) return null;

  return (
    <div className="mt-3 border-t border-line2 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-mute">Negocio de {marca}</p>
          {venta ? (
            <>
              <p className="m-0 mt-0.5 font-semibold text-ink">{venta.negocio.nombre ?? 'Negocio no disponible'}</p>
              <PersonaDeLaVenta papel="Closer" persona={venta.closer} marca={marca} />
              <PersonaDeLaVenta papel="Setter" persona={venta.setter} marca={marca} />
            </>
          ) : (
            <p className="m-0 mt-0.5 text-mute">Sin vincular</p>
          )}
        </div>

        {ventas.puedeVincular && modo === 'ver' && (
          <div className="flex flex-wrap gap-1.5">
            {venta ? (
              <>
                <button type="button" className="btn-ghost text-xs" onClick={() => setModo('personas')}>
                  Cambiar closer y setter
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => void desvincular()}>
                  Desvincular
                </button>
              </>
            ) : (
              <button type="button" className="btn-ghost text-xs" onClick={() => setModo('vincular')}>
                Vincular negocio
              </button>
            )}
          </div>
        )}
      </div>

      {modo !== 'ver' && (
        <Editor
          teamId={teamId}
          leadId={leadId}
          marca={marca}
          modo={modo}
          alTerminar={() => setModo('ver')}
          alCambiar={alCambiar}
        />
      )}
    </div>
  );
}

function PersonaDeLaVenta({ papel, persona, marca }: { papel: string; persona: Persona | null; marca: string }) {
  return (
    <p className="m-0 mt-1 text-xs text-mute">
      {papel}: <span className="text-ink">{persona?.nombre ?? 'Sin asignar'}</span>
      {persona?.aviso && (
        <span className="ml-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn-ink">
          {textoDeAviso(persona.aviso, marca)}
        </span>
      )}
    </p>
  );
}

function Editor({
  teamId,
  leadId,
  marca,
  modo,
  alTerminar,
  alCambiar,
}: {
  teamId: string;
  leadId: string;
  marca: string;
  modo: 'vincular' | 'personas';
  alTerminar: () => void;
  alCambiar: () => Promise<void>;
}) {
  const idCloser = useId();
  const idSetter = useId();
  const idBuscar = useId();
  const [prep, setPrep] = useState<Preparacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [negocio, setNegocio] = useState<{ id: string; nombre: string } | null>(null);
  const [closer, setCloser] = useState('');
  const [setter, setSetter] = useState('');
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<{ id: string; nombre: string; correo: string | null; yaVinculado: boolean }[] | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api<Preparacion>(`/sales-teams/${teamId}/ventas/leads/${leadId}`)
      .then((p) => {
        if (!vivo) return;
        setPrep(p);
        setCloser(p.precarga.closerUserId ?? '');
        setSetter(p.precarga.setterUserId ?? '');
      })
      .catch((e: any) => {
        if (vivo) setError(e?.message || 'No se pudo cargar');
      });
    return () => {
      vivo = false;
    };
  }, [teamId, leadId]);

  async function buscar() {
    const t = q.trim();
    if (t.length < 2) {
      toast('Escribe al menos 2 letras', 'error');
      return;
    }
    try {
      const r = await api<{ negocios: { id: string; nombre: string; correo: string | null; yaVinculado: boolean }[] }>(
        `/sales-teams/${teamId}/ventas/negocios?q=${encodeURIComponent(t)}`,
      );
      setResultados(r.negocios);
    } catch (e: any) {
      toast(e?.message || 'No se pudo buscar', 'error');
    }
  }

  async function guardar() {
    if (modo === 'vincular' && !negocio) {
      toast('Elige el negocio', 'error');
      return;
    }
    setGuardando(true);
    try {
      const cuerpo =
        modo === 'vincular'
          ? { negocioId: negocio?.id, closerUserId: closer || null, setterUserId: setter || null }
          : { closerUserId: closer || null, setterUserId: setter || null };
      await api(`/sales-teams/${teamId}/ventas/leads/${leadId}`, {
        method: modo === 'vincular' ? 'PUT' : 'PATCH',
        body: JSON.stringify(cuerpo),
      });
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
      setGuardando(false);
      return;
    }
    setGuardando(false);
    toast(modo === 'vincular' ? 'Negocio vinculado.' : 'Closer y setter guardados.', 'success');
    await alCambiar();
    alTerminar();
  }

  if (error) return <p className="m-0 mt-2 text-xs text-mute">{error}</p>;
  if (!prep) return <div className="mt-2 h-16 rounded bg-bg2 animate-shimmer" />;
  if (!prep.lead.ganado) {
    return (
      <p className="m-0 mt-2 text-xs text-mute">
        Este lead todavía no está ganado: el negocio se vincula a una venta cerrada.
      </p>
    );
  }

  const avisoDe = (userId: string) => {
    const m = prep.miembros.find((x) => x.userId === userId);
    return m && m.codigo !== 'aprobado' ? textoDeAviso(m.codigo, marca) : null;
  };
  const fuera = (userId: string) => !!userId && !prep.miembros.some((m) => m.userId === userId);

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg bg-bg2 p-3">
      {modo === 'vincular' && (
        <div className="flex flex-col gap-2">
          {prep.sugerencias.length > 0 ? (
            <div>
              <p className="label">Sugerencias</p>
              <div className="flex flex-col gap-1">
                {prep.sugerencias.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`negocio-${leadId}`}
                      checked={negocio?.id === s.id}
                      onChange={() => setNegocio({ id: s.id, nombre: s.nombre })}
                      className="accent-brand"
                    />
                    <span className="text-ink">{s.nombre}</span>
                    <span className="text-[11px] text-mute">· {MOTIVO[s.motivo]}</span>
                    {s.ambigua && (
                      <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn-ink">
                        otro negocio coincide igual
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <p className="m-0 mt-1 text-[11px] text-mute">
                Una coincidencia no vincula sola: comprueba que sea el mismo negocio.
              </p>
            </div>
          ) : (
            <p className="m-0 text-xs text-mute">
              Ningún negocio de {marca} coincide con el teléfono o el correo de este cliente.
            </p>
          )}

          {prep.puedeBuscar && (
            <div>
              <label className="label" htmlFor={idBuscar}>
                Buscar un negocio de {marca}
              </label>
              <div className="flex gap-2">
                <input
                  id={idBuscar}
                  className="input"
                  value={q}
                  maxLength={60}
                  placeholder="Nombre, correo o enlace"
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void buscar();
                    }
                  }}
                />
                <button type="button" className="btn-ghost text-sm" onClick={() => void buscar()}>
                  Buscar
                </button>
              </div>
              {resultados &&
                (resultados.length === 0 ? (
                  <p className="m-0 mt-1 text-xs text-mute">Sin resultados.</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-1">
                    {resultados.map((r) => (
                      <label
                        key={r.id}
                        className={`flex items-center gap-2 text-sm ${r.yaVinculado ? 'opacity-60' : 'cursor-pointer'}`}
                      >
                        <input
                          type="radio"
                          name={`negocio-${leadId}`}
                          disabled={r.yaVinculado}
                          checked={negocio?.id === r.id}
                          onChange={() => setNegocio({ id: r.id, nombre: r.nombre })}
                          className="accent-brand"
                        />
                        <span className="text-ink">{r.nombre}</span>
                        {r.correo && <span className="text-[11px] text-mute">· {r.correo}</span>}
                        {r.yaVinculado && <span className="text-[11px] text-mute">· ya vinculado a otra venta</span>}
                      </label>
                    ))}
                  </div>
                ))}
            </div>
          )}

          {negocio && (
            <p className="m-0 text-xs text-mute">
              Negocio elegido: <strong className="text-ink">{negocio.nombre}</strong>
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={idCloser}>
            Closer (quien cerró)
          </label>
          <select id={idCloser} className="input" value={closer} onChange={(e) => setCloser(e.target.value)}>
            <option value="">Sin closer</option>
            {fuera(closer) && <option value={closer}>Quien cerró (ya no está en el equipo)</option>}
            {prep.miembros.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.nombre}
                {CODIGO_EN_LA_LISTA[m.codigo]}
              </option>
            ))}
          </select>
          {closer && avisoDe(closer) && <p className="m-0 mt-1 text-[11px] text-mute">{avisoDe(closer)}</p>}
        </div>
        <div>
          <label className="label" htmlFor={idSetter}>
            Setter (quien agendó)
          </label>
          <select id={idSetter} className="input" value={setter} onChange={(e) => setSetter(e.target.value)}>
            <option value="">Sin setter</option>
            {fuera(setter) && <option value={setter}>Quien agendó (ya no está en el equipo)</option>}
            {prep.miembros.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.nombre}
                {CODIGO_EN_LA_LISTA[m.codigo]}
              </option>
            ))}
          </select>
          {setter && avisoDe(setter) && <p className="m-0 mt-1 text-[11px] text-mute">{avisoDe(setter)}</p>}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={guardando || (modo === 'vincular' && !negocio)}
          onClick={() => void guardar()}
        >
          {guardando ? 'Guardando…' : modo === 'vincular' ? 'Vincular' : 'Guardar'}
        </button>
        <button type="button" className="btn-ghost text-sm" disabled={guardando} onClick={alTerminar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
