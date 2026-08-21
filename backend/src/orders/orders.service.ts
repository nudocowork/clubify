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
import { CustomerOrderSmsService } from '../integrations/customer-order-sms.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from '../integrations/brand-sms-creds.util';
import { resolveBrandTemplate } from '../integrations/brand-message-templates';
import {
  customerPaymentLabel,
  isCustomerPaymentMethod,
  normalizeAcceptedPaymentMethods,
} from '../common/customer-payment';
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

// PDF 1256 F3: línea "Pago:" para el aviso al domiciliario/empresa. Combina el
// método declarado por el cliente (efectivo/transferencia/…) con si el pedido
// ya está cobrado online (→ no cobrar) o hay que cobrarlo en la entrega.
// Devuelve string vacío si no hay nada útil (deja el mensaje idéntico al viejo).
// La etiqueta va humanizada («efectivo», no «EFECTIVO»); con OTRO va el texto
// libre del cliente — antes el mensaje decía literalmente «Pago: OTRO».
function courierPayLine(
  method: string | null | undefined,
  other: string | null | undefined,
  paymentStatus: string | null | undefined,
): string {
  const m = customerPaymentLabel(method, other);
  if (paymentStatus === 'PAID') {
    return `💳 Pago: ✅ Pagado online${m ? ` (${m})` : ''} — no cobrar\n`;
  }
  if (m) return `💵 Pago: ${m} — cobrar al cliente\n`;
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
  // Método de pago declarado por el cliente (informativo). PDF 2026-07-25.
  customerPaymentMethod?: string;
  customerPaymentOther?: string;
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
    private customerOrderSms: CustomerOrderSmsService,
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
          // PDF 1256 F3: método de pago + si el domiciliario debe cobrar.
          payLine: courierPayLine(
            order.customerPaymentMethod,
            order.customerPaymentOther,
            order.paymentStatus,
          ),
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
      include: {
        cards: { where: { isActive: true, autoStampOnOrder: true }, take: 1 },
        // theme.paymentMethods = métodos de pago que el negocio acepta.
        // Se valida acá porque el selector filtrado del checkout NO es una
        // validación: un POST directo podría declarar «TARJETA» a un negocio
        // sin datáfono.
        storefront: { select: { theme: true } },
      },
    });
    if (!tenant || tenant.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    if (!dto.items?.length) throw new BadRequestException('Carrito vacío');

    // Método de pago declarado (opcional). Si viene, debe ser uno conocido y
    // estar dentro de los que el negocio acepta. Sin configuración guardada
    // (accepted = null) se aceptan todos — igual que siempre; nadie queda
    // bloqueado por no haber configurado nada.
    if (dto.customerPaymentMethod) {
      if (!isCustomerPaymentMethod(dto.customerPaymentMethod)) {
        throw new BadRequestException('Método de pago no válido');
      }
      const accepted = normalizeAcceptedPaymentMethods(
        (tenant.storefront?.theme as Record<string, unknown> | null)
          ?.paymentMethods,
      );
      if (accepted && !accepted.includes(dto.customerPaymentMethod)) {
        // Puede pasar con una página cacheada de hace unos minutos (el
        // storefront público cachea ~3 min): el mensaje invita a recargar.
        throw new BadRequestException(
          `El negocio no acepta pago con ${customerPaymentLabel(dto.customerPaymentMethod, dto.customerPaymentOther)}. Recarga la página y elige otro método.`,
        );
      }
    }

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
    // PDF1145: el filtro de disponibilidad debe coincidir con el MENÚ que el
    // cliente NAVEGÓ (la RUTA = dto.mode), no con el fulfillment. En la ruta
    // delivery (/d) el cliente pudo elegir Pick Up o Mesa sobre un menú ya
    // filtrado por availableForDelivery; si filtráramos por el fulfillment
    // (DINE_IN → availableForMesa) un producto solo-delivery daría "no
    // disponible" (400). Invariante de seguridad INTACTO: DELIVERY SIEMPRE
    // exige availableForDelivery (bloquea el bypass mode=MESA+fulfillment=DELIVERY).
    const filterMode =
      dto.fulfillment === 'DELIVERY' ? 'DELIVERY' : dto.mode ?? effectiveMode;
    const modeFilter =
      filterMode === 'MESA'
        ? { availableForMesa: true }
        : filterMode === 'DELIVERY'
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
            // Método de pago declarado por el cliente (informativo). Si eligió
            // OTRO guardamos también el texto libre.
            customerPaymentMethod: dto.customerPaymentMethod || null,
            customerPaymentOther:
              dto.customerPaymentMethod === 'OTRO'
                ? dto.customerPaymentOther?.trim() || null
                : null,
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
    // PDF 1256 F3: SMS al CLIENTE "recibimos tu pedido" (opt-in por negocio).
    this.customerOrderSms
      .notify(tenant.id, order.id, 'created')
      .catch(() => null);
    // PDF245 P2: si es domicilio, crea el seguimiento (para que aparezca en el
    // panel de la empresa) y avisa "Hay un nuevo pedido - #X. Revisa el panel".
    this.delivery.onDeliveryOrderCreated(order.id).catch(() => null);

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
   * Si status es CONFIRMED/READY/DELIVERED dispara la automation
   * `ORDER_CONFIRMED`; el sello automático (`autoStampOnDelivered`) solo si
   * nace ya DELIVERED — igual que en pedidos públicos, la fidelización se
   * gana al entregar, no antes.
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

    // Si arranca confirmed o más, dispara la automation igual que público.
    // El sello automático NO: ese va solo si el pedido nace ya ENTREGADO
    // (regla 2026-08-20 — ver autoStampOnDelivered).
    if (['CONFIRMED', 'READY', 'DELIVERED'].includes(status)) {
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
      // Registro de venta pasada (POS): nace entregado → sí lleva su sello.
      await this.autoStampOnDelivered(tid, customer.id, order.id).catch(() => null);
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
    filters?: {
      status?: OrderStatus;
      search?: string;
      from?: string;
      to?: string;
      locationId?: string;
    },
  ) {
    const tid = this.tid(user, override);
    const where: any = { tenantId: tid };
    if (filters?.status) where.status = filters.status;
    // Filtro opcional por sede (tenants multi-sede). Sin locationId = todos.
    if (filters?.locationId) where.locationId = filters.locationId;
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

  async board(user: AuthUser, override?: string, days = 1, locationId?: string) {
    const tid = this.tid(user, override);
    const window = Math.max(1, Math.min(90, days));
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
    // Filtro opcional por sede (tenants multi-sede). Sin locationId = todos.
    const where: any = {
      tenantId: tid,
      OR: [
        { createdAt: { gte: since } },
        { status: { in: ['PENDING', 'CONFIRMED', 'READY'] } },
      ],
    };
    if (locationId) where.locationId = locationId;
    // `items` es Json scalar — Prisma lo devuelve siempre sin necesidad de
    // include/select. El frontend lee o.items.length.
    const all = await this.prisma.order.findMany({
      where,
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
        // Presencia del delivery + empresa → el panel gatea el "Chat del
        // domicilio": solo aparece si el pedido tiene una EMPRESA de domicilios
        // asignada (no solo fulfillment=DELIVERY, ni un delivery huérfano sin
        // empresa). Ver PDF454. deliveryCompanyId null = aún sin asignar.
        delivery: { select: { status: true, deliveryCompanyId: true } },
      },
    });
    if (!o) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && o.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return o;
  }

  /** El negocio registra/edita el método de pago DECLARADO por el cliente
   *  (informativo). No toca paymentStatus ni el gateway online. Si el cliente
   *  no lo completó, el negocio lo puede colocar; también editable. */
  async updateCustomerPayment(
    user: AuthUser,
    id: string,
    dto: {
      customerPaymentMethod?: string | null;
      customerPaymentOther?: string | null;
    },
  ) {
    const o = await this.get(user, id); // valida ownership (tenant/super-admin)
    const method = dto.customerPaymentMethod || null;
    return this.prisma.order.update({
      where: { id: o.id },
      data: {
        customerPaymentMethod: method,
        customerPaymentOther:
          method === 'OTRO' ? dto.customerPaymentOther?.trim() || null : null,
      },
    });
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

    if (next === 'CONFIRMED') {
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
      // Regla de negocio (2026-08-20): el sello automático se otorga SOLO al
      // ENTREGAR, no al confirmar. Antes se daba en CONFIRMED y si el pedido
      // luego se cancelaba, el sello quedaba regalado (pasó en producción:
      // pedidos cancelados con sello vivo). El negocio siempre puede sellar
      // manualmente cuando quiera; esto solo mueve el automático.
      await this.autoStampOnDelivered(o.tenantId, o.customerId, o.id).catch(() => null);
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
    if (next === 'CANCELLED') {
      // Un pedido cancelado no puede dejar fidelización viva. Si este pedido
      // alcanzó a generar sello/puntos automáticos (p. ej. super admin revierte
      // un DELIVERED, o datos históricos del flujo viejo), se compensan con un
      // movimiento inverso — queda rastro completo en Stamp. Best-effort: un
      // fallo acá no debe impedir cancelar el pedido.
      await this.revertAutoLoyaltyOnCancel(o.tenantId, o.id).catch((e) =>
        this.logger.warn(
          `reverso de sellos por cancelación order=${id} falló: ${(e as Error)?.message ?? e}`,
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

    // PDF 1256 F3: SMS al CLIENTE por cambio de estado (opt-in por negocio,
    // OFF por defecto). El servicio filtra internamente por config + evento.
    if (
      next === 'CONFIRMED' ||
      next === 'READY' ||
      next === 'DELIVERED'
    ) {
      this.customerOrderSms
        .notify(
          o.tenantId,
          id,
          next.toLowerCase() as 'confirmed' | 'ready' | 'delivered',
        )
        .catch(() => null);
    }

    // Red de Domicilios (Fase 1): al marcar "listo" creamos el seguimiento
    // logístico (si es pedido de domicilio) y avisamos a la empresa asignada;
    // al entregar/cancelar reflejamos el estado. Best-effort (no rompe el flujo).
    if (next === 'READY') {
      // Asegura el seguimiento (idempotente) y avisa "listo para recoger" a la
      // empresa asignada (o la default). El "nuevo pedido" ya se avisó al crear.
      this.delivery
        .ensureForOrder(id)
        .then(() => this.delivery.notifyCompanyReadyForPickup(id))
        .catch(() => null);
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
   * Suma sello/puntos al cliente automáticamente cuando el pedido se ENTREGA.
   * Itera todas las tarjetas activas del tenant con `autoStampOnOrder = true`
   * para que un negocio pueda tener simultáneamente, por ej., una tarjeta de
   * sellos (cumple compras) y una de puntos (acumula por monto).
   *
   * Regla 2026-08-20: antes se disparaba al CONFIRMAR y un pedido que luego se
   * cancelaba dejaba el sello regalado (ocurrió en producción). Ahora el sello
   * se gana solo en DELIVERED; el negocio conserva el sello manual intacto.
   * OJO: la columna `Card.autoStampOnOrder` conserva su nombre viejo — un
   * rename de columna en producción es una migración aparte.
   */
  private async autoStampOnDelivered(tenantId: string, customerId: string, orderId: string) {
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
    // (Se mantiene aunque ahora se selle en DELIVERED: para domicilio la regla
    // sigue siendo sello manual del negocio, nunca automático.)
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

  /**
   * Sella un pedido a pedido del NEGOCIO (botón «¿Sumas sello?» al marcar
   * entregado un domicilio).
   *
   * Existe porque en domicilio no hay sello automático: «entregado» lo marca
   * quien reparte, y eso no siempre significa que el cliente lo recibió
   * conforme. Pero dejarlo solo a que alguien se acuerde de sellar después
   * hacía que se perdiera. Así que el sistema pregunta y el negocio decide.
   *
   * Usa exactamente la misma ruta que el sello automático (`applyLoyaltyForCard`)
   * para que el resultado sea idéntico: mismo `purchaseAmount`, mismo pase,
   * mismo reverso si luego se cancela.
   */
  async stampOrderManually(
    tenantId: string,
    orderId: string,
  ): Promise<{ stamped: boolean; reason?: string; cards: number }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, customerId: true, total: true, status: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (!order.customerId) {
      return { stamped: false, reason: 'El pedido no tiene cliente asociado.', cards: 0 };
    }
    if (order.status === 'CANCELLED') {
      return { stamped: false, reason: 'El pedido está cancelado.', cards: 0 };
    }

    // Idempotente: si este pedido ya generó un sello vivo, no se dobla. Evita
    // que un doble clic o un reintento regale fidelidad.
    const yaTiene = await this.prisma.stamp.count({
      where: { orderId, action: { in: ['STAMP', 'POINTS_ADD'] } },
    });
    const revertidos = await this.prisma.stamp.count({
      where: { orderId, action: { in: ['STAMP_REMOVE', 'POINTS_DEDUCT'] } },
    });
    if (yaTiene > revertidos) {
      return { stamped: false, reason: 'Este pedido ya tenía su sello.', cards: 0 };
    }

    const cards = await this.prisma.card.findMany({
      where: {
        tenantId,
        isActive: true,
        autoStampOnOrder: true,
        type: { in: ['STAMPS', 'POINTS'] },
      },
    });
    if (!cards.length) {
      return { stamped: false, reason: 'El negocio no tiene tarjeta de sellos activa.', cards: 0 };
    }

    const total = Number(order.total ?? 0);
    let ok = 0;
    for (const card of cards) {
      try {
        await this.applyLoyaltyForCard(card, tenantId, order.customerId, orderId, total);
        ok++;
      } catch (e) {
        this.logger?.warn?.(
          `sello manual falló para card ${card.id}: ${(e as Error).message}`,
        );
      }
    }
    return ok
      ? { stamped: true, cards: ok }
      : { stamped: false, reason: 'No se pudo sellar. Inténtalo de nuevo.', cards: 0 };
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
            // #18 (2026-06-16): el sello auto-otorgado por un pedido debe
            // registrar el monto de la compra (total del pedido) para que
            // alimente revenue/ticket promedio en métricas — antes quedaba null
            // y el pedido no sumaba a la facturación de fidelización.
            purchaseAmount:
              orderTotal > 0 ? new Prisma.Decimal(orderTotal) : undefined,
            note: 'Auto por pedido entregado',
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
   * Compensa la fidelización automática de un pedido que se cancela: por cada
   * STAMP/POINTS_ADD que este pedido generó, crea el movimiento inverso
   * (STAMP_REMOVE/POINTS_DEDUCT, mismo orderId) y ajusta el pase. No se borra
   * nada — el historial en Stamp cuenta la película completa.
   *
   * Solo este servicio crea Stamps con orderId, así que filtrar por orderId
   * garantiza que jamás tocamos sellos dados a mano por el negocio.
   *
   * Con el sello movido a DELIVERED esto es sobre todo una red de seguridad:
   * cubre al super admin revirtiendo un entregado a cancelado y a pedidos del
   * flujo viejo (sello en CONFIRMED) que se cancelen después del despliegue.
   */
  private async revertAutoLoyaltyOnCancel(tenantId: string, orderId: string) {
    const given = await this.prisma.stamp.findMany({
      where: { tenantId, orderId, action: { in: ['STAMP', 'POINTS_ADD'] } },
    });
    if (given.length === 0) return;

    // Idempotencia: si el pedido ya tiene reversos no se resta dos veces
    // (p. ej. super admin que re-cancela tras reabrir para soporte).
    const alreadyReverted = await this.prisma.stamp.count({
      where: {
        tenantId,
        orderId,
        action: { in: ['STAMP_REMOVE', 'POINTS_DEDUCT'] },
      },
    });
    if (alreadyReverted > 0) return;

    for (const s of given) {
      const pass = await this.prisma.pass.findUnique({
        where: { id: s.passId },
      });
      if (!pass) continue;
      const amount = Number(s.amount);

      if (s.action === 'STAMP') {
        const card = await this.prisma.card.findUnique({
          where: { id: pass.cardId },
          select: { stampsRequired: true },
        });
        const required = card?.stampsRequired ?? 10;
        // Piso 0: si el negocio ya restó a mano no dejamos el contador negativo.
        const newCount = Math.max(0, pass.stampsCount - amount);
        await this.prisma.$transaction([
          this.prisma.stamp.create({
            data: {
              tenantId,
              passId: pass.id,
              customerId: s.customerId,
              orderId,
              action: 'STAMP_REMOVE',
              amount: s.amount,
              note: 'Reverso automático: pedido cancelado',
            },
          }),
          // El monto de la compra deja de existir: se anula en el sello
          // original para que ninguna métrica de facturación lo siga sumando.
          // El valor queda documentado en el propio pedido (Order.total).
          this.prisma.stamp.update({
            where: { id: s.id },
            data: { purchaseAmount: null },
          }),
          this.prisma.pass.update({
            where: { id: pass.id },
            data: {
              stampsCount: newCount,
              lastActivityAt: new Date(),
              // Si ESTE sello fue el que completó el cartón, reabrimos el pase.
              // Si el premio ya se canjeó, el canje queda en el historial y el
              // negocio decide caso a caso — no intentamos deshacer un REDEEM.
              status:
                pass.status === 'COMPLETED' && newCount < required
                  ? 'ACTIVE'
                  : pass.status,
            },
          }),
        ]);
      } else {
        // Piso 0: si el cliente ya gastó los puntos no dejamos saldo negativo;
        // preferimos absorber la diferencia a cobrarle deuda por una promo.
        const newBalance = Math.max(0, Number(pass.pointsBalance) - amount);
        await this.prisma.$transaction([
          this.prisma.stamp.create({
            data: {
              tenantId,
              passId: pass.id,
              customerId: s.customerId,
              orderId,
              action: 'POINTS_DEDUCT',
              amount: s.amount,
              note: 'Reverso automático: pedido cancelado',
            },
          }),
          this.prisma.stamp.update({
            where: { id: s.id },
            data: { purchaseAmount: null },
          }),
          this.prisma.pass.update({
            where: { id: pass.id },
            data: {
              pointsBalance: new Prisma.Decimal(newBalance),
              lastActivityAt: new Date(),
            },
          }),
        ]);
      }

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
