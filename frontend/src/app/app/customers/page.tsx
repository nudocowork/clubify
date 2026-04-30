'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, downloadFile } from '@/lib/api';
import { Icon } from '@/components/Icon';

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function CustomersPage() {
  const [list, setList] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    setList(await api(`/customers${params}`));
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api('/customers', { method: 'POST', body: JSON.stringify(form) });
    setForm({ fullName: '', email: '', phone: '' });
    setShowForm(false);
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Clientes <span className="page-crumb">/ {list.length} registros</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm w-52 bg-transparent"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
          </div>
          <button
            className="btn-ghost text-xs"
            title="Descargar CSV"
            onClick={() =>
              downloadFile(
                `/customers/export.csv${search ? `?search=${encodeURIComponent(search)}` : ''}`,
                `clientes-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            ⤓ CSV
          </button>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            <Icon name="plus" /> {showForm ? 'Cancelar' : 'Nuevo cliente'}
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={create}
          className="card card-pad mb-4 grid grid-cols-1 md:grid-cols-3 gap-3"
        >
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="md:col-span-3">
            <button className="btn-primary">Guardar</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-[13.5px]">
          <thead className="bg-bg2">
            <tr>
              {['Cliente', 'Email', 'Teléfono', 'Pases', 'Sellos'].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-mute" colSpan={5}>
                  Sin clientes aún.
                </td>
              </tr>
            )}
            {list.map((c) => (
              <tr key={c.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                <td className="px-4 py-3.5">
                  <Link
                    href={`/app/customers/${c.id}`}
                    className="flex items-center gap-2.5 hover:text-brand"
                  >
                    <span
                      className={`avatar w-8 h-8 text-xs ${avatarClass(c.fullName)}`}
                    >
                      {initials(c.fullName)}
                    </span>
                    <div className="font-medium">{c.fullName}</div>
                  </Link>
                </td>
                <td className="px-4 py-3.5 text-mute">{c.email}</td>
                <td className="px-4 py-3.5 text-mute">{c.phone}</td>
                <td className="px-4 py-3.5">
                  <span className="badge badge-info">{c._count?.passes ?? 0}</span>
                </td>
                <td className="px-4 py-3.5">{c._count?.stamps ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
