import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Qué significa «Clubify» para Contabilidad.
 *
 * EL FALLO (2026-09-12): el módulo resolvía la plataforma como
 * `whiteLabelId IS NULL`, que era cierto cuando Clubify no tenía fila propia en
 * `WhiteLabel`. Hoy sí la tiene, y todo lo que se cobra se graba con SU id. El
 * resto del sistema —`cobros.service`, `brand-scope.util`, el reconciliador del
 * Onboarding— ya resolvía Clubify como «mi id O legacy null»; Contabilidad no.
 *
 * Con las dos convenciones conviviendo, el 11 de septiembre se atribuyeron 9
 * ingresos huérfanos a su marca real para arreglar el «Pagos procesados $0» del
 * dashboard… y esos mismos ingresos desaparecieron de Contabilidad. Septiembre
 * pasó de $1.758,50 a $62,98 sin que nadie borrara un solo registro.
 *
 * La regla, la misma que el resto del backend: Clubify ve su id MÁS los legacy
 * en null; cualquier otra marca ve estrictamente lo suyo. Nunca Clubify como
 * respaldo de otra marca (ver [[clubify-fugas-de-marca]]).
 */

/** Cacheado en el proceso: el id de Clubify no cambia en caliente. */
let idClubify: string | null | undefined;

/** Solo para los tests: olvida el id cacheado. */
export function olvidarMarcaClubify(): void {
  idClubify = undefined;
}

export async function marcaClubify(
  prisma: Pick<PrismaService, 'whiteLabel'>,
): Promise<string | null> {
  if (idClubify === undefined) {
    const wl = await prisma.whiteLabel
      .findFirst({ where: { slug: 'clubify' }, select: { id: true } })
      .catch(() => null);
    idClubify = wl?.id ?? null;
  }
  return idClubify;
}

/**
 * El `where` de marca para cualquier tabla financiera con `whiteLabelId`.
 * `onlyClubify` false = todas las marcas (el scope `all` del panel).
 */
export async function alcanceDeMarca(
  prisma: Pick<PrismaService, 'whiteLabel'>,
  onlyClubify: boolean | undefined,
): Promise<Record<string, unknown>> {
  if (!onlyClubify) return {};
  const id = await marcaClubify(prisma);
  // Sin fila de Clubify (entornos de desarrollo) la convención vieja es la
  // única que existe, y sigue siendo la respuesta correcta.
  if (!id) return { whiteLabelId: null };
  return { OR: [{ whiteLabelId: id }, { whiteLabelId: null }] };
}

/**
 * Junta fragmentos de `where` sin que se pisen.
 *
 * Hace falta porque ahora hay DOS fragmentos que usan la clave `OR`: el de
 * marca y el `enRangoConRespaldo` de `where-periodo`. Con el `{ ...a, ...b }`
 * de antes, el segundo borraba al primero —y borrar el filtro de marca es una
 * fuga entre negocios, muda—. Metidos en un `AND` conviven.
 */
export function combinar(
  ...partes: Array<Record<string, unknown> | undefined | null>
): Record<string, unknown> {
  const usables = partes.filter(
    (p): p is Record<string, unknown> => !!p && Object.keys(p).length > 0,
  );
  if (usables.length === 0) return {};
  if (usables.length === 1) return usables[0];
  return { AND: usables };
}
