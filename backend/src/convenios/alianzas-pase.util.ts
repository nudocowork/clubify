import type { PrismaService } from '../common/prisma/prisma.service';
import type { QueueService } from '../jobs/queue.service';
import {
  describirBeneficioCorto,
  estadoDelPase,
  motivoDelCupon,
} from './alianzas-estado';

export type AlianzaEnPase = {
  estado: 'ACTIVO' | 'PAUSA' | 'FINALIZADO' | 'BLOQUEADA';
  /** Nombre de la empresa aliada. A quién le pregunta el empleado. */
  empresa: string;
  /** Los beneficios que hoy se pueden usar, ya redactados para el pase. */
  vivos: string[];
  /**
   * Las condiciones de esos beneficios («No acumulable con otras promociones»).
   *
   * Van aparte porque el reverso del pase de Apple tiene su propio campo
   * «Condiciones», que hasta ahora leía `Card.terms` — vacío en la plantilla de
   * una alianza, así que salía «Condiciones: —» en una tarjeta cuyos beneficios
   * SÍ tienen letra pequeña. Enseñar un guion donde hay condiciones reales es
   * peor que no enseñar el campo.
   */
  condiciones: string[];
};

/**
 * Estado de una tarjeta de ALIANZA para pintarla en la billetera.
 *
 * Vive aquí y no dentro de `wallet.service` porque lo necesitan por igual el
 * pase de Apple y el de Google, y esos dos servicios no pueden importarse entre
 * ellos: `WalletService` ya inyecta a `GoogleWalletService`, así que el camino
 * de vuelta sería un ciclo.
 *
 * Sin esto, una tarjeta de alianza cae al render de sellos y enseña
 * «SELLOS 0 / 1» congelado encima de un descuento del 15%: un número que no
 * significa nada y que además nunca se movería, porque una alianza no acumula.
 */
export async function alianzaDelPase(
  prisma: PrismaService,
  convenioId: string,
  passId: string,
  ahora = new Date(),
): Promise<AlianzaEnPase | null> {
  const convenio = await prisma.convenio.findUnique({
    where: { id: convenioId },
    include: {
      cupones: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!convenio) return null;
  const tarjeta = await prisma.convenioTarjeta.findFirst({
    where: { passId },
    select: { status: true },
  });

  const usables = convenio.cupones.filter(
    (c) => motivoDelCupon(c, ahora, null) === null,
  );

  return {
    estado: estadoDelPase(
      convenio,
      convenio.cupones,
      tarjeta?.status === 'BLOCKED',
      ahora,
    ),
    empresa: convenio.name,
    vivos: usables.map((c) =>
      describirBeneficioCorto(c.tipo, c.valor, c.name),
    ),
    // Solo las de los beneficios USABLES, y sin repetir: varios cupones suelen
    // compartir la misma letra pequeña, y verla tres veces seguidas en el
    // reverso del pase se lee como un error.
    condiciones: [
      ...new Set(
        usables.map((c) => (c.terms ?? '').trim()).filter((t) => t.length > 0),
      ),
    ],
  };
}

/**
 * Refresca los pases de un convenio tras tocar un interruptor.
 *
 * Dos cosas que parecen una:
 *
 *  1. **Tocar `lastActivityAt` ANTES de encolar.** Apple pregunta «¿cambió algo
 *     desde tal fecha?» y si no se mueve responde 304: el push sale, no falla
 *     nada, y el pase del empleado sigue enseñando lo de antes. Es el fallo que
 *     hace creer que la billetera «no se actualiza».
 *  2. El push es **best-effort**. El bloqueo de verdad es el del servidor y es
 *     inmediato; esto solo es lo que la persona ve en el móvil. Una tarjeta ya
 *     instalada no se puede borrar a distancia: tiene que COMUNICAR su estado.
 */
export async function avisarPasesDeAlianza(
  prisma: PrismaService,
  queue: QueueService,
  convenioId: string,
  motivo: string,
) {
  const tarjetas = await prisma.convenioTarjeta.findMany({
    where: { convenioId, passId: { not: null } },
    select: { passId: true },
    take: 5000,
  });
  const passIds = tarjetas
    .map((t) => t.passId)
    .filter((id): id is string => !!id);
  if (passIds.length === 0) return;

  await prisma.pass.updateMany({
    where: { id: { in: passIds } },
    data: { lastActivityAt: new Date() },
  });
  for (const passId of passIds) {
    await queue.enqueue('wallet.push', { passId, reason: motivo } as any).catch(
      () => null,
    );
  }
}

/** El mismo aviso para UN solo pase (bloquear a una persona, darla de baja). */
export async function avisarUnPase(
  prisma: PrismaService,
  queue: QueueService,
  passId: string,
  motivo: string,
) {
  await prisma.pass
    .update({ where: { id: passId }, data: { lastActivityAt: new Date() } })
    .catch(() => null);
  await queue.enqueue('wallet.push', { passId, reason: motivo } as any).catch(
    () => null,
  );
}
