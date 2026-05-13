/**
 * Badges oficiales "Add to Apple Wallet" / "Save to Google Wallet"
 * para insertar en el editor de cartel QR.
 *
 * Los SVG oficiales viven en /public/wallet-badges/ (descargados de
 * los sitios oficiales de Apple/Google). Al click en el editor, el
 * componente hace fetch del SVG, lo convierte a data URL base64, y
 * lo agrega como ImageLayer. Así el badge queda embebido en el
 * config — no rompe si alguien borra el archivo después.
 *
 * Dimensiones tomadas del viewBox del SVG oficial.
 */

export type WalletBadge = {
  id: 'apple-es' | 'apple-en' | 'google-es' | 'google-en';
  label: string;
  /** Path relativo al SVG en /public/wallet-badges/. */
  src: string;
  /** Dimensiones del viewBox SVG (px). El editor las usa para
   *  encuadrar la imagen al agregar. */
  width: number;
  height: number;
};

export const WALLET_BADGES: Record<string, WalletBadge> = {
  appleEs: {
    id: 'apple-es',
    label: 'Apple Wallet (ES)',
    src: '/wallet-badges/apple-es.svg',
    width: 110.902,
    height: 35.167,
  },
  appleEn: {
    id: 'apple-en',
    label: 'Apple Wallet (EN)',
    src: '/wallet-badges/apple-en.svg',
    width: 110.902,
    height: 35.167,
  },
  googleEs: {
    id: 'google-es',
    label: 'Google Wallet (ES)',
    src: '/wallet-badges/google-es.png',
    width: 239,
    height: 55,
  },
  googleEn: {
    id: 'google-en',
    label: 'Google Wallet (EN)',
    src: '/wallet-badges/google-en.png',
    width: 239,
    height: 55,
  },
};

/** Carga el SVG desde la ruta pública y devuelve un data URL base64.
 *  Lo usamos al click para no inflar el JS bundle con los SVG oficiales
 *  (que tienen ~20KB cada uno con paths complejos). */
export async function loadBadgeAsDataUrl(
  badge: WalletBadge,
): Promise<string | null> {
  try {
    const res = await fetch(badge.src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
