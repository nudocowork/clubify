'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Supplier = { id: string; name: string; phone: string; email: string | null; notes: string | null; isActive: boolean };
type FrequentProduct = {
  id: string;
  name: string;
  defaultQty: number | string;
  defaultUnit: string;
  dispatchDay: string | null;
  supplierId: string | null;
  supplier: { id: string; name: string; phone: string } | null;
  notes: string | null;
};
type OrderItem = {
  productName: string;
  qty: number;
  unit: string;
  supplierId: string | null;
  supplierName?: string;
  supplierPhone?: string;
  dispatchDay: string | null;
  notes: string | null;
};
type Stats = {
  frequentCount: number;
  suppliersCount: number;
  ordersCount: number;
  dispatchDaysCount: number;
  topSuppliers: { supplierId: string | null; supplierName: string; count: number }[];
};
type Tenant = { brandName: string; address?: string | null; locations?: { name: string; address: string }[] };

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const UNITS = ['kg', 'g', 'lb', 'L', 'ml', 'un', 'caja', 'paquete', 'docena'];

export default function OrdersGeneratorPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [frequent, setFrequent] = useState<FrequentProduct[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [template, setTemplate] = useState<{ template: string; default: string } | null>(null);

  const [showItem, setShowItem] = useState(false);
  const [showSupplier, setShowSupplier] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showFreqList, setShowFreqList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Form for "Agregar producto"
  const [form, setForm] = useState({
    productName: '',
    qty: 1,
    unit: 'kg',
    supplierId: '',
    dispatchDay: 'Lunes',
    notes: '',
    saveAsFrequent: false,
  });

  // New supplier form
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    phone: '',
    email: '',
    notes: '',
  });

  async function load() {
    try {
      const [s, sup, fp, me, tpl] = await Promise.all([
        api<Stats>('/admin/stats'),
        api<Supplier[]>('/admin/suppliers'),
        api<FrequentProduct[]>('/admin/frequent-products'),
        api<any>('/tenants/me').catch(() => null),
        api<{ template: string; default: string }>('/admin/supplier-template'),
      ]);
      setStats(s);
      setSuppliers(sup);
      setFrequent(fp);
      setTenant(me);
      setTemplate(tpl);
    } catch (e: any) {
      toast(e.message || 'Error cargando', 'error');
    }
  }
  useEffect(() => { load(); }, []);

  // ─────────── Items del pedido ───────────
  function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form.productName.trim()) { toast('Falta nombre del producto', 'error'); return; }
    const sup = suppliers.find((s) => s.id === form.supplierId);
    setItems((prev) => [...prev, {
      productName: form.productName.trim(),
      qty: form.qty,
      unit: form.unit,
      supplierId: form.supplierId || null,
      supplierName: sup?.name,
      supplierPhone: sup?.phone,
      dispatchDay: form.dispatchDay,
      notes: form.notes.trim() || null,
    }]);
    if (form.saveAsFrequent) {
      api('/admin/frequent-products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.productName.trim(),
          defaultQty: form.qty,
          defaultUnit: form.unit,
          dispatchDay: form.dispatchDay,
          supplierId: form.supplierId || null,
        }),
      }).then(load).catch(() => {});
    }
    setForm({ productName: '', qty: 1, unit: 'kg', supplierId: '', dispatchDay: 'Lunes', notes: '', saveAsFrequent: false });
    setShowItem(false);
  }

  function pickFrequent(fp: FrequentProduct) {
    setItems((prev) => [...prev, {
      productName: fp.name,
      qty: Number(fp.defaultQty),
      unit: fp.defaultUnit,
      supplierId: fp.supplierId,
      supplierName: fp.supplier?.name,
      supplierPhone: fp.supplier?.phone,
      dispatchDay: fp.dispatchDay,
      notes: null,
    }]);
    setShowFreqList(false);
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ─────────── Generar pedido ───────────
  async function generate() {
    setBusy(true);
    try {
      await api('/admin/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      toast('Pedido generado', 'success');
      setConfirming(false);
      setShowSendDialog(true);
      await load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ─────────── Supplier CRUD ───────────
  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierForm.name.trim() || !supplierForm.phone.trim()) {
      toast('Nombre y teléfono obligatorios', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/admin/suppliers', { method: 'POST', body: JSON.stringify(supplierForm) });
      toast('Proveedor agregado', 'success');
      setSupplierForm({ name: '', phone: '', email: '', notes: '' });
      setShowSupplier(false);
      await load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSupplier(id: string) {
    if (!confirm('¿Eliminar proveedor?')) return;
    try {
      await api(`/admin/suppliers/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  async function deleteFrequent(id: string) {
    if (!confirm('¿Eliminar producto frecuente?')) return;
    try {
      await api(`/admin/frequent-products/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  // ─────────── Template ───────────
  async function saveTemplate(value: string) {
    setBusy(true);
    try {
      await api('/admin/supplier-template', { method: 'PATCH', body: JSON.stringify({ template: value }) });
      setTemplate((t) => t ? { ...t, template: value } : t);
      toast('Plantilla guardada', 'success');
      setShowTemplate(false);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  // ─────────── Mensajes WhatsApp por proveedor ───────────
  const messages = useMemo(() => {
    if (!template || items.length === 0 || !tenant) return [];
    // Agrupar por (supplier, dispatchDay)
    const groups = new Map<string, { supplier: Supplier | { id: null; name: string; phone: string }; day: string; items: OrderItem[] }>();
    for (const it of items) {
      if (!it.supplierId) continue;
      const sup = suppliers.find((s) => s.id === it.supplierId);
      if (!sup) continue;
      const day = it.dispatchDay || '—';
      const key = `${sup.id}::${day}`;
      const g = groups.get(key);
      if (g) g.items.push(it);
      else groups.set(key, { supplier: sup, day, items: [it] });
    }
    const loc = tenant.locations?.[0];
    const address = loc?.address ?? tenant.address ?? '';
    return Array.from(groups.values()).map((g) => {
      const productList = g.items
        .map((i) => `• ${i.productName} · ${i.qty} ${i.unit}${i.notes ? ` (${i.notes})` : ''}`)
        .join('\n');
      const message = template.template
        .replace(/\{brandName\}/g, tenant.brandName)
        .replace(/\{address\}/g, address)
        .replace(/\{dispatchDay\}/g, g.day)
        .replace(/\{supplierName\}/g, g.supplier.name)
        .replace(/\{productList\}/g, productList);
      const phone = (g.supplier as Supplier).phone.replace(/[^\d]/g, '');
      const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      return { supplier: g.supplier, day: g.day, items: g.items, message, waLink };
    });
  }, [template, items, suppliers, tenant]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Generador de Pedidos{' '}
          <span className="page-crumb">
            / {stats?.frequentCount ?? 0} productos frecuentes
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={() => setShowTemplate(true)}>
            <Icon name="edit" /> Plantilla
          </button>
          <button className="btn" onClick={() => setShowSupplier(true)}>
            <Icon name="users" /> Proveedores
          </button>
          <button className="btn" onClick={() => setShowItem(true)}>
            <Icon name="plus" /> Agregar producto
          </button>
          <button
            className="btn-primary"
            onClick={() => setConfirming(true)}
            disabled={items.length === 0 || busy}
          >
            <Icon name="send" /> Generar pedido
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Kpi
          label="Productos frecuentes"
          value={stats?.frequentCount ?? 0}
          sub={`${stats?.suppliersCount ?? 0} proveedores`}
          onClick={() => setShowFreqList(true)}
        />
        <Kpi label="Días con despacho" value={stats?.dispatchDaysCount ?? 0} sub={stats?.dispatchDaysCount ? '' : '—'} />
        <Kpi label="Pedidos generados" value={stats?.ordersCount ?? 0} sub="en el historial" />
      </div>

      {/* Productos del pedido */}
      <div className="card mb-4 overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-line">
          <h3 className="font-semibold">Productos del pedido</h3>
          <span className="text-xs text-mute">{items.length} producto{items.length === 1 ? '' : 's'}</span>
        </div>
        <div className="grid grid-cols-[2fr_0.7fr_1.2fr_1fr_auto] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-mute font-semibold border-b border-line bg-bg2/40">
          <div>Producto</div>
          <div>Cantidad</div>
          <div>Proveedor</div>
          <div>Día de despacho</div>
          <div></div>
        </div>
        {items.length === 0 && (
          <div className="p-10 text-center text-mute text-sm">
            No hay productos. Agrega el primero con el botón de arriba.
          </div>
        )}
        {items.map((it, i) => (
          <div
            key={i}
            className="grid grid-cols-[2fr_0.7fr_1.2fr_1fr_auto] gap-3 px-4 py-3 border-b border-line items-center"
          >
            <div className="font-medium">
              {it.productName}
              {it.notes && <div className="text-xs text-mute mt-0.5">{it.notes}</div>}
            </div>
            <div className="text-sm">{it.qty} {it.unit}</div>
            <div className="text-sm">
              {it.supplierName ?? <span className="text-mute italic">— sin proveedor —</span>}
            </div>
            <div>
              {it.dispatchDay && (
                <span className="badge-info text-[10px]">{it.dispatchDay}</span>
              )}
            </div>
            <div>
              <button
                onClick={() => removeItem(i)}
                className="text-mute hover:text-red-500"
              >
                <Icon name="trash" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Top proveedores */}
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon name="trend-up" />
            <h3 className="font-semibold">Top proveedores por uso</h3>
          </div>
          <span className="text-xs text-mute">basado en pedidos</span>
        </div>
        {!stats || stats.topSuppliers.length === 0 ? (
          <div className="text-sm text-mute py-3">
            Aún no hay pedidos generados. Crea el primero arriba.
          </div>
        ) : (
          <div className="space-y-2.5">
            {stats.topSuppliers.map((s, i) => {
              const max = Math.max(...stats.topSuppliers.map((x) => x.count));
              const w = (s.count / max) * 100;
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <div>
                      <span className="text-mute">{i + 1}.</span>{' '}
                      <span className="font-medium">{s.supplierName}</span>{' '}
                      <span className="text-xs text-mute">{s.count} ítem{s.count === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-bg2 rounded-full overflow-hidden">
                    <div className="h-full bg-ok" style={{ width: `${w}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ──────────── Modal: Agregar producto ──────────── */}
      {showItem && (
        <Modal title="Agregar producto" onClose={() => setShowItem(false)}>
          <form onSubmit={addItem} className="space-y-4">
            <Field label="Producto">
              <input
                className="input"
                placeholder="Buscar o escribir un producto…"
                value={form.productName}
                onChange={(e) => setForm({ ...form, productName: e.target.value })}
                list="freq-products"
              />
              <datalist id="freq-products">
                {frequent.map((f) => <option key={f.id} value={f.name} />)}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cantidad">
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  className="input"
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
                />
              </Field>
              <Field label="Unidad">
                <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Proveedor">
              <select className="input" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">— Seleccionar proveedor —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {suppliers.length === 0 && (
                <button type="button" onClick={() => { setShowItem(false); setShowSupplier(true); }} className="text-xs text-brand mt-1">
                  + Agregar primero un proveedor
                </button>
              )}
            </Field>
            <Field label="Día de despacho">
              <select className="input" value={form.dispatchDay} onChange={(e) => setForm({ ...form, dispatchDay: e.target.value })}>
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Notas (opcional)">
              <input
                className="input"
                placeholder="Ej. Sin lactosa, marca específica…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.saveAsFrequent}
                onChange={(e) => setForm({ ...form, saveAsFrequent: e.target.checked })}
              />
              Guardar como producto frecuente para próximos pedidos
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn" onClick={() => setShowItem(false)}>Cancelar</button>
              <button type="submit" className="btn-primary">Agregar</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ──────────── Modal: Proveedores ──────────── */}
      {showSupplier && (
        <Modal title="Proveedores" onClose={() => setShowSupplier(false)} maxW="lg">
          <form
            onSubmit={saveSupplier}
            className="rounded-xl border border-line bg-gradient-to-br from-brand-soft/40 to-bg2/30 p-4 mb-4 space-y-3"
          >
            <div className="text-[11px] uppercase tracking-wider text-brand font-semibold">
              Nuevo proveedor
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Nombre">
                <input
                  className="input"
                  placeholder="Ej: Carnicería La Sazón"
                  value={supplierForm.name}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, name: e.target.value })
                  }
                />
              </Field>
              <Field label="WhatsApp / SMS">
                <input
                  className="input"
                  placeholder="+57 300 000 0000"
                  value={supplierForm.phone}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, phone: e.target.value })
                  }
                />
              </Field>
              <div className="col-span-2">
                <Field label="Email (opcional)">
                  <input
                    className="input"
                    placeholder="contacto@proveedor.com"
                    value={supplierForm.email}
                    onChange={(e) =>
                      setSupplierForm({ ...supplierForm, email: e.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Notas (opcional)">
                  <input
                    className="input"
                    placeholder="Horarios, condiciones de pago, etc"
                    value={supplierForm.notes}
                    onChange={(e) =>
                      setSupplierForm({ ...supplierForm, notes: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
            <button className="btn-primary w-full" type="submit" disabled={busy}>
              <Icon name="plus" /> Agregar proveedor
            </button>
          </form>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
            Proveedores ({suppliers.length})
          </div>
          <div className="space-y-2 max-h-[40vh] overflow-auto">
            {suppliers.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-3 border border-line rounded-lg hover:bg-bg2/30 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-xs text-mute truncate">
                    {s.phone} {s.email && `· ${s.email}`}
                  </div>
                  {s.notes && (
                    <div className="text-[11px] text-mute mt-0.5 line-clamp-1 italic">
                      {s.notes}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteSupplier(s.id)}
                  className="text-mute hover:text-red-500 ml-2 shrink-0"
                  title="Eliminar"
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}
            {suppliers.length === 0 && (
              <div className="text-sm text-mute text-center py-8 border-2 border-dashed border-line rounded-lg">
                Aún no hay proveedores. Cargá el primero arriba ↑
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ──────────── Modal: Productos frecuentes (lista) ──────────── */}
      {showFreqList && (
        <Modal title="Productos frecuentes" onClose={() => setShowFreqList(false)} maxW="lg">
          <p className="text-xs text-mute mb-3">
            Click en un producto para agregarlo al pedido actual.
          </p>
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {frequent.map((fp) => (
              <div
                key={fp.id}
                className="flex items-center justify-between p-3 border border-line rounded-lg hover:bg-bg2/40 cursor-pointer"
                onClick={() => pickFrequent(fp)}
              >
                <div>
                  <div className="font-medium">{fp.name}</div>
                  <div className="text-xs text-mute">
                    {fp.defaultQty} {fp.defaultUnit}
                    {fp.supplier && ` · ${fp.supplier.name}`}
                    {fp.dispatchDay && ` · ${fp.dispatchDay}`}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFrequent(fp.id); }}
                  className="text-mute hover:text-red-500"
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}
            {frequent.length === 0 && (
              <div className="text-sm text-mute text-center py-6">
                No tienes productos frecuentes guardados aún. Marca "Guardar como frecuente" al agregar uno.
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ──────────── Modal: Plantilla del mensaje ──────────── */}
      {showTemplate && template && (
        <TemplateEditor
          template={template}
          onSave={saveTemplate}
          onClose={() => setShowTemplate(false)}
          busy={busy}
        />
      )}

      {/* ──────────── Confirm: Generar pedido ──────────── */}
      {confirming && (
        <Modal title="" onClose={() => setConfirming(false)}>
          <div className="text-center">
            <div className="w-12 h-12 rounded-2xl bg-brand-soft flex items-center justify-center mx-auto mb-3 text-brand">
              <Icon name="send" size={22} />
            </div>
            <h3 className="text-lg font-semibold">Generar pedido</h3>
            <div className="text-sm text-mute mt-1">
              {items.length} producto{items.length === 1 ? '' : 's'} · {messages.length} mensaje{messages.length === 1 ? '' : 's'}
            </div>
            <p className="text-sm text-mute mt-3">
              Se guardará una copia en el historial y se abrirán los mensajes listos para WhatsApp.
            </p>
            <div className="flex justify-center gap-2 mt-5">
              <button className="btn" onClick={() => setConfirming(false)}>Cancelar</button>
              <button className="btn-primary" onClick={generate} disabled={busy}>
                <Icon name="send" /> {busy ? 'Generando…' : 'Generar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ──────────── Send dialog: mensajes por proveedor ──────────── */}
      {showSendDialog && (
        <Modal title="Enviar pedidos a proveedores" onClose={() => { setShowSendDialog(false); setItems([]); }} maxW="xl">
          <div className="space-y-3">
            {messages.map((m, i) => (
              <SupplierMessageCard key={i} message={m} />
            ))}
            {messages.length === 0 && (
              <div className="text-sm text-mute text-center py-6">
                Sin proveedores asignados. Edita los items para asignar uno.
              </div>
            )}
            <button className="btn w-full" onClick={() => { setShowSendDialog(false); setItems([]); }}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Card de un mensaje a proveedor — preview del cuerpo + dos vías de
 *  envío: wa.me link (manual) y Grow Business API (automático, si el
 *  tenant está conectado). La via API prefija con #Switch{N} server-side
 *  cuando aplique. */
function SupplierMessageCard({
  message: m,
}: {
  message: {
    supplier: Supplier | { id: string | null; name: string; phone: string };
    day: string;
    items: OrderItem[];
    message: string;
    waLink: string;
  };
}) {
  const [sending, setSending] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function sendViaApi() {
    if (!m.supplier.id) {
      toast('Asigná un proveedor real antes de enviar', 'error');
      return;
    }
    setSending('sending');
    setErrMsg(null);
    try {
      const r = await api<{ ok: boolean; id?: string | null; message?: string }>(
        `/admin/suppliers/${m.supplier.id}/notify`,
        {
          method: 'POST',
          body: JSON.stringify({ message: m.message }),
        },
      );
      if (r.ok) {
        setSending('sent');
        toast(`SMS enviado a ${m.supplier.name}`, 'success');
        // Volver a 'idle' tras 8s para permitir re-enviar si el dueño
        // necesita reforzar el pedido (ej. el proveedor no respondió).
        // El check visual ✓ desaparece pero el toast ya confirmó el envío.
        window.setTimeout(() => setSending('idle'), 8000);
      } else {
        setSending('error');
        setErrMsg(r.message ?? 'No se pudo enviar');
        toast(r.message ?? 'No se pudo enviar', 'error');
      }
    } catch (e: any) {
      setSending('error');
      setErrMsg(e.message ?? 'Error');
      toast(e.message ?? 'Error', 'error');
    }
  }

  return (
    <div className="border border-line rounded-xl overflow-hidden shadow-card">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-soft to-bg2/30 flex items-center justify-between">
        <div>
          <div className="font-semibold">{m.supplier.name}</div>
          <div className="text-xs text-mute">
            <span className="badge-info text-[10px] mr-1">{m.day}</span>
            {m.items.length} producto{m.items.length === 1 ? '' : 's'} ·{' '}
            <span className="text-ok">{m.supplier.phone}</span>
          </div>
        </div>
      </div>
      <pre className="p-4 text-sm whitespace-pre-wrap font-sans bg-white">{m.message}</pre>
      <div className="px-4 py-2.5 bg-bg2/40 flex flex-wrap gap-2 justify-end items-center">
        {sending === 'sent' && (
          <span className="text-xs text-ok font-semibold">✓ Enviado por Grow Business</span>
        )}
        {sending === 'error' && (
          <span className="text-xs text-bad" title={errMsg ?? ''}>
            ✕ {errMsg ?? 'Error'}
          </span>
        )}
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={sendViaApi}
          disabled={sending === 'sending' || sending === 'sent'}
        >
          {sending === 'sending' ? 'Enviando…' : '⚡ Grow Business'}
        </button>
        <a
          className="btn-primary inline-flex"
          href={m.waLink}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="send" /> WhatsApp
        </a>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, onClick }: { label: string; value: number; sub?: string; onClick?: () => void }) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`card p-4 text-left w-full ${onClick ? 'hover:shadow-md transition cursor-pointer' : ''}`}
    >
      <div className="text-[11px] uppercase tracking-wider text-brand font-semibold">{label}</div>
      <div className="text-3xl font-bold text-brand mt-1">{value}</div>
      {sub && <div className="text-xs text-mute mt-1">{sub}</div>}
    </Comp>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-mute mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title, onClose, children, maxW,
}: { title: string; onClose: () => void; children: React.ReactNode; maxW?: 'lg' | 'xl' }) {
  const w = maxW === 'xl' ? 'max-w-2xl' : maxW === 'lg' ? 'max-w-xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-card rounded-2xl shadow-xl w-full p-5 max-h-[90vh] overflow-auto ${w}`} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function TemplateEditor({
  template, onSave, onClose, busy,
}: { template: { template: string; default: string }; onSave: (v: string) => void; onClose: () => void; busy: boolean }) {
  const [v, setV] = useState(template.template);
  return (
    <Modal title="Plantilla del mensaje a proveedor" onClose={onClose} maxW="lg">
      <p className="text-xs text-mute mb-2">
        Usa estas variables (se reemplazan automáticamente):
      </p>
      <div className="text-xs space-x-2 mb-3">
        {['{brandName}', '{address}', '{dispatchDay}', '{supplierName}', '{productList}'].map((tag) => (
          <code key={tag} className="bg-bg2 px-1.5 py-0.5 rounded">{tag}</code>
        ))}
      </div>
      <textarea
        className="input min-h-[280px] font-mono text-sm"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <div className="flex justify-between items-center mt-4">
        <button className="text-xs text-mute hover:text-ink" onClick={() => setV(template.default)}>
          ↺ Restaurar por defecto
        </button>
        <div className="flex gap-2">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => onSave(v)} disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
