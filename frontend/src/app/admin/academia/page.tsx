'use client';
/**
 * Academia — configuración por MARCA (panel /admin → Sistema → Academia).
 * El SUPER_ADMIN de la marca pega un enlace de YouTube por módulo. El backend
 * aísla todo por whiteLabelId; el botón "▶ Ver tutorial" aparece en el panel
 * del negocio solo para los módulos con un video activo.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ACADEMY_MODULES, youTubeEmbedUrl } from '@/lib/academy-modules';

type SavedVideo = {
  moduleKey: string;
  youtubeUrl: string;
  active: boolean;
  title: string;
  description: string;
};
type Draft = { youtubeUrl: string; active: boolean; title: string; description: string };

export default function AcademiaPage() {
  const [saved, setSaved] = useState<Record<string, SavedVideo>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; embed: string } | null>(null);

  useEffect(() => {
    api<SavedVideo[]>('/academy/videos')
      .then((rows) => {
        const map: Record<string, SavedVideo> = {};
        for (const r of rows ?? []) map[r.moduleKey] = r;
        setSaved(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const configuredCount = useMemo(
    () => Object.values(saved).filter((v) => v.active && v.youtubeUrl.trim()).length,
    [saved],
  );

  function draftFor(key: string): Draft {
    return (
      drafts[key] ?? {
        youtubeUrl: saved[key]?.youtubeUrl ?? '',
        active: saved[key]?.active ?? true,
        title: saved[key]?.title ?? '',
        description: saved[key]?.description ?? '',
      }
    );
  }
  function setDraft(key: string, patch: Partial<Draft>) {
    setDrafts((s) => ({ ...s, [key]: { ...draftFor(key), ...patch } }));
  }
  function isDirty(key: string) {
    if (!drafts[key]) return false;
    const d = drafts[key];
    const sv = saved[key];
    return (
      d.youtubeUrl !== (sv?.youtubeUrl ?? '') ||
      d.active !== (sv?.active ?? true) ||
      d.title !== (sv?.title ?? '') ||
      d.description !== (sv?.description ?? '')
    );
  }

  async function save(key: string, label: string) {
    const d = draftFor(key);
    if (d.youtubeUrl.trim() && !youTubeEmbedUrl(d.youtubeUrl)) {
      toast('El enlace de YouTube no es válido.', 'error');
      return;
    }
    setSavingKey(key);
    try {
      const row = await api<SavedVideo>(`/academy/videos/${key}`, {
        method: 'PUT',
        body: JSON.stringify(d),
      });
      setSaved((s) => ({ ...s, [key]: row }));
      setDrafts((s) => {
        const n = { ...s };
        delete n[key];
        return n;
      });
      toast(`“${label}” guardado`, 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Error al guardar', 'error');
    } finally {
      setSavingKey(null);
    }
  }

  function openPreview(key: string, label: string) {
    const d = draftFor(key);
    const embed = youTubeEmbedUrl(d.youtubeUrl);
    if (!embed) {
      toast('Pega un enlace de YouTube válido para previsualizar.', 'error');
      return;
    }
    setPreview({ title: d.title.trim() || label, embed });
  }

  return (
    <div>
      <h1 className="page-title">🎓 Academia</h1>
      <p className="text-sm text-mute mb-1 max-w-2xl">
        Pega un video-tutorial de YouTube para cada módulo. En el panel de tus
        negocios aparecerá un botón <b>▶ Ver tutorial</b> justo donde se necesita.
        El video se abre embebido, sin salir de la plataforma.
      </p>
      <p className="text-xs text-mute mb-5">
        {loading ? 'Cargando…' : `${configuredCount} de ${ACADEMY_MODULES.length} módulos con video activo`}
        {' · '}Solo se guardan enlaces (no se suben videos). Si un módulo no tiene enlace, el botón permanece invisible.
      </p>

      <div className="space-y-2.5">
        {ACADEMY_MODULES.map((m) => {
          const d = draftFor(m.key);
          const configured = !!(saved[m.key]?.active && saved[m.key]?.youtubeUrl.trim());
          const validEmbed = !!youTubeEmbedUrl(d.youtubeUrl);
          const dirty = isDirty(m.key);
          return (
            <div key={m.key} className="card card-pad" style={{ opacity: d.active ? 1 : 0.7 }}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{m.label}</span>
                    {configured && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-[6px]" style={{ background: '#dcfce7', color: '#15803d' }}>
                        ● Activo
                      </span>
                    )}
                    <code className="text-[10px] text-mute" style={{ fontFamily: 'ui-monospace, monospace' }}>{m.key}</code>
                  </div>
                  <div className="text-xs text-mute mt-0.5">{m.where}</div>
                </div>
                <div className="flex-[2] min-w-[240px]">
                  <input
                    className="input text-sm"
                    placeholder="https://youtube.com/watch?v=…  ó  https://youtu.be/…"
                    value={d.youtubeUrl}
                    onChange={(e) => setDraft(m.key, { youtubeUrl: e.target.value })}
                  />
                  {d.youtubeUrl.trim() && !validEmbed && (
                    <div className="text-[11px] mt-1" style={{ color: '#dc2626' }}>Enlace de YouTube no reconocido.</div>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded((s) => ({ ...s, [m.key]: !s[m.key] }))}
                    className="text-[11px] text-brand hover:underline mt-1.5"
                  >
                    {expanded[m.key] ? 'Ocultar título y descripción' : 'Título y descripción (opcional)'}
                  </button>
                  {expanded[m.key] && (
                    <div className="mt-2 space-y-2">
                      <input
                        className="input text-sm"
                        placeholder={`Título del popup (por defecto: “${m.label}”)`}
                        maxLength={120}
                        value={d.title}
                        onChange={(e) => setDraft(m.key, { title: e.target.value })}
                      />
                      <textarea
                        className="input text-sm min-h-[60px]"
                        placeholder="Descripción opcional bajo el video"
                        maxLength={400}
                        value={d.description}
                        onChange={(e) => setDraft(m.key, { description: e.target.value })}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDraft(m.key, { active: !d.active })}
                    className={`relative w-10 h-5 rounded-full transition shrink-0 ${d.active ? 'bg-brand' : 'bg-bg2 border border-line'}`}
                    aria-label={d.active ? 'Activo' : 'Inactivo'}
                    title={d.active ? 'Activo' : 'Inactivo'}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${d.active ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-sm py-2 px-3"
                    disabled={!validEmbed}
                    onClick={() => openPreview(m.key, m.label)}
                  >
                    👁 Vista previa
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-sm py-2 px-3 disabled:opacity-50"
                    disabled={savingKey === m.key || !dirty}
                    onClick={() => save(m.key, m.label)}
                  >
                    {savingKey === m.key ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,14,12,.62)', backdropFilter: 'blur(2px)' }}
          onClick={() => setPreview(null)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 720, overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 pb-2">
              <div className="font-semibold text-ink">{preview.title}</div>
              <button className="btn-ghost py-1.5 px-3 text-sm" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div style={{ aspectRatio: '16/9', background: '#000' }}>
              <iframe
                src={preview.embed}
                title={preview.title}
                style={{ width: '100%', height: '100%', border: 0 }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
