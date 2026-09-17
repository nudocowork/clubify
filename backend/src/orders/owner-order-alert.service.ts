import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { brandAppUrl } from '../email/brand-email-creds.util';
import { lineaDeProductos, origenDelPedido, paraSms } from './aviso-de-pedido';
import { oficinaDelPedido } from './pedido-en-oficina';
import { primerTelefono } from './primer-telefono';
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
 * ENCENDIDO para todos (decisión del dueño, 2026-09-06): que un negocio se
 * entere de sus pedidos pesa más que el saldo que gasta el aviso. Se puede
 * apagar uno a uno desde el panel de super admin.
 *
 * Por eso mismo el texto es CORTO —lo imprescindible y un enlace— en vez del
 * pedido entero: el detalle está en el panel, y un mensaje largo son cinco o
 * seis segmentos de SMS por cada pedido de cada negocio.
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
          // Qué se pidió y desde dónde: es lo que el negocio necesita para
          // reaccionar sin abrir el panel. Ver `texto()`.
          items: true,
          deliveryAddress: true,
          location: { select: { name: true } },
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
          // `domain`/`appDomain` ADEMÁS de las credenciales: el enlace del
          // aviso tiene que ser el del panel DE SU MARCA. Ver `texto()`.
          whiteLabel: {
            select: { ...BRAND_GROW_SELECT, domain: true, appDomain: true },
          },
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

      // A quien se le avisa, en orden. El ultimo escalon es el movil del
      // DUENO: hay negocios dados de alta sin ningun telefono propio, y sin
      // esto se quedaban sin aviso teniendo a una persona detras perfectamente
      // localizable.
      //
      // Con `primerTelefono` y no con `??`: un campo guardado como `''` paraba
      // la cadena. La Gloriosa (`whatsappPhone = ''`) no recibía los pedidos
      // de su sede sin número aunque su `phone` estuviera bien puesto.
      const telefono =
        primerTelefono(
          tenant.ownerOrderAlertsPhone,
          await this.telefonoDeLaSede(order.locationId),
          tenant.whatsappOrdersPhone,
          tenant.whatsappPhone,
          tenant.phone,
        ) ?? (await this.telefonoDelDueno(order.tenantId));
      if (!telefono) {
        this.logger.warn(
          `aviso de pedido ${order.code}: el negocio no tiene teléfono`,
        );
        await this.registrarOmitido(order, 'sin_telefono');
        return;
      }

      const creds = await this.credenciales(tenant);
      if (!creds) {
        this.logger.warn(
          `aviso de pedido ${order.code}: sin credenciales de Grow Business`,
        );
        await this.registrarOmitido(order, 'sin_credenciales');
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

  /**
   * Deja constancia de un aviso que NO salió, y por qué.
   *
   * Antes esos casos hacían `return` sin registrar nada: al negocio que dice
   * «no me llegó el aviso» no había qué contestarle.
   *
   * Va con un tipo PROPIO (`order.owner_alert_skipped`) y no con el del dedup
   * (`order.owner_alert_sent`) a propósito: el dedup busca ese tipo, así que
   * registrar aquí el intento fallido marcaría el pedido como «ya avisado» sin
   * que nadie hubiera recibido nada, y un reintento —con el número ya puesto
   * en Ajustes— no volvería a intentarlo. Un aviso omitido no cuenta como dado.
   */
  private async registrarOmitido(
    order: { id: string; code: string; tenantId: string },
    motivo: 'sin_telefono' | 'sin_credenciales',
  ) {
    await this.prisma.event
      .create({
        data: {
          tenantId: order.tenantId,
          type: 'order.owner_alert_skipped',
          payload: { orderId: order.id, code: order.code, motivo },
        },
      })
      .catch(() => undefined);
  }

  /**
   * El móvil del dueño del negocio.
   *
   * Último recurso, y por eso va el último: el aviso es operativo —lo atiende
   * quien despacha—, no personal. Pero es mejor que se entere el dueño a que
   * no se entere nadie.
   */
  private async telefonoDelDueno(tenantId: string): Promise<string | null> {
    const dueno = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { phone: true },
      orderBy: { createdAt: 'asc' },
    });
    return primerTelefono(dueno?.phone);
  }

  /** El número de pedidos de la SEDE, si el pedido tiene una asignada. */
  private async telefonoDeLaSede(locationId: string | null) {
    if (!locationId) return null;
    const l = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { ordersWhatsappPhone: true, adminPhone: true },
    });
    // Un `ordersWhatsappPhone = ''` no puede tapar el `adminPhone`.
    return primerTelefono(l?.ordersWhatsappPhone, l?.adminPhone);
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
   * Lo justo para reaccionar sin abrir el panel: que entró, de quién, cuánto,
   * DE DÓNDE VIENE, QUÉ SE PIDIÓ y dónde mirar el resto.
   *
   * El origen y los productos se añadieron el 2026-09-16: el aviso decía el
   * total pero no qué había que preparar ni a qué puerta llevarlo, y en un
   * negocio con varias oficinas —Nudo Cowork pide desde «Sala de Juntas»— eso
   * es justo lo que hace falta.
   *
   * Sigue siendo corto a propósito: esto sale por SMS y cada segmento lo paga
   * el negocio en cada pedido, así que se listan pocos productos y el resto se
   * resume. El detalle completo —dirección, notas, extras— está en el panel.
   * Ver `aviso-de-pedido.ts`, donde eso se prueba.
   */
  private texto(
    order: {
      code: string;
      total: unknown;
      fulfillment: string;
      tableNumber: string | null;
      // Opcionales a propósito: un pedido viejo —o una llamada que no los
      // pase— deja el aviso exactamente como era antes, sin huecos raros.
      items?: unknown;
      deliveryAddress?: unknown;
      location?: { name: string | null } | null;
      customer: { fullName: string } | null;
    },
    tenant: {
      currencySymbol: string | null;
      whiteLabel?: { domain?: string | null; appDomain?: string | null } | null;
    },
  ): string {
    const simbolo = tenant.currencySymbol ?? '$';
    const total = Number(order.total).toLocaleString('es-CO');
    const tipo =
      order.fulfillment === 'DELIVERY'
        ? 'Domicilio'
        : order.fulfillment === 'PICKUP'
          ? 'Para llevar'
          : `Mesa ${order.tableNumber ?? ''}`.trim();
    // El nombre pasa por `paraSms` como el resto: «María José» lleva tildes
    // que NO están en GSM-7, y una sola saca el mensaje entero a 16 bits —de
    // 1 segmento a 3—. Pasa en el 9 % de los pedidos reales.
    const cliente = paraSms(order.customer?.fullName?.trim() || 'Cliente');
    // EL ENLACE ES DEL PANEL DE SU MARCA, NUNCA EL DE CLUBIFY.
    //
    // Estaba fijo a `app.soyclubify.com`. WhatsApp pinta la vista previa del
    // dominio, así que a un negocio de Sellea le llegaba su aviso de pedido
    // con una tarjeta verde, el logo de Clubify y «El sistema operativo de tu
    // negocio local». Reportado el 2026-09-11 por Javier.
    //
    // `brandAppUrl` ya existía y su comentario describe este mismo fallo: se
    // arregló en otros mensajes y ESTE se quedó fuera. Si aparece un mensaje
    // nuevo con un enlace al panel, va por aquí.
    const url = `${brandAppUrl(
      tenant.whiteLabel ?? null,
      process.env.APP_URL ?? 'https://app.soyclubify.com',
    )}/app/orders`;
    // Sin emojis: WhatsApp los convierte en rombos por el camino web, y en SMS
    // fuerzan codificación de 16 bits, que reduce el segmento a 67 caracteres.
    // El origen primero y los productos después: lo primero dice a qué puerta
    // llevarlo, lo segundo qué preparar.
    const oficina = oficinaDelPedido(order.deliveryAddress);
    const origen = origenDelPedido({ oficina, sede: order.location });
    const productos = lineaDeProductos(order.items);
    // EN UN PEDIDO DE OFICINA NO SE DICE «Domicilio».
    //
    // Se entrega andando, dentro del coworking: la palabra no aporta y encima
    // despista, porque quien lo lee ya sabe a qué puerta llevarlo en cuanto ve
    // la oficina. Pedido de Javier el 16-09 al ver el mensaje en Nudo. En un
    // domicilio de verdad, en mesa y para llevar sí se queda: ahí distingue.
    // La OFICINA sustituye al tipo; la SEDE no. Una oficina se entrega andando
    // dentro del coworking y «Domicilio» sobra. Pero el 96 % de los pedidos
    // llevan sede —la carta pública la manda aunque el negocio tenga una
    // sola—, y ahí el tipo es lo ÚNICO que distingue si hay que llevarlo o si
    // lo recogen. Poner `origen || tipo` se lo comía en casi todos los pedidos,
    // y encima muchas sedes se llaman por su dirección, así que la línea se
    // leía como la dirección de entrega.
    const segundaLinea = oficina
      ? origen
      : [tipo, origen].filter(Boolean).join('\n');
    const cabecera = [`Nuevo pedido ${order.code}`, segundaLinea]
      .filter(Boolean)
      .join('\n');
    // EN LÍNEAS Y NO TODO SEGUIDO CON GUIONES.
    //
    // El mensaje se leía de un tirón («… - Javier Prueba - $19.000 - Domicilio
    // - Oficina: Marketing.») y había que buscar cada dato dentro de la frase.
    // Los saltos de línea son GSM-7, así que cuestan un carácter cada uno y no
    // cambian la codificación: es la mejora más barata que se podía hacer aquí.
    const cuerpo = [cliente, `${simbolo}${total}`, productos]
      .filter(Boolean)
      .join('\n');
    return [cabecera, cuerpo, `Ver en tu panel:\n${url}`]
      .filter(Boolean)
      .join('\n\n');
  }
}
