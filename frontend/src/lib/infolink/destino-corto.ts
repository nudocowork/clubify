/**
 * A dónde lleva un enlace corto del QR (`soyclubify.com/<slug>` y
 * `/i/<slug>`), resuelto EN EL SERVIDOR antes de redirigir.
 *
 * Por qué (Ricuras, 2026-10-08: «cuando escanean el QR la pantalla se queda en
 * blanco»): la consulta al backend no tenía tiempo límite. Mientras el
 * servidor de Vercel espera, el teléfono no recibe ni un byte de HTML: pantalla
 * en blanco. Con el backend reiniciando (cada despliegue) o lento, esa espera
 * se alargaba hasta que la función moría. Y si fallaba, salía «no existe».
 *
 * Ahora: 6 s por intento y un reintento; un 404 es «no existe»; cualquier otro
 * fallo devuelve `fallo` y la página ofrece «Reintentar» en vez de quedarse
 * en blanco o mentir con un 404.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
const LIMITE_MS = 6_000;

export type DestinoCorto =
  | { tipo: 'destino'; ruta: string }
  | { tipo: 'no-existe' }
  | { tipo: 'fallo' };

export async function resolverDestinoCorto(slug: string): Promise<DestinoCorto> {
  const url = `${API}/api/public/info-link-by-root/${encodeURIComponent(slug)}/destino`;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(url, {
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(LIMITE_MS),
      });
      if (r.status === 404) return { tipo: 'no-existe' };
      if (r.ok) {
        const d = (await r.json()) as { tenant?: { slug?: string }; link?: { slug?: string } };
        if (d?.tenant?.slug && d?.link?.slug) {
          return { tipo: 'destino', ruta: `/i/${d.tenant.slug}/${d.link.slug}` };
        }
        return { tipo: 'no-existe' };
      }
    } catch {
      // Tiempo límite o red: se reintenta una vez.
    }
  }
  return { tipo: 'fallo' };
}
