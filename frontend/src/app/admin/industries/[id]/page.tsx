'use client';
/**
 * Antes esta página listaba las presentations de una industria. Ahora la
 * UX está colapsada: industria = 1 deck. Esta ruta redirige al editor de
 * slides de la presentation default de la industria (la crea on-demand
 * si no existe via POST /admin/industries/:id/ensure-default-presentation).
 *
 * La ruta /admin/industries/[id]/presentations/[pid] sigue funcionando
 * para back-compat (links viejos, deep-link a una variante específica).
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useState } from 'react';

export default function IndustryRedirectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<{ id: string; slug: string }>(
      `/admin/industries/${id}/ensure-default-presentation`,
      { method: 'POST' },
    )
      .then((p) => {
        router.replace(`/admin/industries/${id}/presentations/${p.id}`);
      })
      .catch((e: any) => {
        setErr(e?.message || 'No se pudo abrir el editor');
      });
  }, [id, router]);

  if (err) {
    return (
      <div className="card card-pad max-w-md mx-auto mt-10 text-center space-y-3">
        <div className="text-3xl">⚠️</div>
        <div className="font-semibold">No se pudo abrir el editor</div>
        <div className="text-sm text-mute break-words">{err}</div>
        <Link href="/admin/industries" className="btn-primary inline-block">
          ← Volver a Industrias
        </Link>
      </div>
    );
  }

  return (
    <div className="text-mute py-16 text-center">Abriendo editor de slides…</div>
  );
}
