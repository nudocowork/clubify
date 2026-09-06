import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import {
  brandGrowCreds,
  BRAND_GROW_SELECT,
} from '../integrations/brand-sms-creds.util';

type Creds = {
  locationId: string;
  apiKey: string;
  switchNumber: number | null;
};

/**
 * «Te entró un pedido» al teléfono del negocio, desde el SERVIDOR.
 *
 * Por qué existe: el mensaje de WhatsApp con el pedido lo abre el navegador
 * del CLIENTE. Si eso falla —una ventana bloqueada, el navegador interno de
 * Instagram, o sencillamente que el cliente no pulsa enviar— el pedido queda
 * registrado y el negocio no se entera. Un negocio lo reportó el 2026-09-06
 * así: «entra el pedido en la app pero no me llega el mensaje al WhatsApp».
 *
 * Lo que ya había no bastaba: el push solo llega a la app de iOS y solo si
 * está instalada, y el socket exige tener el panel abierto. Esto no depende de
 * nada del cliente.
 *
 * APAGADO por defecto, y se enciende negocio por negocio: cada aviso gasta
 * saldo de Grow Business. Por eso el texto es CORTO —lo imprescindible y un
 * enlace— en vez del pedido entero: el detalle está en el panel, y un mensaje
 * largo son cinco segmentos de SMS por cada pedido.
 */
@Injectable()
export class OwnerOrderAlertService {
  private logger = new Logger(OwnerOrderAlertService.name);

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  /** Fire-and-forget: que un aviso que falla no tumbe la creación del pedido. */
  async avisar(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          code: true,
          total: true,
          fulfillment: true,
          tableNumber: true,
          tenantId: true,
          locationId: true,
          customer: { select: { fullName: true, phone: true } },
        },
      });
      if (!order) return;

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: order.tenantId },
        select: {
          name: true,
          brandName: true,
          currency: true,
          currencySymbol: true,
          ownerOrderAlertsEnabled: true,
          ownerOrderAlertsPhone: true,
          ownerOrderAlertsAccountId: true,
          whatsappOrdersPhone: true,
          whatsappPhone: true,
          phone: true,
          growBusinessLocationId: true,
          growBusinessApiKey: true,
          growBusinessSwitchNumber: true,
          whiteLabel: { select: BRAND_GROW_SELECT },
        },
      });
      if (!tenant?.ownerOrderAlertsEnabled) return;

      // Idempotencia. El aviso se dispara al crear el pedido, pero un
      // reintento del webhook o una reejecución manual no pueden mandarlo dos
      // veces: al negocio le llegarían dos avisos del mismo pedido y pensaría
      // que tiene dos.
      const yaAvisado = await this.prisma.event.findFirst({
        where: {
          tenantId: order.tenantId,
          type: 'order.owner_alert_sent',
          payload: { path: ['orderId'], equals: order.id },
        },
        select: { id: true },
      });
      if (yaAvisado) return;

      const telefono = (
        tenant.ownerOrderAlertsPhone ??
        (await this.telefonoDeLaSede(order.locationId)) ??
        tenant.whatsappOrdersPhone ??
        tenant.whatsappPhone ??
        tenant.phone ??
        ''
      ).trim();
      if (!telefono) {
        this.logger.warn(
          `aviso de pedido ${order.code}: el negocio no tiene teléfono`,
        );
        return;
      }

      const creds = await this.credenciales(tenant);
      if (!creds) {
        this.logger.warn(
          `aviso de pedido ${order.code}: sin credenciales de Grow Business`,
        );
        return;
      }

      const r = await this.growBusiness.sendSmsWithCreds(
        creds,
        telefono,
        this.texto(order, tenant),
        { tenantId: order.tenantId },
      );

      // Se registra SIEMPRE, salga o no: el negocio que dice «no me llegó»
      // merece una respuesta con fecha, no una suposición.
      await this.prisma.event.create({
        data: {
          tenantId: order.tenantId,
          type: 'order.owner_alert_sent',
          payload: {
            orderId: order.id,
            code: order.code,
            ok: r.ok,
            error: r.ok ? null : ((r as any).message ?? 'sin detalle'),
          },
        },
      });
    } catch (e) {
      this.logger.warn(
        `aviso de pedido ${orderId} falló: ${(e as Error).message}`,
      );
    }
  }

  /** El número de pedidos de la SEDE, si el pedido tiene una asignada. */
  private async telefonoDeLaSede(locationId: string | null) {
    if (!locationId) return null;
    const l = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { ordersWhatsappPhone: true, adminPhone: true },
    });
    return l?.ordersWhatsappPhone ?? l?.adminPhone ?? null;
  }

  /**
   * Subcuenta asignada por el super admin → credenciales propias del negocio →
   * subcuenta de su marca. Igual que en las alertas de reseñas.
   */
  private async credenciales(tenant: {
    ownerOrderAlertsAccountId: string | null;
    growBusinessLocationId: string | null;
    growBusinessApiKey: string | null;
    growBusinessSwitchNumber: number | null;
    whiteLabel: unknown;
  }): Promise<Creds | null> {
    if (tenant.ownerOrderAlertsAccountId) {
      const cuenta = await this.prisma.growBusinessAccount.findFirst({
        where: { id: tenant.ownerOrderAlertsAccountId, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (cuenta) return cuenta;
    }
    if (tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
      return {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      };
    }
    return brandGrowCreds(tenant.whiteLabel as any) ?? null;
  }

  /**
   * Corto a propósito.
   *
   * El detalle completo —artículos, dirección, notas— está en el panel, y
   * desde hoy la dirección también. Meterlo aquí serían cinco o seis segmentos
   * de SMS por pedido, y el negocio paga cada uno. Lo que hace falta para
   * reaccionar es: que entró, de quién, cuánto y dónde mirarlo.
   */
  private texto(
    order: {
      code: string;
      total: unknown;
      fulfillment: string;
      tableNumber: string | null;
      customer: { fullName: string } | null;
    },
    tenant: { currencySymbol: string | null },
  ): string {
    const simbolo = tenant.currencySymbol ?? '$';
    const total = Number(order.total).toLocaleString('es-CO');
    const tipo =
      order.fulfillment === 'DELIVERY'
        ? 'Domicilio'
        : order.fulfillment === 'PICKUP'
          ? 'Para llevar'
          : `Mesa ${order.tableNumber ?? ''}`.trim();
    const cliente = order.customer?.fullName?.trim() || 'Cliente';
    const url = `${process.env.APP_URL ?? 'https://app.soyclubify.com'}/app/orders`;
    // Sin emojis: WhatsApp los convierte en rombos por el camino web, y en SMS
    // fuerzan codificación de 16 bits, que reduce el segmento a 67 caracteres.
    return `Nuevo pedido ${order.code} - ${cliente} - ${simbolo}${total} - ${tipo}. Detalle y direccion en tu panel: ${url}`;
  }
}
