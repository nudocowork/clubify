import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ChannelType, MessageDirection, Order, Tenant, Customer, Location } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { customerPaymentLabel } from '../common/customer-payment';

/**
 * Adapter de canales. En MVP soporta:
 *  - WhatsApp Link (wa.me): genera links, no envía nada al servidor
 *  - WhatsApp Cloud API: stub, requiere config
 *  - SMS Twilio: stub
 */
@Injectable()
export class ChannelsService {
  private logger = new Logger(ChannelsService.name);

  constructor(private prisma: PrismaService) {}

  /** Genera un link wa.me para que el cliente abra WhatsApp con un mensaje
   *  pre-llenado al dueño/caja. Si el pedido tiene una SEDE asignada, rutea al
   *  número de pedidos de esa sede (cae a su adminPhone, luego al número del
   *  negocio). Nunca se pierde el pedido: siempre hay un fallback. */
  generateWaMeOwner(
    tenant: Tenant,
    order: Order,
    customer: Customer,
    location?: Location | null,
  ): string {
    // Prioridad: número de pedidos de la SEDE → adminPhone de la sede →
    // número de pedidos del negocio → whatsappPhone → phone.
    const phone = (
      location?.ordersWhatsappPhone ??
      location?.adminPhone ??
      tenant.whatsappOrdersPhone ??
      tenant.whatsappPhone ??
      tenant.phone ??
      ''
    ).replace(/\D/g, '');
    if (!phone) return '';

    const items = (order.items as any[])
      .map((i) => {
        // PROMOCIÓN: mostramos nombre, precio anterior → precio de promo y la
        // descripción (PDF 1254). El objeto promo lo persiste orders.service.
        if (i.promo) {
          const orig = i.promo.originalPrice;
          const promoPrice = i.promo.promoPrice ?? i.unitPrice;
          const priceLine =
            orig != null && orig > promoPrice
              ? `~${formatMoney(orig, tenant.currency, tenant.currencySymbol)}~ → ${formatMoney(promoPrice, tenant.currency, tenant.currencySymbol)}`
              : formatMoney(i.lineTotal, tenant.currency, tenant.currencySymbol);
          return (
            `• ${i.qty}x 🎁 ${i.promo.name} — ${priceLine}` +
            (i.promo.description ? `\n   📝 ${i.promo.description}` : '') +
            (i.note ? `\n   ↳ ${i.note}` : '')
          );
        }
        return (
          `• ${i.qty}x ${i.name} — ${formatMoney(i.lineTotal, tenant.currency, tenant.currencySymbol)}` +
          renderExtras(i, tenant) +
          (i.note ? `\n   ↳ ${i.note}` : '')
        );
      })
      .join('\n');

    const fulfillment = {
      PICKUP: '🥡 Para llevar',
      DINE_IN: `🍽 Mesa ${order.tableNumber ?? ''}`.trim(),
      DELIVERY: '🛵 Domicilio',
    }[order.fulfillment];

    // Bloque de dirección para delivery — el cliente lo completó en el
    // checkout y queda guardado en order.deliveryAddress (Json).
    const addr = order.deliveryAddress as
      | {
          firstName?: string;
          lastName?: string;
          phone?: string;
          departamento?: string;
          municipio?: string;
          direccion?: string;
        }
      | null;
    const addressBlock =
      order.fulfillment === 'DELIVERY' && addr
        ? [
            '',
            '*📦 Dirección de envío:*',
            addr.firstName || addr.lastName
              ? `${[addr.firstName, addr.lastName].filter(Boolean).join(' ')}`
              : '',
            addr.phone ? `📞 ${addr.phone}` : '',
            [addr.municipio, addr.departamento].filter(Boolean).join(', '),
            addr.direccion ? `📍 ${addr.direccion}` : '',
          ].filter(Boolean)
        : [];

    const sedeLine = location
      ? `🏢 Sede: ${location.name}${location.state ? ` — ${location.state}` : ''}`
      : '';

    // Método de pago que el cliente declaró en el checkout. El dueño pedía
    // verlo en ESTE mensaje (antes solo iba en el aviso al courier): sin la
    // línea tenía que preguntarle al cliente cómo pensaba pagar. Si no lo
    // indicó, la línea se omite entera — nada de «Pago:» vacío.
    const payLabel = customerPaymentLabel(
      order.customerPaymentMethod,
      order.customerPaymentOther,
    );

    const lines = [
      `🆕 *Pedido #${order.code}*`,
      sedeLine,
      `${customer.fullName} · ${customer.phone}`,
      '',
      items,
      '',
      `Subtotal: ${formatMoney(Number(order.subtotal), tenant.currency, tenant.currencySymbol)}`,
      Number(order.discount) > 0
        ? `Descuento: -${formatMoney(Number(order.discount), tenant.currency, tenant.currencySymbol)}`
        : '',
      `*Total: ${formatMoney(Number(order.total), tenant.currency, tenant.currencySymbol)}*`,
      '',
      fulfillment,
      payLabel ? `💳 Pago: ${payLabel}` : '',
      ...addressBlock,
      order.customerNote ? `📝 ${order.customerNote}` : '',
      '',
      `Ver pedido: ${process.env.APP_URL ?? 'http://localhost:3000'}/o/${order.code}`,
    ].filter(Boolean);

    const text = encodeURIComponent(lines.join('\n'));
    return `https://wa.me/${phone}?text=${text}`;
  }

  /**
   * Genera un wa.me al courier (whatsappDeliveryPhone) con el resumen del
   * pedido + dirección. Se usa cuando el negocio acepta el pago de un
   * pedido DELIVERY y necesita despachar al motociclista.
   * Devuelve string vacío si no hay número de courier configurado.
   */
  generateWaMeCourier(tenant: Tenant, order: Order, customer: Customer): string {
    const phone = (tenant.whatsappDeliveryPhone ?? '').replace(/\D/g, '');
    if (!phone) return '';

    const items = (order.items as any[])
      .map(
        (i) =>
          `• ${i.qty}x ${i.name}` +
          renderExtras(i, tenant) +
          (i.note ? `\n   ↳ ${i.note}` : ''),
      )
      .join('\n');

    const addr = order.deliveryAddress as
      | {
          firstName?: string;
          lastName?: string;
          phone?: string;
          departamento?: string;
          municipio?: string;
          direccion?: string;
        }
      | null;

    // Método de pago declarado por el cliente (efectivo/transferencia/…) +
    // si ya está pagado online (no cobrar) o hay que cobrar en la entrega.
    // Humanizado: el courier lee «efectivo», no el enum «EFECTIVO»; si el
    // cliente eligió OTRO, va el texto que escribió (Nequi, Daviplata…).
    const method = customerPaymentLabel(
      order.customerPaymentMethod,
      order.customerPaymentOther,
    );
    const payLine =
      order.paymentStatus === 'PAID'
        ? `Pago: ✅ Pagado online${method ? ` (${method})` : ''} — no cobrar`
        : method
          ? `Pago: 💵 ${method} — cobrar al cliente`
          : 'Pago: 💵 Cobrar al cliente';

    const lines = [
      `🛵 *Despacho domicilio · Pedido #${order.code}*`,
      `Cliente: ${customer.fullName} · ${customer.phone}`,
      '',
      items,
      '',
      `*Total: ${formatMoney(Number(order.total), tenant.currency, tenant.currencySymbol)}*`,
      payLine,
      '',
      '*📍 Dirección:*',
      addr
        ? [addr.municipio, addr.departamento].filter(Boolean).join(', ')
        : '',
      addr?.direccion ? addr.direccion : '',
      addr?.phone ? `📞 ${addr.phone}` : '',
      order.customerNote ? `\n📝 Nota: ${order.customerNote}` : '',
      '',
      `Origen: ${tenant.brandName}`,
    ].filter(Boolean);

    const text = encodeURIComponent(lines.join('\n'));
    return `https://wa.me/${phone}?text=${text}`;
  }

  /** Genera link para que el dueño abra WA con mensaje listo para enviar al cliente. */
  generateWaMeCustomer(tenant: Tenant, customer: Customer, body: string): string {
    const phone = (customer.phone ?? '').replace(/\D/g, '');
    if (!phone) return '';
    const text = encodeURIComponent(body);
    return `https://wa.me/${phone}?text=${text}`;
  }

  /**
   * Encola un mensaje para enviar. En MVP solo loguea + persiste como QUEUED.
   * Cuando se conecte Meta Cloud / Twilio, este método los enviará realmente.
   */
  async enqueueMessage(opts: {
    tenantId: string;
    customerId?: string;
    channel: ChannelType;
    body: string;
    ruleId?: string;
    templateId?: string;
    metadata?: any;
  }) {
    return this.prisma.message.create({
      data: {
        tenantId: opts.tenantId,
        customerId: opts.customerId,
        channel: opts.channel,
        direction: MessageDirection.OUT,
        body: opts.body,
        ruleId: opts.ruleId,
        templateId: opts.templateId,
        status: 'QUEUED',
        metadata: opts.metadata ?? {},
      },
    });
  }

  // ============ Configs ============

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  listConfigs(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.channelConfig.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'asc' },
    });
  }

  upsertConfig(
    user: AuthUser,
    body: { type: ChannelType; config: any; isActive?: boolean; isDefault?: boolean },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    return this.prisma.channelConfig.create({
      data: {
        tenantId: tid,
        type: body.type,
        config: body.config,
        isActive: body.isActive ?? true,
        isDefault: body.isDefault ?? false,
      },
    });
  }

  // ============ Mensajes ============

  listMessages(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.message.findMany({
      where: { tenantId: tid },
      include: { customer: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

// Renderiza los adicionales/extras de un item del pedido como sub-líneas
// bajo el producto. FIX 2026-06-15: antes los extras se sumaban al total pero
// NO aparecían en el mensaje — el negocio no veía qué pidió el cliente (ej.
// "adicional de papas"). Muestra "+ Nombre" con su precio si > 0.
function renderExtras(i: any, tenant: Tenant): string {
  const extras = Array.isArray(i?.extras) ? i.extras : [];
  if (extras.length === 0) return '';
  return extras
    .map((e: any) => {
      const price = Number(e?.price ?? 0);
      const priceTxt =
        price > 0
          ? ` (+${formatMoney(price, tenant.currency, (tenant as any).currencySymbol)})`
          : '';
      return `\n   + ${e?.name ?? 'Adicional'}${priceTxt}`;
    })
    .join('');
}

function formatMoney(
  n: number,
  currency: string,
  symbolOverride?: string | null,
) {
  const sym = symbolOverride?.trim();
  // Decimales SOLO si el precio los tiene (10,15 → "10,15"; 1.500 → "1.500").
  // Nunca redondear: el total del pedido en WhatsApp debe reflejar el precio
  // exacto que puso el negocio, sin convertir 10,15 → 11.
  const hasFractional = Math.abs(n - Math.trunc(n)) > 0.0001;
  const frac = hasFractional ? 2 : 0;
  try {
    const parts = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    }).formatToParts(n);
    if (sym) {
      return parts.map((p) => (p.type === 'currency' ? sym : p.value)).join('');
    }
    return parts.map((p) => p.value).join('');
  } catch {
    return `${sym || currency} ${n.toFixed(frac)}`;
  }
}
