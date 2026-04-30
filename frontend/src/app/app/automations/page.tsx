'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

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

const TRIGGERS = [
  { type: 'ORDER_CREATED', label: 'Pedido recibido' },
  { type: 'ORDER_CONFIRMED', label: 'Pedido confirmado' },
  { type: 'ORDER_DELIVERED', label: 'Pedido entregado' },
  { type: 'PASS_COMPLETED', label: 'Tarjeta completada (recompensa lista)' },
  { type: 'INACTIVITY', label: 'Cliente inactivo X días' },
  { type: 'BIRTHDAY', label: 'Cumpleaños del cliente' },
  { type: 'GEO_ENTER', label: 'Cliente cerca del local' },
];

const RECIPES: Partial<Rule>[] = [
  {
    name: 'Agradecer pedido confirmado',
    description: 'Mensaje de WhatsApp al cliente cuando confirmas su pedido.',
    trigger: { type: 'ORDER_CONFIRMED' },
    conditions: [],
    actions: [
      {
        type: 'SEND_WHATSAPP_LINK',
        body:
          '¡Gracias {{nombre}}! Tu pedido #{{order_code}} está confirmado. 🙌',
      },
    ],
  },
  {
    name: 'Recompensa lista',
    description: 'Avisa al cliente que llegó al tope de sellos.',
    trigger: { type: 'PASS_COMPLETED' },
    conditions: [],
    actions: [
      {
        type: 'SEND_WHATSAPP_LINK',
        body:
          '🎉 ¡{{nombre}}! Llegaste a 10 sellos. Tu recompensa te espera. Pásate cuando puedas.',
      },
    ],
  },
  {
    name: 'Recuperar inactivo 7 días',
    description: 'Mensaje a clientes que no piden hace 7 días.',
    trigger: { type: 'INACTIVITY', days: 7 },
    conditions: [],
    actions: [
      {
        type: 'SEND_WHATSAPP_LINK',
        body:
          'Te extrañamos {{nombre}}. Vuelve esta semana y te regalamos 2 sellos extra. ☕',
      },
    ],
  },
];

export default function AutomationsPage() {
  const [list, setList] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);

  async function load() {
    setList(await api('/automations'));
  }
  useEffect(() => {
    load();
  }, []);

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
    if (!confirm('¿Eliminar regla?')) return;
    await api(`/automations/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Automatizaciones <span className="page-crumb">/ {list.length} reglas</span>
        </h1>
        <button
          className="btn-primary"
          onClick={() =>
            setEditing({
              name: '',
              description: '',
              trigger: { type: 'ORDER_CONFIRMED' },
              conditions: [],
              actions: [{ type: 'SEND_WHATSAPP_LINK', body: '' }],
              isActive: true,
            })
          }
        >
          <Icon name="plus" /> Nueva regla
        </button>
      </div>

      {/* Recetas */}
      {list.length === 0 && (
        <div className="card card-pad mb-5">
          <h3 className="text-base font-semibold m-0">Recetas para empezar</h3>
          <p className="text-mute text-sm mt-1">
            Activa una regla con un click. Después la puedes personalizar.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            {RECIPES.map((r) => (
              <div key={r.name} className="border border-line2 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Icon name="spark" size={16} className="text-brand" />
                  <div className="font-medium text-sm">{r.name}</div>
                </div>
                <div className="text-xs text-mute mt-1">{r.description}</div>
                <button
                  className="btn-link text-xs mt-2"
                  onClick={() => setEditing({ ...r })}
                >
                  Usar receta →
                </button>
              </div>
            ))}
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
                    Cuando: {r.trigger.type}
                    {r.trigger.days ? ` (${r.trigger.days}d)` : ''}
                  </span>
                  {r.actions.map((a, i) => (
                    <span key={i} className="badge badge-mute">
                      → {a.type}
                    </span>
                  ))}
                  <span className="badge badge-mute">
                    {r.stats?.runs ?? 0} ejecuciones
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 items-end">
                <span
                  className={`badge ${r.isActive ? 'badge-ok' : 'badge-mute'}`}
                >
                  {r.isActive ? 'Activa' : 'Pausa'}
                </span>
              </div>
            </div>
            <div className="mt-3 flex gap-3 text-xs">
              <button className="btn-link" onClick={() => setEditing(r)}>
                Editar
              </button>
              <button className="btn-link" onClick={() => toggle(r)}>
                {r.isActive ? 'Pausar' : 'Activar'}
              </button>
              <button
                className="text-bad underline ml-auto"
                onClick={() => remove(r.id)}
              >
                Eliminar
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
            {form.id ? 'Editar regla' : 'Nueva regla'}
          </h2>
          <button onClick={onCancel} className="text-mute hover:text-ink">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Descripción</label>
            <input
              className="input"
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          <div>
            <label className="label">Cuando ocurra...</label>
            <select
              className="input"
              value={form.trigger?.type ?? 'ORDER_CONFIRMED'}
              onChange={(e) => setTrigger(e.target.value)}
            >
              {TRIGGERS.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
            {form.trigger?.type === 'INACTIVITY' && (
              <input
                type="number"
                className="input mt-2"
                placeholder="Días de inactividad"
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
            <label className="label">Acciones</label>
            {(form.actions ?? []).map((a, i) => (
              <div key={i} className="border border-line2 rounded-lg p-3 mb-2">
                <select
                  className="input mb-2"
                  value={a.type}
                  onChange={(e) => updateAction(i, { type: e.target.value })}
                >
                  <option value="SEND_WHATSAPP_LINK">Enviar WhatsApp (link)</option>
                  <option value="SEND_PUSH">Enviar push a Wallet</option>
                  <option value="ADD_STAMPS">Sumar sellos</option>
                </select>
                {a.type === 'SEND_WHATSAPP_LINK' && (
                  <textarea
                    className="input"
                    placeholder="Mensaje. Variables: {{nombre}}, {{order_code}}"
                    value={a.body ?? ''}
                    onChange={(e) => updateAction(i, { body: e.target.value })}
                  />
                )}
                {a.type === 'SEND_PUSH' && (
                  <>
                    <input
                      className="input mb-2"
                      placeholder="Título"
                      value={a.title ?? ''}
                      onChange={(e) => updateAction(i, { title: e.target.value })}
                    />
                    <textarea
                      className="input"
                      placeholder="Cuerpo"
                      value={a.body ?? ''}
                      onChange={(e) => updateAction(i, { body: e.target.value })}
                    />
                  </>
                )}
                {a.type === 'ADD_STAMPS' && (
                  <input
                    type="number"
                    className="input"
                    placeholder="Cantidad de sellos"
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
                  { type: 'SEND_WHATSAPP_LINK', body: '' },
                ])
              }
            >
              + acción
            </button>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn-primary flex-1 justify-center"
            onClick={() => onSave(form)}
          >
            <Icon name="check" /> Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
