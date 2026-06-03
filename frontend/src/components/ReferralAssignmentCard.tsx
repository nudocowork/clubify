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
  campaignName?: string | null;
};

type Assignment = {
  referralUseId: string;
  code: {
    id: string;
    code: string;
    ownerName: string;
    role: 'INFLUENCER' | 'AMBASSADOR';
    campaign?: { id: string; name: string } | null;
  };
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
      // Los endpoints /referrals/influencers y /ambassadors devuelven el
      // array directo (no {items: [...]}). Cada item tiene `campaignName`
      // string (no nested `campaign: {id, name}` como en /assignment).
      // Inyectamos `role` al normalizar — el filtro del endpoint ya lo
      // garantiza pero el shape devuelto no lo incluye explícito.
      const [assignmentRes, influencersArr, ambassadorsArr] = await Promise.all([
        api<{ assignment: Assignment | null }>(
          `/referrals/tenants/${tenantId}/assignment`,
        ),
        api<any[]>('/referrals/influencers'),
        api<any[]>('/referrals/ambassadors'),
      ]);
      const codes: CodeOption[] = [
        ...(Array.isArray(influencersArr) ? influencersArr : []).map(
          (c: any) => ({
            id: c.id,
            code: c.code,
            ownerName: c.ownerName,
            role: 'INFLUENCER' as const,
            campaignName: c.campaignName ?? null,
          }),
        ),
        ...(Array.isArray(ambassadorsArr) ? ambassadorsArr : []).map(
          (c: any) => ({
            id: c.id,
            code: c.code,
            ownerName: c.ownerName,
            role: 'AMBASSADOR' as const,
            campaignName: c.campaignName ?? null,
          }),
        ),
      ].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
      setOptions(codes);
      setCurrent(assignmentRes.assignment);
      setSelected(assignmentRes.assignment?.code.id ?? '');
    } catch (e: any) {
      // Si MARKETING llega aquí, los endpoints van a tirar 403 — ocultamos
      // el card en silencio en vez de mostrar un error confuso. Detección
      // robusta: status (api() helper lo adjunta), texto "403" o mensaje
      // típico de RolesGuard ("Insufficient permissions", "Forbidden").
      const msg = e?.message ?? '';
      if (
        e?.status === 403 ||
        /403|forbidden|insufficient permissions|permisos insuficientes/i.test(
          msg,
        )
      ) {
        setHidden(true);
      } else {
        toast(msg || 'Error cargando asignación', 'error');
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
            Conecta este negocio a un afiliado responsable de traerlo. Útil
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
          <BackfillCommissionButton tenantId={tenantId} />
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
                {o.campaignName ? ` · ${o.campaignName}` : ''}
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

/**
 * Botón "Generar comisión ahora": dispara el backfill retroactivo.
 * Idempotente — el backend hace no-op si ya hay commission reciente.
 * Útil cuando el tenant ya está pagando pero se asignó después del
 * último pago (no llegará un webhook Hotmart en 30 días).
 */
function BackfillCommissionButton({ tenantId }: { tenantId: string }) {
  const [busy, setBusy] = useState(false);
  async function run(force = false) {
    setBusy(true);
    try {
      const url = force
        ? `/referrals/tenants/${tenantId}/backfill-commission?force=true`
        : `/referrals/tenants/${tenantId}/backfill-commission`;
      const res = await api<{
        ok: boolean;
        commissions: Array<{ amount: number; status: string }>;
      }>(url, { method: 'POST' });
      const count = res.commissions?.length ?? 0;
      if (count === 0) {
        // Sin ciclo activo y sin force → ofrecer forzar.
        if (!force) {
          const ok = confirm(
            'No se generó comisión porque el tenant no tiene un ciclo de pago activo (currentPeriodEnd).\n\n' +
              '¿Generar igual? Solo confirmá si sabes que este tenant efectivamente paga (ej. fue creado manualmente o vino de un canal sin tracking de billing).\n\n' +
              'La comisión se va a crear como PENDING al influencer/embajador.',
          );
          if (ok) {
            setBusy(false);
            return run(true);
          }
        } else {
          // Force = true y no creó nada → probablemente ya estaba creada
          // o tenant suspendido.
          toast(
            'No se generó comisión (ya estaba creada recientemente o el tenant está suspendido)',
            'info',
          );
        }
      } else {
        const total = res.commissions.reduce((s, c) => s + c.amount, 0);
        toast(
          `Comisión generada: $${total.toFixed(2)} (${count} entrada${count > 1 ? 's' : ''})`,
          'success',
        );
      }
    } catch (e: any) {
      toast(e?.message || 'No se pudo generar la comisión', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className="text-xs text-brand hover:underline ml-auto"
      onClick={() => run(false)}
      disabled={busy}
      title="Generar la comisión PENDIENTE de este ciclo si el tenant ya pagó. Idempotente."
    >
      {busy ? '…' : '⚡ Generar comisión ahora'}
    </button>
  );
}
