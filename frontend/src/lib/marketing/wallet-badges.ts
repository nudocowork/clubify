/**
 * Badges "Add to Apple Wallet" / "Save to Google Wallet" como SVGs
 * inline para insertarlos en el editor de cartel QR.
 *
 * Por qué inline y no archivos en /public:
 * - Cero round-trip HTTP — se agregan al canvas inmediatamente
 * - Data URLs serializan en cfg.images sin depender de hosting externo
 * - Funciona offline / preview / export PDF sin CORS
 *
 * Si querés artwork oficial (Apple/Google publican packs descargables
 * con guidelines), reemplazá las constantes SVG_* por las versiones
 * oficiales convertidas a SVG inline. Las dimensiones width/height
 * deben matchear el viewBox.
 */

const APPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="60" viewBox="0 0 180 60">
  <rect width="180" height="60" rx="9" fill="#000"/>
  <g fill="#fff">
    <path d="M22.4 22.6c.7-.9 1.2-2.1 1.1-3.3-1 .1-2.3.7-3 1.5-.7.7-1.2 2-1.1 3.1 1.2.1 2.3-.5 3-1.3zm1 1.6c-1.7-.1-3.1.9-3.9.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.7 1.2 10.2.9 1.2 1.9 2.6 3.3 2.5 1.3 0 1.8-.8 3.4-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.2 3.1-2.5.7-1 1-1.5 1.5-2.6-3.6-1.4-4.3-6.5-.6-8.1zM33.6 20h2.7c1.7 0 2.9.6 3.5 1.5l.6.9.1-2.3h2.2v11.7H40c-1.7 0-2.9-.6-3.5-1.5l-.6-.9-.1 2.3h-2.2V20zm2.6 2.1v7.4h.1c1.1 0 1.9-.3 2.5-1 .5-.6.8-1.5.8-2.7s-.3-2.1-.8-2.7c-.5-.6-1.4-1-2.5-1h-.1z"/>
    <text x="50" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" font-size="10" font-weight="400" letter-spacing="0.2">Add to</text>
    <text x="50" y="43" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" font-size="16" font-weight="600" letter-spacing="-0.2">Apple Wallet</text>
  </g>
</svg>`;

const GOOGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60">
  <rect width="200" height="60" rx="9" fill="#000"/>
  <g transform="translate(14 14)">
    <path fill="#4285F4" d="M31.6 16.4v-3.6h-9.7v3.6h5.7c-.6 3.4-3.4 5.4-7.1 5.4-4.4 0-7.9-3.5-7.9-8s3.5-8 7.9-8c2 0 3.8.7 5.2 2l2.6-2.6c-2.1-1.9-4.7-3-7.8-3-6.3 0-11.4 5.1-11.4 11.6S15.2 25.4 21.5 25.4c5.9 0 9.9-4.1 9.9-10 .2-.4.2-.7.2-1z"/>
    <path fill="#EA4335" d="M20.5 32C13.6 32 8 26.4 8 19.5c0-2.2.6-4.3 1.6-6.1l4 2.3c-.5 1.1-.8 2.4-.8 3.7 0 4.4 3.6 8 8 8 1.3 0 2.6-.3 3.7-.9l2.3 4c-1.9 1-4 1.5-6.3 1.5z"/>
  </g>
  <text x="50" y="26" font-family="Roboto, Arial, sans-serif" font-size="10" font-weight="400" fill="#fff" letter-spacing="0.2">Save to</text>
  <text x="50" y="43" font-family="Roboto, Arial, sans-serif" font-size="16" font-weight="600" fill="#fff" letter-spacing="-0.2">Google Wallet</text>
</svg>`;

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const WALLET_BADGES = {
  apple: {
    id: 'apple-wallet',
    label: 'Add to Apple Wallet',
    dataUrl: svgToDataUrl(APPLE_SVG),
    width: 180,
    height: 60,
  },
  google: {
    id: 'google-wallet',
    label: 'Save to Google Wallet',
    dataUrl: svgToDataUrl(GOOGLE_SVG),
    width: 200,
    height: 60,
  },
} as const;

export type WalletBadgeId = keyof typeof WALLET_BADGES;
