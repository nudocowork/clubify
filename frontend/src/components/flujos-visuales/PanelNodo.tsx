'use client';
/**
 * Panel lateral: configura el paso seleccionado (o el disparador). Panel y no
 * modal para que el lienzo siga a la vista mientras se edita.
 */
import { useRef } from 'react';
import { Flujo, Nodo, Problema, puedeMover } from './grafo';
import { COLOR_NODO } from './Lienzo';
import { IconoFlujo } from './IconoFlujo';
import type { Textos } from './textos';

export type Catalogo = {
  disparadores: Array<{ tipo: string; categoria: string; disponible: boolean; conDias?: boolean }>;
  campos: Array<{ campo: string; tipo: 'number' | 'boolean'; operadores: string[] }>;
  variables: string[];
  limites: { tituloPush: number; cuerpoPush: number; cuerpoSms: number; mensajesPorClienteDia: number };
  horario: { desde: number; hasta: number };
  canales: { push: boolean; sms: boolean; whatsapp: boolean };
  tarjetas: Array<{ id: string; name: string; type: string }>;
};

const EMOJIS = ['☕', '🎉', '🎁', '✨', '💚', '🍕', '🍔', '🔥', '👋', '🙌'];

type Props = {
  t: Textos;
  cat: Catalogo;
  flujo: Flujo;
  seleccion: string;
  problemas: Problema[];
  negocio: string;
  onFlujo: (patch: Partial<Flujo>) => void;
  onConfig: (id: string, config: Record<string, any>) => void;
  onBorrar: (id: string) => void;
  onDuplicar: (id: string) => void;
  onMover: (id: string, dir: -1 | 1) => void;
  onCerrar: () => void;
};

export function PanelNodo(p: Props) {
  const { t } = p;
  const esDisparador = p.seleccion === 'trigger';
  const n: Nodo | undefined = esDisparador ? undefined : p.flujo.graph.nodes[p.seleccion];
  const tipo = esDisparador ? 'trigger' : n?.type;
  if (!esDisparador && !n) return null;
  const mios = p.problemas.filter((x) => (esDisparador ? !x.nodeId && x.campo : x.nodeId === p.seleccion));

  return (
    <aside className="flex flex-col h-full bg-surface">
      <header className="flex items-start gap-3 px-5 py-4 border-b border-line">
        <span className="grid place-items-center w-9 h-9 rounded-full shrink-0" style={{ background: '#12203A', color: COLOR_NODO[tipo!] }}>
          <IconoFlujo nombre={tipo!} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{esDisparador ? t.disparadorTitulo : t.tiposNodo[n!.type]}</div>
          <div className="text-xs text-mute mt-0.5">{esDisparador ? t.ayudaDisparador[p.flujo.triggerType] ?? '' : t.ayudaNodo[n!.type]}</div>
        </div>
        <button onClick={p.onCerrar} aria-label={t.cerrar} className="text-mute hover:text-ink p-1 -m-1">
          <IconoFlujo nombre="x" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {mios.length > 0 && (
          <ul className="rounded-input bg-bad-soft text-bad-ink text-sm px-3 py-2 space-y-1">
            {mios.map((x, i) => (
              <li key={i}>• {t.problemas[x.codigo] ?? x.codigo}</li>
            ))}
          </ul>
        )}
        {esDisparador ? <ConfigDisparador {...p} /> : <ConfigNodo {...p} n={n!} />}
      </div>

      {!esDisparador && (
        <footer className="flex flex-wrap gap-1.5 px-5 py-3 border-t border-line">
          <button className="btn-ghost !px-2.5 !py-1.5 text-xs" disabled={!puedeMover(p.flujo.graph, n!.id, -1)} onClick={() => p.onMover(n!.id, -1)}>
            <IconoFlujo nombre="up" size={14} /> {t.subir}
          </button>
          <button className="btn-ghost !px-2.5 !py-1.5 text-xs" disabled={!puedeMover(p.flujo.graph, n!.id, 1)} onClick={() => p.onMover(n!.id, 1)}>
            <IconoFlujo nombre="down" size={14} /> {t.bajar}
          </button>
          {n!.type !== 'condition' && n!.type !== 'end' && (
            <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => p.onDuplicar(n!.id)}>
              <IconoFlujo nombre="copy" size={14} /> {t.duplicar}
            </button>
          )}
          <button className="btn-ghost !px-2.5 !py-1.5 text-xs !text-bad ml-auto" onClick={() => p.onBorrar(n!.id)}>
            <IconoFlujo nombre="trash" size={14} /> {t.borrarPaso}
          </button>
        </footer>
      )}
    </aside>
  );
}

function ConfigDisparador({ t, cat, flujo, onFlujo }: Props) {
  const categorias = [...new Set(cat.disparadores.map((d) => d.categoria))];
  const actual = cat.disparadores.find((d) => d.tipo === flujo.triggerType);
  return (
    <>
      <label className="block">
        <span className="label">{t.evento}</span>
        <select className="input" value={flujo.triggerType} onChange={(e) => onFlujo({ triggerType: e.target.value })}>
          <option value="">{t.elegir}</option>
          {categorias.map((c) => (
            <optgroup key={c} label={t.categorias[c] ?? c}>
              {cat.disparadores
                .filter((d) => d.categoria === c)
                .map((d) => (
                  <option key={d.tipo} value={d.tipo} disabled={!d.disponible}>
                    {t.disparadores[d.tipo] ?? d.tipo}
                    {!d.disponible ? ` — ${t.noDisponible}` : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      {actual?.conDias && (
        <label className="block">
          <span className="label">{t.dias}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={365}
            value={flujo.triggerDays ?? ''}
            onChange={(e) => onFlujo({ triggerDays: e.target.value ? Math.round(Number(e.target.value)) : null })}
          />
        </label>
      )}

      {cat.tarjetas.length > 1 && (
        <label className="block">
          <span className="label">{t.soloTarjeta}</span>
          <select
            className="input"
            value={flujo.triggerConfig?.cardId ?? ''}
            onChange={(e) => onFlujo({ triggerConfig: e.target.value ? { cardId: e.target.value } : {} })}
          >
            <option value="">{t.cualquierTarjeta}</option>
            {cat.tarjetas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset>
        <legend className="label">{t.reentrada}</legend>
        <div className="space-y-1.5">
          {(['once', 'after_finish'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="reentry" checked={flujo.reentry === r} onChange={() => onFlujo({ reentry: r })} className="accent-brand" />
              {r === 'once' ? t.reentradaOnce : t.reentradaAfter}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-input bg-bg px-3 py-2.5 text-xs text-mute space-y-1">
        <p>{t.horario(cat.horario.desde, cat.horario.hasta)}</p>
        <p>{t.tope(cat.limites.mensajesPorClienteDia)}</p>
      </div>
    </>
  );
}

function ConfigNodo({ t, cat, n, onConfig, negocio }: Props & { n: Nodo }) {
  const c = n.config ?? {};
  const set = (patch: Record<string, any>) => onConfig(n.id, patch);

  if (n.type === 'wait') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">{t.cantidad}</span>
          <input
            className="input"
            type="number"
            min={1}
            value={c.amount ?? ''}
            onChange={(e) => set({ amount: e.target.value ? Math.round(Number(e.target.value)) : '' })}
          />
        </label>
        <label className="block">
          <span className="label">{t.unidad}</span>
          <select className="input" value={c.unit ?? 'days'} onChange={(e) => set({ unit: e.target.value })}>
            {(['minutes', 'hours', 'days', 'weeks'] as const).map((u) => (
              <option key={u} value={u}>
                {t.unidades[u]}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (n.type === 'push' || n.type === 'sms' || n.type === 'whatsapp') {
    return <ConfigMensaje t={t} cat={cat} n={n} set={set} negocio={negocio} />;
  }

  if (n.type === 'condition') {
    const campo = cat.campos.find((x) => x.campo === c.field);
    const sinValor = ['empty', 'not_empty', 'is_true', 'is_false'].includes(c.op);
    return (
      <>
        <label className="block">
          <span className="label">{t.campo}</span>
          <select
            className="input"
            value={c.field ?? ''}
            onChange={(e) => {
              const nuevo = cat.campos.find((x) => x.campo === e.target.value);
              // Cambiar de campo reinicia el operador: «mayor que» no existe para un sí/no.
              onConfig(n.id, { field: e.target.value, op: nuevo?.tipo === 'boolean' ? 'is_true' : '', value: undefined });
            }}
          >
            <option value="">{t.elegir}</option>
            {cat.campos.map((x) => (
              <option key={x.campo} value={x.campo}>
                {t.campos[x.campo] ?? x.campo}
              </option>
            ))}
          </select>
        </label>
        {campo && (
          <div className={`grid gap-3 ${campo.tipo === 'number' && !sinValor ? 'grid-cols-2' : ''}`}>
            <label className="block">
              <span className="label">{t.operador}</span>
              <select className="input" value={c.op ?? ''} onChange={(e) => set({ op: e.target.value })}>
                <option value="">{t.elegir}</option>
                {campo.operadores.map((o) => (
                  <option key={o} value={o}>
                    {t.operadores[o] ?? o}
                  </option>
                ))}
              </select>
            </label>
            {campo.tipo === 'number' && !sinValor && (
              <label className="block">
                <span className="label">{t.valor}</span>
                <input
                  className="input"
                  type="number"
                  value={c.value ?? ''}
                  onChange={(e) => set({ value: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </label>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-input px-3 py-2 bg-ok-soft text-ok-ink">
            <b>{t.si}</b> · {t.siSeCumple}
          </div>
          <div className="rounded-input px-3 py-2 bg-bad-soft text-bad-ink">
            <b>{t.no}</b> · {t.siNoSeCumple}
          </div>
        </div>
      </>
    );
  }

  return <p className="text-sm text-mute">{t.ayudaNodo.end}</p>;
}

function ConfigMensaje({
  t,
  cat,
  n,
  set,
  negocio,
}: {
  t: Textos;
  cat: Catalogo;
  n: Nodo;
  set: (p: Record<string, any>) => void;
  negocio: string;
}) {
  const c = n.config ?? {};
  const esPush = n.type === 'push';
  const refTitulo = useRef<HTMLInputElement>(null);
  const refCuerpo = useRef<HTMLTextAreaElement>(null);
  const ultimo = useRef<'title' | 'body'>('body');
  const max = esPush ? cat.limites.cuerpoPush : cat.limites.cuerpoSms;
  const sinCanal = !esPush && !cat.canales[n.type as 'sms' | 'whatsapp'];

  // Inserta en el cursor del último campo tocado, no al final: así la
  // variable queda donde el negocio la quiere en la frase.
  const insertar = (txt: string) => {
    const campo = esPush ? ultimo.current : 'body';
    const el = campo === 'title' ? refTitulo.current : refCuerpo.current;
    const actual = String(c[campo] ?? '');
    const ini = el?.selectionStart ?? actual.length;
    const fin = el?.selectionEnd ?? actual.length;
    set({ [campo]: actual.slice(0, ini) + txt + actual.slice(fin) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + txt.length, ini + txt.length);
    });
  };

  const ejemplo: Record<string, string> = {
    customerName: 'Ana',
    nombre: 'Ana',
    businessName: negocio,
    cardName: cat.tarjetas[0]?.name ?? '',
    rewardText: '1 café gratis',
    stampsCount: '6',
    remaining: '2',
  };
  const ver = (s: string) => String(s ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => ejemplo[k] ?? `{{${k}}}`);

  return (
    <>
      {sinCanal && <p className="rounded-input bg-warn-soft text-warn-ink text-sm px-3 py-2">{t.canalNoDisponible}</p>}
      {esPush && (
        <label className="block">
          <span className="label flex justify-between">
            {t.tituloPush}
            <Contador n={String(c.title ?? '').length} max={cat.limites.tituloPush} />
          </span>
          <input
            ref={refTitulo}
            className="input"
            value={c.title ?? ''}
            maxLength={cat.limites.tituloPush + 20}
            onFocus={() => (ultimo.current = 'title')}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="¡Te estamos esperando! ☕"
          />
        </label>
      )}
      <label className="block">
        <span className="label flex justify-between">
          {t.mensaje}
          <Contador n={String(c.body ?? '').length} max={max} />
        </span>
        <textarea
          ref={refCuerpo}
          className="input"
          rows={4}
          value={c.body ?? ''}
          onFocus={() => (ultimo.current = 'body')}
          onChange={(e) => set({ body: e.target.value })}
        />
      </label>
      <div>
        <div className="label">
          {t.variables} <span className="font-normal text-mute2">· {t.insertarVariable}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cat.variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertar(`{{${v}}}`)}
              className="rounded-pill border border-line px-2.5 py-1 text-xs text-ink hover:border-brand hover:bg-brand-soft/50"
              title={`{{${v}}}`}
            >
              {t.vars[v] ?? v}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => insertar(e)} className="w-8 h-8 rounded-lg hover:bg-bg2 text-base">
              {e}
            </button>
          ))}
        </div>
      </div>

      {esPush && (
        <div>
          <div className="label">{t.vistaPrevia}</div>
          <div
            className="rounded-[22px] px-4 pt-6 pb-8"
            style={{ background: 'linear-gradient(160deg,#1F3A2E 0%,#0E1A2B 55%,#0A111E 100%)' }}
          >
            <div className="text-center text-white/90 text-3xl font-light tabular-nums">9:41</div>
            <div className="mt-5 rounded-2xl bg-white/85 backdrop-blur px-3 py-2.5 shadow-lg">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="w-4 h-4 rounded bg-ink grid place-items-center text-[8px] text-white">W</span>
                <span className="uppercase tracking-wide">Wallet</span>
                <span className="ml-auto">{t.ahora}</span>
              </div>
              <div className="text-[13px] font-semibold text-slate-900 mt-1 break-words">{ver(c.title) || '—'}</div>
              <div className="text-[13px] text-slate-700 break-words">{ver(c.body) || '—'}</div>
            </div>
          </div>
          <p className="text-[11px] text-mute mt-2">{t.previaNota}</p>
        </div>
      )}
    </>
  );
}

function Contador({ n, max }: { n: number; max: number }) {
  return <span className={`tabular-nums font-normal ${n > max ? 'text-bad' : 'text-mute2'}`}>{n}/{max}</span>;
}
