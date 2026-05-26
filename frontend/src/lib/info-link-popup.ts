/**
 * Config visual del Popup que abre un botón visual del InfoLink.
 *
 * Cuando un botón tiene type='POPUP', al hacer click se abre un modal
 * con el contenido configurado acá (título, descripción, foto, CTA, etc).
 * Pensado para casos típicos del local:
 * - Contraseña WiFi
 * - Promo del día
 * - Horarios
 * - Detalles de reserva
 * - Aviso importante
 */

export type PopupSize = 'sm' | 'md' | 'lg';
export type PopupShadow = 'none' | 'sm' | 'md' | 'lg' | 'xl';

export type PopupConfig = {
  /** Título principal del popup. */
  title: string;
  /** Descripción (multilínea OK — se respeta whitespace). */
  description: string;
  /** Imagen opcional sobre el contenido. */
  imageUrl: string | null;
  /** CTA opcional al pie. */
  ctaText: string;
  /** URL del CTA. WhatsApp, link externo, mailto, etc. Si vacío, no se
   *  renderiza el botón. */
  ctaUrl: string;
  /** Color de fondo del card del popup. */
  bgColor: string;
  /** Color del texto principal. */
  textColor: string;
  /** Color del CTA. Si vacío, hereda del primary del InfoLink. */
  ctaColor: string;
  /** Radio del borde del popup. */
  borderRadius: number;
  /** Sombra del popup. */
  shadow: PopupShadow;
  /** Tamaño máximo. sm=320px, md=440px, lg=560px. */
  size: PopupSize;
  /** Si true, el cliente puede cerrar tocando fuera del card (default
   *  true). El botón X siempre está disponible. */
  closeOnOutside: boolean;
  /** Card de fidelización opcional. Si está seteada, el modal renderea
   *  un botón "Instalar tarjeta" que abre /c/<walletCardId> en nueva
   *  pestaña. Pensado para convertir el popup en herramienta comercial
   *  (G3): "Antes de reservar, instala nuestra tarjeta y recibe
   *  beneficios". null = sin botón wallet. */
  walletCardId?: string | null;
  /** Label custom del botón wallet. Si vacío usa default "🎁 Instalar
   *  tarjeta de fidelización". */
  walletCardLabel?: string;
  /** Segundos antes de cerrar el popup automáticamente. 0/null = sin
   *  auto-close (manual con X o outside-click). Útil para avisos
   *  efímeros tipo toast modal. */
  autoCloseSeconds?: number | null;
};

export const DEFAULT_POPUP_CONFIG: PopupConfig = {
  title: 'Información',
  description: '',
  imageUrl: null,
  ctaText: '',
  ctaUrl: '',
  bgColor: '#FFFFFF',
  textColor: '#0F172A',
  ctaColor: '',
  borderRadius: 20,
  shadow: 'xl',
  size: 'md',
  closeOnOutside: true,
  walletCardId: null,
  walletCardLabel: '',
  autoCloseSeconds: null,
};

/** Templates pre-armados para casos típicos. El usuario los aplica
 *  con un click desde el editor y solo edita los textos. */
export type PopupTemplateId = 'wifi' | 'promo' | 'horarios' | 'reserva' | 'aviso';

export const POPUP_TEMPLATES: Record<
  PopupTemplateId,
  { label: string; config: PopupConfig }
> = {
  wifi: {
    label: '📶 WiFi del local',
    config: {
      ...DEFAULT_POPUP_CONFIG,
      title: 'WiFi del local',
      description: 'Red: TuRed\nClave: TuClaveAcá',
      size: 'sm',
    },
  },
  promo: {
    label: '🎁 Promoción',
    config: {
      ...DEFAULT_POPUP_CONFIG,
      title: 'Promo del día',
      description: 'Detalles de la promo. Válida hasta agotar stock.',
      ctaText: 'Pedir ahora',
      ctaUrl: 'https://wa.me/57XXXXXXXXXX?text=Quiero%20la%20promo',
      size: 'md',
    },
  },
  horarios: {
    label: '🕒 Horarios',
    config: {
      ...DEFAULT_POPUP_CONFIG,
      title: 'Horarios de atención',
      description: 'Lun a Vie · 8am a 8pm\nSáb · 9am a 6pm\nDom · cerrado',
      size: 'sm',
    },
  },
  reserva: {
    label: '📅 Reserva',
    config: {
      ...DEFAULT_POPUP_CONFIG,
      title: 'Hacer una reserva',
      description: 'Reservá tu mesa o espacio por WhatsApp. Te confirmamos en 5 min.',
      ctaText: 'Reservar por WhatsApp',
      ctaUrl: 'https://wa.me/57XXXXXXXXXX?text=Hola,%20quiero%20reservar',
      size: 'md',
    },
  },
  aviso: {
    label: '📢 Aviso importante',
    config: {
      ...DEFAULT_POPUP_CONFIG,
      title: 'Aviso',
      description: 'Mensaje para tus clientes.',
      size: 'md',
    },
  },
};

/** Helper: ancho máximo del popup en px según size. */
export function popupMaxWidthPx(size: PopupSize): number {
  switch (size) {
    case 'sm':
      return 320;
    case 'lg':
      return 560;
    case 'md':
    default:
      return 440;
  }
}

/** Helper: CSS box-shadow según preset. */
export function popupShadowCss(shadow: PopupShadow): string {
  switch (shadow) {
    case 'none':
      return 'none';
    case 'sm':
      return '0 1px 3px rgba(0,0,0,0.08)';
    case 'md':
      return '0 4px 12px rgba(0,0,0,0.12)';
    case 'lg':
      return '0 12px 28px -8px rgba(0,0,0,0.22)';
    case 'xl':
    default:
      return '0 25px 50px -12px rgba(0,0,0,0.35)';
  }
}
