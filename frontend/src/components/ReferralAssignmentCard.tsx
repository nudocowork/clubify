'use client';

/**
 * Card para que el super admin asigne (o desasigne) un tenant existente a
 * un ReferralCode de tipo INFLUENCER o AMBASSADOR. Útil para conectar
 * negocios que se crearon manualmente (no vinieron de `/ref/<slug>`)
 * con un embajador/influencer que los trajo "offline".
 *
 * Solo SUPER_ADMIN puede usar los endpoints — si el GET tira 403 (caso
 * MARKETING), ocultamos el card por completo.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type CodeOption = {
  id: string;
  code: string;
  ownerName: string;
  role: 'INFLUENCER' | 'AMBASSADOR';
  campaign?: { id: string; name: string } | null;
};

type Assignment = {
  referralUseId: string;
  code: CodeOption;
  status: string;
  createdAt: string;
};

export function ReferralAssignmentCard({ tenantId }: { tenantId: string }) {
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [current, setCurrent] = useState<Assignment | null>(null);
  const [options, setOptions] = useState<CodeOption[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [assignmentRes, influencersRes, ambassadorsRes] = await Promise.all([
        api<{ assignment: Assignment | null }>(
          `/referrals/tenants/${tenantId}/assignment`,
        ),
        api<{ items: CodeOption[] }>('/referrals/influencers'),
        api<{ items: CodeOption[] }>('/referrals/ambassadors'),
      ]);
      const codes = [
        ...(influencersRes.items ?? []),
        ...(ambassadorsRes.items ?? []),
      ].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
      setOptions(codes);
      setCurrent(assignmentRes.assignment);
      setSelected(assignmentRes.assignment?.code.id ?? '');
    } catch (e: any) {
      // Si MARKETING llega aquí, los endpoints van a tirar 403 — ocultamos
      // el card en silencio en vez de mostrar un error confuso.
      if (e?.status === 403 || /403/.test(e?.message ?? '')) {
        setHidden(true);
      } else {
        toast(e?.message || 'Error cargando asignación', 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [tenantId]);

  async function save(nextCodeId: string | null) {
    setSaving(true);
    try {
      await api(`/referrals/tenants/${tenantId}/assignment`, {
        method: 'PATCH',
        body: JSON.stringify({ referralCodeId: nextCodeId }),
      });
      toast(
        nextCodeId ? 'Asignación actualizada' : 'Asignación removida',
        'success',
      );
      await load();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar la asignación', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (hidden) return null;
  if (loading) {
    return (
      <div className="card card-pad mb-4">
        <div className="h-6 bg-bg2 rounded animate-shimmer w-1/2 mb-2" />
        <div className="h-12 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  return (
    <div className="card card-pad mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-semibold text-base m-0">
            🎯 Asignación a embajador / influencer
          </h3>
          <p className="text-mute text-xs mt-1 max-w-md">
            Conectá este negocio a un afiliado responsable de traerlo. Útil
            cuando el tenant se creó sin venir de un link <code>/ref/</code>.
            Las comisiones futuras de este tenant van a ese código.
          </p>
        </div>
      </div>

      {current && (
        <div className="rounded-lg border border-line bg-bg2 px-3 py-2 mb-3 text-sm flex items-center gap-2 flex-wrap">
          <span className="text-mute">Asignado actualmente a:</span>
          <strong>{current.code.ownerName}</strong>
          <span className="badge badge-info text-[10px]">{current.code.role}</span>
          <code className="text-xs text-mute">{current.code.code}</code>
          {current.code.campaign && (
            <span className="text-xs text-mute">
              · campaña {current.code.campaign.name}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <label className="label">Seleccionar afiliado</label>
          <select
            className="input"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={saving}
          >
            <option value="">— Sin asignar —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.ownerName} · {o.role} · {o.code}
                {o.campaign ? ` · ${o.campaign.name}` : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn-primary"
          disabled={saving || selected === (current?.code.id ?? '')}
          onClick={() => save(selected || null)}
        >
          {saving ? 'Guardando…' : current ? 'Actualizar' : 'Asignar'}
        </button>
        {current && (
          <button
            className="btn-ghost text-bad"
            disabled={saving}
            onClick={() => {
              if (
                confirm(
                  '¿Quitar la asignación actual? Las comisiones históricas no se borran.',
                )
              ) {
                save(null);
              }
            }}
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}
