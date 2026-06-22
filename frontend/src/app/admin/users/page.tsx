'use client';
/**
 * Super Admin · CRUD de usuarios SUPER_ADMIN.
 *
 * El founder agrega aquí a otros miembros del equipo interno (soporte,
 * ventas, ops) que necesitan acceso a /admin/* sin estar vinculados a un
 * tenant. El backend obliga a habilitar 2FA en el primer login del nuevo
 * admin (flow existente).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, getUser } from '@/lib/api';
import { toast } from '@/components/Toast';

type AdminRole = 'SUPER_ADMIN' | 'MARKETING';

type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  totpEnabledAt: string | null;
};

type CreateResponse = AdminUser & { tempPassword: string };

const ROLE_LABEL_KEY: Record<AdminRole, string> = {
  SUPER_ADMIN: 'roleSuperAdmin',
  MARKETING: 'roleMarketing',
};

const ROLE_DESC_KEY: Record<AdminRole, string> = {
  SUPER_ADMIN: 'roleDescSuperAdmin',
  MARKETING: 'roleDescMarketing',
};

export default function AdminUsersPage() {
  const t = useTranslations('admin_users');
  const tc = useTranslations('common');
  const me = getUser();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{
    fullName: string;
    email: string;
    phone: string;
    password: string;
    role: AdminRole;
  }>({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'SUPER_ADMIN',
  });
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<CreateResponse | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{
    userId: string;
    tempPassword: string;
  } | null>(null);

  async function load() {
    setLoadErr(null);
    try {
      const r = await api<AdminUser[]>('/admin/users');
      setUsers(r);
    } catch (e: any) {
      setLoadErr(e?.message || t('errorLoad'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.fullName.trim() || !createForm.email.trim()) {
      toast(t('fillNameEmail'), 'error');
      return;
    }
    setCreating(true);
    try {
      const body: any = {
        fullName: createForm.fullName.trim(),
        email: createForm.email.trim().toLowerCase(),
        role: createForm.role,
      };
      if (createForm.phone.trim()) body.phone = createForm.phone.trim();
      if (createForm.password.trim()) body.password = createForm.password.trim();
      const created = await api<CreateResponse>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLastCreated(created);
      setShowCreate(false);
      setCreateForm({
        fullName: '',
        email: '',
        phone: '',
        password: '',
        role: 'SUPER_ADMIN',
      });
      await load();
      toast(t('toastCreated'), 'success');
    } catch (e: any) {
      toast(e?.message || t('errorCreate'), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    if (u.id === me?.id && u.isActive) {
      toast(t('cannotDeactivateSelf'), 'error');
      return;
    }
    if (
      !confirm(
        u.isActive
          ? t('confirmDeactivate', { name: u.fullName })
          : t('confirmReactivate', { name: u.fullName }),
      )
    )
      return;
    try {
      await api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      await load();
      toast(u.isActive ? t('toastDeactivated') : t('toastReactivated'), 'success');
    } catch (e: any) {
      toast(e?.message || t('errorUpdate'), 'error');
    }
  }

  async function resetPassword(u: AdminUser) {
    if (!confirm(t('confirmReset', { name: u.fullName }))) return;
    setResetting(u.id);
    try {
      const r = await api<{ tempPassword: string }>(
        `/admin/users/${u.id}/reset-password`,
        { method: 'POST' },
      );
      setResetResult({ userId: u.id, tempPassword: r.tempPassword });
    } catch (e: any) {
      toast(e?.message || t('errorReset'), 'error');
    } finally {
      setResetting(null);
    }
  }

  async function remove(u: AdminUser) {
    if (u.id === me?.id) {
      toast(t('cannotDeleteSelf'), 'error');
      return;
    }
    if (!confirm(t('confirmDelete', { name: u.fullName }))) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      await load();
      toast(t('toastDeleted'), 'success');
    } catch (e: any) {
      toast(e?.message || t('errorDelete'), 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">
            / {t('crumbCount', { count: users?.length ?? 0 })}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreate(true)}
          >
            {t('newAdmin')}
          </button>
        </div>
      </div>

      <p className="text-sm text-mute mb-4 max-w-2xl leading-relaxed">
        {t.rich('intro', {
          superadmin: () => <strong>SUPER_ADMIN</strong>,
          marketing: () => <strong>MARKETING</strong>,
        })}
      </p>

      {loadErr && (
        <div className="card card-pad mb-4">
          <div className="text-sm text-bad-ink">{loadErr}</div>
          <button onClick={load} className="btn-ghost text-sm mt-2">
            {t('retry')}
          </button>
        </div>
      )}

      {lastCreated && (
        <div className="card card-pad mb-4 bg-ok-soft border-ok/20">
          <div className="text-sm font-semibold text-ok-ink mb-1">
            {t('createdBanner')}
          </div>
          <div className="text-xs text-mute mb-2">
            {t('createdShareHint')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-[11px] text-mute uppercase">{t('emailLabel')}</div>
              <div className="font-mono">{lastCreated.email}</div>
            </div>
            <div>
              <div className="text-[11px] text-mute uppercase">
                {t('tempPasswordLabel')}
              </div>
              <div className="font-mono">{lastCreated.tempPassword}</div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(
                    t('credentialsClipboard', {
                      email: lastCreated.email,
                      password: lastCreated.tempPassword,
                    }),
                  )
                  .then(() => toast(t('toastCopiedClipboard'), 'success'));
              }}
              className="btn-ghost text-xs"
            >
              {t('copyCredentials')}
            </button>
            <button
              type="button"
              onClick={() => setLastCreated(null)}
              className="btn-ghost text-xs"
            >
              {t('doneHide')}
            </button>
          </div>
        </div>
      )}

      {resetResult && (
        <div className="card card-pad mb-4 bg-amber-50 border border-amber-200">
          <div className="text-sm font-semibold text-amber-900 mb-1">
            {t('resetBanner')}
          </div>
          <div className="text-xs text-mute mb-2">
            {t('resetShareHint')}
          </div>
          <div className="text-sm">
            <span className="text-[11px] text-mute uppercase block">
              {t('newPasswordLabel')}
            </span>
            <span className="font-mono">{resetResult.tempPassword}</span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(resetResult.tempPassword)
                  .then(() => toast(t('toastCopied'), 'success'));
              }}
              className="btn-ghost text-xs"
            >
              {t('copy')}
            </button>
            <button
              type="button"
              onClick={() => setResetResult(null)}
              className="btn-ghost text-xs"
            >
              {t('hide')}
            </button>
          </div>
        </div>
      )}

      {users && users.length === 0 && (
        <div className="card card-pad text-center text-mute">
          {t('emptyState')}
        </div>
      )}

      {users && users.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg2/40">
              <tr className="text-left">
                <th className="px-4 py-3 font-semibold">{t('thName')}</th>
                <th className="px-4 py-3 font-semibold">{t('emailLabel')}</th>
                <th className="px-4 py-3 font-semibold">{t('thRole')}</th>
                <th className="px-4 py-3 font-semibold">2FA</th>
                <th className="px-4 py-3 font-semibold">{t('thLastLogin')}</th>
                <th className="px-4 py-3 font-semibold">{t('thStatus')}</th>
                <th className="px-4 py-3 font-semibold text-right">{t('thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      {u.fullName}
                      {isMe && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-brand font-semibold">
                          {t('you')}
                        </span>
                      )}
                      {u.phone && (
                        <div className="text-[11px] text-mute mt-0.5">
                          {u.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          'text-xs px-2 py-0.5 rounded-pill ' +
                          (u.role === 'MARKETING'
                            ? 'bg-violet-50 text-violet-700 border border-violet-200'
                            : 'bg-brand-soft text-brand-ink')
                        }
                      >
                        {t(ROLE_LABEL_KEY[u.role])}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.totpEnabledAt ? (
                        <span className="text-ok text-xs">{t('twoFaActive')}</span>
                      ) : (
                        <span className="text-amber-600 text-xs">
                          {t('twoFaPending')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString('es-CO', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : t('never')}
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="text-xs px-2 py-0.5 rounded-pill bg-ok-soft text-ok">
                          {t('statusActive')}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-pill bg-bg2 text-mute">
                          {t('statusInactive')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end flex-wrap">
                        <button
                          type="button"
                          onClick={() => resetPassword(u)}
                          disabled={resetting === u.id}
                          className="btn-ghost text-xs"
                          title={t('resetTitle')}
                        >
                          {resetting === u.id ? '…' : t('resetBtn')}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(u)}
                          disabled={isMe && u.isActive}
                          className="btn-ghost text-xs disabled:opacity-40"
                        >
                          {u.isActive ? t('deactivate') : t('reactivate')}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(u)}
                          disabled={isMe}
                          className="btn-ghost text-xs text-bad-ink disabled:opacity-40"
                        >
                          {tc('delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <form
            onSubmit={handleCreate}
            className="card card-pad max-w-md w-full"
          >
            <h2 className="text-base font-semibold mb-1">
              {t('modalTitle')}
            </h2>
            <p className="text-xs text-mute mb-4 leading-relaxed">
              {t('modalSubtitle')}
            </p>
            <div className="grid gap-3">
              <div>
                <label className="label">{t('roleLabel')}</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['SUPER_ADMIN', 'MARKETING'] as AdminRole[]).map((r) => {
                    const active = createForm.role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setCreateForm({ ...createForm, role: r })}
                        className={
                          'text-left rounded-md border p-3 transition ' +
                          (active
                            ? 'border-brand bg-brand-soft'
                            : 'border-line hover:border-brand/40')
                        }
                      >
                        <div className="text-sm font-semibold">
                          {t(ROLE_LABEL_KEY[r])}
                        </div>
                        <div className="text-[11px] text-mute mt-1 leading-snug">
                          {t(ROLE_DESC_KEY[r])}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="label">{t('fullNameLabel')}</label>
                <input
                  className="input"
                  required
                  value={createForm.fullName}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, fullName: e.target.value })
                  }
                  placeholder={t('fullNamePlaceholder')}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">{t('emailLabel')}</label>
                <input
                  className="input"
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, email: e.target.value })
                  }
                  placeholder="usuario@equipo.com"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">{t('phoneLabel')}</label>
                <input
                  className="input"
                  value={createForm.phone}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, phone: e.target.value })
                  }
                  placeholder="+57 300 000 0000"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">
                  {t('initialPasswordLabel')}
                </label>
                <input
                  className="input font-mono"
                  type="text"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, password: e.target.value })
                  }
                  placeholder={t('initialPasswordPlaceholder')}
                  minLength={8}
                  autoComplete="new-password"
                />
                <p className="text-[11px] text-mute mt-1">
                  {t('initialPasswordHint')}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="btn-ghost"
              >
                {tc('cancel')}
              </button>
              <button
                type="submit"
                disabled={creating}
                className="btn-primary"
              >
                {creating ? t('creating') : t('createAdmin')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
