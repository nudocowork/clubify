// Página pública del storefront. El componente real vive en
// `./storefront-client` para poder compartirlo con la ruta
// `/m/[slug]/[sectionSlug]` sin violar la regla de Next.js 14.2.x que
// solo permite default export + named exports específicos en page.tsx.
export { default } from './storefront-client';
