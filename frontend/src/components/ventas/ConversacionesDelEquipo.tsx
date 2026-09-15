'use client';

/**
 * «Conversaciones» del equipo: la bandeja de chats, como en TeamClubify.
 *
 * Los mensajes ya se veían en la ficha de cada lead, pero para saber quién
 * había escrito había que abrir los leads uno a uno. Aquí está la lista: un
 * hilo por lead, lo más reciente arriba, con los no leídos marcados; y al lado
 * el hilo con el cuadro para responder por SMS o dejar una nota interna.
 *
 * Se actualiza sola mientras la pestaña está a la vista (la lista cada 10 s, el
 * chat abierto cada 6 s) y se pausa en segundo plano: no gasta consultas si
 * nadie mira, y no pisa lo que se está escribiendo.
 *
 * Colores por tokens: bajo `.brand-panel` la marca pone los suyos.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

type Filtro = 'todos' | 'no_leidos';

type Hilo = {
  leadId: string;
  nombre: string | null;
  telefono: string | null;
  empresa: string | null;
  ultimo: string;
  direccion: string;
  fecha: string;
  noLeidos: number;
};

type Bandeja = {
  team: { id: string; name: string; isActive?: boolean };
  puedeEscribir: boolean;
  filtro: Filtro;
  q: string;
  pagina: number;
  porPagina: number;
  total: number;
  conNoLeidos: number;
  hayMas: boolean;
  hilos: Hilo[];
};

type Mensaje = {
  id: string;
  direction: 'in' | 'out' | 'internal';
  channel: string;
  body: string | null;
  createdAt: string;
};

type Conversacion = {
  puedeEscribir: boolean;
  telefono: string | null;
  optOut: boolean;
  mensajes: Mensaje[];
};

function cuando(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString()
    ? d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

const nombreDe = (h: { nombre: string | null; telefono: string | null } | null | undefined) =>
  h?.nombre || h?.telefono || 'Sin nombre';

export function ConversacionesDelEquipo() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [bandeja, setBandeja] = useState<Bandeja | null>(null);
  const [hilos, setHilos] = useState<Hilo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [q, setQ] = useState('');
  const [cargandoMas, setCargandoMas] = useState(false);
  // La última página pedida. Deducirla de cuántos hilos hay fallaba: el sondeo
  // funde chats nuevos en la lista y «Cargar más» se saltaba una página
  // (Fable, 2026-09-14).
  const [paginaCargada, setPaginaCargada] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [conv, setConv] = useState<Conversacion | null>(null);
  const [cargandoHilo, setCargandoHilo] = useState(false);
  const [texto, setTexto] = useState('');
  const [modo, setModo] = useState<'sms' | 'nota'>('sms');
  const [enviando, setEnviando] = useState(false);
  const secuencia = useRef(0);
  const selRef = useRef<string | null>(null);
  const hiloRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selRef.current = sel;
  }, [sel]);

  // Al abrir un chat se ve lo ÚLTIMO, no el saludo del primer día.
  useEffect(() => {
    const el = hiloRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv?.mensajes.length, sel]);

  const pedir = useCallback(
    (f: Filtro, busqueda: string, pagina: number) => {
      const p = new URLSearchParams();
      if (f !== 'todos') p.set('filtro', f);
      if (busqueda.trim()) p.set('q', busqueda.trim());
      if (pagina > 1) p.set('pagina', String(pagina));
      const s = p.toString();
      return api<Bandeja>(`/sales-teams/${teamId}/conversaciones${s ? `?${s}` : ''}`);
    },
    [teamId],
  );

  /** La primera tanda: reemplaza la lista. */
  const cargarLista = useCallback(
    async (f: Filtro, busqueda: string) => {
      if (!teamId) return;
      const esta = ++secuencia.current;
      try {
        const r = await pedir(f, busqueda, 1);
        if (esta !== secuencia.current) return;
        setBandeja(r);
        setHilos(r.hilos);
        setPaginaCargada(1);
        setError(null);
      } catch (e: any) {
        if (esta !== secuencia.current) return;
        setError(
          e?.status === 404
            ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
            : e?.message || 'No se pudieron cargar las conversaciones',
        );
      }
    },
    [pedir, teamId],
  );

  const marcarLeido = useCallback(
    (leadId: string) => {
      api(`/sales-teams/${teamId}/conversaciones/${leadId}/leido`, { method: 'POST' }).catch(() => null);
    },
    [teamId],
  );

  const cargarHilo = useCallback(
    async (leadId: string) => {
      const c = await api<Conversacion>(`/sales-teams/${teamId}/leads/${leadId}/chat`);
      // Si mientras tanto se cambió de chat, no pisar el que se está viendo.
      if (selRef.current !== leadId) return null;
      setConv(c);
      return c;
    },
    [teamId],
  );

  const abrir = useCallback(
    async (leadId: string) => {
      setSel(leadId);
      setConv(null);
      setTexto('');
      setModo('sms');
      setCargandoHilo(true);
      setHilos((hs) => hs.map((h) => (h.leadId === leadId ? { ...h, noLeidos: 0 } : h)));
      try {
        await cargarHilo(leadId);
        marcarLeido(leadId);
      } catch (e: any) {
        toast(e?.message || 'No se pudo abrir la conversación', 'error');
      } finally {
        setCargandoHilo(false);
      }
    },
    [cargarHilo, marcarLeido],
  );

  // Primera carga, y el chat que llegue enlazado (`?lead=<id>`), por ejemplo
  // desde «Requiere atención» del Resumen.
  useEffect(() => {
    void cargarLista('todos', '');
    const lead = new URLSearchParams(window.location.search).get('lead');
    if (lead) void abrir(lead);
  }, [cargarLista, abrir]);

  // Buscador con pausa: no consulta en cada tecla. Solo mira la búsqueda: el
  // filtro ya recarga al pulsarlo, y si también disparara esto la bandeja se
  // pedía dos veces (Fable, 2026-09-14).
  const primeraBusqueda = useRef(true);
  const filtroRef = useRef<Filtro>('todos');
  filtroRef.current = filtro;
  useEffect(() => {
    if (primeraBusqueda.current) {
      primeraBusqueda.current = false;
      return;
    }
    const h = setTimeout(() => void cargarLista(filtroRef.current, q), 350);
    return () => clearTimeout(h);
  }, [q, cargarLista]);

  // Tiempo real por sondeo, en pausa con la pestaña oculta o mientras se envía.
  useEffect(() => {
    // Una respuesta que llega después de cambiar de filtro o de búsqueda no
    // puede pisar la lista nueva (Fable, 2026-09-14).
    let vivo = true;
    const tick = async () => {
      if (document.hidden || enviando || cargandoMas) return;
      try {
        const r = await pedir(filtro, q, 1);
        if (!vivo) return;
        setBandeja(r);
        setHilos((prev) => {
          // Solo se refresca la primera tanda y se funde: el sondeo no borra los
          // hilos antiguos que ya se cargaron con «Cargar más».
          if (prev.length <= r.porPagina) return r.hilos;
          const mapa = new Map(prev.map((h) => [h.leadId, h]));
          for (const h of r.hilos) mapa.set(h.leadId, h);
          return [...mapa.values()].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
        });
        const abierto = selRef.current;
        if (abierto) {
          const antes = conv?.mensajes.length ?? 0;
          const c = await cargarHilo(abierto);
          // Llegó algo con el chat abierto: ya se está leyendo.
          if (vivo && c && c.mensajes.length !== antes) marcarLeido(abierto);
        }
      } catch {
        /* un fallo de red no rompe la bandeja: el siguiente intento lo arregla */
      }
    };
    const intervalo = setInterval(tick, sel ? 6000 : 10000);
    const alVolver = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo = false;
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [sel, filtro, q, enviando, cargandoMas, pedir, cargarHilo, marcarLeido, conv?.mensajes.length]);

  async function cargarMas() {
    if (!bandeja || cargandoMas) return;
    setCargandoMas(true);
    try {
      const siguiente = paginaCargada + 1;
      const r = await pedir(filtro, q, siguiente);
      setPaginaCargada(siguiente);
      setHilos((prev) => [...prev, ...r.hilos.filter((h) => !prev.some((p) => p.leadId === h.leadId))]);
      setBandeja((b) => (b ? { ...b, hayMas: r.hayMas } : r));
    } catch (e: any) {
      toast(e?.message || 'No se pudieron cargar más chats', 'error');
    } finally {
      setCargandoMas(false);
    }
  }

  async function enviar() {
    if (!sel || !texto.trim() || enviando) return;
    setEnviando(true);
    const cuerpo = texto.trim();
    try {
      await api(`/sales-teams/${teamId}/leads/${sel}/chat${modo === 'nota' ? '/nota' : ''}`, {
        method: 'POST',
        body: JSON.stringify({ body: cuerpo }),
      });
      setTexto('');
      await cargarHilo(sel);
      marcarLeido(sel);
      void cargarLista(filtro, q);
    } catch (e: any) {
      // El motivo real («la marca no tiene subcuenta de SMS», «se dio de baja»)
      // es accionable: se enseña tal cual.
      toast(e?.message || 'No se pudo enviar', 'error');
    } finally {
      setEnviando(false);
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

  if (!bandeja) {
    return <div className="h-32 bg-bg2 rounded animate-shimmer" />;
  }

  const actual = hilos.find((h) => h.leadId === sel) ?? null;
  const sinTelefono = !!conv && !conv.telefono?.trim();
  const smsBloqueado = !!conv && (conv.optOut || sinTelefono);

  return (
    <div>
      <CabeceraDeEquipo equipo={bandeja.team} soloLectura={!bandeja.puedeEscribir} />

      <div className="card flex h-[calc(100dvh-16rem)] min-h-[26rem] overflow-hidden p-0">
        {/* Lista de hilos */}
        <div className={`flex w-full flex-col border-r border-line md:w-80 md:shrink-0 ${sel ? 'hidden md:flex' : 'flex'}`}>
          <div className="flex flex-col gap-2 border-b border-line p-2">
            <div className="flex items-center gap-1">
              {(['todos', 'no_leidos'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setFiltro(f);
                    void cargarLista(f, q);
                  }}
                  className={`rounded-pill px-2.5 py-1 text-xs font-medium ${
                    filtro === f ? 'bg-brand text-white' : 'text-mute hover:bg-bg2'
                  }`}
                >
                  {f === 'todos' ? 'Todos' : `No leídos${bandeja.conNoLeidos ? ` · ${bandeja.conNoLeidos}` : ''}`}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-mute tabular-nums">
                {hilos.length}
                {bandeja.total > hilos.length ? ` de ${bandeja.total}` : ''}
              </span>
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar chat, número o texto…"
              className="input h-8 text-xs"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {hilos.length === 0 ? (
              <p className="p-6 text-center text-sm text-mute">
                {q
                  ? 'Sin resultados.'
                  : filtro === 'no_leidos'
                    ? 'No hay mensajes sin leer.'
                    : 'Todavía no hay conversaciones. Cuando un lead responda por SMS, aparece aquí.'}
              </p>
            ) : (
              hilos.map((h) => (
                <button
                  key={h.leadId}
                  type="button"
                  onClick={() => void abrir(h.leadId)}
                  className={`flex w-full items-start gap-2 border-b border-line px-3 py-2.5 text-left ${
                    sel === h.leadId ? 'bg-brand-soft' : 'hover:bg-bg2'
                  }`}
                >
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg2 text-sm font-semibold text-mute">
                    {nombreDe(h).charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{nombreDe(h)}</span>
                      <span className="shrink-0 text-[10px] text-mute">{cuando(h.fecha)}</span>
                    </span>
                    <span className={`block truncate text-xs ${h.noLeidos > 0 ? 'font-medium text-ink' : 'text-mute'}`}>
                      {h.direccion === 'out' ? 'Tú: ' : ''}
                      {h.ultimo || '—'}
                    </span>
                  </span>
                  {h.noLeidos > 0 && (
                    <span className="mt-1 grid h-5 min-w-5 shrink-0 place-items-center rounded-pill bg-brand px-1 text-[10px] font-semibold text-white">
                      {h.noLeidos}
                    </span>
                  )}
                </button>
              ))
            )}
            {bandeja.hayMas && hilos.length > 0 && (
              <button
                type="button"
                onClick={() => void cargarMas()}
                disabled={cargandoMas}
                className="w-full py-3 text-center text-xs font-medium text-mute hover:bg-bg2 disabled:opacity-60"
              >
                {cargandoMas ? 'Cargando…' : 'Cargar más chats'}
              </button>
            )}
          </div>
        </div>

        {/* Hilo */}
        <div className={`flex-1 flex-col ${sel ? 'flex' : 'hidden md:flex'}`}>
          {!sel ? (
            <div className="grid flex-1 place-items-center text-sm text-mute">Elige una conversación</div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <button type="button" onClick={() => setSel(null)} className="text-mute md:hidden" aria-label="Volver a la lista">
                  ←
                </button>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-semibold text-ink">{nombreDe(actual)}</p>
                  <p className="m-0 truncate text-xs text-mute">
                    {conv?.telefono || actual?.telefono || 'sin número'}
                    {actual?.empresa ? ` · ${actual.empresa}` : ''}
                    {conv?.optOut ? ' · dado de baja' : ''}
                  </p>
                </div>
                <Link
                  href={`/admin/sales-teams/${teamId}/board?lead=${sel}`}
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-mute hover:bg-bg2"
                >
                  Ver ficha
                </Link>
              </div>

              <div ref={hiloRef} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-bg2 p-4">
                {cargandoHilo && !conv ? (
                  <p className="text-center text-sm text-mute">Cargando…</p>
                ) : !conv || conv.mensajes.length === 0 ? (
                  <p className="text-center text-sm text-mute">Sin mensajes.</p>
                ) : (
                  conv.mensajes.map((m) =>
                    m.direction === 'internal' ? (
                      <div key={m.id} className="flex justify-center">
                        <div className="max-w-[85%] rounded-lg bg-warn-soft px-3 py-1.5 text-xs text-warn-ink">
                          <span className="font-semibold">Nota interna · </span>
                          <span className="whitespace-pre-wrap break-words">{m.body}</span>
                          <span className="ml-1.5 opacity-70">{cuando(m.createdAt)}</span>
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                            m.direction === 'out' ? 'bg-brand text-white' : 'border border-line bg-bg text-ink'
                          }`}
                        >
                          {m.body && <p className="m-0 whitespace-pre-wrap break-words">{m.body}</p>}
                          <p className={`m-0 mt-0.5 text-[10px] ${m.direction === 'out' ? 'text-white/70' : 'text-mute'}`}>
                            {cuando(m.createdAt)}
                          </p>
                        </div>
                      </div>
                    ),
                  )
                )}
              </div>

              <div className="border-t border-line p-3">
                {!bandeja.puedeEscribir || (conv && !conv.puedeEscribir) ? (
                  <p className="m-0 rounded-lg bg-bg2 px-3 py-2 text-center text-xs text-mute">
                    Tu rol en este equipo es de solo lectura.
                  </p>
                ) : (
                  <>
                    <div className="mb-2 flex gap-1 text-xs">
                      {(['sms', 'nota'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setModo(m)}
                          className={`rounded-pill px-2.5 py-1 font-medium ${
                            modo === m ? 'bg-brand text-white' : 'bg-bg2 text-mute'
                          }`}
                        >
                          {m === 'sms' ? 'Mensaje' : 'Nota interna'}
                        </button>
                      ))}
                    </div>
                    {modo === 'sms' && smsBloqueado ? (
                      <p className="m-0 rounded-lg bg-bg2 px-3 py-2 text-center text-xs text-mute">
                        {conv?.optOut
                          ? 'Esta persona se dio de baja de los mensajes de la marca. Puedes dejar una nota interna, pero no escribirle.'
                          : 'Este lead no tiene teléfono. Añádeselo en su ficha para poder escribirle.'}
                      </p>
                    ) : (
                      <div className="flex items-end gap-2">
                        <textarea
                          value={texto}
                          onChange={(e) => setTexto(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void enviar();
                          }}
                          rows={2}
                          maxLength={modo === 'sms' ? 1200 : 4000}
                          placeholder={
                            modo === 'sms'
                              ? 'Escribe un SMS… (Ctrl+Enter para enviar)'
                              : 'Nota para el equipo; el cliente no la ve… (Ctrl+Enter)'
                          }
                          className="input flex-1 resize-none"
                        />
                        <button
                          type="button"
                          onClick={() => void enviar()}
                          disabled={enviando || !texto.trim()}
                          className="btn-primary text-sm disabled:opacity-50"
                        >
                          {enviando ? '…' : modo === 'sms' ? 'Enviar' : 'Guardar'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
