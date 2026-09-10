import { Body, Controller, Logger, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktActionService } from './mkt-action.service';
import { MktEngineService } from './mkt-engine.service';
import { MktContactService } from './mkt-contact.service';
import { detectKind, extractBody, extractRefs, isInteraction } from './webhook.util';
import { SalesInboxService } from '../sales-teams/sales-chat.service';
import { phoneKeyOf } from './identity';

/**
 * Webhook público de eventos de correo del proveedor: entregado / abrió / clic /
 * rebote / respuesta. La URL lleva el slug de la marca (difícil de adivinar) y
 * solo sellamos eventos que correlacionan con un envío nuestro por
 * providerMessageId → un evento forjado sin ese id interno no hace nada.
 *
 * Devuelve SIEMPRE 200 (como Stripe/Hotmart) para que el proveedor no reintente.
 * La regla crítica: solo reply/open/click reanudan "esperar respuesta"; un
 * "delivered" NO (llega segundos después del envío).
 *
 * TODO(hardening): verificar la firma del proveedor sobre req.rawBody antes de
 * parsear cuando la subcuenta la emita (LC firma con clave pública).
 */
@Controller('webhooks/email-inbound')
export class MktWebhookController {
  private readonly log = new Logger('MktWebhook');

  constructor(
    private prisma: PrismaService,
    private actions: MktActionService,
    private engine: MktEngineService,
    private contacts: MktContactService,
    private inbox: SalesInboxService,
  ) {}

  // 60/min. Un proveedor de correo real manda ráfagas al abrir una campaña, así
  // que el límite es holgado; lo que corta es el goteo sostenido de bajas
  // forjadas, que a 10/hora durante un día son 240 personas.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post(':slug')
  async inbound(
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Req() _req: Request & { rawBody?: Buffer },
  ) {
    try {
      const wl = await this.prisma.whiteLabel.findUnique({ where: { slug }, select: { id: true } });
      if (!wl) return { ok: true }; // marca desconocida → 200 e ignoramos

      const kind = detectKind(body);
      const { messageId, email, phone } = extractRefs(body);
      this.log.log(
        `inbound slug=${slug} kind=${kind} msg=${messageId ?? '—'} ` +
          `email=${email ?? '—'} tel=${phone ? '✓' : '—'}`,
      );

      // El chat del equipo de ventas. Va ANTES del resto y sin `await` sobre
      // el resultado: guardar la conversación no puede retrasar ni tumbar la
      // reanudación de las automatizaciones, que es para lo que nació esta
      // ruta. El servicio no lanza nunca.
      if (kind === 'reply') {
        void this.inbox.guardarEntrante({
          whiteLabelId: wl.id,
          phone,
          body: extractBody(body),
          providerMessageId: messageId,
        });
      }

      // Sella el evento en su envío (por messageId; respaldo por email).
      const { contactId, correlacionado } = await this.actions.stampEvent({
        whiteLabelId: wl.id,
        messageId,
        email,
        kind,
      });

      // Baja: detiene todo para ese contacto.
      if (kind === 'unsubscribe') {
        const cid =
          contactId ??
          (await this.contactIdByEmail(wl.id, email)) ??
          (await this.contactIdByPhone(wl.id, phone));
        if (!cid) return { ok: true };
        if (!correlacionado && (await this.demasiadasSinCorrelacion(wl.id))) {
          return { ok: true };
        }
        this.avisarSiVaSinCorrelacion('unsubscribe', correlacionado, wl.id, email);
        await this.contacts.setOptOut(wl.id, cid, true).catch(() => {});
        return { ok: true };
      }

      // Solo interacción reanuda wait_reply + dispara el trigger email_reply.
      if (isInteraction(kind)) {
        const cid =
          contactId ??
          (await this.contactIdByEmail(wl.id, email)) ??
          (await this.contactIdByPhone(wl.id, phone));
        if (!cid) return { ok: true };
        if (!correlacionado && (await this.demasiadasSinCorrelacion(wl.id))) {
          return { ok: true };
        }
        this.avisarSiVaSinCorrelacion(kind, correlacionado, wl.id, email);
        await this.engine.onContactInteraction(cid, wl.id);
      }
      return { ok: true };
    } catch (e) {
      this.log.warn(`inbound falló: ${(e as Error).message}`);
      return { ok: true };
    }
  }

  /**
   * Bajas e interacciones seguidas que llegan SIN correlacionar por
   * `providerMessageId`, por marca y hora. Pasado el tope, se ignoran.
   *
   * De dónde sale esto. Este webhook no verifica la firma del proveedor —hay un
   * `TODO(hardening)` desde el principio— y el comentario del archivo decía que
   * daba igual, porque solo se sella lo que correlaciona por `providerMessageId`.
   * **No era cierto en estas dos ramas**: las dos tienen un respaldo
   * `?? contactIdByEmail(...)` que se salta la correlación entera. Con el slug
   * de la marca —que va en la URL, no es secreto— y un correo, cualquiera podía
   * dar de baja a esa persona o fingir que había contestado.
   *
   * Por qué un tope y no quitar el respaldo: **hay bajas legítimas que llegan
   * sin `messageId`**, y perder una baja de verdad no es un fallo técnico, es un
   * problema con la persona que la pidió. Sin poder medir cuántas son, quitarlo
   * a ciegas era el cambio arriesgado. El tope corta el abuso —vaciar una lista
   * a base de bajas— y deja pasar el goteo normal.
   *
   * Lo de fondo sigue siendo verificar la firma sobre `req.rawBody`, que ya se
   * guarda para Stripe. Ver docs/QA-MASTER-SECURITY.md (P1-6).
   */
  private static readonly TOPE_SIN_CORRELACION = 10;

  private async demasiadasSinCorrelacion(whiteLabelId: string): Promise<boolean> {
    const marca = MktWebhookController.sinCorrelacion.get(whiteLabelId);
    const ahora = Date.now();
    if (!marca || marca.hasta < ahora) {
      MktWebhookController.sinCorrelacion.set(whiteLabelId, {
        veces: 1,
        hasta: ahora + 60 * 60 * 1000,
      });
      return false;
    }
    marca.veces += 1;
    if (marca.veces > MktWebhookController.TOPE_SIN_CORRELACION) {
      this.log.warn(
        `Marca ${whiteLabelId}: ${marca.veces} eventos sin correlacionar en una hora. ` +
          'Se ignoran los siguientes. Si esto no es un ataque, revisar por qué el ' +
          'proveedor no manda providerMessageId.',
      );
      return true;
    }
    return false;
  }

  /** En memoria a propósito: es una mitigación, no contabilidad. Si el proceso
   *  reinicia se pierde el conteo, y lo peor que pasa es que el atacante gane
   *  diez intentos más. Una tabla para esto sería peor negocio. */
  private static readonly sinCorrelacion = new Map<string, { veces: number; hasta: number }>();

  /**
   * Deja constancia de cada vez que se usa el respaldo por correo.
   *
   * Es el dato que hoy falta para decidir si se puede quitar: si en un mes no
   * aparece ninguno, el respaldo no lo necesita nadie y se elimina; si aparecen
   * muchos, hay que arreglar la correlación antes de tocarlo.
   */
  private avisarSiVaSinCorrelacion(
    kind: string,
    correlacionado: boolean,
    whiteLabelId: string,
    email?: string,
  ) {
    if (correlacionado) return;
    this.log.warn(
      `RESPALDO_POR_CORREO kind=${kind} marca=${whiteLabelId} email=${email ?? '—'} ` +
        '(no correlacionó por providerMessageId)',
    );
  }

  private async contactIdByEmail(whiteLabelId: string, email?: string): Promise<string | null> {
    if (!email) return null;
    const c = await this.prisma.mktContact.findFirst({
      where: { whiteLabelId, email, deleted: false },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  /**
   * El contacto a partir de su TELÉFONO. Es como se identifica quien responde
   * un SMS: no hay correo por ninguna parte.
   *
   * Busca por `phoneKey` —los últimos 10 dígitos— y no por el número literal,
   * porque el mismo teléfono se escribe de cinco formas distintas según quién
   * lo teclee: con prefijo, sin él, con espacios o con guiones. Es el mismo
   * criterio que usa el resto del módulo (`identity.ts`).
   */
  private async contactIdByPhone(whiteLabelId: string, phone?: string): Promise<string | null> {
    const key = phoneKeyOf(phone);
    if (!key) return null;
    const c = await this.prisma.mktContact.findFirst({
      where: { whiteLabelId, phoneKey: key, deleted: false },
      select: { id: true },
    });
    return c?.id ?? null;
  }
}
