type IconName =
  | 'grid' | 'store' | 'card' | 'users' | 'pin' | 'bell' | 'gift' | 'qr'
  | 'trend-up' | 'check' | 'clock' | 'cash' | 'plus' | 'edit' | 'out'
  | 'search' | 'send' | 'history' | 'spark' | 'trash' | 'arrow-right'
  | 'apple' | 'google' | 'menu' | 'shopping-bag';

const PATHS: Record<IconName, JSX.Element> = {
  'grid': (<g><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></g>),
  'store': (<g><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/><path d="M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/></g>),
  'card': (<g><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/></g>),
  'users': (<g><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></g>),
  'pin': (<g><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></g>),
  'bell': (<g><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></g>),
  'gift': (<g><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5" rx="1"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></g>),
  'qr': (<g><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h2v2h-2zM18 14h3M14 18v3M18 18h3v3"/></g>),
  'trend-up': (<g><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></g>),
  'check': (<g><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></g>),
  'clock': (<g><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></g>),
  'cash': (<g><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></g>),
  'plus': (<g strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></g>),
  'edit': (<g><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></g>),
  'out': (<g><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></g>),
  'search': (<g><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></g>),
  'send': (<g><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></g>),
  'history': (<g><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></g>),
  'spark': (<g><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/></g>),
  'trash': (<g><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></g>),
  'arrow-right': (<g><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></g>),
  'apple': (<g fill="currentColor" stroke="none"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"/></g>),
  'google': (<g fill="currentColor" stroke="none"><path d="M21.35 11.1H12v3.8h5.36c-.5 2.4-2.6 4.1-5.36 4.1-3.31 0-6-2.69-6-6s2.69-6 6-6c1.5 0 2.85.55 3.9 1.45L18.5 5.6C16.74 4 14.46 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.18 0 8.6-3.64 8.6-8.78 0-.59-.06-1.16-.25-1.72z"/></g>),
  'menu': (<g><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></g>),
  'shopping-bag': (<g><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></g>),
};

export function Icon({
  name,
  size = 16,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
