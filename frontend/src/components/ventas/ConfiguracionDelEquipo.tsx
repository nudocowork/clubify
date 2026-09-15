'use client';

/**
 * «Configuración» del equipo: la pestaña de TeamClubify (`TeamSettings` y la
 * configuración del Banco por equipo).
 *
 * Cuatro tarjetas y cada una guarda lo suyo: identidad, el mensaje de WhatsApp
 * del closer, los nombres de las pestañas del Banco y qué enseña una cita en el
 * Banco. Debajo, dónde vive lo demás (horario y formulario de la agenda,
 * colaboradores).
 *
 * Cambiarla es del líder o un admin de la marca; el responsable y desactivar el
 * equipo, solo un admin. El resto del equipo la ve en solo lectura.
 * Colores por tokens: bajo `.brand-panel` / `.brand-auth` la marca pone los
 * suyos. El color del EQUIPO sí es un código: es un dato del equipo, no del tema.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo, type EquipoDeCabecera } from '@/components/ventas/CabeceraDeEquipo';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';
import { mensajeDeWhatsapp } from '@/lib/whatsapp-del-equipo';

type Opcion = { clave: string; etiqueta: string; ayuda?: string };

type Datos = {
  team: EquipoDeCabecera;
  puedeEscribir: boolean;
  puedeConfigurar: boolean;
  puedeCambiarResponsable: boolean;
  puedeDesactivar: boolean;
  identidad: {
    nombre: string;
    descripcion: string | null;
    color: string | null;
    estado: string;
    responsableId: string | null;
  };
  candidatosAResponsable: { id: string; nombre: string }[];
  /** '' = el mensaje de siempre. */
  mensajeWhatsapp: string;
  mensajePorDefecto: string;
  /** Este equipo recibe a quien escribe sin estar en el tablero. */
  recibeDesconocidos: boolean;
  banco: { etiquetas: Record<string, string>; campos: string[] };
  catalogos: { estados: Opcion[]; colores: string[]; pestanasDelBanco: Opcion[]; camposDelBanco: Opcion[] };
};

type AlGuardar = () => Promise<void>;

export function ConfiguracionDelEquipo() {
  const rutaEquipos = useBaseDeEquipos();
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!teamId) return;
    try {
      setDatos(await api<Datos>(`/sales-teams/${teamId}/configuracion`));
      setError(null);
    } catch (e: any) {
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudo cargar la configuración',
      );
    }
  }, [teamId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Tras guardar se relee, pero un fallo al releer NO se cuenta como «no se
   * guardó» (lo guardado ya entró) ni tira la pantalla entera a la de error.
   */
  const releer: AlGuardar = useCallback(async () => {
    try {
      setDatos(await api<Datos>(`/sales-teams/${teamId}/configuracion`));
    } catch {
      toast('Se guardó, pero no se pudo recargar la configuración. Actualiza la página.', 'error');
    }
  }, [teamId]);

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

  const base = `${rutaEquipos}/${teamId}`;
  const ro = !datos.puedeConfigurar;

  return (
    <div>
      <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />

      {ro && (
        <p className="mb-4 mt-0 rounded-lg bg-bg2 px-3 py-2 text-sm text-mute">
          Solo el líder del equipo o un admin de la marca pueden cambiar esta configuración.
        </p>
      )}

      {/* Cada tarjeta se vuelve a montar solo cuando cambia LO SUYO en el
          servidor: guardar una no borra lo que se estaba escribiendo en otra. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Identidad key={JSON.stringify(datos.identidad)} teamId={teamId} datos={datos} ro={ro} alGuardar={releer} />
        <MensajeDelCloser key={datos.mensajeWhatsapp} teamId={teamId} datos={datos} ro={ro} alGuardar={releer} />
        <EstadosDelBanco key={JSON.stringify(datos.banco.etiquetas)} teamId={teamId} datos={datos} ro={ro} alGuardar={releer} />
        <CamposDelBanco key={datos.banco.campos.join(',')} teamId={teamId} datos={datos} ro={ro} alGuardar={releer} />
      </div>

      <Tarjeta titulo="Lo demás del equipo" ayuda="Tiene su propia pestaña." className="mt-4">
        <ul className="m-0 flex list-none flex-col p-0 text-sm">
          {[
            ['Horario de la agenda y enlace público', `${base}/agenda`],
            ['Formulario que pide la agenda pública', `${base}/formularios`],
            ['Colaboradores y sus roles', `${base}/colaboradores`],
          ].map(([t, href]) => (
            <li key={href} className="flex items-center justify-between gap-3 border-b border-line2 py-2 last:border-0">
              <span className="text-mute">{t}</span>
              <Link href={href} className="shrink-0 text-xs font-semibold text-brand hover:underline">
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </div>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function Tarjeta({
  titulo,
  ayuda,
  className = '',
  children,
}: {
  titulo: string;
  ayuda?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card card-pad ${className}`}>
      <h2 className="m-0 text-sm font-semibold text-ink">{titulo}</h2>
      {ayuda && <p className="m-0 mt-0.5 text-xs text-mute">{ayuda}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function useGuardar(teamId: string, alGuardar: AlGuardar) {
  const [guardando, setGuardando] = useState(false);
  async function guardar(ruta: '' | '/mensaje' | '/banco', method: 'PATCH' | 'PUT', cuerpo: unknown, ok: string) {
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/configuracion${ruta}`, { method, body: JSON.stringify(cuerpo) });
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
      setGuardando(false);
      return;
    }
    toast(ok, 'success');
    await alGuardar();
    setGuardando(false);
  }
  return { guardando, guardar };
}

type PropsDeTarjeta = { teamId: string; datos: Datos; ro: boolean; alGuardar: AlGuardar };

function Identidad({ teamId, datos, ro, alGuardar }: PropsDeTarjeta) {
  const i = datos.identidad;
  const [nombre, setNombre] = useState(i.nombre);
  const [descripcion, setDescripcion] = useState(i.descripcion ?? '');
  const [color, setColor] = useState(i.color ?? '');
  const [estado, setEstado] = useState(i.estado);
  const [responsableId, setResponsableId] = useState(i.responsableId ?? '');
  const { guardando, guardar } = useGuardar(teamId, alGuardar);

  const colores = color && !datos.catalogos.colores.includes(color) ? [...datos.catalogos.colores, color] : datos.catalogos.colores;
  const responsableFuera =
    i.responsableId && !datos.candidatosAResponsable.some((c) => c.id === i.responsableId) ? i.responsableId : null;

  function enviar() {
    if (!nombre.trim()) {
      toast('El nombre del equipo es obligatorio', 'error');
      return;
    }
    const cuerpo: Record<string, unknown> = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      color: color || null,
    };
    // Solo lo que cambió de lo que tiene permisos aparte: mandar el estado de
    // siempre o el mismo responsable no debe chocar con esos permisos.
    if (estado !== i.estado) cuerpo.estado = estado;
    if (datos.puedeCambiarResponsable && (responsableId || null) !== i.responsableId) {
      cuerpo.responsableId = responsableId || null;
    }
    void guardar('', 'PATCH', cuerpo, 'Equipo actualizado.');
  }

  return (
    <Tarjeta titulo="Identidad del equipo">
      <div className="flex flex-col gap-3">
        <div>
          <label className="label">Nombre</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} disabled={ro} />
        </div>
        <div>
          <label className="label">Descripción</label>
          <input
            className="input"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            maxLength={240}
            disabled={ro}
            placeholder="Ventas de restaurantes en Medellín"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Responsable</label>
            <select
              className="input"
              value={responsableId}
              onChange={(e) => setResponsableId(e.target.value)}
              disabled={ro || !datos.puedeCambiarResponsable}
            >
              <option value="">Sin responsable</option>
              {responsableFuera && (
                <option value={responsableFuera}>{datos.team.leadUser?.fullName ?? 'Responsable actual'} (ya no está en el equipo)</option>
              )}
              {datos.candidatosAResponsable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <p className="m-0 mt-1 text-[11px] text-mute">
              {datos.puedeCambiarResponsable
                ? 'Queda como líder del equipo.'
                : 'Lo cambia un admin de la marca.'}
            </p>
          </div>
          <div>
            <label className="label">Estado</label>
            <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)} disabled={ro}>
              {datos.catalogos.estados.map((e) => (
                <option
                  key={e.clave}
                  value={e.clave}
                  // Desactivar (o salir de desactivado) es solo de un admin.
                  disabled={!datos.puedeDesactivar && (e.clave === 'desactivado' || i.estado === 'desactivado') && e.clave !== i.estado}
                >
                  {e.etiqueta}
                </option>
              ))}
            </select>
            <p className="m-0 mt-1 text-[11px] text-mute">
              {datos.catalogos.estados.find((e) => e.clave === estado)?.ayuda}
            </p>
          </div>
        </div>
        <div>
          <span className="label">Color</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color del equipo">
            {colores.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Color ${c}`}
                disabled={ro}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-lg ring-offset-2 disabled:opacity-50 ${color === c ? 'ring-2 ring-ink' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        {!ro && (
          <button type="button" className="btn-primary self-start text-sm" disabled={guardando} onClick={enviar}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
    </Tarjeta>
  );
}

function MensajeDelCloser({ teamId, datos, ro, alGuardar }: PropsDeTarjeta) {
  const [mensaje, setMensaje] = useState(datos.mensajeWhatsapp || datos.mensajePorDefecto);
  const [recibe, setRecibe] = useState(datos.recibeDesconocidos);
  const { guardando, guardar } = useGuardar(teamId, alGuardar);
  const vista = mensajeDeWhatsapp(mensaje.trim() || datos.mensajePorDefecto, {
    nombre: 'Ana',
    closer: 'Luis',
    equipo: datos.team.name,
  });

  return (
    <Tarjeta
      titulo="Mensaje de WhatsApp del closer"
      ayuda="El texto que se prellena al pulsar «WhatsApp» en el Banco y en Seguimientos. Admite {{nombre}}, {{closer}} y {{equipo}}."
    >
      <div className="flex flex-col gap-2">
        <textarea
          className="input min-h-[7rem]"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          maxLength={1000}
          disabled={ro}
        />
        <div className="rounded-lg bg-bg2 px-3 py-2 text-sm text-ink">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-mute">Así le llega a «Ana»</span>
          <span className="whitespace-pre-wrap">{vista}</span>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand"
            checked={recibe}
            disabled={ro}
            onChange={(e) => setRecibe(e.target.checked)}
          />
          <span>
            Recibir aquí los mensajes de números desconocidos
            <span className="block text-xs text-mute">
              Quien escriba por WhatsApp o SMS sin estar en el tablero entra como contacto nuevo de este equipo. Si la
              marca tiene un solo equipo ya entra aquí, aunque no lo marques.
            </span>
          </span>
        </label>
        {!ro && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={guardando}
              onClick={() =>
                void guardar(
                  '/mensaje',
                  'PUT',
                  { mensaje: mensaje.trim() || null, recibeDesconocidos: recibe },
                  'Mensaje guardado.',
                )
              }
            >
              {guardando ? 'Guardando…' : 'Guardar mensaje'}
            </button>
            {mensaje !== datos.mensajePorDefecto && (
              <button type="button" className="btn-ghost text-sm" onClick={() => setMensaje(datos.mensajePorDefecto)}>
                Volver al de siempre
              </button>
            )}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

function EstadosDelBanco({ teamId, datos, ro, alGuardar }: PropsDeTarjeta) {
  const pestanas = datos.catalogos.pestanasDelBanco;
  const [etiquetas, setEtiquetas] = useState<Record<string, string>>(() =>
    Object.fromEntries(pestanas.map((p) => [p.clave, datos.banco.etiquetas[p.clave] ?? p.etiqueta])),
  );
  const { guardando, guardar } = useGuardar(teamId, alGuardar);

  return (
    <Tarjeta
      titulo="Estados del Banco"
      ayuda="Renombra las pestañas del Banco de este equipo. Están todas, en el orden en que salen allí. Vacío = el nombre de siempre."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {pestanas.map((p) => (
          <div key={p.clave}>
            <label className="mb-1 block text-[11px] text-mute" htmlFor={`pestana-${p.clave}`}>
              {p.ayuda ?? p.etiqueta}
            </label>
            <input
              id={`pestana-${p.clave}`}
              className="input"
              value={etiquetas[p.clave] ?? ''}
              placeholder={p.etiqueta}
              maxLength={40}
              disabled={ro}
              onChange={(e) => setEtiquetas((x) => ({ ...x, [p.clave]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {!ro && (
        <button
          type="button"
          className="btn-primary mt-3 text-sm"
          disabled={guardando}
          onClick={() => void guardar('/banco', 'PUT', { etiquetas }, 'Estados guardados.')}
        >
          {guardando ? 'Guardando…' : 'Guardar estados'}
        </button>
      )}
    </Tarjeta>
  );
}

function CamposDelBanco({ teamId, datos, ro, alGuardar }: PropsDeTarjeta) {
  const [sel, setSel] = useState<string[]>(datos.banco.campos);
  const { guardando, guardar } = useGuardar(teamId, alGuardar);
  const alternar = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <Tarjeta
      titulo="Información visible en el Banco"
      ayuda="Lo que aparece al desplegar una cita, antes de asignarle closer. Marca al menos uno."
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {datos.catalogos.camposDelBanco.map((c) => (
          <label key={c.clave} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="accent-brand"
              checked={sel.includes(c.clave)}
              onChange={() => alternar(c.clave)}
              disabled={ro}
            />
            {c.etiqueta}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!ro && (
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={guardando || sel.length === 0}
            onClick={() => void guardar('/banco', 'PUT', { campos: sel }, 'Campos guardados.')}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        )}
        <span className="text-xs text-mute">
          {sel.length} campo{sel.length === 1 ? '' : 's'} seleccionado{sel.length === 1 ? '' : 's'}
        </span>
      </div>
    </Tarjeta>
  );
}
