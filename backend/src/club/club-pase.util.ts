import type { PrismaService } from '../common/prisma/prisma.service';

export type ClubEnPase = {
  /** Lo que consume, en singular tal como lo escribió el negocio: «café». */
  unidad: string;
  /** El cupo del período — el denominador que ve el cliente. */
  cupo: number;
  /** Pausada o de baja: el socio no puede consumir aunque le queden. */
  detenida: boolean;
  /**
   * De baja, que NO es lo mismo que en pausa. Colapsarlos dejaba al que se dio
   * de baja con «EN PAUSA» en el móvil, sugiriéndole que va a volver.
   */
  dadaDeBaja: boolean;
};

/**
 * Datos de una tarjeta de CLUB para pintarla en la billetera.
 *
 * Vive aquí y no dentro de `wallet.service` por lo mismo que el de alianzas: lo
 * necesitan por igual el pase de Apple y el de Google, y esos dos servicios no
 * pueden importarse entre ellos —`WalletService` ya inyecta a
 * `GoogleWalletService`, así que el camino de vuelta sería un ciclo.
 *
 * Sin esto, una tarjeta de club cae al render de sellos y enseña
 * «SELLOS 7 / 10» con el aviso «Sellos: 7». Está invertido: el cliente lee
 * «llevo 7 sellos, me faltan 3», cuando lo que dice es «me quedan 7 cafés de
 * los 10 que pagué». El número correcto contando exactamente lo contrario es
 * peor que no poner nada.
 */
export async function clubDelPase(
  prisma: PrismaService,
  clubPlanId: string,
  passId: string,
): Promise<ClubEnPase | null> {
  const m = await prisma.clubMembresia.findFirst({
    where: { passId, planId: clubPlanId },
    select: {
      status: true,
      cupoDelPeriodo: true,
      plan: { select: { unidad: true, beneficiosPorMes: true } },
    },
  });
  if (!m) return null;
  return {
    unidad: m.plan.unidad,
    // El cupo del PERÍODO, no el del plan: si el negocio subió el plan de 10 a
    // 15 a mitad de mes, este socio sigue teniendo 10 hasta el día 1. Pintar 15
    // le prometería cinco que la caja no le va a dar.
    cupo: m.cupoDelPeriodo || m.plan.beneficiosPorMes,
    detenida: m.status !== 'ACTIVA',
    dadaDeBaja: m.status === 'CANCELADA',
  };
}

/**
 * El plural de la unidad, para los textos del pase.
 *
 * Duplicado a propósito del ayudante del panel: el backend no importa del
 * frontend, y bajarlo a un paquete compartido por nueve líneas costaría más de
 * lo que ahorra. Si cambia uno, cambiar el otro.
 */
export function pluralUnidad(unidad: string, cantidad: number): string {
  const u = unidad.trim();
  if (!u) return '';
  if (cantidad === 1) return u;
  const ultima = u.slice(-1).toLowerCase();
  if ('aeiou'.includes(ultima)) return u + 's';
  // La tilde SE QUEDA: «café» → «cafés», «menú» → «menús». El acento sigue en
  // la última sílaba, así que quitarlo daba «cafes», que además contradecía el
  // ejemplo del comentario de arriba.
  if ('áéíóú'.includes(ultima)) return u + 's';
  if (ultima === 'z') return u.slice(0, -1) + 'ces';
  return u + 'es';
}
