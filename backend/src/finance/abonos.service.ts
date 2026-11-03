import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { OFERTAS_CON_ABONO, OFERTAS_DE_ABONO, ofertaConAbono } from '../billing/abono-hotmart';
import {
  clasificarAbonos,
  leerDecision,
  PREFIJO_DECISION,
  type DecisionAbono,
  type EstadoAbono,
} from './abonos';

interface FilaAbono {
  tx: string;
  monto: number;
  fecha: Date;
  status: string;
  email: string | null;
  nombre: string | null;
  telefono: string | null;
  negocio: string | null;
}

interface FilaPago {
  tx: string;
  email: string | null;
  fecha: Date;
  oferta: string | null;
  monto: number | null;
  negocio: string | null;
  tenantId: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Número de recurrencia sin que un valor raro rompa el cast en Postgres. */
const RECURRENCIA = `CASE WHEN e.payload->'data'->'purchase'->>'recurrence_number' ~ '^[0-9]+$'
  THEN (e.payload->'data'->'purchase'->>'recurrence_number')::int ELSE 1 END`;

/**
 * El apartado «Abonos» de Contabilidad. Lee los abonos de 20 y los restantes
 * de los planes con abono desde los eventos de Hotmart (ahí está el correo del
 * comprador, que el libro de ingresos no guarda) y aplica las decisiones a mano
 * guardadas en `Setting`, una fila por abono: así enlazar uno no reescribe las
 * decisiones de los demás.
 */
@Injectable()
export class AbonosService {
  constructor(private prisma: PrismaService) {}

  private async abonos(): Promise<FilaAbono[]> {
    return this.prisma.$queryRawUnsafe<FilaAbono[]>(
      `SELECT DISTINCT ON (i."externalTxId")
         i."externalTxId" AS tx, i."grossUsd"::float8 AS monto, i."saleDate" AS fecha, i.status,
         lower(trim(e.payload->'data'->'buyer'->>'email')) AS email,
         e.payload->'data'->'buyer'->>'name' AS nombre,
         COALESCE(e.payload->'data'->'buyer'->>'checkout_phone', e.payload->'data'->'buyer'->>'phone') AS telefono,
         COALESCE(t."brandName", i."brandName") AS negocio
       FROM "IncomeRecord" i
       JOIN "HotmartWebhookEvent" e ON e.payload->'data'->'purchase'->>'transaction' = i."externalTxId"
       LEFT JOIN "Tenant" t ON t.id = i."tenantId"
       WHERE i.gateway = 'HOTMART'
         AND lower(e.payload->'data'->'purchase'->'offer'->>'code') = ANY($1::text[])
       ORDER BY i."externalTxId", e."processedAt"`,
      OFERTAS_DE_ABONO,
    );
  }

  /** Primeros pagos de las ofertas «+ Abono»: los restantes. */
  private async restantes(): Promise<FilaPago[]> {
    return this.prisma.$queryRawUnsafe<FilaPago[]>(
      `SELECT DISTINCT ON (tx) * FROM (
         SELECT e.payload->'data'->'purchase'->>'transaction' AS tx,
           lower(trim(e.payload->'data'->'buyer'->>'email')) AS email,
           COALESCE(i."saleDate", e."processedAt") AS fecha,
           lower(e.payload->'data'->'purchase'->'offer'->>'code') AS oferta,
           i."grossUsd"::float8 AS monto,
           COALESCE(t."brandName", i."brandName") AS negocio,
           i."tenantId" AS "tenantId",
           e."processedAt" AS visto
         FROM "HotmartWebhookEvent" e
         LEFT JOIN "IncomeRecord" i ON i.gateway = 'HOTMART' AND i."externalTxId" = e.payload->'data'->'purchase'->>'transaction'
         LEFT JOIN "Tenant" t ON t.id = i."tenantId"
         WHERE e."eventType" IN ('PURCHASE_APPROVED', 'PURCHASE_COMPLETE')
           AND lower(e.payload->'data'->'purchase'->'offer'->>'code') = ANY($1::text[])
           AND ${RECURRENCIA} <= 1
       ) x
       ORDER BY tx, visto`,
      Object.keys(OFERTAS_CON_ABONO),
    );
  }

  private async decisiones(): Promise<Map<string, DecisionAbono>> {
    const filas = await this.prisma.setting.findMany({
      where: { key: { startsWith: PREFIJO_DECISION } },
      select: { key: true, value: true },
    });
    const out = new Map<string, DecisionAbono>();
    for (const f of filas) {
      const d = leerDecision(f.value);
      if (d) out.set(f.key.slice(PREFIJO_DECISION.length), d);
    }
    return out;
  }

  async listar() {
    const [abonos, restantes, decisiones] = await Promise.all([
      this.abonos(),
      this.restantes(),
      this.decisiones(),
    ]);
    const clasificados = clasificarAbonos(
      abonos.map((a) => ({ tx: a.tx, email: a.email, fecha: new Date(a.fecha) })),
      restantes.map((p) => ({ tx: p.tx, email: p.email, fecha: new Date(p.fecha) })),
      decisiones,
    );

    // Un enlace manual puede apuntar a un pago que no es «+ Abono» (el cliente
    // pagó el plan normal con otro correo): se busca en el libro.
    const restantePorTx = new Map(restantes.map((p) => [p.tx, p]));
    const faltan = clasificados
      .map((c) => c.pagoTx)
      .filter((tx): tx is string => !!tx && !restantePorTx.has(tx));
    if (faltan.length) {
      const filas = await this.prisma.incomeRecord.findMany({
        where: { externalTxId: { in: faltan } },
        select: { externalTxId: true, grossUsd: true, saleDate: true, brandName: true, tenantId: true },
      });
      for (const f of filas) {
        restantePorTx.set(f.externalTxId, {
          tx: f.externalTxId,
          email: null,
          fecha: f.saleDate,
          oferta: null,
          monto: Number(f.grossUsd),
          negocio: f.brandName,
          tenantId: f.tenantId,
        });
      }
    }

    const items = abonos.map((a, i) => {
      const c = clasificados[i];
      const d = decisiones.get(a.tx);
      const pago = c.pagoTx ? restantePorTx.get(c.pagoTx) ?? null : null;
      const plan = pago?.oferta ? ofertaConAbono(pago.oferta) : null;
      return {
        tx: a.tx,
        fecha: a.fecha,
        montoUsd: round2(Number(a.monto)),
        devuelto: a.status !== 'PAGADO',
        email: a.email,
        nombre: a.nombre,
        telefono: a.telefono,
        negocio: pago?.negocio ?? a.negocio,
        estado: c.estado,
        enlace: c.enlace,
        nota: d?.nota ?? null,
        decididoEl: d?.fecha ?? null,
        pago: pago
          ? {
              tx: pago.tx,
              fecha: pago.fecha,
              montoUsd: pago.monto != null ? round2(Number(pago.monto)) : null,
              plan: plan?.nombre ?? null,
              precioDelPlanUsd: plan?.precioDelPlanUsd ?? null,
            }
          : null,
      };
    });

    const resumen = (estado: EstadoAbono) => {
      const de = items.filter((x) => x.estado === estado && !x.devuelto);
      return { cantidad: de.length, usd: round2(de.reduce((s, x) => s + x.montoUsd, 0)) };
    };

    // Para enlazar a mano: restantes que ningún abono tomó, y las ventas nuevas
    // recientes (el cliente pudo pagar el plan por un enlace sin abono).
    const tomados = new Set(clasificados.map((c) => c.pagoTx).filter(Boolean) as string[]);
    const libres = restantes
      .filter((p) => !tomados.has(p.tx))
      .map((p) => ({
        tx: p.tx,
        fecha: p.fecha,
        montoUsd: p.monto != null ? round2(Number(p.monto)) : null,
        negocio: p.negocio,
        email: p.email,
        tipo: 'RESTANTE' as const,
        plan: ofertaConAbono(p.oferta)?.nombre ?? null,
      }));
    const desde = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const nuevas = await this.prisma.incomeRecord.findMany({
      where: {
        category: 'NUEVA',
        status: 'PAGADO',
        tenantId: { not: null },
        saleDate: { gte: desde },
        externalTxId: { notIn: [...tomados, ...libres.map((l) => l.tx)] },
      },
      select: { externalTxId: true, saleDate: true, grossUsd: true, brandName: true, planPeriodicity: true },
      orderBy: { saleDate: 'desc' },
      take: 200,
    });

    return {
      resumen: {
        enEspera: resumen('EN_ESPERA'),
        enlazados: resumen('ENLAZADO'),
        noPagara: resumen('NO_PAGARA'),
      },
      abonos: items.sort((x, y) => new Date(y.fecha).getTime() - new Date(x.fecha).getTime()),
      candidatos: [
        ...libres,
        ...nuevas.map((n) => ({
          tx: n.externalTxId,
          fecha: n.saleDate,
          montoUsd: round2(Number(n.grossUsd)),
          negocio: n.brandName,
          email: null,
          tipo: 'VENTA_NUEVA' as const,
          plan: n.planPeriodicity,
        })),
      ],
    };
  }

  private async exigirAbono(tx: string) {
    const abonos = await this.abonos();
    if (!abonos.some((a) => a.tx === tx)) {
      throw new NotFoundException('Ese pago no es un abono de 20.');
    }
  }

  private guardar(tx: string, d: DecisionAbono) {
    const key = `${PREFIJO_DECISION}${tx}`;
    const value = JSON.stringify(d);
    return this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  async enlazar(tx: string, pagoTx: string, nota: string | null, userId: string | null) {
    await this.exigirAbono(tx);
    const pago = await this.prisma.incomeRecord.findFirst({
      where: { externalTxId: pagoTx.trim() },
      select: { externalTxId: true },
    });
    if (!pago) throw new BadRequestException('No encuentro ese pago en Contabilidad.');
    // Un pago ya enlazado a mano con otro abono no se reparte entre dos.
    const otros = await this.decisiones();
    for (const [abono, d] of otros) {
      if (abono !== tx && d.estado === 'ENLAZADO' && d.pagoTx === pago.externalTxId) {
        throw new BadRequestException('Ese pago ya está enlazado con otro abono.');
      }
    }
    await this.guardar(tx, {
      estado: 'ENLAZADO',
      pagoTx: pago.externalTxId,
      nota,
      por: userId,
      fecha: new Date().toISOString(),
    });
    return this.listar();
  }

  async marcarNoPagara(tx: string, nota: string | null, userId: string | null) {
    await this.exigirAbono(tx);
    await this.guardar(tx, { estado: 'NO_PAGARA', nota, por: userId, fecha: new Date().toISOString() });
    return this.listar();
  }

  /** Quita la decisión manual: el abono vuelve a esperar (o al enlace automático). */
  async deshacer(tx: string) {
    await this.prisma.setting.deleteMany({ where: { key: `${PREFIJO_DECISION}${tx}` } });
    return this.listar();
  }
}
