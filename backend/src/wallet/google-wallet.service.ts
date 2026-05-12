import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import * as fs from 'fs';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Google Wallet integration end-to-end.
 *
 * - generateSaveUrl(passId): JWT inline (LoyaltyClass + LoyaltyObject) que el
 *   cliente abre en Android Chrome → "Add to Google Wallet" install one-shot.
 * - pushUpdate(passId): PATCH del LoyaltyObject vía REST API. Necesario para
 *   que el contador de sellos/saldo/visitas se actualice en el wallet del
 *   cliente en Android cuando hay un scan nuevo.
 *
 * Soporta todos los CardType (STAMPS/HYBRID/VISITS/CASHBACK/POINTS/MEMBERSHIP/
 * DISCOUNT/GIFT/COUPON) — el balance/label varía según el tipo.
 */
@Injectable()
export class GoogleWalletService {
  private logger = new Logger(GoogleWalletService.name);
  private cachedSa: { client_email: string; private_key: string } | null = null;

  constructor(private prisma: PrismaService) {}

  private loadServiceAccount(): { client_email: string; private_key: string } | null {
    if (this.cachedSa) return this.cachedSa;
    const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
    if (b64) {
      try {
        const json = Buffer.from(b64, 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        if (parsed.client_email && parsed.private_key) {
          this.cachedSa = parsed;
          return parsed;
        }
      } catch (e) {
        this.logger.warn(`GOOGLE_WALLET_SA_BASE64 inválido: ${(e as Error).message}`);
      }
    }
    const p = process.env.GOOGLE_WALLET_SA_JSON;
    if (p && fs.existsSync(p)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        this.cachedSa = parsed;
        return parsed;
      } catch (e) {
        this.logger.warn(`GOOGLE_WALLET_SA_JSON inválido: ${(e as Error).message}`);
      }
    }
    return null;
  }

  /** Header field equivalente al de Apple — varía por tipo de tarjeta. */
  private buildBalance(pass: any): { balance: { string?: string; int?: number }; label: string } {
    const t = pass.card.type;
    if (t === 'CASHBACK') {
      const v = Math.round(Number(pass.cashbackBalance ?? 0));
      return {
        balance: { string: `$${v.toLocaleString('es-CO')}` },
        label: 'Saldo cashback',
      };
    }
    if (t === 'VISITS') {
      return {
        balance: { string: `${pass.visitsCount ?? 0}/${pass.card.visitsRequired ?? 10}` },
        label: 'Visitas',
      };
    }
    if (t === 'POINTS') {
      return {
        balance: { int: Math.round(Number(pass.pointsBalance ?? 0)) },
        label: 'Puntos',
      };
    }
    if (t === 'MEMBERSHIP') {
      return {
        balance: { string: pass.currentTier || 'Miembro' },
        label: 'Nivel',
      };
    }
    if (t === 'DISCOUNT') {
      return {
        balance: { string: `${pass.card.discountPercent ?? 10}%` },
        label: 'Descuento',
      };
    }
    return {
      balance: { string: `${pass.stampsCount}/${pass.card.stampsRequired ?? 10}` },
      label: 'Sellos',
    };
  }

  /** Construye el LoyaltyClass para inline JWT o REST API. */
  private buildClass(pass: any, classId: string, logoUri: string) {
    const card = pass.card;
    return {
      id: classId,
      issuerName: pass.tenant.brandName,
      programName: card.name,
      programLogo: {
        sourceUri: { uri: logoUri },
        contentDescription: {
          defaultValue: { language: 'es', value: pass.tenant.brandName },
        },
      },
      hexBackgroundColor: card.primaryColor || '#5B5EEE',
      heroImage: card.heroImageUrl
        ? {
            sourceUri: { uri: card.heroImageUrl },
            contentDescription: {
              defaultValue: { language: 'es', value: card.name },
            },
          }
        : undefined,
      reviewStatus: 'UNDER_REVIEW',
    };
  }

  /** Construye el LoyaltyObject para inline JWT o REST API. */
  private buildObject(pass: any, classId: string, objectId: string) {
    const card = pass.card;
    const balance = this.buildBalance(pass);

    // textModulesData: equivalente a backFields del .pkpass.
    // RECOMPENSA y CLIENTE arriba para que aparezcan prominentes (Google
    // Wallet renderiza los textModulesData en orden bajo el header).
    const textModules: Array<{ id: string; header: string; body: string }> = [];
    if (card.rewardText) {
      textModules.push({
        id: 'reward',
        header: 'RECOMPENSA',
        body: card.rewardText,
      });
    }
    if (pass.customer?.fullName) {
      textModules.push({
        id: 'customer',
        header: 'CLIENTE',
        body: pass.customer.fullName,
      });
    }
    if (card.howToEarnText) {
      textModules.push({
        id: 'how-to-earn',
        header: 'Cómo ganar',
        body: card.howToEarnText,
      });
    }
    if (card.rewardDescText) {
      textModules.push({
        id: 'reward-desc',
        header: 'Detalles',
        body: card.rewardDescText,
      });
    }
    if (card.businessName) {
      textModules.push({
        id: 'business',
        header: 'Negocio',
        body: card.businessName,
      });
    }
    if (card.terms && card.termsEnabled !== false) {
      textModules.push({
        id: 'terms',
        header: 'Términos y condiciones',
        body: card.terms,
      });
    }

    // imageModulesData: Google Wallet renderiza una imagen prominente bajo
    // el header. Para tarjetas tipo STAMPS/HYBRID/VISITS, servimos la
    // misma grilla de sellos que en el strip de Apple Wallet. Cache-bust
    // con lastActivityAt → Google re-fetchea cuando el cliente suma sellos.
    const imageModules: Array<{
      id: string;
      mainImage: {
        sourceUri: { uri: string };
        contentDescription: { defaultValue: { language: string; value: string } };
      };
    }> = [];
    const t = card.type;
    if (t === 'STAMPS' || t === 'HYBRID' || t === 'VISITS') {
      const apiUrl =
        process.env.API_URL || 'https://api.soyclubify.com';
      const cacheBust = pass.lastActivityAt
        ? new Date(pass.lastActivityAt).getTime()
        : Date.now();
      imageModules.push({
        id: 'strip',
        mainImage: {
          sourceUri: {
            uri: `${apiUrl}/api/passes/${pass.id}/strip.png?v=${cacheBust}`,
          },
          contentDescription: {
            defaultValue: { language: 'es', value: 'Sellos' },
          },
        },
      });
    }

    // linksModulesData: enlaces tappeables en el reverso del pase.
    const linksList: Array<{ id: string; uri: string; description: string }> = [];
    const activeLinks = (card.activeLinks as any[]) ?? [];
    for (let i = 0; i < activeLinks.length; i++) {
      const l = activeLinks[i];
      if (!l?.url) continue;
      let uri = l.url;
      if (l.type === 'PHONE') uri = `tel:${l.url.replace(/[^\d+]/g, '')}`;
      else if (l.type === 'EMAIL') uri = `mailto:${l.url}`;
      else if (l.type === 'ADDRESS')
        uri = `https://maps.google.com/?q=${encodeURIComponent(l.url)}`;
      linksList.push({
        id: `link-${i}`,
        uri,
        description: l.label || l.url,
      });
    }

    return {
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountName: pass.customer.fullName,
      accountId: pass.customer.id.replace(/[^a-zA-Z0-9._]/g, '_'),
      loyaltyPoints: balance,
      barcode: {
        type: 'PDF_417',
        value: pass.serialNumber,
        alternateText: pass.serialNumber,
      },
      hexBackgroundColor: card.primaryColor || '#5B5EEE',
      textModulesData: textModules.length > 0 ? textModules : undefined,
      imageModulesData: imageModules.length > 0 ? imageModules : undefined,
      linksModuleData:
        linksList.length > 0 ? { uris: linksList } : undefined,
    };
  }

  private buildIds(pass: any) {
    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
    if (!issuerId) return null;
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9._]/g, '_');
    return {
      issuerId,
      classId: `${issuerId}.card_${safe(pass.cardId)}`,
      objectId: `${issuerId}.pass_${safe(pass.id)}`,
    };
  }

  private resolveLogoUri(pass: any): string {
    const publicBase =
      process.env.PUBLIC_LOGO_BASE_URL ||
      (process.env.APP_URL && !process.env.APP_URL.includes('localhost')
        ? process.env.APP_URL
        : 'https://soyclubify.com');
    return (
      pass.tenant.walletLogoUrl ||
      pass.tenant.logoUrl ||
      `${publicBase}/icons/icon-512.png`
    );
  }

  async generateSaveUrl(passId: string): Promise<string> {
    const pass = await this.prisma.pass.findUnique({
      where: { id: passId },
      include: { card: true, tenant: true, customer: true },
    });
    if (!pass) throw new NotFoundException('Pass');

    const sa = this.loadServiceAccount();
    const ids = this.buildIds(pass);
    if (!sa || !ids) {
      this.logger.warn('Google Wallet not configured; returning mock URL');
      return `https://pay.google.com/gp/v/save/MOCK_${passId}`;
    }

    const logoUri = this.resolveLogoUri(pass);
    const loyaltyClass = this.buildClass(pass, ids.classId, logoUri);
    const loyaltyObject = this.buildObject(pass, ids.classId, ids.objectId);

    // Inline payload — Google crea LoyaltyClass on-the-fly al primer save.
    // Para producción real conviene pre-crear vía REST (más eficiente) pero
    // el inline funciona out-of-the-box sin setup adicional.
    const claims = {
      iss: sa.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: {
        loyaltyClasses: [loyaltyClass],
        loyaltyObjects: [loyaltyObject],
      },
    };
    const token = sign(claims, sa.private_key, { algorithm: 'RS256' });
    const url = `https://pay.google.com/gp/v/save/${token}`;

    await this.prisma.pass.update({
      where: { id: passId },
      data: { googleObjectId: ids.objectId },
    });
    return url;
  }

  /**
   * PATCH al LoyaltyObject vía REST API — propaga sellos/saldo/visitas/tier
   * al wallet del cliente en Android cuando hay un scan nuevo.
   *
   * Solo corre si el pass tiene googleObjectId seteado (o sea, el cliente
   * ya hizo "Save to Google Wallet" antes). Sino skipea silenciosamente.
   */
  /**
   * GET del LoyaltyObject en Google Wallet — para diagnóstico admin.
   * Devuelve el objeto crudo o un error.
   */
  async getObjectRaw(objectId: string): Promise<any> {
    const sa = this.loadServiceAccount();
    if (!sa) return { error: 'not_configured' };
    try {
      const { google } = await import('googleapis');
      const auth = new google.auth.JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
      });
      const wallet = google.walletobjects({ version: 'v1', auth });
      const r = await wallet.loyaltyobject.get({ resourceId: objectId });
      return r.data;
    } catch (e: any) {
      const code = e?.code || e?.response?.status;
      return { error: `google_api_${code}`, message: e?.message ?? String(e) };
    }
  }

  async pushUpdate(
    passId: string,
  ): Promise<{ ok: boolean; status: string; error?: string }> {
    const pass = await this.prisma.pass.findUnique({
      where: { id: passId },
      include: { card: true, tenant: true, customer: true },
    });
    if (!pass) return { ok: false, status: 'pass_not_found' };
    if (!pass.googleObjectId)
      return { ok: false, status: 'not_saved_to_google_wallet' };

    const sa = this.loadServiceAccount();
    const ids = this.buildIds(pass);
    if (!sa || !ids) {
      this.logger.warn('Google Wallet PATCH skipped — SA/issuer no configurado');
      return { ok: false, status: 'not_configured' };
    }

    try {
      const { google } = await import('googleapis');
      const auth = new google.auth.JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
      });
      const wallet = google.walletobjects({ version: 'v1', auth });

      // PATCH del objeto completo para que cambios visuales (textModules,
      // imageModules con strip de sellos actual) se propaguen al pase
      // instalado, no sólo los puntos.
      const objectBody = this.buildObject(pass, ids.classId, ids.objectId);
      await wallet.loyaltyobject.patch({
        resourceId: pass.googleObjectId,
        requestBody: {
          ...objectBody,
          state: pass.status === 'REVOKED' ? 'INACTIVE' : 'ACTIVE',
        } as any,
      });
      this.logger.log(`Google Wallet patched: ${pass.googleObjectId}`);
      return { ok: true, status: 'patched' };
    } catch (e: any) {
      const code = e?.code || e?.response?.status;
      if (code === 404) {
        this.logger.warn(
          `Google Wallet object ${pass.googleObjectId} not found — cliente no saveó`,
        );
        return { ok: false, status: 'object_not_found' };
      }
      if (code === 403) {
        this.logger.error(
          `Google Wallet API deshabilitada en el proyecto. Habilitar en console.developers.google.com`,
        );
        return {
          ok: false,
          status: 'api_disabled',
          error: 'Habilita la Google Wallet API en Google Cloud',
        };
      }
      this.logger.error(
        `Google Wallet PATCH failed (${code}): ${e?.message ?? e}`,
      );
      return { ok: false, status: 'error', error: `${code}: ${e?.message ?? e}` };
    }
  }
}
