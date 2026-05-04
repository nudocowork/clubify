'use client';
import Image from 'next/image';

/**
 * Logo oficial de Clubify (verde gradient).
 * - `variant="full"`  → logo completo (mark + wordmark "CLUBIFY"), para
 *                       headers, footers, signup/login, landing.
 * - `variant="mark"`  → solo el ícono recortado del PNG, para sidebar/avatar.
 *
 * El archivo fuente es `public/clubify-logo.png` (1080×1080 con padding blanco).
 * Para variant="mark" usamos background-image + position para encuadrar solo
 * el símbolo (~35% izquierdo del PNG).
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
    // Recorte CSS del símbolo (triángulo verde del lado izquierdo del PNG).
    // Posición + size calibrados para el PNG actual de 1080×1080.
    return (
      <div
        role="img"
        aria-label="Clubify"
        className={`bg-no-repeat ${className}`}
        style={{
          width: size,
          height: size,
          backgroundImage: 'url(/clubify-logo.png)',
          backgroundSize: '320% auto',
          backgroundPosition: '15% center',
        }}
      />
    );
  }

  // Logo completo (mark + wordmark "CLUBIFY") — proporciones del PNG actual
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
