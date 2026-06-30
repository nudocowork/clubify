'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type Company = {
  id: string;
  whiteLabelId: string | null;
  whiteLabelName: string | null;
  name: string;
  logoUrl: string | null;
  whatsapp: string | null;
  city: string | null;
  responsible: string | null;
  email: string | null;
  commissionPerDelivery: number | null;
  brandSharePct?: number;
  isActive: boolean;
  brandsCount?: number;
  tenantsCount?: number;
  deliveriesCount?: number;
};

type Admin = { id: string; email: string; fullName: string; isActive: boolean };
type Brand = { id: string; name: string };
type Tenant = {
  id: string;
  brandName: string;
  slug: string;
  whiteLabelId: string | null;
};

const EMPTY_FORM = {
  name: '',
  whiteLabelId: '' as string,
  logoUrl: '',
  whatsapp: '',
  city: '',
  responsible: '',
  email: '',
  commissionPerDelivery: '' as string,
  brandSharePct: '' as string,
  isActive: true,
  brandIds: [] as string[],
  tenantIds: [] as string[],
};
type Form = typeof EMPTY_FORM;

export default function EmpresasDomicilioPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [tenantSearch, setTenantSearch] = useState('');
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [newAdmin, setNewAdmin] = useState({ email: '', fullName: '', password: '' });
  const [adminBusy, setAdminBusy] = useState(false);
  const [view, setView] = useState<'companies' | 'commissions'>('companies');

  async function load() {
    setLoading(true);
    try {
      const [list, assignable] = await Promise.all([
        api<Company[]>('/superadmin/delivery-companies'),
        api<{ brands: Brand[]; tenants: Tenant[] }>(
          '/superadmin/delivery-companies/assignable',
        ),
      ]);
      setCompanies(list ?? []);
      setBrands(assignable?.brands ?? []);
      setTenants(assignable?.tenants ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setForm({ ...EMPTY_FORM });
    setTenantSearch('');
    setAdmins([]);
    setNewAdmin({ email: '', fullName: '', password: '' });
    setEditing('new');
  }

  async function openEdit(id: string) {
    setTenantSearch('');
    setAdmins([]);
    setNewAdmin({ email: '', fullName: '', password: '' });
    setEditing(id);
    try {
      const c = await api<
        Company & { brandIds: string[]; tenantIds: string[]; admins: Admin[] }
      >(`/superadmin/delivery-companies/${id}`);
      setAdmins(c.admins ?? []);
      setForm({
        name: c.name ?? '',
        whiteLabelId: c.whiteLabelId ?? '',
        logoUrl: c.logoUrl ?? '',
        whatsapp: c.whatsapp ?? '',
        city: c.city ?? '',
        responsible: c.responsible ?? '',
        email: c.email ?? '',
        commissionPerDelivery:
          c.commissionPerDelivery == null ? '' : String(c.commissionPerDelivery),
        brandSharePct: c.brandSharePct == null ? '' : String(c.brandSharePct),
        isActive: c.isActive,
        brandIds: c.brandIds ?? [],
        tenantIds: c.tenantIds ?? [],
      });
    } catch (e) {
      console.error(e);
    }
  }

  function close() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function save() {
    if (!form.name.trim()) {
      alert('El nombre es obligatorio.');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      whiteLabelId: form.whiteLabelId || null,
      logoUrl: form.logoUrl.trim() || undefined,
      whatsapp: form.whatsapp.trim() || undefined,
      city: form.city.trim() || undefined,
      responsible: form.responsible.trim() || undefined,
      email: form.email.trim() || undefined,
      commissionPerDelivery:
        form.commissionPerDelivery.trim() === ''
          ? null
          : Number(form.commissionPerDelivery),
      brandSharePct:
        form.brandSharePct.trim() === '' ? 0 : Number(form.brandSharePct),
      isActive: form.isActive,
      brandIds: form.brandIds,
      tenantIds: form.tenantIds,
    };
    try {
      if (editing === 'new') {
        await api('/superadmin/delivery-companies', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/superadmin/delivery-companies/${editing}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
      close();
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Company) {
    if (
      !confirm(
        `¿Eliminar la empresa "${c.name}"?` +
          (c.deliveriesCount
            ? ' Tiene domicilios en su historial, así que se DESACTIVARÁ en lugar de borrarse.'
            : ''),
      )
    )
      return;
    try {
      await api(`/superadmin/delivery-companies/${c.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo eliminar.');
    }
  }

  function toggleArr(field: 'brandIds' | 'tenantIds', id: string) {
    setForm((f) => {
      const has = f[field].includes(id);
      return {
        ...f,
        [field]: has ? f[field].filter((x) => x !== id) : [...f[field], id],
      };
    });
  }

  async function reloadAdmins(id: string) {
    try {
      const c = await api<{ admins: Admin[] }>(`/superadmin/delivery-companies/${id}`);
      setAdmins(c.admins ?? []);
    } catch {
      /* noop */
    }
  }

  async function createAdmin() {
    if (editing === 'new' || !editing) return;
    if (!newAdmin.email.trim() || !newAdmin.fullName.trim() || newAdmin.password.length < 8) {
      alert('Email, nombre y contraseña (mínimo 8 caracteres) son obligatorios.');
      return;
    }
    setAdminBusy(true);
    try {
      await api(`/superadmin/delivery-companies/${editing}/admins`, {
        method: 'POST',
        body: JSON.stringify(newAdmin),
      });
      setNewAdmin({ email: '', fullName: '', password: '' });
      await reloadAdmins(editing);
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo crear la cuenta.');
    } finally {
      setAdminBusy(false);
    }
  }

  async function resetAdminPassword(userId: string) {
    if (editing === 'new' || !editing) return;
    const pwd = prompt('Nueva contraseña (mínimo 8 caracteres):');
    if (!pwd) return;
    if (pwd.length < 8) {
      alert('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    try {
      await api(`/superadmin/delivery-companies/${editing}/admins/${userId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: pwd }),
      });
      alert('Contraseña actualizada.');
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo actualizar.');
    }
  }

  async function toggleAdmin(userId: string, isActive: boolean) {
    if (editing === 'new' || !editing) return;
    try {
      await api(`/superadmin/delivery-companies/${editing}/admins/${userId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });
      await reloadAdmins(editing);
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo cambiar.');
    }
  }

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.brandName.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q),
    );
  }, [tenants, tenantSearch]);

  const brandName = (id: string | null) =>
    id ? brands.find((b) => b.id === id)?.name ?? '—' : 'Clubify';

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="m-0"
            style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}
          >
            Empresas de Domicilios
          </h1>
          <p className="text-sm mt-1 mb-0" style={{ color: '#6b7785' }}>
            Crea empresas logísticas y habilítalas para ciertas marcas y negocios.
            Cuando un pedido de domicilio queda <b>listo</b>, se avisa a la empresa
            asignada y empieza el seguimiento.
          </p>
        </div>
        {view === 'companies' && (
          <button
            onClick={openNew}
            className="text-sm font-semibold text-white rounded-[10px] px-4 py-2.5 shrink-0"
            style={{ background: '#22c55e', boxShadow: '0 6px 14px rgba(34,197,94,.3)' }}
          >
            + Crear empresa
          </button>
        )}
      </div>

      <div className="flex gap-2 mt-4">
        {(
          [
            ['companies', 'Empresas'],
            ['commissions', 'Comisiones'],
          ] as ['companies' | 'commissions', string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className="text-[13px] font-semibold rounded-full px-4 py-1.5"
            style={
              view === k
                ? { background: '#16241c', color: 'white' }
                : { background: 'white', color: '#475569', border: '1px solid #e2e8f0' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'commissions' && <CommissionsView />}

      <div
        className="mt-5 grid gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
          display: view === 'companies' ? undefined : 'none',
        }}
      >
        {loading && <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>}
        {!loading && companies.length === 0 && (
          <div
            className="rounded-[14px] p-8 text-center text-sm"
            style={{ background: 'white', border: '1px dashed #d8dce0', color: '#9aa4af' }}
          >
            Aún no hay empresas de domicilios. Crea la primera.
          </div>
        )}
        {companies.map((c) => (
          <div
            key={c.id}
            className="rounded-[14px] p-4"
            style={{
              background: 'white',
              border: '1px solid #e7e9ec',
              boxShadow: '0 1px 2px rgba(16,24,40,.04)',
              opacity: c.isActive ? 1 : 0.6,
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-[10px] flex items-center justify-center text-white font-bold text-base shrink-0 overflow-hidden"
                style={{ background: '#0ea5e9' }}
              >
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.logoUrl} alt={c.name} className="w-full h-full object-contain" />
                ) : (
                  '🛵'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-[15px] truncate" style={{ color: '#16241c' }}>
                  {c.name}
                </div>
                <div className="text-[12px]" style={{ color: '#6b7785' }}>
                  {c.city || '—'} · {brandName(c.whiteLabelId)}
                </div>
              </div>
              {!c.isActive && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#fef2f2', color: '#ef4444' }}
                >
                  Inactiva
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Marcas" value={c.brandsCount ?? 0} />
              <Stat label="Negocios" value={c.tenantsCount ?? 0} />
              <Stat label="Domicilios" value={c.deliveriesCount ?? 0} />
            </div>

            <div className="mt-3 text-[12px]" style={{ color: '#6b7785' }}>
              {c.responsible && <div>👤 {c.responsible}</div>}
              {c.whatsapp && <div>📱 {c.whatsapp}</div>}
              {c.commissionPerDelivery != null && (
                <div>💵 Comisión: ${c.commissionPerDelivery.toFixed(2)} / domicilio</div>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => openEdit(c.id)}
                className="flex-1 text-[13px] font-semibold rounded-[9px] py-2"
                style={{ background: '#f1f5f9', color: '#16241c' }}
              >
                Editar
              </button>
              <button
                onClick={() => remove(c)}
                className="text-[13px] font-semibold rounded-[9px] py-2 px-3"
                style={{ background: '#fef2f2', color: '#ef4444' }}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: 'rgba(15,23,42,.45)' }}
          onClick={close}
        >
          <div
            className="h-full overflow-y-auto"
            style={{ width: 'min(560px, 100%)', background: '#f8fafc', boxShadow: '-8px 0 24px rgba(0,0,0,.12)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
              style={{ background: 'white', borderBottom: '1px solid #e7e9ec' }}
            >
              <h2 className="m-0 text-lg font-bold" style={{ color: '#16241c' }}>
                {editing === 'new' ? 'Nueva empresa de domicilios' : 'Editar empresa'}
              </h2>
              <button onClick={close} className="text-2xl leading-none" style={{ color: '#9aa4af' }}>
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <Field label="Nombre de la empresa *">
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Mensajería Express"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Ciudad">
                  <input
                    className={inputCls}
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </Field>
                <Field label="WhatsApp">
                  <input
                    className={inputCls}
                    value={form.whatsapp}
                    onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                    placeholder="+57…"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Responsable">
                  <input
                    className={inputCls}
                    value={form.responsible}
                    onChange={(e) => setForm({ ...form, responsible: e.target.value })}
                  />
                </Field>
                <Field label="Correo">
                  <input
                    className={inputCls}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="contacto@empresa.com"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Marca dueña (gestión)">
                  <select
                    className={inputCls}
                    value={form.whiteLabelId}
                    onChange={(e) => setForm({ ...form, whiteLabelId: e.target.value })}
                  >
                    <option value="">Clubify (plataforma)</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Comisión fija por domicilio (USD)">
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.commissionPerDelivery}
                    onChange={(e) =>
                      setForm({ ...form, commissionPerDelivery: e.target.value })
                    }
                    placeholder="0.00"
                  />
                </Field>
              </div>

              <Field label="% de la comisión para la marca blanca (resto → Master Admin)">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={form.brandSharePct}
                  onChange={(e) => setForm({ ...form, brandSharePct: e.target.value })}
                  placeholder="0"
                />
                <p className="text-[11.5px] mt-1" style={{ color: '#9aa4af' }}>
                  Se genera al marcar el domicilio como <b>Entregado</b>. La empresa se
                  queda con el valor del domicilio; esta comisión fija es de la plataforma.
                </p>
              </Field>

              <Field label="Logo (URL)">
                <input
                  className={inputCls}
                  value={form.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                  placeholder="https://…"
                />
              </Field>

              <label className="flex items-center gap-2 text-sm" style={{ color: '#16241c' }}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Empresa activa
              </label>

              {/* Marcas habilitadas */}
              <div>
                <div className="text-[13px] font-bold mb-2" style={{ color: '#16241c' }}>
                  Marcas blancas habilitadas
                </div>
                <div
                  className="rounded-[10px] p-3 max-h-44 overflow-y-auto space-y-1"
                  style={{ background: 'white', border: '1px solid #e7e9ec' }}
                >
                  {brands.length === 0 && (
                    <div className="text-[12px]" style={{ color: '#9aa4af' }}>Sin marcas.</div>
                  )}
                  {brands.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-[13px] py-0.5" style={{ color: '#16241c' }}>
                      <input
                        type="checkbox"
                        checked={form.brandIds.includes(b.id)}
                        onChange={() => toggleArr('brandIds', b.id)}
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>

              {/* Negocios habilitados */}
              <div>
                <div className="text-[13px] font-bold mb-2 flex items-center justify-between" style={{ color: '#16241c' }}>
                  <span>Negocios habilitados ({form.tenantIds.length})</span>
                </div>
                <input
                  className={inputCls + ' mb-2'}
                  value={tenantSearch}
                  onChange={(e) => setTenantSearch(e.target.value)}
                  placeholder="Buscar negocio…"
                />
                <div
                  className="rounded-[10px] p-3 max-h-56 overflow-y-auto space-y-1"
                  style={{ background: 'white', border: '1px solid #e7e9ec' }}
                >
                  {filteredTenants.length === 0 && (
                    <div className="text-[12px]" style={{ color: '#9aa4af' }}>Sin resultados.</div>
                  )}
                  {filteredTenants.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-[13px] py-0.5" style={{ color: '#16241c' }}>
                      <input
                        type="checkbox"
                        checked={form.tenantIds.includes(t.id)}
                        onChange={() => toggleArr('tenantIds', t.id)}
                      />
                      <span className="truncate">{t.brandName}</span>
                      <span className="text-[11px]" style={{ color: '#9aa4af' }}>
                        · {brandName(t.whiteLabelId)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              {/* Cuentas de login del portal (solo empresas existentes) */}
              {editing !== 'new' && (
                <div className="pt-2">
                  <div className="text-[13px] font-bold mb-1" style={{ color: '#16241c' }}>
                    Acceso al portal (login de la empresa)
                  </div>
                  <p className="text-[12px] mb-2" style={{ color: '#6b7785' }}>
                    Crea una cuenta para que la empresa entre a su portal en{' '}
                    <b>/domicilios</b> y gestione sus pedidos.
                  </p>

                  {admins.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {admins.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-2 rounded-[10px] px-3 py-2"
                          style={{ background: 'white', border: '1px solid #e7e9ec' }}
                        >
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold truncate" style={{ color: '#16241c' }}>
                              {a.fullName}
                            </div>
                            <div className="text-[12px] truncate" style={{ color: '#6b7785' }}>
                              {a.email}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!a.isActive && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#ef4444' }}>
                                Inactiva
                              </span>
                            )}
                            <button
                              onClick={() => resetAdminPassword(a.id)}
                              className="text-[12px] font-semibold rounded-[8px] px-2 py-1"
                              style={{ background: '#f1f5f9', color: '#16241c' }}
                            >
                              Clave
                            </button>
                            <button
                              onClick={() => toggleAdmin(a.id, !a.isActive)}
                              className="text-[12px] font-semibold rounded-[8px] px-2 py-1"
                              style={{ background: '#f1f5f9', color: a.isActive ? '#ef4444' : '#15803d' }}
                            >
                              {a.isActive ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className={inputCls}
                      placeholder="Nombre"
                      value={newAdmin.fullName}
                      onChange={(e) => setNewAdmin({ ...newAdmin, fullName: e.target.value })}
                    />
                    <input
                      className={inputCls}
                      placeholder="Email"
                      value={newAdmin.email}
                      onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                    />
                    <input
                      className={inputCls + ' col-span-2'}
                      type="text"
                      placeholder="Contraseña (mínimo 8 caracteres)"
                      value={newAdmin.password}
                      onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                    />
                    <button
                      onClick={createAdmin}
                      disabled={adminBusy}
                      className="col-span-2 text-sm font-semibold text-white rounded-[10px] py-2"
                      style={{ background: '#0ea5e9', opacity: adminBusy ? 0.6 : 1 }}
                    >
                      {adminBusy ? 'Creando…' : '+ Crear cuenta de acceso'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div
              className="sticky bottom-0 flex gap-3 px-6 py-4"
              style={{ background: 'white', borderTop: '1px solid #e7e9ec' }}
            >
              <button
                onClick={close}
                className="flex-1 text-sm font-semibold rounded-[10px] py-2.5"
                style={{ background: '#f1f5f9', color: '#16241c' }}
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 text-sm font-semibold text-white rounded-[10px] py-2.5"
                style={{ background: '#22c55e', opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[9px] py-2" style={{ background: '#f8fafc' }}>
      <div className="text-[16px] font-bold" style={{ color: '#16241c' }}>{value}</div>
      <div className="text-[10.5px] uppercase font-semibold" style={{ color: '#9aa4af', letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12.5px] font-semibold mb-1.5" style={{ color: '#475569' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-[10px] px-3 py-2.5 text-sm outline-none border border-[#dfe3e8] focus:border-[#22c55e] bg-white';

type Summary = {
  totalAmount: number;
  count: number;
  pending: number;
  paid: number;
  masterTotal: number;
  brandTotal: number;
  byCompany: {
    companyId: string | null;
    name: string;
    count: number;
    amount: number;
    master: number;
    brand: number;
  }[];
};
type CommissionRow = {
  id: string;
  amount: number;
  brandAmount: number;
  masterAmount: number;
  status: 'PENDING' | 'PAID';
  createdAt: string;
  paidAt: string | null;
  companyName: string;
  orderCode: string | null;
  businessName: string | null;
};

function CommissionsView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | 'PENDING' | 'PAID'>('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, list] = await Promise.all([
        api<Summary>('/superadmin/delivery-companies/commissions/summary'),
        api<CommissionRow[]>(
          `/superadmin/delivery-companies/commissions${statusFilter ? `?status=${statusFilter}` : ''}`,
        ),
      ]);
      setSummary(s);
      setRows(list ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function togglePaid(r: CommissionRow) {
    try {
      await api(`/superadmin/delivery-companies/commissions/${r.id}/paid`, {
        method: 'PATCH',
        body: JSON.stringify({ paid: r.status !== 'PAID' }),
      });
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo actualizar.');
    }
  }

  return (
    <div className="mt-5">
      {summary && (
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Stat label="Total comisiones" value={summary.count} />
          <BigStat label="Generado" value={`$${summary.totalAmount.toFixed(2)}`} />
          <BigStat label="Master Admin" value={`$${summary.masterTotal.toFixed(2)}`} />
          <BigStat label="Marcas" value={`$${summary.brandTotal.toFixed(2)}`} />
          <BigStat label="Pendiente" value={`$${summary.pending.toFixed(2)}`} color="#b45309" />
          <BigStat label="Pagado" value={`$${summary.paid.toFixed(2)}`} color="#15803d" />
        </div>
      )}

      {summary && summary.byCompany.length > 0 && (
        <div className="rounded-[14px] overflow-hidden mb-4" style={{ background: 'white', border: '1px solid #e7e9ec' }}>
          <div className="px-4 py-2.5 text-[12px] font-bold uppercase" style={{ color: '#9aa4af', letterSpacing: 0.5, borderBottom: '1px solid #eef0f2' }}>
            Por empresa
          </div>
          {summary.byCompany.map((c) => (
            <div key={c.companyId ?? 'none'} className="flex items-center justify-between px-4 py-2.5 text-sm" style={{ borderBottom: '1px solid #f3f4f6' }}>
              <div className="font-semibold" style={{ color: '#16241c' }}>{c.name}</div>
              <div className="flex gap-4 text-[13px]" style={{ color: '#6b7785' }}>
                <span>{c.count} entregas</span>
                <span>Master ${c.master.toFixed(2)}</span>
                <span>Marca ${c.brand.toFixed(2)}</span>
                <span className="font-semibold" style={{ color: '#16241c' }}>${c.amount.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-3">
        {(
          [
            ['', 'Todas'],
            ['PENDING', 'Pendientes'],
            ['PAID', 'Pagadas'],
          ] as ['' | 'PENDING' | 'PAID', string][]
        ).map(([k, label]) => (
          <button
            key={k || 'all'}
            onClick={() => setStatusFilter(k)}
            className="text-[13px] font-semibold rounded-full px-3.5 py-1.5"
            style={
              statusFilter === k
                ? { background: '#16241c', color: 'white' }
                : { background: 'white', color: '#475569', border: '1px solid #e2e8f0' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-[14px] p-8 text-center text-sm" style={{ background: 'white', border: '1px dashed #d8dce0', color: '#9aa4af' }}>
          Sin comisiones todavía. Se generan cuando un domicilio se marca como entregado.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-[12px] px-4 py-3" style={{ background: 'white', border: '1px solid #e7e9ec' }}>
            <div className="min-w-0">
              <div className="font-semibold text-sm" style={{ color: '#16241c' }}>
                {r.companyName} {r.orderCode ? `· #${r.orderCode}` : ''}
              </div>
              <div className="text-[12px]" style={{ color: '#6b7785' }}>
                {r.businessName ?? '—'} · Master ${r.masterAmount.toFixed(2)} · Marca ${r.brandAmount.toFixed(2)}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-bold text-sm" style={{ color: '#16241c' }}>${r.amount.toFixed(2)}</span>
              <button
                onClick={() => togglePaid(r)}
                className="text-[12px] font-semibold rounded-[8px] px-2.5 py-1.5"
                style={
                  r.status === 'PAID'
                    ? { background: '#dcfce7', color: '#15803d' }
                    : { background: '#fef9c3', color: '#a16207' }
                }
              >
                {r.status === 'PAID' ? '✓ Pagada' : 'Marcar pagada'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BigStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-[12px] p-3" style={{ background: 'white', border: '1px solid #e7e9ec' }}>
      <div className="text-[18px] font-bold" style={{ color: color ?? '#16241c' }}>{value}</div>
      <div className="text-[10.5px] uppercase font-semibold mt-0.5" style={{ color: '#9aa4af', letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}
