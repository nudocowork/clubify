import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

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

  /**
   * Marca comisiones específicas como REJECTED tras revisión del
   * SUPER_ADMIN en la UI de auditoría (Fase B 2026-06-12). Reglas:
   *  - Solo afecta comisiones PENDING o APPROVED. PAID nunca se toca
   *    (histórico cerrado, ya transferido al afiliado).
   *  - Máximo 50 ids por request (chunkear si hay más).
   *  - Cada cambio queda en AuditLog con actorId + reason para
   *    trazabilidad regulatoria.
   *  - Si todas las ids quedan filtradas por PAID, devolvemos 400.
   */
  async markRejected(opts: {
    actorId: string;
    ids: string[];
    reason?: string;
  }): Promise<{
    updated: number;
    skippedPaid: number;
    skippedNotFound: number;
  }> {
    const ids = Array.from(new Set(opts.ids ?? [])).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    if (ids.length === 0) {
      throw new BadRequestException('ids requerido');
    }
    if (ids.length > 50) {
      throw new BadRequestException('Máximo 50 ids por request');
    }

    const found = await this.prisma.commission.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        amount: true,
        referralUseId: true,
        recipientCodeId: true,
        referralUse: {
          select: {
            tenantId: true,
            tenant: { select: { brandName: true } },
          },
        },
      },
    });

    const foundIds = new Set(found.map((c) => c.id));
    const skippedNotFound = ids.length - foundIds.size;

    const safeToMark = found.filter(
      (c) => c.status === 'PENDING' || c.status === 'APPROVED',
    );
    const skippedPaid = found.length - safeToMark.length;

    if (safeToMark.length === 0) {
      throw new BadRequestException(
        'Ninguna commission elegible: todas están en estado PAID o REJECTED.',
      );
    }

    const safeIds = safeToMark.map((c) => c.id);
    const result = await this.prisma.commission.updateMany({
      where: { id: { in: safeIds } },
      data: { status: 'REJECTED' },
    });

    // Audit log por cada commission tocada — granular para trazabilidad.
    for (const c of safeToMark) {
      this.audit.log({
        actorId: opts.actorId,
        tenantId: c.referralUse?.tenantId ?? null,
        action: 'commission.marked_rejected',
        resource: `commission:${c.id}`,
        metadata: {
          tenantBrandName: c.referralUse?.tenant?.brandName ?? null,
          previousStatus: c.status,
          amount: Number(c.amount),
          recipientCodeId: c.recipientCodeId,
          referralUseId: c.referralUseId,
          reason: opts.reason?.trim() || null,
          source: 'audit_duplicates_ui',
        },
      });
    }

    this.logger.log(
      `markRejected: ${result.count} updated, ${skippedPaid} skipped (PAID), ${skippedNotFound} not found, actor=${opts.actorId}`,
    );

    return {
      updated: result.count,
      skippedPaid,
      skippedNotFound,
    };
  }
}
