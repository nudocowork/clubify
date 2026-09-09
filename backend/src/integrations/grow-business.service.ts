import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from './brand-sms-creds.util';

/**
 * Integración con el proveedor externo de SMS "Grow Business" (provider real
 * por debajo: GoHighLevel API). El nombre "Grow Business" es lo único que se
 * expone al usuario final — ni en logs ni UI debe aparecer "GHL" o
 * "GoHighLevel". Cada tenant lo conecta el SUPER_ADMIN con su locationId +
 * apiKey específicos del sub-account.
 */
/**
 * De dónde viene un envío. Todo opcional: el historial se escribe igual sin
 * contexto (canal, destino y subcuenta siempre se conocen), y el contexto se
 * fue enhebrando desde los llamadores que sí lo saben.
 */
export type SendContext = {
  tenantId?: string | null;
  whiteLabelId?: string | null;
  /** Id de la plantilla del catálogo: `email_payment_reminder_3d`, `payment_reminder_3d`… */
  templateId?: string | null;
  /** billing | reviews | orders | reservations | marketing | auth | prueba… */
  feature?: string | null;
  /**
   * El destinatario lo eligió quien llamó a una ruta PÚBLICA, y nadie ha
   * comprobado que sea suyo.
   *
   * Lo ponen los sitios donde el teléfono viene en el cuerpo de una petición
   * sin sesión: reservar una cita, apuntarse a una tarjeta. Ahí el envío se
   * puede usar como arma —mandarle mensajes a un tercero desde el remitente
   * del negocio, y a su costa— y encima en bucle: reservar, cancelar, reservar.
   *
   * Los avisos al propio negocio NO llevan esto, y por eso siguen sin tope: un
   * local con veinte pedidos en una hora tiene que recibir veinte avisos.
   */
  destinatarioSinVerificar?: boolean;
};

@Injectable()
export class GrowBusinessService {
  private logger = new Logger('GrowBusiness');
  private readonly API_BASE = 'https://services.leadconnectorhq.com';
  private readonly API_VERSION = '2021-07-28';

  // 2026-08-01: TODO mensaje saliente vía Grow Business arranca con
  // `#switch_unique|1|` para que salga del número de VENTAS (prioridad 1). Se
  // cambió desde |2| (soporte) porque ese WhatsApp presentó problemas de
  // entrega. Tenants con `switchNumber` explícito pueden seguir overrideando —
  // esto es solo el default. (El nombre se conserva por compatibilidad de refs.)
  private readonly DEFAULT_SUPPORT_SWITCH = 1;

  constructor(private prisma: PrismaService) {}

  /**
   * Upsert (find or create) de contacto en Grow Business y devuelve el
   * contactId. El endpoint /conversations/messages requiere contactId
   * desde 2025 (antes aceptaba toNumber directo). Si no existe el
   * contacto, lo crea con el phone como única data.
   *
   * Best-effort: si falla, devuelve null para que el caller decida
   * abortar el SMS sin crashear el flow principal.
   */
  private async upsertContact(
    locationId: string,
    apiKey: string,
    phone: string,
  ): Promise<string | null> {
    try {
      // Normalizamos a E.164 si no viene con + adelante (el endpoint
      // tolera ambas formas pero "phone": "+57..." es lo seguro).
      const phoneE164 = phone.trim().startsWith('+')
        ? phone.trim()
        : `+${phone.replace(/\D/g, '')}`;
      const res = await fetch(`${this.API_BASE}/contacts/upsert`, {
        method: 'POST',
        // FIX 2026-06-16 (review): timeout en llamada externa (LeadConnector)
        // para no colgar el request/worker si el upstream no responde.
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          locationId,
          phone: phoneE164,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `upsertContact failed status=${res.status} body=${text.slice(0, 200)}`,
        );
        return null;
      }
      const data = await res.json().catch(() => null as any);
      // El response puede venir como { contact: {id} } o { id } según versión.
      const id =
        data?.contact?.id ??
        data?.id ??
        data?.contactId ??
        null;
      if (!id) {
        this.logger.warn(
          `upsertContact OK pero sin id en response: ${JSON.stringify(data).slice(0, 200)}`,
        );
        return null;
      }
      return id;
    } catch (e: any) {
      this.logger.warn(`upsertContact threw: ${e?.message ?? e}`);
      return null;
    }
  }

  async getStatus(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        growBusinessLocationId: true,
        growBusinessConnectedAt: true,
        growBusinessSwitchNumber: true,
      },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');
    return {
      connected: !!t.growBusinessLocationId,
      locationId: t.growBusinessLocationId,
      connectedAt: t.growBusinessConnectedAt,
      switchNumber: t.growBusinessSwitchNumber,
    };
  }

  async connect(
    tenantId: string,
    locationId: string,
    apiKey: string,
    switchNumber?: number | null,
  ) {
    if (!locationId?.trim() || !apiKey?.trim()) {
      throw new BadRequestException('Location ID y API key son obligatorios');
    }
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, brandName: true },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        growBusinessLocationId: locationId.trim(),
        growBusinessApiKey: apiKey.trim(),
        growBusinessConnectedAt: new Date(),
        // Solo seteamos switch si llegó. Si vino undefined, respetamos
        // el valor anterior; si llegó null explícito (limpiar), lo
        // borramos.
        ...(switchNumber === undefined
          ? {}
          : { growBusinessSwitchNumber: switchNumber }),
      },
    });
    this.logger.log(`Conectado tenant=${t.brandName} locationId=${locationId}`);
    return { ok: true, connectedAt: new Date() };
  }

  /** Actualiza SOLO el switch number, sin tocar locationId/apiKey. */
  async setSwitchNumber(tenantId: string, switchNumber: number | null) {
    if (switchNumber !== null && (!Number.isInteger(switchNumber) || switchNumber < 1)) {
      throw new BadRequestException('Switch number debe ser un entero ≥ 1');
    }
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { growBusinessSwitchNumber: switchNumber },
    });
    return { ok: true, switchNumber };
  }

  async disconnect(tenantId: string) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        growBusinessLocationId: null,
        growBusinessApiKey: null,
        growBusinessConnectedAt: null,
      },
    });
    return { ok: true };
  }

  /**
   * Llama al endpoint /locations/:id del provider para validar las credenciales.
   * Si responde 200 con datos, la conexión está OK.
   */
  async testConnection(tenantId: string) {
    const creds = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { growBusinessLocationId: true, growBusinessApiKey: true },
    });
    if (!creds?.growBusinessLocationId || !creds.growBusinessApiKey) {
      throw new BadRequestException('Este negocio no está conectado');
    }
    try {
      const res = await fetch(
        `${this.API_BASE}/locations/${creds.growBusinessLocationId}`,
        {
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${creds.growBusinessApiKey}`,
            Version: this.API_VERSION,
            Accept: 'application/json',
          },
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          ok: false,
          status: res.status,
          message:
            res.status === 401
              ? 'API key inválida o sin permisos para esta location'
              : res.status === 404
              ? 'Location ID no encontrado'
              : `Error ${res.status}: ${body.slice(0, 200)}`,
        };
      }
      const data = await res.json().catch(() => null);
      return {
        ok: true,
        locationName: data?.location?.name ?? data?.name ?? null,
      };
    } catch (e: any) {
      return {
        ok: false,
        message: e?.message ?? 'Error de red conectando con el proveedor',
      };
    }
  }

  /**
   * Envía un SMS desde el sub-account del tenant. Devuelve `{ok:true, id}` o
   * `{ok:false, message}`. Used internamente por el motor de mensajes.
   */
  /**
   * Numeros a los que el sistema NO escribe, pase lo que pase.
   *
   * Hay gente que compra varias veces al mes —revendedores, socios— y a la que
   * los avisos automaticos le llegan una y otra vez sin sentido: «recibimos tu
   * pago, activa tu cuenta» a alguien que ya tiene diez cuentas activadas.
   * Tambien sirve para quien pide expresamente que no le escribamos.
   *
   * Se comprueba AQUI y no en cada aviso a proposito: por estos dos metodos
   * pasa todo lo que sale de la plataforma, asi que ninguna via nueva puede
   * saltarselo por olvido. Un filtro puesto en cada sitio es un filtro que
   * algun sitio no tendra.
   *
   * Se guarda en `Setting` («mensajes.numerosBloqueados», array JSON) y no en
   * una tabla: son un punado de numeros y se cambian a mano.
   */
  /** Mensajes por hora a un número que eligió un desconocido. Tres es holgado
   *  para el uso real —reservar y, como mucho, reagendar— y corta el bucle. */
  private static readonly TOPE_SIN_VERIFICAR = 3;

  /**
   * ¿Se ha pasado ya el tope de mensajes a este número en la última hora?
   *
   * Solo se aplica cuando el destinatario lo eligió quien llamó a una ruta
   * pública. Sin esto, `POST /public/service-reservations/:slug/book` era una
   * pasarela de SMS abierta: la respuesta trae el `manageToken`, cancelar
   * libera el hueco y reagendar reenvía la confirmación, así que reservar →
   * cancelar → reservar mandaba un mensaje por vuelta, para siempre, al número
   * que quisiera el atacante y con el remitente del negocio.
   *
   * Se cuenta sobre `MessageLog`, que ya registra todos los envíos, así que no
   * hace falta tabla nueva. Se comparan los últimos 10 dígitos porque el mismo
   * número aparece como «+57 315…», «57315…» o «315…» según de dónde venga.
   */
  private async pasoElTopeSinVerificar(toPhone: string): Promise<boolean> {
    const cola = (toPhone ?? '').replace(/\D/g, '').slice(-10);
    if (!cola) return false;
    try {
      const desde = new Date(Date.now() - 60 * 60 * 1000);
      const enviados = await this.prisma.messageLog.count({
        where: {
          createdAt: { gte: desde },
          status: 'sent',
          toPhone: { endsWith: cola },
        },
      });
      return enviados >= GrowBusinessService.TOPE_SIN_VERIFICAR;
    } catch (e) {
      // Si el conteo falla, se deja pasar: quedarse sin mandar la confirmación
      // de una cita real es peor que un mensaje de más.
      this.logger.warn(`No se pudo comprobar el tope de envíos: ${(e as Error).message}`);
      return false;
    }
  }

  private async estaBloqueado(toPhone: string): Promise<boolean> {
    const digitos = (toPhone ?? '').replace(/\D/g, '');
    if (!digitos) return false;
    try {
      const s = await this.prisma.setting.findUnique({
        where: { key: 'mensajes.numerosBloqueados' },
      });
      if (!s?.value) return false;
      const lista = JSON.parse(s.value) as string[];
      // Se comparan los ULTIMOS 10 digitos: el mismo numero aparece como
      // «+1 786…», «1786…» o «786…» segun de donde venga, y todos son el
      // mismo telefono.
      const cola = digitos.slice(-10);
      return lista.some(
        (n) => String(n).replace(/\D/g, '').slice(-10) === cola,
      );
    } catch {
      // Ante la duda, se manda: perder un aviso legitimo es peor que colar uno
      // a alguien de la lista.
      return false;
    }
  }

  async sendSms(tenantId: string, toPhone: string, body: string) {
    if (await this.estaBloqueado(toPhone)) {
      this.logger.log(`SMS no enviado: ${toPhone} esta en la lista de no molestar`);
      return { ok: false as const, message: 'numero en la lista de no molestar' };
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
        whiteLabel: { select: BRAND_GROW_SELECT },
      },
    });
    // Candidatas en orden de preferencia: creds PROPIAS del negocio > subcuenta
    // GHL de su MARCA blanca (nunca la de Clubify). Se prueban en CASCADA: si la
    // primera falla, se reintenta con la siguiente. Esto auto-cura el caso en
    // que la key propia del tenant quedó VENCIDA frente a la de la marca (misma
    // location) — bug real en negocios white-label — sin re-sincronizar a mano.
    // Un fallo = no se envió nada, así que reintentar no duplica el mensaje.
    // Ver feedback_grow_business_stale_tenant_key_prefers_over_brand.
    const candidates: {
      locationId: string;
      apiKey: string;
      switchNumber: number | null;
    }[] = [];
    if (tenant?.growBusinessLocationId && tenant.growBusinessApiKey) {
      candidates.push({
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      });
    }
    const brand = brandGrowCreds(tenant?.whiteLabel);
    if (
      brand &&
      !candidates.some(
        (c) => c.locationId === brand.locationId && c.apiKey === brand.apiKey,
      )
    ) {
      candidates.push(brand);
    }
    if (!candidates.length) {
      return { ok: false as const, message: 'Negocio no conectado a Grow Business' };
    }
    let last: {
      ok: boolean;
      message?: string;
      status?: number;
      id?: string | null;
    } = {
      ok: false,
      message: 'Grow Business: sin credenciales válidas',
    };
    for (let i = 0; i < candidates.length; i++) {
      last = await this.sendSmsWithCreds(candidates[i], toPhone, body, {
        tenantId,
      });
      if (last.ok) return last;
      if (i < candidates.length - 1) {
        this.logger.warn(
          `sendSms tenant=${tenantId}: creds #${i + 1} fallaron (${('message' in last && last.message) || 'error'}) — reintentando con la siguiente subcuenta`,
        );
      }
    }
    return last;
  }

  /**
   * Envía un SMS usando credenciales explícitas (subcuenta global de
   * GrowBusinessAccount). Usado por features tipo alertas de reseñas
   * cuando el tenant tiene `reviewAlertsAccountId` apuntando a una
   * subcuenta compartida en lugar de credenciales propias.
   */
  async sendSmsWithCreds(
    creds: { locationId: string; apiKey: string; switchNumber?: number | null },
    toPhone: string,
    body: string,
    ctx?: SendContext,
  ) {
    if (await this.estaBloqueado(toPhone)) {
      this.logger.log(
        `SMS no enviado: ${toPhone} esta en la lista de no molestar`,
      );
      return { ok: false as const, message: 'numero en la lista de no molestar' };
    }
    if (ctx?.destinatarioSinVerificar && (await this.pasoElTopeSinVerificar(toPhone))) {
      // No se lanza: la cita o el alta se crean igual. Lo único que no ocurre
      // es el mensaje, que es lo que se estaba usando como arma.
      this.logger.warn(
        `SMS no enviado a ${toPhone}: tope de ${GrowBusinessService.TOPE_SIN_VERIFICAR}/hora ` +
          'para destinatarios sin verificar',
      );
      return { ok: false as const, message: 'tope de envios a este numero' };
    }
    if (!creds.locationId || !creds.apiKey) {
      // Se registra igual: «no salió por falta de credenciales» es justo lo que
      // hay que poder ver en el historial.
      await this.registrarEnvio({
        channel: 'SMS',
        ok: false,
        locationId: creds.locationId || '',
        toPhone,
        body,
        error: 'Credenciales incompletas',
        ctx,
      });
      return { ok: false as const, message: 'Credenciales incompletas' };
    }
    // Switch prefix (Grow Business multi-number).
    //
    // Formato: `#switch_unique|<priority>|<message>`. El backend de GHL/
    // LeadConnector parsea el prefijo y enruta el SMS por el número de la
    // prioridad indicada (cada subcuenta tiene múltiples números con
    // prioridades distintas).
    //
    // 2026-06-06 (item 3 sprint): el default cambió. Antes: si switchNumber
    // era null, NO se agregaba prefijo y el SMS salía del número por defecto
    // (ventas). Ahora: si switchNumber es null, se usa DEFAULT_SUPPORT_SWITCH
    // (2 = soporte) para garantizar que TODOS los mensajes salgan desde
    // soporte salvo override explícito. Tenants/cuentas con switchNumber
    // configurado mantienen su override.
    //
    // Compat: si el caller ya armó el prefijo manualmente (legacy `#Switch<n>\n`
    // o `#switch_unique|<n>|`), respetamos su decisión y no doble-prefixeamos.
    const alreadyHasPrefix =
      /^#switch_unique\|\d+\|/i.test(body) || /^#Switch\d+\s*\n/i.test(body);
    const effectiveSwitch =
      creds.switchNumber != null ? creds.switchNumber : this.DEFAULT_SUPPORT_SWITCH;
    const messageBody = alreadyHasPrefix
      ? body
      : `#switch_unique|${effectiveSwitch}|${body}`;

    // Grow Business / LeadConnector cambió la API: /conversations/messages
    // ya no acepta `toNumber` directo (devuelve 404 "Contact id not given").
    // Hay que hacer upsert del contacto primero y mandar con `contactId`.
    const contactId = await this.upsertContact(
      creds.locationId,
      creds.apiKey,
      toPhone,
    );
    if (!contactId) {
      const message =
        'No se pudo crear/buscar el contacto en Grow Business. Revisa API key, location y formato del teléfono.';
      await this.registrarEnvio({
        channel: 'SMS',
        ok: false,
        locationId: creds.locationId,
        toPhone,
        body,
        error: message,
        ctx,
      });
      return { ok: false as const, message };
    }

    const r = await this.postChannelMessage(
      creds.apiKey,
      contactId,
      'SMS',
      messageBody,
    );
    await this.registrarEnvio({
      channel: 'SMS',
      ok: r.ok,
      locationId: creds.locationId,
      toPhone,
      body,
      providerMessageId: r.ok ? r.id : null,
      error: r.ok ? null : ('message' in r ? r.message : 'error'),
      ctx,
    });
    return r;
  }

  /**
   * Envía un WhatsApp message server-side via Grow Business (F6).
   * Mismo flujo que sendSmsWithCreds (upsert contact + POST messages)
   * pero con `type: 'WhatsApp'`. La subcuenta GB del afiliado debe tener
   * WhatsApp habilitado en LeadConnector — si no, la API devuelve un
   * 422 con mensaje claro y lo propagamos al user.
   */
  async sendWhatsAppWithCreds(
    creds: { locationId: string; apiKey: string },
    toPhone: string,
    body: string,
    ctx?: SendContext,
  ) {
    // Las dos comprobaciones que sí tenía el SMS y aquí faltaban. La de «no
    // molestar» es un fallo que venía de antes: quien pidió no recibir
    // mensajes seguía recibiéndolos por WhatsApp, que para el que los recibe
    // es exactamente lo mismo. Y sin el tope, todo el arreglo del bucle de
    // envíos se rodeaba usando el canal de al lado.
    if (await this.estaBloqueado(toPhone)) {
      this.logger.log(
        `WhatsApp no enviado: ${toPhone} esta en la lista de no molestar`,
      );
      return { ok: false as const, message: 'numero en la lista de no molestar' };
    }
    if (ctx?.destinatarioSinVerificar && (await this.pasoElTopeSinVerificar(toPhone))) {
      this.logger.warn(
        `WhatsApp no enviado a ${toPhone}: tope de ${GrowBusinessService.TOPE_SIN_VERIFICAR}/hora ` +
          'para destinatarios sin verificar',
      );
      return { ok: false as const, message: 'tope de envios a este numero' };
    }
    if (!creds.locationId || !creds.apiKey) {
      await this.registrarEnvio({
        channel: 'WhatsApp',
        ok: false,
        locationId: creds.locationId || '',
        toPhone,
        body,
        error: 'Credenciales incompletas',
        ctx,
      });
      return { ok: false as const, message: 'Credenciales incompletas' };
    }
    const contactId = await this.upsertContact(
      creds.locationId,
      creds.apiKey,
      toPhone,
    );
    if (!contactId) {
      const message =
        'No se pudo crear/buscar el contacto en Grow Business. Revisa API key, location y formato del teléfono.';
      await this.registrarEnvio({
        channel: 'WhatsApp',
        ok: false,
        locationId: creds.locationId,
        toPhone,
        body,
        error: message,
        ctx,
      });
      return { ok: false as const, message };
    }
    const r = await this.postChannelMessage(
      creds.apiKey,
      contactId,
      'WhatsApp',
      body,
    );
    await this.registrarEnvio({
      channel: 'WhatsApp',
      ok: r.ok,
      locationId: creds.locationId,
      toPhone,
      body,
      providerMessageId: r.ok ? r.id : null,
      error: r.ok ? null : ('message' in r ? r.message : 'error'),
      ctx,
    });
    return r;
  }

  /**
   * Upsert de contacto por CORREO (el de SMS usa el teléfono). Mismo endpoint;
   * cambia la llave con la que Grow Business identifica al contacto.
   */
  private async upsertContactByEmail(
    locationId: string,
    apiKey: string,
    email: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(`${this.API_BASE}/contacts/upsert`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ locationId, email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `upsertContactByEmail failed status=${res.status} body=${text.slice(0, 200)}`,
        );
        return null;
      }
      const data = await res.json().catch(() => null as any);
      const id = data?.contact?.id ?? data?.id ?? data?.contactId ?? null;
      if (!id) {
        this.logger.warn(
          `upsertContactByEmail OK pero sin id: ${JSON.stringify(data).slice(0, 200)}`,
        );
        return null;
      }
      return id;
    } catch (e: any) {
      this.logger.warn(`upsertContactByEmail threw: ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * Envía un CORREO por la subcuenta de Grow Business de la marca — el mismo
   * camino que ya usan el SMS y el WhatsApp, con la misma conexión probada.
   *
   * El REMITENTE lo pone la subcuenta: como cada marca tiene la suya, el correo
   * sale con el dominio y la firma de esa marca sin que haya que configurar
   * nada aparte. Por eso NO forzamos `emailFrom`: mandar uno sin verificar en
   * la subcuenta haría rebotar el envío.
   *
   * Nada de prefijo `#switch_unique|n|` — eso enruta números de teléfono y no
   * significa nada en un correo; iría a parar al cuerpo del mensaje.
   */
  async sendEmailWithCreds(
    creds: { locationId: string; apiKey: string },
    toEmail: string,
    subject: string,
    html: string,
    opts?: { text?: string; ctx?: SendContext },
  ) {
    const ctx = opts?.ctx;
    if (!creds.locationId || !creds.apiKey) {
      await this.registrarEnvio({
        channel: 'Email',
        ok: false,
        locationId: creds.locationId || '',
        toEmail,
        subject,
        body: opts?.text,
        error: 'Credenciales incompletas',
        ctx,
      });
      return { ok: false as const, message: 'Credenciales incompletas' };
    }
    const to = (toEmail ?? '').trim().toLowerCase();
    if (!to.includes('@')) {
      await this.registrarEnvio({
        channel: 'Email',
        ok: false,
        locationId: creds.locationId,
        toEmail,
        subject,
        body: opts?.text,
        error: 'Email de destino inválido',
        ctx,
      });
      return { ok: false as const, message: 'Email de destino inválido' };
    }

    const contactId = await this.upsertContactByEmail(
      creds.locationId,
      creds.apiKey,
      to,
    );
    if (!contactId) {
      const message =
        'No se pudo crear/buscar el contacto en Grow Business. Revisa API key, location y el correo.';
      await this.registrarEnvio({
        channel: 'Email',
        ok: false,
        locationId: creds.locationId,
        toEmail: to,
        subject,
        body: opts?.text,
        error: message,
        ctx,
      });
      return { ok: false as const, message };
    }
    // Campos segun el spec oficial de HighLevel (apps/conversations.json):
    // el cuerpo HTML va en `html`, el asunto en `subject`, y el texto plano en
    // `message`. No existe `emailBody` — mandarlo seria basura en el request.
    // `emailFrom` se omite a proposito: sin el, el remitente lo resuelve la
    // subcuenta de la marca, que es justo lo que queremos.
    const sent = await this.postChannelMessage(
      creds.apiKey,
      contactId,
      'Email',
      opts?.text ?? '',
      { subject, html },
    );
    // `contactId` (id del contacto EN EL PROVEEDOR) se expone para que el motor
    // de marketing lo guarde junto a la subcuenta y correlacione los eventos
    // entrantes del webhook. Aditivo: brand-workflows sigue leyendo solo `id`.
    await this.registrarEnvio({
      channel: 'Email',
      ok: sent.ok,
      locationId: creds.locationId,
      toEmail: to,
      subject,
      body: opts?.text,
      providerMessageId: sent.ok ? sent.id : null,
      error: sent.ok ? null : ('message' in sent ? sent.message : 'error'),
      ctx,
    });
    return sent.ok ? { ...sent, contactId } : sent;
  }

  /**
   * Helper interno: POST /conversations/messages con `type` específico.
   * Devuelve mismo shape que las funciones públicas (ok/status/message/id).
   */
  /**
   * Deja constancia de un envío en `MessageLog`.
   *
   * Best-effort de verdad: si esto falla, el mensaje YA salió (o ya falló) y
   * no se puede deshacer. Un problema al registrar nunca puede convertirse en
   * un problema al enviar, ni al revés.
   *
   * Nota: dentro de una sesión en modo marca, el middleware de tenant bloquea
   * las escrituras sin `tenantId` explícito. Por eso los envíos disparados a
   * mano desde el panel pueden quedar sin registrar si el llamador no pasó
   * contexto — se pierde la línea, nunca el mensaje.
   */
  private async registrarEnvio(datos: {
    channel: 'SMS' | 'WhatsApp' | 'Email';
    ok: boolean;
    locationId: string;
    toPhone?: string | null;
    toEmail?: string | null;
    subject?: string | null;
    /** Cuerpo en texto plano. Se recorta acá: el HTML nunca se guarda. */
    body?: string | null;
    providerMessageId?: string | null;
    error?: string | null;
    ctx?: SendContext;
  }): Promise<void> {
    try {
      // Si el llamador no dijo de qué marca es, se deduce del negocio. Sin esto
      // los SMS del cron nacían sin marca, y la lectura los atribuía a Clubify
      // por la regla «null = legacy»: un recordatorio de Acqua Nails (Sellea)
      // apareció en el panel de Clubify. Una fila sin marca es una fuga
      // esperando a pasar.
      let whiteLabelId = datos.ctx?.whiteLabelId ?? null;
      if (!whiteLabelId && datos.ctx?.tenantId) {
        whiteLabelId =
          (
            await this.prisma.tenant.findUnique({
              where: { id: datos.ctx.tenantId },
              select: { whiteLabelId: true },
            })
          )?.whiteLabelId ?? null;
      }
      await this.prisma.messageLog.create({
        data: {
          channel: datos.channel,
          status: datos.ok ? 'sent' : 'failed',
          locationId: datos.locationId || '—',
          tenantId: datos.ctx?.tenantId ?? null,
          whiteLabelId,
          templateId: datos.ctx?.templateId ?? null,
          feature: datos.ctx?.feature ?? null,
          // Solo dígitos, a propósito. El tope por destinatario cuenta con
          // `endsWith` sobre los últimos 10 dígitos, y si aquí se guarda el
          // número tal cual llegó —«315 062 1706», «315-062-1706»— la fila no
          // casa ni consigo misma: el tope contaba CERO y se rodeaba metiendo
          // un espacio. Con dígitos, el mismo teléfono es la misma fila venga
          // como venga. `estaBloqueado` ya comparaba así.
          toPhone: datos.toPhone ? datos.toPhone.replace(/\D/g, '') || null : null,
          toEmail: datos.toEmail ?? null,
          subject: datos.subject?.slice(0, 300) ?? null,
          preview: limpiarCuerpo(datos.body),
          providerMessageId: datos.providerMessageId ?? null,
          error: datos.error ? String(datos.error).slice(0, 500) : null,
        },
      });
    } catch (e: any) {
      this.logger.warn(
        `No se pudo registrar el envío en MessageLog: ${e?.message ?? e}`,
      );
    }
  }

  private async postChannelMessage(
    apiKey: string,
    contactId: string,
    type: 'SMS' | 'WhatsApp' | 'Email',
    message: string,
    extra?: Record<string, unknown>,
  ) {
    try {
      const res = await fetch(`${this.API_BASE}/conversations/messages`, {
        method: 'POST',
        // FIX 2026-06-16 (review): timeout en llamada externa (LeadConnector)
        // para no colgar el request/worker si el upstream no responde.
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ type, contactId, message, ...(extra ?? {}) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false as const,
          status: res.status,
          message: text.slice(0, 200),
        };
      }
      const data = await res.json().catch(() => ({}));
      // `raw` es aditivo: deja normalizar el messageId con formas alternativas
      // (message.id, data.id) sin romper a quien solo lee `id`.
      return { ok: true as const, id: data?.messageId ?? data?.id ?? null, raw: data };
    } catch (e: any) {
      return {
        ok: false as const,
        message: e?.message ?? `Error enviando ${type}`,
      };
    }
  }

}

/** Prefijo de enrutado de Grow Business — ruido para quien lee el historial. */
const PREFIJO_SWITCH = /^#switch_unique\|\d+\||^#Switch\d+\s*\n/i;

/**
 * Texto que se guarda como muestra. Recortado a 300 caracteres a propósito:
 * basta para reconocer qué salió, y evita que el historial engorde como le
 * pasó a `QrPoster`, que llegó a ser el 77% de la base de datos.
 */
function limpiarCuerpo(body?: string | null): string | null {
  const t = (body ?? '').replace(PREFIJO_SWITCH, '').trim();
  if (!t) return null;
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}
