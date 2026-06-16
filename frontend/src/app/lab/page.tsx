'use client';
/**
 * Página standalone del Clubify Lab. Para embajadores el feed ahora
 * también vive como tab interno dentro de `/affiliate` — la lógica
 * está en `LabFeed.tsx` y este wrapper solo la monta dentro del layout
 * propio de `/lab`.
 */
import { LabFeed } from './LabFeed';

export default function LabPage() {
  return <LabFeed />;
}
