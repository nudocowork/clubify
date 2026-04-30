import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import * as fs from 'fs';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Genera pases para Apple Wallet (.pkpass) y Google Wallet (save link).
 * En desarrollo, si los certificados no existen, devuelve un buffer mock JSON
 * para no bloquear el flujo. En producción debe estar todo configurado.
 */
@Injectable()
export class WalletService {
  private logger = new Logger(WalletService.name);
  constructor(private prisma: PrismaService) {}

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

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID ?? 'pass.com.clubify.loyalty',
      teamIdentifier: process.env.APPLE_TEAM_ID ?? 'XXXXXXXXXX',
      organizationName: pass.tenant.brandName,
      serialNumber: pass.serialNumber,
      description: pass.card.name,
      logoText: pass.tenant.brandName,
      foregroundColor: 'rgb(255,255,255)',
      backgroundColor: this.hexToRgb(pass.card.primaryColor),
      labelColor: 'rgb(245,241,232)',
      webServiceURL: `${process.env.API_URL}/api/wallet/apple`,
      authenticationToken: pass.authToken,
      barcodes: [
        { format: 'PKBarcodeFormatQR', message: pass.qrToken, messageEncoding: 'iso-8859-1' },
      ],
      locations: pass.tenant.locations.map((l) => ({
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
        relevantText: `Estás cerca de ${pass.tenant.brandName}`,
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

    const certPath = process.env.APPLE_PASS_CERT_PATH;
    const wwdrPath = process.env.APPLE_WWDR_PATH;
    const haveCerts = certPath && wwdrPath && fs.existsSync(certPath) && fs.existsSync(wwdrPath);

    if (!haveCerts) {
      this.logger.warn('Apple Wallet certs not configured; returning mock pass.json');
      return Buffer.from(JSON.stringify(passJson, null, 2));
    }

    // Producción: usar passkit-generator. Importación dinámica para que dev sin certs no falle.
    const { PKPass } = await import('passkit-generator');
    const pkpass = new PKPass(
      {
        'pass.json': Buffer.from(JSON.stringify(passJson)),
      },
      {
        wwdr: fs.readFileSync(wwdrPath),
        signerCert: fs.readFileSync(certPath),
        signerKey: fs.readFileSync(certPath),
        signerKeyPassphrase: process.env.APPLE_PASS_CERT_PASSWORD ?? '',
      },
    );
    return pkpass.getAsBuffer();
  }

  async generateGoogleSaveUrl(passId: string): Promise<string> {
    const pass = await this.prisma.pass.findUnique({
      where: { id: passId },
      include: { card: true, tenant: true, customer: true },
    });
    if (!pass) throw new NotFoundException('Pass');

    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
    const saJsonPath = process.env.GOOGLE_WALLET_SA_JSON;

    if (!issuerId || !saJsonPath || !fs.existsSync(saJsonPath)) {
      this.logger.warn('Google Wallet not configured; returning mock URL');
      return `https://pay.google.com/gp/v/save/MOCK_${passId}`;
    }

    const sa = JSON.parse(fs.readFileSync(saJsonPath, 'utf8'));
    const objectId = `${issuerId}.pass_${pass.id}`;
    const classId = `${issuerId}.card_${pass.cardId}`;

    const loyaltyObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      accountName: pass.customer.fullName,
      accountId: pass.customer.id,
      loyaltyPoints: {
        balance: { string: `${pass.stampsCount}/${pass.card.stampsRequired ?? 10}` },
        label: 'Sellos',
      },
      barcode: { type: 'QR_CODE', value: pass.qrToken },
    };

    const claims = {
      iss: sa.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: { loyaltyObjects: [loyaltyObject] },
    };

    const token = sign(claims, sa.private_key, { algorithm: 'RS256' });
    const url = `https://pay.google.com/gp/v/save/${token}`;

    await this.prisma.pass.update({ where: { id: passId }, data: { googleObjectId: objectId } });
    return url;
  }

  /** Llamado por workers cuando cambia el estado de un pase. Stub. */
  async pushPassUpdate(passId: string) {
    this.logger.log(`pushPassUpdate(${passId}) — TODO: APNs + Google patch`);
  }

  private hexToRgb(hex: string): string {
    const m = hex.replace('#', '').match(/.{2}/g);
    if (!m) return 'rgb(15,61,46)';
    const [r, g, b] = m.map((x) => parseInt(x, 16));
    return `rgb(${r},${g},${b})`;
  }
}
