import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Fulfillment,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TenantStatus,
} from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ChannelsService } from '../channels/channels.service';
import { PromotionsService } from '../promotions/promotions.service';
import { AutomationsService } from '../automations/automations.service';
import { OrdersGateway } from './orders.gateway';
import { EmailService } from '../email/email.service';
import { WalletService } from '../wallet/wallet.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from '../integrations/brand-sms-creds.util';
import { resolveBrandTemplate } from '../integrations/brand-message-templates';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import { DeliveryService } from '../delivery/delivery.service';
import {
  orderConfirmedTemplate,
  orderCreatedTemplate,
  orderReadyTemplate,
} from '../email/templates/templates';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);

export type OrderItem = {
  productId: string;
  variantId?: string | null;
  extras: { id: string; name: string; price: number }[];
  qty: number;
  name: string;
  unitPrice: number;
  lineTotal: number;
  note?: string;
  // Metadata cuando el item es una PROMOCIÓN (productId 'promo:<id>'). Se usa
  // para el mensaje de WhatsApp: nombre, precio anterior, precio de promo y
  // descripción. (PDF 1254)
  promo?: {
    name: string;
    originalPrice: number | null;
    promoPrice: number;
    description: string | null;
  } | null;
};

/**
 * Devuelve true si `addr` representa una dirección de entrega válida.
 * Acepta:
 *  - string no vacío (después de trim) — formato histórico
 *  - objeto con cualquiera de estas keys con contenido: `direccion`,
 *    `address`, `street` — frontend público manda `direccion`
 * (2026-06-08).
 */
/**
 * Extrae un string legible de la dirección de entrega, soportando
 * string libre o objeto con keys `direccion`/`address`/`street` más
 * `municipio` y `departamento` opcionales. Usado para SMS y display
 * (2026-06-08).
 */
function extractDeliveryAddressText(addr: unknown): string {
  if (addr == null) return '';
  if (typeof addr === 'string') return addr.trim();
  if (typeof addr === 'object') {
    const o = addr as Record<string, unknown>;
    const main =
      [o.direccion, o.address, o.street]
        .find((v) => typeof v === 'string' && v.trim().length > 0) ?? '';
    const muni =
      typeof o.municipio === 'string' ? o.municipio.trim() : '';
    const depto =
      typeof o.departamento === 'string' ? o.departamento.trim() : '';
    return [String(main).trim(), muni, depto].filter(Boolean).join(', ');
  }
  return '';
}

function hasValidDeliveryAddress(addr: unknown): boolean {
  if (addr == null) return false;
  if (typeof addr === 'string') return addr.trim().length > 0;
  if (typeof addr === 'object') {
    const o = addr as Record<string, unknown>;
    for (const key of ['direccion', 'address', 'street']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim().length > 0) return true;
    }
  }
  return false;
}

export type CreateOrderDto = {
  tenantSlug: string;
  customer: { fullName: string; phone: string; email?: string };
  items: { productId: string; variantId?: string; extraIds?: string[]; qty: number; note?: string }[];
  fulfillment: Fulfillment;
  tableNumber?: string;
  deliveryAddress?: any;
  customerNote?: string;
  locationId?: string;
  // Menú público de origen ('MESA' | 'DELIVERY'). Lo manda el frontend
  // según la ruta. Se persiste como discriminator redundante para reportes.
  mode?: 'MESA' | 'DELIVERY';
};

@Injectable()
export class OrdersService {
  private logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private channels: ChannelsService,
    private promotions: PromotionsService,
    private automations: AutomationsService,
    private gateway: OrdersGateway,
    private email: EmailService,
    private wallet: WalletService,
    private appConfig: AppConfigService,
    private growBusiness: GrowBusinessService,
    private brand: WhitelabelBrandService,
    private delivery: DeliveryService,
  ) {}

  /** Lista de eventos del pedido delivery que pueden disparar SMS al
   *  courier. El tenant elige cuáles activar desde su panel. */
  private readonly DELIVERY_EVENTS = [
    'created',
    'confirmed',
    'ready',
    'delivered',
  ] as const;

  /**
   * Dispara SMS a empresa(s) de domicilio cuando un pedido DELIVERY
   * pasa por un estado suscrito. Fire-and-forget: errores se loguean y
   * persisten como Event para audit. NUNCA bloquea el flujo del pedido.
   *
   * Eventos posibles: 'created' (al crearse el pedido), 'confirmed',
   * 'ready', 'delivered'. El tenant configura cuáles disparan.
   */
  private async maybeNotifyDeliveryAlert(
    tenantId: string,
    orderId: string,
    eventKey: 'created' | 'confirmed' | 'ready' | 'delivered',
  ) {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          whiteLabelId: true,
          brandName: true,
          currencySymbol: true,
          whatsappDeliveryPhone: true,
          deliveryAlertsEnabled: true,
          deliveryAlertsPhones: true,
          deliveryAlertsEvents: true,
          deliveryAlertsAccountId: true,
          growBusinessLocationId: true,
          growBusinessApiKey: true,
          growBusinessSwitchNumber: true,
          whiteLabel: { select: BRAND_GROW_SELECT },
        },
      });
      if (!tenant || !tenant.deliveryAlertsEnabled) return;

      // Eventos suscritos: si nada está configurado, default a ['created'].
      const events = Array.isArray(tenant.deliveryAlertsEvents)
        ? (tenant.deliveryAlertsEvents as string[])
        : ['created'];
      if (!events.includes(eventKey)) return;

      // Solo aplica a pedidos DELIVERY.
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { fullName: true, phone: true } } },
      });
      if (!order || order.fulfillment !== 'DELIVERY') return;

      // Resolver teléfonos destino. Si nadie configuró el array nuevo,
      // fallback al whatsappDeliveryPhone histórico.
      const phones: string[] = Array.isArray(tenant.deliveryAlertsPhones)
        ? (tenant.deliveryAlertsPhones as string[]).filter(
            (p) => typeof p === 'string' && p.trim().length >= 6,
          )
        : [];
      if (phones.length === 0 && tenant.whatsappDeliveryPhone) {
        phones.push(tenant.whatsappDeliveryPhone);
      }
      if (phones.length === 0) return;

      // Resolver creds: subcuenta global > tenant.
      let creds: {
        locationId: string;
        apiKey: string;
        switchNumber: number | null;
      } | null = null;
      if (tenant.deliveryAlertsAccountId) {
        const acc = await this.prisma.growBusinessAccount.findFirst({
          where: { id: tenant.deliveryAlertsAccountId, deletedAt: null },
          select: { locationId: true, apiKey: true, switchNumber: true },
        });
        if (acc) {
          creds = {
            locationId: acc.locationId,
            apiKey: acc.apiKey,
            switchNumber: acc.switchNumber,
          };
        }
      }
      if (!creds && tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
        creds = {
          locationId: tenant.growBusinessLocationId,
          apiKey: tenant.growBusinessApiKey,
          switchNumber: tenant.growBusinessSwitchNumber,
        };
      }
      // Capa MARCA: subcuenta GHL de la marca blanca (nunca la de Clubify).
      if (!creds) creds = brandGrowCreds(tenant.whiteLabel);
      if (!creds) {
        this.logger.warn(
          `[delivery-alert] tenant=${tenantId} enabled pero sin creds (ni subcuenta ni propias ni de la marca)`,
        );
        return;
      }

      // Fix 2026-06-08: el frontend público manda la key `direccion`,
      // no `address`. Soportar ambas + componer con depto/municipio si
      // el objeto los trae.
      const addr = extractDeliveryAddressText(order.deliveryAddress);

      const eventLabel: Record<typeof eventKey, string> = {
        created: '🛵 NUEVO PEDIDO DELIVERY',
        confirmed: '✅ Pedido CONFIRMADO',
        ready: '📦 Pedido LISTO PARA RECOGER',
        delivered: '✔️ Pedido ENTREGADO',
      };

      // Plantilla `op_delivery_alert` (personalizable por marca en Master Admin →
      // Automatizaciones). Los fragmentos condicionales van pre-calculados como
      // tokens `{...Line}` → sin override el texto queda idéntico al histórico.
      const body = await resolveBrandTemplate(this.prisma, {
        id: 'op_delivery_alert',
        whiteLabelId: tenant.whiteLabelId,
        vars: {
          eventLabel: eventLabel[eventKey],
          brandName: tenant.brandName ?? '',
          code: order.code,
          total: `${tenant.currencySymbol?.trim() || '$'}${Number(order.total).toLocaleString('es-CO')}`,
          customerName: order.customer?.fullName ?? 'Anónimo',
          telLine: order.customer?.phone ? `Tel: ${order.customer.phone}\n` : '',
          addrLine: addr ? `Dirección: ${addr}\n` : '',
          noteLine: order.customerNote ? `\nNota: ${order.customerNote}` : '',
        },
      });

      // Idempotencia: si ya mandamos ESTE eventKey para este order, skip.
      // El filtro en payload debe ser por (orderId AND eventKey) — sino el
      // findFirst trae cualquier event 'sent' del order y un chequeo
      // posterior `existing.eventKey === eventKey` puede fallar cuando
      // existing es de OTRO eventKey, permitiendo duplicados.
      const existing = await this.prisma.event.findFirst({
        where: {
          tenantId,
          type: 'delivery.sms_alert_sent',
          AND: [
            { payload: { path: ['orderId'], equals: orderId } },
            { payload: { path: ['eventKey'], equals: eventKey } },
          ],
        },
        select: { id: true },
      });
      if (existing) return;

      // Mandar a cada destino, registrar como un único evento con
      // resumen de éxitos/fallos para no inflar la tabla.
      const results = await Promise.all(
        phones.map(async (phone) => {
          const r = await this.growBusiness
            .sendSmsWithCreds(creds!, phone, body)
            .catch((e) => ({ ok: false as const, message: e?.message }));
          return { phone, ok: r.ok, message: !r.ok ? (r as any).message : null };
        }),
      );
      const okCount = results.filter((r) => r.ok).length;

      await this.prisma.event.create({
        data: {
          tenantId,
          type:
            okCount > 0
              ? 'delivery.sms_alert_sent'
              : 'delivery.sms_alert_failed',
          payload: {
            orderId,
            eventKey,
            results,
            okCount,
            total: results.length,
          },
        },
      });
    } catch (e: any) {
      this.logger.warn(
        `[delivery-alert] order=${orderId} ev=${eventKey} err=${e?.message}`,
      );
    }
  }

  private async broadcast(orderId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
      },
    });
    if (o) this.gateway.broadcastOrderUpsert(o.tenantId, o);
  }

  // ============= público (cliente final) =============

  async createPublic(dto: CreateOrderDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
      include: { cards: { where: { isActive: true, autoStampOnOrder: true }, take: 1 } },
    });
    if (!tenant || tenant.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    if (!dto.items?.length) throw new BadRequestException('Carrito vacío');

    // Fix audit 2026-06-07: derivar SIEMPRE el mode del fulfillment
    // (no aceptar dto.mode si contradice fulfillment). Antes un cliente
    // podía mandar `mode='MESA' + fulfillment='DELIVERY'` para bypass
    // availableForDelivery:false y luego entregar a domicilio. Ahora si
    // fulfillment es DELIVERY → mode forzado a DELIVERY; DINE_IN → MESA.
    const derivedMode =
      dto.fulfillment === 'DELIVERY'
        ? 'DELIVERY'
        : dto.fulfillment === 'DINE_IN'
          ? 'MESA'
          : null;
    // Para PICKUP/otros sin fulfillment explícito, cae a dto.mode (o null).
    const effectiveMode = derivedMode ?? dto.mode ?? null;
    // Si fulfillment es DELIVERY pero NO viene deliveryAddress, rechazar.
    // Fix 2026-06-08: aceptar string ("Cra. 1 con 23") O objeto
    // ({departamento, municipio, direccion, ...}). Antes solo string —
    // si el frontend mandaba objeto, .trim?.() era undefined → tiraba
    // "Falta dirección" aunque el cliente había completado el form.
    if (
      derivedMode === 'DELIVERY' &&
      !hasValidDeliveryAddress(dto.deliveryAddress)
    ) {
      throw new BadRequestException(
        'Falta dirección de entrega para fulfillment DELIVERY',
      );
    }
    // Si fulfillment es DINE_IN, normalizar — no persistir address.
    // Si fulfillment es DELIVERY, no persistir tableNumber (queda mesa
    // fantasma en el pedido). Ver mutaciones de tableNumber/address más
    // abajo donde se persisten.
    const cleanTableNumber =
      derivedMode === 'DELIVERY' ? null : dto.tableNumber ?? null;
    const cleanDeliveryAddress =
      derivedMode === 'MESA' ? null : dto.deliveryAddress ?? null;
    const modeFilter =
      effectiveMode === 'MESA'
        ? { availableForMesa: true }
        : effectiveMode === 'DELIVERY'
          ? { availableForDelivery: true }
          : {};

    // Resolver productos y precios actuales (anti-tampering). Los items de
    // PROMOCIÓN llegan con productId 'promo:<id>' → se resuelven aparte contra
    // la tabla Promotion (antes el backend los buscaba como producto y tiraba
    // "Producto promo:… no disponible" → el pedido fallaba). PDF 1254.
    const productIds = dto.items
      .map((i) => i.productId)
      .filter((id) => !id.startsWith('promo:'));
    const promoIds = dto.items
      .filter((i) => i.productId.startsWith('promo:'))
      .map((i) => i.productId.slice('promo:'.length));
    const products = await this.prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        id: { in: productIds },
        isAvailable: true,
        ...modeFilter,
      },
      include: { variants: true, extras: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));
    const promos = promoIds.length
      ? await this.prisma.promotion.findMany({
          where: { tenantId: tenant.id, id: { in: promoIds }, isActive: true },
        })
      : [];
    const promoMap = new Map(promos.map((p) => [p.id, p]));

    const items: OrderItem[] = [];
    let subtotal = 0;
    for (const i of dto.items) {
      // --- Item de PROMOCIÓN ---
      if (i.productId.startsWith('promo:')) {
        const promo = promoMap.get(i.productId.slice('promo:'.length));
        if (!promo)
          throw new BadRequestException('Promoción no disponible');
        const orig =
          promo.originalPrice != null ? Number(promo.originalPrice) : null;
        const val = promo.value != null ? Number(promo.value) : 0;
        // Mismo cálculo que el storefront (anti-tampering: no confiamos en el
        // unitPrice que manda el cliente).
        let finalPrice: number | null = null;
        if (promo.type === 'DISCOUNT_AMOUNT' && val > 0) finalPrice = val;
        else if (promo.type === 'DISCOUNT_PCT' && val > 0 && orig != null)
          // Redondeo a 2 decimales (no a entero): un 15% sobre $45,50 debe
          // dar $38,68, no $39. Mismo cálculo exacto que el storefront.
          finalPrice = Math.round(orig * (1 - val / 100) * 100) / 100;
        const unit = finalPrice ?? orig ?? 0;
        const qty = Math.max(1, Math.min(50, i.qty));
        const lineTotal = unit * qty;
        subtotal += lineTotal;
        items.push({
          productId: i.productId,
          variantId: null,
          extras: [],
          qty,
          name: `🎁 ${promo.name}`,
          unitPrice: unit,
          lineTotal,
          note: i.note,
          promo: {
            name: promo.name,
            originalPrice: orig,
            promoPrice: unit,
            description: promo.description?.trim() || null,
          },
        });
        continue;
      }
      const p = map.get(i.productId);
      if (!p) throw new BadRequestException(`Producto ${i.productId} no disponible`);
      let unit = Number(p.basePrice);
      let variantName = '';
      if (i.variantId) {
        const v = p.variants.find((x) => x.id === i.variantId);
        if (!v) throw new BadRequestException('Variante inválida');
        // ABSOLUTE: la variante define el precio propio (reemplaza al base).
        // DELTA (default): suma su priceDelta al base.
        unit =
          p.variantPriceMode === 'ABSOLUTE'
            ? Number(v.priceDelta)
            : unit + Number(v.priceDelta);
        variantName = ` (${v.name})`;
      }
      const extras = (i.extraIds ?? []).map((eid) => {
        const e = p.extras.find((x) => x.id === eid);
        if (!e) throw new BadRequestException('Extra inválido');
        unit += Number(e.price);
        return { id: e.id, name: e.name, price: Number(e.price) };
      });
      const qty = Math.max(1, Math.min(50, i.qty));
      const lineTotal = unit * qty;
      subtotal += lineTotal;
      items.push({
        productId: p.id,
        variantId: i.variantId ?? null,
        extras,
        qty,
        name: p.name + variantName,
        unitPrice: unit,
        lineTotal,
        note: i.note,
      });
    }

    // Aplicar promos automáticas
    const { discount, applied } = await this.promotions.computeForCart(
      tenant.id,
      subtotal,
      items,
    );
    const total = Math.max(0, subtotal - discount);

    // Customer match-or-create por phone
    const phone = dto.customer.phone.trim();
    let customer = await this.prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId: tenant.id, phone } },
    }).catch(() => null);
    if (!customer) {
      // Si el email ya está usado por otro customer del mismo tenant, lo
      // omitimos para no violar la unique key tenantId_email. Bug observado
      // en MVP: dos clientes que comparten el mismo email familiar pero
      // tienen phones distintos hacían explotar el insert con P2002.
      let safeEmail = dto.customer.email;
      if (safeEmail) {
        const dupe = await this.prisma.customer
          .findUnique({
            where: {
              tenantId_email: { tenantId: tenant.id, email: safeEmail },
            },
          })
          .catch(() => null);
        if (dupe) safeEmail = undefined;
      }
      customer = await this.prisma.customer
        .create({
          data: {
            tenantId: tenant.id,
            fullName: dto.customer.fullName,
            phone,
            email: safeEmail,
          },
        })
        .catch(async (e: any) => {
          // Race condition: otro POST creó el customer con este phone entre
          // findUnique y create. Re-leer y reutilizar.
          if (e?.code === 'P2002') {
            const found = await this.prisma.customer.findUnique({
              where: { tenantId_phone: { tenantId: tenant.id, phone } },
            });
            if (found) return found;
          }
          throw e;
        });
    } else if (customer.fullName !== dto.customer.fullName) {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { fullName: dto.customer.fullName },
      });
    }

    // Generar código único.
    // HOTFIX 2026-06-05 (bug O): `findUnique` + `create` no es atómico.
    // Dos pedidos simultáneos pueden ambos pasar el findUnique con el
    // mismo code (32^4 = ~1M combos) → el 2do create tira P2002 → 500
    // al cliente. Ahora reintentamos hasta 3 veces si el create choca.
    let code = codeGen();
    while (await this.prisma.order.findUnique({ where: { code } })) {
      code = codeGen();
    }

    let order;
    let attempts = 0;
    while (true) {
      try {
        order = await this.prisma.order.create({
          data: {
            tenantId: tenant.id,
            customerId: customer.id,
            code,
            items: items as any,
            subtotal,
            discount,
            total,
            appliedPromos: applied as any,
            fulfillment: dto.fulfillment,
            tableNumber: cleanTableNumber,
            deliveryAddress: cleanDeliveryAddress,
            customerNote: dto.customerNote,
            locationId: dto.locationId,
            // El canal ya se resolvió arriba (effectiveMode) — lo persistimos
            // como discriminator. PICKUP queda como null porque puede venir
            // de cualquiera de los dos menús sin ambigüedad.
            mode: effectiveMode,
            events: {
              create: { type: 'CREATED', metadata: { source: 'public' } },
            },
          },
        });
        break;
      } catch (e: any) {
        attempts += 1;
        if (e?.code === 'P2002' && attempts < 3) {
          code = codeGen();
          continue;
        }
        throw e;
      }
    }

    // Decrementar stock + auto-deshabilitar productos agotados (best-effort)
    await this.decrementStock(items as any[]).catch(() => null);

    // Sede asignada (ruteo por estado): el pedido va al número de esa sede.
    // best-effort — si falla, el link cae al número del negocio.
    const location = order.locationId
      ? await this.prisma.location
          .findFirst({
            where: { id: order.locationId, tenantId: tenant.id },
          })
          .catch(() => null)
      : null;

    // Generar wa.me link al dueño / sede
    const link = this.channels.generateWaMeOwner(tenant, order, customer, location);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { whatsappLink: link },
    });

    // Emit event para automations
    this.automations
      .emit('ORDER_CREATED', {
        tenantId: tenant.id,
        orderId: order.id,
        customerId: customer.id,
        total,
      })
      .catch((e) =>
        this.logger.warn(
          `automations ORDER_CREATED order=${order.id} falló: ${e?.message ?? e}`,
        ),
      );

    await this.prisma.event.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        type: 'order.created',
        payload: { orderId: order.id, total, channel: 'WHATSAPP_LINK' },
      },
    });

    // SMS opcional a empresas de domicilio (solo si fulfillment=DELIVERY
    // y el tenant suscribió el evento 'created').
    this.maybeNotifyDeliveryAlert(tenant.id, order.id, 'created').catch(
      () => null,
    );

    this.broadcast(order.id).catch((e) =>
      this.logger.warn(
        `broadcast createPublic order=${order.id} falló: ${e?.message ?? e}`,
      ),
    );

    // Email transaccional al cliente (best-effort)
    if (customer.email) {
      const trackingUrl = `${process.env.APP_URL ?? 'http://localhost:4848'}/o/${order.code}`;
      // Marca del negocio para el pie del email ("Hecho con {marca}", nunca
      // "Clubify" en marcas blancas).
      const emailBrand = tenant.whiteLabelId
        ? await this.prisma.whiteLabel.findUnique({
            where: { id: tenant.whiteLabelId },
            select: { name: true },
          })
        : null;
      const tpl = orderCreatedTemplate({
        tenant: {
          brandName: tenant.brandName,
          logoUrl: tenant.logoUrl,
          primaryColor: tenant.primaryColor,
          whatsappPhone: tenant.whatsappPhone,
          slug: tenant.slug,
        },
        brand: emailBrand?.name ? { name: emailBrand.name } : null,
        customerName: customer.fullName,
        code: order.code,
        total,
        items: items.map((i) => ({
          name: i.name,
          qty: i.qty,
          lineTotal: i.lineTotal,
        })),
        trackingUrl,
      });
      this.email
        .send({
          to: customer.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        })
        .catch(() => null);
    }

    return {
      ...order,
      whatsappLink: link,
    };
  }

  /**
   * Crear pedido manualmente desde el panel del tenant. Pensado para POS:
   * walk-ins, pedidos por teléfono o registros de ventas pasadas. A diferencia
   * de `createPublic` el cliente DEBE existir (`customerId`) y el tenant
   * elige el status inicial (CONFIRMED es típico — ya está en cocina).
   *
   * Si status es CONFIRMED/READY/DELIVERED, dispara `autoStampOnConfirm` y la
   * automation `ORDER_CONFIRMED` para que el flujo de loyalty funcione igual
   * que en pedidos públicos.
   */
  async createInternal(
    user: AuthUser,
    override: string | undefined,
    dto: {
      customerId: string;
      items: Array<{
        productId: string;
        variantId?: string | null;
        extraIds?: string[];
        qty: number;
        note?: string;
      }>;
      fulfillment?: Fulfillment;
      tableNumber?: string;
      customerNote?: string;
      locationId?: string;
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      paymentMethod?: PaymentMethod;
      /** Monto del delivery sumado al total. null/undefined = no aplica. */
      deliveryAmount?: number | null;
    },
  ) {
    const tid = this.tid(user, override);
    await this.assertTenantActive(tid);
    if (!dto.items?.length) throw new BadRequestException('Carrito vacío');

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer || customer.tenantId !== tid) {
      throw new NotFoundException('Cliente no existe en este negocio');
    }

    // Resolver productos y construir items con precios actuales
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { tenantId: tid, id: { in: productIds } },
      include: { variants: true, extras: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const items: OrderItem[] = [];
    let subtotal = 0;
    for (const i of dto.items) {
      const p = map.get(i.productId);
      if (!p) throw new BadRequestException(`Producto ${i.productId} no existe`);
      let unit = Number(p.basePrice);
      let variantName = '';
      if (i.variantId) {
        const v = p.variants.find((x) => x.id === i.variantId);
        if (!v) throw new BadRequestException('Variante inválida');
        // ABSOLUTE: la variante define el precio propio (reemplaza al base).
        // DELTA (default): suma su priceDelta al base.
        unit =
          p.variantPriceMode === 'ABSOLUTE'
            ? Number(v.priceDelta)
            : unit + Number(v.priceDelta);
        variantName = ` (${v.name})`;
      }
      const extras = (i.extraIds ?? []).map((eid) => {
        const e = p.extras.find((x) => x.id === eid);
        if (!e) throw new BadRequestException('Extra inválido');
        unit += Number(e.price);
        return { id: e.id, name: e.name, price: Number(e.price) };
      });
      const qty = Math.max(1, Math.min(50, i.qty));
      const lineTotal = unit * qty;
      subtotal += lineTotal;
      items.push({
        productId: p.id,
        variantId: i.variantId ?? null,
        extras,
        qty,
        name: p.name + variantName,
        unitPrice: unit,
        lineTotal,
        note: i.note,
      });
    }

    const { discount, applied } = await this.promotions.computeForCart(
      tid,
      subtotal,
      items,
    );
    // Sumar monto de delivery al total si vino. Validamos: si es número
    // y > 0 lo persistimos; null/undefined o <= 0 → no aplica.
    const deliveryAmount =
      typeof dto.deliveryAmount === 'number' && dto.deliveryAmount > 0
        ? Math.round(dto.deliveryAmount * 100) / 100
        : null;
    const total = Math.max(0, subtotal - discount + (deliveryAmount ?? 0));

    let code = codeGen();
    while (await this.prisma.order.findUnique({ where: { code } })) {
      code = codeGen();
    }

    const status = dto.status ?? 'PENDING';
    const paymentStatus = dto.paymentStatus ?? 'NOT_REQUIRED';
    const now = new Date();

    const order = await this.prisma.order.create({
      data: {
        tenantId: tid,
        customerId: customer.id,
        code,
        items: items as any,
        subtotal,
        discount,
        deliveryAmount,
        total,
        appliedPromos: applied as any,
        fulfillment: dto.fulfillment ?? 'PICKUP',
        tableNumber: dto.tableNumber,
        customerNote: dto.customerNote,
        locationId: dto.locationId,
        status,
        paymentStatus: paymentStatus as any,
        paymentMethod: (dto.paymentMethod as any) ?? 'CASH_ON_DELIVERY',
        paidAt: paymentStatus === 'PAID' ? now : null,
        confirmedAt: ['CONFIRMED', 'READY', 'DELIVERED'].includes(status) ? now : null,
        readyAt: ['READY', 'DELIVERED'].includes(status) ? now : null,
        deliveredAt: status === 'DELIVERED' ? now : null,
        events: {
          create: { type: 'CREATED', metadata: { source: 'manual', actorId: user.id } },
        },
      },
    });

    await this.decrementStock(items as any[]).catch(() => null);

    // Si arranca confirmed o más, dispara loyalty + automation igual que público
    if (['CONFIRMED', 'READY', 'DELIVERED'].includes(status)) {
      await this.autoStampOnConfirm(tid, customer.id, order.id).catch(() => null);
      this.automations
        .emit('ORDER_CONFIRMED', {
          tenantId: tid,
          orderId: order.id,
          customerId: customer.id,
          total,
        })
        .catch((e) =>
          this.logger.warn(
            `automations ORDER_CONFIRMED order=${order.id} falló: ${e?.message ?? e}`,
          ),
        );
    }
    if (status === 'DELIVERED') {
      this.automations
        .emit('ORDER_DELIVERED', {
          tenantId: tid,
          orderId: order.id,
          customerId: customer.id,
        })
        .catch((e) =>
          this.logger.warn(
            `automations ORDER_DELIVERED order=${order.id} falló: ${e?.message ?? e}`,
          ),
        );
    }

    await this.prisma.event.create({
      data: {
        tenantId: tid,
        customerId: customer.id,
        type: 'order.created',
        payload: { orderId: order.id, total, channel: 'MANUAL', actorId: user.id },
      },
    });

    this.broadcast(order.id).catch((e) =>
      this.logger.warn(
        `broadcast createInternal order=${order.id} falló: ${e?.message ?? e}`,
      ),
    );

    return order;
  }

  async getPublicByCode(code: string) {
    const o = await this.prisma.order.findUnique({
      where: { code },
      include: {
        tenant: {
          select: {
            brandName: true,
            primaryColor: true,
            logoUrl: true,
            slug: true,
            // Para que la confirmación del pedido muestre el símbolo correcto
            // (ej "Ref." en lugar de "$") según la config del negocio.
            currency: true,
            currencySymbol: true,
            // Marca blanca del negocio: el recibo muestra "Hecho con {marca}".
            whiteLabelId: true,
          },
        },
        customer: { select: { fullName: true, phone: true } },
        // Red de Domicilios (Fase 3A): seguimiento logístico para el cliente.
        delivery: {
          select: {
            status: true,
            courierName: true,
            courierPlate: true,
            etaMinutes: true,
            assignedAt: true,
            pickedUpAt: true,
            onTheWayAt: true,
            deliveredAt: true,
            deliveryCompany: { select: { name: true, whatsapp: true } },
          },
        },
      },
    });
    if (!o) throw new NotFoundException();
    // Marca blanca del negocio (atribución/web/inicial). Nunca Clubify por
    // defecto: legacy sin marca cae al row real `clubify`.
    const b = await this.brand.resolveByWhiteLabelId(o.tenant.whiteLabelId);
    return {
      ...o,
      brand: {
        name: b.name,
        slug: b.slug,
        websiteUrl: b.websiteUrl,
        logoUrl: b.logoUrl,
        iconUrl: b.iconUrl,
        faviconUrl: b.faviconUrl,
        primaryColor: b.primaryColor,
        initial: b.initial,
        attribution: b.attribution,
      },
    };
  }

  /**
   * Endpoint público: el cliente final califica su pedido (1-5 estrellas).
   * Solo se puede calificar UNA vez y solo si el pedido ya está DELIVERED o
   * READY (algunos negocios entregan sin marcar DELIVERED). El comentario es
   * opcional. No requiere auth — basta con saber el código del pedido.
   */
  async ratePublic(code: string, rating: number, comment?: string) {
    const o = await this.prisma.order.findUnique({
      where: { code },
      select: { id: true, tenantId: true, customerId: true, status: true, ratedAt: true },
    });
    if (!o) throw new NotFoundException();
    if (o.ratedAt) {
      throw new BadRequestException('Este pedido ya fue calificado');
    }
    if (o.status !== 'DELIVERED' && o.status !== 'READY') {
      throw new BadRequestException(
        'Solo puedes calificar pedidos entregados o listos',
      );
    }
    const trimmed = (comment ?? '').trim().slice(0, 500) || null;

    const updated = await this.prisma.order.update({
      where: { id: o.id },
      data: {
        rating,
        ratingComment: trimmed,
        ratedAt: new Date(),
      },
    });

    await this.prisma.event.create({
      data: {
        tenantId: o.tenantId,
        customerId: o.customerId,
        type: 'order.rated',
        payload: { orderId: o.id, code, rating, hasComment: !!trimmed },
      },
    });

    this.automations
      .emit('ORDER_RATED', {
        tenantId: o.tenantId,
        orderId: o.id,
        customerId: o.customerId,
        rating,
        hasComment: !!trimmed,
      })
      .catch((e) =>
        this.logger.warn(
          `automations ORDER_RATED order=${o.id} falló: ${e?.message ?? e}`,
        ),
      );

    return { ok: true, rating: updated.rating, ratedAt: updated.ratedAt };
  }

  // ============= privado (panel tenant) =============

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /**
   * Valida que el tenant esté activo antes de mutar pedidos. ACTIVE y TRIAL
   * pasan; SUSPENDED bloquea con ForbiddenException claro para el panel.
   */
  private async assertTenantActive(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    const blocked: TenantStatus[] = ['SUSPENDED'];
    if (blocked.includes(tenant.status)) {
      throw new ForbiddenException(
        'La cuenta no está activa. Reactiva tu suscripción para gestionar pedidos.',
      );
    }
  }

  /** Historial de pedidos con filtros opcionales de servidor: estado, búsqueda
   *  (código / nombre / teléfono del cliente) y rango de fechas (from/to). Lo
   *  usa el panel de Pedidos → pestaña Historial. */
  list(
    user: AuthUser,
    override?: string,
    filters?: { status?: OrderStatus; search?: string; from?: string; to?: string },
  ) {
    const tid = this.tid(user, override);
    const where: any = { tenantId: tid };
    if (filters?.status) where.status = filters.status;
    if (filters?.from || filters?.to) {
      where.createdAt = {};
      if (filters.from) {
        const d = new Date(filters.from);
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (filters.to) {
        const d = new Date(filters.to);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          where.createdAt.lte = d;
        }
      }
    }
    const s = filters?.search?.trim();
    if (s) {
      where.OR = [
        { code: { contains: s, mode: 'insensitive' } },
        { customer: { is: { fullName: { contains: s, mode: 'insensitive' } } } },
        { customer: { is: { phone: { contains: s } } } },
      ];
    }
    // `items` es Json scalar — Prisma lo devuelve siempre sin necesidad de
    // include/select. El frontend lee o.items.length (orders/page.tsx).
    return this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async board(user: AuthUser, override?: string, days = 1) {
    const tid = this.tid(user, override);
    const window = Math.max(1, Math.min(90, days));
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
    // `items` es Json scalar — Prisma lo devuelve siempre sin necesidad de
    // include/select. El frontend lee o.items.length.
    const all = await this.prisma.order.findMany({
      where: {
        tenantId: tid,
        OR: [
          { createdAt: { gte: since } },
          { status: { in: ['PENDING', 'CONFIRMED', 'READY'] } },
        ],
      },
      include: {
        customer: { select: { fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: window > 1 ? 400 : 100,
    });
    const byStatus: Record<OrderStatus, typeof all> = {
      PENDING: [],
      CONFIRMED: [],
      READY: [],
      DELIVERED: [],
      CANCELLED: [],
    };
    for (const o of all) byStatus[o.status].push(o);
    return byStatus;
  }

  async get(user: AuthUser, id: string) {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        events: { orderBy: { createdAt: 'desc' } },
        location: true,
        // Presencia del delivery → el panel gatea el "Chat del domicilio":
        // solo aparece si el pedido tiene un delivery real asignado (negocio en
        // una red de domicilios), no con solo fulfillment=DELIVERY.
        delivery: { select: { status: true } },
      },
    });
    if (!o) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && o.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return o;
  }

  /** Editar los ITEMS de un pedido ya hecho (panel → "Editar pedido").
   *  Re-resuelve productos/precios del tenant (anti-tampering) y recalcula
   *  subtotal/descuento/total. No se puede editar un pedido ENTREGADO/CANCELADO.
   *  Preserva el monto de delivery. Registra un OrderEvent de edición. */
  async updateOrder(
    user: AuthUser,
    id: string,
    dto: {
      items: {
        productId: string;
        variantId?: string;
        extraIds?: string[];
        qty: number;
        note?: string;
      }[];
    },
  ) {
    const o = await this.get(user, id);
    if (o.status === 'CANCELLED' || o.status === 'DELIVERED') {
      throw new BadRequestException(
        'No se puede editar un pedido entregado o cancelado.',
      );
    }
    await this.assertTenantActive(o.tenantId);
    if (!dto.items?.length) {
      throw new BadRequestException('El pedido debe tener al menos un producto.');
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { tenantId: o.tenantId, id: { in: productIds } },
      include: { variants: true, extras: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const items: any[] = [];
    let subtotal = 0;
    for (const i of dto.items) {
      const p = map.get(i.productId);
      if (!p) throw new BadRequestException(`Producto ${i.productId} no disponible`);
      let unit = Number(p.basePrice);
      let variantName = '';
      if (i.variantId) {
        const v = p.variants.find((x) => x.id === i.variantId);
        if (!v) throw new BadRequestException('Variante inválida');
        // ABSOLUTE: la variante define el precio propio (reemplaza al base).
        // DELTA (default): suma su priceDelta al base.
        unit =
          p.variantPriceMode === 'ABSOLUTE'
            ? Number(v.priceDelta)
            : unit + Number(v.priceDelta);
        variantName = ` (${v.name})`;
      }
      const extras = (i.extraIds ?? []).map((eid) => {
        const e = p.extras.find((x) => x.id === eid);
        if (!e) throw new BadRequestException('Extra inválido');
        unit += Number(e.price);
        return { id: e.id, name: e.name, price: Number(e.price) };
      });
      const qty = Math.max(1, Math.min(50, i.qty));
      const lineTotal = unit * qty;
      subtotal += lineTotal;
      items.push({
        productId: p.id,
        variantId: i.variantId ?? null,
        extras,
        qty,
        name: p.name + variantName,
        unitPrice: unit,
        lineTotal,
        note: i.note,
      });
    }

    const { discount, applied } = await this.promotions.computeForCart(
      o.tenantId,
      subtotal,
      items,
    );
    const deliveryAmount = o.deliveryAmount != null ? Number(o.deliveryAmount) : 0;
    const total = Math.max(0, subtotal - discount + deliveryAmount);

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        items: items as any,
        subtotal,
        discount,
        total,
        appliedPromos: applied as any,
      },
    });
    await this.prisma.orderEvent
      .create({
        data: {
          orderId: id,
          type: 'STATUS_CHANGED',
          metadata: { edited: true, by: user.id, newTotal: total, items: items.length },
          actorId: user.id,
        },
      })
      .catch(() => undefined);
    return updated;
  }

  async setStatus(user: AuthUser, id: string, next: OrderStatus) {
    const o = await this.get(user, id);
    if (o.status === next) return o;

    // Bloquear si la cuenta del tenant no está activa. Aplica también a
    // super admin para mantener consistencia con createInternal.
    await this.assertTenantActive(o.tenantId);

    // Máquina de estados: solo transiciones lógicas. DELIVERED y CANCELLED
    // son finales. Super admin puede saltarse para casos de soporte.
    if (user.role !== 'SUPER_ADMIN') {
      const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
        PENDING: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['READY', 'CANCELLED'],
        READY: ['DELIVERED', 'CANCELLED'],
        DELIVERED: [],
        CANCELLED: [],
      };
      if (!VALID_TRANSITIONS[o.status].includes(next)) {
        throw new BadRequestException(
          `Transición inválida: ${o.status} → ${next}`,
        );
      }
    }

    const stamp: Record<string, Date | null> = {};
    if (next === 'CONFIRMED') stamp.confirmedAt = new Date();
    if (next === 'READY') stamp.readyAt = new Date();
    if (next === 'DELIVERED') stamp.deliveredAt = new Date();
    if (next === 'CANCELLED') stamp.cancelledAt = new Date();

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: next, ...stamp },
    });

    await this.prisma.orderEvent.create({
      data: {
        orderId: id,
        type: next === 'CANCELLED' ? 'CANCELLED' : 'STATUS_CHANGED',
        metadata: { from: o.status, to: next },
        actorId: user.id,
      },
    });

    // Si se confirma, intentar auto-sello + automation
    if (next === 'CONFIRMED') {
      await this.autoStampOnConfirm(o.tenantId, o.customerId, o.id).catch(() => null);
      this.automations
        .emit('ORDER_CONFIRMED', {
          tenantId: o.tenantId,
          orderId: id,
          customerId: o.customerId,
          total: Number(o.total),
        })
        .catch((e) =>
          this.logger.warn(
            `automations ORDER_CONFIRMED order=${id} falló: ${e?.message ?? e}`,
          ),
        );
    }
    if (next === 'DELIVERED') {
      this.automations
        .emit('ORDER_DELIVERED', {
          tenantId: o.tenantId,
          orderId: id,
          customerId: o.customerId,
        })
        .catch((e) =>
          this.logger.warn(
            `automations ORDER_DELIVERED order=${id} falló: ${e?.message ?? e}`,
          ),
        );
    }

    await this.prisma.event.create({
      data: {
        tenantId: o.tenantId,
        customerId: o.customerId,
        type: `order.${next.toLowerCase()}`,
        payload: { orderId: id },
      },
    });

    // SMS opcional a empresas de domicilio. Solo aplica si el tenant
    // suscribió este evento — el helper filtra internamente.
    if (
      next === 'CONFIRMED' ||
      next === 'READY' ||
      next === 'DELIVERED'
    ) {
      this.maybeNotifyDeliveryAlert(
        o.tenantId,
        id,
        next.toLowerCase() as 'confirmed' | 'ready' | 'delivered',
      ).catch(() => null);
    }

    // Red de Domicilios (Fase 1): al marcar "listo" creamos el seguimiento
    // logístico (si es pedido de domicilio) y avisamos a la empresa asignada;
    // al entregar/cancelar reflejamos el estado. Best-effort (no rompe el flujo).
    if (next === 'READY') {
      this.delivery.ensureForOrder(id).catch(() => null);
    } else if (next === 'DELIVERED') {
      this.delivery.markDelivered(id).catch(() => null);
    } else if (next === 'CANCELLED') {
      this.delivery.markCancelled(id).catch(() => null);
    }

    this.broadcast(id).catch((e) =>
      this.logger.warn(
        `broadcast setStatus order=${id} falló: ${e?.message ?? e}`,
      ),
    );

    // Emails transaccionales para cambios clave
    if (next === 'CONFIRMED' || next === 'READY') {
      this.sendStatusEmail(o.tenantId, o.customerId, o.code, next).catch(
        () => null,
      );
    }

    return updated;
  }

  /**
   * Marca el pago de un pedido DELIVERY como PAID y devuelve un wa.me al
   * courier (whatsappDeliveryPhone) con los datos del pedido + dirección
   * para despachar. El frontend abre ese link en una pestaña nueva.
   *
   * No envía nada por sí solo: solo deja el link listo. El dueño hace
   * click en "Enviar al courier" en su WhatsApp y confirma manualmente.
   * Esto evita falsos positivos por números mal configurados.
   */
  async acceptDeliveryPayment(user: AuthUser, id: string) {
    const o = await this.get(user, id);
    if (o.fulfillment !== 'DELIVERY') {
      throw new BadRequestException(
        'Esta acción solo aplica a pedidos de domicilio.',
      );
    }
    if (o.status === 'CANCELLED') {
      throw new BadRequestException(
        'No se puede aceptar pago de un pedido cancelado.',
      );
    }
    if (o.paymentStatus === 'PAID') {
      // Idempotencia: si ya está pagado, devolvemos el courier link sin
      // re-marcar ni crear evento duplicado.
      const courierLink = this.channels.generateWaMeCourier(
        (o as any).tenant ?? (await this.prisma.tenant.findUnique({ where: { id: o.tenantId } }))!,
        o as any,
        (o as any).customer,
      );
      return {
        order: o,
        courierLink,
        courierConfigured: !!((o as any).tenant?.whatsappDeliveryPhone),
      };
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        paymentStatus: 'PAID',
        paidAt: o.paidAt ?? new Date(),
      },
      include: { customer: true, tenant: true },
    });

    await this.prisma.orderEvent.create({
      data: {
        orderId: id,
        type: 'PAYMENT',
        metadata: {
          method: 'manual',
          source: 'accept-delivery-payment',
          status: 'PAID',
        },
        actorId: user.id,
      },
    });

    const courierLink = this.channels.generateWaMeCourier(
      updated.tenant,
      updated as any,
      updated.customer,
    );

    this.broadcast(id).catch((e) =>
      this.logger.warn(
        `broadcast acceptDeliveryPayment order=${id} falló: ${e?.message ?? e}`,
      ),
    );

    return {
      order: updated,
      courierLink,
      courierConfigured: !!updated.tenant.whatsappDeliveryPhone,
    };
  }

  private async sendStatusEmail(
    tenantId: string,
    customerId: string,
    code: string,
    next: 'CONFIRMED' | 'READY',
  ) {
    const [tenant, customer] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
      this.prisma.customer.findUnique({ where: { id: customerId } }),
    ]);
    if (!tenant || !customer?.email) return;
    const trackingUrl = `${process.env.APP_URL ?? 'http://localhost:4848'}/o/${code}`;
    const emailBrand = tenant.whiteLabelId
      ? await this.prisma.whiteLabel.findUnique({
          where: { id: tenant.whiteLabelId },
          select: { name: true },
        })
      : null;
    const tplArgs = {
      tenant: {
        brandName: tenant.brandName,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        whatsappPhone: tenant.whatsappPhone,
        slug: tenant.slug,
      },
      brand: emailBrand?.name ? { name: emailBrand.name } : null,
      customerName: customer.fullName,
      code,
      trackingUrl,
    };
    const tpl =
      next === 'CONFIRMED'
        ? orderConfirmedTemplate(tplArgs)
        : orderReadyTemplate(tplArgs);
    await this.email.send({
      to: customer.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }

  /**
   * Suma sello/puntos al cliente automáticamente cuando se confirma un pedido.
   * Itera todas las tarjetas activas del tenant con `autoStampOnOrder = true`
   * para que un negocio pueda tener simultáneamente, por ej., una tarjeta de
   * sellos (cumple compras) y una de puntos (acumula por monto).
   */
  private async autoStampOnConfirm(tenantId: string, customerId: string, orderId: string) {
    const cards = await this.prisma.card.findMany({
      where: {
        tenantId,
        isActive: true,
        autoStampOnOrder: true,
        type: { in: ['STAMPS', 'POINTS'] },
      },
    });
    if (cards.length === 0) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { total: true, fulfillment: true },
    });
    // BUG PDF245: un pedido a DOMICILIO NO debe emitir pase ni sumar sello
    // automáticamente. El cliente ya se creó (en createPublic, SIN pase); si
    // tiene tarjeta, el negocio decide cuándo sellar; si no, no se le inventa
    // un pase. Solo mesa/mostrador/pickup mantienen el auto-sello.
    if (order?.fulfillment === 'DELIVERY') return;
    const orderTotal = Number(order?.total ?? 0);

    for (const card of cards) {
      try {
        await this.applyLoyaltyForCard(card, tenantId, customerId, orderId, orderTotal);
      } catch (e) {
        // Una tarjeta que falle no debe bloquear las demás
        this.logger?.warn?.(`autoStamp falló para card ${card.id}: ${(e as Error).message}`);
      }
    }
  }

  private async applyLoyaltyForCard(
    card: {
      id: string;
      type: 'STAMPS' | 'POINTS' | string;
      stampsRequired: number | null;
      autoStampAmount: number;
      pointsPerCurrency: Prisma.Decimal | null;
      status?: string;
    },
    tenantId: string,
    customerId: string,
    orderId: string,
    orderTotal: number,
  ) {
    let pass = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId: card.id, customerId } },
    });
    if (!pass) {
      // Auto-emitir un pass para que el cliente vea la acumulación al instante.
      // FIX 2026-06-18 (scan VALMONT): el qrToken DEBE ser el token corto
      // `QR-<nanoid>` (igual que passes.service.genQrToken), NO un JWT firmado.
      // El JWT de ~200 chars dejaba el PDF417 del pase tan denso que la cámara
      // no lo podía leer (pantalla negra / scan 400). El token corto es
      // inadivinable y el scanner lo busca por qrToken @unique.
      const { nanoid } = await import('nanoid');
      const serial = `CLB-${nanoid(10).toUpperCase()}`;
      const authToken = nanoid(32);
      pass = await this.prisma.pass.create({
        data: {
          tenantId,
          cardId: card.id,
          customerId,
          serialNumber: serial,
          qrToken: `QR-${nanoid(20)}`,
          authToken,
        },
      });
    }

    if (card.type === 'STAMPS') {
      const amount = card.autoStampAmount ?? 1;
      const required = card.stampsRequired ?? 10;
      const newCount = pass.stampsCount + amount;
      const completed = newCount >= required;

      await this.prisma.$transaction([
        this.prisma.stamp.create({
          data: {
            tenantId,
            passId: pass.id,
            customerId,
            orderId,
            action: 'STAMP',
            amount: new Prisma.Decimal(amount),
            // #18 (2026-06-16): el sello auto-otorgado por un pedido confirmado
            // debe registrar el monto de la compra (total del pedido) para que
            // alimente revenue/ticket promedio en métricas — antes quedaba null
            // y el pedido no sumaba a la facturación de fidelización.
            purchaseAmount:
              orderTotal > 0 ? new Prisma.Decimal(orderTotal) : undefined,
            note: 'Auto por pedido confirmado',
          },
        }),
        this.prisma.pass.update({
          where: { id: pass.id },
          data: {
            stampsCount: newCount,
            lastActivityAt: new Date(),
            status: completed ? 'COMPLETED' : pass.status,
          },
        }),
      ]);

      this.wallet.pushPassUpdate(pass.id).catch(() => null);

      if (completed) {
        this.automations.emit('PASS_COMPLETED', {
          tenantId,
          passId: pass.id,
          customerId,
          cardId: card.id,
        }).catch(() => null);
      }
      return;
    }

    if (card.type === 'POINTS') {
      // Default: 1 punto por cada $1.000 (= 0.001) si no se configuró nada.
      const ratio = Number(card.pointsPerCurrency ?? 0.001);
      if (ratio <= 0 || orderTotal <= 0) return;
      const earned = Math.floor(orderTotal * ratio);
      if (earned <= 0) return;
      const newBalance = Number(pass.pointsBalance) + earned;

      await this.prisma.$transaction([
        this.prisma.stamp.create({
          data: {
            tenantId,
            passId: pass.id,
            customerId,
            orderId,
            action: 'POINTS_ADD',
            amount: new Prisma.Decimal(earned),
            // #18 (2026-06-16): registrar el monto del pedido también en cards
            // de puntos (orderTotal ya es > 0 por el guard de arriba) para que
            // el pedido sume a la facturación/ticket promedio.
            purchaseAmount:
              orderTotal > 0 ? new Prisma.Decimal(orderTotal) : undefined,
            note: `Auto +${earned} pts por pedido (×${ratio} pts/$)`,
          },
        }),
        this.prisma.pass.update({
          where: { id: pass.id },
          data: {
            pointsBalance: new Prisma.Decimal(newBalance),
            lastActivityAt: new Date(),
          },
        }),
      ]);

      this.wallet.pushPassUpdate(pass.id).catch(() => null);
    }
  }

  /**
   * Decrementa stock de cada producto pedido. Solo afecta a productos con
   * `stock` no-null (con tracking de inventario activo). Si llega a 0,
   * marca el producto como `isAvailable: false`.
   */
  private async decrementStock(items: Array<{ productId: string; qty: number }>) {
    if (!items || items.length === 0) return;
    // Agrupar cantidades por productId
    const totals = new Map<string, number>();
    for (const it of items) {
      totals.set(it.productId, (totals.get(it.productId) ?? 0) + (it.qty ?? 0));
    }
    for (const [productId, qty] of totals) {
      try {
        const p = await this.prisma.product.findUnique({
          where: { id: productId },
          select: { id: true, stock: true },
        });
        if (!p || p.stock === null || p.stock === undefined) continue;
        const next = Math.max(0, p.stock - qty);
        await this.prisma.product.update({
          where: { id: productId },
          data: {
            stock: next,
            isAvailable: next > 0 ? undefined : false,
          },
        });
      } catch {
        /* noop */
      }
    }
  }
}
