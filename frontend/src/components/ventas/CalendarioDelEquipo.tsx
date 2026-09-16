'use client';

/**
 * «📆 Conexión de Calendario / Correo» del equipo: la tarjeta de TeamClubify
 * (`TeamCalendarConnection`), con sus textos.
 *
 * Carga y guarda lo suyo (`/sales-teams/<id>/calendario`) y no depende de los
 * datos del resto de la Configuración: guardar otra tarjeta no la vuelve a montar
 * y no pierde lo que muestra.
 *
 * La vuelta de Google llega en el FRAGMENTO de la URL (`#calendario=…`): el panel
 * termina la conexión con su sesión y lo borra enseguida, para que el código no se
 * quede en la barra ni en el historial.
 *
 * Colores por tokens de la marca. Las muestras de color son los 11 de Google
 * Calendar: son un dato de Google, no del tema.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type ColorDeGoogle = { id: string; nombre: string; hex: string };
type Conexion = {
  conectado: boolean;
  email: string | null;
  desde: string | null;
  calendarioId: string;
  colorId: string | null;
  crearSala: boolean;
  invitarCliente: boolean;
  invitarCloser: boolean;
  enviarInvitaciones: boolean;
  ultimoError: string | null;
  ultimaSincronizacion: string | null;
};
type Estado = {
  configurado: boolean;
  puedeConfigurar: boolean;
  conexion: Conexion | null;
  colores: ColorDeGoogle[];
};
type Calendario = { id: string; nombre: string; principal: boolean };
type Aviso = { tono: 'ok' | 'bad'; texto: string };
type Preferencias = Partial<
  Pick<Conexion, 'calendarioId' | 'colorId' | 'crearSala' | 'invitarCliente' | 'invitarCloser' | 'enviarInvitaciones'>
>;

const VUELTAS: Record<string, Aviso> = {
  cancelado: { tono: 'bad', texto: 'Cancelaste el permiso en Google. No se conectó ninguna cuenta.' },
  vencido: { tono: 'bad', texto: 'El permiso de Google tardó demasiado. Vuelve a conectar la cuenta.' },
  error: { tono: 'bad', texto: 'No se pudo completar la conexión con Google. Inténtalo de nuevo.' },
};

export function CalendarioDelEquipo({ teamId }: { teamId: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState(false);
  const [calendarios, setCalendarios] = useState<Calendario[]>([]);
  const [avisoCalendarios, setAvisoCalendarios] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // En desarrollo React monta dos veces: sin esto, el mismo código se canjearía dos.
  const vueltaLeida = useRef(false);

  const cargar = useCallback(async () => {
    try {
      setEstado(await api<Estado>(`/sales-teams/${teamId}/calendario`));
      setFallo(false);
    } catch {
      setFallo(true);
    }
  }, [teamId]);

  useEffect(() => {
    if (vueltaLeida.current) return;
    vueltaLeida.current = true;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const tipo = params.get('calendario');
    if (!tipo) {
      void cargar();
      return;
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    document.getElementById('calendario')?.scrollIntoView({ block: 'start' });
    if (tipo !== 'codigo') {
      // Solo los valores que pone el callback. Con uno desconocido
      // (`#calendario=constructor`) el objeto devolvía algo de su prototipo y se
      // pintaba una caja roja vacía: se ignora.
      if (Object.prototype.hasOwnProperty.call(VUELTAS, tipo)) setAviso(VUELTAS[tipo]);
      void cargar();
      return;
    }
    void (async () => {
      setOcupado(true);
      try {
        const r = await api<{ ok: boolean; email: string | null }>(`/sales-teams/${teamId}/calendario/conectar`, {
          method: 'POST',
          body: JSON.stringify({ code: params.get('code') ?? '', state: params.get('state') ?? '' }),
        });
        setAviso({
          tono: 'ok',
          texto: `✓ Calendario conectado${r.email ? ` con ${r.email}` : ''}. Las próximas reuniones de este equipo se crearán con su sala.`,
        });
      } catch (e: any) {
        setAviso({ tono: 'bad', texto: e?.message || VUELTAS.error.texto });
      } finally {
        setOcupado(false);
        await cargar();
      }
    })();
  }, [cargar, teamId]);

  const c = estado?.conexion ?? null;
  const conectado = !!c?.conectado;
  const puedeConfigurar = !!estado?.puedeConfigurar;

  useEffect(() => {
    if (!conectado || !puedeConfigurar) return;
    let vivo = true;
    api<{ calendarios: Calendario[]; aviso?: string }>(`/sales-teams/${teamId}/calendario/calendarios`)
      .then((r) => {
        if (!vivo) return;
        setCalendarios(r.calendarios);
        setAvisoCalendarios(r.aviso ?? null);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [conectado, puedeConfigurar, teamId]);

  async function conectarCuenta() {
    setOcupado(true);
    try {
      const r = await api<{ url: string }>(`/sales-teams/${teamId}/calendario/iniciar`, {
        method: 'POST',
        body: JSON.stringify({ origen: window.location.origin, ruta: window.location.pathname }),
      });
      window.location.assign(r.url);
    } catch (e: any) {
      toast(e?.message || 'No se pudo abrir el permiso de Google', 'error');
      setOcupado(false);
    }
  }

  async function preferencia(parche: Preferencias) {
    if (!estado?.conexion) return;
    // Se ve al instante; si no se guarda, se relee lo que hay de verdad.
    setEstado({ ...estado, conexion: { ...estado.conexion, ...parche } });
    setOcupado(true);
    try {
      await api(`/sales-teams/${teamId}/calendario/preferencias`, { method: 'PUT', body: JSON.stringify(parche) });
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  async function probar() {
    setAviso(null);
    setOcupado(true);
    try {
      const r = await api<{ ok: boolean; mensaje: string }>(`/sales-teams/${teamId}/calendario/probar`, { method: 'POST' });
      setAviso({ tono: r.ok ? 'ok' : 'bad', texto: r.mensaje });
    } catch (e: any) {
      setAviso({ tono: 'bad', texto: e?.message || 'No se pudo probar la conexión' });
    } finally {
      setOcupado(false);
      await cargar();
    }
  }

  async function generarSalas() {
    setAviso(null);
    setOcupado(true);
    try {
      const r = await api<{ creadas: number; fallidas: number; total: number; quedan: number | null; enCurso: boolean }>(
        `/sales-teams/${teamId}/calendario/generar-salas`,
        { method: 'POST' },
      );
      if (r.enCurso) {
        setAviso({ tono: 'bad', texto: 'Ya se están generando las salas de este equipo. Espera a que termine y vuelve a pulsar.' });
        return;
      }
      // El servidor trabaja por tandas: si quedan, se dice y se vuelve a pulsar.
      const hechas =
        r.total === 0
          ? 'No hay reuniones futuras sin sala.'
          : `Salas generadas: ${r.creadas} de ${r.total}${r.fallidas ? ` (${r.fallidas} fallaron)` : ''}.`;
      const resto = r.quedan ? ` Quedan ${r.quedan} sin sala: vuelve a pulsar «Generar salas pendientes».` : '';
      setAviso({ tono: r.fallidas ? 'bad' : 'ok', texto: hechas + resto });
    } catch (e: any) {
      setAviso({ tono: 'bad', texto: e?.message || 'No se pudieron generar las salas' });
    } finally {
      setOcupado(false);
      await cargar();
    }
  }

  async function desconectar() {
    if (!window.confirm('¿Desconectar el calendario del equipo? Las reuniones nuevas dejarán de generar sala automática.')) return;
    setOcupado(true);
    try {
      await api(`/sales-teams/${teamId}/calendario`, { method: 'DELETE' });
      setAviso({ tono: 'ok', texto: 'Cuenta desconectada.' });
      setCalendarios([]);
    } catch (e: any) {
      toast(e?.message || 'No se pudo desconectar', 'error');
    } finally {
      setOcupado(false);
      await cargar();
    }
  }

  const titulo = (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-sm font-semibold text-ink">📆 Conexión de Calendario / Correo</h2>
        <p className="m-0 mt-0.5 text-xs text-mute">
          Conecta el Gmail de la agenda de este equipo. Cada cita agendada crea su evento y su <b>sala de Google Meet</b>, y
          el enlace queda fijo en la reunión: si cambias el closer, la sala es la misma. Úsalo en mensajes con{' '}
          <code>{'{{sala}}'}</code>.
        </p>
      </div>
      {estado && (
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${conectado ? 'bg-ok-soft text-ok-ink' : 'bg-bg2 text-mute'}`}
        >
          {conectado ? 'Conectado' : 'Sin conectar'}
        </span>
      )}
    </div>
  );

  if (fallo) {
    return (
      <section id="calendario" className="card card-pad">
        {titulo}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="m-0 text-sm text-mute">No se pudo cargar la conexión del calendario.</p>
          <button type="button" className="btn-ghost text-sm" onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section id="calendario" className="card card-pad">
      {titulo}

      <div className="mt-3 flex flex-col gap-3">
        {aviso && (
          <p className={`m-0 rounded-lg px-3 py-2 text-xs ${aviso.tono === 'ok' ? 'bg-ok-soft text-ok-ink' : 'bg-bad-soft text-bad-ink'}`}>
            {aviso.texto}
          </p>
        )}

        {!estado ? (
          <div className="h-16 rounded bg-bg2 animate-shimmer" />
        ) : (
          <>
            {!estado.configurado && (
              <p className="m-0 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-ink">
                Falta configurar la conexión con Google. Mientras tanto las citas se agendan igual, sin sala automática.
              </p>
            )}

            {c?.ultimoError && (
              <p className="m-0 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad-ink">Último error con Google: {c.ultimoError}</p>
            )}

            {!puedeConfigurar ? (
              <p className="m-0 rounded-lg bg-bg2 px-3 py-2 text-xs text-mute">
                {conectado ? `Conectado con ${c?.email ?? 'la cuenta del equipo'}.` : 'Sin conectar.'} Solo el líder del
                equipo o un admin de la marca pueden cambiar esto.
              </p>
            ) : !conectado || !c ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!estado.configurado || ocupado}
                  onClick={() => void conectarCuenta()}
                >
                  🔗 Conectar cuenta de Google
                </button>
                <span className="text-xs text-mute">
                  Se abre el permiso de Google (Calendar). Usa el correo de la agenda del equipo.
                </span>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ok-soft px-3 py-2">
                  <span className="text-sm" aria-hidden>
                    📧
                  </span>
                  <span className="text-sm font-medium text-ink">{c.email ?? 'Cuenta conectada'}</span>
                  {c.desde && (
                    <span className="text-[11px] text-mute">desde {new Date(c.desde).toLocaleDateString('es-CO')}</span>
                  )}
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      disabled={ocupado || !estado.configurado}
                      onClick={() => void conectarCuenta()}
                    >
                      Reconectar
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-bad/40 px-3 py-1.5 text-xs font-medium text-bad-ink hover:bg-bad-soft disabled:opacity-60"
                      disabled={ocupado}
                      onClick={() => void desconectar()}
                    >
                      Desconectar
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor={`calendario-${teamId}`}>
                      Calendario donde caen las reuniones
                    </label>
                    <select
                      id={`calendario-${teamId}`}
                      className="input"
                      value={c.calendarioId}
                      disabled={ocupado}
                      onChange={(e) => void preferencia({ calendarioId: e.target.value })}
                    >
                      {!calendarios.some((x) => x.id === c.calendarioId) && (
                        <option value={c.calendarioId}>{c.calendarioId === 'primary' ? 'Principal' : c.calendarioId}</option>
                      )}
                      {calendarios.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.nombre}
                          {x.principal ? ' (principal)' : ''}
                        </option>
                      ))}
                    </select>
                    {avisoCalendarios && <p className="m-0 mt-1 text-[11px] text-mute">{avisoCalendarios}</p>}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <button type="button" className="btn-ghost text-sm" disabled={ocupado} onClick={() => void probar()}>
                      Probar conexión
                    </button>
                    <button type="button" className="btn-ghost text-sm" disabled={ocupado} onClick={() => void generarSalas()}>
                      Generar salas pendientes
                    </button>
                  </div>
                </div>

                <div>
                  <span className="label">Color por defecto de las citas del equipo</span>
                  <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color por defecto de las citas">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!c.colorId}
                      disabled={ocupado}
                      onClick={() => void preferencia({ colorId: null })}
                      className={`h-7 rounded-lg border border-line px-2 text-xs text-ink ring-offset-2 disabled:opacity-60 ${!c.colorId ? 'ring-2 ring-ink' : ''}`}
                    >
                      El del calendario
                    </button>
                    {estado.colores.map((col) => (
                      <button
                        key={col.id}
                        type="button"
                        role="radio"
                        aria-checked={c.colorId === col.id}
                        aria-label={col.nombre}
                        title={col.nombre}
                        disabled={ocupado}
                        onClick={() => void preferencia({ colorId: col.id })}
                        className={`h-7 w-7 rounded-lg ring-offset-2 disabled:opacity-60 ${c.colorId === col.id ? 'ring-2 ring-ink' : ''}`}
                        style={{ background: col.hex }}
                      />
                    ))}
                  </div>
                  <p className="m-0 mt-1 text-[11px] text-mute">
                    Es el color base en Google Calendar. Cada agenda de reserva con color propio pinta sus citas con el tono
                    de Google más parecido.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Casilla
                    marcada={c.crearSala}
                    deshabilitada={ocupado}
                    alCambiar={(v) => void preferencia({ crearSala: v })}
                    etiqueta="Crear sala de Google Meet en cada reunión"
                    ayuda="El enlace queda guardado en la reunión y se usa en los mensajes con {{sala}}."
                  />
                  <Casilla
                    marcada={c.invitarCliente}
                    deshabilitada={ocupado}
                    alCambiar={(v) => void preferencia({ invitarCliente: v })}
                    etiqueta="Invitar al cliente (si dejó correo en el formulario)"
                  />
                  <Casilla
                    marcada={c.invitarCloser}
                    deshabilitada={ocupado}
                    alCambiar={(v) => void preferencia({ invitarCloser: v })}
                    etiqueta="Invitar al closer asignado"
                    ayuda="Al reasignar la reunión se actualiza el invitado, pero la sala no cambia."
                  />
                  <Casilla
                    marcada={c.enviarInvitaciones}
                    deshabilitada={ocupado}
                    alCambiar={(v) => void preferencia({ enviarInvitaciones: v })}
                    etiqueta="Que Google envíe el correo de invitación y los cambios"
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Casilla({
  marcada,
  alCambiar,
  etiqueta,
  ayuda,
  deshabilitada,
}: {
  marcada: boolean;
  alCambiar: (v: boolean) => void;
  etiqueta: string;
  ayuda?: string;
  deshabilitada?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${marcada ? 'border-line bg-bg2' : 'border-line2'} ${deshabilitada ? 'opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-brand"
        checked={marcada}
        disabled={deshabilitada}
        onChange={(e) => alCambiar(e.target.checked)}
      />
      <span>
        <span className="text-ink">{etiqueta}</span>
        {ayuda && <span className="block text-[11px] text-mute">{ayuda}</span>}
      </span>
    </label>
  );
}
