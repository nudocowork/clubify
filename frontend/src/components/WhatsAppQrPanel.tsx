'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Panel "QR WhatsApp" de la marca (Automatizaciones → tab). EMBEBE la página de
// conexión de WhatsApp del proveedor (ej. wazzap.mx, tipo "Embedded Page"), que
// renderiza el QR VIVO de WhatsApp-Web: ese sí es escaneable desde WhatsApp →
// Dispositivos vinculados. (Generar un QR con la URL NO funciona: WhatsApp no lo
// lee.) El enlace de origen no se muestra como texto; solo el QR embebido.
// Backend: GET /admin/automations/whatsapp-qr → { url }.

export default function WhatsAppQrPanel() {
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ url: string | null } | null>('/admin/automations/whatsapp-qr')
      .then((r) => {
        if (cancelled) return;
        setUrl(r?.url ?? null);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="py-10 text-center text-sm text-slate-400">Cargando…</div>;
  }

  if (!url) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-2xl">
          📱
        </div>
        <h3 className="text-sm font-semibold text-slate-800">QR de WhatsApp no configurado</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Todavía no se cargó el enlace de conexión de WhatsApp de tu marca. Escribinos
          para activarlo y aquí aparecerá el código QR para conectar tu número.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-center text-base font-semibold text-slate-800">Conectá tu WhatsApp</h3>
        <p className="mx-auto mt-1 max-w-sm text-center text-sm text-slate-500">
          Abrí WhatsApp en tu teléfono → <b>Dispositivos vinculados</b> → <b>Vincular un
          dispositivo</b> y escaneá el código de abajo para conectar tu número.
        </p>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <iframe
            src={url}
            title="Conexión de WhatsApp"
            className="block h-[560px] w-full"
            allow="clipboard-write"
          />
        </div>
      </div>
    </div>
  );
}
