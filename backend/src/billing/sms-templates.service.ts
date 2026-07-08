import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  SMS_TEMPLATES,
  interpolateSms,
  SmsTemplateDef,
} from './sms-templates';

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
   * Renderiza el texto final de una plantilla (override o default) con sus
   * variables interpoladas. Lo usan billing/hotmart/stripe al enviar.
   *
   * `tenantId` (opcional): resuelve la var {platform} = nombre de la MARCA del
   * negocio (Sellea/Clubify) para el prefijo de los SMS de cobro. Sin tenantId
   * (o negocio sin marca) cae a "Clubify". Esto evita que un negocio de una
   * marca blanca reciba SMS que digan "Clubify".
   */
  async render(
    id: string,
    vars: Record<string, string>,
    tenantId?: string,
  ): Promise<string> {
    const def = SMS_TEMPLATES.find((t) => t.id === id);
    if (!def) return '';
    const row = await this.prisma.setting.findUnique({
      where: { key: this.key(id) },
    });
    const tpl = row?.value?.trim() || def.default;
    const merged = { ...vars };
    if (!('platform' in merged)) {
      merged.platform = await this.resolvePlatform(tenantId);
    }
    return interpolateSms(tpl, merged);
  }

  /** Nombre de la marca del negocio para el prefijo {platform}. */
  private async resolvePlatform(tenantId?: string): Promise<string> {
    if (!tenantId) return 'Clubify';
    const t = await this.prisma.tenant
      .findUnique({
        where: { id: tenantId },
        select: { whiteLabel: { select: { name: true } } },
      })
      .catch(() => null);
    return t?.whiteLabel?.name?.trim() || 'Clubify';
  }
}
