import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from './grow-business.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from './brand-sms-creds.util';
import { resolveBrandTemplate } from './brand-message-templates';

/**
 * PDF 1256 F3 — Notificaciones de pedido al CLIENTE final por SMS.
 *
 * Multi-tenant y reutilizable: NO hay lógica específica de ninguna marca. El
 * negocio activa la feature (opt-in, OFF por defecto) y elige qué estados
 * disparan un SMS. El texto es una plantilla de marca (`op_customer_order_*`)
 * personalizable desde Master Admin → Marcas → Automatizaciones.
 *
 * Vive en IntegrationsModule (junto a GrowBusinessService) para que tanto
 * OrdersService como DeliveryService puedan inyectarlo sin dependencia
 * circular — ambos ya importan IntegrationsModule.
 *
 * Fire-and-forget: cualquier error se loguea y persiste como Event; NUNCA
 * bloquea el flujo del pedido/domicilio.
 */
export type CustomerOrderEvent =
  | 'created'
  | 'confirmed'
  | 'ready'
  | 'on_the_way'
  | 'delivered';

export const CUSTOMER_ORDER_EVENTS: CustomerOrderEvent[] = [
  'created',
  'confirmed',
  'ready',
  'on_the_way',
  'delivered',
];

// Default de eventos cuando enabled=true pero nadie eligió (los 2 más útiles y
// menos ruidosos: confirmación + salida a ruta).
const DEFAULT_EVENTS: CustomerOrderEvent[] = ['confirmed', 'on_the_way'];

@Injectable()
export class CustomerOrderSmsService {
  private logger = new Logger(CustomerOrderSmsService.name);

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  /**
   * Envía (si corresponde) el SMS al cliente de un pedido para un estado.
   * @param etaMinutes minutos estimados de llegada (solo aplica a on_the_way).
   */
  async notify(
    tenantId: string,
    orderId: string,
    eventKey: CustomerOrderEvent,
    opts?: { etaMinutes?: number | null },
  ): Promise<void> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          slug: true,
          whiteLabelId: true,
          brandName: true,
          customerOrderAlertsEnabled: true,
          customerOrderAlertsEvents: true,
          growBusinessLocationId: true,
          growBusinessApiKey: true,
          growBusinessSwitchNumber: true,
          whiteLabel: { select: BRAND_GROW_SELECT },
        },
      });
      if (!tenant || !tenant.customerOrderAlertsEnabled) return;

      const events = Array.isArray(tenant.customerOrderAlertsEvents)
        ? (tenant.customerOrderAlertsEvents as string[])
        : DEFAULT_EVENTS;
      if (!events.includes(eventKey)) return;

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          code: true,
          customer: { select: { fullName: true, phone: true } },
        },
      });
      const phoneRaw = order?.customer?.phone ?? '';
      const phone = phoneRaw.replace(/[^\d+]/g, '');
      // Sin teléfono válido no hay a quién avisar.
      if (!order || phone.replace(/\D/g, '').length < 7) return;

      // Creds SMS: propias del negocio > subcuenta GHL de la marca (nunca la de
      // Clubify si el negocio es de marca blanca).
      let creds: {
        locationId: string;
        apiKey: string;
        switchNumber: number | null;
      } | null = null;
      if (tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
        creds = {
          locationId: tenant.growBusinessLocationId,
          apiKey: tenant.growBusinessApiKey,
          switchNumber: tenant.growBusinessSwitchNumber,
        };
      }
      if (!creds) creds = brandGrowCreds(tenant.whiteLabel);
      if (!creds) {
        this.logger.warn(
          `[customer-order-sms] tenant=${tenantId} enabled pero sin creds SMS (ni propias ni de la marca)`,
        );
        return;
      }

      // Idempotencia: un SMS por (orderId, eventKey).
      const existing = await this.prisma.event.findFirst({
        where: {
          tenantId,
          type: 'customer.order_sms_sent',
          AND: [
            { payload: { path: ['orderId'], equals: orderId } },
            { payload: { path: ['eventKey'], equals: eventKey } },
          ],
        },
        select: { id: true },
      });
      if (existing) return;

      const trackingUrl = `${process.env.APP_URL ?? 'https://app.soyclubify.com'}/o/${order.code}`;
      const eta = opts?.etaMinutes;
      const body = await resolveBrandTemplate(this.prisma, {
        id: `op_customer_order_${eventKey}`,
        whiteLabelId: tenant.whiteLabelId,
        vars: {
          brandName: tenant.brandName ?? '',
          customerName: order.customer?.fullName ?? '',
          code: order.code,
          trackingLine:
            eventKey === 'delivered' ? '' : ` Sigue tu pedido: ${trackingUrl}`,
          etaLine:
            eventKey === 'on_the_way' && eta && eta > 0
              ? ` Llega en ~${eta} min.`
              : '',
        },
      });
      if (!body.trim()) return;

      const r = await this.growBusiness
        .sendSmsWithCreds(creds, phone, body)
        .catch((e) => ({ ok: false as const, message: e?.message }));

      await this.prisma.event.create({
        data: {
          tenantId,
          type: r.ok ? 'customer.order_sms_sent' : 'customer.order_sms_failed',
          payload: {
            orderId,
            eventKey,
            phone,
            ok: r.ok,
            message: r.ok ? null : (r as any).message ?? null,
          },
        },
      });
    } catch (e: any) {
      this.logger.warn(
        `[customer-order-sms] order=${orderId} ev=${eventKey} err=${e?.message}`,
      );
    }
  }
}
