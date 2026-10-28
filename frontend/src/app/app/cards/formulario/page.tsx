'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { PanelHeader } from '@/components/PanelHeader';
import { toast } from '@/components/Toast';
import {
  MAX_EXTRAS,
  type CampoExtra,
  type FormularioDeRegistro,
  type ModoDeCampo,
  type TipoDeCampo,
} from '@/lib/formulario-de-registro';

/**
 * Tarjetas → «Formulario»: qué llena el cliente para obtener su tarjeta
 * (`/c/<cardId>`). El negocio decide si correo y cumpleaños son obligatorios,
 * opcionales o no se piden, y agrega sus propias casillas (Javier, 2026-10-28).
 * Nombre y teléfono van siempre: el teléfono reconoce al cliente cuando vuelve.
 */

/** En el editor las opciones se escriben una por línea. */
type CampoEnEdicion = CampoExtra & { opcionesTexto: string };

const nuevoId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function aEdicion(f: FormularioDeRegistro): { email: ModoDeCampo; cumpleanos: ModoDeCampo; extras: CampoEnEdicion[] } {
  return {
    email: f.email,
    cumpleanos: f.cumpleanos,
    extras: f.extras.map((c) => ({ ...c, opcionesTexto: (c.opciones ?? []).join('\n') })),
  };
}

function aGuardar(e: ReturnType<typeof aEdicion>): FormularioDeRegistro {
  return {
    email: e.email,
    cumpleanos: e.cumpleanos,
    extras: e.extras.map(({ opcionesTexto, ...c }) => ({
      ...c,
      etiqueta: c.etiqueta.trim(),
      ...(c.tipo === 'opciones'
        ? { opciones: opcionesTexto.split('\n').map((o) => o.trim()).filter(Boolean) }
        : { opciones: undefined }),
    })),
  };
}

export default function FormularioDeRegistroPage() {
  const t = useTranslations('app_registration_form');
  const [form, setForm] = useState<ReturnType<typeof aEdicion> | null>(null);
  const [guardado, setGuardado] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<FormularioDeRegistro>('/tenants/me/formulario-registro')
      .then((f) => {
        const e = aEdicion(f);
        setForm(e);
        setGuardado(JSON.stringify(aGuardar(e)));
      })
      .catch(() => toast(t('errLoading'), 'error'));
  }, [t]);

  const cambiado = useMemo(() => !!form && JSON.stringify(aGuardar(form)) !== guardado, [form, guardado]);

  if (!form) {
    return (
      <div>
        <PanelHeader title={t('title')} subtitle={t('subtitle')} />
        <div className="card card-pad text-sm text-mute">…</div>
      </div>
    );
  }

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const setCampo = (i: number, patch: Partial<CampoEnEdicion>) =>
    set({ extras: form.extras.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const mover = (i: number, d: -1 | 1) => {
    const l = [...form.extras];
    [l[i], l[i + d]] = [l[i + d], l[i]];
    set({ extras: l });
  };

  async function guardar() {
    if (!form) return;
    const datos = aGuardar(form);
    if (datos.extras.some((c) => !c.etiqueta)) return toast(t('emptyLabelErr'), 'error');
    const sinOpciones = datos.extras.find((c) => c.tipo === 'opciones' && !c.opciones?.length);
    if (sinOpciones) return toast(t('optionsErr', { label: sinOpciones.etiqueta }), 'error');
    setSaving(true);
    try {
      const f = await api<FormularioDeRegistro>('/tenants/me/formulario-registro', {
        method: 'PUT',
        body: JSON.stringify(datos),
      });
      const e = aEdicion(f);
      setForm(e);
      setGuardado(JSON.stringify(aGuardar(e)));
      toast(t('saved'), 'success');
    } catch (e: any) {
      toast(e?.message || t('errSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  const tipos: Array<[TipoDeCampo, string]> = [
    ['texto', t('typeText')],
    ['numero', t('typeNumber')],
    ['fecha', t('typeDate')],
    ['opciones', t('typeOptions')],
  ];

  return (
    <div>
      <PanelHeader
        title={t('title')}
        crumb={
          <>
            / <Link href="/app/cards" className="hover:underline">{t('back')}</Link>
          </>
        }
        subtitle={t('subtitle')}
        actions={
          <button className="btn-primary" onClick={guardar} disabled={saving || !cambiado}>
            {saving ? t('saving') : t('save')}
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="flex flex-col gap-5 min-w-0">
          {/* Lo que no se puede quitar. */}
          <section className="card card-pad">
            <h2 className="font-semibold text-base m-0">{t('alwaysTitle')}</h2>
            <p className="text-xs text-mute mt-1 mb-3">{t('alwaysDesc')}</p>
            <div className="flex flex-col divide-y divide-line">
              {[t('name'), t('phone')].map((n) => (
                <div key={n} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium">{n}</span>
                  <span className="text-xs font-semibold text-mute">🔒 {t('required')}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Correo y cumpleaños: obligatorio, opcional o no se pide. */}
          <section className="card card-pad">
            <div className="flex flex-col divide-y divide-line">
              {(
                [
                  ['email', t('email'), null],
                  ['cumpleanos', t('birthday'), t('birthdayHint')],
                ] as const
              ).map(([k, nombre, ayuda]) => (
                <div key={k} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{nombre}</div>
                    {ayuda && <div className="text-xs text-mute mt-0.5">{ayuda}</div>}
                  </div>
                  <Segmento
                    valor={form[k]}
                    onChange={(v) => set({ [k]: v } as Partial<typeof form>)}
                    opciones={[
                      ['obligatorio', t('required')],
                      ['opcional', t('optional')],
                      ['oculto', t('hidden')],
                    ]}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Casillas propias. */}
          <section className="card card-pad">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-base m-0">{t('yourFields')}</h2>
                <p className="text-xs text-mute mt-1">{t('yourFieldsDesc', { max: MAX_EXTRAS })}</p>
              </div>
              <button
                type="button"
                className="btn-ghost"
                disabled={form.extras.length >= MAX_EXTRAS}
                onClick={() =>
                  set({
                    extras: [
                      ...form.extras,
                      { id: nuevoId(), etiqueta: '', tipo: 'texto', obligatorio: false, opcionesTexto: '' },
                    ],
                  })
                }
              >
                + {t('addField')}
              </button>
            </div>

            {!form.extras.length && <p className="text-sm text-mute mt-4 mb-0">{t('noFields')}</p>}

            <div className="flex flex-col gap-3 mt-4">
              {form.extras.map((c, i) => (
                <div key={c.id} className="rounded-xl border border-line p-3 sm:p-4 flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
                    <div>
                      <label className="label" htmlFor={`et-${c.id}`}>{t('fieldLabel')}</label>
                      <input
                        id={`et-${c.id}`}
                        className="input"
                        value={c.etiqueta}
                        maxLength={60}
                        placeholder={t('fieldLabelPlaceholder')}
                        onChange={(e) => setCampo(i, { etiqueta: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor={`ti-${c.id}`}>{t('fieldType')}</label>
                      <select
                        id={`ti-${c.id}`}
                        className="input"
                        value={c.tipo}
                        onChange={(e) => setCampo(i, { tipo: e.target.value as TipoDeCampo })}
                      >
                        {tipos.map(([v, n]) => (
                          <option key={v} value={v}>{n}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {c.tipo === 'opciones' && (
                    <div>
                      <label className="label" htmlFor={`op-${c.id}`}>{t('options')}</label>
                      <textarea
                        id={`op-${c.id}`}
                        className="input min-h-[96px]"
                        value={c.opcionesTexto}
                        placeholder={'Instagram\nTikTok\nUn amigo'}
                        onChange={(e) => setCampo(i, { opcionesTexto: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-brand w-4 h-4"
                        checked={c.obligatorio}
                        onChange={(e) => setCampo(i, { obligatorio: e.target.checked })}
                      />
                      {t('requiredField')}
                    </label>
                    <div className="flex gap-1">
                      <button type="button" className="btn-ghost !px-3" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={t('moveUp')} title={t('moveUp')}>↑</button>
                      <button type="button" className="btn-ghost !px-3" disabled={i === form.extras.length - 1} onClick={() => mover(i, 1)} aria-label={t('moveDown')} title={t('moveDown')}>↓</button>
                      <button
                        type="button"
                        className="btn-ghost !px-3 text-bad"
                        onClick={() => set({ extras: form.extras.filter((_, j) => j !== i) })}
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {cambiado && <p className="text-xs text-mute m-0">{t('unsaved')}</p>}
        </div>

        <Vista form={form} t={t} />
      </div>
    </div>
  );
}

function Segmento({
  valor,
  opciones,
  onChange,
}: {
  valor: ModoDeCampo;
  opciones: Array<[ModoDeCampo, string]>;
  onChange: (v: ModoDeCampo) => void;
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-full border border-line bg-bg p-0.5">
      {opciones.map(([v, n]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            valor === v ? 'bg-brand text-white shadow-sm' : 'text-mute hover:text-ink'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Así lo ve el cliente: el mismo orden y las mismas marcas que `/c/<cardId>`. */
function Vista({
  form,
  t,
}: {
  form: ReturnType<typeof aEdicion>;
  t: ReturnType<typeof useTranslations>;
}) {
  const fila = (nombre: string, obligatorio: boolean, control: 'input' | 'select' = 'input') => (
    <div key={nombre}>
      <div className="text-xs font-medium mb-1">
        {nombre}
        {obligatorio ? ' *' : ''}
      </div>
      <div className="h-9 rounded-lg border border-line bg-white/60 dark:bg-white/5 px-3 flex items-center text-xs text-mute">
        {control === 'select' ? `${t('previewChoose')} ▾` : ''}
      </div>
    </div>
  );
  return (
    <aside className="lg:sticky lg:top-4">
      <div className="text-xs font-semibold text-mute uppercase tracking-wider mb-2">{t('preview')}</div>
      <div className="card card-pad flex flex-col gap-3">
        {fila(t('name'), true)}
        {fila(t('phone'), true)}
        {form.email !== 'oculto' && fila(t('email'), form.email === 'obligatorio')}
        {form.cumpleanos !== 'oculto' && fila(`🎂 ${t('birthday')}`, form.cumpleanos === 'obligatorio', 'select')}
        {form.extras.map((c) =>
          fila(c.etiqueta.trim() || '—', c.obligatorio, c.tipo === 'opciones' ? 'select' : 'input'),
        )}
        <div className="mt-1 h-10 rounded-full bg-brand text-white text-sm font-semibold flex items-center justify-center">
          {t('previewSubmit')}
        </div>
      </div>
    </aside>
  );
}
