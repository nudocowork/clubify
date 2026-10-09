import { urlDelMenu, urlDelNegocio } from '@/lib/api-publica.mjs';
import type { StorefrontMode } from '@/lib/menu/storefront-mode';

/**
 * El negocio y la carta del menú digital, pedidos EN EL SERVIDOR para que el
 * HTML llegue ya con el menú pintado.
 *
 * POR QUÉ (auditoría de rendimiento, 2026-10-07): el HTML de `/m/konys` no
 * traía ni una palabra visible. El navegador tenía que bajar ~20 JS, hidratar,
 * y RECIÉN entonces pedir el negocio y la carta (~1,6 s después de empezar,
 * incluso con caché), y solo después las imágenes. En un 4G lento eso es el
 * esqueleto de carga durante segundos y un salto de diseño (CLS 0,15) al
 * llegar el contenido. Pidiéndolo aquí, el cliente ve el menú en el primer
 * pintado y el JS solo lo hace interactivo.
 *
 * REGLAS (para no ser nunca peor que antes):
 *   - Mismas direcciones que pide el navegador (`api-publica.mjs`), con el
 *     idioma con el que el cliente arranca SIEMPRE (`es`: `useLocale` empieza
 *     así para no romper la hidratación). El cliente compara esas direcciones
 *     con las suyas y solo vuelve a pedir si no coinciden (otro idioma
 *     guardado, otra sede…).
 *   - Tiempo límite corto (4 s): si el backend tarda o falla, se devuelve
 *     `null` y el cliente pide como siempre. El fetch sigue en segundo plano
 *     y deja la respuesta en la caché de datos para la siguiente visita.
 *   - Caché de datos de Next de 30 s, la misma ventana que la memoria del
 *     backend: cada negocio cuesta como mucho una consulta cada 30 s por
 *     instancia, no una por visita.
 *   - `?fresco=` (vista previa del panel al publicar) NUNCA sale de caché: el
 *     dueño acaba de guardar y tiene que ver lo nuevo.
 *   - Un 5xx no es «el negocio no existe»: también `null`, y el cliente lo
 *     reintenta con su lógica de siempre (`pedirConLimite`). Solo un 4xx del
 *     negocio se da por definitivo y se pinta «no disponible» desde aquí.
 */

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

/** Lo que espera el render antes de rendirse y dejarle el trabajo al cliente. */
export const LIMITE_SERVIDOR_MS = 4_000;
/** Corte duro del fetch que sigue en segundo plano: que nada quede colgado. */
const CORTE_DURO_MS = 15_000;
const REVALIDAR_S = 30;

/** El idioma con el que el cliente pinta su primer render (ver `lib/i18n`). */
const IDIOMA_DEL_PRIMER_RENDER = 'es';

export type MenuInicial = {
  /** Dirección relativa con la que se pidió el negocio: la clave que compara
   *  el cliente para saber si le sirve. */
  urlNegocio: string;
  urlMenu: string;
  /** Respuesta del negocio, o null si no llegó a tiempo. */
  negocio: Record<string, unknown> | null;
  /** La carta, o null si no llegó a tiempo (el cliente la pide). */
  menu: unknown[] | null;
  /** Mensaje del 4xx del negocio («Negocio no disponible»). */
  error: string | null;
};

type Respuesta = { status: number; cuerpo: unknown } | null;

function valor(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
}

async function pedir(ruta: string, fresco: boolean): Promise<Respuesta> {
  const peticion = fetch(`${API}${ruta}`, {
    ...(fresco
      ? { cache: 'no-store' as const }
      : { next: { revalidate: REVALIDAR_S } }),
    signal: AbortSignal.timeout(CORTE_DURO_MS),
  })
    .then(async (r) => ({ status: r.status, cuerpo: await r.json().catch(() => null) }))
    .catch(() => null);
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>((ok) => {
    reloj = setTimeout(() => ok(null), LIMITE_SERVIDOR_MS);
  });
  try {
    return await Promise.race([peticion, limite]);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * @returns null si no hay nada útil que pasar (el cliente se porta como antes).
 */
export async function pedirMenuInicial({
  slug,
  mode,
  searchParams,
}: {
  slug: string;
  mode: StorefrontMode;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<MenuInicial | null> {
  if (!slug) return null;
  const sede = valor(searchParams?.sede);
  const oficina = valor(searchParams?.oficina);
  const fresco = valor(searchParams?.fresco);
  const locale = IDIOMA_DEL_PRIMER_RENDER;
  const urlNegocio = urlDelNegocio(slug, { locale, oficina, fresco });
  const urlMenu = urlDelMenu(slug, { locale, mode, sede, oficina, fresco });

  const [rn, rm] = await Promise.all([
    pedir(urlNegocio, !!fresco),
    pedir(urlMenu, !!fresco),
  ]);

  let negocio: MenuInicial['negocio'] = null;
  let error: string | null = null;
  if (rn && rn.status >= 200 && rn.status < 300 && rn.cuerpo && typeof rn.cuerpo === 'object') {
    negocio = rn.cuerpo as Record<string, unknown>;
  } else if (rn && rn.status >= 400 && rn.status < 500) {
    const m = (rn.cuerpo as { message?: unknown } | null)?.message;
    error = typeof m === 'string' && m ? m : 'No disponible';
  }
  if (!negocio && !error) return null;

  const menu =
    !error && rm && rm.status >= 200 && rm.status < 300 && Array.isArray(rm.cuerpo)
      ? (rm.cuerpo as unknown[])
      : null;

  return { urlNegocio, urlMenu, negocio, menu, error };
}

/**
 * ¿Hay que mandar al menú libro? La MISMA regla que aplica el cliente
 * (`shouldRedirectToBook` en storefront-client.tsx): hacerlo aquí evita
 * pintar el menú para luego saltar.
 */
export function rutaDelLibro(
  slug: string,
  inicial: MenuInicial | null,
  sectionSlug?: string,
): string | null {
  const s = inicial?.negocio as
    | { menuLayout?: string; bookMenuEnabled?: boolean; digitalMenuEnabled?: boolean }
    | null
    | undefined;
  if (!s) return null;
  const libro =
    s.menuLayout === 'FLIPBOOK' ||
    (s.bookMenuEnabled === true && s.digitalMenuEnabled === false) ||
    (s.bookMenuEnabled === true && Array.isArray(inicial?.menu) && inicial!.menu.length === 0);
  if (!libro) return null;
  return `/book/${slug}${sectionSlug ? `/${sectionSlug}` : ''}`;
}
