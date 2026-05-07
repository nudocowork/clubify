'use client';
import { useEffect, useState } from 'react';
import { api, getUser } from '@/lib/api';

type Config = {
  shouldShow: boolean;
  imageUrl: string | null;
  supportPhone: string | null;
  message: string;
};

/**
 * Popup de bienvenida que aparece la primera vez que el dueño entra al
 * panel después de comprar Clubify. Lo monta el layout del panel; sólo
 * dispara si el server dice shouldShow=true (es TENANT_OWNER, status
 * ACTIVE, popup habilitado en super admin, image url configurada,
 * todavía no lo cerró).
 *
 * Al cerrar (ya sea con × o con el botón "Agendar"), llamamos a
 * /welcome-popup/dismiss para marcarlo visto y que no vuelva a aparecer.
 */
export function WelcomePopup() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== 'TENANT_OWNER') return;
    api<Config>('/welcome-popup/me')
      .then((c) => {
        setCfg(c);
        if (c.shouldShow) setOpen(true);
      })
      .catch(() => {});
  }, []);

  async function dismiss() {
    setOpen(false);
    setBusy(true);
    try {
      await api('/welcome-popup/dismiss', { method: 'POST' });
    } catch {
      // si falla, no es crítico — peor escenario, vuelve a aparecer una vez
    } finally {
      setBusy(false);
    }
  }

  function openWhatsApp() {
    if (!cfg?.supportPhone) {
      dismiss();
      return;
    }
    const phone = cfg.supportPhone.replace(/[^\d]/g, '');
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(cfg.message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    dismiss();
  }

  if (!open || !cfg?.shouldShow) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={dismiss}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden relative animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Cerrar"
          className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-ink flex items-center justify-center text-xl shadow-md backdrop-blur"
        >
          ×
        </button>

        {cfg.imageUrl && (
          <img
            src={cfg.imageUrl}
            alt=""
            className="w-full h-64 object-cover"
            draggable={false}
          />
        )}

        <div className="p-6 text-center">
          <h2 className="text-2xl font-bold mb-2">
            🎉 ¡Bienvenido a Clubify!
          </h2>
          <p className="text-mute text-sm leading-relaxed">
            Agenda una sesión personalizada con nuestro equipo para que te
            ayudemos a sacar el máximo provecho de la plataforma desde el
            día uno.
          </p>

          <button
            onClick={openWhatsApp}
            disabled={busy || !cfg.supportPhone}
            className="mt-5 w-full rounded-pill text-white font-semibold py-3.5 px-5 flex items-center justify-center gap-2 transition disabled:opacity-50"
            style={{ background: '#25D366' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Agendar por WhatsApp
          </button>

          {!cfg.supportPhone && (
            <p className="text-xs text-mute mt-3">
              Soporte aún no configurado. Cerrá esta ventana y vuelve a
              entrar más tarde.
            </p>
          )}

          <button
            onClick={dismiss}
            className="mt-3 text-xs text-mute hover:text-ink"
          >
            Lo haré después
          </button>
        </div>
      </div>
    </div>
  );
}
