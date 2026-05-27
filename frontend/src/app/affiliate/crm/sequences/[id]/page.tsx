'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { SequenceBuilder } from '@/components/sequences/SequenceBuilder';
import type {
  SequenceData,
  StageOption,
} from '@/components/sequences/types';

export default function SequenceBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SequenceData | null>(null);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.id) return;
    load();
    // Cargar stages del pipeline del user para los selects (MOVE_STAGE y
    // STAGE_CHANGED trigger).
    api<{ stages: StageOption[] }>('/crm/pipeline')
      .then((p) => setStages(p.stages ?? []))
      .catch(() => null);
  }, [params.id]);

  async function load() {
    setLoading(true);
    try {
      const seq = await api<SequenceData>(`/crm/sequences/${params.id}`);
      setData(seq);
    } catch (e: any) {
      toast(e.message ?? 'No se pudo cargar', 'error');
      router.replace('/affiliate/crm/sequences');
    } finally {
      setLoading(false);
    }
  }

  async function save(updated: SequenceData) {
    try {
      const saved = await api<SequenceData>(`/crm/sequences/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: updated.name,
          description: updated.description,
          isActive: updated.isActive,
          steps: updated.steps,
          triggers: updated.triggers,
        }),
      });
      setData(saved);
      toast('Guardado', 'success');
      return saved;
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar', 'error');
      throw e;
    }
  }

  return (
    <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-mute mb-3">
        <Link href="/affiliate/crm/sequences" className="hover:text-ink">
          ← Secuencias
        </Link>
      </div>

      {loading || !data ? (
        <div className="py-12 text-center text-mute text-sm">Cargando…</div>
      ) : (
        <SequenceBuilder
          initialData={data}
          stages={stages}
          onSave={save}
        />
      )}
    </div>
  );
}
