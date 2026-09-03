'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

export type SocioParaEntregar = {
  passId: string;
  nombre: string;
  telefono: string | null;
};

/**
 * Cómo le llega la tarjeta al socio.
 *
 * Es el paso que faltaba: el negocio daba de alta a alguien y se quedaba sin
 * saber qué hacer después. La tarjeta se emite en el alta, pero hasta que el
 * cliente ABRE su enlace y la instala, no la tiene en el móvil.
 *
 * Dos caminos, según dónde esté el cliente:
 *  · Delante del mostrador → le enseñas el QR y lo escanea con la cámara.
 *  · No está → se lo mandas por WhatsApp, o copias el enlace.
 *
 * El enlace lleva `?welcome=1` a propósito: es lo que hace que la página le
 * diga «aún no has terminado, instala tu tarjeta». Sin él ve la variante de
 * quien vuelve a mirar una tarjeta que ya tiene, que no empuja a instalarla.
 */
export function EntregarTarjeta({
  socio,
  plan,
  onCerrar,
}: {
  socio: SocioParaEntregar;
  plan: string;
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const url =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/w/${socio.passId}?welcome=1`;

  // Cuando el alta se hizo solo con el teléfono, el «nombre» del socio ES el
  // número — la base exige uno. Saludar con él («Hola 3001234567») es peor que
  // no saludar por su nombre, así que en ese caso se omite.
  const pareceNombre = /\p{L}/u.test(socio.nombre);
  const saludo = pareceNombre ? `Hola ${socio.nombre}, ya` : '¡Ya';
  const mensaje = `${saludo} tienes tu tarjeta de ${plan}. Ábrela aquí y añádela a tu móvil: ${url}`;
  // Solo dígitos: wa.me rechaza espacios, guiones y el «+».
  const telefono = (socio.telefono ?? '').replace(/\D/g, '');
  const whatsapp = telefono
    ? `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`
    : `https://wa.me/?text=${encodeURIComponent(mensaje)}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles (Safari fuera de https, sobre todo): se
      // abre y que lo copie de la barra. Peor sería no dar ninguna salida.
      window.open(url, '_blank');
    }
  }

  return (
    <div className="card card-pad mb-4 border-2 border-brand">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold m-0">
            {pareceNombre ? `${socio.nombre} ya es socio` : 'Ya es socio'}
          </h2>
          <p className="text-xs text-mute mt-1 max-w-xl">
            Falta que instale su tarjeta en el móvil. Si está delante, que
            escanee el código; si no, mándaselo.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-6">
        <div className="bg-white p-3 rounded-xl border border-line shrink-0">
          {url && <QRCodeSVG value={url} size={148} level="M" />}
        </div>

        <div className="flex-1 min-w-[240px]">
          <div className="flex flex-wrap gap-2">
            <a
              className="btn-primary"
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="whatsapp" />{' '}
              {telefono ? 'Enviar por WhatsApp' : 'Compartir por WhatsApp'}
            </a>
            <button className="btn-ghost" onClick={copiar}>
              <Icon name={copiado ? 'check' : 'clipboard'} />{' '}
              {copiado ? 'Copiado' : 'Copiar enlace'}
            </button>
          </div>

          {!telefono && (
            <p className="text-xs text-mute mt-2">
              Este cliente no tiene teléfono guardado, así que WhatsApp te
              preguntará a quién enviarlo.
            </p>
          )}

          <p className="text-xs text-mute mt-3 break-all">{url}</p>
        </div>
      </div>
    </div>
  );
}
