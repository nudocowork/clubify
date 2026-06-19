'use client';
/**
 * Grupos Empresariales — un cliente con UNA suscripción Hotmart que cubre
 * varios negocios. El estado financiero del grupo cascadea a sus negocios
 * (suspender el grupo suspende todos; reactivar reactiva todos). Aislado por
 * marca: cada marca ve solo sus grupos.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type GroupStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
type GroupTenant = {
  id: string;
  brandName: string;
  slug: string;
  status: string;
  currentPeriodEnd?: string | null;
};
type Group = {
  id: string;
  name: string;
  responsibleName: string | null;
  responsibleEmail: string | null;
  responsiblePhone: string | null;
  hotmartSubscriberCode: string | null;
  planPeriodicity: string | null;
  currentPeriodEnd: string | null;
  status: GroupStatus;
  tenants: GroupTenant[];
  tenantsCount?: number;
  activeCount?: number;
};

const PERIODS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

const STATUS_META: Record<GroupStatus, { label: string; cls: string }> = {
  ACTIVE: { label: 'Activo', cls: 'bg-ok-soft text-ok' },
  PAST_DUE: { label: 'Pago pendiente', cls: 'bg-warn-soft text-warn-ink' },
  SUSPENDED: { label: 'Suspendido', cls: 'bg-bad-soft text-bad-ink' },
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function BusinessGroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    try {
      setGroups((await api<Group[]>('/admin/business-groups')) ?? []);
    } catch (e: any) {
      toast(e?.message || 'Error cargando grupos', 'error');
      setGroups([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Grupos Empresariales{' '}
          <span className="page-crumb">/ {groups?.length ?? 0} registros</span>
        </h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + Nuevo grupo
        </button>
      </div>

      <p className="text-sm text-mute mb-4 max-w-2xl leading-relaxed">
        Agrupa varios negocios bajo un mismo cliente y una sola suscripción de
        pago. Cada negocio opera independiente (clientes, menú, wallet, sellos
        propios), pero el estado financiero del grupo cascadea: suspender el
        grupo suspende todos sus negocios; reactivarlo los reactiva.
      </p>

      {groups === null ? (
        <div className="card card-pad">
          <div className="h-5 bg-bg2 rounded animate-shimmer mb-3" />
          <div className="h-20 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card card-pad text-center text-mute">
          <div className="text-3xl mb-1">🏢</div>
          <div className="font-semibold">Sin grupos todavía</div>
          <div className="text-xs mt-1">
            Creá un grupo para administrar un cliente con varios negocios.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((g) => {
            const meta = STATUS_META[g.status];
            return (
              <button
                key={g.id}
                onClick={() => setOpenId(g.id)}
                className="card card-pad text-left hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] truncate">
                      {g.name}
                    </div>
                    <div className="text-xs text-mute truncate">
                      {g.responsibleName || 'Sin responsable'}
                      {g.responsibleEmail ? ` · ${g.responsibleEmail}` : ''}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill shrink-0 ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="rounded-lg bg-bg2/60 py-2">
                    <div className="text-lg font-bold leading-none">
                      {g.tenantsCount ?? g.tenants.length}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-mute mt-1">
                      Negocios
                    </div>
                  </div>
                  <div className="rounded-lg bg-bg2/60 py-2">
                    <div className="text-lg font-bold leading-none text-ok">
                      {g.activeCount ??
                        g.tenants.filter((t) => t.status === 'ACTIVE').length}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-mute mt-1">
                      Activos
                    </div>
                  </div>
                  <div className="rounded-lg bg-bg2/60 py-2">
                    <div className="text-[13px] font-bold leading-none mt-1">
                      {fmtDate(g.currentPeriodEnd)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-mute mt-1">
                      Próx. cobro
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {creating && (
        <GroupFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {openId && (
        <GroupDetailModal
          groupId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function GroupFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: '',
    responsibleName: '',
    responsibleEmail: '',
    responsiblePhone: '',
    hotmartSubscriberCode: '',
    planPeriodicity: '',
    nextChargeDate: '',
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setSaving(true);
    try {
      await api('/admin/business-groups', {
        method: 'POST',
        body: JSON.stringify({
          name: f.name.trim(),
          responsibleName: f.responsibleName.trim() || undefined,
          responsibleEmail: f.responsibleEmail.trim() || undefined,
          responsiblePhone: f.responsiblePhone.trim() || undefined,
          hotmartSubscriberCode: f.hotmartSubscriberCode.trim() || undefined,
          planPeriodicity: f.planPeriodicity || undefined,
          nextChargeDate: f.nextChargeDate
            ? new Date(f.nextChargeDate).toISOString()
            : undefined,
        }),
      });
      toast('Grupo creado', 'success');
      onSaved();
    } catch (e: any) {
      toast(e?.message || 'No se pudo crear', 'error');
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form onSubmit={submit} className="card card-pad w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-3">Nuevo grupo empresarial</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Nombre del grupo</label>
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required placeholder="Grupo Juan Pérez" />
          </div>
          <div>
            <label className="label">Cliente responsable</label>
            <input className="input" value={f.responsibleName} onChange={(e) => set('responsibleName', e.target.value)} placeholder="Juan Pérez" />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={f.responsiblePhone} onChange={(e) => set('responsiblePhone', e.target.value)} placeholder="+57 300 000 0000" />
          </div>
          <div className="col-span-2">
            <label className="label">Email del responsable</label>
            <input className="input" type="email" value={f.responsibleEmail} onChange={(e) => set('responsibleEmail', e.target.value)} placeholder="juan@empresa.com" />
            <div className="text-[11px] text-mute mt-1">
              Si Hotmart envía el pago con este email, se vincula la suscripción
              al grupo automáticamente.
            </div>
          </div>
          <div>
            <label className="label">Código suscriptor Hotmart</label>
            <input className="input" value={f.hotmartSubscriberCode} onChange={(e) => set('hotmartSubscriberCode', e.target.value)} placeholder="opcional" />
          </div>
          <div>
            <label className="label">Periodicidad</label>
            <select className="input" value={f.planPeriodicity} onChange={(e) => set('planPeriodicity', e.target.value)}>
              <option value="">—</option>
              {PERIODS.map((p) => (
                <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Próxima fecha de cobro</label>
            <input className="input" type="date" value={f.nextChargeDate} onChange={(e) => set('nextChargeDate', e.target.value)} />
          </div>
        </div>
        <div className="text-[11px] text-mute mt-2">
          Después de crear el grupo podrás asociarle negocios desde su detalle.
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving || !f.name.trim()}>
            {saving ? 'Creando…' : 'Crear grupo'}
          </button>
        </div>
      </form>
    </div>
  );
}

function GroupDetailModal({
  groupId,
  onClose,
  onChanged,
}: {
  groupId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [g, setG] = useState<Group | null>(null);
  const [available, setAvailable] = useState<GroupTenant[]>([]);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');

  async function reload() {
    try {
      const [grp, avail] = await Promise.all([
        api<Group>(`/admin/business-groups/${groupId}`),
        api<GroupTenant[]>('/admin/business-groups/available-tenants'),
      ]);
      setG(grp);
      setAvailable(avail ?? []);
    } catch (e: any) {
      toast(e?.message || 'Error', 'error');
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function setStatus(status: GroupStatus) {
    const msg =
      status === 'SUSPENDED'
        ? '¿Suspender el grupo? Se suspenderán TODOS sus negocios.'
        : status === 'ACTIVE'
        ? '¿Reactivar el grupo? Se reactivarán TODOS sus negocios.'
        : '¿Marcar el grupo como pago pendiente?';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await api(`/admin/business-groups/${groupId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      toast('Estado actualizado', 'success');
      await reload();
      onChanged();
    } catch (e: any) {
      toast(e?.message || 'No se pudo cambiar el estado', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addTenant() {
    if (!addId) return;
    setBusy(true);
    try {
      await api(`/admin/business-groups/${groupId}/tenants`, {
        method: 'POST',
        body: JSON.stringify({ tenantId: addId }),
      });
      setAddId('');
      await reload();
      onChanged();
      toast('Negocio agregado', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo agregar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeTenant(tenantId: string) {
    if (!confirm('¿Quitar este negocio del grupo? Seguirá operando, pero queda como negocio individual.')) return;
    setBusy(true);
    try {
      await api(`/admin/business-groups/${groupId}/tenants/${tenantId}`, {
        method: 'DELETE',
      });
      await reload();
      onChanged();
      toast('Negocio quitado', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo quitar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    if (!confirm('¿Eliminar el grupo? Los negocios NO se borran, quedan individuales.')) return;
    setBusy(true);
    try {
      await api(`/admin/business-groups/${groupId}`, { method: 'DELETE' });
      toast('Grupo eliminado', 'success');
      onChanged();
      onClose();
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
      setBusy(false);
    }
  }

  const meta = g ? STATUS_META[g.status] : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card card-pad w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {!g ? (
          <div className="h-40 bg-bg2 rounded animate-shimmer" />
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 mb-1">
              <h2 className="text-lg font-semibold m-0">{g.name}</h2>
              {meta && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill ${meta.cls}`}>
                  {meta.label}
                </span>
              )}
            </div>
            <div className="text-xs text-mute mb-3">
              {g.responsibleName || 'Sin responsable'}
              {g.responsibleEmail ? ` · ${g.responsibleEmail}` : ''}
              {g.responsiblePhone ? ` · ${g.responsiblePhone}` : ''}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center mb-4">
              <Info label="Periodicidad" value={g.planPeriodicity ? g.planPeriodicity.charAt(0) + g.planPeriodicity.slice(1).toLowerCase() : '—'} />
              <Info label="Próx. cobro" value={fmtDate(g.currentPeriodEnd)} />
              <Info label="Cód. Hotmart" value={g.hotmartSubscriberCode || '—'} />
            </div>

            {/* Acciones financieras (cascada) */}
            <div className="flex flex-wrap gap-2 mb-4">
              {g.status !== 'ACTIVE' && (
                <button className="btn-primary text-sm" disabled={busy} onClick={() => setStatus('ACTIVE')}>
                  Reactivar grupo
                </button>
              )}
              {g.status !== 'SUSPENDED' && (
                <button className="btn-danger text-sm" disabled={busy} onClick={() => setStatus('SUSPENDED')}>
                  Suspender grupo
                </button>
              )}
              {g.status === 'ACTIVE' && (
                <button className="btn-ghost text-sm" disabled={busy} onClick={() => setStatus('PAST_DUE')}>
                  Marcar pago pendiente
                </button>
              )}
            </div>

            {/* Negocios del grupo */}
            <div className="text-[11px] uppercase tracking-wide text-mute font-semibold mb-2">
              Negocios del grupo ({g.tenants.length})
            </div>
            <div className="space-y-1.5 mb-3">
              {g.tenants.length === 0 && (
                <div className="text-sm text-mute italic">Sin negocios asociados.</div>
              )}
              {g.tenants.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg2/50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.brandName}</div>
                    <div className="text-[11px] text-mute">{t.status}</div>
                  </div>
                  <button className="btn-ghost text-xs text-bad-ink" disabled={busy} onClick={() => removeTenant(t.id)}>
                    Quitar
                  </button>
                </div>
              ))}
            </div>

            {/* Agregar negocio */}
            <div className="flex gap-2 mb-4">
              <select className="input flex-1" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">Agregar negocio…</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>{t.brandName}</option>
                ))}
              </select>
              <button className="btn-primary" disabled={busy || !addId} onClick={addTenant}>
                Agregar
              </button>
            </div>
            {available.length === 0 && (
              <div className="text-[11px] text-mute mb-3 -mt-2">
                No hay negocios sin grupo disponibles en esta marca.
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-line">
              <button className="btn-ghost text-sm text-bad-ink" disabled={busy} onClick={removeGroup}>
                Eliminar grupo
              </button>
              <button className="btn-ghost" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg2/60 py-2 px-1">
      <div className="text-[12px] font-semibold leading-tight break-words">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-mute mt-1">{label}</div>
    </div>
  );
}
