'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, downloadFile } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';

const SITE = 'https://soyclubify.com';
const API = process.env.NEXT_PUBLIC_API_URL ?? '';

type FormField = { key: string; label: string; type: string; required?: boolean; options?: string[] };
type Section = { heading?: string; body?: string; imageUrl?: string };
type PageRow = { id: string; slug: string; name: string; title: string; logoUrl?: string | null; isPublished: boolean; formEnabled: boolean; views: number; leadCount: number; updatedAt: string };
type FullPage = {
  slug: string; name: string; tag: string; title: string; subtitle?: string | null;
  logoUrl?: string | null; heroImageUrl?: string | null; videoUrl?: string | null; description?: string | null;
  sections: Section[]; ctaText?: string | null; ctaUrl?: string | null;
  formEnabled: boolean; formFields: FormField[]; isPublished: boolean;
  theme?: { primaryColor?: string; customHtml?: string; raffleSlug?: string; formPopup?: boolean; leadWhatsapp?: string; leadWhatsappMsg?: string; template?: string } | null;
};
type Lead = { id: string; data: Record<string, any>; createdAt: string };

const FIELD_TYPES = ['text', 'email', 'tel', 'number', 'textarea', 'select'];

export default function PaginasInformativasPage() {
  const [rows, setRows] = useState<PageRow[] | null>(null);
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [leadsSlug, setLeadsSlug] = useState<string | null>(null);
  const [qrSlug, setQrSlug] = useState<string | null>(null);

  const load = () => api<PageRow[]>('/superadmin/info-pages').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function togglePublish(slug: string, isPublished: boolean) {
    await api(`/superadmin/info-pages/${slug}`, { method: 'PATCH', body: JSON.stringify({ isPublished }) });
    load();
  }

  return (
    <div style={{ fontFamily: '"Figtree", system-ui, sans-serif' }}>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Páginas Informativas</h1>
        <p className="mt-1 text-sm text-slate-500">Páginas públicas permanentes con captación de leads y QR. El enlace y el QR nunca cambian aunque edites el contenido.</p>
      </div>

      {!rows ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((p) => (
            <div key={p.slug} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-bold text-slate-900">{p.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {p.isPublished ? 'Publicada' : 'Borrador'}
                    </span>
                  </div>
                  <a href={`${SITE}/${p.slug}`} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-slate-400 hover:text-emerald-600 hover:underline">
                    soyclubify.com/{p.slug}
                  </a>
                </div>
              </div>

              <div className="mt-4 flex gap-4 text-sm">
                <div><span className="font-bold text-slate-900">{p.leadCount}</span> <span className="text-slate-400">leads</span></div>
                <div><span className="font-bold text-slate-900">{p.views}</span> <span className="text-slate-400">vistas</span></div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => setEditSlug(p.slug)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Editar contenido</button>
                <button onClick={() => setLeadsSlug(p.slug)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300">Ver leads</button>
                <button onClick={() => downloadFile(`/superadmin/info-pages/${p.slug}/leads.csv`, `leads-${p.slug}.csv`)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300">Descargar CSV</button>
                <button onClick={() => setQrSlug(p.slug)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300">Descargar QR</button>
              </div>

              <label className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={p.isPublished} onChange={(e) => togglePublish(p.slug, e.target.checked)} />
                Página publicada (visible al público)
              </label>
            </div>
          ))}
        </div>
      )}

      {editSlug && <EditModal slug={editSlug} onClose={() => { setEditSlug(null); load(); }} />}
      {leadsSlug && <LeadsModal slug={leadsSlug} onClose={() => setLeadsSlug(null)} />}
      {qrSlug && <QrModal slug={qrSlug} logoUrl={rows?.find((r) => r.slug === qrSlug)?.logoUrl ?? null} onClose={() => setQrSlug(null)} />}
    </div>
  );
}

// ── Editar contenido ─────────────────────────────────────────────────────────
function EditModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [p, setP] = useState<FullPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api<FullPage>(`/superadmin/info-pages/${slug}`).then(setP); }, [slug]);
  const set = (patch: Partial<FullPage>) => setP((v) => (v ? { ...v, ...patch } : v));

  async function save() {
    if (!p) return;
    setBusy(true);
    try {
      await api(`/superadmin/info-pages/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: p.name, tag: p.tag, title: p.title, subtitle: p.subtitle, logoUrl: p.logoUrl, heroImageUrl: p.heroImageUrl,
          videoUrl: p.videoUrl, description: p.description, sections: p.sections, ctaText: p.ctaText,
          ctaUrl: p.ctaUrl, formEnabled: p.formEnabled, formFields: p.formFields, isPublished: p.isPublished,
          theme: p.theme ?? null,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally { setBusy(false); }
  }

  const inp = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400';

  return (
    <Overlay onClose={onClose} title={p ? `Editar · ${p.name}` : 'Editar'}>
      {!p ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-4">
          <Field label="Nombre interno"><input className={inp} value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Etiqueta de los leads"><input className={inp} value={p.tag} onChange={(e) => set({ tag: e.target.value })} /></Field>
          <Field label="Título (H1)"><input className={inp} value={p.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Subtítulo"><input className={inp} value={p.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
          <Field label="Descripción"><textarea rows={3} className={inp} value={p.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Logo (se incrusta en el QR y en el encabezado)">
            <ImageUploader value={p.logoUrl ?? null} onChange={(url) => set({ logoUrl: url })} folder="info-pages" crop={false} aspect={1} minDimensionWarn={false} maxSizeMb={5} />
            <p className="mt-1 text-xs text-slate-400">PNG con fondo transparente recomendado. Se coloca al centro del QR.</p>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Imagen principal (URL)"><input className={inp} value={p.heroImageUrl ?? ''} onChange={(e) => set({ heroImageUrl: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Video (YouTube/Vimeo/URL)"><input className={inp} value={p.videoUrl ?? ''} onChange={(e) => set({ videoUrl: e.target.value })} placeholder="https://youtube.com/…" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Texto del botón (CTA)"><input className={inp} value={p.ctaText ?? ''} onChange={(e) => set({ ctaText: e.target.value })} /></Field>
            <Field label="Enlace del botón (opcional)"><input className={inp} value={p.ctaUrl ?? ''} onChange={(e) => set({ ctaUrl: e.target.value })} placeholder="vacío = ir al formulario" /></Field>
          </div>

          {/* Secciones */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Secciones</span>
              <button onClick={() => set({ sections: [...p.sections, { heading: '', body: '' }] })} className="text-xs font-medium text-emerald-600">+ Agregar sección</button>
            </div>
            <div className="space-y-2">
              {p.sections.map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <input className={inp} placeholder="Título de la sección" value={s.heading ?? ''} onChange={(e) => set({ sections: p.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} />
                    <button onClick={() => set({ sections: p.sections.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-rose-600">✕</button>
                  </div>
                  <textarea rows={2} className={`${inp} mt-2`} placeholder="Contenido" value={s.body ?? ''} onChange={(e) => set({ sections: p.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
          </div>

          {/* Formulario */}
          <div className="rounded-xl border border-slate-100 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={p.formEnabled} onChange={(e) => set({ formEnabled: e.target.checked })} />
              Mostrar formulario de captación de leads
            </label>
            {p.formEnabled && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Campos del formulario</span>
                  <button onClick={() => set({ formFields: [...p.formFields, { key: `campo_${p.formFields.length + 1}`, label: 'Nuevo campo', type: 'text', required: false }] })} className="text-xs font-medium text-emerald-600">+ Campo</button>
                </div>
                {p.formFields.map((f, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 p-2">
                    <input className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs" placeholder="Etiqueta" value={f.label} onChange={(e) => set({ formFields: p.formFields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <input className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" placeholder="key" value={f.key} onChange={(e) => set({ formFields: p.formFields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                    <select className="rounded border border-slate-200 px-2 py-1 text-xs" value={f.type} onChange={(e) => set({ formFields: p.formFields.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
                      {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={!!f.required} onChange={(e) => set({ formFields: p.formFields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} />obligatorio</label>
                    <button onClick={() => set({ formFields: p.formFields.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-rose-600">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Diseño de la página (plantilla) */}
          <div className="rounded-xl border border-slate-100 p-3">
            <p className="text-sm font-semibold text-slate-700">Diseño de la página</p>
            <p className="mb-2 mt-0.5 text-xs text-slate-400">«Home Clubify» clona la portada de soyclubify.com (hero + mockups) y el botón «Contactar» abre el formulario emergente.</p>
            <select className={inp} value={p.theme?.template ?? ''} onChange={(e) => set({ theme: { ...(p.theme ?? {}), template: e.target.value || undefined } })}>
              <option value="">Estándar (hero simple)</option>
              <option value="clubify-home">Home Clubify (clon de portada)</option>
            </select>
          </div>

          {/* Popup + WhatsApp (campañas tipo Gastrofusión) */}
          {p.formEnabled && (
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="text-sm font-semibold text-slate-700">Formulario emergente + WhatsApp</p>
              <p className="mb-2 mt-0.5 text-xs text-slate-400">Para campañas: el botón abre el formulario en una ventana emergente y, al enviarlo, redirige a WhatsApp con un mensaje pre-cargado.</p>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={!!p.theme?.formPopup} onChange={(e) => set({ theme: { ...(p.theme ?? {}), formPopup: e.target.checked } })} />
                Abrir el formulario en ventana emergente (popup)
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="WhatsApp de destino (solo números, con código de país)">
                  <input className={inp} value={p.theme?.leadWhatsapp ?? ''} onChange={(e) => set({ theme: { ...(p.theme ?? {}), leadWhatsapp: e.target.value } })} placeholder="573189554627" />
                </Field>
                <Field label="Mensaje pre-cargado de WhatsApp">
                  <input className={inp} value={p.theme?.leadWhatsappMsg ?? ''} onChange={(e) => set({ theme: { ...(p.theme ?? {}), leadWhatsappMsg: e.target.value } })} placeholder="Hola, me interesa saber más" />
                </Field>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">Color de acento</label>
                <input type="color" value={p.theme?.primaryColor ?? '#16a34a'} onChange={(e) => set({ theme: { ...(p.theme ?? {}), primaryColor: e.target.value } })} className="h-9 w-14 cursor-pointer rounded border border-slate-200" />
                <span className="text-xs text-slate-400">Botón, encabezado y detalles.</span>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={p.isPublished} onChange={(e) => set({ isPublished: e.target.checked })} />
            Publicar página (visible al público)
          </label>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            {saved && <span className="text-sm text-emerald-600">✓ Guardado</span>}
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Cerrar</button>
            <button onClick={save} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}
    </Overlay>
  );
}

// ── Ver leads ────────────────────────────────────────────────────────────────
function LeadsModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [data, setData] = useState<{ page: { name: string; formFields: FormField[] }; leads: Lead[] } | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => { api<any>(`/superadmin/info-pages/${slug}/leads`).then(setData); }, [slug]);
  const fields = data?.page.formFields ?? [];
  const leads = (data?.leads ?? []).filter((l) => !q.trim() || JSON.stringify(l.data).toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Overlay onClose={onClose} title={data ? `Leads · ${data.page.name}` : 'Leads'} wide>
      {!data ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
            <button onClick={() => downloadFile(`/superadmin/info-pages/${slug}/leads.csv`, `leads-${slug}.csv`)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-300">Descargar CSV</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  {fields.map((f) => <th key={f.key} className="px-3 py-2 font-semibold">{f.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 ? (
                  <tr><td colSpan={fields.length + 1} className="px-3 py-6 text-center text-slate-400">Sin leads todavía.</td></tr>
                ) : leads.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{new Date(l.createdAt).toLocaleString('es-CO')}</td>
                    {fields.map((f) => <td key={f.key} className="px-3 py-2 text-slate-700">{String(l.data?.[f.key] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">{leads.length} lead(s)</p>
        </div>
      )}
    </Overlay>
  );
}

// ── QR ───────────────────────────────────────────────────────────────────────
function loadImage(src: string, crossOrigin?: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function QrModal({ slug, logoUrl, onClose }: { slug: string; logoUrl: string | null; onClose: () => void }) {
  const [url] = useState(`${SITE}/${slug}`);
  const [dataUrl, setDataUrl] = useState<string>('');
  const [withLogo, setWithLogo] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setDataUrl('');
      // Nivel de corrección H (30%) para que el QR siga leyéndose con el logo encima.
      const png = await QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#0f172a', light: '#ffffff' } });
      if (!withLogo) { if (!cancel) setDataUrl(png); return; }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1024; canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('sin canvas');
        ctx.drawImage(await loadImage(png), 0, 0, 1024, 1024);
        const c = 512;
        if (logoUrl) {
          // Logo real: se carga por el proxy CORS del backend para no "tainted" el
          // canvas (R2 no manda Access-Control-Allow-Origin). Recuadro blanco central
          // + logo encajado conservando proporción.
          const logo = await loadImage(`${API}/api/media/proxy?url=${encodeURIComponent(logoUrl)}`, true);
          const box = 232;
          ctx.fillStyle = '#ffffff';
          roundRect(ctx, c - box / 2, c - box / 2, box, box, 34);
          ctx.fill();
          const pad = 28, maxW = box - pad * 2, maxH = box - pad * 2;
          const ratio = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight);
          const w = logo.naturalWidth * ratio, h = logo.naturalHeight * ratio;
          ctx.drawImage(logo, c - w / 2, c - h / 2, w, h);
        } else {
          // Sin logo subido: badge "C" de respaldo (verde de marca).
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(c, c, 124, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.arc(c, c, 110, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffffff'; ctx.font = 'bold 150px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('C', c, c + 6);
        }
        const out = canvas.toDataURL('image/png'); // lanza si el canvas quedó tainted
        if (!cancel) setDataUrl(out);
      } catch {
        if (!cancel) setDataUrl(png); // cualquier fallo (CORS, carga) → QR plano legible
      }
    })();
    return () => { cancel = true; };
  }, [url, withLogo, logoUrl]);

  function download() {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = `qr-${slug}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <Overlay onClose={onClose} title={`QR · ${slug}`}>
      <div className="flex flex-col items-center gap-4">
        {dataUrl ? <img src={dataUrl} alt="QR" className="h-56 w-56 rounded-xl border border-slate-100" /> : <div className="h-56 w-56 animate-pulse rounded-xl bg-slate-100" />}
        <p className="text-center text-xs text-slate-400">{url}<br />Permanente — no cambia aunque edites el contenido.</p>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={withLogo} onChange={(e) => setWithLogo(e.target.checked)} /> Incluir logo</label>
        {withLogo && !logoUrl && <p className="-mt-2 text-center text-[11px] text-amber-600">Sube un logo en «Editar contenido» para usar el tuyo. Por ahora se usa un marcador.</p>}
        <button onClick={download} disabled={!dataUrl} className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Descargar PNG (1024px)</button>
      </div>
    </Overlay>
  );
}

// ── UI helpers ───────────────────────────────────────────────────────────────
function Overlay({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-2xl bg-white p-6 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>{children}</div>);
}
