'use client';

/**
 * La pantalla de entrada de Equipos de Ventas: tarjetas con cifras y una tabla
 * para comparar.
 *
 * POR QUÉ. La lista enseñaba nombre, líder y «0 miembros». Con eso no se puede
 * decidir nada: no dice si el equipo está trabajando, cuánto tiene sin repartir
 * ni qué vendió. La referencia que pidió Javier —TeamClubify— pone las cifras
 * en la propia tarjeta y deja comparar equipos en una tabla ordenable. Esto es
 * eso, con los datos que Clubify PRO sí tiene.
 *
 * LO QUE NO SE PINTA, PORQUE NO EXISTE AQUÍ:
 *  - El WhatsApp del equipo y su «Conectado». En Clubify PRO el canal no se
 *    conecta por equipo: los mensajes salen por la subcuenta de la marca. En su
 *    sitio va si el equipo está activo o pausado, que sí es un dato real.
 *  - Los mensajes «sin leer». No se guarda cuándo se leyó una conversación.
 *    Un número inventado a partir del último mensaje parecería real.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';

export type MetricasEquipo = {
  citasHoy: number;
  banco: number;
  chats: number;
  leads: number;
  ventas: number;
  ventasUsd: number;
  contactos: number;
  ultimaActividad: string | null;
};

export type EquipoConCifras = {
  id: string;
  name: string;
  slug?: string | null;
  color?: string | null;
  isActive?: boolean;
  leadUser: { id: string; fullName: string; email: string } | null;
  memberCount: number;
  createdAt: string;
  metricas?: MetricasEquipo;
};

const CERO: MetricasEquipo = {
  citasHoy: 0, banco: 0, chats: 0, leads: 0,
  ventas: 0, ventasUsd: 0, contactos: 0, ultimaActividad: null,
};

const dinero = (n: number) =>
  '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const numero = (n: number) => n.toLocaleString('es-CO');

/** «hace 11 min», «hace 3 h», «hace 3 días». Sin actividad: null. */
function haceCuanto(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

/** El color del equipo, con un respaldo estable derivado de su id. */
const PALETA = ['#1baf7a', '#2a78d6', '#eda100', '#7c5cd6', '#eb6834'];
function colorDe(equipo: EquipoConCifras): string {
  if (equipo.color) return equipo.color;
  let suma = 0;
  for (const c of equipo.id) suma = (suma + c.charCodeAt(0)) % 997;
  return PALETA[suma % PALETA.length];
}

/** Una cifra de la tira. `alerta` la pinta en rojo: pide atención. */
function Cifra({ valor, etiqueta, alerta }: { valor: string; etiqueta: string; alerta?: boolean }) {
  return (
    <div className="flex-1 min-w-0 px-1 py-2.5 text-center">
      <div className={`text-lg font-bold tabular-nums leading-none ${alerta ? 'text-red-600' : ''}`}>
        {valor}
      </div>
      <div className="text-[9.5px] uppercase tracking-wider text-mute mt-1 truncate">
        {etiqueta}
      </div>
    </div>
  );
}

export function TarjetaDeEquipo({
  equipo,
  onAbrirMiembros,
}: {
  equipo: EquipoConCifras;
  onAbrirMiembros: () => void;
}) {
  const m = equipo.metricas ?? CERO;
  const actividad = haceCuanto(m.ultimaActividad);
  return (
    <div className="card overflow-hidden p-0 flex flex-col">
      <div className="h-1" style={{ background: colorDe(equipo) }} />
      <div className="px-4 pt-3.5 pb-2 flex items-start gap-3">
        <span
          className="w-9 h-9 rounded-lg grid place-items-center text-white font-bold shrink-0"
          style={{ background: colorDe(equipo) }}
        >
          {equipo.name.trim().charAt(0).toUpperCase()}
        </span>
        {/* El nombre lleva al equipo. Los miembros se gestionan desde su
            propio botón: son dos cosas distintas y antes compartían clic. */}
        <Link href={`/admin/sales-teams/${equipo.id}`} className="flex-1 min-w-0 hover:opacity-80 transition">
          <div className="font-semibold truncate">{equipo.name}</div>
          <div className="text-xs text-mute truncate">
            {equipo.leadUser ? equipo.leadUser.fullName : 'Sin líder asignado'}
          </div>
        </Link>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
            equipo.isActive === false
              ? 'bg-slate-200 text-slate-600'
              : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {equipo.isActive === false ? 'Pausado' : 'Activo'}
        </span>
      </div>

      <div className="px-4 pb-2 text-xs text-mute">
        <button onClick={onAbrirMiembros} className="hover:text-ink hover:underline transition">
          {equipo.memberCount === 1 ? '1 colaborador' : `${equipo.memberCount} colaboradores`}
        </button>
      </div>

      <div className="flex border-t border-line2 divide-x divide-line2">
        <Cifra valor={numero(m.citasHoy)} etiqueta="Citas hoy" />
        <Cifra valor={numero(m.banco)} etiqueta="Banco" alerta={m.banco > 0} />
        <Cifra valor={numero(m.chats)} etiqueta="Chats" />
        <Cifra valor={numero(m.leads)} etiqueta="Leads" />
        <Cifra valor={numero(m.ventas)} etiqueta="Ventas" />
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-line2 text-[11px] text-mute">
        <span className="truncate">
          {actividad ? `Última actividad ${actividad}` : 'Sin actividad todavía'}
        </span>
        <span className="shrink-0">
          {numero(m.contactos)} {m.contactos === 1 ? 'contacto' : 'contactos'}
          {m.ventasUsd > 0 && <> · {dinero(m.ventasUsd)}</>}
        </span>
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-line2 mt-auto">
        <Link href={`/admin/sales-teams/${equipo.id}/board`} className="btn-ghost flex-1 justify-center text-sm">
          Tablero
        </Link>
        <Link href={`/admin/sales-teams/${equipo.id}/agenda`} className="btn-ghost flex-1 justify-center text-sm">
          Agenda
        </Link>
      </div>
    </div>
  );
}

type Columna = {
  clave: 'citasHoy' | 'banco' | 'chats' | 'leads' | 'ventas' | 'contactos';
  etiqueta: string;
  alerta?: boolean;
};

const COLUMNAS: Columna[] = [
  { clave: 'citasHoy', etiqueta: 'Citas hoy' },
  { clave: 'banco', etiqueta: 'Banco', alerta: true },
  { clave: 'chats', etiqueta: 'Chats' },
  { clave: 'leads', etiqueta: 'Leads' },
  { clave: 'ventas', etiqueta: 'Ventas' },
  { clave: 'contactos', etiqueta: 'Contactos' },
];

export function TablaComparar({ equipos }: { equipos: EquipoConCifras[] }) {
  const [orden, setOrden] = useState<Columna['clave']>('ventas');

  const filas = useMemo(
    () =>
      [...equipos].sort(
        (a, b) => (b.metricas?.[orden] ?? 0) - (a.metricas?.[orden] ?? 0),
      ),
    [equipos, orden],
  );

  const total = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of COLUMNAS) {
      t[c.clave] = equipos.reduce((a, e) => a + (e.metricas?.[c.clave] ?? 0), 0);
    }
    t.ventasUsd = equipos.reduce((a, e) => a + (e.metricas?.ventasUsd ?? 0), 0);
    return t;
  }, [equipos]);

  return (
    <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs text-mute">Ordenar por</span>
        {COLUMNAS.map((c) => (
          <button
            key={c.clave}
            onClick={() => setOrden(c.clave)}
            className={`px-3 py-1 rounded-pill text-xs font-semibold border transition ${
              orden === c.clave
                ? 'bg-ink text-white border-ink'
                : 'bg-white text-ink border-line hover:bg-bg2'
            }`}
          >
            {c.etiqueta}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">Equipo</th>
                {COLUMNAS.map((c) => (
                  <th key={c.clave} className="px-4 py-3 font-semibold text-right">{c.etiqueta}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filas.map((e) => {
                const m = e.metricas ?? CERO;
                return (
                  <tr key={e.id} className="border-t border-line2 hover:bg-bg2/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-1 h-8 rounded-pill shrink-0" style={{ background: colorDe(e) }} />
                        <span className="min-w-0">
                          <span className="font-semibold block truncate">{e.name}</span>
                          <span className="text-xs text-mute block truncate">
                            {e.leadUser?.fullName ?? 'Sin líder'}
                          </span>
                        </span>
                      </div>
                    </td>
                    {COLUMNAS.map((c) => (
                      <td
                        key={c.clave}
                        className={`px-4 py-3 text-right tabular-nums ${
                          c.alerta && m[c.clave] > 0 ? 'text-red-600 font-semibold' : ''
                        }`}
                      >
                        {numero(m[c.clave])}
                        {c.clave === 'ventas' && m.ventasUsd > 0 && (
                          <span className="block text-[11px] text-mute">{dinero(m.ventasUsd)}</span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/sales-teams/${e.id}`} className="text-xs font-semibold text-brand hover:underline">
                        Abrir
                      </Link>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-line2 bg-bg2/60 font-semibold">
                <td className="px-4 py-3">Total</td>
                {COLUMNAS.map((c) => (
                  <td key={c.clave} className="px-4 py-3 text-right tabular-nums">
                    {numero(total[c.clave] ?? 0)}
                    {c.clave === 'ventas' && (total.ventasUsd ?? 0) > 0 && (
                      <span className="block text-[11px] text-mute font-normal">
                        {dinero(total.ventasUsd)}
                      </span>
                    )}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-mute mt-2">
        En rojo, lo que pide atención: leads en el banco, todavía sin vendedor
        asignado.
      </p>
    </>
  );
}
