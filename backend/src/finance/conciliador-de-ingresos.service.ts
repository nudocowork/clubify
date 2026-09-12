import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PaymentGateway } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { getCanonicalBundlePrice } from '../common/plan-pricing';
import { parsePlanPeriodLabel } from '../common/plan-period';
import { IncomeRecordService } from './income-record.service';
import type { CategoriaDeIngreso } from './categorias-de-ingreso';

/**
 * CONCILIADOR DE INGRESOS — la red que hace que Contabilidad no dependa de que
 * cada webhook acierte a la primera.
 *
 * EL PROBLEMA QUE RESUELVE. Hoy el ingreso se escribe en el mismo instante en
 * que se activa el negocio, con un `void this.incomeRecord.record(...)`
 * best-effort: si esa promesa falla, o el proceso se reinicia entre medias, o
 * el pago llegó sin cuenta y se activó por otro camino, el cobro queda en la
 * base de la pasarela y NUNCA llega al libro. Y no avisa. Medido el
 * 2026-09-12: dos transacciones de Hotmart de septiembre ($99,03 y un
 * trimestral) estaban en `HotmartWebhookEvent` y no en `IncomeRecord`.
 *
 * QUÉ HACE. Recorre los eventos de cobro que YA guarda cada pasarela y escribe
 * lo que falte, pasando siempre por `IncomeRecordService.record()`. Ese método
 * deduplica por el índice único `(gateway, externalTxId)`, así que correr esto
 * mil veces deja exactamente las mismas filas: es un reconciliador, no un
 * importador. También marca como devueltos los cobros que la pasarela reembolsó
 * o que terminaron en contracargo, para que dejen de sumar.
 *
 * QUÉ NO HACE. No inventa importes. Si un evento no trae precio en USD y no hay
 * plan del que sacar el canónico, lo deja fuera y lo reporta en `sinResolver`
 * — un número inventado en contabilidad es peor que un hueco visible.
 */

/** Lo que Hotmart llama «se cobró». El resto de eventos no mueve dinero. */
const HOTMART_COBRO = /^(PURCHASE_APPROVED|PURCHASE_COMPLETE)$/;
/**
 * Lo que Hotmart llama «se devolvió» — y lo que NO.
 *
 * `PURCHASE_REFUNDED` y `PURCHASE_CHARGEBACK` son definitivos: el dinero
 * volvió. `PURCHASE_PROTEST` es una disputa ABIERTA, que puede ganarse: dar por
 * perdido un cobro porque el cliente reclamó sería restar plata que sigue en la
 * cuenta. Se señala para revisión y se deja contando hasta que haya resolución.
 * Medido: las dos disputas del histórico (Quipao el 16-jul, y la del 28-ago)
 * acabaron en REFUNDED el mismo día, así que el resultado final es el mismo —
 * pero la etiqueta correcta es «reembolsado», no «cancelado».
 */
const HOTMART_DEVUELTO = /^(PURCHASE_REFUNDED|PURCHASE_CHARGEBACK)$/;
const HOTMART_DISPUTA = /^PURCHASE_PROTEST$/;

export interface Creado {
  gateway: PaymentGateway;
  externalTxId: string;
  grossUsd: number;
  saleDate: string;
  tenant: string | null;
  categoria: CategoriaDeIngreso;
  fuente: string;
}

export interface SinResolver {
  gateway: PaymentGateway;
  externalTxId: string;
  motivo: string;
  pista: string | null;
}

export interface InformeDeConciliacion {
  simulado: boolean;
  revisados: number;
  yaEstaban: number;
  creados: Creado[];
  devueltos: Array<{ externalTxId: string; estado: string }>;
  /** Filas de relleno a las que se les puso su referencia real de pasarela. */
  adoptados: Array<{ de: string; a: string; brandName: string | null }>;
  /** Cobros con una disputa ABIERTA: siguen contando, pero hay que mirarlos. */
  enDisputa: string[];
  sinResolver: SinResolver[];
}

/**
 * Un `externalTxId` que NO viene de la pasarela: lo puso un backfill cuando el
 * cobro se reconstruyó desde el estado del negocio y no desde el evento.
 *
 * Importan porque rompen el dedup: el pago ES el mismo, pero con otra clave, y
 * el conciliador lo escribiría OTRA VEZ. En vez de saltárselo —que dejaría la
 * fila sin forma de cuadrarla contra Stripe— se le pone encima la referencia
 * real. Caso medido: el cobro de SELLEA del 26-ago, guardado como
 * `backfill-last-<tenantId>`, es la factura `in_1U8q2rKAK6ubdwt69BUDHoUH`.
 */
const ES_DE_RELLENO = /^backfill[-_]/i;

type TenantMinimo = {
  id: string;
  brandName: string;
  whiteLabelId: string | null;
  planId: string | null;
  planPeriodicity: string | null;
  subscriptionPriceUsd: unknown;
};

@Injectable()
export class ConciliadorDeIngresosService {
  private readonly logger = new Logger(ConciliadorDeIngresosService.name);

  /** Los cobros que ya constan como devueltos al empezar la pasada. */
  private yaDevueltos = new Set<string>();

  /** Las filas de relleno vivas durante una pasada (ver `ES_DE_RELLENO`). */
  private deRelleno: Array<{
    id: string;
    gateway: PaymentGateway;
    externalTxId: string;
    tenantId: string | null;
    grossUsd: unknown;
    saleDate: Date;
    brandName: string | null;
  }> = [];

  constructor(
    private prisma: PrismaService,
    private income: IncomeRecordService,
  ) {}

  /**
   * ¿Este cobro ya está en el libro, pero guardado con una clave de relleno?
   *
   * Se exige que coincidan pasarela, negocio, importe exacto y el MISMO día:
   * dos cobros iguales, al mismo negocio y el mismo día no existen en un ciclo
   * de suscripción, y con esas cuatro condiciones no se puede fusionar por
   * error un pago legítimo. Si coincide, se le pone la referencia real encima
   * (así queda cuadrable contra la pasarela) y no se crea nada nuevo.
   */
  private async adoptarRelleno(
    informe: InformeDeConciliacion,
    gateway: PaymentGateway,
    tx: string,
    tenantId: string | null,
    grossUsd: number,
    saleDate: Date,
    simular: boolean,
  ): Promise<boolean> {
    const mismoDia = (a: Date, b: Date) =>
      a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
    const fila = this.deRelleno.find(
      (r) =>
        r.gateway === gateway &&
        r.tenantId === tenantId &&
        Math.abs(Number(r.grossUsd) - grossUsd) < 0.01 &&
        mismoDia(r.saleDate, saleDate),
    );
    if (!fila) return false;
    const referenciaVieja = fila.externalTxId;
    informe.adoptados.push({
      de: referenciaVieja,
      a: tx,
      brandName: fila.brandName,
    });
    this.deRelleno = this.deRelleno.filter((r) => r.id !== fila.id);
    if (!simular) {
      await this.prisma.incomeRecord.update({
        where: { id: fila.id },
        data: { externalTxId: tx },
      });
      this.logger.log(
        `IncomeRecord ${fila.id}: referencia de relleno ${referenciaVieja} ` +
          `sustituida por la real ${tx}.`,
      );
    }
    return true;
  }

  /**
   * Pasada diaria. A las 4 UTC = 11 de la noche en Bogotá, después del cron de
   * cobros de las 3, para que lo que ese ciclo acabe de cobrar ya esté escrito.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cronDiario() {
    const informe = await this.conciliar({ simular: false });
    if (informe.creados.length || informe.sinResolver.length) {
      this.logger.warn(
        `Conciliación: ${informe.creados.length} ingresos recuperados, ` +
          `${informe.devueltos.length} marcados devueltos, ` +
          `${informe.sinResolver.length} sin resolver.`,
      );
    }
  }

  async conciliar(
    opts: { desde?: Date; simular?: boolean } = {},
  ): Promise<InformeDeConciliacion> {
    const simular = !!opts.simular;
    const filas = await this.prisma.incomeRecord.findMany({
      select: {
        id: true,
        gateway: true,
        externalTxId: true,
        tenantId: true,
        grossUsd: true,
        saleDate: true,
        brandName: true,
        status: true,
      },
    });
    const enLibro = new Set(filas.map((r) => `${r.gateway}|${r.externalTxId}`));
    // Los que YA están marcados como devueltos: la simulación no debe volver a
    // contarlos, o el informe promete un cambio que la pasada real no hará.
    this.yaDevueltos = new Set(
      filas
        .filter((r) => r.status !== 'PAGADO')
        .map((r) => `${r.gateway}|${r.externalTxId}`),
    );
    this.deRelleno = filas.filter((r) => ES_DE_RELLENO.test(r.externalTxId));
    const yaEstaban = enLibro.size;

    const informe: InformeDeConciliacion = {
      simulado: simular,
      revisados: 0,
      yaEstaban,
      creados: [],
      devueltos: [],
      adoptados: [],
      enDisputa: [],
      sinResolver: [],
    };

    await this.hotmart(informe, enLibro, opts.desde, simular);
    await this.stripe(informe, enLibro, opts.desde, simular);
    await this.cross(informe, enLibro, opts.desde, simular);
    await this.manuales(informe, enLibro, opts.desde, simular);

    return informe;
  }

  // ── Hotmart ────────────────────────────────────────────────────────────────

  private async hotmart(
    informe: InformeDeConciliacion,
    enLibro: Set<string>,
    desde: Date | undefined,
    simular: boolean,
  ) {
    const eventos = await this.prisma.hotmartWebhookEvent.findMany({
      where: desde ? { processedAt: { gte: desde } } : {},
      select: {
        eventType: true,
        tenantId: true,
        payload: true,
        processedAt: true,
      },
      orderBy: { processedAt: 'asc' },
    });

    const yaDevueltos = new Set<string>();
    const enDisputa = new Set<string>();

    // Los packs de créditos tienen su propio camino (`registrarIngresoDePack`)
    // y su propio precio; si los tocara aquí con el canónico de suscripción,
    // un pack de $20 entraría como $68.
    const packs = new Set(
      (
        await this.prisma.hotmartCreditPurchase.findMany({
          select: { transactionId: true },
        })
      ).map((p) => p.transactionId),
    );

    for (const e of eventos) {
      const p = (e.payload ?? {}) as any;
      const compra = p?.data?.purchase ?? {};
      const tx: string | null = compra.transaction ?? null;
      if (!tx) continue;

      if (HOTMART_DEVUELTO.test(e.eventType)) {
        // `marcarDevuelto` solo toca filas en PAGADO, así que un reenvío del
        // mismo evento no cambia nada. El Set es para que la SIMULACIÓN cuente
        // exactamente lo que contaría la pasada de verdad.
        if (yaDevueltos.has(tx)) continue;
        yaDevueltos.add(tx);
        enDisputa.delete(tx); // ya se resolvió: no es una disputa abierta
        if (simular) {
          if (
            enLibro.has(`HOTMART|${tx}`) &&
            !this.yaDevueltos.has(`HOTMART|${tx}`)
          ) {
            informe.devueltos.push({ externalTxId: tx, estado: 'REEMBOLSADO' });
          }
        } else if (
          await this.income.marcarDevuelto(
            'HOTMART',
            tx,
            'REEMBOLSADO',
            e.processedAt,
          )
        ) {
          informe.devueltos.push({ externalTxId: tx, estado: 'REEMBOLSADO' });
        }
        continue;
      }
      if (HOTMART_DISPUTA.test(e.eventType)) {
        if (!yaDevueltos.has(tx) && enLibro.has(`HOTMART|${tx}`)) {
          enDisputa.add(tx);
        }
        continue;
      }

      if (!HOTMART_COBRO.test(e.eventType)) continue;
      informe.revisados += 1;
      if (enLibro.has(`HOTMART|${tx}`)) continue;
      if (packs.has(tx)) continue;

      const tenant = await this.tenantDeHotmart(e.tenantId, tx, p);
      const importe = await this.importeDeHotmart(compra, p, tenant);
      if (importe == null) {
        informe.sinResolver.push({
          gateway: 'HOTMART',
          externalTxId: tx,
          motivo: 'sin importe en USD ni plan del que deducirlo',
          pista: p?.data?.buyer?.email ?? null,
        });
        continue;
      }

      // `recurrence_number` es el dato REAL de Hotmart sobre si es la primera
      // cuota o una renovación. Vale más que deducirlo del estado actual del
      // negocio, que ya cambió desde entonces.
      const recurrencia = Number(compra.recurrence_number);
      const esPrimera = Number.isFinite(recurrencia)
        ? recurrencia <= 1
        : !tenant;
      const saleDate = compra.approved_date
        ? new Date(compra.approved_date)
        : e.processedAt;

      if (
        await this.adoptarRelleno(
          informe, 'HOTMART', tx, tenant?.id ?? null, importe, saleDate, simular,
        )
      ) {
        enLibro.add(`HOTMART|${tx}`);
        continue;
      }

      informe.creados.push({
        gateway: 'HOTMART',
        externalTxId: tx,
        grossUsd: importe,
        saleDate: saleDate.toISOString(),
        tenant: tenant?.brandName ?? null,
        categoria: esPrimera ? 'NUEVA' : 'RENOVACION',
        fuente: `HotmartWebhookEvent · ${e.eventType}`,
      });
      enLibro.add(`HOTMART|${tx}`);
      if (simular) continue;

      await this.income.record({
        gateway: 'HOTMART',
        externalTxId: tx,
        tenantId: tenant?.id ?? null,
        whiteLabelId: tenant?.whiteLabelId ?? null,
        brandName: tenant?.brandName ?? null,
        planId: tenant?.planId ?? null,
        planPeriodicity:
          tenant?.planPeriodicity ??
          parsePlanPeriodLabel(p?.data?.subscription?.plan?.name),
        productName: tenant ? null : (p?.data?.product?.name ?? null),
        currency: 'USD',
        grossUsd: importe,
        isFirstPayment: esPrimera,
        categoria: esPrimera ? 'NUEVA' : 'RENOVACION',
        saleDate,
      });
    }

    informe.enDisputa = [...enDisputa];
  }

  /** El negocio de una transacción, por los cuatro caminos que hay. */
  private async tenantDeHotmart(
    tenantIdDelEvento: string | null,
    tx: string,
    payload: any,
  ): Promise<TenantMinimo | null> {
    const select = {
      id: true,
      brandName: true,
      whiteLabelId: true,
      planId: true,
      planPeriodicity: true,
      subscriptionPriceUsd: true,
    };
    if (tenantIdDelEvento) {
      const t = await this.prisma.tenant
        .findUnique({ where: { id: tenantIdDelEvento }, select })
        .catch(() => null);
      if (t) return t as TenantMinimo;
    }
    const codigo: string | null =
      payload?.data?.subscription?.subscriber?.code ?? null;
    const correo: string | null = payload?.data?.buyer?.email ?? null;
    const t = await this.prisma.tenant.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { hotmartTransactionId: tx },
          ...(codigo ? [{ hotmartSubscriberCode: codigo }] : []),
          ...(correo ? [{ email: correo }] : []),
        ],
      },
      select,
    });
    return (t as TenantMinimo) ?? null;
  }

  /**
   * Cuánto vale este cobro en USD.
   *
   * El orden NO es casual y respeta la política que ya documenta
   * `hotmart.service` (2026-09-03, Javier): contabilidad refleja el PLAN que
   * adquirió el negocio, no el monto que la pasarela reporta en moneda local —
   * un trimestral de $150 pagado en PAB llega como 137,65 y descuadraría.
   *
   *  1. El precio pactado del negocio, si lo tiene a mano.
   *  2. El canónico de su periodicidad (o de la que diga el nombre del plan).
   *  3. Solo si no hay ninguna de las dos: el importe del payload, y únicamente
   *     cuando Hotmart dice explícitamente que son dólares.
   */
  private async importeDeHotmart(
    compra: any,
    payload: any,
    tenant: TenantMinimo | null,
  ): Promise<number | null> {
    if (tenant?.subscriptionPriceUsd != null) {
      const n = Number(tenant.subscriptionPriceUsd);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const periodicidad =
      tenant?.planPeriodicity ??
      parsePlanPeriodLabel(payload?.data?.subscription?.plan?.name);
    if (periodicidad) {
      const canonico = await getCanonicalBundlePrice(this.prisma, periodicidad);
      if (canonico > 0) return canonico;
    }
    const moneda: string | null =
      compra?.price?.currency_value ?? compra?.price?.currency_code ?? null;
    const valor = Number(compra?.price?.value);
    if (moneda === 'USD' && Number.isFinite(valor) && valor > 0) {
      return Math.round(valor * 100) / 100;
    }
    return null;
  }

  // ── Stripe ─────────────────────────────────────────────────────────────────

  private async stripe(
    informe: InformeDeConciliacion,
    enLibro: Set<string>,
    desde: Date | undefined,
    simular: boolean,
  ) {
    const eventos = await this.prisma.stripeWebhookEvent.findMany({
      where: {
        eventType: { in: ['invoice.payment_succeeded', 'charge.refunded'] },
        ...(desde ? { processedAt: { gte: desde } } : {}),
      },
      select: {
        eventType: true,
        tenantId: true,
        whiteLabelId: true,
        payload: true,
        processedAt: true,
      },
      orderBy: { processedAt: 'asc' },
    });

    for (const e of eventos) {
      const o = (e.payload as any)?.data?.object ?? {};
      const id: string | null = o.id ?? null;
      if (!id) continue;

      if (e.eventType === 'charge.refunded') {
        if (!simular) {
          const cambiado = await this.income.marcarDevuelto(
            'STRIPE',
            o.invoice ?? id,
            'REEMBOLSADO',
            e.processedAt,
          );
          if (cambiado) {
            informe.devueltos.push({
              externalTxId: o.invoice ?? id,
              estado: 'REEMBOLSADO',
            });
          }
        }
        continue;
      }

      informe.revisados += 1;
      if (enLibro.has(`STRIPE|${id}`)) continue;

      // Stripe manda céntimos. Una factura de $0 es el día 0 de una prueba:
      // no es ingreso y no debe entrar (misma regla que `record()`).
      const bruto = Number(o.amount_paid ?? o.amount ?? 0) / 100;
      if (!(bruto > 0)) continue;

      const tenant = await this.tenantDeStripe(e.tenantId, o);
      const saleDate = o.status_transitions?.paid_at
        ? new Date(o.status_transitions.paid_at * 1000)
        : e.processedAt;
      const esPrimera = Number(o.billing_reason === 'subscription_create');

      const brutoRedondeado = Math.round(bruto * 100) / 100;
      if (
        await this.adoptarRelleno(
          informe, 'STRIPE', id, tenant?.id ?? null, brutoRedondeado, saleDate, simular,
        )
      ) {
        enLibro.add(`STRIPE|${id}`);
        continue;
      }

      informe.creados.push({
        gateway: 'STRIPE',
        externalTxId: id,
        grossUsd: Math.round(bruto * 100) / 100,
        saleDate: saleDate.toISOString(),
        tenant: tenant?.brandName ?? null,
        categoria: esPrimera ? 'NUEVA' : 'RENOVACION',
        fuente: 'StripeWebhookEvent · invoice.payment_succeeded',
      });
      enLibro.add(`STRIPE|${id}`);
      if (simular) continue;

      await this.income.record({
        gateway: 'STRIPE',
        externalTxId: id,
        tenantId: tenant?.id ?? null,
        whiteLabelId: tenant?.whiteLabelId ?? e.whiteLabelId ?? null,
        brandName: tenant?.brandName ?? null,
        planId: tenant?.planId ?? null,
        planPeriodicity: tenant?.planPeriodicity ?? null,
        currency: 'USD',
        grossUsd: Math.round(bruto * 100) / 100,
        isFirstPayment: !!esPrimera,
        categoria: esPrimera ? 'NUEVA' : 'RENOVACION',
        saleDate,
      });
    }
  }

  private async tenantDeStripe(
    tenantIdDelEvento: string | null,
    objeto: any,
  ): Promise<TenantMinimo | null> {
    const select = {
      id: true,
      brandName: true,
      whiteLabelId: true,
      planId: true,
      planPeriodicity: true,
      subscriptionPriceUsd: true,
    };
    if (tenantIdDelEvento) {
      const t = await this.prisma.tenant
        .findUnique({ where: { id: tenantIdDelEvento }, select })
        .catch(() => null);
      if (t) return t as TenantMinimo;
    }
    const customer: string | null =
      typeof objeto.customer === 'string' ? objeto.customer : null;
    const sub: string | null =
      typeof objeto.subscription === 'string' ? objeto.subscription : null;
    if (!customer && !sub) return null;
    const t = await this.prisma.tenant.findFirst({
      where: {
        deletedAt: null,
        OR: [
          ...(customer ? [{ stripeCustomerId: customer }] : []),
          ...(sub ? [{ stripeSubscriptionId: sub }] : []),
        ],
      },
      select,
    });
    return (t as TenantMinimo) ?? null;
  }

  // ── Cross ──────────────────────────────────────────────────────────────────

  private async cross(
    informe: InformeDeConciliacion,
    enLibro: Set<string>,
    desde: Date | undefined,
    simular: boolean,
  ) {
    const eventos = await this.prisma.crossWebhookEvent.findMany({
      where: desde ? { processedAt: { gte: desde } } : {},
      select: {
        eventId: true,
        eventType: true,
        status: true,
        tenantId: true,
        whiteLabelId: true,
        payload: true,
        processedAt: true,
      },
      orderBy: { processedAt: 'asc' },
    });
    for (const e of eventos) {
      const p = (e.payload ?? {}) as any;
      const aprobado =
        /APROBAD|APPROVED|PAID|SUCCESS/i.test(e.status ?? '') ||
        /APROBAD|APPROVED|PAID|SUCCESS/i.test(String(p?.estado ?? ''));
      if (!aprobado) continue;
      const tx: string =
        p?.transaccionId ?? p?.transactionId ?? p?.id ?? e.eventId;
      informe.revisados += 1;
      if (enLibro.has(`CROSS|${tx}`)) continue;
      const bruto = Number(p?.montoUsd ?? p?.amountUsd ?? p?.amount);
      if (!Number.isFinite(bruto) || bruto <= 0) {
        informe.sinResolver.push({
          gateway: 'CROSS',
          externalTxId: tx,
          motivo: 'el evento no trae importe en USD',
          pista: e.eventType,
        });
        continue;
      }
      const tenant = e.tenantId
        ? await this.prisma.tenant
            .findUnique({
              where: { id: e.tenantId },
              select: {
                id: true,
                brandName: true,
                whiteLabelId: true,
                planId: true,
                planPeriodicity: true,
                subscriptionPriceUsd: true,
              },
            })
            .catch(() => null)
        : null;
      if (
        await this.adoptarRelleno(
          informe, 'CROSS', tx, tenant?.id ?? null,
          Math.round(bruto * 100) / 100, e.processedAt, simular,
        )
      ) {
        enLibro.add(`CROSS|${tx}`);
        continue;
      }

      informe.creados.push({
        gateway: 'CROSS',
        externalTxId: tx,
        grossUsd: Math.round(bruto * 100) / 100,
        saleDate: e.processedAt.toISOString(),
        tenant: tenant?.brandName ?? null,
        categoria: 'RENOVACION',
        fuente: 'CrossWebhookEvent',
      });
      enLibro.add(`CROSS|${tx}`);
      if (simular) continue;
      await this.income.record({
        gateway: 'CROSS',
        externalTxId: tx,
        tenantId: tenant?.id ?? null,
        whiteLabelId: tenant?.whiteLabelId ?? e.whiteLabelId ?? null,
        brandName: tenant?.brandName ?? null,
        planId: tenant?.planId ?? null,
        planPeriodicity: tenant?.planPeriodicity ?? null,
        currency: 'USD',
        grossUsd: Math.round(bruto * 100) / 100,
        saleDate: e.processedAt,
      });
    }
  }

  // ── Pagos manuales ─────────────────────────────────────────────────────────

  private async manuales(
    informe: InformeDeConciliacion,
    enLibro: Set<string>,
    desde: Date | undefined,
    simular: boolean,
  ) {
    const pagos = await this.prisma.manualPayment.findMany({
      where: desde ? { paidAt: { gte: desde } } : {},
      select: {
        id: true,
        tenantId: true,
        whiteLabelId: true,
        amount: true,
        currency: true,
        paidAt: true,
        periodicity: true,
      },
      orderBy: { paidAt: 'asc' },
    });
    for (const m of pagos) {
      informe.revisados += 1;
      if (enLibro.has(`MANUAL|${m.id}`)) continue;
      const bruto = m.amount == null ? 0 : Number(m.amount);
      // Un pago manual sin importe es "dejar el ciclo cubierto", no un cobro.
      if (!(bruto > 0)) continue;
      // Multi-moneda es de otra fase: mezclar COP en un libro en USD miente.
      if (m.currency && m.currency.toUpperCase() !== 'USD') {
        informe.sinResolver.push({
          gateway: 'MANUAL',
          externalTxId: m.id,
          motivo: `pago en ${m.currency}; el libro es en USD`,
          pista: m.tenantId,
        });
        continue;
      }
      const tenant = await this.prisma.tenant
        .findUnique({
          where: { id: m.tenantId },
          select: { id: true, brandName: true, whiteLabelId: true, planId: true },
        })
        .catch(() => null);
      if (
        await this.adoptarRelleno(
          informe, 'MANUAL', m.id, m.tenantId,
          Math.round(bruto * 100) / 100, m.paidAt, simular,
        )
      ) {
        enLibro.add(`MANUAL|${m.id}`);
        continue;
      }

      informe.creados.push({
        gateway: 'MANUAL',
        externalTxId: m.id,
        grossUsd: Math.round(bruto * 100) / 100,
        saleDate: m.paidAt.toISOString(),
        tenant: tenant?.brandName ?? null,
        categoria: 'RENOVACION',
        fuente: 'ManualPayment',
      });
      enLibro.add(`MANUAL|${m.id}`);
      if (simular) continue;
      await this.income.record({
        gateway: 'MANUAL',
        externalTxId: m.id,
        tenantId: m.tenantId,
        whiteLabelId: m.whiteLabelId ?? tenant?.whiteLabelId ?? null,
        brandName: tenant?.brandName ?? null,
        planId: tenant?.planId ?? null,
        planPeriodicity: m.periodicity,
        currency: 'USD',
        grossUsd: Math.round(bruto * 100) / 100,
        saleDate: m.paidAt,
      });
    }
  }
}
