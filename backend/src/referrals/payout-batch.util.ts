import { CommissionStatus, Prisma } from '@prisma/client';

/**
 * Total de un lote de corte = suma de los montos de las comisiones que
 * contiene, sin las anuladas.
 *
 * Se RECALCULA en cada cambio (adjuntar, pagar, revertir, anular) en vez de
 * incrementarse: un `increment` se descuadra apenas una comisión se anula, se
 * revierte, o entra al lote sin pasar por el camino del pago — y un total de
 * corte descuadrado es exactamente lo que la contadora usa para cuadrar.
 *
 * Función suelta (no método de un service) para que la usen tanto
 * ReferralsService como CutoffService sin crear un ciclo de dependencias.
 * `db` acepta el PrismaService o un TransactionClient.
 */
type Db = {
  commission: { aggregate: (args: any) => Promise<any> };
  payoutBatch: { update: (args: any) => Promise<any> };
};

export async function batchTotal(db: Db, batchId: string): Promise<number> {
  const agg = await db.commission.aggregate({
    where: {
      payoutBatchId: batchId,
      status: { not: CommissionStatus.REJECTED },
    } satisfies Prisma.CommissionWhereInput,
    _sum: { amount: true },
  });
  return Math.round(Number(agg._sum.amount ?? 0) * 100) / 100;
}

export async function recalcBatchTotal(
  db: Db,
  batchId: string,
): Promise<number> {
  const total = await batchTotal(db, batchId);
  await db.payoutBatch.update({
    where: { id: batchId },
    data: { totalUsd: total },
  });
  return total;
}
