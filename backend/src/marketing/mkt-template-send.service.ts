import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktProviderService } from './provider/mkt-provider.service';
import { htmlToText, resolveMerge } from './mkt-workflow.util';

// ── Envío de una plantilla a contactos seleccionados ────────────────────────
// Envío puntual (no automatización): el usuario elige contactos en la galería
// y manda la plantilla. Cada correo sale por la subcuenta de la marca vía
// MktProviderService, con contexto para el historial MessageLog.

/**
 * Tope de contactos por llamada. Un envío masivo accidental no se puede
 * deshacer, así que el lote se mantiene corto: para más destinatarios el
 * frontend pagina en tandas y el usuario confirma cada una. Además el envío es
 * secuencial contra el proveedor (~0,5 s por correo): 50 cabe holgado en el
 * timeout del request; cientos no.
 */
export const MAX_SEND_PER_CALL = 50;

export type SendReport = {
  ok: boolean;
  /** Contactos únicos solicitados (tras deduplicar ids repetidos). */
  requested: number;
  sent: number;
  /** Omitidos con motivo (baja, sin correo, no encontrado…) — NO son errores. */
  skipped: { contactId: string; reason: string }[];
  failed: { contactId: string; error: string }[];
};

@Injectable()
export class MktTemplateSendService {
  constructor(
    private prisma: PrismaService,
    private provider: MktProviderService,
  ) {}

  async sendToContacts(
    whiteLabelId: string,
    templateId: string,
    subject: string,
    contactIds: string[],
  ): Promise<SendReport> {
    const ids = [...new Set((contactIds ?? []).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('No hay contactos seleccionados.');
    if (ids.length > MAX_SEND_PER_CALL) {
      throw new BadRequestException(
        `Máximo ${MAX_SEND_PER_CALL} contactos por envío. Divide la lista en tandas: un envío masivo no se puede deshacer.`,
      );
    }

    // Propia o de fábrica: enviar no modifica la plantilla, así que las de
    // fábrica también se pueden mandar tal cual (editarla sí exige duplicar).
    const template = await this.prisma.mktEmailTemplate.findFirst({
      where: { id: templateId, OR: [{ whiteLabelId }, { isPreset: true }] },
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');

    const html = (template.html ?? '').trim();
    if (!html) {
      throw new BadRequestException(
        'La plantilla aún no tiene contenido para enviar. Ábrela en el editor y guárdala para generar su HTML.',
      );
    }
    const finalSubject = subject?.trim() || template.subject?.trim() || template.name;

    // Nombre de la marca para `{{marca}}`. Se resuelve UNA vez: es el mismo
    // para todo el lote. Si no se pudiera resolver, el token queda vacío — un
    // correo de una marca blanca NO puede acabar diciendo "Clubify".
    const marca =
      (await this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId }, select: { name: true } }))
        ?.name ?? '';

    const report: SendReport = { ok: true, requested: ids.length, sent: 0, skipped: [], failed: [] };
    for (const contactId of ids) {
      // El where con whiteLabelId hace el aislamiento: un id de otra marca
      // simplemente "no existe" aquí y queda como omitido, no filtra datos.
      const contact = await this.prisma.mktContact.findFirst({
        where: { id: contactId, whiteLabelId, deleted: false },
      });
      if (!contact) {
        report.skipped.push({ contactId, reason: 'Contacto no encontrado en esta marca.' });
        continue;
      }
      if (contact.optOut) {
        // Baja = baja: se salta y se informa como omitido, nunca como error.
        report.skipped.push({ contactId, reason: 'Dado de baja: no se le envía.' });
        continue;
      }
      if (!contact.email) {
        report.skipped.push({ contactId, reason: 'El contacto no tiene correo.' });
        continue;
      }
      // Variables del contacto. Sin esto, un `{{nombre}}` en la plantilla le
      // llegaba al cliente escrito tal cual: el asunto y el cuerpo salían con
      // las llaves puestas. Los tokens sin valor se quedan vacíos, nunca con
      // el nombre de otro contacto ni con un marcador visible.
      const ctx: Record<string, string> = {
        nombre: contact.name ?? '',
        email: contact.email,
        telefono: contact.phone ?? '',
        empresa: contact.company ?? '',
        marca,
      };
      const htmlPersonalizado = resolveMerge(html, ctx);
      const res = await this.provider.sendEmail({
        whiteLabelId,
        toEmail: contact.email,
        toName: contact.name ?? undefined,
        subject: resolveMerge(finalSubject, ctx),
        html: htmlPersonalizado,
        // Parte de texto plano: lo que se ve en clientes sin HTML y lo que
        // mira el filtro antispam cuando el correo va solo en HTML.
        text: htmlToText(htmlPersonalizado),
        // Queda en MessageLog: qué salió, por qué marca y desde qué plantilla.
        ctx: { whiteLabelId, feature: 'plantilla-correo', templateId: template.id },
      });
      if (res.ok) {
        report.sent++;
      } else if (res.skipped) {
        report.skipped.push({ contactId, reason: res.error ?? 'Omitido por el proveedor.' });
      } else {
        report.failed.push({ contactId, error: res.error ?? 'Error enviando el correo.' });
      }
    }
    return report;
  }
}
