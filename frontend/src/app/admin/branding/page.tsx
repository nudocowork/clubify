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
  welcomePopupImageUrl: string | null;
  welcomePopupEnabled: boolean;
};

export default function AdminBrandingPage() {
  const [b, setB] = useState<Branding>({
    appLogoUrl: null,
    faviconUrl: null,
    supportWhatsapp: null,
    welcomePopupImageUrl: null,
    welcomePopupEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api<Branding>('/branding');
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

      <div className="card card-pad mt-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <h2 className="text-base font-semibold m-0">
              🎉 Popup de bienvenida (post-compra)
            </h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              Se muestra una sola vez al dueño del negocio la primera vez
              que entra al panel después de comprar Clubify (status ACTIVE).
              Tiene una imagen y un botón que abre WhatsApp al número de
              soporte de arriba con un mensaje pre-armado para agendar una
              sesión personalizada.
            </p>
            <label className="flex items-center gap-2 text-sm mt-3">
              <input
                type="checkbox"
                checked={b.welcomePopupEnabled}
                onChange={(e) =>
                  setB({ ...b, welcomePopupEnabled: e.target.checked })
                }
              />
              Mostrar popup a tenants nuevos
            </label>
            <p className="text-[11px] text-mute mt-2">
              Tip: PNG/JPG horizontal ~800×500 px funciona bien. Sin imagen
              configurada, el popup no aparece aunque esté activado.
            </p>
          </div>
          <div className="w-full sm:w-[300px]">
            <ImageUploader
              value={b.welcomePopupImageUrl}
              onChange={(url) => setB({ ...b, welcomePopupImageUrl: url })}
              folder="branding"
              crop={false}
            />
          </div>
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
