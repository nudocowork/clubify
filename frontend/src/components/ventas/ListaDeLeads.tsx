'use client';

/**
 * Banco · Contactos · Clientes: la misma lista con otro filtro.
 *
 * El CRM enseña los leads agrupados por columna, que es lo que necesita un
 * kanban. Para trabajar hacen falta las otras dos preguntas: cuáles no tiene
 * nadie, y quiénes ya compraron. Eso es una lista plana, buscable y ordenada
 * por lo último que se movió — no un tablero.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

export type FiltroDeLista = 'banco' | 'contactos' | 'clientes';

type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  source: string | null;
  value: number | null;
  wonAt: string | null;
  lostReason: string | null;
  lastActivityAt: string;
  createdAt: string;
  mktContactId: string | null;
  mensajes: number;
  assignedUser: { id: string; fullName: string } | null;
  stage: { id: string; name: string; color: string | null } | null;
};

type Respuesta = {
  filtro: FiltroDeLista;
  total: number;
  truncado: boolean;
  puedeEscribir: boolean;
  leads: Lead[];
};

const TEXTOS: Record<FiltroDeLista, { titulo: string; pie: string; vacio: string }> = {
  banco: {
    titulo: 'Banco',
    pie: 'Leads que todavía no tiene nadie. Repártelos desde el CRM.',
    vacio: 'No hay nada sin repartir: todos los leads tienen vendedor.',
  },
  contactos: {
    titulo: 'Contactos',
    pie: 'Todas las personas del equipo, por lo último que se movió.',
    vacio: 'El equipo todavía no tiene ningún contacto.',
  },
  clientes: {
    titulo: 'Clientes',
    pie: 'Los que ya compraron, con lo que dejó cada uno.',
    vacio: 'Todavía no hay ninguna venta cerrada en este equipo.',
  },
};

const dinero = (n: number) =>
  '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

export function ListaDeLeads({ filtro }: { filtro: FiltroDeLista }) {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [equipo, setEquipo] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');

  const cargar = useCallback(async () => {
    if (!teamId) return;
    setError(null);
    try {
      const q = `?filtro=${filtro}${buscar.trim() ? `&buscar=${encodeURIComponent(buscar.trim())}` : ''}`;
      const [lista, resumen] = await Promise.all([
        api<Respuesta>(`/sales-teams/${teamId}/lista${q}`),
        api<{ team: { id: string; name: string } | null }>(`/sales-teams/${teamId}/resumen`).catch(
          () => null,
        ),
      ]);
      setDatos(lista);
      if (resumen?.team) setEquipo(resumen.team);
    } catch (e: any) {
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudo cargar la lista',
      );
    }
  }, [teamId, filtro, buscar]);

  useEffect(() => {
    // Se espera a que la persona deje de escribir: una consulta por tecla
    // pulsada castiga la base sin darle nada mejor a quien busca.
    const t = setTimeout(() => void cargar(), buscar ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, buscar]);

  const texto = TEXTOS[filtro];

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

  return (
    <div>
      {equipo && <CabeceraDeEquipo equipo={equipo} />}

      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="font-semibold">{texto.titulo}</div>
          <p className="text-xs text-mute mt-0.5">{texto.pie}</p>
        </div>
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar nombre, teléfono, correo o empresa…"
          className="input h-9 text-sm w-auto min-w-[260px]"
        />
      </div>

      {!datos ? (
        <div className="h-32 bg-bg2 rounded animate-shimmer" />
      ) : datos.leads.length === 0 ? (
        <div className="card card-pad text-center text-mute py-12">
          <div className="text-3xl mb-2">📇</div>
          <div className="font-semibold mb-1 text-ink">
            {buscar ? 'Nadie casa con esa búsqueda' : texto.titulo}
          </div>
          <div className="text-sm">{buscar ? 'Prueba con otro dato.' : texto.vacio}</div>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Persona</th>
                    <th className="px-4 py-3 font-semibold">Contacto</th>
                    <th className="px-4 py-3 font-semibold">Etapa</th>
                    <th className="px-4 py-3 font-semibold">Vendedor</th>
                    <th className="px-4 py-3 font-semibold">Origen</th>
                    <th className="px-4 py-3 font-semibold text-right">
                      {filtro === 'clientes' ? 'Vendido' : 'Valor'}
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">Actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.leads.map((l) => (
                    <tr key={l.id} className="border-t border-line2 hover:bg-bg2/40">
                      <td className="px-4 py-3">
                        <span className="font-medium block truncate max-w-[220px]">
                          {l.name || 'Sin nombre'}
                        </span>
                        {l.company && (
                          <span className="text-xs text-mute block truncate max-w-[220px]">
                            {l.company}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {l.phone && <span className="block tabular-nums">{l.phone}</span>}
                        {l.email && <span className="block text-mute truncate max-w-[200px]">{l.email}</span>}
                        {!l.phone && !l.email && <span className="text-mute2">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {l.stage ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                            style={{
                              background: (l.stage.color || '#94a3b8') + '22',
                              color: l.stage.color || '#475569',
                            }}
                          >
                            {l.stage.name}
                          </span>
                        ) : (
                          <span className="text-mute2 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {l.assignedUser ? (
                          l.assignedUser.fullName
                        ) : (
                          <span className="text-warn font-semibold">Sin asignar</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-mute">{l.source || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {l.value == null ? '—' : dinero(l.value)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-mute whitespace-nowrap">
                        {fecha(l.lastActivityAt)}
                        {l.mensajes > 0 && (
                          <span className="block text-[10px]">
                            {l.mensajes} {l.mensajes === 1 ? 'mensaje' : 'mensajes'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-mute mt-2">
            {datos.truncado
              ? `Se ven ${datos.leads.length} de ${datos.total}. Usa el buscador para llegar al resto.`
              : `${datos.total} ${datos.total === 1 ? 'persona' : 'personas'}.`}
            {filtro === 'banco' && datos.total > 0 && (
              <>
                {' '}
                <Link href={`/admin/sales-teams/${teamId}/board`} className="font-semibold text-brand hover:underline">
                  Repartirlos en el CRM →
                </Link>
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
