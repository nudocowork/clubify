'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Position,
  Handle,
  type NodeProps,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StepEditor } from './StepEditor';
import { TriggersSection } from './TriggersSection';
import {
  type SequenceData,
  type SequenceStep,
  type SequenceTrigger,
  type StageOption,
  type StepKind,
  STEP_KIND_META,
} from './types';

// ─────────────────────────────────────────────────────────────────────
// Custom Node
// ─────────────────────────────────────────────────────────────────────

type StepNodeData = {
  kind: StepKind;
  preview: string;
  order: number;
  onEdit: () => void;
  onDelete: () => void;
};

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const meta = STEP_KIND_META[data.kind];
  return (
    <div
      className="rounded-input border-2 bg-bg shadow-sm p-3 min-w-[200px] max-w-[260px]"
      style={{ borderColor: meta.color }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: meta.color }}
      />
      <div className="flex items-start gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
          style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
        >
          {meta.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-mute font-semibold uppercase tracking-wide">
            Paso {data.order + 1}
          </div>
          <div className="text-sm font-semibold truncate">{meta.label}</div>
          {data.preview && (
            <div className="text-xs text-mute mt-1 line-clamp-2 break-words">
              {data.preview}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-1 mt-2 justify-end">
        <button
          type="button"
          className="text-xs text-brand hover:underline px-1"
          onClick={(e) => {
            e.stopPropagation();
            data.onEdit();
          }}
        >
          Editar
        </button>
        <button
          type="button"
          className="text-xs text-bad hover:underline px-1"
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete();
          }}
        >
          Eliminar
        </button>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: meta.color }}
      />
    </div>
  );
}

const nodeTypes = { stepNode: StepNode };

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function stepPreview(s: SequenceStep): string {
  switch (s.kind) {
    case 'SEND_MESSAGE':
      return (
        (s.messageBody?.slice(0, 60) ?? '') +
        ((s.messageBody?.length ?? 0) > 60 ? '…' : '') ||
        '(sin mensaje)'
      );
    case 'WAIT':
      return s.waitAmount && s.waitUnit
        ? `${s.waitAmount} ${unitLabel(s.waitUnit, s.waitAmount)}`
        : '(sin tiempo)';
    case 'MOVE_STAGE':
      return s.moveToStageId ? 'Mover a etapa' : '(sin etapa destino)';
    case 'ADD_TAG':
      return s.tags?.length ? s.tags.join(', ') : '(sin etiquetas)';
    case 'REMOVE_TAG':
      return s.tags?.length ? s.tags.join(', ') : '(sin etiquetas)';
    case 'ASSIGN_USER':
      return s.assignToUserId ? 'Cambiar asignación' : '(sin usuario)';
    case 'END':
      return 'Termina aquí';
  }
}

function unitLabel(unit: string, amount: number): string {
  const map: Record<string, [string, string]> = {
    MINUTES: ['minuto', 'minutos'],
    HOURS: ['hora', 'horas'],
    DAYS: ['día', 'días'],
    WEEKS: ['semana', 'semanas'],
  };
  const [singular, plural] = map[unit] ?? ['', ''];
  return amount === 1 ? singular : plural;
}

function emptyStep(kind: StepKind, order: number): SequenceStep {
  const base: SequenceStep = { order, kind };
  if (kind === 'SEND_MESSAGE') {
    base.messageChannel = 'SMS';
    base.messageType = 'TEXT';
    base.messageBody = '';
  }
  if (kind === 'WAIT') {
    base.waitAmount = 1;
    base.waitUnit = 'HOURS';
  }
  if (kind === 'ADD_TAG' || kind === 'REMOVE_TAG') {
    base.tags = [];
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────
// Main Builder
// ─────────────────────────────────────────────────────────────────────

export function SequenceBuilder({
  initialData,
  stages,
  onSave,
}: {
  initialData: SequenceData;
  stages: StageOption[];
  onSave: (data: SequenceData) => Promise<SequenceData>;
}) {
  const [name, setName] = useState(initialData.name);
  const [description, setDescription] = useState(
    initialData.description ?? '',
  );
  const [isActive, setIsActive] = useState(initialData.isActive);
  const [steps, setSteps] = useState<SequenceStep[]>(initialData.steps);
  const [triggers, setTriggers] = useState<SequenceTrigger[]>(
    initialData.triggers,
  );

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDirty(true);
  }, [name, description, isActive, steps, triggers]);

  // Reset dirty al cargar initial
  useEffect(() => {
    setDirty(false);
  }, [initialData]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Renumerar order para asegurar consistencia.
      const normalizedSteps = steps.map((s, idx) => ({ ...s, order: idx }));
      await onSave({
        ...initialData,
        name,
        description,
        isActive,
        steps: normalizedSteps,
        triggers,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [
    initialData,
    name,
    description,
    isActive,
    steps,
    triggers,
    onSave,
    saving,
  ]);

  const addStep = (kind: StepKind) => {
    setSteps((prev) => {
      const next = [...prev];
      const newStep = emptyStep(kind, next.length);
      // Posición autom en cascada vertical para xyflow.
      newStep.nodeX = 80;
      newStep.nodeY = next.length * 160 + 40;
      next.push(newStep);
      // Abrir editor automaticamente.
      setTimeout(() => setEditingIdx(next.length - 1), 50);
      return next;
    });
    setShowAddMenu(false);
  };

  const updateStep = (idx: number, partial: Partial<SequenceStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...partial } : s)));
  };

  const deleteStep = (idx: number) => {
    if (!confirm('Eliminar este paso?')) return;
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-input border border-line bg-bg p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input flex-1 text-lg font-semibold"
            placeholder="Nombre de la secuencia"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-brand"
            />
            <span className={isActive ? 'text-good' : 'text-mute'}>
              {isActive ? 'Activa' : 'Inactiva'}
            </span>
          </label>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Guardando…' : dirty ? 'Guardar' : '✓ Guardado'}
          </button>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input w-full text-sm"
          placeholder="Descripción opcional"
          rows={2}
        />
      </div>

      {/* Triggers */}
      <TriggersSection
        triggers={triggers}
        stages={stages}
        onChange={setTriggers}
      />

      {/* Flow */}
      <div className="rounded-input border border-line bg-bg overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-line">
          <div>
            <div className="font-semibold">Pasos del flujo</div>
            <div className="text-xs text-mute">
              {steps.length === 0
                ? 'Agrega el primer paso'
                : `${steps.length} pasos · se ejecutan en orden`}
            </div>
          </div>
          <div className="relative">
            <button
              className="btn-primary text-sm"
              onClick={() => setShowAddMenu(!showAddMenu)}
            >
              + Paso
            </button>
            {showAddMenu && (
              <AddStepMenu
                onPick={addStep}
                onClose={() => setShowAddMenu(false)}
              />
            )}
          </div>
        </div>

        {/* Mobile: lista vertical | Desktop: ReactFlow canvas */}
        <div className="block lg:hidden">
          <StepsListView
            steps={steps}
            onEdit={(i) => setEditingIdx(i)}
            onDelete={deleteStep}
            onReorder={(from, to) =>
              setSteps((prev) => {
                const next = [...prev];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                return next;
              })
            }
          />
        </div>
        <div className="hidden lg:block">
          <FlowCanvasView
            steps={steps}
            onEdit={(i) => setEditingIdx(i)}
            onDelete={deleteStep}
            onPositionChange={(idx, x, y) =>
              updateStep(idx, { nodeX: x, nodeY: y })
            }
          />
        </div>
      </div>

      {/* Step editor modal */}
      {editingIdx !== null && steps[editingIdx] && (
        <StepEditor
          step={steps[editingIdx]}
          stages={stages}
          onClose={() => setEditingIdx(null)}
          onSave={(updated) => {
            updateStep(editingIdx, updated);
            setEditingIdx(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AddStepMenu (palette)
// ─────────────────────────────────────────────────────────────────────

function AddStepMenu({
  onPick,
  onClose,
}: {
  onPick: (kind: StepKind) => void;
  onClose: () => void;
}) {
  const kinds: StepKind[] = [
    'SEND_MESSAGE',
    'WAIT',
    'MOVE_STAGE',
    'ADD_TAG',
    'REMOVE_TAG',
    'ASSIGN_USER',
    'END',
  ];
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-40 rounded-input border border-line bg-bg shadow-lg w-56 py-1">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            className="w-full text-left px-3 py-2 hover:bg-bg2 flex items-center gap-2"
            onClick={() => onPick(k)}
          >
            <span className="text-base">{STEP_KIND_META[k].emoji}</span>
            <span className="text-sm">{STEP_KIND_META[k].label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Mobile vista lista
// ─────────────────────────────────────────────────────────────────────

function StepsListView({
  steps,
  onEdit,
  onDelete,
  onReorder,
}: {
  steps: SequenceStep[];
  onEdit: (idx: number) => void;
  onDelete: (idx: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  if (steps.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-mute">
        Toca "+ Paso" para empezar
      </div>
    );
  }
  return (
    <ul className="p-3 space-y-2">
      {steps.map((s, idx) => {
        const meta = STEP_KIND_META[s.kind];
        return (
          <li
            key={idx}
            className="rounded-input border-l-4 border-line bg-bg2/40 p-3"
            style={{ borderLeftColor: meta.color }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                style={{
                  backgroundColor: `${meta.color}22`,
                  color: meta.color,
                }}
              >
                {meta.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-mute font-semibold uppercase tracking-wide">
                  Paso {idx + 1}
                </div>
                <div className="font-semibold text-sm">{meta.label}</div>
                <div className="text-xs text-mute mt-0.5 line-clamp-2 break-words">
                  {stepPreview(s)}
                </div>
              </div>
            </div>
            <div className="flex gap-1 mt-2 justify-end">
              {idx > 0 && (
                <button
                  className="btn-ghost text-xs"
                  onClick={() => onReorder(idx, idx - 1)}
                >
                  ↑
                </button>
              )}
              {idx < steps.length - 1 && (
                <button
                  className="btn-ghost text-xs"
                  onClick={() => onReorder(idx, idx + 1)}
                >
                  ↓
                </button>
              )}
              <button className="btn-ghost text-xs" onClick={() => onEdit(idx)}>
                Editar
              </button>
              <button
                className="btn-danger text-xs"
                onClick={() => onDelete(idx)}
              >
                Eliminar
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Desktop ReactFlow canvas
// ─────────────────────────────────────────────────────────────────────

function FlowCanvasView({
  steps,
  onEdit,
  onDelete,
  onPositionChange,
}: {
  steps: SequenceStep[];
  onEdit: (idx: number) => void;
  onDelete: (idx: number) => void;
  onPositionChange: (idx: number, x: number, y: number) => void;
}) {
  // Convertimos steps → nodes + edges. Linear: cada step se conecta al
  // siguiente por order.
  const nodes: Node<StepNodeData>[] = useMemo(
    () =>
      steps.map((s, idx) => ({
        id: `step-${idx}`,
        type: 'stepNode',
        position: { x: s.nodeX ?? 80, y: s.nodeY ?? idx * 160 + 40 },
        data: {
          kind: s.kind,
          preview: stepPreview(s),
          order: idx,
          onEdit: () => onEdit(idx),
          onDelete: () => onDelete(idx),
        },
      })),
    [steps, onEdit, onDelete],
  );

  const edges: Edge[] = useMemo(
    () =>
      steps.slice(0, -1).map((_, idx) => ({
        id: `edge-${idx}`,
        source: `step-${idx}`,
        target: `step-${idx + 1}`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [steps],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((c) => {
        if (c.type === 'position' && c.position) {
          const idx = parseInt(c.id.replace('step-', ''), 10);
          if (!Number.isNaN(idx)) {
            onPositionChange(idx, c.position.x, c.position.y);
          }
        }
      });
    },
    [onPositionChange],
  );

  if (steps.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-sm text-mute">
        Toca "+ Paso" para empezar
      </div>
    );
  }

  return (
    <div style={{ height: 500 }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.4}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
