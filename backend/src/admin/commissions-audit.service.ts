import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Servicio read-only que detecta posibles comisiones duplicadas para
 * que el SUPER_ADMIN pueda revisar el histórico antes de aplicar el
 * unique constraint definitivo (Bloque 3 - Fase B).
 *
 * 2026-06-10: este endpoint NO modifica datos. Solo lista grupos
 * sospechosos. La acción correctiva se hace después por el admin (o
 * por una migration que reciba el listado revisado y marque como
 * REJECTED las duplicadas confirmadas).
 *
 * Heurística para "duplicado":
 *  - Mismo (referralUseId, recipientCodeId)
 *  - status ≠ REJECTED
 *  - Diferencia entre createdAt < 25 días (asume que ningún ciclo
 *    legítimo es menor a 25 días en planes mensuales)
 *  - Y/o mismo periodKey derivado (YYYY-MM si fecha cae en mismo mes)
 */
@Injectable()
export class CommissionsAuditService {
  private readonly logger = new Logger(CommissionsAuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Devuelve grupos de comisiones que comparten (referralUseId,
   * recipientCodeId) y fueron creadas dentro de la misma ventana de
   * 25 días — son candidatas a duplicado.
   *
   * No marca nada. Output:
   *  - summary: totales globales
   *  - groups: lista de clusters con detalle de cada commission
   */
  async findDuplicates(opts?: { limit?: number }) {
    const limit = Math.min(500, Math.max(10, opts?.limit ?? 100));

    // Traer TODAS las commissions no-REJECTED ordenadas por
    // (referralUseId, recipientCodeId, createdAt). Agrupamos en memoria
    // porque Prisma no tiene window functions limpias y el volumen
    // hoy es manejable (<10k commissions PENDING+APPROVED+PAID).
    const all = await this.prisma.commission.findMany({
      where: { status: { not: 'REJECTED' } },
      orderBy: [
        { referralUseId: 'asc' },
        { recipientCodeId: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        referralUseId: true,
        recipientCodeId: true,
        amount: true,
        status: true,
        externalTxId: true,
        hotmartTransactionId: true,
        createdAt: true,
        paidAt: true,
        referralUse: {
          select: {
            id: true,
            tenant: { select: { id: true, brandName: true, slug: true } },
            referralCode: { select: { code: true, slug: true } },
          },
        },
        recipientCode: { select: { code: true, slug: true, role: true } },
      },
    });

    const WINDOW_MS = 25 * 24 * 60 * 60 * 1000;

    type Row = (typeof all)[number];
    const groups: Row[][] = [];
    let current: Row[] = [];
    let lastKey = '';

    for (const c of all) {
      // recipientCodeId puede ser null en commissions pre-3-way-split;
      // las agrupamos como bucket `null`.
      const key = `${c.referralUseId}::${c.recipientCodeId ?? 'null'}`;
      if (key !== lastKey) {
        if (current.length >= 2) groups.push(current);
        current = [c];
        lastKey = key;
        continue;
      }
      // Dentro del mismo (use, recipient): si la diferencia con
      // CUALQUIERA del current cluster es < 25 días, está en el cluster.
      const isClose = current.some(
        (x) => Math.abs(c.createdAt.getTime() - x.createdAt.getTime()) < WINDOW_MS,
      );
      if (isClose) {
        current.push(c);
      } else {
        if (current.length >= 2) groups.push(current);
        current = [c];
      }
    }
    if (current.length >= 2) groups.push(current);

    // Trim al limit por response size; ordenamos del cluster más
    // grande (más sospechoso) al menos sospechoso.
    groups.sort((a, b) => b.length - a.length);
    const trimmed = groups.slice(0, limit);

    const totalDuplicateRows = groups.reduce((sum, g) => sum + g.length, 0);
    const totalGroups = groups.length;
    const totalCommissions = all.length;

    return {
      summary: {
        totalCommissions,
        totalDuplicateGroups: totalGroups,
        totalCommissionsInGroups: totalDuplicateRows,
        truncatedToFirst: trimmed.length,
      },
      groups: trimmed.map((g) => ({
        referralUseId: g[0].referralUseId,
        tenant: g[0].referralUse?.tenant ?? null,
        recipientCode: g[0].recipientCode ?? null,
        size: g.length,
        // Suma de las comisiones en el grupo — útil para entender
        // exposición monetaria si todas fuesen duplicados confirmados.
        totalAmount: g.reduce((s, c) => s + Number(c.amount), 0),
        commissions: g.map((c) => ({
          id: c.id,
          amount: Number(c.amount),
          status: c.status,
          externalTxId: c.externalTxId,
          hotmartTransactionId: c.hotmartTransactionId,
          createdAt: c.createdAt,
          paidAt: c.paidAt,
        })),
      })),
    };
  }
}
