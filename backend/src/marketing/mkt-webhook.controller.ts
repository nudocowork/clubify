import { Body, Controller, Logger, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktActionService } from './mkt-action.service';
import { MktEngineService } from './mkt-engine.service';
import { MktContactService } from './mkt-contact.service';
import { detectKind, extractRefs, isInteraction } from './webhook.util';

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
  ) {}

  @Public()
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
      const { messageId, email } = extractRefs(body);
      this.log.log(`inbound slug=${slug} kind=${kind} msg=${messageId ?? '—'} email=${email ?? '—'}`);

      // Sella el evento en su envío (por messageId; respaldo por email).
      const { contactId } = await this.actions.stampEvent({
        whiteLabelId: wl.id,
        messageId,
        email,
        kind,
      });

      // Baja: detiene todo para ese contacto.
      if (kind === 'unsubscribe') {
        const cid = contactId ?? (await this.contactIdByEmail(wl.id, email));
        if (cid) await this.contacts.setOptOut(wl.id, cid, true).catch(() => {});
        return { ok: true };
      }

      // Solo interacción reanuda wait_reply + dispara el trigger email_reply.
      if (isInteraction(kind)) {
        const cid = contactId ?? (await this.contactIdByEmail(wl.id, email));
        if (cid) await this.engine.onContactInteraction(cid, wl.id);
      }
      return { ok: true };
    } catch (e) {
      this.log.warn(`inbound falló: ${(e as Error).message}`);
      return { ok: true };
    }
  }

  private async contactIdByEmail(whiteLabelId: string, email?: string): Promise<string | null> {
    if (!email) return null;
    const c = await this.prisma.mktContact.findFirst({
      where: { whiteLabelId, email, deleted: false },
      select: { id: true },
    });
    return c?.id ?? null;
  }
}
