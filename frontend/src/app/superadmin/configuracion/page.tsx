'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type PlatformConfig = {
  name: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
  consoleDomain: string;
  supportEmail: string;
};

type Owner = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type Invite = {
  id: string;
  email: string;
  fullName: string;
  invitedBy: { email: string; fullName: string | null } | null;
  expiresAt: string;
  createdAt: string;
};

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [cfg, ow, inv] = await Promise.all([
        api<PlatformConfig>('/superadmin/config'),
        api<Owner[]>('/superadmin/owners'),
        api<Invite[]>('/superadmin/owner-invites'),
      ]);
      setConfig(cfg);
      setOwners(ow);
      setInvites(inv);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Configuración
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        Branding global de la plataforma + administradores con acceso al Master Admin.
      </p>

      {loading && !config ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      ) : (
        <div className="space-y-6">
          {config && <BrandingForm config={config} onSaved={reload} />}
          <OwnersSection owners={owners} invites={invites} onChange={reload} />
        </div>
      )}
    </div>
  );
}

function BrandingForm({ config, onSaved }: { config: PlatformConfig; onSaved: () => void }) {
  const [form, setForm] = useState<PlatformConfig>(config);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    return (Object.keys(form) as (keyof PlatformConfig)[]).some((k) => form[k] !== config[k]);
  }, [form, config]);

  async function save() {
    setSaving(true);
    try {
      await api('/superadmin/config', { method: 'PATCH', body: JSON.stringify(form) });
      onSaved();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-[14px] p-6"
      style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-[10px] flex items-center justify-center text-base"
          style={{ background: '#f0fdf4', color: '#15803d' }}
        >
          ⚙
        </div>
        <div>
          <h2 className="m-0" style={{ fontSize: 16, fontWeight: 800, color: '#16241c' }}>
            Branding de la plataforma
          </h2>
          <p className="text-xs mt-0.5" style={{ color: '#9aa4af' }}>
            Estos valores se usan en el header, emails de invitación y links públicos del Master Admin.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Nombre" hint="Visible en el header del Master Admin y en emails.">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Fidelia"
            className="w-full"
            style={inputStyle}
          />
        </Field>
        <Field label="Tagline" hint="Subtítulo del header.">
          <input
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            placeholder="Software de Fidelización"
            className="w-full"
            style={inputStyle}
          />
        </Field>
        <Field label="URL del logo">
          <input
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            placeholder="https://..."
            className="w-full"
            style={inputStyle}
          />
        </Field>
        <Field label="Color primario" hint="Hex. Default #16a34a (verde).">
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={form.primaryColor || '#16a34a'}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              style={{ width: 44, height: 38, padding: 0, border: '1px solid #d7dbe0', borderRadius: 8 }}
            />
            <input
              value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              placeholder="#16a34a"
              className="flex-1"
              style={inputStyle}
            />
          </div>
        </Field>
        <Field label="Dominio de la consola" hint="Host donde corre el Master Admin (sin https://). Se usa para el link en emails.">
          <input
            value={form.consoleDomain}
            onChange={(e) => setForm({ ...form, consoleDomain: e.target.value })}
            placeholder="app.fidelia.com"
            className="w-full"
            style={inputStyle}
          />
        </Field>
        <Field label="Email de soporte">
          <input
            value={form.supportEmail}
            onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
            placeholder="soporte@fidelia.com"
            className="w-full"
            style={inputStyle}
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 mt-5">
        {dirty && (
          <button
            onClick={() => setForm(config)}
            disabled={saving}
            className="text-sm font-semibold"
            style={{ padding: '8px 14px', borderRadius: 9, background: 'white', color: '#6b7785', border: '1px solid #d7dbe0' }}
          >
            Cancelar
          </button>
        )}
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="text-sm font-semibold transition"
          style={{
            padding: '9px 18px',
            borderRadius: 9,
            background: dirty ? '#15803d' : '#cbd5d2',
            color: 'white',
            border: 'none',
            cursor: dirty && !saving ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </section>
  );
}

function OwnersSection({
  owners,
  invites,
  onChange,
}: {
  owners: Owner[];
  invites: Invite[];
  onChange: () => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <section
      className="rounded-[14px] p-6"
      style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[10px] flex items-center justify-center text-base"
            style={{ background: '#eff6ff', color: '#1e40af' }}
          >
            👤
          </div>
          <div>
            <h2 className="m-0" style={{ fontSize: 16, fontWeight: 800, color: '#16241c' }}>
              Administradores de plataforma
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#9aa4af' }}>
              Usuarios con rol PLATFORM_OWNER. Tienen acceso completo al Master Admin.
            </p>
          </div>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="text-sm font-semibold"
          style={{
            padding: '9px 16px', borderRadius: 9, background: '#15803d', color: 'white', border: 'none',
          }}
        >
          + Invitar
        </button>
      </div>

      <div className="space-y-1">
        {owners.length === 0 && (
          <div className="text-sm py-4 text-center" style={{ color: '#9aa4af' }}>
            Sin administradores cargados.
          </div>
        )}
        {owners.map((o) => (
          <OwnerRow key={o.id} owner={o} onChange={onChange} />
        ))}
      </div>

      {invites.length > 0 && (
        <>
          <div
            className="text-[11px] font-bold uppercase mt-6 mb-2"
            style={{ letterSpacing: 0.8, color: '#9aa4af' }}
          >
            Invitaciones pendientes
          </div>
          <div
            className="rounded-[10px] overflow-hidden"
            style={{ border: '1px solid #eef0f2' }}
          >
            {invites.map((i, idx) => (
              <InviteRow key={i.id} invite={i} isLast={idx === invites.length - 1} onChange={onChange} />
            ))}
          </div>
        </>
      )}

      {inviteOpen && <CreateAdminModal onClose={() => setInviteOpen(false)} onCreated={onChange} />}
    </section>
  );
}

function OwnerRow({ owner, onChange }: { owner: Owner; onChange: () => void }) {
  const [pwOpen, setPwOpen] = useState(false);

  async function toggle() {
    const next = !owner.isActive;
    const verb = next ? 'reactivar' : 'desactivar';
    if (!confirm(`¿${verb[0].toUpperCase() + verb.slice(1)} acceso de ${owner.email}?`)) return;
    try {
      await api(`/superadmin/owners/${owner.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      onChange();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    }
  }

  return (
    <div
      className="flex items-center justify-between py-3 px-1"
      style={{ borderBottom: '1px dashed #eef0f2' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            background: owner.isActive ? '#dcfce7' : '#f3f4f6',
            color: owner.isActive ? '#15803d' : '#9aa4af',
          }}
        >
          {(owner.fullName || owner.email)[0]?.toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: '#16241c' }}>
            {owner.fullName || owner.email.split('@')[0]}
            {!owner.isActive && (
              <span
                className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                style={{ background: '#fee2e2', color: '#991b1b', letterSpacing: 0.5 }}
              >
                Inactivo
              </span>
            )}
          </div>
          <div className="text-xs" style={{ color: '#9aa4af' }}>
            {owner.email}
            {owner.lastLoginAt && (
              <span> · último ingreso {new Date(owner.lastLoginAt).toLocaleDateString('es-MX')}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPwOpen(true)}
          className="text-xs font-semibold"
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            background: 'white',
            color: '#1e40af',
            border: '1px solid #d7dbe0',
          }}
        >
          🔑 Cambiar contraseña
        </button>
        <button
          onClick={toggle}
          className="text-xs font-semibold"
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            background: 'white',
            color: owner.isActive ? '#b91c1c' : '#15803d',
            border: '1px solid #d7dbe0',
          }}
        >
          {owner.isActive ? '🚫 Desactivar' : '✅ Activar'}
        </button>
      </div>

      {pwOpen && (
        <ChangePasswordModal
          owner={owner}
          onClose={() => setPwOpen(false)}
          onSaved={() => {
            setPwOpen(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function ChangePasswordModal({
  owner,
  onClose,
  onSaved,
}: {
  owner: Owner;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = password.trim().length >= 8;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    try {
      await api(`/superadmin/owners/${owner.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      });
      onSaved();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,30,22,.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] p-6"
        style={{ background: 'white', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
          Cambiar contraseña
        </h3>
        <p className="text-sm mt-1.5 mb-5" style={{ color: '#6b7785' }}>
          Defines una nueva contraseña para <b>{owner.email}</b>. Aplica de inmediato.
        </p>

        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full"
            style={inputStyle}
            autoFocus
          />
        </Field>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm font-semibold"
            style={{ padding: '9px 14px', borderRadius: 9, background: 'white', color: '#6b7785', border: '1px solid #d7dbe0' }}
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="text-sm font-semibold"
            style={{
              padding: '9px 18px',
              borderRadius: 9,
              background: !valid ? '#cbd5d2' : '#15803d',
              color: 'white',
              border: 'none',
            }}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteRow({ invite, isLast, onChange }: { invite: Invite; isLast: boolean; onChange: () => void }) {
  async function revoke() {
    if (!confirm(`¿Revocar invitación de ${invite.email}?`)) return;
    try {
      await api(`/superadmin/owner-invites/${invite.id}`, { method: 'DELETE' });
      onChange();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    }
  }

  const expires = new Date(invite.expiresAt);
  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400000));

  return (
    <div
      className="flex items-center justify-between py-3 px-4"
      style={{
        background: 'white',
        borderBottom: isLast ? 'none' : '1px solid #eef0f2',
      }}
    >
      <div>
        <div className="text-sm font-semibold" style={{ color: '#16241c' }}>
          {invite.fullName}
        </div>
        <div className="text-xs" style={{ color: '#9aa4af' }}>
          {invite.email} · vence en {daysLeft}d
          {invite.invitedBy && ` · invitó ${invite.invitedBy.email}`}
        </div>
      </div>
      <button
        onClick={revoke}
        className="text-xs font-semibold"
        style={{
          padding: '6px 12px', borderRadius: 8, background: 'white', color: '#b91c1c', border: '1px solid #d7dbe0',
        }}
      >
        Revocar
      </button>
    </div>
  );
}

function CreateAdminModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = !!firstName.trim() && !!email.trim() && password.trim().length >= 8;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    try {
      await api('/superadmin/owners', {
        method: 'POST',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });
      onCreated();
      onClose();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,30,22,.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] p-6"
        style={{ background: 'white', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
          Crear administrador
        </h3>
        <p className="text-sm mt-1.5 mb-5" style={{ color: '#6b7785' }}>
          Se crea de inmediato y podrá ingresar con estas credenciales. No se envía invitación.
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="María"
                className="w-full"
                style={inputStyle}
                autoFocus
              />
            </Field>
            <Field label="Apellido">
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Pérez"
                className="w-full"
                style={inputStyle}
              />
            </Field>
          </div>
          <Field label="Correo electrónico">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@empresa.com"
              className="w-full"
              style={inputStyle}
            />
          </Field>
          <Field label="Contraseña" hint="Mínimo 8 caracteres.">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full"
              style={inputStyle}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm font-semibold"
            style={{ padding: '9px 14px', borderRadius: 9, background: 'white', color: '#6b7785', border: '1px solid #d7dbe0' }}
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="text-sm font-semibold"
            style={{
              padding: '9px 18px',
              borderRadius: 9,
              background: !valid ? '#cbd5d2' : '#15803d',
              color: 'white',
              border: 'none',
            }}
          >
            {saving ? 'Creando…' : 'Crear Administrador'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div
        className="text-[11px] font-bold uppercase mb-1.5"
        style={{ letterSpacing: 0.6, color: '#6b7785' }}
      >
        {label}
      </div>
      {children}
      {hint && (
        <div className="text-[11px] mt-1" style={{ color: '#9aa4af' }}>
          {hint}
        </div>
      )}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #d7dbe0',
  fontSize: 13.5,
  outline: 'none',
  color: '#16241c',
  background: 'white',
};
