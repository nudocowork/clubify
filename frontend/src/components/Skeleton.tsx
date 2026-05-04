/**
 * Skeleton placeholder con animación shimmer. Reemplaza textos "Cargando…"
 * por algo visual que indica estructura mientras carga.
 */
export function Skeleton({
  className = '',
  rounded = 'rounded-lg',
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      className={`bg-gradient-to-r from-bg2 via-line/40 to-bg2 bg-[length:200%_100%] animate-shimmer ${rounded} ${className}`}
    />
  );
}

export function KpiSkeleton() {
  return (
    <div className="kpi">
      <Skeleton className="h-3 w-24 mb-2" />
      <Skeleton className="h-8 w-16 mb-1" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function RowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <tr className="border-t border-line2">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <Skeleton className="h-4 w-full max-w-[140px]" />
        </td>
      ))}
    </tr>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-pad">
      <Skeleton className="h-5 w-1/3 mb-3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full mb-2" />
      ))}
    </div>
  );
}
