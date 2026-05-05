import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export type BrandingSettings = {
  appLogoUrl: string | null;
  faviconUrl: string | null;
};

const KEYS = {
  appLogoUrl: 'branding.appLogoUrl',
  faviconUrl: 'branding.faviconUrl',
} as const;

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getBranding(): Promise<BrandingSettings> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [KEYS.appLogoUrl, KEYS.faviconUrl] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      appLogoUrl: map.get(KEYS.appLogoUrl) ?? null,
      faviconUrl: map.get(KEYS.faviconUrl) ?? null,
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
