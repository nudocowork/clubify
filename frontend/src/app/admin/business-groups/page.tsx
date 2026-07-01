'use client';
/**
 * Grupos Empresariales — un cliente con UNA suscripción Hotmart que cubre
 * varios negocios. El estado financiero del grupo cascadea a sus negocios
 * (suspender el grupo suspende todos; reactivar reactiva todos). Aislado por
 * marca: cada marca ve solo sus grupos.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  // Punto 2: recipiente de la comisión del grupo.
  referralCodeId?: string | null;
  referralCode?: {
    id: string;
    code: string;
    ownerName: string | null;
    role: string;
    commissionPercent: number | string;
  } | null;
};

type AffiliateOption = {
  id: string;
  code: string;
  ownerName?: string | null;
  role?: string;
  commissionPercent?: number | string;
};

const PERIODS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

const PERIODICITY_LABEL_KEY: Record<string, string> = {
  MENSUAL: 'periodicityMonthly',
  TRIMESTRAL: 'periodicityQuarterly',
  SEMESTRAL: 'periodicitySemiannual',
  ANUAL: 'periodicityAnnual',
};

const STATUS_META: Record<GroupStatus, { labelKey: string; cls: string }> = {
  ACTIVE: { labelKey: 'statusActive', cls: 'bg-ok-soft text-ok' },
  PAST_DUE: { labelKey: 'statusPastDue', cls: 'bg-warn-soft text-warn-ink' },
  SUSPENDED: { labelKey: 'statusSuspended', cls: 'bg-bad-soft text-bad-ink' },
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
  const t = useTranslations('admin_business_groups');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    try {
      setGroups((await api<Group[]>('/admin/business-groups')) ?? []);
    } catch (e: any) {
      toast(e?.message || t('errorLoading'), 'error');
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
          {t('title')}{' '}
          <span className="page-crumb">
            / {t('recordsCount', { count: groups?.length ?? 0 })}
          </span>
        </h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          {t('newGroup')}
        </button>
      </div>

      <p className="text-sm text-mute mb-4 max-w-2xl leading-relaxed">
        {t('intro')}
      </p>

      {groups === null ? (
        <div className="card card-pad">
          <div className="h-5 bg-bg2 rounded animate-shimmer mb-3" />
          <div className="h-20 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card card-pad text-center text-mute">
          <div className="text-3xl mb-1">🏢</div>
          <div className="font-semibold">{t('emptyTitle')}</div>
          <div className="text-xs mt-1">{t('emptyHint')}</div>
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
                      {g.responsibleName || t('noResponsible')}
                      {g.responsibleEmail ? ` · ${g.responsibleEmail}` : ''}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill shrink-0 ${meta.cls}`}
                  >
                    {t(meta.labelKey)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="rounded-lg bg-bg2/60 py-2">
                    <div className="text-lg font-bold leading-none">
                      {g.tenantsCount ?? g.tenants.length}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-mute mt-1">
                      {t('businesses')}
                    </div>
                  </div>
                  <div className="rounded-lg bg-bg2/60 py-2">
                    <div className="text-lg font-bold leading-none text-ok">
                      {g.activeCount ??
                        g.tenants.filter((tn) => tn.status === 'ACTIVE').length}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-mute mt-1">
                      {t('active')}
                    </div>
                  </div>
                  <div className="rounded-lg bg-bg2/60 py-2">
                    <div className="text-[13px] font-bold leading-none mt-1">
                      {fmtDate(g.currentPeriodEnd)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-mute mt-1">
                      {t('nextCharge')}
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
  const t = useTranslations('admin_business_groups');
  const tc = useTranslations('common');
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
      toast(t('toastCreated'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e?.message || t('errorCreate'), 'error');
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
        <h2 className="text-base font-semibold mb-3">{t('formTitle')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">{t('fieldGroupName')}</label>
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required placeholder="Grupo Juan Pérez" />
          </div>
          <div>
            <label className="label">{t('fieldResponsible')}</label>
            <input className="input" value={f.responsibleName} onChange={(e) => set('responsibleName', e.target.value)} placeholder="Juan Pérez" />
          </div>
          <div>
            <label className="label">{t('fieldPhone')}</label>
            <input className="input" value={f.responsiblePhone} onChange={(e) => set('responsiblePhone', e.target.value)} placeholder="+57 300 000 0000" />
          </div>
          <div className="col-span-2">
            <label className="label">{t('fieldResponsibleEmail')}</label>
            <input className="input" type="email" value={f.responsibleEmail} onChange={(e) => set('responsibleEmail', e.target.value)} placeholder="juan@empresa.com" />
            <div className="text-[11px] text-mute mt-1">{t('emailHint')}</div>
          </div>
          <div>
            <label className="label">{t('fieldHotmartCode')}</label>
            <input className="input" value={f.hotmartSubscriberCode} onChange={(e) => set('hotmartSubscriberCode', e.target.value)} placeholder={t('optionalPlaceholder')} />
          </div>
          <div>
            <label className="label">{t('fieldPeriodicity')}</label>
            <select className="input" value={f.planPeriodicity} onChange={(e) => set('planPeriodicity', e.target.value)}>
              <option value="">—</option>
              {PERIODS.map((p) => (
                <option key={p} value={p}>{t(PERIODICITY_LABEL_KEY[p])}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">{t('fieldNextChargeDate')}</label>
            <input className="input" type="date" value={f.nextChargeDate} onChange={(e) => set('nextChargeDate', e.target.value)} />
          </div>
        </div>
        <div className="text-[11px] text-mute mt-2">{t('afterCreateHint')}</div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>{tc('cancel')}</button>
          <button type="submit" className="btn-primary" disabled={saving || !f.name.trim()}>
            {saving ? t('creating') : t('createGroup')}
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
  const t = useTranslations('admin_business_groups');
  const tc = useTranslations('common');
  const [g, setG] = useState<Group | null>(null);
  const [available, setAvailable] = useState<GroupTenant[]>([]);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');
  const [affiliates, setAffiliates] = useState<AffiliateOption[]>([]);
  const [savingRecipient, setSavingRecipient] = useState(false);

  useEffect(() => {
    Promise.all([
      api<AffiliateOption[]>('/referrals/influencers').catch(() => []),
      api<AffiliateOption[]>('/referrals/ambassadors').catch(() => []),
      api<AffiliateOption[]>('/referrals/vendors').catch(() => []),
    ]).then(([inf, amb, ven]) => {
      const tag = (arr: AffiliateOption[] | null, role: string) =>
        (arr ?? []).map((a) => ({ ...a, role: a.role ?? role }));
      setAffiliates([
        ...tag(inf, 'INFLUENCER'),
        ...tag(amb, 'AMBASSADOR'),
        ...tag(ven, 'VENDOR'),
      ]);
    });
  }, []);

  async function saveRecipient(referralCodeId: string) {
    setSavingRecipient(true);
    try {
      await api(`/admin/business-groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ referralCodeId }),
      });
      toast('Recipiente de comisión actualizado', 'success');
      await reload();
      onChanged();
    } catch (e: any) {
      toast(e?.message || tc('error'), 'error');
    } finally {
      setSavingRecipient(false);
    }
  }

  async function reload() {
    try {
      const [grp, avail] = await Promise.all([
        api<Group>(`/admin/business-groups/${groupId}`),
        api<GroupTenant[]>('/admin/business-groups/available-tenants'),
      ]);
      setG(grp);
      setAvailable(avail ?? []);
    } catch (e: any) {
      toast(e?.message || tc('error'), 'error');
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function setStatus(status: GroupStatus) {
    const msg =
      status === 'SUSPENDED'
        ? t('confirmSuspend')
        : status === 'ACTIVE'
        ? t('confirmReactivate')
        : t('confirmPastDue');
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await api(`/admin/business-groups/${groupId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      toast(t('toastStatusUpdated'), 'success');
      await reload();
      onChanged();
    } catch (e: any) {
      toast(e?.message || t('errorStatus'), 'error');
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
      toast(t('toastBusinessAdded'), 'success');
    } catch (e: any) {
      toast(e?.message || t('errorAdd'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeTenant(tenantId: string) {
    if (!confirm(t('confirmRemoveTenant'))) return;
    setBusy(true);
    try {
      await api(`/admin/business-groups/${groupId}/tenants/${tenantId}`, {
        method: 'DELETE',
      });
      await reload();
      onChanged();
      toast(t('toastBusinessRemoved'), 'success');
    } catch (e: any) {
      toast(e?.message || t('errorRemove'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function simulate(event: string, label: string) {
    if (!confirm(t('confirmSimulate', { label }))) return;
    setBusy(true);
    try {
      await api('/admin/billing/hotmart/simulate-group-webhook', {
        method: 'POST',
        body: JSON.stringify({ groupId, event }),
      });
      toast(t('toastSimulated'), 'success');
      await reload();
      onChanged();
    } catch (e: any) {
      toast(e?.message || t('errorSimulate'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    if (!confirm(t('confirmRemoveGroup'))) return;
    setBusy(true);
    try {
      await api(`/admin/business-groups/${groupId}`, { method: 'DELETE' });
      toast(t('toastGroupDeleted'), 'success');
      onChanged();
      onClose();
    } catch (e: any) {
      toast(e?.message || t('errorDelete'), 'error');
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
                  {t(meta.labelKey)}
                </span>
              )}
            </div>
            <div className="text-xs text-mute mb-3">
              {g.responsibleName || t('noResponsible')}
              {g.responsibleEmail ? ` · ${g.responsibleEmail}` : ''}
              {g.responsiblePhone ? ` · ${g.responsiblePhone}` : ''}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center mb-4">
              <Info label={t('fieldPeriodicity')} value={g.planPeriodicity ? t(PERIODICITY_LABEL_KEY[g.planPeriodicity] ?? g.planPeriodicity) : '—'} />
              <Info label={t('nextCharge')} value={fmtDate(g.currentPeriodEnd)} />
              <Info label={t('hotmartCodeShort')} value={g.hotmartSubscriberCode || '—'} />
            </div>

            {/* Punto 2: recipiente de la comisión del grupo (%×bruto en cada cobro) */}
            <div className="rounded-xl border border-line p-3 mb-4 bg-bg2">
              <div className="text-sm font-semibold mb-1">Comisión del grupo</div>
              <div className="text-xs text-mute mb-2">
                Al cobrarse el grupo, se genera 1 comisión = % del código × precio del
                plan ({g.planPeriodicity ? t(PERIODICITY_LABEL_KEY[g.planPeriodicity] ?? g.planPeriodicity) : 'periodicidad'}).
                {g.referralCode
                  ? ` Actual: ${g.referralCode.ownerName ?? g.referralCode.code} (${g.referralCode.role} · ${g.referralCode.commissionPercent}%).`
                  : ' Sin recipiente: no genera comisión.'}
              </div>
              <select
                className="input"
                value={g.referralCodeId ?? ''}
                disabled={savingRecipient}
                onChange={(e) => saveRecipient(e.target.value)}
              >
                <option value="">— Sin comisión —</option>
                {affiliates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.ownerName || a.code)} · {a.role} · {a.commissionPercent ?? '?'}%
                  </option>
                ))}
              </select>
            </div>

            {/* Acciones financieras (cascada) */}
            <div className="flex flex-wrap gap-2 mb-4">
              {g.status !== 'ACTIVE' && (
                <button className="btn-primary text-sm" disabled={busy} onClick={() => setStatus('ACTIVE')}>
                  {t('reactivateGroup')}
                </button>
              )}
              {g.status !== 'SUSPENDED' && (
                <button className="btn-danger text-sm" disabled={busy} onClick={() => setStatus('SUSPENDED')}>
                  {t('suspendGroup')}
                </button>
              )}
              {g.status === 'ACTIVE' && (
                <button className="btn-ghost text-sm" disabled={busy} onClick={() => setStatus('PAST_DUE')}>
                  {t('markPastDue')}
                </button>
              )}
            </div>

            {/* Negocios del grupo */}
            <div className="text-[11px] uppercase tracking-wide text-mute font-semibold mb-2">
              {t('groupBusinesses', { count: g.tenants.length })}
            </div>
            <div className="space-y-1.5 mb-3">
              {g.tenants.length === 0 && (
                <div className="text-sm text-mute italic">{t('noBusinesses')}</div>
              )}
              {g.tenants.map((tn) => (
                <div key={tn.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg2/50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{tn.brandName}</div>
                    <div className="text-[11px] text-mute">{tn.status}</div>
                  </div>
                  <button className="btn-ghost text-xs text-bad-ink" disabled={busy} onClick={() => removeTenant(tn.id)}>
                    {t('remove')}
                  </button>
                </div>
              ))}
            </div>

            {/* Agregar negocio */}
            <div className="flex gap-2 mb-4">
              <select className="input flex-1" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">{t('addBusiness')}</option>
                {available.map((tn) => (
                  <option key={tn.id} value={tn.id}>{tn.brandName}</option>
                ))}
              </select>
              <button className="btn-primary" disabled={busy || !addId} onClick={addTenant}>
                {t('add')}
              </button>
            </div>
            {available.length === 0 && (
              <div className="text-[11px] text-mute mb-3 -mt-2">{t('noAvailableBusinesses')}</div>
            )}

            {/* Simulador QA: ejercita la cascada Hotmart→grupo sin cobro real */}
            <div className="mt-2 rounded-lg border border-dashed border-line p-3">
              <div className="text-[11px] uppercase tracking-wide text-mute font-semibold mb-2">
                {t('simulateCharge')}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() => simulate('PURCHASE_APPROVED', t('simPaymentApproved'))}
                >
                  ✅ {t('simPaymentApproved')}
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() => simulate('PURCHASE_DELAYED', t('simPaymentDelayed'))}
                >
                  ⏳ {t('simPaymentDelayed')}
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() => simulate('PURCHASE_REFUNDED', t('simRefund'))}
                >
                  ↩️ {t('simRefund')}
                </button>
              </div>
              <p className="text-[11px] text-mute mt-2">{t('simHint')}</p>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-line mt-3">
              <button className="btn-ghost text-sm text-bad-ink" disabled={busy} onClick={removeGroup}>
                {t('deleteGroup')}
              </button>
              <button className="btn-ghost" onClick={onClose}>{tc('close')}</button>
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
