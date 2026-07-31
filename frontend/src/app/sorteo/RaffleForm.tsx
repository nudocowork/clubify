'use client';

import { useState } from 'react';

// Formulario público del sorteo servido NATIVAMENTE en soyclubify.com (white-label).
// Los datos vienen del panel team_clubify vía endpoints CORS: GET del sorteo (en el
// server component) y POST de la participación aquí. Mismo proceso/confirmación que
// el formulario original del panel.
const TEAM_BASE = 'https://team.soyclubify.com';
const ACCENT = '#4f46e5';

type FieldType =
  | 'short_text' | 'long_text' | 'number' | 'email' | 'whatsapp' | 'url' | 'instagram'
  | 'select' | 'multiselect' | 'checkbox' | 'radio' | 'date' | 'time' | 'file' | 'image';
type Option = { value: string; label: string };
export type RaffleField = {
  id: string; key: string; type: FieldType; label: string;
  help?: string; placeholder?: string; required?: boolean; options?: Option[];
};
export type RaffleData = {
  id: string; slug: string; name: string; company: string | null;
  draw_date: string | null; close_date: string | null; fields: RaffleField[];
};

function readUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = p.get(k); if (v) out[k] = v;
  }
  return out;
}

export function RaffleForm({ slug, raffle }: { slug: string; raffle: RaffleData }) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'form' | 'done'>('form');
  const [already, setAlready] = useState(false);
  const [wa, setWa] = useState<{ phone: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: string | string[]) => setAnswers((a) => ({ ...a, [k]: v }));

  function validate(): string[] {
    const missing: string[] = [];
    for (const f of raffle.fields) {
      if (!f.required) continue;
      const v = answers[f.key];
      const empty = v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
      if (empty) missing.push(f.key);
    }
    return missing;
  }

  async function submit() {
    const missing = validate();
    if (missing.length) { setErrors(new Set(missing)); return; }
    setErrors(new Set()); setBusy(true); setErr(null);
    try {
      const res = await fetch(`${TEAM_BASE}/api/raffle/${slug}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...answers, ...readUtm() }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      if (j.ok) { setAlready(!!j.already); setWa({ phone: j.confirmWhatsapp, msg: j.confirmMessage }); setState('done'); }
      else setErr(j.error || 'No se pudo registrar. Revisa los datos e intenta de nuevo.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const baseInp = (invalid: boolean) =>
    `w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition focus:ring-2 ${invalid ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-200 focus:ring-slate-200'}`;

  function renderField(f: RaffleField) {
    const invalid = errors.has(f.key);
    const v = answers[f.key];
    const str = typeof v === 'string' ? v : '';
    const opts = f.options ?? [];
    switch (f.type) {
      case 'long_text':
        return <textarea rows={3} value={str} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} className={baseInp(invalid)} />;
      case 'select':
        return (
          <select value={str} onChange={(e) => set(f.key, e.target.value)} className={baseInp(invalid) + ' bg-white'}>
            <option value="">Selecciona…</option>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case 'radio':
        return (
          <div className="space-y-1.5">
            {opts.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name={f.key} checked={str === o.value} onChange={() => set(f.key, o.value)} />{o.label}
              </label>
            ))}
          </div>
        );
      case 'multiselect': {
        const arr = Array.isArray(v) ? v : [];
        return (
          <div className="space-y-1.5">
            {opts.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={arr.includes(o.value)} onChange={(e) => set(f.key, e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />{o.label}
              </label>
            ))}
          </div>
        );
      }
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={str === 'si'} onChange={(e) => set(f.key, e.target.checked ? 'si' : '')} />{f.placeholder || 'Sí'}
          </label>
        );
      default: {
        const type = f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'whatsapp' ? 'tel' : f.type === 'url' ? 'url' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text';
        return <input type={type} value={str} placeholder={f.placeholder || (f.type === 'instagram' ? '@usuario' : undefined)} onChange={(e) => set(f.key, e.target.value)} className={baseInp(invalid)} />;
      }
    }
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl text-3xl" style={{ background: `${ACCENT}14` }}>🎟️</div>
            <h1 className="text-xl font-bold text-slate-900">{raffle.name}</h1>
            {raffle.company && <p className="text-sm text-slate-500">{raffle.company}</p>}
            {raffle.draw_date && <p className="mt-1 text-xs text-slate-500">Sorteo: {raffle.draw_date}</p>}
          </div>

          {state === 'done' ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-3xl">{already ? '🎟️' : '🎉'}</div>
              <p className="text-lg font-bold text-slate-900">{already ? '¡Ya estás participando!' : '¡Ya casi eres parte del sorteo!'}</p>
              <p className="mt-2 text-sm text-slate-500">
                {already
                  ? `Ya te habías registrado en este sorteo de ${raffle.company || 'Clubify'} con estos datos. No necesitas registrarte otra vez.`
                  : `Solo falta un paso muy importante para completar tu participación en el sorteo de ${raffle.company || 'Clubify'}.`}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {already ? 'Si aún no lo hiciste, confirma tu participación por WhatsApp.' : 'Haz clic en el botón de abajo y confirma tu participación por WhatsApp.'}
              </p>
              {wa?.phone && (
                <a href={`https://wa.me/${wa.phone}?text=${encodeURIComponent(wa.msg || '')}`} target="_blank" rel="noreferrer"
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1eb457]">
                  <span className="text-lg">✅</span> Confirmar mi participación
                </a>
              )}
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">⚠️ Si no confirmas por WhatsApp, tu participación no será válida.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3.5">
                {raffle.fields.map((f) => (
                  <div key={f.id || f.key}>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      {f.label}{f.required && <span className="ml-0.5 text-rose-500">*</span>}
                    </label>
                    {renderField(f)}
                    {f.help && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
                    {errors.has(f.key) && <p className="mt-1 text-xs text-rose-500">Este campo es obligatorio.</p>}
                  </div>
                ))}
              </div>
              {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
              <button onClick={submit} disabled={busy} className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ background: ACCENT }}>
                {busy ? 'Enviando…' : 'Participar en el sorteo'}
              </button>
              <p className="mt-3 text-center text-[11px] text-slate-400">Al participar aceptas ser contactado sobre este sorteo.</p>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-400">soyclubify.com</p>
      </div>
    </div>
  );
}

// Pantalla cuando no hay sorteo disponible (inactivo / inexistente / conflicto).
export function RaffleUnavailable({ reason }: { reason?: 'none' | 'many' | 'notfound' }) {
  const many = reason === 'many';
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-slate-50 px-4">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-3xl">🎟️</div>
        <h1 className="text-lg font-bold text-slate-900">{many ? 'Sorteo en ajustes' : 'No hay sorteos activos'}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {many
            ? 'Estamos afinando los detalles del sorteo. Vuelve a escanear en unos minutos.'
            : 'En este momento no hay un sorteo disponible. Vuelve a intentarlo más tarde.'}
        </p>
      </div>
    </div>
  );
}
