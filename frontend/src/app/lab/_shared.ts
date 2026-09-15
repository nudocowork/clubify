// Shared types + constants para las pages del Lab. No es route
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

/**
 * Quién mira el Lab. Lo decide el backend (`lab-access.ts`), no la URL: el
 * equipo de la plataforma modera todas las marcas, y en una marca blanca solo
 * entra su administrador general.
 */
export type LabAlcance = 'PLATAFORMA_EQUIPO' | 'PLATAFORMA_MIEMBRO' | 'MARCA_ADMIN';

/** Marca de una propuesta, para la etiqueta de la moderación. */
export type EtiquetaMarca = {
  id: string;
  name: string;
  primaryColor: string | null;
};

export type LabContexto = {
  alcance: LabAlcance;
  /**
   * Sesión suplantada desde el panel maestro: se ve el Lab, pero no se propone,
   * vota ni comenta, porque saldría a nombre del administrador real.
   */
  soloLectura?: boolean;
  /** null = marca sin resolver: textos neutros, nunca un nombre inventado. */
  marca: {
    name: string;
    slug: string;
    primaryColor: string | null;
    logoUrl: string | null;
  } | null;
};

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
  /** Solo en la moderación: la marca blanca de la propuesta. null = Clubify o sin marca. */
  brand?: EtiquetaMarca | null;
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
  /** false = propuesta de otra marca: se ve, pero no se vota ni se comenta. */
  canParticipate?: boolean;
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

/**
 * El color de una marca, solo si es un hex válido. Viene de la base y se pinta
 * en `style`: un valor raro no debe colarse en el CSS.
 */
export function colorDeMarca(color: string | null | undefined): string | null {
  return color && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)
    ? color
    : null;
}

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
