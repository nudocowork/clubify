// Ruta pública del menú libro. El componente real vive en
// `./book-client` para que la misma vista pueda montarse desde
// /book/[slug] y /book/[slug]/[sectionSlug] sin violar la regla de
// Next.js 14.2.x que solo permite default export + named exports
// específicos en page.tsx.
export { default } from './book-client';
