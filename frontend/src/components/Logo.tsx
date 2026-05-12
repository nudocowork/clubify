'use client';
import Image from 'next/image';

/**
 * Logo oficial de Clubify.
 * - `variant="full"`  → lockup completo (C squircle + "Clubify"), para headers,
 *                       footers, signup/login, landing.
 * - `variant="mark"`  → solo el ícono cuadrado, para sidebar/avatar.
 *
 * Cada variante usa su propio asset nativo (sin CSS hacks):
 *   - lockup: /clubify-logo.png (1224×360, ratio 3.4:1)
 *   - mark:   /icons/icon-256.png (256×256, mismo PNG que sirve como PWA icon)
 */
export function Logo({
  variant = 'full',
  size = 32,
  className = '',
  priority = false,
}: {
  variant?: 'full' | 'mark';
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  if (variant === 'mark') {
    return (
      <Image
        src="/icons/icon-256.png"
        alt="Clubify"
        width={size}
        height={size}
        priority={priority}
        className={className}
      />
    );
  }

  const ratio = 3.4;
  return (
    <Image
      src="/clubify-logo.png"
      alt="Clubify"
      width={Math.round(size * ratio)}
      height={size}
      priority={priority}
      className={className}
    />
  );
}
