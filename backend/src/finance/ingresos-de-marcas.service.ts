import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { mesContable } from '../common/periodo-contable';
import { marcaClubify } from './alcance-de-marca';
import { IncomeRecordService } from './income-record.service';
import { enRango, rangoDe } from './where-periodo';
import { CONCEPTOS, Concepto, compararMarcas, conceptoDelIngreso } from './ingresos-de-marcas';

const METODOS = ['TRANSFERENCIA', 'HOTMART', 'STRIPE', 'EFECTIVO', 'OTRO'] as const;

/**
 * El apartado «Marcas blancas» del panel (Sara, 2026-10-03): lo que cada marca
 * blanca le paga a la plataforma y cuál ingresa más.
 *
 * No es un libro aparte: lee y escribe en `IncomeRecord`, el mismo de
 * Contabilidad, con `payerWhiteLabelId` = la marca. Así lo que se registra aquí
 * suma en Contabilidad, y nunca hay dos cifras para el mismo dinero.
 *
 * Solo toca tablas que NO van por negocio (el libro sin negocio, las compras de
 * créditos de Hotmart y las marcas): el admin de Clubify trabaja dentro de su
 * marca y el filtro por negocio le escondería todo lo de otra marca.
 */
@Injectable()
export class IngresosDeMarcasService {
  constructor(
    private prisma: PrismaService,
    private income: IncomeRecordService,
  ) {}

  private async marcas() {
    const clubify = await marcaClubify(this.prisma);
    const marcas = await this.prisma.whiteLabel.findMany({
      where: clubify ? { id: { not: clubify } } : {},
      select: { id: true, name: true, slug: true, logoUrl: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
    return { clubify, marcas };
  }

  private async ingresos(periodo: string | undefined, payerWhiteLabelId?: string) {
    const filas = await this.prisma.incomeRecord.findMany({
      where: {
        payerWhiteLabelId: payerWhiteLabelId ?? { not: null },
        ...enRango('saleDate', rangoDe(periodo)),
      },
      orderBy: { saleDate: 'desc' },
      select: {
        id: true,
        gateway: true,
        externalTxId: true,
        payerWhiteLabelId: true,
        productName: true,
        grossUsd: true,
        netExpectedUsd: true,
        saleDate: true,
        status: true,
        note: true,
      },
    });
    const compras = await this.prisma.hotmartCreditPurchase.findMany({
      where: { transactionId: { in: filas.map((f) => f.externalTxId) } },
      select: { transactionId: true, credits: true },
    });
    const creditos = new Map(compras.map((c) => [c.transactionId, c.credits]));
    return filas.map((f) => ({
      ...f,
      grossUsd: Number(f.grossUsd),
      netExpectedUsd: Number(f.netExpectedUsd),
      creditos: creditos.get(f.externalTxId) ?? null,
      concepto: conceptoDelIngreso({
        externalTxId: f.externalTxId,
        productName: f.productName,
        esCompraDeCreditos: creditos.has(f.externalTxId),
      }),
    }));
  }

  /** La comparación: cuánto pagó cada marca, por concepto, de mayor a menor. */
  async resumen(periodo?: string) {
    const { marcas } = await this.marcas();
    const filas = (await this.ingresos(periodo)).filter((f) => f.status === 'PAGADO');
    const comparacion = compararMarcas(
      filas.map((f) => ({
        payerWhiteLabelId: f.payerWhiteLabelId!,
        grossUsd: f.grossUsd,
        saleDate: f.saleDate,
        concepto: f.concepto,
      })),
      marcas.map((m) => m.id),
    );
    // Créditos comprados por Hotmart en el período (con o sin fila en el libro).
    const compras = await this.prisma.hotmartCreditPurchase.groupBy({
      by: ['whiteLabelId'],
      where: { status: 'ASSIGNED', ...enRango('createdAt', rangoDe(periodo)) },
      _sum: { credits: true },
    });
    const creditosComprados = new Map(compras.map((c) => [c.whiteLabelId, c._sum.credits ?? 0]));
    const porId = new Map(marcas.map((m) => [m.id, m]));
    return {
      periodo: periodo || 'todo',
      totalUsd: Math.round(comparacion.reduce((a, m) => a + m.totalUsd, 0) * 100) / 100,
      marcas: comparacion.map((c) => ({
        ...c,
        nombre: porId.get(c.whiteLabelId)?.name ?? '—',
        slug: porId.get(c.whiteLabelId)?.slug ?? null,
        logoUrl: porId.get(c.whiteLabelId)?.logoUrl ?? null,
        desde: porId.get(c.whiteLabelId)?.createdAt ?? null,
        creditosComprados: creditosComprados.get(c.whiteLabelId) ?? 0,
      })),
    };
  }

  async movimientos(whiteLabelId: string, periodo?: string) {
    const { marcas } = await this.marcas();
    const marca = marcas.find((m) => m.id === whiteLabelId);
    if (!marca) throw new NotFoundException('Marca blanca no encontrada');
    return { marca, movimientos: await this.ingresos(periodo, whiteLabelId) };
  }

  /**
   * Registra un pago de una marca a la plataforma. Entra al libro como ingreso
   * de Clubify (para Contabilidad) con la marca como pagadora.
   */
  async registrar(
    body: {
      whiteLabelId?: string;
      concepto?: string;
      descripcion?: string;
      montoUsd?: number | string;
      fecha?: string;
      metodo?: string;
      referencia?: string;
      nota?: string;
    },
    actorId: string,
  ) {
    const { clubify, marcas } = await this.marcas();
    const marca = marcas.find((m) => m.id === body.whiteLabelId);
    if (!marca) throw new BadRequestException('Elige la marca blanca que pagó.');
    const concepto = String(body.concepto ?? '').toUpperCase() as Concepto;
    if (!(concepto in CONCEPTOS)) throw new BadRequestException('Elige el concepto del pago.');
    const monto = Math.round(Number(String(body.montoUsd ?? '').replace(',', '.')) * 100) / 100;
    if (!(monto > 0)) throw new BadRequestException('Escribe el monto en dólares.');
    const fecha = this.fecha(body.fecha);
    const metodo = String(body.metodo ?? 'TRANSFERENCIA').toUpperCase();
    if (!(METODOS as readonly string[]).includes(metodo)) throw new BadRequestException('Método de pago no válido.');
    const descripcion = String(body.descripcion ?? '').trim().slice(0, 80);

    // Sin impuesto ni comisión de pasarela estimados para lo que no pasó por
    // una: si se cobró por Hotmart o Stripe, se usan las tasas de esa pasarela.
    const gateway = metodo === 'HOTMART' ? 'HOTMART' : metodo === 'STRIPE' ? 'STRIPE' : 'MANUAL';
    const { fee, tax, netExpected } = await this.income.desglose(gateway, monto);
    const quien = await this.prisma.user
      .findUnique({ where: { id: actorId }, select: { fullName: true, email: true } })
      .catch(() => null);
    const nota = [
      `Registrado a mano por ${quien?.fullName || quien?.email || 'el panel'} (${metodo.toLowerCase()})`,
      body.referencia?.trim() ? `ref. ${body.referencia.trim().slice(0, 80)}` : null,
      body.nota?.trim() ? body.nota.trim().slice(0, 500) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const fila = await this.prisma.incomeRecord.create({
      data: {
        // Prefijo propio: nunca choca con una transacción real de la pasarela.
        gateway,
        externalTxId: `marca-${randomUUID()}`,
        tenantId: null,
        whiteLabelId: clubify,
        payerWhiteLabelId: marca.id,
        brandName: `${marca.name} (marca blanca)`,
        // El concepto vive aquí: es lo que `conceptoDelIngreso` lee.
        productName: concepto === 'SERVICIO' && descripcion ? `${CONCEPTOS.SERVICIO}: ${descripcion}` : CONCEPTOS[concepto],
        category: 'MARCA_BLANCA',
        currency: 'USD',
        grossUsd: monto,
        gatewayFeeUsd: fee,
        taxUsd: tax,
        otherDiscountUsd: 0,
        netExpectedUsd: netExpected,
        isFirstPayment: concepto === 'REBRANDING',
        periodKey: mesContable(fecha),
        saleDate: fecha,
        reconStatus: 'PENDING',
        note: nota.slice(0, 1000),
      },
      select: { id: true, grossUsd: true, saleDate: true },
    });
    return { ok: true, id: fila.id, marca: marca.name, montoUsd: Number(fila.grossUsd) };
  }

  /** Anula un pago registrado A MANO por error. No se borra: deja de sumar. */
  async anular(id: string) {
    const fila = await this.prisma.incomeRecord.findFirst({
      where: { id, payerWhiteLabelId: { not: null } },
      select: { id: true, externalTxId: true, status: true },
    });
    if (!fila) throw new NotFoundException('Pago no encontrado');
    if (!fila.externalTxId.startsWith('marca-')) {
      throw new BadRequestException('Solo se anula lo registrado a mano. Lo que llegó por la pasarela se corrige allí.');
    }
    if (fila.status === 'CANCELADO') return { ok: true };
    await this.prisma.incomeRecord.update({ where: { id }, data: { status: 'CANCELADO' } });
    return { ok: true };
  }

  /** «2026-10-03» = ese día en Colombia (mediodía de Bogotá); nunca futuro. */
  private fecha(v?: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
    const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T17:00:00.000Z`) : new Date();
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Fecha no válida.');
    if (d.getTime() > Date.now() + 24 * 3600_000) throw new BadRequestException('La fecha no puede ser futura.');
    return d;
  }
}
