'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Branding = {
  appLogoUrl: string | null;
  faviconUrl: string | null;
  supportWhatsapp: string | null;
  scannerStaffPin: string | null;
  salesWhatsapp: string | null;
  salesEmail: string | null;
  salesInstagram: string | null;
  landingStatBusinesses: string | null;
  landingStatWalletCustomers: string | null;
  landingStatOrders: string | null;
  landingStatRating: string | null;
};

export default function AdminBrandingPage() {
  const [b, setB] = useState<Branding>({
    appLogoUrl: null,
    faviconUrl: null,
    supportWhatsapp: null,
    scannerStaffPin: null,
    salesWhatsapp: null,
    salesEmail: null,
    salesInstagram: null,
    landingStatBusinesses: null,
    landingStatWalletCustomers: null,
    landingStatOrders: null,
    landingStatRating: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // Endpoint admin que SÍ devuelve scannerStaffPin (el público no, por seguridad)
      const data = await api<Branding>('/admin/branding');
      setB(data);
    } catch (e: any) {
      toast(e.message || 'Error cargando branding', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api('/admin/branding', {
        method: 'PATCH',
        body: JSON.stringify(b),
      });
      toast('Branding guardado', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Branding global <span className="page-crumb">/ Super Admin</span>
        </h1>
        <button className="btn-primary" onClick={save} disabled={saving || loading}>
          <Icon name="check" /> {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {loading ? (
        <div className="card card-pad">
          <div className="h-4 bg-bg2 rounded animate-shimmer mb-3" />
          <div className="h-40 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="card card-pad">
            <h2 className="text-base font-semibold m-0">Logo del panel</h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              Aparece en el sidebar superior izquierdo del panel y como icono
              principal de la marca Clubify dentro de la app. PNG cuadrado con
              fondo transparente recomendado, mínimo 256×256.
            </p>
            <div className="mt-3.5">
              <ImageUploader
                value={b.appLogoUrl}
                onChange={(url) => setB({ ...b, appLogoUrl: url })}
                folder="branding"
              />
            </div>
          </div>

          <div className="card card-pad">
            <h2 className="text-base font-semibold m-0">Favicon</h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              Icono que aparece en la pestaña del navegador (junto al título de
              la página). PNG cuadrado, ideal 64×64 px, máx 512×512.
            </p>
            <div className="mt-3.5">
              <ImageUploader
                value={b.faviconUrl}
                onChange={(url) => setB({ ...b, faviconUrl: url })}
                folder="branding"
              />
            </div>
          </div>
        </div>
      )}

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          📞 Contacto comercial (landing pública)
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Datos que se usan en los botones de la landing{' '}
          <code className="bg-bg2 px-1 rounded">soyclubify.com</code> —
          "Agenda una demo" (WhatsApp), botón de email y botón de
          Instagram. Si dejás un campo vacío, el botón correspondiente
          se oculta automáticamente.
        </p>
        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">WhatsApp ventas</label>
            <input
              type="text"
              className="input"
              placeholder="+57 300 000 0000"
              value={b.salesWhatsapp ?? ''}
              onChange={(e) => setB({ ...b, salesWhatsapp: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email ventas</label>
            <input
              type="email"
              className="input"
              placeholder="ventas@soyclubify.com"
              value={b.salesEmail ?? ''}
              onChange={(e) => setB({ ...b, salesEmail: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Instagram</label>
            <input
              type="text"
              className="input"
              placeholder="https://instagram.com/clubify"
              value={b.salesInstagram ?? ''}
              onChange={(e) => setB({ ...b, salesInstagram: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          📊 Stats de la landing pública
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Contadores que se muestran en la sección de números de{' '}
          <code className="bg-bg2 px-1 rounded">soyclubify.com</code>.
          Editables sin redeploy. Si dejás un campo vacío, se usa el valor
          por defecto. Aceptan cualquier texto (ej: <code>+150</code>,{' '}
          <code>30K+</code>, <code>4.9 / 5</code>).
        </p>
        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Negocios activos</label>
            <input
              type="text"
              className="input"
              placeholder="+150"
              maxLength={40}
              value={b.landingStatBusinesses ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatBusinesses: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Clientes con tarjeta wallet</label>
            <input
              type="text"
              className="input"
              placeholder="+30K"
              maxLength={40}
              value={b.landingStatWalletCustomers ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatWalletCustomers: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Pedidos / mes</label>
            <input
              type="text"
              className="input"
              placeholder="50K"
              maxLength={40}
              value={b.landingStatOrders ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatOrders: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Calificación</label>
            <input
              type="text"
              className="input"
              placeholder="4.9 / 5"
              maxLength={40}
              value={b.landingStatRating ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatRating: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          🔐 PIN del escáner
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          PIN que el cajero/staff debe ingresar en <code>/scan</code> cuando
          quiere agregar <b>más de 1 sello</b> en una sola escaneada (anti-abuso).
          Cada escaneada normal agrega 1 sello sin pedir nada. Si dejás vacío,
          se permite agregar cualquier cantidad sin PIN. Recomendado: 4–6 dígitos.
        </p>
        <div className="mt-3.5 max-w-sm">
          <label className="label">PIN (visible solo para super admin)</label>
          <input
            type="text"
            inputMode="numeric"
            className="input font-mono tracking-widest"
            placeholder="ej: 1234"
            value={b.scannerStaffPin ?? ''}
            onChange={(e) =>
              setB({ ...b, scannerStaffPin: e.target.value })
            }
          />
        </div>
      </div>

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          📞 Dudas por WhatsApp (soporte)
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Número al que llegan los clicks en el botón "Tengo dudas" de los
          lockscreens Pro, billing, y CTAs de soporte en el panel y la
          landing. Si está vacío, esos botones se ocultan automáticamente.
        </p>
        <div className="mt-3.5 max-w-sm">
          <label className="label">Número (con prefijo país)</label>
          <input
            type="text"
            className="input"
            placeholder="+57 300 000 0000"
            value={b.supportWhatsapp ?? ''}
            onChange={(e) =>
              setB({ ...b, supportWhatsapp: e.target.value })
            }
          />
        </div>
      </div>

      <div className="card card-pad mt-5 bg-brand-soft border-brand/30">
        <h3 className="text-sm font-semibold m-0">¿Cómo se aplica?</h3>
        <ul className="text-xs text-mute mt-2 leading-relaxed space-y-1.5 list-disc pl-4">
          <li>
            Al guardar, los cambios se reflejan instantáneamente en todos los
            paneles de tenants (no requiere redeploy).
          </li>
          <li>
            El favicon puede tardar unos segundos en aparecer porque el
            navegador cachea iconos. Refrescar (Cmd/Ctrl+Shift+R) lo fuerza.
          </li>
          <li>
            Si dejás un campo vacío, se usan los defaults de Clubify
            (clubify-logo.png y favicon.png en /public).
          </li>
        </ul>
      </div>
    </div>
  );
}
