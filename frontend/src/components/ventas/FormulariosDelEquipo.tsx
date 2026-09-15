'use client';

/**
 * «Formularios» del equipo: el constructor de TeamClubify (`FormsManager`).
 *
 * A la izquierda los formularios del equipo; a la derecha el que se edita:
 * nombre, descripción, activo, a qué WhatsApp se manda a la persona al terminar,
 * y las preguntas —tipo, ayuda, sección, a qué dato del lead va, obligatoria,
 * puntaje, opciones y cuándo se muestra—. «Probar» lo enseña como lo verá quien
 * lo rellena. El que se usa en la agenda pública lleva la marca «Agenda».
 *
 * Cambiarlos es del líder o un admin de la marca; el resto del equipo los ve.
 * Colores por tokens: bajo `.brand-panel` / `.brand-auth` la marca pone los suyos.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';
import { CamposDelFormulario } from '@/components/formularios/CamposDelFormulario';
import {
  DESTINOS_EN_EL_LEAD,
  ETIQUETA_DE_TIPO,
  OPERADORES,
  TIPOS_CON_OPCIONES,
  TIPOS_DE_CAMPO,
  camposQueFaltan,
  claveDesdeTexto,
  nuevoId,
  pideDatoDeContacto,
  type CampoDeFormulario,
  type OpcionDeCampo,
  type Operador,
  type Respuestas,
  type TipoDeCampo,
} from '@/lib/formularios';

type Formulario = {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  campos: CampoDeFormulario[];
  redirectWhatsapp: string | null;
  redirectMessage: string | null;
  respuestas: number;
  creadoEl: string;
};

type Datos = {
  team: { id: string; name: string; isActive?: boolean };
  puedeEscribir: boolean;
  puedeConfigurar: boolean;
  enlaceDeAgenda: string | null;
  formularioDeAgenda: string | null;
  formularios: Formulario[];
};

export function FormulariosDelEquipo() {
  const rutaEquipos = useBaseDeEquipos();
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [sinGuardar, setSinGuardar] = useState(false);

  const cargar = useCallback(
    async (elegir?: string) => {
      if (!teamId) return;
      try {
        const r = await api<Datos>(`/sales-teams/${teamId}/formularios`);
        setDatos(r);
        setError(null);
        setSelId((s) =>
          elegir ?? (s && r.formularios.some((f) => f.id === s) ? s : (r.formularios[0]?.id ?? null)),
        );
      } catch (e: any) {
        setError(
          e?.status === 404
            ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
            : e?.message || 'No se pudieron cargar los formularios',
        );
      }
    },
    [teamId],
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Cambiar de formulario remonta el editor: lo no guardado se perdía sin avisar
   * (Fable, 2026-09-15).
   */
  function puedeSalir(): boolean {
    return !sinGuardar || window.confirm('Tienes cambios sin guardar en este formulario. ¿Descartarlos?');
  }

  async function crear(plantilla: 'agenda' | 'vacio') {
    if (!puedeSalir()) return;
    const nombre = window.prompt(
      'Nombre del formulario:',
      plantilla === 'agenda' ? 'Formulario de agenda' : 'Nuevo formulario',
    );
    if (!nombre?.trim()) return;
    setCreando(true);
    try {
      const r = await api<{ id: string }>(`/sales-teams/${teamId}/formularios`, {
        method: 'POST',
        body: JSON.stringify({ nombre: nombre.trim(), plantilla }),
      });
      toast('Formulario creado.', 'success');
      setSinGuardar(false);
      await cargar(r.id);
    } catch (e: any) {
      toast(e?.message || 'No se pudo crear el formulario', 'error');
    } finally {
      setCreando(false);
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

  const sel = datos.formularios.find((f) => f.id === selId) ?? null;

  return (
    <div>
      <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />

      <div className="grid gap-4 md:grid-cols-[17rem,1fr]">
        <aside className="flex flex-col gap-2">
          {datos.puedeConfigurar && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-sm" disabled={creando} onClick={() => void crear('vacio')}>
                + Nuevo
              </button>
              <button type="button" className="btn-ghost text-sm" disabled={creando} onClick={() => void crear('agenda')}>
                Desde la plantilla de agenda
              </button>
            </div>
          )}

          {datos.formularios.length === 0 ? (
            <p className="card card-pad m-0 text-sm text-mute">
              Todavía no hay formularios.{' '}
              {datos.puedeConfigurar
                ? 'La plantilla de agenda trae las preguntas con las que se califica a quien reserva.'
                : 'Los crea el líder del equipo o un admin de la marca.'}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {datos.formularios.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (f.id === selId || !puedeSalir()) return;
                      setSinGuardar(false);
                      setSelId(f.id);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      f.id === selId ? 'border-brand bg-brand-soft' : 'border-line hover:bg-bg2'
                    }`}
                  >
                    <span className="block truncate text-sm font-medium text-ink">{f.nombre}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">
                      {datos.formularioDeAgenda === f.id && (
                        <span className="rounded-pill bg-ok-soft px-1.5 py-0.5 font-medium text-ok-ink">Agenda</span>
                      )}
                      {!f.activo && <span className="rounded-pill bg-bg2 px-1.5 py-0.5">Inactivo</span>}
                      <span>
                        {f.campos.length} pregunta{f.campos.length === 1 ? '' : 's'} · {f.respuestas} respuesta
                        {f.respuestas === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="m-0 mt-1 text-xs text-mute">
            {datos.enlaceDeAgenda ? (
              <>
                Agenda pública:{' '}
                <a href={datos.enlaceDeAgenda} target="_blank" rel="noreferrer" className="underline">
                  {datos.enlaceDeAgenda}
                </a>
              </>
            ) : (
              'El equipo todavía no tiene enlace público de agenda: se crea en «Agenda».'
            )}
          </p>
        </aside>

        {sel ? (
          <EditorDeFormulario
            key={sel.id}
            teamId={teamId}
            datos={datos}
            formulario={sel}
            onGuardado={() => void cargar(sel.id)}
            onBorrado={() => {
              setSinGuardar(false);
              void cargar();
            }}
            onCambios={setSinGuardar}
          />
        ) : (
          <div className="card card-pad py-10 text-center text-sm text-mute">Elige o crea un formulario.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Quita la condición a las preguntas que dependen de una que ya no está ANTES
 * que ellas. Pasaba al subir una pregunta por encima de la que la condiciona: el
 * editor enseñaba «Siempre», la fila «condicional», y el servidor no dejaba
 * guardar (Fable, 2026-09-15).
 */
function sinCondicionesColgadas(campos: CampoDeFormulario[]): CampoDeFormulario[] {
  const anteriores = new Set<string>();
  return campos.map((c) => {
    const colgada = !!c.condition?.when && !anteriores.has(c.condition.when);
    anteriores.add(c.key);
    return colgada ? { ...c, condition: null } : c;
  });
}

// ── Editor ──────────────────────────────────────────────────────────────────

function EditorDeFormulario({
  teamId,
  datos,
  formulario,
  onGuardado,
  onBorrado,
  onCambios,
}: {
  teamId: string;
  datos: Datos;
  formulario: Formulario;
  onGuardado: () => void;
  onBorrado: () => void;
  /** Si hay cambios sin guardar: el padre avisa antes de cambiar de formulario. */
  onCambios: (hay: boolean) => void;
}) {
  const soloLectura = !datos.puedeConfigurar;
  const [nombre, setNombre] = useState(formulario.nombre);
  const [descripcion, setDescripcion] = useState(formulario.descripcion ?? '');
  const [activo, setActivo] = useState(formulario.activo);
  const [campos, setCampos] = useState<CampoDeFormulario[]>(formulario.campos);
  const [whatsapp, setWhatsapp] = useState(formulario.redirectWhatsapp ?? '');
  const [mensaje, setMensaje] = useState(formulario.redirectMessage ?? '');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [vista, setVista] = useState<'editar' | 'probar'>('editar');
  const [prueba, setPrueba] = useState<Respuestas>({});
  const [faltanEnPrueba, setFaltanEnPrueba] = useState<Set<string>>(new Set());
  const [cambios, setCambios] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const esDeAgenda = datos.formularioDeAgenda === formulario.id;
  // «Usar en la agenda» mira lo GUARDADO, que es lo que la agenda usará; el
  // aviso mira lo que se está editando.
  const guardadoConContacto = pideDatoDeContacto(formulario.campos);
  const conContacto = pideDatoDeContacto(campos);

  const tocar = () => setCambios(true);

  useEffect(() => {
    onCambios(cambios);
  }, [cambios, onCambios]);

  function cambiarCampo(id: string, parche: Partial<CampoDeFormulario>) {
    setCampos((cs) => {
      const antes = cs.find((c) => c.id === id);
      // Si cambia la clave, las que dependían de ella la siguen: si no, quedaban
      // atadas a una clave que ya no existe (Fable, 2026-09-15).
      const vieja = antes && parche.key !== undefined && parche.key !== antes.key ? antes.key : null;
      const nueva = parche.key ?? '';
      return cs.map((c) => {
        if (c.id === id) return { ...c, ...parche };
        if (vieja && c.condition?.when === vieja) return { ...c, condition: { ...c.condition, when: nueva } };
        return c;
      });
    });
    tocar();
  }

  function anadir() {
    const claves = new Set(campos.map((c) => c.key));
    const nuevo: CampoDeFormulario = {
      id: nuevoId(),
      key: claveDesdeTexto('pregunta', claves),
      type: 'short_text',
      label: 'Nueva pregunta',
    };
    setCampos((cs) => [...cs, nuevo]);
    setAbierta(nuevo.id);
    tocar();
  }

  function quitar(id: string) {
    const quitada = campos.find((c) => c.id === id);
    // Las que dependían de ella pierden la condición: se quedarían atadas a una
    // pregunta que ya no existe y el servidor no dejaría guardar.
    setCampos((cs) =>
      cs
        .filter((c) => c.id !== id)
        .map((c) => (quitada && c.condition?.when === quitada.key ? { ...c, condition: null } : c)),
    );
    tocar();
  }

  function mover(id: string, dir: -1 | 1) {
    setCampos((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const copia = [...cs];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return sinCondicionesColgadas(copia);
    });
    tocar();
  }

  async function guardar() {
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/formularios/${formulario.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || null,
          campos,
          activo,
          redirectWhatsapp: whatsapp.trim() || null,
          redirectMessage: mensaje.trim() || null,
        }),
      });
      setCambios(false);
      toast('Formulario guardado.', 'success');
      onGuardado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function usarEnAgenda(usar: boolean) {
    try {
      await api(`/sales-teams/${teamId}/formularios/agenda`, {
        method: 'PUT',
        body: JSON.stringify({ formularioId: usar ? formulario.id : null }),
      });
      toast(
        usar ? 'La agenda pública ya pide este formulario.' : 'La agenda vuelve a pedir solo nombre y teléfono.',
        'success',
      );
      onGuardado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo cambiar la agenda', 'error');
    }
  }

  async function borrar() {
    if (!confirm(`¿Eliminar el formulario «${formulario.nombre}»? No se puede deshacer.`)) return;
    try {
      await api(`/sales-teams/${teamId}/formularios/${formulario.id}`, { method: 'DELETE' });
      toast('Formulario eliminado.', 'success');
      onBorrado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="card card-pad flex flex-col gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="label">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                tocar();
              }}
              className="input"
              maxLength={120}
              disabled={soloLectura}
            />
          </div>
          <div>
            <label className="label">Descripción (opcional)</label>
            <input
              value={descripcion}
              onChange={(e) => {
                setDescripcion(e.target.value);
                tocar();
              }}
              className="input"
              maxLength={500}
              disabled={soloLectura}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => {
                setActivo(e.target.checked);
                tocar();
              }}
              disabled={soloLectura || (esDeAgenda && activo)}
              title={esDeAgenda && activo ? 'Quítalo de la agenda antes de desactivarlo' : undefined}
              className="accent-brand"
            />
            Activo
          </label>
          {esDeAgenda && (
            <span className="rounded-pill bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok-ink">
              Lo pide la agenda pública
            </span>
          )}
          {!soloLectura && (
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                disabled={cambios || (!esDeAgenda && (!formulario.activo || !guardadoConContacto))}
                title={
                  cambios
                    ? 'Guarda los cambios antes'
                    : !esDeAgenda && !guardadoConContacto
                      ? 'Le falta una pregunta obligatoria que pase al lead el nombre, o un WhatsApp o un correo (con ese tipo de pregunta)'
                      : undefined
                }
                onClick={() => void usarEnAgenda(!esDeAgenda)}
              >
                {esDeAgenda ? 'Quitar de la agenda' : 'Usar en la agenda'}
              </button>
              <button type="button" className="text-xs text-bad-ink underline" onClick={() => void borrar()}>
                Eliminar
              </button>
              <button
                type="button"
                className="btn-primary text-sm disabled:opacity-50"
                disabled={!cambios || guardando}
                onClick={() => void guardar()}
              >
                {guardando ? 'Guardando…' : cambios ? 'Guardar' : 'Guardado'}
              </button>
            </div>
          )}
        </div>
        {!soloLectura && !conContacto && (
          <p className={`m-0 text-xs ${esDeAgenda ? 'text-warn-ink' : 'text-mute'}`}>
            {esDeAgenda
              ? 'La agenda pide este formulario: necesita una pregunta obligatoria, que se vea siempre, que pase al lead el nombre, o un WhatsApp o un correo (con ese tipo de pregunta). Sin ella no se puede guardar.'
              : 'Para usarlo en la agenda necesita una pregunta obligatoria, que se vea siempre, que pase al lead el nombre, o un WhatsApp o un correo (con ese tipo de pregunta).'}
          </p>
        )}
      </section>

      <section className="card card-pad">
        <h3 className="m-0 mb-1 text-sm font-semibold text-ink">Al terminar, seguir por WhatsApp</h3>
        <p className="m-0 mb-2 text-xs text-mute">
          Opcional. Tras reservar, la persona ve un botón que abre WhatsApp con este número y este texto.
        </p>
        <div className="grid gap-2 sm:grid-cols-[12rem,1fr]">
          <input
            value={whatsapp}
            onChange={(e) => {
              setWhatsapp(e.target.value);
              tocar();
            }}
            placeholder="573001112233"
            inputMode="tel"
            className="input"
            disabled={soloLectura}
          />
          <input
            value={mensaje}
            onChange={(e) => {
              setMensaje(e.target.value);
              tocar();
            }}
            placeholder="Hola, acabo de agendar mi reunión"
            maxLength={500}
            className="input"
            disabled={soloLectura}
          />
        </div>
      </section>

      <div className="flex gap-1">
        {(['editar', 'probar'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVista(v)}
            className={`rounded-pill px-3 py-1.5 text-sm font-medium ${vista === v ? 'bg-brand text-white' : 'bg-bg2 text-mute'}`}
          >
            {v === 'editar' ? `Preguntas (${campos.length})` : 'Probar'}
          </button>
        ))}
      </div>

      {vista === 'probar' ? (
        <section className="card card-pad">
          {campos.length === 0 ? (
            <p className="m-0 text-sm text-mute">Este formulario todavía no tiene preguntas.</p>
          ) : (
            <>
              <CamposDelFormulario
                campos={campos}
                respuestas={prueba}
                onCambio={(k, v) => setPrueba((p) => ({ ...p, [k]: v }))}
                errores={faltanEnPrueba}
              />
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  className="btn-ghost text-sm"
                  onClick={() => {
                    const faltan = camposQueFaltan(campos, prueba);
                    setFaltanEnPrueba(new Set(faltan));
                    toast(
                      faltan.length ? `Faltan ${faltan.length} pregunta(s) obligatoria(s).` : 'Todo contestado.',
                      faltan.length ? 'error' : 'success',
                    );
                  }}
                >
                  Comprobar
                </button>
                <button
                  type="button"
                  className="text-xs text-mute underline"
                  onClick={() => {
                    setPrueba({});
                    setFaltanEnPrueba(new Set());
                  }}
                >
                  Empezar de nuevo
                </button>
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          {campos.map((c, i) => (
            <FilaDePregunta
              key={c.id}
              campo={c}
              indice={i}
              total={campos.length}
              anteriores={campos.slice(0, i)}
              abierta={abierta === c.id}
              soloLectura={soloLectura}
              onAbrir={() => setAbierta((a) => (a === c.id ? null : c.id))}
              onCambio={(p) => cambiarCampo(c.id, p)}
              onQuitar={() => quitar(c.id)}
              onMover={(d) => mover(c.id, d)}
            />
          ))}
          {!soloLectura && (
            <button
              type="button"
              className="rounded-lg border border-dashed border-line py-2 text-sm text-mute hover:text-ink"
              onClick={anadir}
            >
              + Añadir pregunta
            </button>
          )}
        </section>
      )}
    </div>
  );
}

// ── Una pregunta ────────────────────────────────────────────────────────────

function FilaDePregunta({
  campo,
  indice,
  total,
  anteriores,
  abierta,
  soloLectura,
  onAbrir,
  onCambio,
  onQuitar,
  onMover,
}: {
  campo: CampoDeFormulario;
  indice: number;
  total: number;
  anteriores: CampoDeFormulario[];
  abierta: boolean;
  soloLectura: boolean;
  onAbrir: () => void;
  onCambio: (p: Partial<CampoDeFormulario>) => void;
  onQuitar: () => void;
  onMover: (d: -1 | 1) => void;
}) {
  const conOpciones = TIPOS_CON_OPCIONES.includes(campo.type);

  function cambiarTipo(tipo: TipoDeCampo) {
    const parche: Partial<CampoDeFormulario> = { type: tipo };
    if (TIPOS_CON_OPCIONES.includes(tipo) && !campo.options?.length) {
      parche.options = [
        { value: 'opcion_1', label: 'Opción 1' },
        { value: 'opcion_2', label: 'Opción 2' },
      ];
    }
    if (!TIPOS_CON_OPCIONES.includes(tipo)) parche.options = undefined;
    onCambio(parche);
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center gap-2 px-3 py-2">
        {!soloLectura && (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => onMover(-1)}
              disabled={indice === 0}
              className="text-xs text-mute hover:text-ink disabled:opacity-20"
              aria-label="Subir pregunta"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => onMover(1)}
              disabled={indice === total - 1}
              className="text-xs text-mute hover:text-ink disabled:opacity-20"
              aria-label="Bajar pregunta"
            >
              ▼
            </button>
          </div>
        )}
        <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-ink">
            {campo.label}
            {campo.required && <span className="ml-0.5 text-bad-ink">*</span>}
          </span>
          <span className="block text-xs text-mute">
            {ETIQUETA_DE_TIPO[campo.type] ?? campo.type}
            {campo.section ? ` · ${campo.section}` : ''}
            {campo.condition ? ' · condicional' : ''}
            {campo.maps_to ? ` · va al lead` : ''}
          </span>
        </button>
        {!soloLectura && (
          <button type="button" onClick={onQuitar} className="rounded-lg px-2 py-1 text-xs text-bad-ink hover:bg-bad-soft">
            Eliminar
          </button>
        )}
      </div>

      {abierta && (
        <div className="flex flex-col gap-2 border-t border-line bg-bg2 px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Pregunta</label>
              <input
                value={campo.label}
                onChange={(e) => onCambio({ label: e.target.value })}
                className="input"
                maxLength={200}
                disabled={soloLectura}
              />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select
                value={campo.type}
                onChange={(e) => cambiarTipo(e.target.value as TipoDeCampo)}
                className="input"
                disabled={soloLectura}
              >
                {TIPOS_DE_CAMPO.map((t) => (
                  <option key={t.tipo} value={t.tipo}>
                    {t.icono} {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Texto de ayuda</label>
              <input
                value={campo.help ?? ''}
                onChange={(e) => onCambio({ help: e.target.value || undefined })}
                placeholder="Se muestra debajo de la pregunta"
                className="input"
                maxLength={300}
                disabled={soloLectura}
              />
            </div>
            <div>
              <label className="label">Sección (agrupar)</label>
              <input
                value={campo.section ?? ''}
                onChange={(e) => onCambio({ section: e.target.value || undefined })}
                placeholder="Ej.: Tus datos"
                className="input"
                maxLength={80}
                disabled={soloLectura}
              />
            </div>
            <div>
              <label className="label">Guardar en el lead</label>
              <select
                value={campo.maps_to ?? ''}
                onChange={(e) => onCambio({ maps_to: e.target.value || undefined })}
                className="input"
                disabled={soloLectura}
              >
                {DESTINOS_EN_EL_LEAD.map((d) => (
                  <option key={d.clave} value={d.clave}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Clave (para respuestas y automatizaciones)</label>
              <input
                value={campo.key}
                onChange={(e) => onCambio({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) })}
                className="input font-mono text-xs"
                disabled={soloLectura}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={!!campo.required}
                onChange={(e) => onCambio({ required: e.target.checked || undefined })}
                disabled={soloLectura}
                className="accent-brand"
              />
              Obligatoria
            </label>
            {!conOpciones && (
              <label className="flex items-center gap-2 text-sm text-ink">
                Puntaje si la contesta
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={campo.score ?? 0}
                  onChange={(e) => onCambio({ score: Number(e.target.value) || undefined })}
                  className="input h-8 w-20"
                  disabled={soloLectura}
                />
              </label>
            )}
          </div>

          {conOpciones && (
            <EditorDeOpciones
              opciones={campo.options ?? []}
              soloLectura={soloLectura}
              onCambio={(options) => onCambio({ options })}
            />
          )}

          <EditorDeCondicion campo={campo} anteriores={anteriores} soloLectura={soloLectura} onCambio={onCambio} />
        </div>
      )}
    </div>
  );
}

function EditorDeOpciones({
  opciones,
  soloLectura,
  onCambio,
}: {
  opciones: OpcionDeCampo[];
  soloLectura: boolean;
  onCambio: (o: OpcionDeCampo[]) => void;
}) {
  const cambiar = (i: number, parche: Partial<OpcionDeCampo>) =>
    onCambio(opciones.map((o, j) => (j === i ? { ...o, ...parche } : o)));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="label m-0">Opciones (puntaje que suma cada una · 0 = no puntúa)</p>
      {opciones.map((o, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={o.label}
            onChange={(e) => cambiar(i, { label: e.target.value })}
            placeholder="Texto que se ve"
            className="input h-8 flex-1 text-sm"
            maxLength={120}
            disabled={soloLectura}
          />
          <input
            value={o.value}
            onChange={(e) => cambiar(i, { value: e.target.value })}
            placeholder="valor"
            className="input h-8 w-28 font-mono text-xs"
            maxLength={80}
            disabled={soloLectura}
          />
          <input
            type="number"
            min={0}
            max={100}
            value={o.score ?? 0}
            onChange={(e) => cambiar(i, { score: Number(e.target.value) || undefined })}
            className="input h-8 w-16 text-sm"
            title="Puntaje de esta opción"
            disabled={soloLectura}
          />
          {!soloLectura && (
            <button
              type="button"
              onClick={() => onCambio(opciones.filter((_, j) => j !== i))}
              className="px-2 text-xs text-bad-ink"
              aria-label="Quitar opción"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {!soloLectura && (
        <button
          type="button"
          onClick={() =>
            onCambio([...opciones, { value: `opcion_${opciones.length + 1}`, label: `Opción ${opciones.length + 1}` }])
          }
          className="self-start text-xs text-mute underline"
        >
          + Añadir opción
        </button>
      )}
    </div>
  );
}

function EditorDeCondicion({
  campo,
  anteriores,
  soloLectura,
  onCambio,
}: {
  campo: CampoDeFormulario;
  anteriores: CampoDeFormulario[];
  soloLectura: boolean;
  onCambio: (p: Partial<CampoDeFormulario>) => void;
}) {
  const cond = campo.condition;
  const origen = anteriores.find((a) => a.key === cond?.when);

  if (!anteriores.length) {
    return <p className="m-0 text-xs text-mute">Es la primera pregunta: se muestra siempre.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="label m-0">Mostrar solo si…</p>
      <div className="flex flex-wrap gap-1.5">
        <select
          value={cond?.when ?? ''}
          onChange={(e) =>
            onCambio({ condition: e.target.value ? { when: e.target.value, op: 'eq', value: '' } : null })
          }
          className="input h-8 w-auto text-sm"
          disabled={soloLectura}
        >
          <option value="">Siempre</option>
          {anteriores.map((a) => (
            <option key={a.id} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
        {cond?.when && (
          <>
            <select
              value={cond.op}
              onChange={(e) => onCambio({ condition: { ...cond, op: e.target.value as Operador } })}
              className="input h-8 w-auto text-sm"
              disabled={soloLectura}
            >
              {OPERADORES.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            {cond.op !== 'filled' &&
              (origen?.options?.length ? (
                <select
                  value={typeof cond.value === 'string' ? cond.value : ''}
                  onChange={(e) => onCambio({ condition: { ...cond, value: e.target.value } })}
                  className="input h-8 w-auto text-sm"
                  disabled={soloLectura}
                >
                  <option value="">Elige…</option>
                  {origen.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={typeof cond.value === 'string' ? cond.value : ''}
                  onChange={(e) => onCambio({ condition: { ...cond, value: e.target.value } })}
                  placeholder="valor…"
                  className="input h-8 w-40 text-sm"
                  disabled={soloLectura}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
