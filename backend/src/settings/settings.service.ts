import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export type BrandingSettings = {
  appLogoUrl: string | null;
  faviconUrl: string | null;
  supportWhatsapp: string | null;
  // Popup de bienvenida que se muestra al dueño la primera vez que entra
  // al panel después de comprar el servicio.
  welcomePopupImageUrl: string | null;
  welcomePopupEnabled: boolean;
};

const KEYS = {
  appLogoUrl: 'branding.appLogoUrl',
  faviconUrl: 'branding.faviconUrl',
  supportWhatsapp: 'support.whatsappPhone',
  welcomePopupImageUrl: 'welcomePopup.imageUrl',
  welcomePopupEnabled: 'welcomePopup.enabled',
} as const;

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getBranding(): Promise<BrandingSettings> {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [
            KEYS.appLogoUrl,
            KEYS.faviconUrl,
            KEYS.supportWhatsapp,
            KEYS.welcomePopupImageUrl,
            KEYS.welcomePopupEnabled,
          ],
        },
      },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const norm = (v: string | undefined) => {
      if (!v) return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    const enabledRaw = map.get(KEYS.welcomePopupEnabled);
    return {
      appLogoUrl: norm(map.get(KEYS.appLogoUrl)),
      faviconUrl: norm(map.get(KEYS.faviconUrl)),
      supportWhatsapp: norm(map.get(KEYS.supportWhatsapp)),
      welcomePopupImageUrl: norm(map.get(KEYS.welcomePopupImageUrl)),
      // default true si nunca se seteó
      welcomePopupEnabled: enabledRaw === undefined ? true : enabledRaw !== 'false',
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
    if (data.welcomePopupImageUrl !== undefined) {
      ops.push(this.upsert(KEYS.welcomePopupImageUrl, data.welcomePopupImageUrl ?? ''));
    }
    if (data.welcomePopupEnabled !== undefined) {
      ops.push(
        this.upsert(KEYS.welcomePopupEnabled, data.welcomePopupEnabled ? 'true' : 'false'),
      );
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
