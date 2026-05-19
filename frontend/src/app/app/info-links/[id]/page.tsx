'use client';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import {
  INFO_LINK_TEMPLATES,
  resolveTemplate,
  type InfoLinkTemplate,
} from '@/lib/info-link-templates';
import { SectionCoverEditor } from '@/components/menu/SectionCoverEditor';
import { SectionCoverPreview } from '@/components/menu/SectionCoverPreview';
import { uploadCoverImage } from '@/lib/menu/upload-cover-image';
import type { SectionCoverConfig } from '@/lib/menu/section-cover-config';
import { SortableList, DragHandle } from '@/components/Sortable';
import {
  DEFAULT_LOGO_CONTAINER,
  LOGO_CONTAINER_PRESETS,
  getLogoContainerProps,
  getLogoImgStyle,
  type LogoContainerConfig,
  type LogoContainerPresetId,
} from '@/lib/info-link-logo-container';
import {
  DEFAULT_BANNER_CONFIG,
  BANNER_PRESETS,
  getBannerBackgroundStyle,
  getBannerOverlayBackground,
  type BannerConfig,
  type BannerPresetId,
  type BannerPosition,
} from '@/lib/info-link-banner';
import { FULL_LOOKS, type FullLookId } from '@/lib/info-link-full-looks';
import {
  DEFAULT_POPUP_CONFIG,
  POPUP_TEMPLATES,
  popupMaxWidthPx,
  popupShadowCss,
  type PopupConfig,
  type PopupTemplateId,
} from '@/lib/info-link-popup';

/** Devuelve true si el botón está renderizado como cover, false si simple.
 *  Si renderAs no está, se deriva de !!cover (compat botones viejos). */
function isCoverMode(b: { renderAs?: 'simple' | 'cover'; cover?: any }) {
  if (b.renderAs) return b.renderAs === 'cover';
  return !!b.cover;
}

/** Asegura un _id estable por botón. Si falta, lo genera. */
function ensureButtonId<B extends { _id?: string }>(b: B): B & { _id: string } {
  if (b._id) return b as B & { _id: string };
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `b_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return { ...(b as object), _id: id } as B & { _id: string };
}

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
  /** Id estable para drag&drop sortable. Se autogenera si falta. */
  _id?: string;
  label: string;
  type:
    | 'WHATSAPP'
    | 'INSTAGRAM'
    | 'MAPS'
    | 'MENU'
    | 'CARD'
    | 'PROMO'
    | 'EXTERNAL'
    | 'POPUP';
  url?: string;
  // Campos específicos por tipo
  // INSTAGRAM: handle del usuario sin '@', se construye https://instagram.com/<handle>
  igHandle?: string;
  // WHATSAPP: número + mensaje pre-rellenado, se construye wa.me link
  waPhone?: string;
  waMessage?: string;
  // MAPS: locationId opcional — si null, usa el primer location del tenant
  locationId?: string | null;
  style?: 'primary' | 'secondary';
  // Estilo de fondo del botón cuando renderAs = 'simple'. Default 'solid'
  // para botones nuevos; en botones viejos se deriva de `style`
  // (primary→solid, secondary→outline) cuando ausente.
  bgStyle?: 'solid' | 'transparent' | 'outline';
  // Estilo visual del botón. 'simple' (pill clásico) o 'cover' (card
  // visual tipo portada de sección de menú). Si está ausente, se
  // deriva de `!!cover` para compat con botones viejos.
  renderAs?: 'simple' | 'cover';
  // Diseño visual cuando renderAs = 'cover'. Cuando renderAs = 'simple'
  // se ignora pero se preserva por si el dueño vuelve a 'cover'.
  cover?: SectionCoverConfig | null;
  // Subtítulo que aparece debajo del título en la portada visual.
  // Solo se usa cuando renderAs = 'cover'.
  tagline?: string | null;
  // Si false, no se renderiza en la página pública (sin borrarlo).
  // Default true.
  isActive?: boolean;
  // Cuando type='POPUP', al hacer click el botón abre un modal con este
  // contenido en lugar de navegar.
  popup?: PopupConfig | null;
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
  theme: {
    primaryColor?: string;
    template?: InfoLinkTemplate;
    logoContainer?: LogoContainerConfig | null;
    bannerConfig?: BannerConfig | null;
    /** Familia tipográfica aplicada al shell completo. Si null, usa el
     *  default del template. */
    fontFamily?: string | null;
  };
  isActive: boolean;
  views: number;
};

const BUTTON_TYPE_LABEL: Record<string, string> = {
  WHATSAPP: '💬 WhatsApp',
  INSTAGRAM: '📷 Instagram',
  MAPS: '📍 Cómo llegar',
  MENU: '🍽 Ver menú',
  PROMO: '🎁 Promociones',
  EXTERNAL: '🔗 Link externo',
  POPUP: '💬 Popup informativo',
};

export default function InfoLinkEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [link, setLink] = useState<InfoLink | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  // Índice del botón al que se le está editando el cover en modal.
  // null = modal cerrado.
  const [coverEditingIdx, setCoverEditingIdx] = useState<number | null>(null);

  async function load() {
    const l = await api<InfoLink>(`/info-links/${id}`);
    // Garantiza _id por botón al primer load para drag&drop.
    setLink({ ...l, buttons: l.buttons.map(ensureButtonId) });
    setTenant(await api('/tenants/me'));
    setStats(await api(`/info-links/${id}/stats`).catch(() => null));
    setLocations(
      await api<Array<{ id: string; name: string }>>('/locations').catch(() => []),
    );
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
    const fresh: Button = {
      label: 'Botón nuevo',
      type: 'EXTERNAL',
      url: 'https://',
      style: 'primary',
      bgStyle: 'solid',
      renderAs: 'simple',
      isActive: true,
    };
    update('buttons', [...link.buttons, ensureButtonId(fresh)]);
  }

  function updateButton(i: number, patch: Partial<Button>) {
    if (!link) return;
    const arr = [...link.buttons];
    arr[i] = { ...arr[i], ...patch };
    update('buttons', arr);
  }

  function removeButton(i: number) {
    if (!link) return;
    if (!confirm('¿Eliminar este botón?')) return;
    const arr = [...link.buttons];
    arr.splice(i, 1);
    update('buttons', arr);
  }

  function duplicateButton(i: number) {
    if (!link) return;
    const src = link.buttons[i];
    if (!src) return;
    const copy = ensureButtonId({
      ...src,
      _id: undefined,
      label: `${src.label} (copia)`,
    });
    const arr = [...link.buttons];
    arr.splice(i + 1, 0, copy);
    update('buttons', arr);
  }

  function reorderButtons(next: Button[]) {
    update('buttons', next);
  }

  function setButtonRenderAs(i: number, mode: 'simple' | 'cover') {
    if (!link) return;
    const b = link.buttons[i];
    if (!b) return;
    // Al pasar a 'cover' por primera vez, abrimos el modal para que el
    // dueño suba imagen y elija template. Si ya tenía cover, no abrimos
    // — solo cambiamos el modo.
    updateButton(i, { renderAs: mode });
    if (mode === 'cover' && !b.cover) {
      setCoverEditingIdx(i);
    }
  }

  if (!link || !tenant) return <div className="text-mute">Cargando…</div>;

  const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${tenant.slug}/${link.slug}`;
  const primary = link.theme?.primaryColor ?? tenant.primaryColor ?? '#22C55E';

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
            href="/preview/info-links"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs"
            title="Ver los 5 estilos disponibles para tu InfoLink"
          >
            🎨 Ver 5 estilos
          </a>
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
          {/* Estilo */}
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold m-0">Estilo de la página</h3>
              <a
                href="/preview/info-links"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand hover:underline"
              >
                Ver los 5 estilos →
              </a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {INFO_LINK_TEMPLATES.map((opt) => {
                const active = resolveTemplate(link.theme) === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      update('theme', { ...link.theme, template: opt.id })
                    }
                    className={`text-left rounded-input border-2 p-2.5 transition ${
                      active
                        ? 'border-brand bg-brand-soft'
                        : 'border-line bg-white hover:border-brand/40'
                    }`}
                    title={opt.hint}
                  >
                    <div className="text-xl mb-1">{opt.emoji}</div>
                    <div className="font-semibold text-sm">{opt.name}</div>
                    <div className="text-[10px] text-mute mt-0.5 leading-snug">
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

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

          {/* Personalización visual — looks completos + paneles fine */}
          <VisualSection
            theme={link.theme}
            primary={primary}
            tenantLogoUrl={tenant?.logoUrl ?? null}
            heroImageUrl={link.heroImageUrl}
            onChange={(patch) => update('theme', { ...link.theme, ...patch })}
          />

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

            {link.buttons.length === 0 && (
              <div className="text-mute text-sm text-center py-4">
                Sin botones. Agrega CTAs como WhatsApp, Maps, Menú embed.
              </div>
            )}
            <SortableList<Button & { id: string }>
              items={link.buttons.map((b) => ({ ...ensureButtonId(b), id: b._id! }))}
              onReorder={(next) => reorderButtons(next.map(({ id, ...rest }) => rest))}
              className="space-y-2"
            >
              {(item, ctx) => {
                const i = link.buttons.findIndex((b) => b._id === item._id);
                if (i < 0) return null;
                const b = link.buttons[i];
                const coverMode = isCoverMode(b);
                const active = b.isActive !== false;
                return (
                <div
                  className={`border border-line2 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-[auto_1fr_140px_auto] gap-2 transition ${
                    active ? '' : 'opacity-50 bg-bg2/30'
                  }`}
                >
                  {/* Barra superior: drag handle + segmented Simple/Visual
                      + active toggle + duplicar. Estilo segmented inspirado
                      en el editor de secciones del menú. */}
                  <div className="col-span-full flex items-center gap-2 flex-wrap">
                    <DragHandle {...ctx.dragHandleProps} />
                    <div className="inline-flex rounded-pill bg-bg2 p-0.5 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setButtonRenderAs(i, 'simple')}
                        className={`px-3 py-1.5 rounded-pill transition ${
                          coverMode
                            ? 'text-mute hover:text-ink'
                            : 'bg-white text-ink shadow-sm'
                        }`}
                      >
                        Botón simple
                      </button>
                      <button
                        type="button"
                        onClick={() => setButtonRenderAs(i, 'cover')}
                        className={`px-3 py-1.5 rounded-pill transition ${
                          coverMode
                            ? 'bg-white text-ink shadow-sm'
                            : 'text-mute hover:text-ink'
                        }`}
                      >
                        ✨ Visual / portada
                      </button>
                    </div>
                    <div className="flex-1" />
                    <label className="flex items-center gap-1.5 text-[11px] text-mute cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) =>
                          updateButton(i, { isActive: e.target.checked })
                        }
                      />
                      {active ? 'Activo' : 'Pausado'}
                    </label>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => duplicateButton(i)}
                      title="Duplicar este botón"
                    >
                      ⎘ Duplicar
                    </button>
                  </div>

                  {/* Reservamos la primera celda de la grid principal con
                      un spacer para que el drag handle ya colocado en la
                      barra superior no se duplique. */}
                  <div className="hidden sm:block" />
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

                  {/* Cuando renderAs = 'cover': fila con preview + CTA edit
                      + input rápido de subtítulo. Si no tiene cover guardado
                      aún, mostramos CTA para abrir el editor (se autoabre
                      al cambiar a 'Visual'). */}
                  {coverMode && (
                    <div className="col-span-full border-t border-line2 pt-3 space-y-2">
                      <div className="flex items-center gap-3">
                        {b.cover ? (
                          <button
                            type="button"
                            className="flex-shrink-0 rounded-lg overflow-hidden border border-line hover:border-brand transition w-28"
                            onClick={() => setCoverEditingIdx(i)}
                            title="Editar diseño de la portada"
                          >
                            <SectionCoverPreview
                              config={b.cover}
                              title={b.label || ''}
                              tagline={b.tagline || null}
                              scale={112 / 360}
                            />
                          </button>
                        ) : (
                          <div className="w-28 h-20 rounded-lg border-2 border-dashed border-line flex items-center justify-center text-mute text-xs">
                            sin portada
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <input
                            className="input text-sm"
                            placeholder="Subtítulo (ej: De especialidad)"
                            value={b.tagline ?? ''}
                            onChange={(e) =>
                              updateButton(i, {
                                tagline: e.target.value || null,
                              })
                            }
                            maxLength={200}
                          />
                          <div className="text-[11px] text-mute mt-1">
                            Aparece debajo del título en la portada.
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => setCoverEditingIdx(i)}
                        >
                          🎨 Diseñar portada
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Picker de estilo del botón (solid/transparent/outline).
                      Solo aplica cuando renderAs = 'simple'. En cover, el
                      estilo lo decide el editor de portada. */}
                  {!coverMode && (
                    <div className="col-span-full flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                        Estilo
                      </span>
                      <div className="inline-flex rounded-pill bg-bg2 p-0.5 text-[11px] font-semibold">
                        {(['solid', 'transparent', 'outline'] as const).map((opt) => {
                          const current = (b.bgStyle ?? 'solid') === opt;
                          const label =
                            opt === 'solid'
                              ? '● Sólido'
                              : opt === 'transparent'
                              ? '○ Transparente'
                              : '▢ Solo borde';
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateButton(i, { bgStyle: opt })}
                              className={`px-2.5 py-1 rounded-pill transition ${
                                current
                                  ? 'bg-white text-ink shadow-sm'
                                  : 'text-mute hover:text-ink'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {b.type === 'EXTERNAL' && (
                    <input
                      className="input col-span-full"
                      placeholder="https://..."
                      value={b.url ?? ''}
                      onChange={(e) => updateButton(i, { url: e.target.value })}
                    />
                  )}
                  {b.type === 'INSTAGRAM' && (
                    <div className="col-span-full">
                      <div className="flex gap-2 items-center">
                        <span className="text-mute text-sm font-semibold">@</span>
                        <input
                          className="input flex-1"
                          placeholder="nudocowork"
                          value={b.igHandle ?? ''}
                          onChange={(e) =>
                            updateButton(i, {
                              igHandle: e.target.value
                                .replace(/^@/, '')
                                .trim(),
                            })
                          }
                        />
                      </div>
                      <div className="text-[11px] text-mute mt-1">
                        Solo el usuario, sin URL completa. Abre instagram.com/<b>{b.igHandle || 'usuario'}</b>
                      </div>
                    </div>
                  )}
                  {b.type === 'WHATSAPP' && (
                    <div className="col-span-full grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
                      <input
                        className="input"
                        placeholder="+57 300 000 0000"
                        value={b.waPhone ?? ''}
                        onChange={(e) => updateButton(i, { waPhone: e.target.value })}
                      />
                      <input
                        className="input"
                        placeholder="Hola, quiero más información"
                        value={b.waMessage ?? ''}
                        onChange={(e) => updateButton(i, { waMessage: e.target.value })}
                      />
                    </div>
                  )}
                  {b.type === 'MAPS' && (
                    <div className="col-span-full">
                      {locations.length === 0 ? (
                        <div className="text-[11px] text-mute p-2 bg-bg2/50 rounded">
                          No tienes ubicaciones registradas.{' '}
                          <a href="/app/locations" className="text-brand underline">
                            Crear una en Ubicaciones →
                          </a>
                        </div>
                      ) : (
                        <select
                          className="input"
                          value={b.locationId ?? ''}
                          onChange={(e) =>
                            updateButton(i, {
                              locationId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">Primera ubicación (default)</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {b.type === 'POPUP' && (
                    <div className="col-span-full border-t border-line2 pt-3">
                      <PopupEditor
                        value={b.popup ?? null}
                        primary={primary}
                        onChange={(next) => updateButton(i, { popup: next })}
                      />
                    </div>
                  )}
                </div>
                );
              }}
            </SortableList>
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

      {/* Modal editor de cover por botón. Reutiliza SectionCoverEditor
          (el mismo del layout SECTIONS del menú) — así los botones se
          configuran con la misma UX que las secciones de menú. */}
      {coverEditingIdx !== null && link.buttons[coverEditingIdx] && (
        <CoverModal
          button={link.buttons[coverEditingIdx]}
          onClose={() => setCoverEditingIdx(null)}
          onPatch={(patch) => updateButton(coverEditingIdx, patch)}
        />
      )}
    </div>
  );
}

function CoverModal({
  button,
  onClose,
  onPatch,
}: {
  button: Button;
  onClose: () => void;
  onPatch: (patch: Partial<Button>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg w-full max-w-5xl rounded-none sm:rounded-2xl shadow-xl my-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-bg z-10 flex items-center justify-between px-5 py-3 border-b border-line">
          <div>
            <div className="text-xs text-mute">Portada del botón</div>
            <h2 className="font-semibold text-lg m-0">
              {button.label || 'Sin título'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink p-1"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">Subtítulo (tagline) — opcional</label>
            <input
              type="text"
              className="input"
              placeholder="Ej: De especialidad"
              value={button.tagline ?? ''}
              onChange={(e) => onPatch({ tagline: e.target.value || null })}
              maxLength={200}
            />
            <p className="text-[11px] text-mute mt-1">
              Aparece debajo del nombre en la portada. Vacío = sin subtítulo.
            </p>
          </div>

          <SectionCoverEditor
            title={button.label || ''}
            tagline={button.tagline || null}
            value={button.cover ?? null}
            onChange={(cover) => onPatch({ cover })}
            onUpload={uploadCoverImage}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line">
          <button
            type="button"
            onClick={() => onPatch({ cover: null })}
            className="btn-ghost text-xs"
            title="Resetea el diseño visual (mantiene el botón en modo Visual)"
          >
            Reset diseño
          </button>
          <button type="button" onClick={onClose} className="btn-primary">
            Listo
          </button>
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
  const initial = (tenant?.brandName?.[0] || 'C').toUpperCase();
  return (
    <div className="text-ink bg-white" style={{ ['--primary' as any]: primary }}>
      {/* Hero: contenedor SEPARADO del logo. overflow-hidden recorta solo
          la foto al frame del banner, no afecta al logo (siblings). */}
      <div className="relative overflow-hidden" style={{ zIndex: 1 }}>
        {link.heroImageUrl ? (
          <img
            src={link.heroImageUrl}
            alt=""
            className="w-full h-28 object-cover"
          />
        ) : (
          <div
            className="w-full h-24"
            style={{
              background: `linear-gradient(135deg, ${primary}, ${tenant?.secondaryColor || primary})`,
            }}
          />
        )}
      </div>
      {/* Logo wrapper: HERMANO del banner (no hijo), con margin negativo
          para flotar sobre el borde inferior del banner. z-index 10 lo
          mantiene encima de cualquier overlay del banner. */}
      <div
        className="flex justify-center -mt-7 relative"
        style={{ zIndex: 10 }}
      >
        {tenant?.logoUrl ? (
          <div className="w-14 h-14 rounded-full bg-white border-4 border-white shadow-md p-1 flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tenant.logoUrl}
              alt=""
              className="max-w-full max-h-full w-auto h-auto object-contain block"
            />
          </div>
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg border-4 border-white shadow-md"
            style={{ background: primary }}
          >
            {initial}
          </div>
        )}
      </div>

      <div className="px-4 pt-3 pb-4 text-center">
        <h1 className="text-base font-bold leading-tight">{link.title}</h1>
        {link.subtitle && (
          <p className="text-[11px] text-mute mt-1 leading-snug">{link.subtitle}</p>
        )}

        {/* Botones tipo Linktree (o cards estilo "sección" si renderAs=cover).
            Los pausados (isActive === false) no aparecen en la preview, igual
            que en el público. */}
        {link.buttons.some((b) => b.isActive !== false) && (
          <div className="space-y-2 mt-4 text-left">
            {link.buttons
              .filter((b) => b.isActive !== false)
              .map((b, i) => {
                if (isCoverMode(b) && b.cover) {
                  return (
                    <div key={i} className="rounded-xl overflow-hidden">
                      <SectionCoverPreview
                        config={b.cover}
                        title={b.label || ''}
                        tagline={b.tagline || null}
                        scale={0.45}
                      />
                    </div>
                  );
                }
                const bgStyle =
                  b.bgStyle ?? (b.style === 'secondary' ? 'outline' : 'solid');
                const style: CSSProperties = {};
                if (bgStyle === 'solid') {
                  style.background = primary;
                  style.color = '#fff';
                  style.boxShadow = `0 4px 12px ${primary}33`;
                } else if (bgStyle === 'outline') {
                  style.background = 'transparent';
                  style.color = primary;
                  style.border = `1.5px solid ${primary}`;
                } else {
                  // transparent
                  style.background = 'transparent';
                  style.color = primary;
                }
                return (
                  <div
                    key={i}
                    className="block w-full py-2.5 px-4 rounded-2xl text-center text-[13px] font-semibold transition"
                    style={style}
                  >
                    {b.label}
                  </div>
                );
              })}
          </div>
        )}

        {/* Bloques */}
        <div className="mt-4 space-y-3 text-left">
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

// =====================================================
// VisualSection — wrapper que agrupa logo + banner + tipografía + looks
// =====================================================
//
// Una sola card en el editor que cubre toda la personalización visual:
// 1. Row de "Looks completos" arriba (4 presets que bundlean logo+banner+font)
// 2. Logo container panel (preset + sliders fine)
// 3. Banner panel (preset + sliders fine)
// 4. Tipografía global
//
// Reemplaza al stack de cards sueltas — UX más cercana a Notion/Stripe
// donde toda la personalización vive bajo un mismo techo.
function VisualSection({
  theme,
  primary,
  tenantLogoUrl,
  heroImageUrl,
  onChange,
}: {
  theme: {
    logoContainer?: LogoContainerConfig | null;
    bannerConfig?: BannerConfig | null;
    fontFamily?: string | null;
  };
  primary: string;
  tenantLogoUrl: string | null;
  heroImageUrl: string | null;
  onChange: (patch: {
    logoContainer?: LogoContainerConfig | null;
    bannerConfig?: BannerConfig | null;
    fontFamily?: string | null;
  }) => void;
}) {
  function applyFullLook(id: FullLookId) {
    const look = FULL_LOOKS[id];
    onChange({
      logoContainer: { ...look.logoContainer },
      bannerConfig: { ...look.bannerConfig },
      fontFamily: look.fontFamily,
    });
  }
  function activeLookId(): FullLookId | null {
    return (theme.logoContainer?.preset ?? null) as FullLookId | null;
  }

  const FONT_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'Inter, system-ui, sans-serif', label: 'Inter (sans clean)' },
    { value: '"Playfair Display", Georgia, serif', label: 'Playfair (serif editorial)' },
    { value: '"Space Grotesk", Inter, sans-serif', label: 'Space Grotesk (tech)' },
    { value: '"Manrope", Inter, sans-serif', label: 'Manrope (moderna)' },
    { value: 'Georgia, "Times New Roman", serif', label: 'Georgia (clásica)' },
    { value: '"Poppins", Inter, sans-serif', label: 'Poppins (amigable)' },
  ];

  return (
    <div className="card card-pad space-y-6">
      <div>
        <h3 className="font-semibold m-0 mb-1">Personalización visual</h3>
        <div className="text-xs text-mute leading-relaxed">
          Elegí un "look completo" abajo para aplicar logo + banner + tipografía
          coherentes en un click, o ajustá cada sección individualmente más abajo.
        </div>
      </div>

      {/* FullLook presets — un click setea logo+banner+font juntos */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
          Looks completos
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {(Object.keys(FULL_LOOKS) as FullLookId[]).map((id) => {
            const look = FULL_LOOKS[id];
            const active = activeLookId() === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => applyFullLook(id)}
                className={`text-left rounded-lg p-3 border transition ${
                  active
                    ? 'border-brand bg-brand/5 shadow-sm'
                    : 'border-line hover:border-ink/30 hover:shadow-sm'
                }`}
              >
                <div className="font-semibold text-sm">{look.label}</div>
                <div
                  className="text-[11px] text-mute mt-0.5 leading-snug"
                  style={{ fontFamily: look.fontFamily }}
                >
                  {look.description}
                </div>
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-mute mt-2 leading-snug">
          Tip: aplicá un look y después tuneá fino abajo — los cambios sobreescriben
          las configs sin perder el resto del look.
        </div>
      </div>

      {/* Tipografía */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
          Tipografía
        </div>
        <select
          className="input"
          value={theme.fontFamily ?? ''}
          onChange={(e) =>
            onChange({ fontFamily: e.target.value || null })
          }
        >
          <option value="">Por defecto del template</option>
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
              {opt.label}
            </option>
          ))}
        </select>
        {theme.fontFamily && (
          <div
            className="mt-2 p-3 rounded-lg bg-bg2 text-ink"
            style={{ fontFamily: theme.fontFamily }}
          >
            <div className="text-lg font-bold">Tu negocio</div>
            <div className="text-sm">Así se ve un título con esta fuente.</div>
          </div>
        )}
      </div>

      {/* Logo container — preset cards + sliders */}
      <div className="border-t border-line pt-5">
        <LogoContainerPanel
          value={theme.logoContainer ?? null}
          primary={primary}
          tenantLogoUrl={tenantLogoUrl}
          onChange={(next) => onChange({ logoContainer: next })}
        />
      </div>

      {/* Banner */}
      <div className="border-t border-line pt-5">
        <BannerPanel
          value={theme.bannerConfig ?? null}
          heroImageUrl={heroImageUrl}
          onChange={(next) => onChange({ bannerConfig: next })}
        />
      </div>
    </div>
  );
}

// =====================================================
// LogoContainerPanel — preset picker + sliders + preview
// =====================================================
//
// Panel para customizar el contenedor del logo del InfoLink. 4 presets
// rápidos (minimalista/premium/dark/glassmorphism) + sliders fine para
// padding, radius, tamaño, sombra. Vista previa en vivo sobre fondo
// neutro (no replica todo el shell — eso lo cubre la vista pública).
function LogoContainerPanel({
  value,
  primary,
  tenantLogoUrl,
  onChange,
}: {
  value: LogoContainerConfig | null;
  primary: string;
  tenantLogoUrl: string | null;
  onChange: (next: LogoContainerConfig | null) => void;
}) {
  const enabled = value !== null;
  const cfg = value ?? DEFAULT_LOGO_CONTAINER;

  function patch(p: Partial<LogoContainerConfig>) {
    onChange({ ...cfg, ...p, preset: null });
  }
  function applyPreset(id: LogoContainerPresetId) {
    onChange({ ...LOGO_CONTAINER_PRESETS[id].config });
  }

  const containerProps = getLogoContainerProps(cfg, primary);
  const imgStyle = getLogoImgStyle(cfg);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold m-0 text-sm">Estilo del logo</h3>
        <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChange(e.target.checked ? { ...DEFAULT_LOGO_CONTAINER } : null)
            }
          />
          Personalizar
        </label>
      </div>

      {!enabled && (
        <div className="text-xs text-mute leading-relaxed">
          Sin personalizar — el contenedor del logo usa el estilo del
          template activo. Activá la opción de arriba para elegir un look
          o ajustarlo fino.
        </div>
      )}

      {enabled && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-5">
          <div className="space-y-4">
            {/* Presets */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Presets
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  Object.keys(LOGO_CONTAINER_PRESETS) as LogoContainerPresetId[]
                ).map((id) => {
                  const p = LOGO_CONTAINER_PRESETS[id];
                  const active = cfg.preset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyPreset(id)}
                      className={`text-left rounded-lg p-3 border transition ${
                        active
                          ? 'border-brand bg-brand/5'
                          : 'border-line hover:border-ink/30'
                      }`}
                    >
                      <div className="font-semibold text-sm">{p.label}</div>
                      <div className="text-[11px] text-mute mt-0.5 leading-snug">
                        {p.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Forma del contenedor */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Forma
              </div>
              <div className="inline-flex rounded-pill bg-bg2 p-0.5 text-xs font-semibold">
                {(['circle', 'rounded'] as const).map((s) => {
                  const current = (cfg.shape ?? 'circle') === s;
                  const label = s === 'circle' ? '⚪ Círculo' : '▢ Cuadrado redondeado';
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => patch({ shape: s })}
                      className={`px-3 py-1.5 rounded-pill transition ${
                        current
                          ? 'bg-white text-ink shadow-sm'
                          : 'text-mute hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sliders */}
            <div className="space-y-3">
              <SliderRow
                label={
                  (cfg.shape ?? 'circle') === 'circle'
                    ? 'Tamaño del círculo'
                    : 'Tamaño máximo (ancho)'
                }
                min={80}
                max={280}
                value={cfg.maxWidth}
                onChange={(v) => patch({ maxWidth: v })}
                unit="px"
              />
              <SliderRow
                label="Padding interno (horizontal)"
                min={0}
                max={40}
                value={cfg.paddingX}
                onChange={(v) => patch({ paddingX: v })}
                unit="px"
              />
              <SliderRow
                label="Padding interno (vertical)"
                min={0}
                max={40}
                value={cfg.paddingY}
                onChange={(v) => patch({ paddingY: v })}
                unit="px"
              />
              {(cfg.shape ?? 'circle') === 'rounded' && (
                <SliderRow
                  label="Radio del borde"
                  min={0}
                  max={40}
                  value={cfg.borderRadius}
                  onChange={(v) => patch({ borderRadius: v })}
                  unit="px"
                />
              )}
              <SliderRow
                label="Opacidad del fondo"
                min={0}
                max={100}
                value={Math.round(cfg.bgOpacity * 100)}
                onChange={(v) => patch({ bgOpacity: v / 100 })}
                unit="%"
              />
              <SliderRow
                label="Blur del fondo (glassmorphism)"
                min={0}
                max={30}
                value={cfg.backdropBlur}
                onChange={(v) => patch({ backdropBlur: v })}
                unit="px"
              />
              <SliderRow
                label="Grosor del anillo"
                min={0}
                max={8}
                value={cfg.ringWidth}
                onChange={(v) => patch({ ringWidth: v })}
                unit="px"
              />
            </div>

            {/* Color de fondo + sombra */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Color de fondo</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={cfg.bgColor}
                  onChange={(e) => patch({ bgColor: e.target.value })}
                />
              </div>
              <div>
                <label className="label text-xs">Sombra</label>
                <select
                  className="input"
                  value={cfg.shadow}
                  onChange={(e) =>
                    patch({ shadow: e.target.value as LogoContainerConfig['shadow'] })
                  }
                >
                  <option value="none">Ninguna</option>
                  <option value="sm">Suave</option>
                  <option value="md">Media</option>
                  <option value="lg">Grande</option>
                  <option value="xl">Premium (XL)</option>
                  <option value="glow">Glow neón (color marca)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="lg:sticky lg:top-4">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2 text-center">
              Vista previa
            </div>
            <div
              className="rounded-xl flex items-center justify-center min-h-[180px] p-6"
              style={{
                background:
                  cfg.preset === 'dark' || cfg.preset === 'glassmorphism'
                    ? `linear-gradient(135deg, ${primary}40, #1a1a2e)`
                    : '#F3F4F6',
              }}
            >
              {tenantLogoUrl ? (
                <div className={containerProps.className} style={containerProps.style}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tenantLogoUrl} alt="logo" style={imgStyle} />
                </div>
              ) : (
                <div className="text-xs text-mute italic">
                  Subí un logo en Configuración → Marca para ver el preview
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  value,
  onChange,
  unit,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  unit: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-mute">{label}</span>
        <span className="font-mono text-ink">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  );
}

// =====================================================
// BannerPanel — overlay, posición, zoom, blur del hero image
// =====================================================
//
// Aplica al template SHOP (único shell que renderea heroImageUrl hoy).
// Si bannerConfig=null, el hero se renderea con el overlay negro 15%
// histórico (legible pero sin tunear). Activá "Personalizar" para
// elegir preset o tunear fino.
function BannerPanel({
  value,
  heroImageUrl,
  onChange,
}: {
  value: BannerConfig | null;
  heroImageUrl: string | null;
  onChange: (next: BannerConfig | null) => void;
}) {
  const enabled = value !== null;
  const cfg = value ?? DEFAULT_BANNER_CONFIG;

  function patch(p: Partial<BannerConfig>) {
    onChange({ ...cfg, ...p, preset: null });
  }
  function patchOverlay(p: Partial<BannerConfig['overlay']>) {
    onChange({ ...cfg, overlay: { ...cfg.overlay, ...p }, preset: null });
  }
  function applyPreset(id: BannerPresetId) {
    onChange({ ...BANNER_PRESETS[id].config });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold m-0 text-sm">Banner (foto de portada)</h3>
        <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChange(e.target.checked ? { ...DEFAULT_BANNER_CONFIG } : null)
            }
          />
          Personalizar
        </label>
      </div>

      {!heroImageUrl && (
        <div className="text-xs text-mute italic mb-3">
          Subí una imagen de portada arriba para ver el preview.
        </div>
      )}

      {!enabled && (
        <div className="text-xs text-mute leading-relaxed">
          Sin personalizar — el banner muestra la foto con un overlay
          oscuro suave para que el contenido encima quede legible. Activá
          arriba para tunear overlay, posición, zoom o blur.
        </div>
      )}

      {enabled && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5">
          <div className="space-y-4">
            {/* Presets */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Presets
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(BANNER_PRESETS) as BannerPresetId[]).map((id) => {
                  const p = BANNER_PRESETS[id];
                  const active = cfg.preset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyPreset(id)}
                      className={`text-left rounded-lg p-3 border transition ${
                        active
                          ? 'border-brand bg-brand/5'
                          : 'border-line hover:border-ink/30'
                      }`}
                    >
                      <div className="font-semibold text-sm">{p.label}</div>
                      <div className="text-[11px] text-mute mt-0.5 leading-snug">
                        {p.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Posición */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Posición</label>
                <select
                  className="input"
                  value={cfg.position}
                  onChange={(e) =>
                    patch({ position: e.target.value as BannerPosition })
                  }
                >
                  <option value="center">Centro</option>
                  <option value="top">Arriba</option>
                  <option value="bottom">Abajo</option>
                  <option value="left">Izquierda</option>
                  <option value="right">Derecha</option>
                  <option value="custom">Personalizada (X/Y)</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">Overlay</label>
                <select
                  className="input"
                  value={cfg.overlay.type}
                  onChange={(e) =>
                    patchOverlay({
                      type: e.target.value as BannerConfig['overlay']['type'],
                    })
                  }
                >
                  <option value="none">Sin overlay</option>
                  <option value="solid">Color sólido</option>
                  <option value="gradient">Gradiente</option>
                </select>
              </div>
            </div>

            {cfg.position === 'custom' && (
              <div className="space-y-3">
                <SliderRow
                  label="Posición X (offset horizontal)"
                  min={-50}
                  max={50}
                  value={cfg.offsetX}
                  onChange={(v) => patch({ offsetX: v })}
                  unit="%"
                />
                <SliderRow
                  label="Posición Y (offset vertical)"
                  min={-50}
                  max={50}
                  value={cfg.offsetY}
                  onChange={(v) => patch({ offsetY: v })}
                  unit="%"
                />
              </div>
            )}

            <div className="space-y-3">
              <SliderRow
                label="Zoom"
                min={100}
                max={300}
                value={Math.round(cfg.scale * 100)}
                onChange={(v) => patch({ scale: v / 100 })}
                unit="%"
              />
              <SliderRow
                label="Blur"
                min={0}
                max={20}
                value={cfg.blur}
                onChange={(v) => patch({ blur: v })}
                unit="px"
              />
            </div>

            {/* Overlay controls */}
            {cfg.overlay.type === 'solid' && (
              <div className="grid grid-cols-[120px_1fr] gap-3 items-end">
                <div>
                  <label className="label text-xs">Color overlay</label>
                  <input
                    type="color"
                    className="input h-11 p-1"
                    value={cfg.overlay.color}
                    onChange={(e) => patchOverlay({ color: e.target.value })}
                  />
                </div>
                <SliderRow
                  label="Opacidad overlay"
                  min={0}
                  max={100}
                  value={Math.round(cfg.overlay.opacity * 100)}
                  onChange={(v) => patchOverlay({ opacity: v / 100 })}
                  unit="%"
                />
              </div>
            )}

            {cfg.overlay.type === 'gradient' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">From</label>
                    <input
                      type="text"
                      className="input text-xs"
                      placeholder="rgba(0,0,0,0)"
                      value={cfg.overlay.gradientFrom}
                      onChange={(e) =>
                        patchOverlay({ gradientFrom: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label text-xs">To</label>
                    <input
                      type="text"
                      className="input text-xs"
                      placeholder="rgba(0,0,0,0.7)"
                      value={cfg.overlay.gradientTo}
                      onChange={(e) =>
                        patchOverlay({ gradientTo: e.target.value })
                      }
                    />
                  </div>
                </div>
                <SliderRow
                  label="Ángulo gradient"
                  min={0}
                  max={360}
                  value={cfg.overlay.gradientAngle}
                  onChange={(v) => patchOverlay({ gradientAngle: v })}
                  unit="°"
                />
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="lg:sticky lg:top-4">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2 text-center">
              Vista previa
            </div>
            <div className="relative h-40 rounded-xl overflow-hidden border border-line">
              {heroImageUrl ? (
                <>
                  <div
                    className="absolute inset-0"
                    style={getBannerBackgroundStyle(
                      heroImageUrl,
                      cfg,
                      'linear-gradient(135deg, #999, #ccc)',
                    )}
                  />
                  {cfg.overlay.type !== 'none' && (
                    <div
                      className="absolute inset-0"
                      style={{ background: getBannerOverlayBackground(cfg) }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-mute italic bg-bg2">
                  Subí una imagen primero
                </div>
              )}
            </div>
            <div className="text-[10px] text-mute mt-2 text-center leading-snug">
              El contenido (logo, título, botones) va encima — ajustá
              overlay para que se lea bien.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// PopupEditor — config del popup que abre el botón type='POPUP'
// =====================================================
function PopupEditor({
  value,
  primary,
  onChange,
}: {
  value: PopupConfig | null;
  primary: string;
  onChange: (next: PopupConfig) => void;
}) {
  const cfg = value ?? DEFAULT_POPUP_CONFIG;
  function patch(p: Partial<PopupConfig>) {
    onChange({ ...cfg, ...p });
  }
  function applyTemplate(id: PopupTemplateId) {
    onChange({ ...POPUP_TEMPLATES[id].config });
  }
  const ctaColor = cfg.ctaColor || primary;

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        Contenido del popup
      </div>

      <div>
        <div className="text-xs text-mute mb-1.5">
          Plantillas rápidas (clic para precargar)
        </div>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(POPUP_TEMPLATES) as PopupTemplateId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => applyTemplate(id)}
              className="text-xs px-2.5 py-1.5 rounded-md border border-line hover:border-ink/30 hover:bg-bg2 transition"
            >
              {POPUP_TEMPLATES[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5">
        <div className="space-y-3">
          <div>
            <label className="label text-xs">Título</label>
            <input
              className="input"
              value={cfg.title}
              onChange={(e) => patch({ title: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <label className="label text-xs">Descripción</label>
            <textarea
              className="input"
              rows={4}
              value={cfg.description}
              onChange={(e) => patch({ description: e.target.value })}
              maxLength={500}
              placeholder="Texto del popup. Saltos de línea respetados."
            />
          </div>
          <div>
            <label className="label text-xs">Imagen (opcional)</label>
            <ImageUploader
              value={cfg.imageUrl}
              onChange={(url) => patch({ imageUrl: url })}
              folder="info-links"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Texto del botón (opcional)</label>
              <input
                className="input"
                value={cfg.ctaText}
                onChange={(e) => patch({ ctaText: e.target.value })}
                placeholder="Ej: Reservar ahora"
                maxLength={40}
              />
            </div>
            <div>
              <label className="label text-xs">Link del botón</label>
              <input
                className="input"
                value={cfg.ctaUrl}
                onChange={(e) => patch({ ctaUrl: e.target.value })}
                placeholder="https://wa.me/... o https://..."
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label text-xs">Fondo</label>
              <input
                type="color"
                className="input h-10 p-1"
                value={cfg.bgColor}
                onChange={(e) => patch({ bgColor: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Texto</label>
              <input
                type="color"
                className="input h-10 p-1"
                value={cfg.textColor}
                onChange={(e) => patch({ textColor: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Botón</label>
              <input
                type="color"
                className="input h-10 p-1"
                value={cfg.ctaColor || primary}
                onChange={(e) => patch({ ctaColor: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Tamaño</label>
              <select
                className="input"
                value={cfg.size}
                onChange={(e) =>
                  patch({ size: e.target.value as PopupConfig['size'] })
                }
              >
                <option value="sm">Chico (320px)</option>
                <option value="md">Medio (440px)</option>
                <option value="lg">Grande (560px)</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Sombra</label>
              <select
                className="input"
                value={cfg.shadow}
                onChange={(e) =>
                  patch({ shadow: e.target.value as PopupConfig['shadow'] })
                }
              >
                <option value="none">Ninguna</option>
                <option value="sm">Suave</option>
                <option value="md">Media</option>
                <option value="lg">Grande</option>
                <option value="xl">Premium (XL)</option>
              </select>
            </div>
          </div>
          <SliderRow
            label="Bordes redondeados"
            min={0}
            max={40}
            value={cfg.borderRadius}
            onChange={(v) => patch({ borderRadius: v })}
            unit="px"
          />
          <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.closeOnOutside}
              onChange={(e) => patch({ closeOnOutside: e.target.checked })}
            />
            Permitir cerrar tocando fuera del popup
          </label>
        </div>

        {/* Preview mini */}
        <div className="lg:sticky lg:top-4">
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2 text-center">
            Vista previa
          </div>
          <div
            className="rounded-xl p-4 bg-ink/80 flex items-center justify-center"
            style={{ minHeight: 200 }}
          >
            <div
              style={{
                background: cfg.bgColor,
                color: cfg.textColor,
                borderRadius: `${cfg.borderRadius}px`,
                boxShadow: popupShadowCss(cfg.shadow),
                width: '100%',
                maxWidth: `${Math.min(220, popupMaxWidthPx(cfg.size))}px`,
              }}
            >
              {cfg.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={cfg.imageUrl}
                  alt=""
                  style={{
                    width: '100%',
                    maxHeight: 100,
                    objectFit: 'cover',
                    borderTopLeftRadius: `${cfg.borderRadius}px`,
                    borderTopRightRadius: `${cfg.borderRadius}px`,
                  }}
                />
              )}
              <div className="px-3 py-2.5">
                <div className="font-bold text-sm leading-tight">
                  {cfg.title || 'Título'}
                </div>
                {cfg.description && (
                  <div className="text-[11px] mt-1 leading-snug whitespace-pre-line opacity-90">
                    {cfg.description}
                  </div>
                )}
                {cfg.ctaText && (
                  <div
                    className="mt-2 text-center text-[11px] font-semibold py-1.5 rounded-md text-white"
                    style={{ background: ctaColor }}
                  >
                    {cfg.ctaText}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-mute mt-2 text-center leading-snug">
            Se abre al tocar el botón en el InfoLink público.
          </div>
        </div>
      </div>
    </div>
  );
}

