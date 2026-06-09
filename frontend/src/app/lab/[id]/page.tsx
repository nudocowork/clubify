'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  CATEGORY_META,
  PRIORITY_META,
  STATUS_META,
  VOTE_META,
  formatRelative,
  type LabVoteKind,
  type ProposalDetail,
} from '../_shared';

// Fix 2026-06-08: Next.js 14.2.x recibe `params` como objeto plain, no
// como Promise. El patrón `use(params)` (Next 15+) crasheaba la página
// con React error #438 al renderizar /lab/<id>. La página entraba al
// ErrorBoundary ("Algo salió mal"). Volvemos a la firma plana.
export default function LabDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [data, setData] = useState<ProposalDetail | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await api<ProposalDetail>(`/lab/proposals/${id}`);
      setData(d);
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando propuesta', 'error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function vote(kind: LabVoteKind) {
    if (!data || busy) return;
    setBusy(true);
    try {
      // Si ya votó por este mismo kind, lo quitamos. Sino lo cambiamos.
      if (data.myVote?.kind === kind) {
        await api(`/lab/proposals/${id}/vote`, { method: 'DELETE' });
      } else {
        await api(`/lab/proposals/${id}/vote`, {
          method: 'POST',
          body: JSON.stringify({ kind }),
        });
      }
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Error registrando voto', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/lab/proposals/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      setCommentBody('');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Error publicando comentario', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-mute text-sm">Cargando...</p>;

  const meta = STATUS_META[data.status];
  const cat = CATEGORY_META[data.category];

  return (
    <div>
      <Link
        href="/lab"
        className="text-mute hover:text-ink text-sm inline-block mb-4"
      >
        ← Volver a propuestas
      </Link>

      <div className="grid lg:grid-cols-[1fr,300px] gap-6">
        <div>
          <div className="card card-pad mb-4">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`badge ${meta.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
              <span className="badge badge-mute">
                {cat.emoji} {cat.label}
              </span>
              <span
                className={`badge badge-mute ${PRIORITY_META[data.priority].color}`}
              >
                Prioridad: {PRIORITY_META[data.priority].label}
              </span>
            </div>
            <h1 className="text-2xl font-bold m-0 mb-2">{data.title}</h1>
            <div className="text-xs text-mute2 mb-4">
              Por <b>{data.author.fullName}</b> ·{' '}
              {formatRelative(data.createdAt)}
            </div>
            <p className="whitespace-pre-wrap text-ink leading-relaxed">
              {data.description}
            </p>
            {data.expectedBenefit && (
              <div className="mt-4 p-3 bg-bg2 rounded-lg">
                <div className="text-xs font-semibold text-mute uppercase tracking-wide mb-1">
                  Beneficio esperado
                </div>
                <p className="text-sm whitespace-pre-wrap m-0">
                  {data.expectedBenefit}
                </p>
              </div>
            )}
            {data.attachmentUrl && (
              <div className="mt-4">
                <a
                  href={data.attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand text-sm hover:underline"
                >
                  📎 Ver adjunto
                </a>
              </div>
            )}
            {data.rejectionReason && data.status === 'REJECTED' && (
              <div className="mt-4 p-3 bg-bad-soft text-bad-ink rounded-lg text-sm">
                <b>Motivo de rechazo:</b> {data.rejectionReason}
              </div>
            )}
          </div>

          <div className="card card-pad mb-4">
            <h3 className="font-bold m-0 mb-3 text-sm uppercase tracking-wide text-mute">
              Tu voto
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(VOTE_META) as LabVoteKind[]).map((k) => {
                const isMine = data.myVote?.kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => vote(k)}
                    disabled={busy}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer ${
                      isMine
                        ? 'border-brand bg-brand/10'
                        : 'border-line hover:border-brand/50'
                    }`}
                  >
                    <div className="text-2xl">{VOTE_META[k].emoji}</div>
                    <div className="text-xs font-medium mt-1">
                      {VOTE_META[k].label}
                    </div>
                    <div className="text-[10px] text-mute2 mt-0.5">
                      {VOTE_META[k].description} · {data.voteBreakdown[k]}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-mute2 mt-3">
              Total: <b>{data.votesCount}</b> votos · Score:{' '}
              <b>{data.votesScore}</b> puntos
            </div>
          </div>

          <div className="card card-pad">
            <h3 className="font-bold m-0 mb-4 text-sm uppercase tracking-wide text-mute">
              Comentarios ({data.commentsCount})
            </h3>
            <div className="grid gap-3 mb-4">
              {data.comments.length === 0 && (
                <p className="text-mute text-sm m-0">
                  Aún no hay comentarios. ¡Sé el primero!
                </p>
              )}
              {data.comments.map((c) => (
                <div key={c.id} className="border-b border-line pb-3 last:border-0">
                  <div className="text-xs text-mute2 mb-1">
                    <b className="text-ink">{c.author.fullName}</b> ·{' '}
                    {formatRelative(c.createdAt)}
                  </div>
                  <p className="text-sm whitespace-pre-wrap m-0">{c.body}</p>
                </div>
              ))}
            </div>
            <form onSubmit={submitComment} className="grid gap-2">
              <textarea
                className="input min-h-[80px]"
                placeholder="Comparte tu opinión sobre esta propuesta..."
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                maxLength={2000}
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={busy || !commentBody.trim()}
                >
                  Comentar
                </button>
              </div>
            </form>
          </div>
        </div>

        <aside className="grid gap-4 content-start">
          <div className="card card-pad">
            <h3 className="font-bold m-0 mb-3 text-sm uppercase tracking-wide text-mute">
              Estado actual
            </h3>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <b>{meta.label}</b>
            </div>
            {data.lastStatusChangedAt && (
              <p className="text-xs text-mute2 m-0">
                Actualizado {formatRelative(data.lastStatusChangedAt)}
                {data.lastStatusChangedBy
                  ? ` por ${data.lastStatusChangedBy.fullName}`
                  : ''}
              </p>
            )}
          </div>

          <div className="card card-pad">
            <h3 className="font-bold m-0 mb-3 text-sm uppercase tracking-wide text-mute">
              Etapas del roadmap
            </h3>
            <ul className="grid gap-2 text-xs">
              {(
                [
                  'EVALUATING',
                  'APPROVED',
                  'IN_DEVELOPMENT',
                  'IN_TESTING',
                  'IMPLEMENTED',
                ] as const
              ).map((s) => {
                const m = STATUS_META[s];
                const isCurrent = s === data.status;
                return (
                  <li
                    key={s}
                    className={`flex items-center gap-2 ${isCurrent ? 'font-bold text-ink' : 'text-mute2'}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${m.dot}`} />
                    {m.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
