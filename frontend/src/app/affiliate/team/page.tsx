'use client';
/**
 * /affiliate/team — gestión de vendedores del embajador.
 *
 * Solo visible para AFFILIATE_AMBASSADOR cuyo ReferralCode tenga
 * `allowVendors=true`. Si no está habilitado, muestra mensaje pidiéndolo
 * al super admin. El backend igual rechaza POST si el toggle está off.
 *
 * Layout:
 *  - Header con back + logo + logout
 *  - Card resumen: máx Y · usado · disponible
 *  - Tabla con vendedores (nombre, email, whatsapp, % comisión, estado,
 *    sales/commissions, acciones)
 *  - Modal crear/editar
 *  - Modales confirm para activar / desactivar / eliminar
 *
 * Endpoints:
 *  - GET    /referrals/vendors/by-embajador/:embajadorCodeId  →  { max, used, available, vendors[] }
 *  - POST   /referrals/vendors
 *  - PATCH  /referrals/vendors/:id
 *  - POST   /referrals/vendors/:id/deactivate
 *  - POST   /referrals/vendors/:id/reactivate
 *  - DELETE /referrals/vendors/:id  (409 si tiene comisiones pendientes)
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, clearSession } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { toast } from '@/components/Toast';
import { PhoneInput } from '@/components/PhoneInput';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';

type Me = {
  user: { id: string; email: string; fullName: string; role: string } | null;
  role: 'AFFILIATE_INFLUENCER' | 'AFFILIATE_AMBASSADOR' | 'AFFILIATE_SOCIO';
  myCode: {
    id: string;
    code: string;
    slug: string;
    commissionPercent: number;
    role: string;
    parentCode: string | null;
    parentName: string | null;
    campaignName: string | null;
    allowVendors?: boolean;
    maxCommissionPercent?: number;
  } | null;
};

type Vendor = {
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  commissionPercent: number;
  isActive: boolean;
  createdAt: string;
  salesCount: number;
  commissionsCount: number;
};

type VendorsResp = {
  max: number;
  // CORRECCIÓN LÓGICA 2026-06-05: ya NO usamos available/used —
  // la comisión es INDIVIDUAL por vendedor, no acumulada. Mantenemos
  // los campos como opcionales por backwards-compat con responses
  // viejas (servidor sin redeploy), pero el código UI ya no los lee.
  used?: number;
  available?: number;
  vendorCommissionMax?: number;
  vendors: Vendor[];
};

export default function AffiliateTeamPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<VendorsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Vendor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Vendor | null>(null);

  useEffect(() => {
    api<Me>('/affiliate/me')
      .then((m) => {
        setMe(m);
        // Solo embajadores ven esta página. Influencer/socio redirect home.
        if (m.role !== 'AFFILIATE_AMBASSADOR') {
          router.replace('/affiliate');
          return;
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  const codeId = me?.myCode?.id ?? null;

  function reload() {
    if (!codeId) return;
    api<VendorsResp>(`/referrals/vendors/by-embajador/${codeId}`)
      .then(setData)
      .catch((e) => toast(e.message || 'No se pudo cargar el equipo', 'error'));
  }

  useEffect(() => {
    if (!codeId || me?.myCode?.allowVendors === false) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeId, me?.myCode?.allowVendors]);

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (loading) return <div className="p-8 text-mute">Cargando…</div>;
  if (!me) return null;

  const allowed = me.myCode?.allowVendors === true;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-white px-5 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <Link href="/affiliate" className="flex items-center gap-2">
            <Logo size={28} />
            <span className="font-semibold text-sm hidden sm:inline">
              ← Panel afiliado
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-xs text-mute hidden sm:block">
              {me.user?.fullName} ·{' '}
              <span className="font-medium">👥 Embajador</span>
            </div>
            <button onClick={logout} className="text-xs text-mute hover:text-ink">
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold mb-1">Tu equipo de vendedores</h1>
          <div className="text-sm text-mute">
            Suma a tu equipo y reparte parte de tu comisión por cada venta
            que ellos cierren.
          </div>
        </div>

        {!allowed && (
          <div className="card card-pad text-center py-12 max-w-xl mx-auto">
            <div className="text-4xl mb-3">🔒</div>
            <div className="font-semibold mb-2">
              Este perfil no tiene activado el módulo de vendedores.
            </div>
            <div className="text-sm text-mute leading-relaxed">
              Pedile al super admin que te lo habilite y te asigne una
              comisión máxima para repartir entre tu equipo.
            </div>
            <Link
              href="/affiliate"
              className="inline-block mt-4 btn-ghost text-sm"
            >
              ← Volver al panel
            </Link>
          </div>
        )}

        {allowed && data && (
          <>
            <SummaryCard data={data} />

            <div className="card card-pad mb-5 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-semibold m-0">
                  Vendedores ({data.vendors.length})
                </h3>
                <div className="text-xs text-mute mt-0.5">
                  Activos:{' '}
                  <strong>{data.vendors.filter((v) => v.isActive).length}</strong>{' '}
                  · Inactivos:{' '}
                  <strong>{data.vendors.filter((v) => !v.isActive).length}</strong>
                </div>
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="btn-primary text-sm whitespace-nowrap"
                title={`Comisión máxima por vendedor: ${data.max}%. Cada vendedor cobra su % SOLO en SUS ventas.`}
              >
                + Nuevo vendedor
              </button>
            </div>

            <VendorsTable
              vendors={data.vendors}
              onEdit={(v) => setEditTarget(v)}
              onDelete={(v) => setDeleteTarget(v)}
              onToggle={(v) => setToggleTarget(v)}
            />
          </>
        )}

        {allowed && !data && (
          <div className="card card-pad h-32 animate-shimmer" />
        )}
      </main>

      {showCreate && data && codeId && (
        <VendorFormModal
          title="Nuevo vendedor"
          max={data.max}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            reload();
          }}
          embajadorCodeId={codeId}
        />
      )}

      {editTarget && data && codeId && (
        <VendorFormModal
          title={`Editar ${editTarget.ownerName}`}
          max={data.max}
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            reload();
          }}
          embajadorCodeId={codeId}
        />
      )}

      {toggleTarget && (
        <ConfirmDeleteModal
          title={
            toggleTarget.isActive
              ? `Desactivar a ${toggleTarget.ownerName}`
              : `Reactivar a ${toggleTarget.ownerName}`
          }
          confirmLabel={toggleTarget.isActive ? 'Desactivar' : 'Reactivar'}
          description={
            toggleTarget.isActive ? (
              <>
                El vendedor dejará de poder generar comisiones nuevas. Su
                historial se preserva y podés reactivarlo cuando quieras.
              </>
            ) : (
              <>
                El vendedor volverá a generar comisiones desde sus próximas
                ventas. Su comisión de{' '}
                <strong>{toggleTarget.commissionPercent}%</strong> vuelve a
                contar contra tu disponible.
              </>
            )
          }
          onConfirm={async () => {
            try {
              const path = toggleTarget.isActive
                ? `/referrals/vendors/${toggleTarget.id}/deactivate`
                : `/referrals/vendors/${toggleTarget.id}/reactivate`;
              await api(path, { method: 'POST' });
              toast(
                toggleTarget.isActive
                  ? `${toggleTarget.ownerName} desactivado`
                  : `${toggleTarget.ownerName} reactivado`,
                'success',
              );
              setToggleTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || 'No se pudo cambiar el estado', 'error');
            }
          }}
          onClose={() => setToggleTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Eliminar a ${deleteTarget.ownerName}`}
          description={
            <>
              Esta acción es <strong>permanente</strong> y solo se permite
              si el vendedor <strong>no tiene comisiones pendientes</strong>.
              Si las tiene, recibirás un aviso y podrás desactivarlo en su
              lugar para conservar el historial.
            </>
          }
          onConfirm={async () => {
            try {
              await api(`/referrals/vendors/${deleteTarget.id}`, {
                method: 'DELETE',
              });
              toast(`${deleteTarget.ownerName} eliminado`, 'success');
              setDeleteTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || 'No se pudo eliminar', 'error');
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function SummaryCard({ data }: { data: VendorsResp }) {
  // CORRECCIÓN LÓGICA 2026-06-05: ya no hay "Disponible" — cada vendor
  // tiene su comisión INDIVIDUAL que se aplica solo en SUS ventas. El
  // tope es por vendedor (= max del embajador), no acumulado.
  const activeCount = data.vendors.filter((v) => v.isActive).length;
  return (
    <div className="card card-pad mb-5">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Stat
          label="Mi comisión máxima"
          value={`${data.max}%`}
          hint="El admin te asignó este tope"
        />
        <Stat
          label="Tope por vendedor"
          value={`${data.max}%`}
          tone="ok"
          hint="Ningún vendedor puede cobrar más que tu máximo"
        />
      </div>
      <div className="text-[11px] text-mute mt-2 leading-snug">
        Cada venta de un vendedor de tu equipo: el vendedor recibe{' '}
        <strong>su %</strong> y vos recibís <strong>{data.max}% − % del vendedor</strong>.
        Por ejemplo, si vos tenés 25% y el vendedor 18%: él cobra 18% y vos 7%
        en esa venta. El % de cada vendedor se aplica SOLO en SUS ventas — no
        se acumula entre vendedores. Tenés {activeCount} vendedor{activeCount === 1 ? '' : 'es'} activo{activeCount === 1 ? '' : 's'}.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'amber' | 'bad';
}) {
  const cls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'amber'
      ? 'text-amber-700'
      : tone === 'bad'
      ? 'text-red-700'
      : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-0.5 ${cls}`}>{value}</div>
      {hint && (
        <div className="text-[11px] text-mute mt-0.5 leading-snug">{hint}</div>
      )}
    </div>
  );
}

function VendorsTable({
  vendors,
  onEdit,
  onDelete,
  onToggle,
}: {
  vendors: Vendor[];
  onEdit: (v: Vendor) => void;
  onDelete: (v: Vendor) => void;
  onToggle: (v: Vendor) => void;
}) {
  if (vendors.length === 0) {
    return (
      <div className="card card-pad text-center py-12">
        <div className="text-4xl mb-2">🌱</div>
        <div className="font-semibold">Aún no sumaste vendedores a tu equipo</div>
        <div className="text-sm text-mute mt-1">
          Toca <strong>+ Nuevo vendedor</strong> para sumar al primero.
        </div>
      </div>
    );
  }
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-bg2">
            <tr>
              {['Vendedor', 'Código', '%', 'Ventas', 'Comisiones', 'Estado', ''].map(
                (h, i) => (
                  <th
                    key={h || `c-${i}`}
                    className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr
                key={v.id}
                className={`border-t border-line2 hover:bg-[#FAFAFB] ${
                  v.isActive ? '' : 'opacity-60'
                }`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{v.ownerName}</div>
                  <div className="text-xs text-mute">{v.ownerEmail}</div>
                  <div className="text-xs text-mute">{v.ownerWhatsapp}</div>
                </td>
                <td className="px-4 py-3 font-mono font-bold">{v.code}</td>
                <td className="px-4 py-3">{v.commissionPercent}%</td>
                <td className="px-4 py-3 text-center">{v.salesCount}</td>
                <td className="px-4 py-3 text-center">{v.commissionsCount}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                      v.isActive
                        ? 'bg-ok-soft text-ok'
                        : 'bg-bg2 text-mute'
                    }`}
                  >
                    {v.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      onClick={() => onEdit(v)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-sky-100 text-sky-800 hover:bg-sky-200 cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
                      title="Editar datos del vendedor"
                    >
                      ✎ Editar
                    </button>
                    <button
                      onClick={() => onToggle(v)}
                      className={`text-xs font-semibold px-2.5 py-1.5 rounded-md cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent] ${
                        v.isActive
                          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                          : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                      }`}
                      title={
                        v.isActive
                          ? 'Desactivar (preserva historial)'
                          : 'Reactivar'
                      }
                    >
                      {v.isActive ? '⏸ Desactivar' : '▶ Reactivar'}
                    </button>
                    <button
                      onClick={() => onDelete(v)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
                      title="Eliminar (solo si no tiene comisiones pendientes)"
                    >
                      🗑 Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorFormModal({
  title,
  max,
  initial,
  onClose,
  onSaved,
  embajadorCodeId,
}: {
  title: string;
  // CORRECCIÓN LÓGICA 2026-06-05: el tope ahora es INDIVIDUAL por
  // vendor (= max del embajador). No hay "available" acumulado.
  max: number;
  initial?: Vendor;
  onClose: () => void;
  onSaved: () => void;
  embajadorCodeId: string;
}) {
  const [fullName, setFullName] = useState(initial?.ownerName ?? '');
  const [email, setEmail] = useState(initial?.ownerEmail ?? '');
  const [whatsapp, setWhatsapp] = useState(initial?.ownerWhatsapp ?? '');
  const [commissionPercent, setCommissionPercent] = useState<number>(
    initial?.commissionPercent ?? Math.min(5, max),
  );
  const [busy, setBusy] = useState(false);

  const overLimit = commissionPercent > max;
  const isEdit = !!initial;

  const helper = useMemo(() => {
    if (overLimit) {
      return {
        cls: 'text-red-700',
        text: `Excede tu comisión máxima (${max}%).`,
      };
    }
    return {
      cls: 'text-mute',
      text: `Comisión individual del vendedor. Tope: ${max}%. Se aplica SOLO en SUS ventas.`,
    };
  }, [overLimit, max]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (overLimit) {
      toast(`La comisión excede el máximo (${max}%)`, 'error');
      return;
    }
    if (commissionPercent <= 0) {
      toast('La comisión debe ser mayor a 0', 'error');
      return;
    }
    setBusy(true);
    try {
      if (isEdit && initial) {
        await api(`/referrals/vendors/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            whatsapp: whatsapp.trim(),
            commissionPercent,
          }),
        });
        toast(`${fullName} actualizado`, 'success');
      } else {
        await api('/referrals/vendors', {
          method: 'POST',
          body: JSON.stringify({
            embajadorCodeId,
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            whatsapp: whatsapp.trim(),
            commissionPercent,
          }),
        });
        toast(`${fullName} sumado a tu equipo`, 'success');
      }
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold text-base">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-3">
          <div>
            <label className="label">Nombre completo</label>
            <input
              className="input"
              placeholder="Ej: Camila Pérez"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Correo</label>
            <input
              className="input"
              type="email"
              placeholder="correo@ejemplo.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="text-[11px] text-mute mt-1 leading-snug">
              El correo tiene que ser único en todo Clubify. Si ya existe,
              vas a ver un error al guardar.
            </div>
          </div>
          <div>
            <label className="label">WhatsApp</label>
            <PhoneInput
              value={whatsapp}
              onChange={(v) => setWhatsapp(v)}
              placeholder="WhatsApp del vendedor"
            />
          </div>
          <div>
            <label className="label">Comisión % por venta</label>
            <input
              className={`input ${overLimit ? 'border-red-400' : ''}`}
              type="number"
              min={0.5}
              max={100}
              step={0.5}
              required
              value={commissionPercent}
              onChange={(e) =>
                setCommissionPercent(Number(e.target.value) || 0)
              }
            />
            <div className={`text-[11px] mt-1 leading-snug ${helper.cls}`}>
              {helper.text}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost text-sm"
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={busy || overLimit}
            >
              {busy ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear vendedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
