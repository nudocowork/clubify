import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';

/**
 * Cambio de la ruta corta `/ref/<slug>` de un afiliado, sin romper la anterior.
 *
 * El slug es la ruta REAL: no hay un redirector detrás. Antes, cambiarla
 * mataba todo enlace ya compartido con un 404. Ahora la vieja queda como alias
 * y `resolveBySlug` la sigue aceptando — mismo código, misma atribución.
 *
 * Lo usan los dos caminos que cambian rutas: el admin desde
 * `/admin/referrals` y el propio afiliado desde su panel.
 */

/** Normalización canónica de una ruta. La misma en todos los caminos. */
export function normalizarSlug(entrada: string): string {
  return (entrada ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Rutas que nadie puede tomar: son rutas del sitio o nombres que harían pasar
 * un enlace de afiliado por oficial de la plataforma.
 */
export const SLUGS_RESERVADOS = new Set([
  'app', 'admin', 'api', 'login', 'signup', 'registro', 'superadmin',
  'affiliate', 'afiliado', 'clubify', 'soyclubify', 'sellea', 'selleala',
  'fideliso', 'fidelity', 'ref', 'checkout', 'pago', 'pagos', 'precios',
  'ayuda', 'soporte', 'www', 'null', 'undefined',
]);

/**
 * Comprueba que la ruta esté libre y la asigna, guardando la anterior como
 * alias. Devuelve la ruta final ya normalizada.
 *
 * `permitirReservados` deja al admin usar una ruta de la lista si de verdad la
 * necesita; el afiliado nunca puede.
 */
export async function cambiarSlugConAlias(
  prisma: PrismaService,
  opts: {
    codeId: string;
    slugActual: string | null;
    nuevo: string;
    permitirReservados?: boolean;
    minimo?: number;
  },
): Promise<string> {
  const limpio = normalizarSlug(opts.nuevo);
  const minimo = opts.minimo ?? 3;

  if (limpio.length < minimo) {
    throw new BadRequestException(
      `La ruta necesita al menos ${minimo} letras o números.`,
    );
  }
  if (!opts.permitirReservados && SLUGS_RESERVADOS.has(limpio)) {
    throw new BadRequestException(`La ruta "${limpio}" está reservada.`);
  }
  if (limpio === opts.slugActual) return limpio;

  // Ocupada como ruta viva de otro afiliado.
  const vivo = await prisma.referralCode.findUnique({
    where: { slug: limpio },
    select: { id: true },
  });
  if (vivo && vivo.id !== opts.codeId) {
    throw new BadRequestException(
      `La ruta "${limpio}" ya la tiene otro afiliado. Prueba con otra.`,
    );
  }

  // Ocupada como alias de OTRO afiliado: si la cediéramos, los enlaces que
  // esa persona repartió empezarían a atribuirle ventas a alguien más.
  const aliasAjeno = await prisma.referralSlugAlias.findUnique({
    where: { slug: limpio },
    select: { id: true, referralCodeId: true },
  });
  if (aliasAjeno && aliasAjeno.referralCodeId !== opts.codeId) {
    throw new BadRequestException(
      `La ruta "${limpio}" perteneció a otro afiliado y sus enlaces siguen vivos. Prueba con otra.`,
    );
  }

  await prisma.$transaction(async (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => {
    // Si vuelve a una ruta suya de antes, deja de ser alias y pasa a ser la
    // viva otra vez — no puede estar en los dos sitios (`slug` es único).
    if (aliasAjeno) {
      await tx.referralSlugAlias.delete({ where: { id: aliasAjeno.id } });
    }

    await tx.referralCode.update({
      where: { id: opts.codeId },
      data: { slug: limpio },
    });

    // La anterior queda viva como alias. `skipDuplicates` por si ya estaba
    // registrada de un cambio previo.
    if (opts.slugActual) {
      await tx.referralSlugAlias.createMany({
        data: [{ slug: opts.slugActual, referralCodeId: opts.codeId }],
        skipDuplicates: true,
      });
    }
  });

  return limpio;
}
