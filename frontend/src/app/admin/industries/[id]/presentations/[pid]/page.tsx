'use client';
/**
 * Admin: editor de slides de una presentation.
 *
 * Layout split: lista compacta de slides a la izquierda (con reorder
 * ↑↓ + acciones) + form del slide seleccionado a la derecha.
 *
 * Auto-save: cada cambio en el form se debouncea 1.5s y dispara PATCH.
 * Indicador de estado arriba del form (guardado/guardando/error).
 *
 * El render visual del slide (cómo se ve cada layout) llega en F5 con
 * el slide deck público. En F4 nos enfocamos en gestión y edición.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';

type SlideLayout =
  | 'COVER'
  | 'IMAGE_LEFT'
  | 'IMAGE_RIGHT'
  | 'FULL_IMAGE'
  | 'TEXT_ONLY'
  | 'QUOTE'
  | 'CTA'
  | 'STATS'
  | 'COMPARISON'
  | 'VIDEO';

type SlideAnimation = 'NONE' | 'FADE' | 'SLIDE_RIGHT' | 'SLIDE_UP' | 'ZOOM';

const LAYOUT_LABEL_KEY: Record<SlideLayout, string> = {
  COVER: 'layoutCover',
  IMAGE_LEFT: 'layoutImageLeft',
  IMAGE_RIGHT: 'layoutImageRight',
  FULL_IMAGE: 'layoutFullImage',
  TEXT_ONLY: 'layoutTextOnly',
  QUOTE: 'layoutQuote',
  CTA: 'layoutCta',
  STATS: 'layoutStats',
  COMPARISON: 'layoutComparison',
  VIDEO: 'layoutVideo',
};

const ANIMATION_LABEL_KEY: Record<SlideAnimation, string> = {
  NONE: 'animationNone',
  FADE: 'animationFade',
  SLIDE_RIGHT: 'animationSlideRight',
  SLIDE_UP: 'animationSlideUp',
  ZOOM: 'animationZoom',
};

type Slide = {
  id: string;
  presentationId: string;
  sortOrder: number;
  layout: SlideLayout;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  bgColor: string | null;
  textColor: string | null;
  animation: SlideAnimation;
  content: any;
};

type Presentation = {
  id: string;
  industryId: string;
  title: string;
  slug: string;
  themeColor: string | null;
  industry: { id: string; name: string; slug: string };
  slides: Slide[];
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DEBOUNCE_MS = 1500;

export default function PresentationEditorPage() {
  const t = useTranslations('admin_industries_presentations');
  const { id: industryId, pid } = useParams<{ id: string; pid: string }>();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [contentRaw, setContentRaw] = useState<string>('');
  const [contentErr, setContentErr] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  function load() {
    setLoading(true);
    api<Presentation>(`/admin/presentations/${pid}`)
      .then((p) => {
        setPresentation(p);
        const sorted = [...p.slides].sort((a, b) => a.sortOrder - b.sortOrder);
        setSlides(sorted);
        if (sorted.length > 0 && !selectedId) {
          setSelectedId(sorted[0].id);
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (pid) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const selected = useMemo(
    () => slides.find((s) => s.id === selectedId) ?? null,
    [slides, selectedId],
  );

  // Cuando el slide seleccionado cambia, refresh el contentRaw del editor JSON.
  useEffect(() => {
    if (!selected) {
      setContentRaw('');
      setContentErr(null);
      return;
    }
    setContentRaw(
      selected.content == null ? '' : JSON.stringify(selected.content, null, 2),
    );
    setContentErr(null);
  }, [selectedId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Ref espejo de `slides` para que flushSave lea SIEMPRE el state ACTUAL,
  // no del closure del render donde se agendó el setTimeout. Sin esto, el
  // patch que dispara el autosave captura `slides` del render previo (sin
  // el cambio nuevo) → el PATCH envía valores stale al backend.
  //
  // Bug histórico: el usuario subea una imagen en el editor, el thumbnail
  // se veía en el admin (porque el state local sí tenía la URL), pero el
  // backend recibía imageUrl: null. La página pública mostraba un slide
  // vacío con placeholder gris. Mismo patrón que cfgRef en QrPosterEditor.
  const slidesRef = useRef(slides);
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  /** Actualiza el slide local + agenda autosave debounced al backend. */
  function patchSelected(patch: Partial<Slide>) {
    if (!selected) return;
    setSlides((arr) =>
      arr.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)),
    );
    setSaveState('dirty');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      flushSave(selected.id);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** Persiste el cambio al server. Lee el slide ACTUAL desde slidesRef
   *  (no del closure) para que todos los patches que ocurrieron durante el
   *  debounce — incluyendo el que disparó este flush — se incluyan en el
   *  PATCH. */
  const flushSave = useCallback(async (slideId: string) => {
    const current = slidesRef.current.find((s) => s.id === slideId);
    // Si el slide se borró durante el debounce, ignoramos.
    if (!current) return;
    setSaveState('saving');
    try {
      await api(`/admin/presentations/slides/${slideId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          layout: current.layout,
          title: current.title,
          subtitle: current.subtitle,
          body: current.body,
          imageUrl: current.imageUrl,
          videoUrl: current.videoUrl,
          ctaText: current.ctaText,
          ctaUrl: current.ctaUrl,
          bgColor: current.bgColor,
          textColor: current.textColor,
          animation: current.animation,
          content: current.content,
        }),
      });
      setSaveState('saved');
    } catch (e: any) {
      setSaveState('error');
      toast(e?.message || t('errSaveSlide'), 'error');
    }
    // Sin deps — el callback lee todo desde refs y setters de React (que
    // son estables). Sin useCallback el componente lo recrea cada render
    // pero igual funciona; lo dejamos memoized para evitar re-trigger de
    // effects que dependan de su identidad.
  }, []);

  // Cleanup del timer al desmontar — sino un autosave en flight tras
  // navegar a otra ruta podría escribir contra un slide stale.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  async function addSlide() {
    try {
      const created = await api<Slide>(
        `/admin/presentations/${pid}/slides`,
        {
          method: 'POST',
          body: JSON.stringify({ layout: 'COVER' }),
        },
      );
      setSlides((arr) => [...arr, created]);
      setSelectedId(created.id);
    } catch (e: any) {
      toast(e?.message || t('errCreateSlide'), 'error');
    }
  }

  async function duplicateSlide(s: Slide) {
    try {
      const dup = await api<Slide>(
        `/admin/presentations/slides/${s.id}/duplicate`,
        { method: 'POST' },
      );
      // El backend hizo shift de los siguientes — refrescamos todo.
      await load();
      setSelectedId(dup.id);
    } catch (e: any) {
      toast(e?.message || t('errDuplicate'), 'error');
    }
  }

  async function deleteSlide(s: Slide) {
    if (!confirm(t('confirmDeleteSlide', { num: s.sortOrder + 1 }))) return;
    try {
      await api(`/admin/presentations/slides/${s.id}`, { method: 'DELETE' });
      const next = slides.filter((x) => x.id !== s.id);
      setSlides(next);
      if (selectedId === s.id) {
        setSelectedId(next[0]?.id ?? null);
      }
    } catch (e: any) {
      toast(e?.message || t('errDelete'), 'error');
    }
  }

  async function moveSlide(s: Slide, dir: 'up' | 'down') {
    const idx = slides.findIndex((x) => x.id === s.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= slides.length) return;
    const next = [...slides];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    const renumbered = next.map((x, i) => ({ ...x, sortOrder: i }));
    setSlides(renumbered);
    try {
      await api('/admin/presentations/slides/reorder', {
        method: 'PATCH',
        body: JSON.stringify({
          items: renumbered.map((x) => ({ id: x.id, sortOrder: x.sortOrder })),
        }),
      });
    } catch (e: any) {
      toast(e?.message || t('errReorder'), 'error');
      load();
    }
  }

  /** Parse del JSON content del slide. Si es válido, dispara patch.
   *  Si no, marcamos error y NO disparamos save (deja al cliente corregir). */
  function onContentChange(raw: string) {
    setContentRaw(raw);
    if (!raw.trim()) {
      setContentErr(null);
      patchSelected({ content: null });
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setContentErr(null);
      patchSelected({ content: parsed });
    } catch (e: any) {
      setContentErr(t('errInvalidJson'));
    }
  }

  if (loading) {
    return <div className="text-mute py-10 text-center">{t('loading')}</div>;
  }
  if (!presentation) {
    return (
      <div className="card card-pad text-center py-10">
        <div className="text-3xl mb-2">⚠️</div>
        <div className="font-semibold">{t('notFound')}</div>
        <Link
          href={`/admin/industries/${industryId}`}
          className="btn-primary inline-block mt-4"
        >
          {t('back')}
        </Link>
      </div>
    );
  }

  const accent = presentation.themeColor ?? '#22C55E';

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link
            href="/admin/industries"
            className="text-mute hover:text-ink"
          >
            {t('breadcrumbIndustries')}
          </Link>{' '}
          <span className="text-mute">/</span>{' '}
          <Link
            href={`/admin/industries/${industryId}`}
            className="text-mute hover:text-ink"
          >
            {presentation.industry.name}
          </Link>{' '}
          <span className="page-crumb">/ {presentation.title}</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* ───────── Sidebar: lista de slides ───────── */}
        <div className="space-y-3 lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto lg:pr-1">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                {t('slidesCount', { count: slides.length })}
              </div>
              <button
                onClick={addSlide}
                className="btn-primary text-xs px-2 py-1"
              >
                {t('addSlide')}
              </button>
            </div>
            {slides.length === 0 ? (
              <div className="text-xs text-mute py-4 text-center">
                {t('emptySlides')}
              </div>
            ) : (
              <div className="space-y-1.5">
                {slides.map((s, idx) => {
                  const isSelected = s.id === selectedId;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`p-2 rounded-lg cursor-pointer border-2 transition ${
                        isSelected
                          ? 'border-brand bg-brand-soft'
                          : 'border-line hover:border-mute bg-bg2/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded text-[10px] flex items-center justify-center font-mono font-semibold flex-none"
                          style={{ background: accent, color: '#fff' }}
                        >
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">
                            {s.title || (
                              <span className="text-mute italic">
                                {t('untitled')}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-mute truncate">
                            {t(LAYOUT_LABEL_KEY[s.layout])}
                          </div>
                        </div>
                        {s.imageUrl && (
                          <div
                            className="w-8 h-8 rounded bg-cover bg-center flex-none border border-line"
                            style={{
                              backgroundImage: `url("${s.imageUrl}")`,
                            }}
                          />
                        )}
                      </div>
                      {isSelected && (
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-line2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSlide(s, 'up');
                            }}
                            disabled={idx === 0}
                            className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5 text-xs"
                            title={t('moveUp')}
                          >
                            ↑
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              moveSlide(s, 'down');
                            }}
                            disabled={idx === slides.length - 1}
                            className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5 text-xs"
                            title={t('moveDown')}
                          >
                            ↓
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateSlide(s);
                            }}
                            className="text-mute hover:text-ink px-1.5 py-0.5 text-xs"
                            title={t('duplicate')}
                          >
                            📋
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSlide(s);
                            }}
                            className="text-bad hover:text-bad px-1.5 py-0.5 text-xs ml-auto"
                            title={t('delete')}
                          >
                            🗑
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ───────── Panel principal: editor del slide ───────── */}
        <div>
          {!selected ? (
            <div className="card card-pad text-center py-16 text-mute">
              {slides.length === 0
                ? t('emptyEditorNoSlides')
                : t('emptyEditorSelect')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="card card-pad flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                    {t('slideOf', {
                      num: slides.findIndex((s) => s.id === selected.id) + 1,
                      total: slides.length,
                    })}
                  </div>
                  <div className="font-semibold mt-0.5">
                    {selected.title || (
                      <span className="text-mute italic font-normal">
                        {t('untitled')}
                      </span>
                    )}
                  </div>
                </div>
                <SaveIndicator state={saveState} />
              </div>

              <div className="card card-pad space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('labelLayout')}</label>
                    <select
                      className="input"
                      value={selected.layout}
                      onChange={(e) =>
                        patchSelected({
                          layout: e.target.value as SlideLayout,
                        })
                      }
                    >
                      {(Object.keys(LAYOUT_LABEL_KEY) as SlideLayout[]).map(
                        (l) => (
                          <option key={l} value={l}>
                            {t(LAYOUT_LABEL_KEY[l])}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('labelAnimation')}</label>
                    <select
                      className="input"
                      value={selected.animation}
                      onChange={(e) =>
                        patchSelected({
                          animation: e.target.value as SlideAnimation,
                        })
                      }
                    >
                      {(
                        Object.keys(ANIMATION_LABEL_KEY) as SlideAnimation[]
                      ).map((a) => (
                        <option key={a} value={a}>
                          {t(ANIMATION_LABEL_KEY[a])}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">{t('labelTitle')}</label>
                  <input
                    className="input"
                    value={selected.title ?? ''}
                    onChange={(e) =>
                      patchSelected({ title: e.target.value || null })
                    }
                    maxLength={200}
                    placeholder={t('phTitle')}
                  />
                </div>

                <div>
                  <label className="label">{t('labelSubtitle')}</label>
                  <input
                    className="input"
                    value={selected.subtitle ?? ''}
                    onChange={(e) =>
                      patchSelected({ subtitle: e.target.value || null })
                    }
                    maxLength={300}
                    placeholder={t('phSubtitle')}
                  />
                </div>

                <div>
                  <label className="label">
                    {t('labelBody')}
                  </label>
                  <textarea
                    className="input"
                    rows={4}
                    value={selected.body ?? ''}
                    onChange={(e) =>
                      patchSelected({ body: e.target.value || null })
                    }
                    placeholder={t('phBody')}
                  />
                </div>
              </div>

              <div className="card card-pad space-y-3">
                <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                  {t('sectionMedia')}
                </div>
                <div>
                  <label className="label">{t('labelImage')}</label>
                  <ImageUploader
                    value={selected.imageUrl}
                    onChange={(url) => patchSelected({ imageUrl: url })}
                    folder="slides"
                    crop
                    aspect={16 / 9}
                  />
                </div>
                <div>
                  <label className="label">
                    {t('labelVideoUrl')}
                  </label>
                  <input
                    className="input"
                    value={selected.videoUrl ?? ''}
                    onChange={(e) =>
                      patchSelected({ videoUrl: e.target.value || null })
                    }
                    placeholder="https://www.youtube.com/embed/…"
                  />
                </div>
              </div>

              <div className="card card-pad space-y-3">
                <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                  {t('sectionCta')}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('labelCtaText')}</label>
                    <input
                      className="input"
                      value={selected.ctaText ?? ''}
                      onChange={(e) =>
                        patchSelected({ ctaText: e.target.value || null })
                      }
                      maxLength={80}
                      placeholder={t('phCtaText')}
                    />
                  </div>
                  <div>
                    <label className="label">{t('labelCtaUrl')}</label>
                    <input
                      className="input"
                      value={selected.ctaUrl ?? ''}
                      onChange={(e) =>
                        patchSelected({ ctaUrl: e.target.value || null })
                      }
                      placeholder={t('phCtaUrl')}
                    />
                  </div>
                </div>
              </div>

              <div className="card card-pad space-y-3">
                <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                  {t('sectionColors')}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('labelBackground')}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="w-10 h-10 rounded-lg border border-line cursor-pointer"
                        value={selected.bgColor ?? '#FFFFFF'}
                        onChange={(e) =>
                          patchSelected({ bgColor: e.target.value })
                        }
                      />
                      <input
                        type="text"
                        className="input flex-1 font-mono text-xs"
                        value={selected.bgColor ?? ''}
                        onChange={(e) =>
                          patchSelected({
                            bgColor: e.target.value || null,
                          })
                        }
                        placeholder={t('phInheritDeck')}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">{t('labelTextColor')}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="w-10 h-10 rounded-lg border border-line cursor-pointer"
                        value={selected.textColor ?? '#0A0A0A'}
                        onChange={(e) =>
                          patchSelected({ textColor: e.target.value })
                        }
                      />
                      <input
                        type="text"
                        className="input flex-1 font-mono text-xs"
                        value={selected.textColor ?? ''}
                        onChange={(e) =>
                          patchSelected({
                            textColor: e.target.value || null,
                          })
                        }
                        placeholder={t('phAutoContrast')}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Editor visual para layouts que usan content. Cae al
                  textarea JSON crudo para el resto. */}
              {selected.layout === 'STATS' ? (
                <StatsEditor
                  slide={selected}
                  onChange={(content) => patchSelected({ content })}
                />
              ) : selected.layout === 'COMPARISON' ? (
                <ComparisonEditor
                  slide={selected}
                  onChange={(content) => patchSelected({ content })}
                />
              ) : null}

              <details className="card card-pad" open={!selected.content ? false : undefined}>
                <summary className="text-[11px] uppercase tracking-wider text-mute font-semibold cursor-pointer">
                  {t('advancedContent')}
                </summary>
                <div className="mt-3 space-y-2">
                  <div className="text-[11px] text-mute leading-relaxed">
                    {t('advancedContentHelp')}
                  </div>
                  <textarea
                    className="input font-mono text-xs"
                    rows={6}
                    value={contentRaw}
                    onChange={(e) => onContentChange(e.target.value)}
                    placeholder='{ "stats": [{"label":"...","value":"..."}] }'
                  />
                  {contentErr && (
                    <div className="text-xs text-bad">{contentErr}</div>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations('admin_industries_presentations');
  if (state === 'idle') return null;
  const map: Record<SaveState, { labelKey: string; cls: string }> = {
    idle: { labelKey: '', cls: '' },
    dirty: { labelKey: 'saveDirty', cls: 'text-warn' },
    saving: { labelKey: 'saveSaving', cls: 'text-mute' },
    saved: { labelKey: 'saveSaved', cls: 'text-good' },
    error: { labelKey: 'saveError', cls: 'text-bad' },
  };
  const { labelKey, cls } = map[state];
  return <div className={`text-xs ${cls}`}>{labelKey ? t(labelKey) : ''}</div>;
}

/**
 * Editor visual para layout STATS — array de {label, value} editable
 * en una lista con agregar/reordenar/eliminar. Cualquier cambio dispara
 * patchSelected({ content }) que se propaga al autosave debounced.
 */
function StatsEditor({
  slide,
  onChange,
}: {
  slide: Slide;
  onChange: (content: any) => void;
}) {
  const t = useTranslations('admin_industries_presentations');
  const stats: Array<{ label?: string; value?: string }> = Array.isArray(
    slide.content?.stats,
  )
    ? slide.content.stats
    : [];

  function update(items: Array<{ label?: string; value?: string }>) {
    onChange({ ...(slide.content ?? {}), stats: items });
  }

  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
          {t('statsTitle')}
        </div>
        <button
          onClick={() => update([...stats, { label: '', value: '' }])}
          className="btn-primary text-xs px-2 py-1"
        >
          {t('addStat')}
        </button>
      </div>
      {stats.length === 0 ? (
        <div className="text-xs text-mute py-3 text-center">
          {t('statsEmpty')}
        </div>
      ) : (
        <div className="space-y-2">
          {stats.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="text-[11px] text-mute font-mono w-5">
                {i + 1}.
              </div>
              <input
                className="input flex-1"
                value={s.value ?? ''}
                onChange={(e) => {
                  const next = [...stats];
                  next[i] = { ...next[i], value: e.target.value };
                  update(next);
                }}
                placeholder="2.5x"
              />
              <input
                className="input flex-[2]"
                value={s.label ?? ''}
                onChange={(e) => {
                  const next = [...stats];
                  next[i] = { ...next[i], label: e.target.value };
                  update(next);
                }}
                placeholder={t('phStatLabel')}
              />
              <button
                onClick={() => {
                  if (i === 0) return;
                  const next = [...stats];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  update(next);
                }}
                disabled={i === 0}
                className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5 text-xs"
                title={t('moveUp')}
              >
                ↑
              </button>
              <button
                onClick={() => {
                  if (i === stats.length - 1) return;
                  const next = [...stats];
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  update(next);
                }}
                disabled={i === stats.length - 1}
                className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5 text-xs"
                title={t('moveDown')}
              >
                ↓
              </button>
              <button
                onClick={() => update(stats.filter((_, j) => j !== i))}
                className="text-bad hover:text-bad px-1.5 py-0.5 text-xs"
                title={t('delete')}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-mute leading-relaxed">
        {t('statsTip')}
      </div>
    </div>
  );
}

/**
 * Editor visual para layout COMPARISON — dos columnas (left/right),
 * cada una con title + items[]. Útil para "Antes vs Con Clubify".
 */
function ComparisonEditor({
  slide,
  onChange,
}: {
  slide: Slide;
  onChange: (content: any) => void;
}) {
  const t = useTranslations('admin_industries_presentations');
  const left = slide.content?.left ?? { title: 'Antes', items: [] };
  const right = slide.content?.right ?? { title: 'Con Clubify', items: [] };
  const leftItems: string[] = Array.isArray(left.items) ? left.items : [];
  const rightItems: string[] = Array.isArray(right.items) ? right.items : [];

  function update(next: { left: typeof left; right: typeof right }) {
    onChange({ ...(slide.content ?? {}), ...next });
  }

  function ColumnEditor({
    side,
    label,
    title,
    items,
  }: {
    side: 'left' | 'right';
    label: string;
    title: string;
    items: string[];
  }) {
    const isLeft = side === 'left';
    return (
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
          {label}
        </div>
        <input
          className="input"
          value={title}
          onChange={(e) => {
            const updated = { ...(isLeft ? left : right), title: e.target.value };
            update({
              left: isLeft ? updated : left,
              right: isLeft ? right : updated,
            });
          }}
          placeholder={isLeft ? t('phColLeftTitle') : t('phColRightTitle')}
        />
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-mute text-xs">{isLeft ? '✗' : '✓'}</span>
              <input
                className="input flex-1 text-sm"
                value={item}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  const updated = {
                    ...(isLeft ? left : right),
                    items: next,
                  };
                  update({
                    left: isLeft ? updated : left,
                    right: isLeft ? right : updated,
                  });
                }}
                placeholder={
                  isLeft
                    ? t('phColLeftItem')
                    : t('phColRightItem')
                }
              />
              <button
                onClick={() => {
                  const updated = {
                    ...(isLeft ? left : right),
                    items: items.filter((_, j) => j !== i),
                  };
                  update({
                    left: isLeft ? updated : left,
                    right: isLeft ? right : updated,
                  });
                }}
                className="text-bad hover:text-bad px-1.5 py-0.5 text-xs"
                title={t('delete')}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            const updated = {
              ...(isLeft ? left : right),
              items: [...items, ''],
            };
            update({
              left: isLeft ? updated : left,
              right: isLeft ? right : updated,
            });
          }}
          className="text-xs text-brand hover:underline"
        >
          {t('addItem')}
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pad space-y-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {t('comparisonTitle')}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ColumnEditor
          side="left"
          label={t('colLeftLabel')}
          title={left.title ?? 'Antes'}
          items={leftItems}
        />
        <ColumnEditor
          side="right"
          label={t('colRightLabel')}
          title={right.title ?? 'Con Clubify'}
          items={rightItems}
        />
      </div>
    </div>
  );
}
