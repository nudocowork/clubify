/**
 * Badges oficiales y variantes "Pay" para insertar en el editor de
 * cartel QR.
 *
 * Los archivos viven en /public/wallet-badges/. Al click en el editor,
 * el componente hace fetch del badge y lo convierte a data URL — así
 * el badge queda embebido en el config (no rompe si alguien borra el
 * archivo después).
 *
 * 4 variantes:
 * - Apple Wallet (ES): badge oficial "Agregar a Apple Wallet" — para
 *   prompt de "guarda tu tarjeta de fidelización".
 * - Google Wallet (ES): badge oficial es419 "Agregar a Google Wallet"
 *   para Android.
 * - Apple Pay: badge "Pay" con logo Apple — para indicar que el
 *   negocio acepta Apple Pay en POS.
 * - G Pay: badge capsule con G de Google + "Pay" — Google Pay
 *   aceptado en POS.
 */

export type WalletBadge = {
  id: 'apple-es' | 'google-es' | 'apple-pay' | 'google-pay';
  label: string;
  /** Path relativo al archivo en /public/wallet-badges/. */
  src: string;
  /** Dimensiones del viewBox (px). El editor las usa para mantener
   *  aspect al agregar la imagen al canvas. */
  width: number;
  height: number;
};

export const WALLET_BADGES: Record<string, WalletBadge> = {
  appleEs: {
    id: 'apple-es',
    label: 'Apple Wallet',
    src: '/wallet-badges/apple-es.svg',
    width: 110.902,
    height: 35.167,
  },
  googleEs: {
    id: 'google-es',
    label: 'Google Wallet',
    src: '/wallet-badges/google-es.png',
    width: 239,
    height: 55,
  },
  applePay: {
    id: 'apple-pay',
    label: 'Apple Pay',
    src: '/wallet-badges/apple-pay.svg',
    width: 124,
    height: 44,
  },
  googlePay: {
    id: 'google-pay',
    label: 'G Pay',
    src: '/wallet-badges/google-pay.svg',
    width: 160,
    height: 60,
  },
};

/** Carga el badge y devuelve un PNG data URL listo para Konva.
 *
 *  PNGs pasan tal cual. SVGs los rasterizamos a PNG 4× via canvas
 *  porque Konva no renderiza confiablemente SVGs complejos (los del
 *  developer pack de Apple usan clipPath + <style> internos con IDs
 *  que se rompen al pasar por <img> → canvas). Rasterizando una vez
 *  al inicio, queda como PNG normal y resiste resize/rotate/export. */
export async function loadBadgeAsDataUrl(
  badge: WalletBadge,
): Promise<string | null> {
  try {
    const isSvg = badge.src.toLowerCase().endsWith('.svg');

    if (!isSvg) {
      const res = await fetch(badge.src);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await blobToDataUrl(blob);
    }

    // Rasterizar SVG → PNG @4x para calidad print.
    return await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const scale = 4;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(badge.width * scale);
          canvas.height = Math.round(badge.height * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = badge.src;
    });
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
