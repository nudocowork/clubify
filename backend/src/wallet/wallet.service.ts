import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Genera pases para Apple Wallet (.pkpass) y Google Wallet (save link).
 * En desarrollo, si los certificados no existen, devuelve un buffer mock JSON
 * para no bloquear el flujo. En producción debe estar todo configurado.
 */
@Injectable()
export class WalletService {
  private logger = new Logger(WalletService.name);
  /** Caché de imágenes default cargadas desde disco una sola vez */
  private defaultImages: Record<string, Buffer> | null = null;
  constructor(private prisma: PrismaService) {}

  /**
   * Carga el JSON del Service Account de Google Wallet desde:
   *   1) GOOGLE_WALLET_SA_BASE64 (preferido, portable a Railway)
   *   2) GOOGLE_WALLET_SA_JSON (path al .json en disco — modo dev)
   * Devuelve null si ninguna de las dos está configurada o el contenido es inválido.
   */
  private loadGoogleServiceAccount(): { client_email: string; private_key: string } | null {
    const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
    if (b64) {
      try {
        const json = Buffer.from(b64, 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        if (parsed.client_email && parsed.private_key) return parsed;
        this.logger.warn('GOOGLE_WALLET_SA_BASE64 sin client_email/private_key');
      } catch (e) {
        this.logger.warn(`GOOGLE_WALLET_SA_BASE64 inválido: ${(e as Error).message}`);
      }
    }
    const p = process.env.GOOGLE_WALLET_SA_JSON;
    if (p && fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {
        this.logger.warn(`GOOGLE_WALLET_SA_JSON inválido: ${(e as Error).message}`);
      }
    }
    return null;
  }

  private loadDefaultImages(): Record<string, Buffer> {
    if (this.defaultImages) return this.defaultImages;
    const baseDir = path.join(process.cwd(), 'certs', 'wallet-defaults');
    const files = [
      'icon.png',
      'icon@2x.png',
      'icon@3x.png',
      'logo.png',
      'logo@2x.png',
      'logo@3x.png',
      'strip.png',
      'strip@2x.png',
      'strip@3x.png',
    ];
    const out: Record<string, Buffer> = {};
    for (const f of files) {
      const p = path.join(baseDir, f);
      if (fs.existsSync(p)) {
        out[f] = fs.readFileSync(p);
      }
    }
    this.defaultImages = out;
    return out;
  }

  async generateApplePass(passId: string): Promise<Buffer> {
    const pass = await this.prisma.pass.findUnique({
      where: { id: passId },
      include: {
        card: true,
        customer: true,
        tenant: { include: { locations: { where: { isActive: true } } } },
      },
    });
    if (!pass) throw new NotFoundException('Pass');

    // Apple Wallet rechaza pass.json si description, organizationName,
    // serialNumber están vacíos. Defensivo siempre con fallbacks.
    const brandName = (pass.tenant.brandName || 'Clubify').trim() || 'Clubify';
    const cardName = (pass.card.name || 'Tarjeta de fidelización').trim() || 'Tarjeta';
    const description = cardName;

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID ?? 'pass.com.clubify.loyalty',
      teamIdentifier: process.env.APPLE_TEAM_ID ?? 'XXXXXXXXXX',
      organizationName: brandName,
      serialNumber: pass.serialNumber,
      description,
      logoText: brandName,
      foregroundColor: 'rgb(255,255,255)',
      backgroundColor: this.hexToRgb(pass.card.primaryColor),
      labelColor: 'rgb(245,241,232)',
      webServiceURL: `${process.env.API_URL ?? 'https://api.soyclubify.com'}/api/wallet/apple`,
      authenticationToken: pass.authToken,
      barcodes: [
        {
          format: 'PKBarcodeFormatPDF417',
          message: pass.serialNumber,
          altText: pass.serialNumber,
          messageEncoding: 'iso-8859-1',
        },
      ],
      locations: pass.tenant.locations.map((l) => ({
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
        relevantText: `Estás cerca de ${brandName}`,
      })),
      storeCard: {
        primaryFields: [
          {
            key: 'stamps',
            label: 'SELLOS',
            value: `${pass.stampsCount} / ${pass.card.stampsRequired ?? 10}`,
          },
        ],
        secondaryFields: [
          { key: 'reward', label: 'RECOMPENSA', value: pass.card.rewardText || '—' },
        ],
        auxiliaryFields: [
          { key: 'member', label: 'CLIENTE', value: pass.customer.fullName },
        ],
        backFields: [
          { key: 'terms', label: 'Condiciones', value: pass.card.terms || '—' },
          { key: 'contact', label: 'Contacto', value: pass.tenant.brandName },
        ],
      },
    };

    const certPem = this.loadAppleCert();
    const wwdrPem = this.loadAppleWwdr();

    if (!certPem || !wwdrPem) {
      this.logger.warn('Apple Wallet certs not configured; returning mock pass.json');
      return Buffer.from(JSON.stringify(passJson, null, 2));
    }

    // Producción: usar passkit-generator. Importación dinámica para que dev sin certs no falle.
    const { PKPass } = await import('passkit-generator');
    const buffers: Record<string, Buffer> = {
      'pass.json': Buffer.from(JSON.stringify(passJson)),
      ...this.loadDefaultImages(),
    };

    // passkit-generator rechaza signerKeyPassphrase = '' explícito.
    // Si la key es plain (generada con openssl -nodes), debe ser undefined.
    const passphrase = process.env.APPLE_PASS_CERT_PASSWORD || undefined;
    const certOpts: any = {
      wwdr: wwdrPem,
      signerCert: certPem,
      signerKey: certPem,
    };
    if (passphrase) certOpts.signerKeyPassphrase = passphrase;

    const pkpass = new PKPass(buffers, certOpts);
    return pkpass.getAsBuffer();
  }

  /**
   * Carga el cert combinado (cert + private key) Apple Wallet desde:
   *   1) APPLE_PASS_CERT_BASE64 (preferido para Railway)
   *   2) APPLE_PASS_CERT_PATH (path al .pem en disco — modo dev)
   */
  private loadAppleCert(): Buffer | null {
    const b64 = process.env.APPLE_PASS_CERT_BASE64;
    if (b64) {
      try {
        return Buffer.from(b64, 'base64');
      } catch (e) {
        this.logger.warn(`APPLE_PASS_CERT_BASE64 inválido: ${(e as Error).message}`);
      }
    }
    const p = process.env.APPLE_PASS_CERT_PATH;
    if (p && fs.existsSync(p)) return fs.readFileSync(p);
    return null;
  }

  /** WWDR Intermediate cert: APPLE_WWDR_BASE64 o APPLE_WWDR_PATH. */
  private loadAppleWwdr(): Buffer | null {
    const b64 = process.env.APPLE_WWDR_BASE64;
    if (b64) {
      try {
        return Buffer.from(b64, 'base64');
      } catch (e) {
        this.logger.warn(`APPLE_WWDR_BASE64 inválido: ${(e as Error).message}`);
      }
    }
    const p = process.env.APPLE_WWDR_PATH;
    if (p && fs.existsSync(p)) return fs.readFileSync(p);
    return null;
  }

  /** APNs Auth Key (.p8): APNS_KEY_BASE64 o APNS_KEY_PATH. */
  private loadApnsKey(): Buffer | null {
    const b64 = process.env.APNS_KEY_BASE64;
    if (b64) {
      try {
        return Buffer.from(b64, 'base64');
      } catch (e) {
        this.logger.warn(`APNS_KEY_BASE64 inválido: ${(e as Error).message}`);
      }
    }
    const p = process.env.APNS_KEY_PATH;
    if (p && fs.existsSync(p)) return fs.readFileSync(p);
    return null;
  }

  /** Apple consulta esto cuando push le avisa que el pase cambió. */
  async getPassMeta(serial: string, authToken: string) {
    const pass = await this.prisma.pass.findUnique({
      where: { serialNumber: serial },
    });
    if (!pass || pass.authToken !== authToken) return null;
    return {
      id: pass.id,
      lastUpdated: pass.lastActivityAt ?? pass.issuedAt,
    };
  }

  async generateGoogleSaveUrl(passId: string): Promise<string> {
    const pass = await this.prisma.pass.findUnique({
      where: { id: passId },
      include: { card: true, tenant: true, customer: true },
    });
    if (!pass) throw new NotFoundException('Pass');

    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
    const sa = this.loadGoogleServiceAccount();

    if (!issuerId || !sa) {
      this.logger.warn('Google Wallet not configured; returning mock URL');
      return `https://pay.google.com/gp/v/save/MOCK_${passId}`;
    }
    // Google Wallet IDs only allow [a-zA-Z0-9._] — UUIDs (with dashes) need sanitizing.
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9._]/g, '_');
    const objectId = `${issuerId}.pass_${safe(pass.id)}`;
    const classId = `${issuerId}.card_${safe(pass.cardId)}`;
    const hex = pass.card.primaryColor || '#5B5EEE';
    // El logo TIENE que ser HTTPS público accesible (Google scraper lo descarga).
    // En dev preferimos el tunnel; ignoramos APP_URL si apunta a localhost.
    const publicBase =
      process.env.PUBLIC_LOGO_BASE_URL ||
      (process.env.APP_URL && !process.env.APP_URL.includes('localhost')
        ? process.env.APP_URL
        : 'https://attacked-princess-understand-racks.trycloudflare.com');
    const logoUri = pass.tenant.logoUrl || `${publicBase}/icons/icon-512.png`;

    // LoyaltyClass inline — Google Wallet la crea on-the-fly si no existe.
    // Sin esto el JWT save link falla porque Google requiere class antes que object.
    // No incluimos `reviewStatus` ni `countryCode`: son sólo válidos vía REST API,
    // no en el payload inline del JWT save link.
    const loyaltyClass = {
      id: classId,
      issuerName: pass.tenant.brandName,
      programName: pass.card.name,
      programLogo: {
        sourceUri: { uri: logoUri },
        contentDescription: { defaultValue: { language: 'es', value: pass.tenant.brandName } },
      },
      hexBackgroundColor: hex,
    };

    const loyaltyObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountName: pass.customer.fullName,
      accountId: safe(pass.customer.id),
      loyaltyPoints: {
        balance: { string: `${pass.stampsCount}/${pass.card.stampsRequired ?? 10}` },
        label: 'Sellos',
      },
      barcode: { type: 'PDF_417', value: pass.serialNumber, alternateText: pass.serialNumber },
      hexBackgroundColor: hex,
    };

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

    await this.prisma.pass.update({ where: { id: passId }, data: { googleObjectId: objectId } });
    return url;
  }

  /**
   * Notifica a todos los iPhones que tienen este pase instalado para que
   * re-fetchen la versión actualizada del .pkpass. Apple usa silent push
   * via APNs (token-based, sin alert/badge — solo trigger).
   *
   * Requiere env vars:
   *   APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APPLE_PASS_TYPE_ID
   * Si faltan, loggea y skipea (modo dev).
   */
  async pushPassUpdate(passId: string) {
    const devices = await this.prisma.walletDevice.findMany({
      where: { passId, platform: 'APPLE' },
    });
    if (devices.length === 0) {
      this.logger.debug(`pushPassUpdate(${passId}): no Apple devices registered`);
      return { sent: 0, skipped: 0 };
    }

    const keyBuf = this.loadApnsKey();
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const topic = process.env.APPLE_PASS_TYPE_ID ?? 'pass.com.clubify.loyalty';

    if (!keyBuf || !keyId || !teamId) {
      this.logger.warn(
        `pushPassUpdate(${passId}): APNs no configurado (${devices.length} dispositivos esperando) — skipeando`,
      );
      return { sent: 0, skipped: devices.length };
    }

    const apn = await import('apn');
    const provider = new apn.Provider({
      // node-apn acepta string (path o contenido PEM). Convertimos buffer a string.
      token: { key: keyBuf.toString('utf8'), keyId, teamId },
      production: process.env.NODE_ENV === 'production',
    });
    // Apple Wallet espera notificación SILENCIOSA: payload vacío, topic =
    // passTypeId. No alert, no sound, no badge — solo trigger de fetch.
    const note = new apn.Notification();
    note.topic = topic;
    note.payload = {};

    let sent = 0;
    let skipped = 0;
    for (const d of devices) {
      try {
        const r = await provider.send(note, d.pushToken);
        sent += r.sent.length;
        skipped += r.failed.length;
        if (r.failed.length > 0) {
          this.logger.warn(
            `APNs failed for ${d.pushToken.slice(0, 8)}…: ${JSON.stringify(r.failed[0]?.response ?? r.failed[0])}`,
          );
        }
      } catch (e) {
        skipped += 1;
        this.logger.warn(`APNs error: ${(e as Error).message}`);
      }
    }
    provider.shutdown();
    this.logger.log(
      `pushPassUpdate(${passId}): ${sent} enviados / ${skipped} fallidos (${devices.length} devices)`,
    );
    return { sent, skipped };
  }

  private hexToRgb(hex: string): string {
    const m = hex.replace('#', '').match(/.{2}/g);
    if (!m) return 'rgb(15,61,46)';
    const [r, g, b] = m.map((x) => parseInt(x, 16));
    return `rgb(${r},${g},${b})`;
  }
}
