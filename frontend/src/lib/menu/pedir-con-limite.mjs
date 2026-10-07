/**
 * `fetch` con TIEMPO LÍMITE y un reintento, para las dos consultas que pintan
 * el menú digital (el negocio y la carta).
 *
 * POR QUÉ (auditoría de rendimiento, 2026-10-07; queja de Konys: «no es en
 * todos los casos, pero sí en una cantidad muy considerable»): esas consultas
 * no tenían límite. En una red móvil que pierde paquetes —un 4G que cambia de
 * antena, un local con mala cobertura— la conexión puede quedarse abierta sin
 * responder, y el navegador espera minutos antes de rendirse. Mientras, el
 * cliente ve la pantalla de «cargando» para siempre y cree que el menú no
 * funciona; recargar a mano casi siempre lo arregla, que es justo lo que
 * cuentan los negocios.
 *
 * - Límite por intento: cubre la respuesta ENTERA (cabeceras y cuerpo), no
 *   solo las cabeceras: un cuerpo que se corta a la mitad también cuelga.
 * - Un reintento automático ante fallo de red, límite o 5xx; un 4xx no se
 *   reintenta (el negocio no existe: repetir no lo arregla).
 * - Si todo falla, lanza un error con nombre `SinRed` para que la pantalla
 *   ofrezca «Reintentar» en vez de decir que el negocio no existe.
 *
 *   node scripts/pruebas-pedir-con-limite.mjs
 */

/** 12 s por intento: la carta comprimida pesa ~12 KB; con un backend frío
 *  (2–3 s) y una red muy lenta sobra margen, y nadie espera más que eso. */
export const LIMITE_MS = 12_000;
export const PAUSA_ANTES_DE_REINTENTAR_MS = 800;

const SIN_CUERPO = new Set([204, 205, 304]);

/**
 * @param {string} url
 * @param {{ limiteMs?: number, reintentos?: number, pausaMs?: number, fetch?: typeof fetch }} [opciones]
 * @returns {Promise<Response>}
 */
export async function pedirConLimite(url, opciones = {}) {
  const {
    limiteMs = LIMITE_MS,
    reintentos = 1,
    pausaMs = PAUSA_ANTES_DE_REINTENTAR_MS,
    fetch: pedir = globalThis.fetch,
  } = opciones;
  let ultimo = null;
  for (let intento = 0; intento <= reintentos; intento++) {
    if (intento > 0) await new Promise((ok) => setTimeout(ok, pausaMs));
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), limiteMs);
    try {
      const r = await pedir(url, { signal: control.signal });
      // El cuerpo se lee DENTRO del límite.
      const texto = SIN_CUERPO.has(r.status) ? null : await r.text();
      clearTimeout(reloj);
      if (r.status >= 500 && intento < reintentos) {
        ultimo = new Error(`HTTP ${r.status}`);
        continue;
      }
      return new Response(texto, { status: r.status, statusText: r.statusText, headers: r.headers });
    } catch (e) {
      clearTimeout(reloj);
      ultimo = e;
    }
  }
  const error = new Error('SIN_RED');
  error.name = 'SinRed';
  error.cause = ultimo;
  throw error;
}
