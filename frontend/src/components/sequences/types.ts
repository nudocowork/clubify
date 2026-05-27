/**
 * Tipos compartidos del módulo de Secuencias (F4 — Flow Builder UI).
 */

export type StepKind =
  | 'SEND_MESSAGE'
  | 'WAIT'
  | 'MOVE_STAGE'
  | 'ADD_TAG'
  | 'REMOVE_TAG'
  | 'ASSIGN_USER'
  | 'END';

export type MessageChannel = 'SMS' | 'WHATSAPP';
export type MessageType = 'TEXT' | 'AUDIO' | 'VIDEO' | 'PDF' | 'IMAGE';
export type WaitUnit = 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS';

export type TriggerKind =
  | 'MANUAL'
  | 'CONTACT_CREATED'
  | 'STAGE_CHANGED'
  | 'TAG_ADDED'
  | 'CONTACT_FROM_GB';

export interface SequenceStep {
  id?: string;
  order: number;
  kind: StepKind;
  messageChannel?: MessageChannel | null;
  messageType?: MessageType | null;
  messageBody?: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  waitAmount?: number | null;
  waitUnit?: WaitUnit | null;
  moveToStageId?: string | null;
  tags?: string[];
  assignToUserId?: string | null;
  nodeX?: number | null;
  nodeY?: number | null;
}

export interface SequenceTrigger {
  id?: string;
  kind: TriggerKind;
  config?: Record<string, any>;
  isActive?: boolean;
}

export interface SequenceData {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  steps: SequenceStep[];
  triggers: SequenceTrigger[];
}

export interface StageOption {
  id: string;
  name: string;
  color: string;
}

// ───────────── Constantes UI ─────────────

export const STEP_KIND_META: Record<
  StepKind,
  { label: string; emoji: string; color: string }
> = {
  SEND_MESSAGE: { label: 'Enviar mensaje', emoji: '💬', color: '#3B82F6' },
  WAIT: { label: 'Esperar', emoji: '⏱️', color: '#F59E0B' },
  MOVE_STAGE: { label: 'Cambiar etapa', emoji: '🔄', color: '#10B981' },
  ADD_TAG: { label: 'Agregar etiqueta', emoji: '🏷️', color: '#A855F7' },
  REMOVE_TAG: { label: 'Quitar etiqueta', emoji: '❌', color: '#EF4444' },
  ASSIGN_USER: { label: 'Asignar a usuario', emoji: '👤', color: '#06B6D4' },
  END: { label: 'Finalizar', emoji: '🏁', color: '#6B7280' },
};

export const TRIGGER_KIND_META: Record<
  TriggerKind,
  { label: string; emoji: string; description: string }
> = {
  MANUAL: {
    label: 'Manual',
    emoji: '👆',
    description: 'Inscribís contactos uno a uno desde el kanban.',
  },
  CONTACT_CREATED: {
    label: 'Cuando entra un contacto',
    emoji: '✨',
    description: 'Apenas se crea un contacto en tu CRM.',
  },
  STAGE_CHANGED: {
    label: 'Cuando cambia de etapa',
    emoji: '🔄',
    description: 'Cuando un contacto se mueve a una etapa específica.',
  },
  TAG_ADDED: {
    label: 'Cuando se agrega una etiqueta',
    emoji: '🏷️',
    description: 'Cuando se agrega una etiqueta específica al contacto.',
  },
  CONTACT_FROM_GB: {
    label: 'Sincronizado desde Grow Business',
    emoji: '🔗',
    description: 'Contactos nuevos que llegan vía sync de Grow Business.',
  },
};

export const WAIT_UNIT_LABELS: Record<WaitUnit, string> = {
  MINUTES: 'minutos',
  HOURS: 'horas',
  DAYS: 'días',
  WEEKS: 'semanas',
};
