'use client';

/**
 * Placeholder simple para los previews de dashboard cuando no hay datos
 * todavía (loading inicial, endpoint nuevo sin data, etc).
 */

export function EmptyState({
  text,
  icon = 'spark',
}: {
  text: string;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-mute">
      <div className="text-2xl opacity-60" aria-hidden>
        {icon === 'spark' ? '✨' : icon === 'chart' ? '📊' : '📭'}
      </div>
      <div className="text-sm">{text}</div>
    </div>
  );
}
