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
  isActive: boolean;
  brandsCount?: number;
  tenantsCount?: number;
  deliveriesCount?: number;
};

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
    setEditing('new');
  }

  async function openEdit(id: string) {
    setTenantSearch('');
    setEditing(id);
    try {
      const c = await api<Company & { brandIds: string[]; tenantIds: string[] }>(
        `/superadmin/delivery-companies/${id}`,
      );
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
        <button
          onClick={openNew}
          className="text-sm font-semibold text-white rounded-[10px] px-4 py-2.5 shrink-0"
          style={{ background: '#22c55e', boxShadow: '0 6px 14px rgba(34,197,94,.3)' }}
        >
          + Crear empresa
        </button>
      </div>

      <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
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
                <Field label="Comisión por domicilio (USD)">
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
