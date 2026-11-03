'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// ABONOS — cada abono de USD 20 y qué pasó con él (Javier, 2026-11-03).
// El abono aparta el plan; el restante entra después por una oferta «+ Abono».
// Aquí se ven los que esperan el restante, los que ya se enlazaron (solos, por
// el correo, o a mano) y los que se dieron por perdidos. Lee/escribe
// /admin/contabilidad/abonos.

type Estado = 'EN_ESPERA' | 'ENLAZADO' | 'NO_PAGARA';

type Abono = {
  tx: string;
  fecha: string;
  montoUsd: number;
  devuelto: boolean;
  email: string | null;
  nombre: string | null;
  telefono: string | null;
  negocio: string | null;
  estado: Estado;
  enlace: 'AUTOMATICO' | 'MANUAL' | null;
  nota: string | null;
  pago: {
    tx: string;
    fecha: string;
    montoUsd: number | null;
    plan: string | null;
    precioDelPlanUsd: number | null;
  } | null;
};

type Candidato = {
  tx: string;
  fecha: string;
  montoUsd: number | null;
  negocio: string | null;
  email: string | null;
  tipo: 'RESTANTE' | 'VENTA_NUEVA';
  plan: string | null;
};

type Respuesta = {
  resumen: Record<'enEspera' | 'enlazados' | 'noPagara', { cantidad: number; usd: number }>;
  abonos: Abono[];
  candidatos: Candidato[];
};

const FILTROS: Array<{ id: Estado | 'TODOS'; etiqueta: string }> = [
  { id: 'EN_ESPERA', etiqueta: 'En espera' },
  { id: 'ENLAZADO', etiqueta: 'Enlazados' },
  { id: 'NO_PAGARA', etiqueta: 'No pagarán' },
  { id: 'TODOS', etiqueta: 'Todos' },
];

const usd = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fecha = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Para buscar sin que importen mayúsculas ni tildes. */
const plano = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ETIQUETA: Record<Estado, { texto: string; badge: string }> = {
  EN_ESPERA: { texto: 'En espera', badge: 'badge-warn' },
  ENLAZADO: { texto: 'Enlazado', badge: 'badge-ok' },
  NO_PAGARA: { texto: 'No pagará', badge: 'badge-mute' },
};

export default function AbonosPage() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Estado | 'TODOS'>('EN_ESPERA');
  const [buscar, setBuscar] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busquedaPago, setBusquedaPago] = useState('');
  const [pagoElegido, setPagoElegido] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await api<Respuesta>('/admin/contabilidad/abonos'));
    } catch {
      setError('No se pudieron cargar los abonos.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const q = plano(buscar);
    return (datos?.abonos ?? []).filter(
      (a) =>
        (filtro === 'TODOS' || a.estado === filtro) &&
        (!q || [a.nombre, a.email, a.telefono, a.negocio, a.tx].some((x) => plano(x).includes(q))),
    );
  }, [datos, filtro, buscar]);

  const candidatos = useMemo(() => {
    const q = plano(busquedaPago);
    return (datos?.candidatos ?? []).filter(
      (c) => !q || [c.negocio, c.email, c.tx, c.plan].some((x) => plano(x).includes(q)),
    );
  }, [datos, busquedaPago]);

  function abrir(tx: string) {
    setAbierto((actual) => (actual === tx ? null : tx));
    setBusquedaPago('');
    setPagoElegido('');
    setNota('');
  }

  async function accion(tx: string, ruta: string, init: RequestInit, hecho: string) {
    setGuardando(true);
    try {
      const r = await api<Respuesta>(`/admin/contabilidad/abonos/${encodeURIComponent(tx)}/${ruta}`, init);
      setDatos(r);
      setAbierto(null);
      toast(hecho, 'success');
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  const enlazar = (tx: string) =>
    accion(
      tx,
      'enlazar',
      { method: 'POST', body: JSON.stringify({ pagoTx: pagoElegido, nota: nota || undefined }) },
      'Abono enlazado',
    );
  const noPagara = (tx: string) =>
    accion(tx, 'no-pagara', { method: 'POST', body: JSON.stringify({ nota: nota || undefined }) }, 'Marcado como «No pagará»');
  const deshacer = (tx: string) => accion(tx, 'decision', { method: 'DELETE' }, 'Decisión deshecha');

  const r = datos?.resumen;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Abonos{' '}
          <span className="page-crumb">
            <Link href="/admin/contabilidad" className="hover:text-brand transition">
              Contabilidad
            </Link>
          </span>
        </h1>
        <button type="button" className="btn-ghost text-sm" onClick={cargar} disabled={cargando}>
          Actualizar
        </button>
      </div>
      <p className="text-sm text-mute mb-4 -mt-2 max-w-3xl">
        Cada abono de USD 20 y qué pasó con él. Si el cliente paga el restante con el{' '}
        <strong>mismo correo</strong>, se enlaza solo. Si usó otro correo, enlázalo a mano. Al closer
        solo le sale comisión cuando entra el restante, y siempre sobre el plan completo.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {(
          [
            ['En espera del restante', r?.enEspera, 'text-warn-ink'],
            ['Enlazados con su plan', r?.enlazados, 'text-ok-ink'],
            ['No pagarán', r?.noPagara, 'text-mute'],
          ] as const
        ).map(([titulo, v, color]) => (
          <div key={titulo} className="card card-pad">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">{titulo}</div>
            <div className={`text-2xl font-semibold mt-1 tabular-nums ${color}`}>{cargando ? '…' : v?.cantidad ?? 0}</div>
            <div className="text-xs text-mute tabular-nums">{cargando ? '' : `${usd(v?.usd ?? 0)} en abonos`}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={filtro === f.id ? 'btn-primary text-sm' : 'btn-ghost text-sm'}
          >
            {f.etiqueta}
          </button>
        ))}
        <input
          className="input text-sm ml-auto w-full sm:w-72"
          placeholder="Buscar por nombre, correo, teléfono o negocio"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
      </div>

      {error && !cargando && (
        <div className="card card-pad">
          <div className="text-sm text-bad-ink">{error}</div>
          <button type="button" className="btn-ghost text-sm mt-2" onClick={cargar}>
            Reintentar
          </button>
        </div>
      )}

      {!error && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] min-w-[900px]">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold text-right">Abono</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Pago restante</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {cargando &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-t border-line2">
                      <td colSpan={6} className="px-4 py-3.5">
                        <div className="h-6 bg-bg2 rounded animate-shimmer" />
                      </td>
                    </tr>
                  ))}
                {!cargando && visibles.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-mute">
                      No hay abonos en esta vista.
                    </td>
                  </tr>
                )}
                {!cargando &&
                  visibles.map((a) => (
                    <FilaAbono
                      key={a.tx}
                      a={a}
                      abierto={abierto === a.tx}
                      onAbrir={() => abrir(a.tx)}
                      candidatos={candidatos}
                      busquedaPago={busquedaPago}
                      setBusquedaPago={setBusquedaPago}
                      pagoElegido={pagoElegido}
                      setPagoElegido={setPagoElegido}
                      nota={nota}
                      setNota={setNota}
                      guardando={guardando}
                      onEnlazar={() => enlazar(a.tx)}
                      onNoPagara={() => noPagara(a.tx)}
                      onDeshacer={() => deshacer(a.tx)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaAbono(props: {
  a: Abono;
  abierto: boolean;
  onAbrir: () => void;
  candidatos: Candidato[];
  busquedaPago: string;
  setBusquedaPago: (v: string) => void;
  pagoElegido: string;
  setPagoElegido: (v: string) => void;
  nota: string;
  setNota: (v: string) => void;
  guardando: boolean;
  onEnlazar: () => void;
  onNoPagara: () => void;
  onDeshacer: () => void;
}) {
  const { a } = props;
  const et = ETIQUETA[a.estado];
  return (
    <>
      <tr className="border-t border-line2 align-top">
        <td className="px-4 py-3.5 whitespace-nowrap">{fecha(a.fecha)}</td>
        <td className="px-4 py-3.5">
          <div className="font-medium">{a.nombre ?? '—'}</div>
          {a.email && <div className="text-mute text-xs">{a.email}</div>}
          {a.telefono && <div className="text-mute text-xs">{a.telefono}</div>}
        </td>
        <td className="px-4 py-3.5 text-right whitespace-nowrap tabular-nums">
          {usd(a.montoUsd)}
          <div className="text-[10px] text-mute font-mono">{a.tx}</div>
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className={`badge ${et.badge}`}>{et.texto}</span>
            {a.devuelto && <span className="badge badge-bad">Devuelto</span>}
          </div>
          {a.enlace && (
            <div className="text-[11px] text-mute mt-1">
              {a.enlace === 'AUTOMATICO' ? 'Solo, por el correo' : 'A mano'}
            </div>
          )}
          {a.nota && <div className="text-[11px] text-mute mt-1 max-w-[220px]">{a.nota}</div>}
        </td>
        <td className="px-4 py-3.5">
          {a.pago ? (
            <>
              <div className="font-medium">{a.negocio ?? '—'}</div>
              <div className="text-mute text-xs">
                {a.pago.plan ?? 'Pago del plan'} · {usd(a.pago.montoUsd)} · {fecha(a.pago.fecha)}
              </div>
              {a.pago.precioDelPlanUsd != null && (
                <div className="text-[11px] text-mute">Comisión del closer sobre {usd(a.pago.precioDelPlanUsd)}</div>
              )}
            </>
          ) : (
            <span className="text-mute">Sin restante</span>
          )}
        </td>
        <td className="px-4 py-3.5 text-right whitespace-nowrap">
          {a.estado === 'EN_ESPERA' && (
            <button type="button" className="btn-ghost text-sm" onClick={props.onAbrir}>
              {props.abierto ? 'Cerrar' : 'Decidir'}
            </button>
          )}
          {a.estado === 'NO_PAGARA' && (
            <div className="flex justify-end gap-1">
              <button type="button" className="btn-ghost text-sm" onClick={props.onAbrir}>
                Enlazar
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={props.onDeshacer} disabled={props.guardando}>
                Volver a espera
              </button>
            </div>
          )}
          {a.estado === 'ENLAZADO' && a.enlace === 'MANUAL' && (
            <button type="button" className="btn-ghost text-sm" onClick={props.onDeshacer} disabled={props.guardando}>
              Deshacer enlace
            </button>
          )}
        </td>
      </tr>
      {props.abierto && (
        <tr className="bg-bg2/60">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] items-start">
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-mute uppercase tracking-wider">
                  Enlazar con el pago del restante
                </div>
                <input
                  className="input text-sm"
                  placeholder="Buscar el pago por negocio, correo o transacción"
                  value={props.busquedaPago}
                  onChange={(e) => props.setBusquedaPago(e.target.value)}
                />
                <select
                  className="input text-sm"
                  value={props.pagoElegido}
                  onChange={(e) => props.setPagoElegido(e.target.value)}
                >
                  <option value="">Elige el pago…</option>
                  {props.candidatos.map((c) => (
                    <option key={c.tx} value={c.tx}>
                      {[
                        c.tipo === 'RESTANTE' ? 'Restante' : 'Venta nueva',
                        c.negocio ?? 'Sin negocio',
                        c.plan,
                        usd(c.montoUsd),
                        fecha(c.fecha),
                        c.email,
                        c.tx,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
                <input
                  className="input text-sm"
                  placeholder="Nota (opcional): por qué se enlaza o se descarta"
                  maxLength={300}
                  value={props.nota}
                  onChange={(e) => props.setNota(e.target.value)}
                />
              </div>
              <div className="flex md:flex-col gap-2 md:pt-6">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={props.onEnlazar}
                  disabled={!props.pagoElegido || props.guardando}
                >
                  Enlazar
                </button>
                {a.estado === 'EN_ESPERA' && (
                  <button type="button" className="btn-ghost text-sm" onClick={props.onNoPagara} disabled={props.guardando}>
                    No pagará
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
