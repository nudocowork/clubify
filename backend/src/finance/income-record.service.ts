import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { PaymentGateway } from '@prisma/client';

/** Entrada para registrar un ingreso real. `grossUsd` = lo que pagó el cliente. */
export interface RecordIncomeInput {
  gateway: PaymentGateway;
  /** Id único de la transacción en la pasarela (dedup). */
  externalTxId: string | null | undefined;
  tenantId?: string | null;
  whiteLabelId?: string | null;
  brandName?: string | null;
  planId?: string | null;
  planPeriodicity?: string | null;
  productName?: string | null;
  currency?: string | null;
  grossUsd: number | null | undefined;
  isFirstPayment?: boolean;
  saleDate: Date;
  /** Fee/impuesto REALES del payload si la pasarela los entrega; si son
   *  null/undefined se estiman con las tasas configurables. */
  gatewayFeeUsd?: number | null;
  taxUsd?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * CONTABILIDAD — Fase 1. Registra el ingreso REAL por transacción en
 * `IncomeRecord` (histórico, no sobrescrito). Aditivo: NO toca comisiones ni
 * el flujo de activación; los webhooks lo llaman best-effort (si falla, el
 * cobro/activación sigue igual). Idempotente por (gateway, externalTxId).
 *
 * El desglose bruto → fee → impuesto → neto usa las tasas configurables
 * (Settings `finance.gatewayFeePct.<gateway>` y `finance.taxPct`), o los
 * valores reales del payload cuando la pasarela los entrega. El neto REALMENTE
 * recibido se concilia después (puede diferir de lo esperado).
 */
@Injectable()
export class IncomeRecordService {
  private readonly logger = new Logger(IncomeRecordService.name);

  constructor(private prisma: PrismaService) {}

  /** Lee una tasa (%) de Settings; devuelve `fallback` si no está o es inválida. */
  private async pct(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.setting
      .findUnique({ where: { key }, select: { value: true } })
      .catch(() => null);
    const n = Number((row?.value ?? '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  /**
   * Registra el ingreso. Best-effort e idempotente. Salta cobros de $0 (ej. el
   * día 0 de una prueba) porque no son ingreso. No lanza: captura sus errores.
   */
  async record(input: RecordIncomeInput): Promise<void> {
    try {
      const gross = Number(input.grossUsd);
      const txId = (input.externalTxId ?? '').trim();
      if (!txId) return; // sin id de transacción no hay dedup posible
      if (!Number.isFinite(gross) || gross <= 0) return; // $0 (prueba) o inválido → no es ingreso

      // Dedup: una transacción no se contabiliza dos veces.
      const dup = await this.prisma.incomeRecord
        .findUnique({
          where: { gateway_externalTxId: { gateway: input.gateway, externalTxId: txId } },
          select: { id: true },
        })
        .catch(() => null);
      if (dup) return;

      // Fee: real del payload, o estimado por la tasa de la pasarela.
      let fee = input.gatewayFeeUsd ?? null;
      if (fee == null) {
        const feePct = await this.pct(`finance.gatewayFeePct.${input.gateway}`, 0);
        fee = round2((gross * feePct) / 100);
      }
      // Impuesto: real del payload, o estimado. `gross` = sobre la venta bruta;
      // `included` = el IVA ya está dentro del precio (se despeja).
      let tax = input.taxUsd ?? null;
      if (tax == null) {
        const taxPct = await this.pct('finance.taxPct', 0);
        const base = await this.prisma.setting
          .findUnique({ where: { key: 'finance.taxBase' }, select: { value: true } })
          .catch(() => null);
        const included = (base?.value ?? 'gross').trim() === 'included';
        tax = included
          ? round2(gross - gross / (1 + taxPct / 100))
          : round2((gross * taxPct) / 100);
      }
      const netExpected = round2(gross - fee - tax);
      const now = input.saleDate;
      const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      await this.prisma.incomeRecord.create({
        data: {
          gateway: input.gateway,
          externalTxId: txId,
          tenantId: input.tenantId ?? null,
          whiteLabelId: input.whiteLabelId ?? null,
          brandName: input.brandName ?? null,
          planId: input.planId ?? null,
          planPeriodicity: input.planPeriodicity ?? null,
          productName: input.productName ?? null,
          currency: input.currency ?? 'USD',
          grossUsd: gross,
          gatewayFeeUsd: fee,
          taxUsd: tax,
          otherDiscountUsd: 0,
          netExpectedUsd: netExpected,
          isFirstPayment: !!input.isFirstPayment,
          periodKey,
          saleDate: input.saleDate,
          reconStatus: 'PENDING',
        },
      });
      this.logger.log(
        `IncomeRecord +$${gross} ${input.gateway} tx=${txId} (fee $${fee} · tax $${tax} · neto $${netExpected})`,
      );
    } catch (e: any) {
      // P2002 = carrera (otro webhook creó la misma tx) → no es error.
      if (e?.code !== 'P2002') {
        this.logger.warn(`IncomeRecord.record falló: ${(e as Error).message}`);
      }
    }
  }

  /** Lista de ingresos para el panel (más recientes primero). `onlyClubify`
   *  filtra a los ingresos de la plataforma (whiteLabelId null); las marcas
   *  blancas cobran a SU propia cuenta y no son ingreso de Clubify. */
  async list(opts: {
    limit?: number;
    gateway?: PaymentGateway;
    onlyClubify?: boolean;
  }) {
    const rows = await this.prisma.incomeRecord.findMany({
      where: {
        ...(opts.gateway ? { gateway: opts.gateway } : {}),
        ...(opts.onlyClubify ? { whiteLabelId: null } : {}),
      },
      orderBy: { saleDate: 'desc' },
      take: Math.min(opts.limit ?? 200, 1000),
    });
    return rows.map((r) => {
      const netRecv = r.netReceivedUsd == null ? null : Number(r.netReceivedUsd);
      const netExp = Number(r.netExpectedUsd);
      return {
        ...r,
        grossUsd: Number(r.grossUsd),
        gatewayFeeUsd: Number(r.gatewayFeeUsd),
        taxUsd: Number(r.taxUsd),
        otherDiscountUsd: Number(r.otherDiscountUsd),
        netExpectedUsd: netExp,
        netReceivedUsd: netRecv,
        differenceUsd: netRecv == null ? null : round2(netRecv - netExp),
      };
    });
  }

  /** Totales del rango: bruto, fee, impuesto, neto esperado/recibido, conteos. */
  async summary(opts: { from?: Date; to?: Date; onlyClubify?: boolean }) {
    const rows = await this.prisma.incomeRecord.findMany({
      where: {
        ...(opts.onlyClubify ? { whiteLabelId: null } : {}),
        ...(opts.from || opts.to
          ? {
              saleDate: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      select: {
        grossUsd: true,
        gatewayFeeUsd: true,
        taxUsd: true,
        netExpectedUsd: true,
        netReceivedUsd: true,
        reconStatus: true,
      },
    });
    let gross = 0,
      fee = 0,
      tax = 0,
      netExp = 0,
      netRecv = 0;
    for (const r of rows) {
      gross += Number(r.grossUsd);
      fee += Number(r.gatewayFeeUsd);
      tax += Number(r.taxUsd);
      netExp += Number(r.netExpectedUsd);
      if (r.netReceivedUsd != null) netRecv += Number(r.netReceivedUsd);
    }
    return {
      count: rows.length,
      grossUsd: round2(gross),
      gatewayFeeUsd: round2(fee),
      taxUsd: round2(tax),
      netExpectedUsd: round2(netExp),
      netReceivedUsd: round2(netRecv),
      pendingRecon: rows.filter((r) => r.reconStatus === 'PENDING').length,
      inReview: rows.filter((r) => r.reconStatus === 'REVIEW').length,
    };
  }

  /** Concilia: fija el neto realmente recibido. Si coincide con el esperado →
   *  RECONCILED; si difiere → REVIEW (para que quede visible la diferencia). */
  async reconcile(id: string, netReceivedUsd: number, userId?: string | null) {
    const rec = await this.prisma.incomeRecord.findUnique({
      where: { id },
      select: { netExpectedUsd: true },
    });
    if (!rec) return { ok: false as const };
    const diff = round2(netReceivedUsd - Number(rec.netExpectedUsd));
    const reconStatus = Math.abs(diff) < 0.01 ? 'RECONCILED' : 'REVIEW';
    await this.prisma.incomeRecord.update({
      where: { id },
      data: {
        netReceivedUsd,
        receivedDate: new Date(),
        reconStatus,
        reconciledBy: userId ?? null,
        reconciledAt: new Date(),
      },
    });
    return { ok: true as const, reconStatus, differenceUsd: diff };
  }
}
