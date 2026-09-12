import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { mesContable } from '../common/periodo-contable';
import { enRango } from './where-periodo';
import {
  categoriaDeIngreso,
  type CategoriaDeIngreso,
} from './categorias-de-ingreso';
import type { PaymentGateway } from '@prisma/client';
import { alcanceDeMarca, combinar } from './alcance-de-marca';

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
  /** Clase de ingreso. Si no viene se deduce (ver `categoriaDeIngreso`).
   *  UPGRADE hay que mandarlo a mano: no se puede adivinar. */
  categoria?: CategoriaDeIngreso | null;
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
 *
 * LOS «SERVICIOS ADICIONALES» SÍ ENTRAN (2026-09-09, Javier)
 * ---------------------------------------------------------
 * El producto de Hotmart **`7929341 · CLUBIFY - SERVICIOS ADICIONALES`**
 * —packs de créditos, «Descuento de Implementación»— **cuenta como ingreso**.
 *
 * Esto **revierte la decisión del 2026-09-05 (Jhon)**, que lo dejaba fuera. La
 * de ahora: *«sí, cuentan como ingreso, pero no va a comisiones ni nada de eso,
 * ni tiene influencer ni se crea un negocio en cada pago»*. De ahí la forma de
 * estas filas: `tenantId: null`, sin plan y sin periodicidad. Solo llevan la
 * marca que compró — cuando se la pudo identificar.
 *
 * Son 18 transacciones por **$646,80** hasta el 2026-09-09. Las escribe
 * `HotmartService.registrarIngresoDePack`, con el importe que resuelve
 * `billing/precio-de-pack.ts`; el histórico lo puso
 * `scripts/backfill-ingreso-creditos.cjs`.
 *
 * Un auditor que compare `HotmartWebhookEvent` contra `IncomeRecord` ya NO debe
 * excluir ese productId. Contabilidad cuenta el producto de suscripción
 * (`6504901`), este, Stripe, Cross y los pagos manuales.
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
   * La marca del ingreso, sacada del negocio cuando el llamador no la manda.
   *
   * EL FALLO (2026-09-11, Jhon): «se realizaron varios pagos hoy y no se veían
   * en Pagos procesados». Estaban en la base, con `whiteLabelId` en null — y el
   * dashboard filtra por marca, así que no salía ninguno. El camino de Hotmart
   * leía el negocio con un `select` que no pedía `whiteLabelId`, y el
   * `?? null` de aquí lo daba por «sin marca» en vez de por «no me lo dijeron».
   *
   * Se arregla en el ORIGEN (que el select lo pida) y también aquí: un ingreso
   * con negocio conocido siempre puede resolver su marca, y no hay razón para
   * guardarlo sin ella. Son 19 de 120 filas históricas las que se perdieron por
   * esto; es una puerta que no debe quedarse abierta para el siguiente camino
   * de cobro que se añada.
   */
  private async marcaDelIngreso(input: RecordIncomeInput): Promise<string | null> {
    if (input.whiteLabelId) return input.whiteLabelId;
    if (!input.tenantId) return null;
    const t = await this.prisma.tenant
      .findUnique({
        where: { id: input.tenantId },
        select: { whiteLabelId: true },
      })
      .catch(() => null);
    if (t?.whiteLabelId) {
      this.logger.warn(
        `IncomeRecord sin marca: resuelta desde el negocio ${input.tenantId}. ` +
          `El camino de ${input.gateway} debería mandarla.`,
      );
    }
    return t?.whiteLabelId ?? null;
  }

  /**
   * El plan del ingreso, sacado del negocio cuando el llamador no lo manda.
   *
   * Ninguno de los cinco caminos de cobro mandaba `planId`, así que la columna
   * "Plan" del panel salía vacía en las 120 filas del histórico. Es el mismo
   * patrón que `marcaDelIngreso`: si hay negocio, el dato se puede resolver y
   * no hay razón para guardarlo a medias.
   */
  private async planDelIngreso(input: RecordIncomeInput): Promise<string | null> {
    if (input.planId) return input.planId;
    if (!input.tenantId) return null;
    const t = await this.prisma.tenant
      .findUnique({ where: { id: input.tenantId }, select: { planId: true } })
      .catch(() => null);
    return t?.planId ?? null;
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
      // Mes contable en hora de Bogotá, no en UTC: una venta del 31 a las 8 de
      // la noche pertenece a ESE mes, no al siguiente. Ver `periodo-contable.ts`.
      const periodKey = mesContable(input.saleDate);

      await this.prisma.incomeRecord.create({
        data: {
          gateway: input.gateway,
          externalTxId: txId,
          tenantId: input.tenantId ?? null,
          whiteLabelId: await this.marcaDelIngreso(input),
          brandName: input.brandName ?? null,
          planId: await this.planDelIngreso(input),
          category: categoriaDeIngreso(input),
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
    from?: Date;
    to?: Date;
  }) {
    const rows = await this.prisma.incomeRecord.findMany({
      where: combinar(
        opts.gateway ? { gateway: opts.gateway } : null,
        await alcanceDeMarca(this.prisma, opts.onlyClubify),
        enRango('saleDate', { from: opts.from, to: opts.to }),
      ),
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
      where: combinar(
        await alcanceDeMarca(this.prisma, opts.onlyClubify),
        enRango('saleDate', { from: opts.from, to: opts.to }),
      ),
      select: {
        grossUsd: true,
        gatewayFeeUsd: true,
        taxUsd: true,
        netExpectedUsd: true,
        netReceivedUsd: true,
        reconStatus: true,
        status: true,
        category: true,
      },
    });
    // Un reembolso o una cancelación NO son dinero que entró: se separan del
    // total en vez de borrarse, para que el histórico siga siendo auditable y
    // se pueda ver cuánto se devolvió.
    const cobrados = rows.filter((r) => r.status === 'PAGADO');
    const devueltos = rows.filter((r) => r.status !== 'PAGADO');
    let gross = 0,
      fee = 0,
      tax = 0,
      netExp = 0,
      netRecv = 0;
    const porCategoria: Record<string, { count: number; grossUsd: number }> = {};
    for (const r of cobrados) {
      gross += Number(r.grossUsd);
      fee += Number(r.gatewayFeeUsd);
      tax += Number(r.taxUsd);
      netExp += Number(r.netExpectedUsd);
      if (r.netReceivedUsd != null) netRecv += Number(r.netReceivedUsd);
      const k = r.category ?? 'SIN_CATEGORIA';
      const c = porCategoria[k] ?? { count: 0, grossUsd: 0 };
      c.count += 1;
      c.grossUsd = round2(c.grossUsd + Number(r.grossUsd));
      porCategoria[k] = c;
    }
    return {
      count: cobrados.length,
      grossUsd: round2(gross),
      gatewayFeeUsd: round2(fee),
      taxUsd: round2(tax),
      netExpectedUsd: round2(netExp),
      netReceivedUsd: round2(netRecv),
      pendingRecon: cobrados.filter((r) => r.reconStatus === 'PENDING').length,
      inReview: cobrados.filter((r) => r.reconStatus === 'REVIEW').length,
      /** Lo que se devolvió en el período (no suma en ninguna otra línea). */
      refundedCount: devueltos.length,
      refundedUsd: round2(
        devueltos.reduce((a, r) => a + Number(r.grossUsd), 0),
      ),
      porCategoria,
    };
  }

  /**
   * Marca un cobro como devuelto (reembolso o contracargo de la pasarela).
   *
   * No borra la fila ni crea un ingreso negativo: cambia el estado, y los
   * totales dejan de contarlo. Idempotente — llamarlo dos veces con el mismo
   * evento no cambia nada, que es lo que hace falta cuando Hotmart reenvía.
   */
  async marcarDevuelto(
    gateway: PaymentGateway,
    externalTxId: string,
    estado: 'REEMBOLSADO' | 'CANCELADO',
    cuando: Date,
  ): Promise<boolean> {
    const r = await this.prisma.incomeRecord.updateMany({
      where: { gateway, externalTxId, status: 'PAGADO' },
      data: { status: estado, refundedAt: cuando },
    });
    if (r.count > 0) {
      this.logger.log(
        `IncomeRecord ${gateway} tx=${externalTxId} → ${estado} (deja de contar).`,
      );
    }
    return r.count > 0;
  }

  /**
   * La cadena completa detrás de un ingreso, para responder «¿de dónde salió
   * este número?» sin abrir la base de datos.
   *
   *   Ingreso → transacción de la pasarela → negocio → plan → comisiones
   *
   * Todo sale de las tablas que ya son fuente de verdad; aquí no se guarda
   * nada. La `referencia` es el id con el que la pasarela conoce el cobro: es
   * el que hay que buscar en Hotmart o Stripe para cuadrar contra el extracto.
   */
  async trazabilidad(id: string) {
    const r = await this.prisma.incomeRecord.findUnique({ where: { id } });
    if (!r) return null;

    const tenant = r.tenantId
      ? await this.prisma.tenant.findUnique({
          where: { id: r.tenantId },
          select: {
            id: true,
            brandName: true,
            email: true,
            status: true,
            planPeriodicity: true,
            subscriptionPriceUsd: true,
            currentPeriodEnd: true,
            plan: { select: { id: true, name: true } },
            whiteLabel: { select: { slug: true, name: true } },
          },
        })
      : null;

    // Las comisiones que generó este negocio en el mismo mes contable. No se
    // atan a la transacción porque el motor de comisiones no la guarda: se
    // acotan por negocio y período, que es la relación que sí existe.
    const comisiones = r.tenantId
      ? await this.prisma.commission.findMany({
          where: {
            referralUse: { tenantId: r.tenantId },
            periodKey: r.periodKey ?? undefined,
          },
          select: {
            id: true,
            amount: true,
            amountPaid: true,
            status: true,
            paymentStatus: true,
            businessDate: true,
            paidAt: true,
            recipientCode: { select: { code: true, ownerName: true, role: true } },
          },
        })
      : [];

    return {
      ingreso: {
        id: r.id,
        fecha: r.saleDate,
        periodo: r.periodKey,
        categoria: r.category,
        estado: r.status,
        devueltoEl: r.refundedAt,
        bruto: Number(r.grossUsd),
        feePasarela: Number(r.gatewayFeeUsd),
        impuesto: Number(r.taxUsd),
        netoEsperado: Number(r.netExpectedUsd),
        netoRecibido: r.netReceivedUsd == null ? null : Number(r.netReceivedUsd),
        conciliacion: r.reconStatus,
      },
      origen: {
        pasarela: r.gateway,
        referencia: r.externalTxId,
        productoEnLaPasarela: r.productName,
        moneda: r.currency,
      },
      negocio: tenant
        ? {
            id: tenant.id,
            nombre: tenant.brandName,
            correo: tenant.email,
            estado: tenant.status,
            marca: tenant.whiteLabel?.name ?? 'Clubify',
            plan: tenant.plan?.name ?? null,
            periodicidad: tenant.planPeriodicity,
            precioPactado:
              tenant.subscriptionPriceUsd == null
                ? null
                : Number(tenant.subscriptionPriceUsd),
            proximoCobro: tenant.currentPeriodEnd,
          }
        : null,
      comisiones: comisiones.map((c) => ({
        id: c.id,
        beneficiario: c.recipientCode?.ownerName ?? null,
        codigo: c.recipientCode?.code ?? null,
        rol: c.recipientCode?.role ?? null,
        generada: Number(c.amount),
        pagada: Number(c.amountPaid),
        estado: c.status,
        estadoDePago: c.paymentStatus,
        fechaDeGeneracion: c.businessDate,
        fechaDePago: c.paidAt,
      })),
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
