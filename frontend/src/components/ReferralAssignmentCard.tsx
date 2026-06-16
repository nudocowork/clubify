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
  // Bloque 4 (2026-06-12): cuando se reasigna a OTRO código, opcional
  // borrar las comisiones futuras PENDING/APPROVED del afiliado anterior
  // para que el nuevo afiliado las reciba desde el próximo ciclo.
  const [deleteFuture, setDeleteFuture] = useState(false);
  const [reason, setReason] = useState('');
  // #6/#34 (2026-06-16): buscador + filtro por rol en vez de un <select>
  // plano largo.
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'INFLUENCER' | 'AMBASSADOR'>('ALL');

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
      // Si hay assignment actual + nuevo código distinto → usamos el
      // endpoint de reasignación (Bloque 4 2026-06-12) que mantiene el
      // referralUseId existente, opcionalmente borra comisiones futuras
      // y deja audit log. El endpoint legacy (setTenantAssignment)
      // borraba+recreaba el ReferralUse → perdía historial.
      if (
        current &&
        nextCodeId &&
        nextCodeId !== current.code.id &&
        current.referralUseId
      ) {
        const res = await api<{ deletedFutureCommissions: number }>(
          `/referrals/uses/${current.referralUseId}/reassign`,
          {
            method: 'POST',
            body: JSON.stringify({
              newReferralCodeId: nextCodeId,
              deleteFuturePending: deleteFuture,
              reason: reason.trim() || undefined,
            }),
          },
        );
        toast(
          deleteFuture
            ? `Reasignado · ${res.deletedFutureCommissions} comisiones futuras borradas`
            : 'Reasignación completada',
          'success',
        );
        setDeleteFuture(false);
        setReason('');
        await load();
        return;
      }
      // Sin asignación previa O quitar asignación → endpoint legacy.
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

      <AffiliatePicker
        options={options}
        selected={selected}
        onSelect={setSelected}
        query={query}
        onQuery={setQuery}
        roleFilter={roleFilter}
        onRoleFilter={setRoleFilter}
        disabled={saving}
      />

      <div className="flex gap-2 mt-3">
        <button
          className="btn-primary"
          disabled={saving || selected === (current?.code.id ?? '')}
          onClick={() => save(selected || null)}
        >
          {saving ? 'Guardando…' : current ? 'Reasignar' : 'Asignar'}
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

      {/* Bloque 4 (2026-06-12): cuando hay assignment y se selecciona OTRO
          código distinto al actual, mostrar opciones avanzadas de
          reasignación. PAID se mantiene intacta siempre. */}
      {current && selected && selected !== current.code.id && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
          <div className="text-xs font-semibold text-amber-900">
            ⚠️ Estás reasignando este cliente a OTRO afiliado
          </div>
          <p className="text-[11px] text-amber-900/80 mt-1 leading-snug">
            Las comisiones PAID históricas se mantienen intactas siempre.
          </p>
          <label className="flex items-start gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteFuture}
              onChange={(e) => setDeleteFuture(e.target.checked)}
              disabled={saving}
              className="mt-0.5"
            />
            <span className="text-xs text-amber-900 leading-snug">
              Borrar comisiones <strong>PENDING / APPROVED</strong> del
              afiliado anterior (las próximas comisiones irán al nuevo).
            </span>
          </label>
          <div className="mt-2">
            <label className="text-[10px] uppercase tracking-wider text-amber-900/70 font-semibold">
              Motivo (opcional, queda en audit log)
            </label>
            <input
              type="text"
              className="input mt-1 text-xs"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: cliente realmente lo trajo X embajador"
              disabled={saving}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * #6/#34: Picker de afiliado con buscador integrado + filtro por rol.
 * Reemplaza el <select> plano. Filtra client-side (la lista de afiliados
 * activos es chica). Muestra rol + código de cada uno.
 */
function AffiliatePicker({
  options,
  selected,
  onSelect,
  query,
  onQuery,
  roleFilter,
  onRoleFilter,
  disabled,
}: {
  options: CodeOption[];
  selected: string;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  roleFilter: 'ALL' | 'INFLUENCER' | 'AMBASSADOR';
  onRoleFilter: (r: 'ALL' | 'INFLUENCER' | 'AMBASSADOR') => void;
  disabled?: boolean;
}) {
  const q = query.trim().toLowerCase();
  const filtered = options.filter(
    (o) =>
      (roleFilter === 'ALL' || o.role === roleFilter) &&
      (q === '' ||
        `${o.ownerName} ${o.code} ${o.role} ${o.campaignName ?? ''}`
          .toLowerCase()
          .includes(q)),
  );
  const selectedOpt = options.find((o) => o.id === selected);
  const ROLE_TABS: { value: 'ALL' | 'INFLUENCER' | 'AMBASSADOR'; label: string }[] = [
    { value: 'ALL', label: 'Todos' },
    { value: 'INFLUENCER', label: '🌟 Influencers' },
    { value: 'AMBASSADOR', label: '👥 Embajadores' },
  ];

  return (
    <div>
      <label className="label">Seleccionar afiliado</label>
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {ROLE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            disabled={disabled}
            onClick={() => onRoleFilter(t.value)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-pill border transition ${
              roleFilter === t.value
                ? 'bg-brand text-white border-brand'
                : 'bg-bg2 text-mute border-line hover:bg-line'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        className="input"
        placeholder="Buscar por nombre, código…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        disabled={disabled}
      />
      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line divide-y divide-line">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect('')}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-bg2 ${
            selected === '' ? 'bg-bg2 font-semibold' : ''
          }`}
        >
          — Sin asignar —
        </button>
        {filtered.length === 0 && (
          <div className="px-3 py-3 text-xs text-mute">Sin resultados.</div>
        )}
        {filtered.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(o.id)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-bg2 flex items-center gap-2 ${
              selected === o.id ? 'bg-brand/10 font-semibold' : ''
            }`}
          >
            <span className="shrink-0">
              {o.role === 'INFLUENCER' ? '🌟' : '👥'}
            </span>
            <span className="flex-1 min-w-0 truncate">
              {o.ownerName}
              <span className="text-mute font-normal">
                {' '}· {o.code}
                {o.campaignName ? ` · ${o.campaignName}` : ''}
              </span>
            </span>
            {selected === o.id && <span className="text-brand">✓</span>}
          </button>
        ))}
      </div>
      {selectedOpt && (
        <div className="text-xs text-mute mt-1.5">
          Seleccionado: <strong>{selectedOpt.ownerName}</strong> ({selectedOpt.role})
        </div>
      )}
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
              '¿Generar igual? Solo confirma si sabes que este tenant efectivamente paga (ej. fue creado manualmente o vino de un canal sin tracking de billing).\n\n' +
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
