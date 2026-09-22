'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  cambiarTipo,
  camposDeFiltro,
  disparadorIncompleto,
  disparadorNuevo,
  entradaDe,
  filtroIncompleto,
  filtroNuevo,
  notaDeLatencia,
  operadoresPara,
  porGrupo,
  resumenDeDisparador,
  valoresComoLista,
  valorPara,
  type CampoBase,
  type CampoFiltrable,
  type CatalogoDeDisparadores,
  type Disparador,
  type DisparadorCat,
  type Filtro,
  type OperadorCat,
  type Sujeto,
} from './disparadores';

// El editor de disparadores, igual que el de TeamClubify: varios disparadores
// (entra si casa CUALQUIERA), cada uno con sus filtros (entra solo si cumple
// TODOS). Lo usan los dos constructores; lo que cambia entre ellos llega por
// el catálogo y por `sujeto`.
//
// Colores: los tokens `brand`, que `.brand-panel` tiñe con el color de cada
// marca (coral en Sellea). Nada de `hover:*-brand*`: el override de
// `.brand-panel` mira el atributo `class`, no el estado, y lo pintaría SIEMPRE.

const TEXTOS: Record<Sujeto, { el: string; El: string; un: string }> = {
  contacto: { el: 'el contacto', El: 'El contacto', un: 'un contacto' },
  negocio: { el: 'el negocio', El: 'El negocio', un: 'un negocio' },
};

const VACIO = 'shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700';

/**
 * Varios valores en chips: cada ENTER añade uno, la × lo quita.
 *
 * Al salir del campo también se añade lo escrito: sin eso, quien teclea
 * «precio» y pulsa «Listo» sin darle a ENTER pierde el valor sin enterarse y
 * se queda con un «contiene» vacío, que deja entrar a todos.
 */
export function ValoresInput({
  valores,
  onChange,
  placeholder = 'Escribe y ENTER para añadir…',
  incompleto,
}: {
  valores: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  incompleto?: boolean;
}) {
  const [texto, setTexto] = useState('');
  function anadir() {
    const t = texto.trim();
    if (!t) return;
    // Sin repetidos: el mismo valor dos veces no cambia nada y confunde.
    if (!valores.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...valores, t]);
    setTexto('');
  }
  return (
    <div className="min-w-[12rem] flex-1">
      {valores.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {valores.map((v, i) => (
            <span key={`${v}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-slate-700">
              <span className="truncate">{v}</span>
              <button
                type="button"
                onClick={() => onChange(valores.filter((_, j) => j !== i))}
                aria-label={`Quitar «${v}»`}
                className="leading-none text-slate-400 hover:text-rose-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            anadir();
          }
        }}
        onBlur={anadir}
        placeholder={placeholder}
        className={`input px-2 py-1.5 ${incompleto ? 'border-amber-300' : ''}`}
      />
    </div>
  );
}

/**
 * Una condición: campo + operador + valor. La usan los filtros del disparador
 * y el paso «Si / No», para que las dos se editen igual.
 *
 * Un campo o un operador que la lista ya no trae se sigue mostrando: si no, el
 * desplegable enseñaría otro y al guardar CAMBIARÍA el filtro sin avisar.
 */
export function FiltroFila({
  filtro,
  campos,
  permitidos,
  operadores,
  onChange,
  onQuitar,
}: {
  filtro: Filtro;
  campos: CampoFiltrable[];
  /** Claves de operador que ofrece el disparador; null = todos los del catálogo. */
  permitidos: string[] | null;
  operadores: OperadorCat[];
  onChange: (f: Filtro) => void;
  onQuitar: () => void;
}) {
  const ops = operadoresPara(filtro.field, permitidos, operadores);
  const opsVisibles = ops.some((o) => o.value === filtro.op) ? ops : [...ops, { value: filtro.op, label: `${filtro.op || '—'} (no disponible)` }];
  const camposVisibles = campos.some((c) => c.key === filtro.field) ? campos : [...campos, { key: filtro.field, label: filtro.field || '—' }];
  const entrada = entradaDe(filtro.op, operadores);
  const incompleto = filtroIncompleto(filtro, operadores);

  function cambiarCampo(field: string) {
    // «Tiene etiqueta» sobre el nombre no significa nada: si el operador no
    // vale para el campo nuevo, se cambia por el primero que sí.
    const validos = operadoresPara(field, permitidos, operadores);
    const op = validos.some((o) => o.value === filtro.op) ? filtro.op : validos[0]?.value ?? filtro.op;
    onChange({ ...filtro, field, op, value: valorPara(entradaDe(op, operadores), filtro.value) });
  }
  function cambiarOp(op: string) {
    onChange({ ...filtro, op, value: valorPara(entradaDe(op, operadores), filtro.value) });
  }

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <select value={filtro.field} onChange={(e) => cambiarCampo(e.target.value)} aria-label="Campo" className="input w-auto max-w-[13rem] px-2 py-1.5">
        {camposVisibles.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <select value={filtro.op} onChange={(e) => cambiarOp(e.target.value)} aria-label="Operador" className="input w-auto px-2 py-1.5">
        {opsVisibles.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {entrada === 'varios' ? (
        <ValoresInput
          valores={valoresComoLista(filtro.value)}
          onChange={(v) => onChange({ ...filtro, value: v })}
          placeholder={filtro.field === 'tags' ? 'Escribe la etiqueta y ENTER…' : undefined}
          incompleto={incompleto}
        />
      ) : entrada === 'ninguna' ? null : (
        <input
          type={entrada === 'numero' ? 'number' : 'text'}
          // SIN recortar: `valoresComoLista` hace trim, y en un input
          // controlado eso borra el espacio según se teclea — «Plan Pro» se
          // quedaba en «Plan». Ya recorta el motor al comparar y
          // `normalizarDisparadores` al guardar.
          value={Array.isArray(filtro.value) ? String(filtro.value[0] ?? '') : String(filtro.value ?? '')}
          onChange={(e) => onChange({ ...filtro, value: e.target.value })}
          placeholder={entrada === 'numero' ? 'número' : 'valor'}
          aria-label="Valor"
          className={`input w-32 px-2 py-1.5 ${incompleto ? 'border-amber-300' : ''}`}
        />
      )}
      <button type="button" onClick={onQuitar} aria-label="Quitar el filtro" className="px-1 py-1.5 leading-none text-slate-400 hover:text-rose-600">
        ×
      </button>
    </div>
  );
}

function FiltrosDelDisparador<C extends CampoBase>({
  disparador,
  def,
  catalogo,
  sujeto,
  onChange,
}: {
  disparador: Disparador;
  def: DisparadorCat<C> | null;
  catalogo: CatalogoDeDisparadores<C>;
  sujeto: Sujeto;
  onChange: (filtros: Filtro[]) => void;
}) {
  const filtros = disparador.filters ?? [];
  const campos = camposDeFiltro(def, catalogo);
  const permitidos = def?.filtros?.operadores ?? null;
  const admite = campos.length > 0;
  return (
    <div className="mt-3 border-t border-slate-100 pt-2">
      <p className="mb-1.5 text-xs font-medium text-slate-600">
        Filtros <span className="font-normal text-slate-400">(entra solo si cumple todos)</span>
      </p>
      {filtros.length > 0 && (
        <div className="space-y-1.5">
          {filtros.map((f, i) => (
            <FiltroFila
              key={i}
              filtro={f}
              campos={campos}
              permitidos={permitidos}
              operadores={catalogo.operadores}
              onChange={(nf) => onChange(filtros.map((x, j) => (j === i ? nf : x)))}
              onQuitar={() => onChange(filtros.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
      {admite ? (
        <button type="button" onClick={() => onChange([...filtros, filtroNuevo(def, catalogo)])} className="btn-link mt-1.5 text-sm">
          + Añadir filtro
        </button>
      ) : (
        // La inscripción manual no pasa por los filtros: ofrecerlos sería
        // prometer algo que el motor no hace.
        <p className="text-[11px] text-slate-400">Este disparador no lleva filtros: entra {TEXTOS[sujeto].el} que inscribas tú.</p>
      )}
    </div>
  );
}

export type PropsDelEditor<C extends CampoBase> = {
  disparadores: Disparador[];
  onChange: (d: Disparador[]) => void;
  catalogo: CatalogoDeDisparadores<C>;
  sujeto: Sujeto;
  /** Dibuja un campo propio del disparador (etiqueta, días antes…) con el control de cada constructor. */
  renderCampo: (campo: C, valor: unknown, onChange: (v: unknown) => void) => ReactNode;
  /** Disparador al que llevar la vista al abrir (el de la tarjeta que se pulsó). */
  enfocar?: number | null;
};

export function DisparadoresEditor<C extends CampoBase>({ disparadores, onChange, catalogo, sujeto, renderCampo, enfocar }: PropsDelEditor<C>) {
  const t = TEXTOS[sujeto];
  const refs = useRef<(HTMLElement | null)[]>([]);
  // El recién añadido manda sobre el de la tarjeta pulsada: es el que se va a rellenar.
  const [recienAnadido, setRecienAnadido] = useState<number | null>(null);
  const foco = recienAnadido ?? enfocar ?? null;
  useEffect(() => {
    if (foco == null) return;
    refs.current[foco]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [foco]);

  const set = (i: number, d: Disparador) => onChange(disparadores.map((x, j) => (j === i ? d : x)));
  // Nunca se queda sin ninguno: un flujo sin disparador no se puede guardar.
  const quitar = (i: number) => {
    if (disparadores.length < 2) return;
    onChange(disparadores.filter((_, j) => j !== i));
    setRecienAnadido(null);
  };
  const anadir = () => {
    onChange([...disparadores, disparadorNuevo(catalogo)]);
    setRecienAnadido(disparadores.length);
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        {t.El} entra si ocurre <b className="font-semibold text-slate-700">cualquiera</b> de estos disparadores.
      </p>
      <div className="space-y-2">
        {disparadores.map((d, i) => {
          const def = catalogo.disparadores.find((x) => x.key === d.type) ?? null;
          return (
            <section
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              aria-label={`Disparador ${i + 1}`}
              className={`rounded-xl border p-3 ${foco === i ? 'border-brand' : 'border-slate-200'}`}
            >
              {disparadores.length > 1 && (
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Disparador {i + 1}</span>
                  <button type="button" onClick={() => quitar(i)} className="text-xs text-rose-500 hover:text-rose-600">
                    Quitar disparador
                  </button>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Cuándo entra {t.el}</label>
                  <select value={d.type} onChange={(e) => set(i, cambiarTipo(d, e.target.value, catalogo))} className="input">
                    {porGrupo(catalogo.disparadores).map((g) => (
                      <optgroup key={g.grupo} label={g.grupo}>
                        {g.items.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </optgroup>
                    ))}
                    {/* Un tipo que el catálogo no trae (catálogo reducido o flujo
                        de otra versión) se ofrece igual: sin esta opción el
                        desplegable mostraría otro y al guardar lo CAMBIARÍA. */}
                    {!def && <option value={d.type}>{d.type}</option>}
                  </select>
                  {def?.hint && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{def.hint}</p>}
                  {def && <p className="mt-1 text-[11px] text-slate-400">{notaDeLatencia(def)}</p>}
                </div>
                {(def?.campos ?? []).map((campo) => (
                  <div key={campo.key}>{renderCampo(campo, d[campo.key], (v) => set(i, { ...d, [campo.key]: v }))}</div>
                ))}
              </div>
              <FiltrosDelDisparador
                disparador={d}
                def={def}
                catalogo={catalogo}
                sujeto={sujeto}
                onChange={(filters) => set(i, { ...d, filters })}
              />
            </section>
          );
        })}
      </div>
      <button type="button" onClick={anadir} className="btn-link mt-2 text-sm">
        + Añadir disparador
      </button>
    </div>
  );
}

/**
 * El modal «Disparadores» sobre el lienzo: se editan sin salir del Creador,
 * como en TeamClubify (antes había que ir a la pestaña Configuración).
 */
export function DisparadoresModal<C extends CampoBase>({ onClose, ...editor }: PropsDelEditor<C> & { onClose: () => void }) {
  const t = TEXTOS[editor.sujeto];
  const caja = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    // El foco entra al diálogo y vuelve a donde estaba: con el teclado, si no,
    // se sigue navegando por el lienzo que hay detrás.
    const antes = document.activeElement as HTMLElement | null;
    caja.current?.querySelector<HTMLElement>('select, input, button')?.focus();
    return () => {
      document.removeEventListener('keydown', esc);
      antes?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      // mousedown y no click: seleccionar texto de un campo y soltar fuera no
      // puede cerrar el modal y perder lo que se estaba escribiendo.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={caja} role="dialog" aria-modal="true" aria-labelledby="titulo-disparadores" className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="titulo-disparadores" className="text-base font-bold text-slate-800">Disparadores</h2>
            <p className="text-xs text-slate-500">Qué hace que {t.un} entre a este flujo.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>
        <DisparadoresEditor {...editor} />
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3">
          <p className="mr-auto text-[11px] text-slate-400">Los cambios se guardan con «Guardar» arriba.</p>
          <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * La banda de disparadores del lienzo: una tarjeta por disparador y otra para
 * añadir. Cualquiera abre el modal. El disparador no es un paso —es la puerta—,
 * y por eso va en su propia banda y no como una tarjeta más del flujo.
 */
export function TarjetasDeDisparadores<C extends CampoBase>({
  disparadores,
  catalogo,
  sujeto,
  onAbrir,
  onAnadir,
}: {
  disparadores: Disparador[];
  catalogo: CatalogoDeDisparadores<C>;
  sujeto: Sujeto;
  onAbrir: (i: number) => void;
  onAnadir: () => void;
}) {
  const varios = disparadores.length > 1;
  return (
    <div className="wf-node rounded-2xl border border-brand bg-brand-soft p-2">
      <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">Cuándo entra {TEXTOS[sujeto].el}</p>
      <div className="flex max-w-[760px] flex-wrap items-stretch justify-center gap-2">
        {disparadores.map((d, i) => {
          const def = catalogo.disparadores.find((x) => x.key === d.type) ?? null;
          const incompleto = disparadorIncompleto(d, def, catalogo.operadores);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onAbrir(i)}
              title="Editar los disparadores"
              className="flex w-[240px] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm text-brand">▶</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Disparador{varios ? ` ${i + 1}` : ''}
                  </span>
                  {incompleto && <span className={VACIO}>Vacío</span>}
                </span>
                <span className="block truncate text-sm font-semibold text-slate-800">{def?.label ?? d.type}</span>
                <span className="block truncate text-[11px] text-slate-500">{resumenDeDisparador(d, def)}</span>
              </span>
              <span className="shrink-0 text-slate-300">✎</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAnadir}
          className="grid w-[150px] place-items-center rounded-xl border border-dashed border-brand bg-white/60 px-3 py-2.5 text-center text-sm font-medium text-brand transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          + Añadir disparador
        </button>
      </div>
    </div>
  );
}
