'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const MODULE_LABELS: Record<string, string> = {
  REFERRALS: 'Referidos',
  ORDERS: 'Pedidos',
  GROW_BUSINESS_SMS: 'GrowBusiness SMS',
};

type Row = {
  id: string;
  name: string;
  initial: string | null;
  primaryColor: string;
  status: 'ACTIVE' | 'SUSPENDED';
  modules: Record<string, boolean>;
};

export default function ModulosPage() {
  const [modules, setModules] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ modules: string[]; rows: Row[] }>('/superadmin/modules');
      setModules(data.modules);
      setRows(data.rows);
    } catch (e: any) {
      console.error(e);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(rowId: string, m: string, next: boolean) {
    const key = `${rowId}-${m}`;
    setBusy(key);
    // Optimistic
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId ? { ...r, modules: { ...r.modules, [m]: next } } : r,
      ),
    );
    try {
      await api(`/superadmin/modules/${rowId}/${m}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
    } catch (e: any) {
      // revert
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, modules: { ...r.modules, [m]: !next } } : r,
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Módulos
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        Activa o desactiva módulos por marca blanca. Si está desactivado, no aparece en sus negocios.
      </p>

      <div
        className="rounded-[14px] overflow-hidden"
        style={{
          background: 'white',
          border: '1px solid #e7e9ec',
          boxShadow: '0 1px 2px rgba(16,24,40,.04)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 760, borderCollapse: 'collapse' }}>
            <thead style={{ background: '#fafbfc', borderBottom: '1px solid #eef0f2' }}>
              <tr>
                <th
                  className="text-[11px] font-bold uppercase"
                  style={{ padding: '16px 18px', letterSpacing: 0.5, color: '#9aa4af' }}
                >
                  Marca Blanca
                </th>
                {modules.map((m) => (
                  <th
                    key={m}
                    className="text-[11px] font-bold uppercase"
                    style={{
                      padding: '16px 18px',
                      letterSpacing: 0.5,
                      color: '#9aa4af',
                      textAlign: 'center',
                    }}
                  >
                    {MODULE_LABELS[m] ?? m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #eef0f2' }}>
                  <td style={{ padding: '14px 18px' }}>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white font-bold text-sm shrink-0"
                        style={{ background: r.primaryColor }}
                      >
                        {r.initial ?? r.name[0]?.toUpperCase()}
                      </div>
                      <div className="font-semibold text-sm" style={{ color: '#16241c' }}>
                        {r.name}
                      </div>
                    </div>
                  </td>
                  {modules.map((m) => {
                    const on = r.modules[m];
                    const key = `${r.id}-${m}`;
                    return (
                      <td key={m} style={{ padding: '14px 18px', textAlign: 'center' }}>
                        <Toggle
                          checked={on}
                          disabled={busy === key}
                          onChange={(next) => toggle(r.id, m, next)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={1 + modules.length} style={{ padding: 30, textAlign: 'center', color: '#9aa4af' }}>
                    Sin marcas blancas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="relative inline-block transition"
      style={{
        width: 42,
        height: 24,
        borderRadius: 12,
        background: checked ? '#22c55e' : '#cbd5e1',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
      aria-pressed={checked}
    >
      <span
        className="absolute top-0.5 transition-all"
        style={{
          left: checked ? 20 : 2,
          width: 20,
          height: 20,
          background: 'white',
          borderRadius: '50%',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }}
      />
    </button>
  );
}
