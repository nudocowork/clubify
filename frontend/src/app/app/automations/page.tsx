'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Rule = {
  id: string;
  name: string;
  description: string;
  trigger: { type: string; days?: number };
  conditions: any[];
  actions: any[];
  isActive: boolean;
  stats?: { runs?: number; lastRunAt?: string };
};

type TemplateBackend = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: 'fidelizacion' | 'reactivacion' | 'ocasion';
  trigger: { type: string; days?: number };
  conditions?: any[];
  actions: any[];
};

const TRIGGERS = [
  { type: 'ORDER_CREATED', labelKey: 'triggerOrderCreated' },
  { type: 'ORDER_CONFIRMED', labelKey: 'triggerOrderConfirmed' },
  { type: 'ORDER_DELIVERED', labelKey: 'triggerOrderDelivered' },
  { type: 'PASS_CREATED', labelKey: 'triggerPassCreated' },
  { type: 'PASS_COMPLETED', labelKey: 'triggerPassCompleted' },
  { type: 'STAMP_ADDED', labelKey: 'triggerStampAdded' },
  { type: 'NEAR_REWARD', labelKey: 'triggerNearReward' },
  { type: 'REWARD_REDEEMED', labelKey: 'triggerRewardRedeemed' },
  { type: 'COUPON_REDEEMED', labelKey: 'triggerCouponRedeemed' },
  { type: 'INACTIVITY', labelKey: 'triggerInactivity' },
  { type: 'BIRTHDAY', labelKey: 'triggerBirthday' },
  { type: 'GEO_ENTER', labelKey: 'triggerGeoEnter' },
];

const CATEGORY_LABEL_KEY: Record<TemplateBackend['category'], string> = {
  fidelizacion: 'categoryFidelizacion',
  reactivacion: 'categoryReactivacion',
  ocasion: 'categoryOcasion',
};

export default function AutomationsPage() {
  const t = useTranslations('app_automations');
  const [list, setList] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<TemplateBackend[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);

  async function load() {
    try {
      setList(await api('/automations'));
    } catch {
      setList([]);
    }
  }
  useEffect(() => {
    api<TemplateBackend[]>('/automations/templates')
      .then(setTemplates)
      .catch(() => setTemplates([]));
    load();
  }, []);

  async function createFromTemplate(tpl: TemplateBackend) {
    try {
      await api(`/automations/from-template/${tpl.id}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast(t('toastRuleCreated', { name: tpl.name }), 'success');
      setShowTemplates(false);
      load();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
    }
  }

  async function save(r: Partial<Rule>) {
    const body = {
      name: r.name,
      description: r.description,
      trigger: r.trigger,
      conditions: r.conditions ?? [],
      actions: r.actions ?? [],
      isActive: r.isActive ?? true,
    };
    if (r.id) {
      await api(`/automations/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } else {
      await api('/automations', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
    setEditing(null);
    load();
  }

  async function toggle(r: Rule) {
    await api(`/automations/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !r.isActive }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    await api(`/automations/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">{t('crumbRules', { count: list.length })}</span>
        </h1>
        <div className="flex gap-2">
          <Link className="btn-ghost" href="/app/automations/workflows">
            <Icon name="spark" /> Workflows
          </Link>
          <button
            className="btn-ghost"
            onClick={() => setShowTemplates(true)}
          >
            <Icon name="spark" /> {t('templates')}
          </button>
          <button
            className="btn-primary"
            onClick={() =>
              setEditing({
                name: '',
                description: '',
                trigger: { type: 'ORDER_CONFIRMED' },
                conditions: [],
                actions: [{ type: 'SEND_PUSH', title: '', body: '' }],
                isActive: true,
              })
            }
          >
            <Icon name="plus" /> {t('newRule')}
          </button>
        </div>
      </div>

      {list.length === 0 && templates.length > 0 && (
        <div className="card card-pad mb-5 bg-brand/5 border-brand/30">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚡</span>
            <div className="flex-1">
              <h3 className="text-base font-semibold m-0">
                {t('starterTitle')}
              </h3>
              <p className="text-mute text-sm mt-1">
                {t('starterDesc', { count: templates.length })}
              </p>
              <button
                className="btn-primary mt-3"
                onClick={() => setShowTemplates(true)}
              >
                {t('starterCta', { count: templates.length })}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {list.map((r) => (
          <div key={r.id} className="card card-pad">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Icon name="spark" size={16} className="text-brand" />
                  <div className="font-semibold">{r.name}</div>
                </div>
                <div className="text-xs text-mute mt-1">{r.description}</div>
                <div className="flex flex-wrap gap-2 mt-3 text-xs">
                  <span className="badge badge-info">
                    {t('whenPrefix')}: {r.trigger.type}
                    {r.trigger.days ? ` (${r.trigger.days}d)` : ''}
                  </span>
                  {r.actions.map((a, i) => (
                    <span key={i} className="badge badge-mute">
                      → {a.type}
                    </span>
                  ))}
                  <span className="badge badge-mute">
                    {t('runsCount', { count: r.stats?.runs ?? 0 })}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 items-end">
                <span
                  className={`badge ${r.isActive ? 'badge-ok' : 'badge-mute'}`}
                >
                  {r.isActive ? t('statusActive') : t('statusPaused')}
                </span>
              </div>
            </div>
            <div className="mt-3 flex gap-3 text-xs">
              <button className="btn-link" onClick={() => setEditing(r)}>
                {t('edit')}
              </button>
              <button className="btn-link" onClick={() => toggle(r)}>
                {r.isActive ? t('pause') : t('activate')}
              </button>
              <button
                className="text-bad underline ml-auto"
                onClick={() => remove(r.id)}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <RuleDrawer
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}

      {showTemplates && (
        <TemplatesModal
          templates={templates}
          existingTriggers={new Set(list.map((r) => r.trigger?.type))}
          onPick={createFromTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  );
}

function TemplatesModal({
  templates,
  existingTriggers,
  onPick,
  onClose,
}: {
  templates: TemplateBackend[];
  existingTriggers: Set<string>;
  onPick: (tpl: TemplateBackend) => void;
  onClose: () => void;
}) {
  const t = useTranslations('app_automations');
  const grouped = templates.reduce<Record<string, TemplateBackend[]>>((acc, tpl) => {
    (acc[tpl.category] = acc[tpl.category] || []).push(tpl);
    return acc;
  }, {});
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
          <div>
            <h2 className="text-lg font-bold m-0">{t('templatesModalTitle')}</h2>
            <p className="text-xs text-mute mt-0.5">
              {t('templatesModalSubtitle')}
            </p>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="space-y-5">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {CATEGORY_LABEL_KEY[cat as TemplateBackend['category']]
                  ? t(CATEGORY_LABEL_KEY[cat as TemplateBackend['category']])
                  : cat}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {items.map((tpl) => {
                  const exists = existingTriggers.has(tpl.trigger.type);
                  return (
                    <div
                      key={tpl.id}
                      className="card p-3 flex items-start gap-3"
                    >
                      <div className="text-2xl shrink-0">{tpl.emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{tpl.name}</div>
                        <div className="text-xs text-mute mt-0.5 leading-snug">
                          {tpl.description}
                        </div>
                        <button
                          onClick={() => onPick(tpl)}
                          disabled={exists}
                          className={`text-xs mt-2 font-semibold ${
                            exists
                              ? 'text-mute cursor-not-allowed'
                              : 'text-brand hover:underline'
                          }`}
                        >
                          {exists ? t('alreadyHasTrigger') : t('activate')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RuleDrawer({
  value,
  onCancel,
  onSave,
}: {
  value: Partial<Rule>;
  onCancel: () => void;
  onSave: (r: Partial<Rule>) => void;
}) {
  const t = useTranslations('app_automations');
  const [form, setForm] = useState<Partial<Rule>>(value);

  function update<K extends keyof Rule>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }

  function setTrigger(type: string) {
    setForm({ ...form, trigger: { type } });
  }

  function updateAction(i: number, patch: any) {
    const arr = [...(form.actions ?? [])];
    arr[i] = { ...arr[i], ...patch };
    update('actions', arr);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-ink/50" onClick={onCancel} />
      <div className="w-full max-w-md bg-white h-full overflow-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {form.id ? t('editRule') : t('newRule')}
          </h2>
          <button onClick={onCancel} className="text-mute hover:text-ink">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">{t('labelName')}</label>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('labelDescription')}</label>
            <input
              className="input"
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          <div>
            <label className="label">{t('labelWhenHappens')}</label>
            <select
              className="input"
              value={form.trigger?.type ?? 'ORDER_CONFIRMED'}
              onChange={(e) => setTrigger(e.target.value)}
            >
              {TRIGGERS.map((trg) => (
                <option key={trg.type} value={trg.type}>
                  {t(trg.labelKey)}
                </option>
              ))}
            </select>
            {form.trigger?.type === 'INACTIVITY' && (
              <input
                type="number"
                className="input mt-2"
                placeholder={t('placeholderInactivityDays')}
                value={form.trigger?.days ?? 7}
                onChange={(e) =>
                  update('trigger', {
                    type: 'INACTIVITY',
                    days: Number(e.target.value),
                  })
                }
              />
            )}
          </div>

          <div>
            <label className="label">{t('labelActions')}</label>
            {(form.actions ?? []).map((a, i) => (
              <div key={i} className="border border-line2 rounded-lg p-3 mb-2">
                <select
                  className="input mb-2"
                  value={a.type}
                  onChange={(e) => updateAction(i, { type: e.target.value })}
                >
                  <option value="SEND_PUSH">{t('actionSendPush')}</option>
                  <option value="SEND_SMS">SMS</option>
                  <option value="SEND_WHATSAPP">WhatsApp</option>
                  <option value="ADD_STAMPS">{t('actionAddStamps')}</option>
                </select>
                {a.type === 'SEND_PUSH' && (
                  <>
                    <input
                      className="input mb-2"
                      placeholder={t('placeholderTitle')}
                      value={a.title ?? ''}
                      onChange={(e) => updateAction(i, { title: e.target.value })}
                    />
                    <textarea
                      className="input"
                      placeholder={t('placeholderBody')}
                      value={a.body ?? ''}
                      onChange={(e) => updateAction(i, { body: e.target.value })}
                    />
                  </>
                )}
                {(a.type === 'SEND_SMS' || a.type === 'SEND_WHATSAPP') && (
                  <>
                    <textarea
                      className="input"
                      placeholder="Mensaje… puedes usar {{customerName}}, {{businessName}}…"
                      value={a.body ?? ''}
                      onChange={(e) => updateAction(i, { body: e.target.value })}
                    />
                    <p className="text-xs text-mute mt-1">
                      Se envía al teléfono del cliente desde la subcuenta de Grow
                      Business del negocio (o, si no tiene, la de su marca). Si no
                      hay ninguna configurada, no se envía.
                    </p>
                  </>
                )}
                {a.type === 'ADD_STAMPS' && (
                  <input
                    type="number"
                    className="input"
                    placeholder={t('placeholderStampCount')}
                    value={a.amount ?? 1}
                    onChange={(e) =>
                      updateAction(i, { amount: Number(e.target.value) })
                    }
                  />
                )}
              </div>
            ))}
            <button
              className="btn-link text-xs"
              onClick={() =>
                update('actions', [
                  ...(form.actions ?? []),
                  { type: 'SEND_PUSH', title: '', body: '' },
                ])
              }
            >
              {t('addAction')}
            </button>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            className="btn-primary flex-1 justify-center"
            onClick={() => onSave(form)}
          >
            <Icon name="check" /> {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
