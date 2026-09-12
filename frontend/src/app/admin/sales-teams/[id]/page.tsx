'use client';

/**
 * Resumen de un equipo de ventas: cómo va, de un vistazo.
 *
 * El orden responde a cuatro preguntas, en este orden: qué hay hoy encima de
 * la mesa, cuántos leads entraron y por dónde, cómo va cada persona, y qué
 * está pidiendo atención. Todo viene de `GET /sales-teams/:id/resumen`, que lo
 * deriva en lectura — aquí no se calcula nada.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

type Resumen = {
  team: {
    id: string; name: string; slug: string | null; color: string | null;
    isActive: boolean; leadUser: { id: string; fullName: string; email: string } | null;
  } | null;
  puedeEscribir: boolean;
  kpis: {
    citasHoy: number; banco: number; chatsAbiertos: number;
    seguimientos: number; seguimientosVencidos: number;
    ventasMes: number; ventasMesUsd: number; contactos: number; leads: number;
  };
  leadsQueLlegaron: {
    desde: string; hasta: string; total: number;
    porOrigen: { whatsapp: number; agenda: number; otros: number };
    porDia: Array<{ dia: string; n: number }>;
  };
  colaboradores: Array<{
    userId: string; nombre: string; rol: string;
    citas: number; realizadas: number; ventas: number;
    ventasUsd: number; seguimientos: number;
  }>;
  requiereAtencion: Array<{ tipo: string; n: number; texto: string }>;
};

const dinero = (n: number) =>
  '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numero = (n: number) => n.toLocaleString('es-CO');
const soloDia = (iso: string) => iso.slice(0, 10);

function Kpi({
  etiqueta, valor, pie, tono,
}: { etiqueta: string; valor: string; pie?: string; tono?: 'alerta' | 'bien' }) {
  return (
    <div className="card card-pad">
      <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold">
        {etiqueta}
      </div>
      <div
        className={`text-2xl font-bold tabular-nums mt-1 leading-tight ${
          tono === 'alerta' ? 'text-warn' : tono === 'bien' ? 'text-ok' : ''
        }`}
      >
        {valor}
      </div>
      {pie && <div className="text-[11px] text-mute mt-0.5">{pie}</div>}
    </div>
  );
}

/** Barras por día. Se dibujan con divs: son una serie corta y sin ejes. */
function BarrasPorDia({ datos }: { datos: Array<{ dia: string; n: number }> }) {
  if (datos.length === 0) {
    return <p className="text-sm text-mute">Ningún lead entró en este período.</p>;
  }
  const tope = Math.max(...datos.map((d) => d.n), 1);
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
      {datos.map((d) => (
        <div key={d.dia} className="flex flex-col items-center gap-1 min-w-[26px]">
          <span className="text-[10px] tabular-nums text-mute">{d.n}</span>
          <div
            className="w-5 rounded-t bg-ok"
            style={{ height: `${Math.max((d.n / tope) * 90, 3)}px` }}
            title={`${d.dia}: ${d.n}`}
          />
          <span className="text-[9px] text-mute2 tabular-nums">{d.dia.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ResumenDeEquipoPage() {
  // `useParams`, no la firma con `params: Promise<>` de Next 15: este proyecto
  // va en Next 14 y ahí `use(params)` revienta EN EJECUCIÓN — `tsc` lo da por
  // bueno y la pantalla sale con «Algo salió mal». Mismo patrón que el CRM y
  // la agenda, que son sus hermanas.
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const q = desde && hasta ? `?desde=${desde}&hasta=${hasta}T23:59:59` : '';
      setDatos(await api<Resumen>(`/sales-teams/${id}/resumen${q}`));
    } catch (e: any) {
      // Un fallo tiene que verse y poder reintentarse, no dejar la pantalla
      // girando: es el mismo criterio que el tablero.
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudo cargar el resumen',
      );
    }
  }, [id, desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Las fechas del selector se siembran con lo que respondió el backend, para
  // que los campos digan el período que se está viendo de verdad.
  useEffect(() => {
    if (datos && !desde && !hasta) {
      setDesde(soloDia(datos.leadsQueLlegaron.desde));
      setHasta(soloDia(datos.leadsQueLlegaron.hasta));
    }
  }, [datos, desde, hasta]);

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

  if (!datos || !datos.team) {
    return (
      <div className="space-y-3">
        <div className="h-16 bg-bg2 rounded animate-shimmer" />
        <div className="h-28 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  const k = datos.kpis;
  const l = datos.leadsQueLlegaron;

  return (
    <div>
      <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Kpi etiqueta="Citas de hoy" valor={numero(k.citasHoy)} pie="en la agenda del equipo" />
        <Kpi
          etiqueta="En el banco"
          valor={numero(k.banco)}
          pie="sin vendedor asignado"
          tono={k.banco > 0 ? 'alerta' : undefined}
        />
        <Kpi etiqueta="Chats abiertos" valor={numero(k.chatsAbiertos)} pie="leads con conversación" />
        <Kpi
          etiqueta="Seguimientos"
          valor={numero(k.seguimientos)}
          pie={`${k.seguimientosVencidos} vencidos`}
          tono={k.seguimientosVencidos > 0 ? 'alerta' : undefined}
        />
        <Kpi
          etiqueta="Ventas del mes"
          valor={numero(k.ventasMes)}
          pie={k.ventasMesUsd > 0 ? dinero(k.ventasMesUsd) : 'sin importe registrado'}
          tono={k.ventasMes > 0 ? 'bien' : undefined}
        />
        <Kpi etiqueta="Contactos" valor={numero(k.contactos)} pie={`${numero(k.leads)} leads en total`} />
      </div>

      <div className="card card-pad mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="font-semibold">Leads que llegaron</div>
            <p className="text-xs text-mute mt-0.5">
              Contactos nuevos del equipo en el período — para cuadrar con quien
              trae el tráfico.
            </p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-xs text-mute">
              Desde
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input h-9 text-sm ml-1.5 w-auto" />
            </label>
            <label className="text-xs text-mute">
              Hasta
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="input h-9 text-sm ml-1.5 w-auto" />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg bg-emerald-50 px-3.5 py-2.5">
            <div className="text-[10.5px] uppercase tracking-wider text-emerald-700 font-semibold">Total leads</div>
            <div className="text-2xl font-bold tabular-nums text-emerald-700">{numero(l.total)}</div>
          </div>
          <div className="rounded-lg bg-bg2 px-3.5 py-2.5">
            <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold">Por WhatsApp</div>
            <div className="text-2xl font-bold tabular-nums">{numero(l.porOrigen.whatsapp)}</div>
          </div>
          <div className="rounded-lg bg-bg2 px-3.5 py-2.5">
            <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold">Por agenda web</div>
            <div className="text-2xl font-bold tabular-nums">{numero(l.porOrigen.agenda)}</div>
          </div>
          <div className="rounded-lg bg-bg2 px-3.5 py-2.5">
            <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold">Otros</div>
            <div className="text-2xl font-bold tabular-nums">{numero(l.porOrigen.otros)}</div>
          </div>
        </div>

        <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mb-2">Por día</div>
        <BarrasPorDia datos={l.porDia} />
      </div>

      <div className="card overflow-hidden p-0 mb-4">
        <div className="px-4 py-3 text-[10.5px] uppercase tracking-wider text-mute font-semibold border-b border-line2">
          Colaboradores del equipo
        </div>
        {datos.colaboradores.length === 0 ? (
          <p className="px-4 py-6 text-sm text-mute text-center">
            El equipo todavía no tiene colaboradores.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Persona</th>
                  <th className="px-4 py-2.5 font-semibold">Rol</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Citas</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Realizadas</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Ventas</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Seguimientos</th>
                </tr>
              </thead>
              <tbody>
                {datos.colaboradores.map((c) => (
                  <tr key={c.userId} className="border-t border-line2">
                    <td className="px-4 py-2.5 font-medium">{c.nombre}</td>
                    <td className="px-4 py-2.5 text-mute">{c.rol}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{numero(c.citas)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{numero(c.realizadas)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {c.ventas === 0 ? '—' : (
                        <>
                          {numero(c.ventas)}
                          {c.ventasUsd > 0 && <span className="text-mute"> · {dinero(c.ventasUsd)}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{numero(c.seguimientos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2.5 border-t border-line2">
          <Link href="/admin/sales-teams" className="text-xs font-semibold text-brand hover:underline">
            Poner y quitar colaboradores →
          </Link>
        </div>
      </div>

      {datos.requiereAtencion.length > 0 && (
        <div className="card card-pad">
          <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mb-2">
            Requiere atención
          </div>
          <ul className="flex flex-col gap-1.5">
            {datos.requiereAtencion.map((a) => (
              <li key={a.tipo} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-warn shrink-0" />
                <span>{a.texto}</span>
                {a.tipo === 'banco' && (
                  <Link href={`/admin/sales-teams/${id}/board`} className="text-xs font-semibold text-brand hover:underline ml-auto">
                    Ir al CRM
                  </Link>
                )}
                {a.tipo === 'agenda' && (
                  <Link href={`/admin/sales-teams/${id}/agenda`} className="text-xs font-semibold text-brand hover:underline ml-auto">
                    Crear el enlace
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
