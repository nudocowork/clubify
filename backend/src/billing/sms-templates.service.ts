import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  SMS_TEMPLATES,
  interpolateSms,
  SmsTemplateDef,
} from './sms-templates';
import {
  brandMsgTplKey,
  brandMsgCatalog,
} from '../integrations/brand-message-templates';

/**
 * Plantillas SMS editables sin redeploy. Los overrides se guardan en la tabla
 * `Setting` con clave `sms.<id>`. Si no hay override, se usa el `default` del
 * registro → editar nada deja el comportamiento idéntico al hardcodeado.
 */
@Injectable()
export class SmsTemplatesService {
  constructor(private prisma: PrismaService) {}

  private key(id: string) {
    return `sms.${id}`;
  }

  /** Lista las plantillas con su texto efectivo (override o default). */
  async getAll() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'sms.' } },
    });
    const overrides = new Map(rows.map((r) => [r.key, r.value]));
    return SMS_TEMPLATES.map((t: SmsTemplateDef) => {
      const override = overrides.get(this.key(t.id));
      return {
        id: t.id,
        label: t.label,
        description: t.description,
        vars: t.vars,
        group: t.group,
        default: t.default,
        text: override ?? t.default,
        isCustom: override != null,
      };
    });
  }

  /** Guarda un override. Texto vacío = volver al default (borra el override). */
  async update(id: string, text: string) {
    const def = SMS_TEMPLATES.find((t) => t.id === id);
    if (!def) throw new NotFoundException('Plantilla SMS no encontrada');
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      await this.prisma.setting.deleteMany({ where: { key: this.key(id) } });
      return { id, text: def.default, isCustom: false };
    }
    await this.prisma.setting.upsert({
      where: { key: this.key(id) },
      update: { value: trimmed },
      create: { key: this.key(id), value: trimmed },
    });
    return { id, text: trimmed, isCustom: true };
  }

  /**
   * Renderiza el texto final de una plantilla con sus variables interpoladas.
   * Lo usan billing/hotmart/stripe al enviar.
   *
   * PRECEDENCIA del texto: override de la MARCA del negocio (`sms.wl.<wlId>.<id>`,
   * editable en Master Admin → Marcas → Automatizaciones) > override GLOBAL
   * (`sms.<id>`, panel Integraciones) > `default` del registro. Si nadie edita,
   * el texto es idéntico al hardcodeado.
   *
   * `tenantId` (opcional): resuelve la marca del negocio → var {platform}
   * (Sellea/Clubify) y el override por marca. Sin tenantId (o negocio sin marca)
   * cae a "Clubify" y solo aplica el override global. Esto evita que un negocio
   * de una marca blanca reciba SMS que digan "Clubify".
   */
  async render(
    id: string,
    vars: Record<string, string>,
    tenantId?: string,
  ): Promise<string> {
    // Busca en el registro de cobro (SMS_TEMPLATES) y, si no está, en el
    // catálogo de marca (admin_*/operativas) — así los mensajes administrativos
    // también se renderizan con {platform} y la precedencia marca>global>default.
    const def =
      SMS_TEMPLATES.find((t) => t.id === id) ??
      brandMsgCatalog().find((t) => t.id === id);
    if (!def) return '';
    const brand = await this.resolveTenantBrand(tenantId);
    const brandRow = brand?.id
      ? await this.prisma.setting.findUnique({
          where: { key: brandMsgTplKey(brand.id, id) },
        })
      : null;
    const globalRow = await this.prisma.setting.findUnique({
      where: { key: this.key(id) },
    });
    const tpl =
      brandRow?.value?.trim() || globalRow?.value?.trim() || def.default;
    const merged = { ...vars };
    if (!('platform' in merged)) {
      merged.platform = brand?.name || 'Clubify';
    }
    return interpolateSms(tpl, merged);
  }

  /** Marca (id + nombre) del negocio, para el override por marca y {platform}. */
  private async resolveTenantBrand(
    tenantId?: string,
  ): Promise<{ id: string; name: string } | null> {
    if (!tenantId) return null;
    const t = await this.prisma.tenant
      .findUnique({
        where: { id: tenantId },
        select: { whiteLabel: { select: { id: true, name: true } } },
      })
      .catch(() => null);
    if (!t?.whiteLabel) return null;
    return { id: t.whiteLabel.id, name: (t.whiteLabel.name || '').trim() };
  }
}
