import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BusinessGroupsService } from './business-groups.service';

/**
 * HISTORIAL DE PAGOS DEL GRUPO EMPRESARIAL (Javier, 2026-09-29): «cuando voy
 * a un negocio puedo ver el historial de pagos, pero en los grupos no es
 * posible». El grupo paga UNA suscripción de Hotmart, así que sus cobros no
 * cuelgan de ningún tenantId: se buscan en los webhooks crudos por el código
 * de suscriptor (y por el email del responsable, de respaldo). Estas pruebas
 * fijan ese rastreo y que la deduplicación por transacción sigue valiendo.
 */

function eventoHotmart(
  eventType: string,
  transaccion: string,
  extras: Record<string, unknown> = {},
) {
  return {
    eventType,
    processedAt: new Date('2026-09-01T12:00:00Z'),
    payload: {
      data: {
        purchase: {
          transaction: transaccion,
          approved_date: Date.parse('2026-09-01T10:00:00Z'),
          full_price: { value: 194739, currency_value: 'COP' },
          payment: { type: 'CREDIT_CARD' },
          recurrence_number: 4,
          ...extras,
        },
      },
    },
  };
}

function makeService(opts: {
  grupo?: Record<string, unknown> | null;
  eventos?: unknown[];
}) {
  const findManyEventos = vi.fn(async () => opts.eventos ?? []);
  const prisma = {
    businessGroup: {
      findFirst: vi.fn(async () =>
        opts.grupo === undefined
          ? {
              id: 'grupo-1',
              name: 'Grupo Mistika',
              status: 'ACTIVE',
              planPeriodicity: 'MENSUAL',
              currentPeriodEnd: null,
              lastChargeAt: null,
              hotmartSubscriberCode: 'SUB-ABC',
              responsibleEmail: 'Duenno@Mail.com',
            }
          : opts.grupo,
      ),
    },
    hotmartWebhookEvent: { findMany: findManyEventos },
    // El libro: el cobro del grupo de septiembre, apuntado al grupo por $150.
    incomeRecord: {
      findMany: vi.fn(async () => [{ externalTxId: 'HP2591990171', grossUsd: 150 }]),
    },
  };
  const svc = new BusinessGroupsService(prisma as any, {} as any);
  return { svc, findManyEventos };
}

describe('historial de pagos del grupo empresarial', () => {
  it('rastrea los cobros por el código de suscriptor Y por el email del responsable', async () => {
    const { svc, findManyEventos } = makeService({ eventos: [] });

    await svc.paymentHistory('grupo-1');

    const where = (findManyEventos.mock.calls[0] as any[])[0].where;
    const rutas = where.OR.map((c: any) => c.payload.path.join('.'));
    // Compras y cancelaciones guardan el código en sitios distintos.
    expect(rutas).toContain('data.subscription.subscriber.code');
    expect(rutas).toContain('data.subscriber.code');
    // El primer cobro es anterior a fijar el código: se caza por el buyer.
    expect(rutas).toContain('data.buyer.email');
    const valores = where.OR.map((c: any) => c.payload.equals);
    expect(valores).toContain('SUB-ABC');
    expect(valores).toContain('duenno@mail.com');
    // El filtro JSON compara exacto: la variante tal como se escribió también.
    expect(valores).toContain('Duenno@Mail.com');
  });

  it('agrupa por transacción: APPROVED + COMPLETE del mismo cobro son UNA fila', async () => {
    const { svc } = makeService({
      eventos: [
        eventoHotmart('PURCHASE_APPROVED', 'HP-1'),
        eventoHotmart('PURCHASE_COMPLETE', 'HP-1'),
        eventoHotmart('PURCHASE_DELAYED', 'HP-2', {
          payment: { type: 'CREDIT_CARD', refusal_reason: 'Saldo insuficiente.' },
        }),
      ],
    });

    const r = await svc.paymentHistory('grupo-1');

    expect(r.pagos).toHaveLength(2);
    expect(r.resumen.pagosCorrectos).toBe(1);
    const rechazado = r.pagos.find((p) => p.estado === 'RECHAZADO');
    expect(rechazado?.motivo).toBe('Saldo insuficiente.');
  });

  it('un grupo sin código ni email no consulta nada y devuelve el historial vacío', async () => {
    const { svc, findManyEventos } = makeService({
      grupo: {
        id: 'grupo-2',
        name: 'Grupo Nuevo',
        status: 'ACTIVE',
        planPeriodicity: null,
        currentPeriodEnd: null,
        lastChargeAt: null,
        hotmartSubscriberCode: null,
        responsibleEmail: null,
      },
      eventos: [],
    });

    const r = await svc.paymentHistory('grupo-2');

    expect(findManyEventos).not.toHaveBeenCalled();
    expect(r.pagos).toEqual([]);
    expect(r.resumen.totalCobros).toBe(0);
  });

  it('un grupo que no existe (o es de otra marca) es 404, no un historial vacío', async () => {
    const { svc } = makeService({ grupo: null });

    await expect(svc.paymentHistory('ajeno')).rejects.toThrow(NotFoundException);
  });
});
