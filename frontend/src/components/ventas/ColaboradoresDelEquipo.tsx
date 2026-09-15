'use client';

/**
 * «Colaboradores» del equipo: quién lo ve y con qué rol. Es la pestaña de
 * TeamClubify (`TeamMembers`) traída a Clubify PRO.
 *
 * La ayuda de cada rol describe lo que Clubify PRO hace DE VERDAD, no la de la
 * referencia: aquí un closer también escribe, y lo que separa al closer del
 * setter es tener columna en la Agenda y recibir citas del Banco. Si esa ayuda
 * mintiera, alguien daría un rol pensando que limita algo que no limita.
 *
 * Colores por tokens: bajo `.brand-panel` la marca pone los suyos.
 */

import Link from 'next/link';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

type Rol = 'lider' | 'closer' | 'setter' | 'lectura';

const ROLES: { key: Rol; label: string; descripcion: string }[] = [
  {
    key: 'lider',
    label: 'Líder del equipo',
    descripcion:
      'Ve y trabaja todo el equipo. Además reparte las citas del Banco, configura los embudos del CRM, elimina contactos en lote, seguimientos y oportunidades, y gestiona a los colaboradores.',
  },
  {
    key: 'closer',
    label: 'Closer',
    descripcion:
      'Ve y trabaja todo el equipo. Tiene su columna en la Agenda y se le pueden asignar citas desde el Banco.',
  },
  {
    key: 'setter',
    label: 'Setter',
    descripcion:
      'Ve y trabaja todo el equipo: agenda, califica y hace seguimiento. No tiene columna en la Agenda ni recibe citas del Banco.',
  },
  { key: 'lectura', label: 'Solo lectura', descripcion: 'Consulta todo el equipo; no puede cambiar nada.' },
];
const ETIQUETA: Record<Rol, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.label])) as Record<Rol, string>;

type Miembro = {
  userId: string;
  nombre: string;
  email: string | null;
  roles: Rol[];
  activo: boolean;
  desde: string;
};

type Datos = {
  team: { id: string; name: string; isActive?: boolean };
  puedeEscribir: boolean;
  puedeGestionar: boolean;
  esAdminDeMarca: boolean;
  yo: string;
  lider: { id: string; nombre: string; email: string } | null;
  miembros: Miembro[];
};

type Candidato = { id: string; nombre: string; email: string | null; otrosEquipos: string[] };

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Varios roles a la vez (p. ej. setter + closer). «Solo lectura» excluye a los
 * demás y nunca queda vacío. El de líder solo lo toca un admin de la marca.
 */
function RolesMarcables({
  valor,
  deshabilitado,
  liderBloqueado,
  onCambio,
}: {
  valor: Rol[];
  deshabilitado?: boolean;
  liderBloqueado?: boolean;
  onCambio: (roles: Rol[]) => void;
}) {
  function alternar(r: Rol) {
    const tiene = valor.includes(r);
    let siguiente = tiene ? valor.filter((x) => x !== r) : [...valor, r];
    if (r === 'lectura' && !tiene) siguiente = ['lectura'];
    else if (siguiente.length > 1) siguiente = siguiente.filter((x) => x !== 'lectura');
    if (!siguiente.length) return; // desmarcar el único rol no hace nada
    const igual = siguiente.length === valor.length && siguiente.every((x) => valor.includes(x));
    if (!igual) onCambio(siguiente);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {ROLES.map((rol) => {
        const on = valor.includes(rol.key);
        const bloqueado = deshabilitado || (rol.key === 'lider' && liderBloqueado);
        return (
          <label
            key={rol.key}
            title={rol.key === 'lider' && liderBloqueado ? 'Solo un admin de la marca da o quita el rol de líder' : undefined}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
              on ? 'border-brand bg-brand-soft text-ink' : 'border-line text-mute'
            } ${bloqueado ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={bloqueado}
              onChange={() => alternar(rol.key)}
              className="accent-brand"
            />
            {rol.label}
          </label>
        );
      })}
    </div>
  );
}

export function ColaboradoresDelEquipo() {
  const rutaEquipos = useBaseDeEquipos();
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [quitando, setQuitando] = useState<Miembro | null>(null);

  const cargar = useCallback(async () => {
    if (!teamId) return;
    try {
      setDatos(await api<Datos>(`/sales-teams/${teamId}/colaboradores`));
      setError(null);
    } catch (e: any) {
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudieron cargar los colaboradores',
      );
    }
  }, [teamId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function correr(clave: string, fn: () => Promise<unknown>, ok?: string) {
    setOcupado(clave);
    try {
      await fn();
      if (ok) toast(ok, 'success');
      await cargar();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
    } finally {
      setOcupado(null);
    }
  }

  if (error) {
    return (
      <div className="card card-pad text-center py-12">
        <div className="text-3xl mb-2">⚠️</div>
        <div className="font-semibold mb-1">No se pudo cargar</div>
        <div className="text-sm text-mute mb-4">{error}</div>
        <Link href={rutaEquipos} className="btn-ghost text-sm inline-flex">
          Volver a los equipos
        </Link>
      </div>
    );
  }

  if (!datos) {
    return <div className="h-32 bg-bg2 rounded animate-shimmer" />;
  }

  const activos = datos.miembros.filter((m) => m.activo).length;
  const liderEsMiembro = !!datos.lider && datos.miembros.some((m) => m.userId === datos.lider!.id);

  return (
    <div>
      <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="m-0 max-w-2xl rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok-ink">
          {activos === 1 ? 'Esta persona ve' : `Estas ${activos} personas ven`} la agenda, el banco, los contactos, el
          CRM, los seguimientos y los clientes de <b>{datos.team.name}</b>. Quitar a alguien le cierra el acceso al
          instante, sin borrar su historial.
        </p>
        {datos.puedeGestionar && (
          <button type="button" className="btn-primary text-sm" onClick={() => setAgregando(true)}>
            + Agregar colaborador
          </button>
        )}
      </div>

      {datos.lider && !liderEsMiembro && (
        <p className="mb-3 text-xs text-mute">
          <span className="font-medium text-ink">{datos.lider.nombre}</span> figura como líder del equipo, pero no
          está en esta lista: para entrar al equipo tiene que agregarse como colaborador.
        </p>
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-bg2 text-left text-[11px] uppercase tracking-wider text-mute">
              <tr>
                <th className="px-3 py-2 font-semibold">Colaborador</th>
                <th className="px-3 py-2 font-semibold">Rol</th>
                <th className="px-3 py-2 font-semibold">Desde</th>
                {datos.puedeGestionar && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {datos.miembros.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-mute">
                    Nadie tiene acceso a este equipo todavía.
                  </td>
                </tr>
              )}
              {datos.miembros.map((m) => {
                const soyYo = m.userId === datos.yo;
                const esLider = m.roles.includes('lider');
                return (
                  <tr key={m.userId} className="border-t border-line align-top">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg2 text-xs font-bold text-ink">
                          {m.nombre.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-ink">
                            {m.nombre}
                            {soyYo && <span className="ml-1.5 text-[11px] font-normal text-mute">(tú)</span>}
                            {!m.activo && (
                              <span className="ml-2 rounded-pill bg-bg2 px-2 py-0.5 text-[10px] text-mute">inactivo</span>
                            )}
                          </div>
                          {m.email && <div className="truncate text-xs text-mute">{m.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {datos.puedeGestionar ? (
                        <RolesMarcables
                          valor={m.roles.length ? m.roles : ['lectura']}
                          deshabilitado={ocupado === m.userId}
                          liderBloqueado={!datos.esAdminDeMarca}
                          onCambio={(roles) =>
                            void correr(
                              m.userId,
                              () =>
                                api(`/sales-teams/${teamId}/colaboradores/${m.userId}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ roles }),
                                }),
                              'Roles guardados.',
                            )
                          }
                        />
                      ) : (
                        <span className="text-mute">
                          {(m.roles.length ? m.roles : ['lectura']).map((r) => ETIQUETA[r as Rol] ?? r).join(' + ')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-mute">{fecha(m.desde)}</td>
                    {datos.puedeGestionar && (
                      <td className="px-3 py-2.5 text-right">
                        {!(soyYo && !datos.esAdminDeMarca) && !(esLider && !datos.esAdminDeMarca) && (
                          <button
                            type="button"
                            onClick={() => setQuitando(m)}
                            disabled={ocupado === m.userId}
                            className="rounded-lg px-2.5 py-1 text-xs font-medium text-bad-ink hover:bg-bad-soft disabled:opacity-60"
                          >
                            Quitar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section className="mt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Qué puede hacer cada rol</h2>
        <ul className="card m-0 list-none divide-y divide-line p-0 text-sm">
          {ROLES.map((r) => (
            <li key={r.key} className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:gap-4">
              <span className="w-36 shrink-0 font-medium text-ink">{r.label}</span>
              <span className="text-mute">{r.descripcion}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-mute">
          Se pueden marcar <b>varios roles a la vez</b> (p. ej. Setter + Closer). Una persona puede estar en varios
          equipos con roles distintos. Un admin de la marca ve y trabaja todos los equipos aunque no esté en la lista.
        </p>
      </section>

      {agregando && (
        <AgregarColaborador
          teamId={teamId}
          equipo={datos.team.name}
          puedeDarLider={datos.esAdminDeMarca}
          onCerrar={() => setAgregando(false)}
          onAgregado={async () => {
            await cargar();
          }}
        />
      )}

      {quitando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setQuitando(null)} />
          <div className="relative w-full max-w-md card card-pad">
            <h3 className="m-0 mb-2 text-base font-semibold text-ink">Quitar del equipo</h3>
            <p className="m-0 text-sm text-ink">
              <b>{quitando.nombre}</b> dejará de ver los contactos, los chats, la agenda y el CRM de{' '}
              <b>{datos.team.name}</b>.
            </p>
            <p className="mb-0 mt-2 text-sm text-mute">
              No se borra nada: sus contactos, conversaciones y ventas siguen en el equipo.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setQuitando(null)} className="btn-ghost text-sm">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const m = quitando;
                  setQuitando(null);
                  void correr(
                    m.userId,
                    () => api(`/sales-teams/${teamId}/colaboradores/${m.userId}`, { method: 'DELETE' }),
                    'Acceso quitado.',
                  );
                }}
                className="rounded-lg bg-bad-soft px-4 py-2 text-sm font-semibold text-bad-ink"
              >
                Quitar acceso
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgregarColaborador({
  teamId,
  equipo,
  puedeDarLider,
  onCerrar,
  onAgregado,
}: {
  teamId: string;
  equipo: string;
  puedeDarLider: boolean;
  onCerrar: () => void;
  onAgregado: () => Promise<void>;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState<Record<string, Rol[]>>({});
  const [agregando, setAgregando] = useState<string | null>(null);

  useEffect(() => {
    api<{ candidatos: Candidato[] }>(`/sales-teams/${teamId}/colaboradores/candidatos`)
      .then((r) => setCandidatos(r.candidatos))
      .catch((e: any) => {
        toast(e?.message || 'No se pudieron cargar los candidatos', 'error');
        setCandidatos([]);
      });
  }, [teamId]);

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!candidatos) return [];
    if (!s) return candidatos;
    return candidatos.filter((c) => c.nombre.toLowerCase().includes(s) || (c.email ?? '').toLowerCase().includes(s));
  }, [q, candidatos]);

  async function agregar(c: Candidato) {
    setAgregando(c.id);
    try {
      await api(`/sales-teams/${teamId}/colaboradores`, {
        method: 'POST',
        body: JSON.stringify({ userId: c.id, roles: roles[c.id] ?? ['closer'] }),
      });
      toast(`${c.nombre} ya está en el equipo.`, 'success');
      setCandidatos((cs) => (cs ?? []).filter((x) => x.id !== c.id));
      await onAgregado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo agregar', 'error');
    } finally {
      setAgregando(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto card card-pad">
        <h3 className="m-0 text-base font-semibold text-ink">Agregar colaborador a {equipo}</h3>
        <p className="mb-3 mt-1 text-sm text-mute">
          Verá la agenda, el banco, los contactos, el CRM y los seguimientos de este equipo. No verá nada de los otros
          equipos.
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o correo"
          className="input mb-3"
          autoFocus
        />
        <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {candidatos === null ? (
            <p className="px-3 py-6 text-center text-sm text-mute">Cargando…</p>
          ) : lista.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-mute">
              {candidatos.length === 0
                ? 'No hay a quién agregar: los afiliados de la marca ya están en este equipo.'
                : 'Nadie coincide con esa búsqueda.'}
            </p>
          ) : (
            lista.map((c) => (
              <div key={c.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{c.nombre}</div>
                    <div className="truncate text-xs text-mute">
                      {c.email}
                      {c.otrosEquipos.length > 0 && ` · ya está en ${c.otrosEquipos.join(', ')}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void agregar(c)}
                    disabled={agregando === c.id}
                    className="btn-primary text-sm disabled:opacity-60"
                  >
                    {agregando === c.id ? 'Agregando…' : 'Agregar'}
                  </button>
                </div>
                <div className="mt-1.5">
                  <RolesMarcables
                    valor={roles[c.id] ?? ['closer']}
                    liderBloqueado={!puedeDarLider}
                    onCambio={(rs) => setRoles((r) => ({ ...r, [c.id]: rs }))}
                  />
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
