import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export type BrandingSettings = {
  appLogoUrl: string | null;
  faviconUrl: string | null;
  supportWhatsapp: string | null;
};

const KEYS = {
  appLogoUrl: 'branding.appLogoUrl',
  faviconUrl: 'branding.faviconUrl',
  supportWhatsapp: 'support.whatsappPhone',
} as const;

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getBranding(): Promise<BrandingSettings> {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: { in: [KEYS.appLogoUrl, KEYS.faviconUrl, KEYS.supportWhatsapp] },
      },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const norm = (v: string | undefined) => {
      if (!v) return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    return {
      appLogoUrl: norm(map.get(KEYS.appLogoUrl)),
      faviconUrl: norm(map.get(KEYS.faviconUrl)),
      supportWhatsapp: norm(map.get(KEYS.supportWhatsapp)),
    };
  }

  async setBranding(data: Partial<BrandingSettings>): Promise<BrandingSettings> {
    const ops: Promise<unknown>[] = [];
    if (data.appLogoUrl !== undefined) {
      ops.push(this.upsert(KEYS.appLogoUrl, data.appLogoUrl ?? ''));
    }
    if (data.faviconUrl !== undefined) {
      ops.push(this.upsert(KEYS.faviconUrl, data.faviconUrl ?? ''));
    }
    if (data.supportWhatsapp !== undefined) {
      ops.push(this.upsert(KEYS.supportWhatsapp, data.supportWhatsapp ?? ''));
    }
    await Promise.all(ops);
    return this.getBranding();
  }

  private upsert(key: string, value: string) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
