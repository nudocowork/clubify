'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';

type Section =
  | { type: 'heading'; text: string; level?: number }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'gallery'; images: string[] }
  | { type: 'divider' }
  | { type: 'embed_menu' }
  | { type: 'embed_promotions' }
  | { type: 'embed_card' };

type Button = {
  label: string;
  type: 'WHATSAPP' | 'INSTAGRAM' | 'MAPS' | 'MENU' | 'CARD' | 'PROMO' | 'EXTERNAL';
  url?: string;
  style?: 'primary' | 'secondary';
};

type InfoLink = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  heroImageUrl: string | null;
  gallery: string[];
  sections: Section[];
  buttons: Button[];
  theme: { primaryColor?: string };
  isActive: boolean;
  views: number;
};

const BUTTON_TYPE_LABEL: Record<string, string> = {
  WHATSAPP: '💬 WhatsApp',
  INSTAGRAM: '📷 Instagram',
  MAPS: '📍 Cómo llegar',
  MENU: '🍽 Ver menú',
  CARD: '💳 Mi tarjeta',
  PROMO: '🎁 Promociones',
  EXTERNAL: '🔗 Link externo',
};

export default function InfoLinkEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [link, setLink] = useState<InfoLink | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<any>(null);

  async function load() {
    const l = await api<InfoLink>(`/info-links/${id}`);
    setLink(l);
    setTenant(await api('/tenants/me'));
    setStats(await api(`/info-links/${id}/stats`).catch(() => null));
  }
  useEffect(() => {
    load();
  }, [id]);

  async function save() {
    if (!link) return;
    setBusy(true);
    try {
      await api(`/info-links/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: link.title,
          subtitle: link.subtitle,
          heroImageUrl: link.heroImageUrl,
          gallery: link.gallery,
          sections: link.sections,
          buttons: link.buttons,
          theme: link.theme,
          isActive: link.isActive,
        }),
      });
      setSavedAt(new Date());
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('¿Eliminar este link?')) return;
    await api(`/info-links/${id}`, { method: 'DELETE' });
    router.push('/app/info-links');
  }

  function update<K extends keyof InfoLink>(k: K, v: InfoLink[K]) {
    if (!link) return;
    setLink({ ...link, [k]: v });
  }

  function addSection(type: Section['type']) {
    if (!link) return;
    const s: any = { type };
    if (type === 'heading') s.text = 'Nuevo título';
    if (type === 'paragraph') s.text = 'Texto del párrafo…';
    if (type === 'image') s.url = '';
    if (type === 'gallery') s.images = [];
    update('sections', [...link.sections, s]);
  }

  function updateSection(i: number, patch: any) {
    if (!link) return;
    const arr = [...link.sections];
    arr[i] = { ...arr[i], ...patch } as any;
    update('sections', arr);
  }

  function removeSection(i: number) {
    if (!link) return;
    const arr = [...link.sections];
    arr.splice(i, 1);
    update('sections', arr);
  }

  function moveSection(i: number, dir: -1 | 1) {
    if (!link) return;
    const arr = [...link.sections];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    update('sections', arr);
  }

  function addButton() {
    if (!link) return;
    update('buttons', [
      ...link.buttons,
      { label: 'Botón nuevo', type: 'EXTERNAL', url: 'https://', style: 'primary' },
    ]);
  }

  function updateButton(i: number, patch: Partial<Button>) {
    if (!link) return;
    const arr = [...link.buttons];
    arr[i] = { ...arr[i], ...patch };
    update('buttons', arr);
  }

  function removeButton(i: number) {
    if (!link) return;
    const arr = [...link.buttons];
    arr.splice(i, 1);
    update('buttons', arr);
  }

  if (!link || !tenant) return <div className="text-mute">Cargando…</div>;

  const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${tenant.slug}/${link.slug}`;
  const primary = link.theme?.primaryColor ?? tenant.primaryColor ?? '#6366F1';

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {link.title}{' '}
          <span className="page-crumb">
            / {link.views} vistas · {stats?.qrScans ?? 0} QR
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/app/info-links`}
            className="btn-ghost"
          >
            ← Volver
          </Link>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost"
          >
            <Icon name="arrow-right" /> Ver público
          </a>
          <button className="btn-primary" onClick={save} disabled={busy}>
            <Icon name="check" /> {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      {savedAt && (
        <div className="rounded-lg bg-ok-soft text-ok-ink px-3 py-2 mb-4 text-sm">
          ✓ Guardado a las {savedAt.toLocaleTimeString('es-CO')}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-5">
        {/* Editor */}
        <div className="space-y-5">
          {/* Info general */}
          <div className="card card-pad">
            <h3 className="font-semibold m-0 mb-4">Información general</h3>

            <div>
              <label className="label">Título</label>
              <input
                className="input"
                value={link.title}
                onChange={(e) => update('title', e.target.value)}
              />
            </div>
            <div className="mt-3">
              <label className="label">Bajada / descripción corta</label>
              <input
                className="input"
                value={link.subtitle ?? ''}
                onChange={(e) => update('subtitle', e.target.value)}
              />
            </div>
            <div className="mt-3">
              <label className="label">Imagen de portada (hero)</label>
              <ImageUploader
                value={link.heroImageUrl}
                onChange={(url) => update('heroImageUrl', url)}
                folder="info-links"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Color principal</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={primary}
                  onChange={(e) =>
                    update('theme', { ...link.theme, primaryColor: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Estado</label>
                <select
                  className="input"
                  value={link.isActive ? '1' : '0'}
                  onChange={(e) => update('isActive', e.target.value === '1')}
                >
                  <option value="1">Activo (visible)</option>
                  <option value="0">Pausado (oculto)</option>
                </select>
              </div>
            </div>
          </div>

          {/* URL */}
          <div className="card card-pad">
            <h3 className="font-semibold m-0 mb-3">URL pública</h3>
            <div className="flex items-center gap-2 bg-bg2 rounded-lg p-3">
              <code className="text-xs flex-1 break-all">{publicUrl}</code>
              <button
                className="btn-link text-xs"
                onClick={() => navigator.clipboard.writeText(publicUrl)}
              >
                Copiar
              </button>
              <a
                href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(publicUrl)}&download=1`}
                download={`qr-${link.slug}.png`}
                className="btn-link text-xs"
              >
                Descargar QR
              </a>
            </div>
          </div>

          {/* Bloques */}
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold m-0">Bloques</h3>
              <select
                className="input w-auto text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    addSection(e.target.value as Section['type']);
                    e.target.value = '';
                  }
                }}
              >
                <option value="">+ Agregar bloque</option>
                <option value="heading">Encabezado</option>
                <option value="paragraph">Párrafo</option>
                <option value="image">Imagen</option>
                <option value="gallery">Galería</option>
                <option value="divider">Separador</option>
                <option value="embed_menu">📋 Embed menú</option>
                <option value="embed_promotions">🎁 Embed promociones</option>
                <option value="embed_card">💳 Embed tarjeta</option>
              </select>
            </div>

            <div className="space-y-2">
              {link.sections.length === 0 && (
                <div className="text-mute text-sm text-center py-4">
                  Sin bloques aún. Agrega uno arriba.
                </div>
              )}
              {link.sections.map((s, i) => (
                <SectionEditor
                  key={i}
                  section={s}
                  onChange={(patch) => updateSection(i, patch)}
                  onMoveUp={() => moveSection(i, -1)}
                  onMoveDown={() => moveSection(i, 1)}
                  onRemove={() => removeSection(i)}
                  isFirst={i === 0}
                  isLast={i === link.sections.length - 1}
                />
              ))}
            </div>
          </div>

          {/* Botones */}
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold m-0">Botones</h3>
              <button className="btn-ghost text-sm" onClick={addButton}>
                <Icon name="plus" /> Botón
              </button>
            </div>

            <div className="space-y-2">
              {link.buttons.length === 0 && (
                <div className="text-mute text-sm text-center py-4">
                  Sin botones. Agrega CTAs como WhatsApp, Maps, Menú embed.
                </div>
              )}
              {link.buttons.map((b, i) => (
                <div
                  key={i}
                  className="border border-line2 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2"
                >
                  <input
                    className="input"
                    placeholder="Texto del botón"
                    value={b.label}
                    onChange={(e) => updateButton(i, { label: e.target.value })}
                  />
                  <select
                    className="input"
                    value={b.type}
                    onChange={(e) =>
                      updateButton(i, { type: e.target.value as any })
                    }
                  >
                    {Object.entries(BUTTON_TYPE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-danger px-3"
                    onClick={() => removeButton(i)}
                  >
                    <Icon name="trash" />
                  </button>
                  {b.type === 'EXTERNAL' && (
                    <input
                      className="input col-span-full"
                      placeholder="https://..."
                      value={b.url ?? ''}
                      onChange={(e) => updateButton(i, { url: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <div className="card card-pad">
              <h3 className="font-semibold m-0 mb-3">Estadísticas (30 días)</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-mute uppercase tracking-wider">
                    Vistas
                  </div>
                  <div className="text-2xl font-bold">{stats.views}</div>
                </div>
                <div>
                  <div className="text-xs text-mute uppercase tracking-wider">
                    Escaneos QR
                  </div>
                  <div className="text-2xl font-bold">{stats.qrScans}</div>
                </div>
                <div>
                  <div className="text-xs text-mute uppercase tracking-wider">
                    Clics botón
                  </div>
                  <div className="text-2xl font-bold">
                    {Object.values(stats.buttonClicks ?? {}).reduce(
                      (s: number, n: any) => s + Number(n),
                      0,
                    )}
                  </div>
                </div>
              </div>
              {Object.keys(stats.buttonClicks ?? {}).length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {Object.entries(stats.buttonClicks).map(([label, n]) => (
                    <div
                      key={label}
                      className="flex justify-between text-sm border-b border-line2 py-1.5"
                    >
                      <span>{label}</span>
                      <strong>{n as number}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={remove} className="text-bad underline text-sm">
            Eliminar link
          </button>
        </div>

        {/* Preview iPhone */}
        <div className="lg:sticky lg:top-6 self-start">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
            Vista previa
          </div>
          <div className="flex justify-center">
            <div className="iphone">
              <div className="iphone-notch" />
              <div
                className="iphone-screen overflow-auto"
                style={{ minHeight: 540, maxHeight: 700 }}
              >
                <div className="iphone-bar">
                  <span>11:42</span>
                  <span className="text-[10px]">●●● 100%</span>
                </div>
                <PublicLinkPreview link={link} tenant={tenant} primary={primary} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Section editor inline
// =====================================================
function SectionEditor({
  section,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  isFirst,
  isLast,
}: {
  section: Section;
  onChange: (patch: any) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="border border-line2 rounded-lg p-3 group">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
          {section.type.replace('_', ' ')}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button
            disabled={isFirst}
            onClick={onMoveUp}
            className="text-mute hover:text-ink disabled:opacity-30 px-1"
          >
            ↑
          </button>
          <button
            disabled={isLast}
            onClick={onMoveDown}
            className="text-mute hover:text-ink disabled:opacity-30 px-1"
          >
            ↓
          </button>
          <button onClick={onRemove} className="text-bad px-1">
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      {section.type === 'heading' && (
        <input
          className="input"
          value={section.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Título"
        />
      )}
      {section.type === 'paragraph' && (
        <textarea
          className="input"
          value={section.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Texto del párrafo"
        />
      )}
      {section.type === 'image' && (
        <ImageUploader
          value={section.url}
          onChange={(url) => onChange({ url })}
          folder="info-links"
        />
      )}
      {section.type === 'gallery' && (
        <div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {section.images.map((url, i) => (
              <div key={i} className="relative">
                <img
                  src={url}
                  alt=""
                  className="w-full h-20 object-cover rounded"
                />
                <button
                  className="absolute top-1 right-1 bg-bad text-white rounded-full w-5 h-5 text-xs"
                  onClick={() => {
                    const arr = [...section.images];
                    arr.splice(i, 1);
                    onChange({ images: arr });
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <ImageUploader
            value={null}
            onChange={(url) => {
              if (url) onChange({ images: [...section.images, url] });
            }}
            folder="info-links"
          />
        </div>
      )}
      {section.type === 'divider' && (
        <div className="border-t border-line my-2" />
      )}
      {(section.type === 'embed_menu' ||
        section.type === 'embed_promotions' ||
        section.type === 'embed_card') && (
        <div className="text-xs text-mute italic">
          Se renderizará automáticamente en la página pública con datos de tu negocio.
        </div>
      )}
    </div>
  );
}

// =====================================================
// Preview público (mismo render que /i/[slug]/[linkSlug])
// =====================================================
function PublicLinkPreview({
  link,
  tenant,
  primary,
}: {
  link: InfoLink;
  tenant: any;
  primary: string;
}) {
  return (
    <div className="text-ink" style={{ ['--primary' as any]: primary }}>
      {link.heroImageUrl ? (
        <img src={link.heroImageUrl} alt="" className="w-full h-32 object-cover" />
      ) : (
        <div
          className="w-full h-20"
          style={{ background: `linear-gradient(135deg, ${primary}, #C026D3)` }}
        />
      )}
      <div className="px-4 py-3">
        <h1 className="text-xl font-bold leading-tight">{link.title}</h1>
        {link.subtitle && (
          <p className="text-sm text-mute mt-1">{link.subtitle}</p>
        )}

        {/* Botones */}
        {link.buttons.length > 0 && (
          <div className="space-y-2 mt-4">
            {link.buttons.map((b, i) => (
              <div
                key={i}
                className="block w-full py-2.5 rounded-full text-center text-sm font-medium"
                style={{
                  background: b.style === 'secondary' ? '#fff' : primary,
                  color: b.style === 'secondary' ? primary : '#fff',
                  border: `1px solid ${primary}`,
                }}
              >
                {b.label}
              </div>
            ))}
          </div>
        )}

        {/* Bloques */}
        <div className="mt-4 space-y-3">
          {link.sections.map((s, i) => {
            if (s.type === 'heading')
              return (
                <h2 key={i} className="font-bold text-base">
                  {s.text}
                </h2>
              );
            if (s.type === 'paragraph')
              return (
                <p key={i} className="text-xs text-ink/80 leading-relaxed">
                  {s.text}
                </p>
              );
            if (s.type === 'image' && s.url)
              return (
                <img key={i} src={s.url} alt="" className="w-full rounded-lg" />
              );
            if (s.type === 'gallery')
              return (
                <div key={i} className="grid grid-cols-3 gap-1">
                  {s.images.map((url, j) => (
                    <img
                      key={j}
                      src={url}
                      alt=""
                      className="w-full h-14 object-cover rounded"
                    />
                  ))}
                </div>
              );
            if (s.type === 'divider')
              return <div key={i} className="border-t border-line my-2" />;
            if (s.type === 'embed_menu')
              return (
                <div
                  key={i}
                  className="border border-line2 rounded-lg p-2 text-[10px] text-mute italic text-center"
                >
                  📋 Aquí va el menú embebido
                </div>
              );
            if (s.type === 'embed_promotions')
              return (
                <div
                  key={i}
                  className="border border-line2 rounded-lg p-2 text-[10px] text-mute italic text-center"
                >
                  🎁 Aquí van las promociones activas
                </div>
              );
            if (s.type === 'embed_card')
              return (
                <div
                  key={i}
                  className="border border-line2 rounded-lg p-2 text-[10px] text-mute italic text-center"
                >
                  💳 Aquí va la tarjeta de fidelización
                </div>
              );
            return null;
          })}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-line text-center text-[10px] text-mute">
          Desarrollado por{' '}
          <span className="font-semibold text-brand">Clubify</span>
        </div>
      </div>
    </div>
  );
}
