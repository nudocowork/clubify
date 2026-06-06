'use client';
/**
 * Admin · Ventas · Difusión interna (item 14 sprint).
 *
 * El SUPER_ADMIN crea piezas de comunicación que aparecen en el panel
 * de embajadores / influencers / vendedores:
 *   - Banner: barra arriba del panel afiliado, descartable.
 *   - Login popup: modal bloqueante una sola vez por user.
 *
 * Dos tabs: cada uno con lista + modal de edición + preview en vivo.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Kind = 'BANNER' | 'LOGIN_POPUP';
type Audience = 'ALL' | 'INFLUENCERS' | 'AMBASSADORS' | 'VENDORS';
type Color = 'GREEN' | 'BLUE' | 'YELLOW' | 'RED' | 'CUSTOM';
type IconKind = 'INFO' | 'ALERT' | 'NEWS' | 'TRAINING' | 'PROMO';
type MediaKind = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'PDF';

type Broadcast = {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  audience: Audience;
  isActive: boolean;
  color: Color | null;
  customColor: string | null;
  icon: IconKind | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  mediaKind: MediaKind | null;
  mediaUrl: string | null;
  confirmLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { reads: number };
  createdBy?: { id: string; fullName: string; email: string } | null;
};

type Metrics = {
  sent: number;
  read: number;
  pending: number;
  rate: number;
  audience: Audience;
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  ALL: 'Todos los afiliados',
  INFLUENCERS: 'Solo influencers',
  AMBASSADORS: 'Solo embajadores',
  VENDORS: 'Solo vendedores',
};

const COLOR_PRESETS: Record<Exclude<Color, 'CUSTOM'>, { bg: string; ink: string }> = {
  GREEN: { bg: '#16a34a', ink: '#ffffff' },
  BLUE: { bg: '#2563eb', ink: '#ffffff' },
  YELLOW: { bg: '#f59e0b', ink: '#1f2937' },
  RED: { bg: '#dc2626', ink: '#ffffff' },
};

const ICON_LABEL: Record<IconKind, string> = {
  INFO: 'ℹ️ Info',
  ALERT: '⚠️ Alerta',
  NEWS: '📰 Novedad',
  TRAINING: '🎓 Capacitación',
  PROMO: '🎁 Promo',
};

const ICON_SYMBOL: Record<IconKind, string> = {
  INFO: 'ℹ️',
  ALERT: '⚠️',
  NEWS: '📰',
  TRAINING: '🎓',
  PROMO: '🎁',
};

const MEDIA_LABEL: Record<MediaKind, string> = {
  TEXT: 'Solo texto',
  IMAGE: 'Imagen',
  AUDIO: 'Audio',
  VIDEO: 'Video',
  PDF: 'PDF',
};

function statusLabel(b: Broadcast): { label: string; cls: string } {
  if (!b.isActive) return { label: 'Inactivo', cls: 'bg-bg2 text-mute' };
  const now = Date.now();
  if (b.startsAt && new Date(b.startsAt).getTime() > now) {
    return { label: 'Agendado', cls: 'bg-amber-100 text-amber-800' };
  }
  if (b.endsAt && new Date(b.endsAt).getTime() < now) {
    return { label: 'Vencido', cls: 'bg-bg2 text-mute' };
  }
  return { label: 'Activo', cls: 'bg-ok-soft text-ok' };
}

function emptyForm(kind: Kind): Partial<Broadcast> {
  if (kind === 'BANNER') {
    return {
      kind: 'BANNER',
      title: '',
      description: '',
      audience: 'ALL',
      isActive: true,
      color: 'BLUE',
      icon: 'INFO',
      ctaLabel: '',
      ctaUrl: '',
    };
  }
  return {
    kind: 'LOGIN_POPUP',
    title: '',
    description: '',
    audience: 'ALL',
    isActive: true,
    mediaKind: 'TEXT',
    mediaUrl: '',
    confirmLabel: 'He leído',
  };
}

export default function DifusionAdminPage() {
  const [tab, setTab] = useState<Kind>('BANNER');
  const [items, setItems] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Broadcast> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const list = await api<Broadcast[]>('/admin/broadcasts');
      setItems(list ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const banners = useMemo(() => items.filter((b) => b.kind === 'BANNER'), [items]);
  const popups = useMemo(() => items.filter((b) => b.kind === 'LOGIN_POPUP'), [items]);

  async function save(dto: Partial<Broadcast>) {
    const isUpdate = !!dto.id;
    try {
      // Limpieza: solo enviamos los campos relevantes al kind.
      const payload: any = {
        kind: dto.kind,
        title: dto.title,
        description: dto.description,
        audience: dto.audience,
        isActive: dto.isActive,
        startsAt: dto.startsAt || null,
        endsAt: dto.endsAt || null,
      };
      if (dto.kind === 'BANNER') {
        payload.color = dto.color || null;
        payload.customColor = dto.color === 'CUSTOM' ? dto.customColor || null : null;
        payload.icon = dto.icon || null;
        payload.ctaLabel = dto.ctaLabel || null;
        payload.ctaUrl = dto.ctaUrl || null;
        // Limpiamos campos del otro kind por si se cambió de tipo en update.
        payload.mediaKind = null;
        payload.mediaUrl = null;
      } else {
        payload.mediaKind = dto.mediaKind || 'TEXT';
        payload.mediaUrl = dto.mediaUrl || null;
        payload.confirmLabel = dto.confirmLabel || 'He leído';
        payload.color = null;
        payload.customColor = null;
        payload.icon = null;
        payload.ctaLabel = null;
        payload.ctaUrl = null;
      }
      if (isUpdate) {
        await api(`/admin/broadcasts/${dto.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/admin/broadcasts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      toast(isUpdate ? 'Broadcast actualizado' : 'Broadcast creado', 'success');
      setEditing(null);
      await load();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }

  async function disable(b: Broadcast) {
    if (!confirm(`¿Desactivar "${b.title}"?`)) return;
    try {
      await api(`/admin/broadcasts/${b.id}/disable`, { method: 'PATCH' });
      toast('Desactivado', 'success');
      await load();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }

  async function toggleActive(b: Broadcast) {
    try {
      await api(`/admin/broadcasts/${b.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !b.isActive }),
      });
      await load();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }

  if (loading) return <div className="text-mute">Cargando…</div>;

  const visible = tab === 'BANNER' ? banners : popups;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Difusión interna{' '}
          <span className="page-crumb">/ comunicación a equipos comerciales</span>
        </h1>
        <button
          className="btn-primary"
          onClick={() => setEditing(emptyForm(tab))}
        >
          + {tab === 'BANNER' ? 'Banner' : 'Popup'}
        </button>
      </div>

      <div className="mb-5 -mx-5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="tabs">
          <button
            className={`tab ${tab === 'BANNER' ? 'tab-active' : ''}`}
            onClick={() => setTab('BANNER')}
          >
            📢 Banner informativo
            <span className="ml-1.5 text-[10px] opacity-70">({banners.length})</span>
          </button>
          <button
            className={`tab ${tab === 'LOGIN_POPUP' ? 'tab-active' : ''}`}
            onClick={() => setTab('LOGIN_POPUP')}
          >
            🪟 Popup de comunicación
            <span className="ml-1.5 text-[10px] opacity-70">({popups.length})</span>
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="card card-pad text-center text-mute py-10">
          {tab === 'BANNER'
            ? 'Aún no hay banners. Crea el primero con "+ Banner" arriba.'
            : 'Aún no hay popups. Crea el primero con "+ Popup" arriba.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {visible.map((b) => (
          <BroadcastCard
            key={b.id}
            b={b}
            onEdit={() => setEditing(b)}
            onDisable={() => disable(b)}
            onToggle={() => toggleActive(b)}
          />
        ))}
      </div>

      {editing && (
        <EditorModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function BroadcastCard({
  b,
  onEdit,
  onDisable,
  onToggle,
}: {
  b: Broadcast;
  onEdit: () => void;
  onDisable: () => void;
  onToggle: () => void;
}) {
  const st = statusLabel(b);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);

  async function loadMetrics() {
    if (metrics) {
      setShowMetrics((v) => !v);
      return;
    }
    try {
      const m = await api<Metrics>(`/admin/broadcasts/${b.id}/metrics`);
      setMetrics(m);
      setShowMetrics(true);
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }

  return (
    <div className={`card card-pad ${b.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${st.cls}`}>
              {st.label}
            </span>
            <span className="text-[11px] text-mute">
              {AUDIENCE_LABEL[b.audience]}
            </span>
            {(b.startsAt || b.endsAt) && (
              <span className="text-[11px] text-mute">
                · {b.startsAt ? new Date(b.startsAt).toLocaleString() : '—'} →{' '}
                {b.endsAt ? new Date(b.endsAt).toLocaleString() : '∞'}
              </span>
            )}
          </div>
          <div className="font-semibold text-sm leading-tight mb-1">{b.title}</div>
          <div className="text-xs text-mute leading-relaxed line-clamp-2">
            {b.description}
          </div>
          {b.kind === 'BANNER' ? (
            <div className="mt-3">
              <BannerPreview b={b} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5 flex-none">
          <button onClick={onEdit} className="btn-ghost text-[11px]">
            ✏️ Editar
          </button>
          <button onClick={loadMetrics} className="btn-ghost text-[11px]">
            📈 Métricas
          </button>
          <button
            onClick={onToggle}
            className="btn-ghost text-[11px]"
            title={b.isActive ? 'Pausar' : 'Activar'}
          >
            {b.isActive ? '⏸ Pausar' : '▶ Activar'}
          </button>
          {b.isActive && (
            <button onClick={onDisable} className="btn-ghost text-[11px] text-bad">
              🚫 Desactivar
            </button>
          )}
        </div>
      </div>

      {showMetrics && metrics && (
        <div className="mt-3 pt-3 border-t border-bg2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Enviados" value={String(metrics.sent)} />
          <Metric label="Leídos" value={String(metrics.read)} />
          <Metric label="Pendientes" value={String(metrics.pending)} />
          <Metric
            label="Tasa lectura"
            value={`${(metrics.rate * 100).toFixed(0)}%`}
          />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className="font-bold text-base">{value}</div>
    </div>
  );
}

function BannerPreview({ b }: { b: Partial<Broadcast> }) {
  const color: Color = (b.color as Color) || 'BLUE';
  const palette =
    color === 'CUSTOM'
      ? { bg: b.customColor || '#2563eb', ink: '#ffffff' }
      : COLOR_PRESETS[color];
  const icon = (b.icon as IconKind) || 'INFO';
  return (
    <div
      className="rounded-lg px-3 py-2 flex items-center gap-2 text-[13px]"
      style={{ background: palette.bg, color: palette.ink }}
    >
      <span className="text-lg leading-none">{ICON_SYMBOL[icon]}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight">{b.title || 'Título del banner'}</div>
        <div className="opacity-90 text-[11px] leading-snug">
          {b.description || 'Descripción del banner'}
        </div>
      </div>
      {b.ctaLabel && (
        <button
          className="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/20 hover:bg-white/30"
          style={{ color: palette.ink }}
        >
          {b.ctaLabel}
        </button>
      )}
    </div>
  );
}

function PopupPreview({ b }: { b: Partial<Broadcast> }) {
  return (
    <div className="bg-bg2 rounded-xl p-4">
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <div className="font-bold text-base mb-2">{b.title || 'Título del popup'}</div>
        {b.mediaKind === 'IMAGE' && b.mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.mediaUrl} alt="" className="w-full rounded-lg mb-2" />
        )}
        {b.mediaKind === 'VIDEO' && b.mediaUrl && (
          <video src={b.mediaUrl} controls className="w-full rounded-lg mb-2" />
        )}
        {b.mediaKind === 'AUDIO' && b.mediaUrl && (
          <audio src={b.mediaUrl} controls className="w-full mb-2" />
        )}
        {b.mediaKind === 'PDF' && b.mediaUrl && (
          <a
            href={b.mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-700 underline text-sm block mb-2"
          >
            📄 Ver documento
          </a>
        )}
        <div className="text-sm text-mute whitespace-pre-wrap mb-3">
          {b.description || 'Contenido del popup'}
        </div>
        <button className="btn-primary w-full">
          {b.confirmLabel || 'He leído'}
        </button>
      </div>
    </div>
  );
}

function EditorModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Partial<Broadcast>;
  onClose: () => void;
  onSave: (b: Partial<Broadcast>) => void | Promise<void>;
}) {
  const [form, setForm] = useState<Partial<Broadcast>>({ ...initial });
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<Broadcast>) {
    setForm({ ...form, ...p });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title?.trim()) {
      toast('Falta el título', 'error');
      return;
    }
    if (!form.description?.trim()) {
      toast('Falta la descripción', 'error');
      return;
    }
    setBusy(true);
    try {
      await onSave(form);
    } finally {
      setBusy(false);
    }
  }

  const isBanner = form.kind === 'BANNER';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 animate-in zoom-in-95 fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">
            {form.id ? 'Editar' : 'Nuevo'} {isBanner ? 'banner' : 'popup'}
          </h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl">
            ×
          </button>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          {/* Formulario */}
          <div className="flex flex-col gap-3">
            <Field label="Título">
              <input
                className="input"
                value={form.title ?? ''}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder={isBanner ? 'Nueva capacitación esta semana' : 'Lee esto antes de empezar'}
                required
              />
            </Field>
            <Field label={isBanner ? 'Descripción' : 'Contenido'}>
              <textarea
                className="input min-h-[100px]"
                value={form.description ?? ''}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder={isBanner ? 'Texto que aparecerá en la barra' : 'Mensaje completo del popup'}
                required
              />
            </Field>

            {isBanner ? (
              <>
                <Field label="Color">
                  <div className="flex items-center gap-2 flex-wrap">
                    {(['GREEN', 'BLUE', 'YELLOW', 'RED'] as const).map((c) => {
                      const p = COLOR_PRESETS[c];
                      return (
                        <button
                          type="button"
                          key={c}
                          onClick={() => patch({ color: c })}
                          className={`w-8 h-8 rounded-full border-2 ${
                            form.color === c ? 'border-ink' : 'border-transparent'
                          }`}
                          style={{ background: p.bg }}
                          title={c}
                        />
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => patch({ color: 'CUSTOM' })}
                      className={`px-2 py-1 rounded border text-xs ${
                        form.color === 'CUSTOM'
                          ? 'border-ink'
                          : 'border-bg2'
                      }`}
                    >
                      Custom
                    </button>
                    {form.color === 'CUSTOM' && (
                      <input
                        type="color"
                        value={form.customColor ?? '#2563eb'}
                        onChange={(e) => patch({ customColor: e.target.value })}
                        className="w-8 h-8 rounded"
                      />
                    )}
                  </div>
                </Field>
                <Field label="Icono">
                  <select
                    className="input"
                    value={form.icon ?? 'INFO'}
                    onChange={(e) => patch({ icon: e.target.value as IconKind })}
                  >
                    {(['INFO', 'ALERT', 'NEWS', 'TRAINING', 'PROMO'] as const).map((i) => (
                      <option key={i} value={i}>
                        {ICON_LABEL[i]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Texto del CTA (opcional)">
                    <input
                      className="input"
                      value={form.ctaLabel ?? ''}
                      onChange={(e) => patch({ ctaLabel: e.target.value })}
                      placeholder="Ver más"
                    />
                  </Field>
                  <Field label="URL del CTA (opcional)">
                    <input
                      className="input"
                      type="url"
                      value={form.ctaUrl ?? ''}
                      onChange={(e) => patch({ ctaUrl: e.target.value })}
                      placeholder="https://…"
                    />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field label="Tipo de media">
                  <select
                    className="input"
                    value={form.mediaKind ?? 'TEXT'}
                    onChange={(e) =>
                      patch({ mediaKind: e.target.value as MediaKind })
                    }
                  >
                    {(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'PDF'] as const).map((m) => (
                      <option key={m} value={m}>
                        {MEDIA_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.mediaKind && form.mediaKind !== 'TEXT' && (
                  <Field
                    label={`URL del ${MEDIA_LABEL[form.mediaKind].toLowerCase()}`}
                  >
                    <input
                      className="input"
                      type="url"
                      value={form.mediaUrl ?? ''}
                      onChange={(e) => patch({ mediaUrl: e.target.value })}
                      placeholder="https://…"
                    />
                  </Field>
                )}
                <Field label="Texto del botón principal">
                  <input
                    className="input"
                    value={form.confirmLabel ?? 'He leído'}
                    onChange={(e) => patch({ confirmLabel: e.target.value })}
                    placeholder="He leído"
                  />
                </Field>
              </>
            )}

            <Field label="Audiencia">
              <select
                className="input"
                value={form.audience ?? 'ALL'}
                onChange={(e) => patch({ audience: e.target.value as Audience })}
              >
                {(['ALL', 'INFLUENCERS', 'AMBASSADORS', 'VENDORS'] as const).map(
                  (a) => (
                    <option key={a} value={a}>
                      {AUDIENCE_LABEL[a]}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha inicio (opcional)">
                <input
                  className="input"
                  type="datetime-local"
                  value={
                    form.startsAt
                      ? new Date(form.startsAt).toISOString().slice(0, 16)
                      : ''
                  }
                  onChange={(e) =>
                    patch({ startsAt: e.target.value || null })
                  }
                />
              </Field>
              <Field label="Fecha fin (opcional)">
                <input
                  className="input"
                  type="datetime-local"
                  value={
                    form.endsAt
                      ? new Date(form.endsAt).toISOString().slice(0, 16)
                      : ''
                  }
                  onChange={(e) => patch({ endsAt: e.target.value || null })}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive ?? true}
                onChange={(e) => patch({ isActive: e.target.checked })}
              />
              <span>Activo</span>
            </label>

            <div className="flex items-center gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button type="submit" className="btn-primary flex-1" disabled={busy}>
                {busy ? 'Guardando…' : form.id ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </div>

          {/* Preview en vivo */}
          <div className="lg:border-l lg:pl-5">
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
              Vista previa
            </div>
            {isBanner ? <BannerPreview b={form} /> : <PopupPreview b={form} />}
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}
