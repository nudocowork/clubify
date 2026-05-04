'use client';
import { ReactNode } from 'react';
import { Icon } from './Icon';

type Variant = 'inline' | 'banner' | 'overlay';

type Props = {
  title?: string;
  description?: string;
  variant?: Variant;
  children?: ReactNode;
};

const DEFAULT_TITLE = 'En construcción';
const DEFAULT_DESC =
  'Estamos terminando esta función. Pronto disponible para todos los planes.';

export function UnderConstruction({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESC,
  variant = 'inline',
  children,
}: Props) {
  if (variant === 'banner') {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3 text-sm">
        <span className="text-base">🚧</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-amber-900">{title}</div>
          <div className="text-amber-800/90">{description}</div>
        </div>
      </div>
    );
  }

  if (variant === 'overlay') {
    return (
      <div className="relative">
        <div className="opacity-40 pointer-events-none select-none">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-card max-w-sm text-center px-6 py-5 ring-1 ring-amber-200">
            <div className="text-3xl mb-1">🚧</div>
            <div className="font-bold text-ink">{title}</div>
            <div className="text-sm text-mute mt-1">{description}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad text-center max-w-md mx-auto my-8">
      <div className="text-4xl mb-2">🚧</div>
      <div className="font-bold text-lg">{title}</div>
      <div className="text-sm text-mute mt-1.5 leading-relaxed">
        {description}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function ConstructionBadge({ label = 'En construcción' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
      🚧 {label}
    </span>
  );
}
