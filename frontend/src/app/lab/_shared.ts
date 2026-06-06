// Shared types + constants para las pages de Clubify Lab. No es route
// (filename empieza con _ → ignorado por Next).

export type LabCategory = 'CLIENTS' | 'AFFILIATES';
export type LabPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type LabStatus =
  | 'PENDING'
  | 'REJECTED'
  | 'EVALUATING'
  | 'APPROVED'
  | 'IN_DEVELOPMENT'
  | 'IN_TESTING'
  | 'IMPLEMENTED';
export type LabVoteKind = 'LIKE' | 'NEED' | 'HIGH_PRIORITY' | 'DISLIKE';

export type Proposal = {
  id: string;
  title: string;
  description: string;
  category: LabCategory;
  priority: LabPriority;
  expectedBenefit: string | null;
  status: LabStatus;
  attachmentUrl: string | null;
  attachmentKind: string | null;
  votesScore: number;
  votesCount: number;
  commentsCount: number;
  rejectionReason: string | null;
  lastStatusChangedAt: string | null;
  lastStatusChangedBy?: { id: string; fullName: string } | null;
  author: { id: string; fullName: string; role: string; email?: string };
  createdAt: string;
};

export type ProposalDetail = Proposal & {
  myVote: { kind: LabVoteKind } | null;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; fullName: string; role: string };
  }>;
  voteBreakdown: Record<LabVoteKind, number>;
};

export const STATUS_META: Record<
  LabStatus,
  { label: string; badge: string; dot: string }
> = {
  PENDING: { label: 'Pendiente', badge: 'badge-mute', dot: 'bg-gray-400' },
  REJECTED: { label: 'Rechazada', badge: 'badge-bad', dot: 'bg-red-500' },
  EVALUATING: { label: 'En evaluación', badge: 'badge-warn', dot: 'bg-yellow-500' },
  APPROVED: { label: 'Aprobada', badge: 'badge-warn', dot: 'bg-orange-500' },
  IN_DEVELOPMENT: { label: 'En desarrollo', badge: 'badge-info', dot: 'bg-blue-500' },
  IN_TESTING: { label: 'En pruebas', badge: 'badge-info', dot: 'bg-purple-500' },
  IMPLEMENTED: { label: 'Implementada', badge: 'badge-ok', dot: 'bg-green-500' },
};

export const CATEGORY_META: Record<
  LabCategory,
  { label: string; emoji: string }
> = {
  CLIENTS: { label: 'Para negocios', emoji: '🏢' },
  AFFILIATES: { label: 'Para embajadores', emoji: '👥' },
};

export const PRIORITY_META: Record<LabPriority, { label: string; color: string }> = {
  LOW: { label: 'Baja', color: 'text-gray-500' },
  MEDIUM: { label: 'Media', color: 'text-blue-600' },
  HIGH: { label: 'Alta', color: 'text-orange-600' },
  CRITICAL: { label: 'Crítica', color: 'text-red-600' },
};

export const VOTE_META: Record<
  LabVoteKind,
  { label: string; emoji: string; description: string }
> = {
  LIKE: { label: 'Me gusta', emoji: '👍', description: '+1' },
  NEED: { label: 'La necesito', emoji: '❤️', description: '+3' },
  HIGH_PRIORITY: { label: 'Alta prioridad', emoji: '🔥', description: '+5' },
  DISLIKE: { label: 'No la necesito', emoji: '👎', description: '−2' },
};

export function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `hace ${days} d`;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
