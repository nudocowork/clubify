'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Criteria = {
  type:
    | 'SCANS_TOTAL'
    | 'CARDS_COMPLETED'
    | 'STREAK_DAYS'
    | 'CASHBACK_EARNED'
    | 'FIRST_VISIT'
    | 'BIRTHDAY'
    | 'CUSTOM';
  threshold?: number;
  cardId?: string;
};

type Badge = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  criteria: Criteria;
  xpReward: number;
  isActive: boolean;
  _count?: { earned: number };
};

type BadgeTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  criteria: Criteria;
  xpReward: number;
};

const TEMPLATES: BadgeTemplate[] = [
  {
    id: 'first-visit',
    name: 'Primera visita',
    description: 'Bienvenida a tu primer scan',
    icon: '🎉',
    color: '#22C55E',
    criteria: { type: 'FIRST_VISIT' },
    xpReward: 25,
  },
  {
    id: 'streak-7',
    name: 'Racha 7 días',
    description: 'Vino 7 días seguidos',
    icon: '🔥',
    color: '#F97316',
    criteria: { type: 'STREAK_DAYS', threshold: 7 },
    xpReward: 100,
  },
  {
    id: 'streak-30',
    name: 'Racha 30 días',
    description: 'Un mes completo de fidelidad',
    icon: '⚡',
    color: '#DC2626',
    criteria: { type: 'STREAK_DAYS', threshold: 30 },
    xpReward: 500,
  },
  {
    id: 'scans-10',
    name: 'Cliente frecuente',
    description: '10 scans acumulados',
    icon: '⭐',
    color: '#FBBF24',
    criteria: { type: 'SCANS_TOTAL', threshold: 10 },
    xpReward: 50,
  },
  {
    id: 'scans-50',
    name: 'Súper fan',
    description: '50 scans — uno de los nuestros',
    icon: '🌟',
    color: '#8B5CF6',
    criteria: { type: 'SCANS_TOTAL', threshold: 50 },
    xpReward: 250,
  },
  {
    id: 'scans-100',
    name: 'Leyenda',
    description: '100 scans — eres parte de la familia',
    icon: '👑',
    color: '#0F172A',
    criteria: { type: 'SCANS_TOTAL', threshold: 100 },
    xpReward: 1000,
  },
  {
    id: 'cards-1',
    name: 'Primer cartón completo',
    description: 'Llenó su primera tarjeta',
    icon: '🎯',
    color: '#10B981',
    criteria: { type: 'CARDS_COMPLETED', threshold: 1 },
    xpReward: 75,
  },
  {
    id: 'cards-5',
    name: 'Coleccionista',
    description: 'Completó 5 cartones',
    icon: '🏆',
    color: '#F59E0B',
    criteria: { type: 'CARDS_COMPLETED', threshold: 5 },
    xpReward: 300,
  },
  {
    id: 'cashback-50k',
    name: 'Ahorrador',
    description: 'Acumuló $50.000 en cashback',
    icon: '💰',
    color: '#0F766E',
    criteria: { type: 'CASHBACK_EARNED', threshold: 50000 },
    xpReward: 200,
  },
  {
    id: 'cashback-200k',
    name: 'Maestro del ahorro',
    description: '$200.000 acumulados — rey del cashback',
    icon: '💎',
    color: '#06B6D4',
    criteria: { type: 'CASHBACK_EARNED', threshold: 200000 },
    xpReward: 750,
  },
  {
    id: 'birthday',
    name: 'Cumpleañero',
    description: 'Felicitación automática el día del cumple',
    icon: '🎂',
    color: '#EC4899',
    criteria: { type: 'BIRTHDAY' },
    xpReward: 100,
  },
  {
    id: 'custom-vip',
    name: 'Cliente VIP',
    description: 'Otorgada manualmente por el dueño',
    icon: '🥂',
    color: '#7C3AED',
    criteria: { type: 'CUSTOM' },
    xpReward: 500,
  },
];

const CRITERIA_LABEL: Record<Criteria['type'], string> = {
  SCANS_TOTAL: 'Total de scans',
  CARDS_COMPLETED: 'Cartones completos',
  STREAK_DAYS: 'Días consecutivos',
  CASHBACK_EARNED: 'Cashback acumulado',
  FIRST_VISIT: 'Primera visita',
  BIRTHDAY: 'Cumpleaños',
  CUSTOM: 'Manual (admin la otorga)',
};

export default function BadgesPage() {
  const [list, setList] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Badge | null>(null);
  const [creating, setCreating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = await api<Badge[]>('/badges');
      setList(rows);
    } catch (e: any) {
      toast(e.message || 'Error cargando insignias', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function deleteBadge(b: Badge) {
    const earned = b._count?.earned ?? 0;
    const msg =
      earned > 0
        ? `"${b.name}" la tienen ${earned} clientes. Si la borras se pierde de sus perfiles. ¿Confirmar?`
        : `¿Borrar la insignia "${b.name}"?`;
    if (!confirm(msg)) return;
    try {
      await api(`/badges/${b.id}`, { method: 'DELETE' });
      toast('Insignia eliminada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function createFromTemplate(t: BadgeTemplate) {
    try {
      await api('/badges', {
        method: 'POST',
        body: JSON.stringify({
          name: t.name,
          description: t.description,
          icon: t.icon,
          color: t.color,
          criteria: t.criteria,
          xpReward: t.xpReward,
          isActive: true,
        }),
      });
      toast(`Insignia "${t.name}" creada`, 'success');
      setShowTemplates(false);
      load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  const sortedList = useMemo(
    () =>
      [...list].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return (b._count?.earned ?? 0) - (a._count?.earned ?? 0);
      }),
    [list],
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Insignias{' '}
          <span className="page-crumb">/ {list.length} configuradas</span>
        </h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setShowTemplates(true)}>
            <Icon name="spark" /> Plantillas
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Crear insignia
          </button>
        </div>
      </div>

      <div className="card card-pad mb-5 bg-violet-50 border-violet-200">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🎮</span>
          <div className="text-sm leading-relaxed">
            <strong>Sistema de gamificación.</strong> Cada vez que un cliente
            scaneá su tarjeta gana XP, sube de nivel (Bronce → Plata → Oro →
            Platino → Diamante) y desbloquea insignias automáticamente.
            Configurá las insignias acá; los criterios se chequean al instante
            con cada scan.
          </div>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card card-pad">
              <div className="h-20 bg-bg2 rounded animate-shimmer" />
            </div>
          ))}
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="card card-pad text-center py-12">
          <div className="text-5xl mb-3">🏅</div>
          <div className="font-semibold text-lg">Sin insignias configuradas</div>
          <div className="text-sm text-mute mt-1.5 max-w-md mx-auto leading-relaxed">
            Empezá con una plantilla pre-armada o crea la tuya desde cero. Tus
            clientes las desbloquean automáticamente al alcanzar los criterios.
          </div>
          <div className="mt-5 flex gap-2 justify-center">
            <button
              className="btn-primary"
              onClick={() => setShowTemplates(true)}
            >
              <Icon name="spark" /> Ver plantillas
            </button>
            <button
              className="btn-ghost"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" /> Crear desde cero
            </button>
          </div>
        </div>
      )}

      {!loading && list.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sortedList.map((b) => (
            <div
              key={b.id}
              className={`card p-4 relative group ${!b.isActive ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                  style={{ background: `${b.color}22`, color: b.color }}
                >
                  {b.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{b.name}</div>
                  <div className="text-xs text-mute mt-0.5 line-clamp-2 leading-snug">
                    {b.description}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-mute mt-2 font-semibold">
                    {CRITERIA_LABEL[b.criteria.type]}
                    {b.criteria.threshold && ` · ${b.criteria.threshold.toLocaleString('es-CO')}`}
                  </div>
                </div>
                {!b.isActive && (
                  <span className="badge badge-mute text-[9px]">Pausada</span>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-mute">
                  <span>
                    <strong className="text-ink">{b.xpReward}</strong> XP
                  </span>
                  <span>
                    <strong className="text-ink">{b._count?.earned ?? 0}</strong>{' '}
                    {(b._count?.earned ?? 0) === 1 ? 'cliente' : 'clientes'}
                  </span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => setEditing(b)}
                    className="p-1.5 rounded hover:bg-bg2 text-mute hover:text-ink"
                    title="Editar"
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    onClick={() => deleteBadge(b)}
                    className="p-1.5 rounded hover:bg-red-50 text-mute hover:text-red-600"
                    title="Eliminar"
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onPick={createFromTemplate}
          existingNames={new Set(list.map((b) => b.name))}
        />
      )}

      {(creating || editing) && (
        <BadgeEditModal
          badge={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function TemplatesModal({
  onClose,
  onPick,
  existingNames,
}: {
  onClose: () => void;
  onPick: (t: BadgeTemplate) => void;
  existingNames: Set<string>;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold m-0">Plantillas de insignia</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TEMPLATES.map((t) => {
            const exists = existingNames.has(t.name);
            return (
              <button
                key={t.id}
                onClick={() => !exists && onPick(t)}
                disabled={exists}
                className={`card p-4 text-left transition ${
                  exists
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:shadow-md hover:-translate-y-0.5'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                    style={{ background: `${t.color}22`, color: t.color }}
                  >
                    {t.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{t.name}</div>
                    <div className="text-xs text-mute mt-0.5 leading-snug">
                      {t.description}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-mute mt-1.5 font-semibold">
                      +{t.xpReward} XP · {CRITERIA_LABEL[t.criteria.type]}
                    </div>
                  </div>
                </div>
                {exists && (
                  <div className="mt-2 text-[10px] text-mute font-semibold">
                    ✓ Ya creada
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BadgeEditModal({
  badge,
  onClose,
  onSaved,
}: {
  badge: Badge | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<{
    name: string;
    description: string;
    icon: string;
    color: string;
    criteriaType: Criteria['type'];
    threshold: number;
    xpReward: number;
    isActive: boolean;
  }>({
    name: badge?.name ?? '',
    description: badge?.description ?? '',
    icon: badge?.icon ?? '🏅',
    color: badge?.color ?? '#F59E0B',
    criteriaType: badge?.criteria.type ?? 'CUSTOM',
    threshold: badge?.criteria.threshold ?? 10,
    xpReward: badge?.xpReward ?? 50,
    isActive: badge?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);

  const needsThreshold =
    form.criteriaType === 'SCANS_TOTAL' ||
    form.criteriaType === 'CARDS_COMPLETED' ||
    form.criteriaType === 'STREAK_DAYS' ||
    form.criteriaType === 'CASHBACK_EARNED';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        icon: form.icon,
        color: form.color,
        criteria: needsThreshold
          ? { type: form.criteriaType, threshold: form.threshold }
          : { type: form.criteriaType },
        xpReward: form.xpReward,
        isActive: form.isActive,
      };
      if (badge) {
        await api(`/badges/${badge.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/badges', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      toast(badge ? 'Insignia actualizada' : 'Insignia creada', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold m-0">
            {badge ? 'Editar insignia' : 'Nueva insignia'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0"
            style={{ background: `${form.color}22`, color: form.color }}
          >
            {form.icon}
          </div>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div>
              <label className="label">Icono</label>
              <input
                className="input text-center text-xl"
                maxLength={2}
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Color</label>
              <input
                type="color"
                className="input h-10 p-1"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Nombre</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="Cliente VIP"
          />
        </div>

        <div>
          <label className="label">Descripción</label>
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Cómo se gana esta insignia"
          />
        </div>

        <div>
          <label className="label">Criterio de desbloqueo</label>
          <select
            className="input"
            value={form.criteriaType}
            onChange={(e) =>
              setForm({ ...form, criteriaType: e.target.value as Criteria['type'] })
            }
          >
            {Object.entries(CRITERIA_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {needsThreshold && (
          <div>
            <label className="label">
              Umbral{' '}
              {form.criteriaType === 'CASHBACK_EARNED' ? '($)' : ''}
            </label>
            <input
              type="number"
              className="input"
              min={1}
              value={form.threshold}
              onChange={(e) =>
                setForm({ ...form, threshold: Number(e.target.value) })
              }
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">XP que regala</label>
            <input
              type="number"
              className="input"
              min={0}
              value={form.xpReward}
              onChange={(e) =>
                setForm({ ...form, xpReward: Number(e.target.value) })
              }
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
              <span className="text-sm">Activa</span>
            </label>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : badge ? 'Guardar' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
