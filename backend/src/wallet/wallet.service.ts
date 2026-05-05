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

    // Para que Apple Wallet muestre banner "Tu pase de X cambió", el .pkpass
    // tiene que cambiar de bytes Y tener un field con changeMessage que cambió.
    // Embebimos el último mensaje de notificación enviado al tenant/card —
    // si cambió desde la última fetch del iPhone, Apple muestra el banner.
    const latestNotif = await this.prisma.notification.findFirst({
      where: {
        tenantId: pass.tenantId,
        OR: [{ cardId: pass.cardId }, { cardId: null }],
        sentAt: { not: null },
      },
      orderBy: { sentAt: 'desc' },
    });
    const lastMsgValue = latestNotif
      ? `${latestNotif.title}\n${latestNotif.body}`.trim().slice(0, 200)
      : 'Aún no hay mensajes';

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
          altText: 'Creado por Clubify',
          messageEncoding: 'iso-8859-1',
        },
      ],
      locations: pass.tenant.locations.map((l) => ({
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
        relevantText: `Estás cerca de ${brandName}`,
      })),
      storeCard: {
        // Stamps cuenta arriba a la derecha (no encima del strip) →
        // headerFields se renderiza en el header opuesto al logo del tenant.
        headerFields: [
          {
            key: 'stamps',
            label: 'SELLOS',
            value: `${pass.stampsCount} / ${pass.card.stampsRequired ?? 10}`,
            // Apple Wallet muestra banner "Tu pase de X cambió: Y sellos…"
            // cuando este field cambia. %@ se reemplaza con el value nuevo.
            changeMessage: 'Sellos: %@',
          },
        ],
        // primaryFields vacío → el strip image actúa de hero principal sin
        // texto encima.
        primaryFields: [],
        secondaryFields: [
          { key: 'reward', label: 'RECOMPENSA', value: pass.card.rewardText || '—' },
        ],
        auxiliaryFields: [
          { key: 'member', label: 'CLIENTE', value: pass.customer.fullName },
        ],
        backFields: [
          {
            // Mensaje del último push de marketing — al cambiar muestra
            // banner en lockscreen automático.
            key: 'lastMessage',
            label: 'Último mensaje',
            value: lastMsgValue,
            changeMessage: '%@',
          },
          { key: 'serial', label: 'Número de tarjeta', value: pass.serialNumber },
          { key: 'terms', label: 'Condiciones', value: pass.card.terms || '—' },
          { key: 'contact', label: 'Contacto', value: pass.tenant.brandName },
          {
            // Apple Wallet detecta URLs en value y las hace clickeables.
            // El usuario tap el ⓘ del pase, ve "Creado por Clubify" con el
            // link y al tap abre Safari en https://soyclubify.com.
            key: 'powered',
            label: 'Creado por Clubify',
            value: 'https://soyclubify.com',
            attributedValue:
              '<a href="https://soyclubify.com">soyclubify.com</a>',
          },
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

    // Strip dinámico por pass — gradient de colores de la card + grid de
    // sellos con el icono elegido por el tenant. Reemplaza la strip default
    // que solo era gradient verde sólido.
    let dynamicStrips: Record<string, Buffer> = {};
    if (pass.card.type === 'STAMPS') {
      dynamicStrips = await this.generateStampsStrip({
        primary: pass.card.primaryColor,
        secondary: pass.card.secondaryColor,
        required: pass.card.stampsRequired ?? 10,
        stamped: pass.stampsCount,
        icon: (pass.card as any).stampIcon || '☕',
      });
    }

    // Imágenes del tenant:
    // - icon.png (cuadrado): banner de push notification del iPhone + ícono
    //   en notification center.
    // - logo.png (rectangular, max 160×50): header arriba-izquierda del
    //   pase. Si el tenant NO tiene logoUrl, devolvemos un PNG transparente
    //   para que el logo de Clubify default no aparezca (pedido del cliente).
    const tenantIcons = await this.generateTenantIcons(pass.tenant.logoUrl);
    const tenantLogos = await this.generateTenantLogos(pass.tenant.logoUrl);

    const buffers: Record<string, Buffer> = {
      'pass.json': Buffer.from(JSON.stringify(passJson)),
      ...this.loadDefaultImages(),
      ...tenantIcons, // override icon*.png con el logo del tenant si existe
      ...tenantLogos, // override logo*.png (transparente o tenant)
      ...dynamicStrips, // override strip*.png si los generamos
    };

    // El pass.pem tiene cert + key concatenados. passkit-generator parsea el
    // PRIMER BEGIN block del buffer que recibe en cada campo, así que
    // necesitamos extraerlos por separado en lugar de pasar el blob completo
    // a signerCert y signerKey (sino lee "CERTIFICATE" para ambos y falla).
    const blob = certPem.toString('utf8');
    const certOnly = this.extractPemBlock(blob, 'CERTIFICATE');
    const keyOnly =
      this.extractPemBlock(blob, 'RSA PRIVATE KEY') ||
      this.extractPemBlock(blob, 'PRIVATE KEY') ||
      this.extractPemBlock(blob, 'ENCRYPTED PRIVATE KEY');

    if (!certOnly || !keyOnly) {
      this.logger.warn(
        `Apple cert/key no separables (cert=${!!certOnly}, key=${!!keyOnly}); returning mock`,
      );
      return Buffer.from(JSON.stringify(passJson, null, 2));
    }

    const passphrase = process.env.APPLE_PASS_CERT_PASSWORD || undefined;
    const certOpts: any = {
      wwdr: wwdrPem,
      signerCert: Buffer.from(certOnly),
      signerKey: Buffer.from(keyOnly),
    };
    if (passphrase) certOpts.signerKeyPassphrase = passphrase;

    const pkpass = new PKPass(buffers, certOpts);
    return pkpass.getAsBuffer();
  }

  /**
   * Genera strip*.png dinámica con el grid de sellos del pase.
   * Apple Wallet exige strip 320×123 / 640×246 / 960×369. Renderizamos un SVG
   * con el gradient de la card + grid de círculos con el icono elegido,
   * y lo convertimos a PNG por cada resolución vía sharp.
   *
   * Layout: si required ≤ 6 → 1 fila; si > 6 → 2 filas balanceadas (10 = 5+5).
   * Sellos llenos = círculo blanco con el emoji; vacíos = círculo translúcido.
   */
  private async generateStampsStrip(opts: {
    primary: string;
    secondary: string;
    required: number;
    stamped: number;
    icon: string;
  }): Promise<Record<string, Buffer>> {
    const sharp = (await import('sharp')).default;
    const { primary, secondary, required, stamped, icon } = opts;

    const rows = required > 6 ? 2 : 1;
    const perRow = Math.ceil(required / rows);

    // Genera el SVG en escala 2x (640×246) y luego dejamos a sharp resamplear
    // a las 3 resoluciones con quality alta.
    const W = 640;
    const H = 246;
    const padX = 24;
    const padY = 28;
    const gap = 10;
    const availW = W - padX * 2;
    const availH = H - padY * 2;
    const cellW = (availW - gap * (perRow - 1)) / perRow;
    const cellH = (availH - gap * (rows - 1)) / rows;
    const radius = Math.min(cellW, cellH) / 2;

    const circles: string[] = [];
    for (let i = 0; i < required; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const cx = padX + col * (cellW + gap) + cellW / 2;
      const cy = padY + row * (cellH + gap) + cellH / 2;
      const filled = i < stamped;
      // Círculo: lleno blanco + emoji oscuro / vacío translúcido
      circles.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius - 2}" fill="${
          filled ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.16)'
        }" stroke="rgba(255,255,255,${filled ? 0.95 : 0.4})" stroke-width="2"/>`,
      );
      if (filled) {
        // Emoji centrado dentro del círculo. font-size proporcional al radio
        const fontSize = radius * 1.15;
        // dy=fontSize/3 ajusta el baseline para emojis (alineación visual)
        circles.push(
          `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji">${this.escapeXml(
            icon,
          )}</text>`,
        );
      }
    }

    const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.06)"/>
  ${circles.join('\n  ')}
</svg>`.trim();

    const baseSvg = Buffer.from(svg, 'utf8');
    const [s1, s2, s3] = await Promise.all([
      sharp(baseSvg).resize(320, 123).png().toBuffer(),
      sharp(baseSvg).resize(640, 246).png().toBuffer(),
      sharp(baseSvg).resize(960, 369).png().toBuffer(),
    ]);
    return {
      'strip.png': s1,
      'strip@2x.png': s2,
      'strip@3x.png': s3,
    };
  }

  /**
   * Genera icon.png / icon@2x.png / icon@3x.png a partir del logoUrl del
   * tenant. Apple Wallet usa icon.png como icono del banner de push
   * notification (lockscreen del iPhone) y en el header del pase abierto.
   *
   * Apple exige cuadrado: 29×29 / 58×58 / 87×87 píxeles.
   * Si la URL no responde o sharp no puede procesar, devuelve {} y los
   * defaults de Clubify se usan como fallback.
   */
  private async generateTenantIcons(
    logoUrl: string | null,
  ): Promise<Record<string, Buffer>> {
    if (!logoUrl) return {};
    try {
      const sharp = (await import('sharp')).default;
      const res = await fetch(logoUrl);
      if (!res.ok) {
        this.logger.warn(`logoUrl fetch falló (${res.status}): ${logoUrl}`);
        return {};
      }
      const src = Buffer.from(await res.arrayBuffer());
      // Centramos sobre fondo blanco para que no quede borde transparente
      // raro en el banner del lockscreen iPhone.
      const make = (px: number) =>
        sharp(src)
          .resize(px, px, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
          .png()
          .toBuffer();
      const [i1, i2, i3] = await Promise.all([make(29), make(58), make(87)]);
      return {
        'icon.png': i1,
        'icon@2x.png': i2,
        'icon@3x.png': i3,
      };
    } catch (e) {
      this.logger.warn(`generateTenantIcons error: ${(e as Error).message}`);
      return {};
    }
  }

  /**
   * Genera logo.png / @2x / @3x para el header arriba-izquierda del pase.
   * Apple Wallet acepta hasta 160×50 (320×100 @2x, 480×150 @3x).
   * Si el tenant tiene logoUrl la usamos. Si no, devolvemos PNG totalmente
   * transparente — así el logo de Clubify default queda invisible y solo
   * el `logoText` (brandName del tenant) aparece en el header.
   */
  private async generateTenantLogos(
    logoUrl: string | null,
  ): Promise<Record<string, Buffer>> {
    const sharp = (await import('sharp')).default;
    const transparent = (w: number, h: number) =>
      sharp({
        create: {
          width: w,
          height: h,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer();

    if (!logoUrl) {
      const [l1, l2, l3] = await Promise.all([
        transparent(160, 50),
        transparent(320, 100),
        transparent(480, 150),
      ]);
      return { 'logo.png': l1, 'logo@2x.png': l2, 'logo@3x.png': l3 };
    }

    try {
      const res = await fetch(logoUrl);
      if (!res.ok) {
        this.logger.warn(`logoUrl fetch falló (${res.status}): ${logoUrl}`);
        const [l1, l2, l3] = await Promise.all([
          transparent(160, 50),
          transparent(320, 100),
          transparent(480, 150),
        ]);
        return { 'logo.png': l1, 'logo@2x.png': l2, 'logo@3x.png': l3 };
      }
      const src = Buffer.from(await res.arrayBuffer());
      const make = (w: number, h: number) =>
        sharp(src)
          .resize(w, h, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();
      const [l1, l2, l3] = await Promise.all([
        make(160, 50),
        make(320, 100),
        make(480, 150),
      ]);
      return { 'logo.png': l1, 'logo@2x.png': l2, 'logo@3x.png': l3 };
    } catch (e) {
      this.logger.warn(`generateTenantLogos error: ${(e as Error).message}`);
      return {};
    }
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Extrae el primer bloque PEM con el header dado del buffer combinado. */
  private extractPemBlock(blob: string, kind: string): string | null {
    const begin = `-----BEGIN ${kind}-----`;
    const end = `-----END ${kind}-----`;
    const startIdx = blob.indexOf(begin);
    if (startIdx === -1) return null;
    const endIdx = blob.indexOf(end, startIdx);
    if (endIdx === -1) return null;
    return blob.substring(startIdx, endIdx + end.length) + '\n';
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

    // Apple Wallet usa SIEMPRE production APNs. La .p8 Auth Key trabaja para
    // ambos environments simultáneamente, así que no tiene sentido caer a
    // sandbox cuando production falla — el error es de Auth Key, no de env.
    // APNS_ENV='sandbox' permite override manual solo para tests.
    const envOverride = process.env.APNS_ENV?.toLowerCase();
    const startProd = envOverride !== 'sandbox';

    const buildProvider = (production: boolean) =>
      new apn.Provider({
        token: { key: keyBuf.toString('utf8'), keyId, teamId },
        production,
      });

    // Apple Wallet espera notificación SILENCIOSA: payload vacío, topic =
    // passTypeId. No alert, no sound, no badge — solo trigger de fetch.
    const note = new apn.Notification();
    note.topic = topic;
    note.payload = {};

    let provider = buildProvider(startProd);
    let sent = 0;
    let skipped = 0;
    let purged = 0;
    let envMismatchDetected = false;
    const STALE_REASONS = new Set([
      'BadDeviceToken',
      'Unregistered',
      'DeviceTokenNotForTopic',
    ]);

    this.logger.log(
      `APNs config: keyId=${keyId} teamId=${teamId} topic=${topic} startEnv=${startProd ? 'production' : 'sandbox'} devices=${devices.length} tokenLen=${devices[0]?.pushToken.length ?? 0}`,
    );

    for (const d of devices) {
      try {
        let r = await provider.send(note, d.pushToken);
        const dumpFailed = (label: string) => {
          if (r.failed.length === 0) return;
          const f = r.failed[0];
          this.logger.warn(
            `[${label}] APNs FAIL device=${d.pushToken.slice(0, 12)}… status=${(f as any)?.status ?? 'n/a'} reason=${(f as any)?.response?.reason ?? 'n/a'} full=${JSON.stringify(f).slice(0, 400)}`,
          );
        };
        dumpFailed(startProd ? 'prod' : 'sandbox');

        // Si Apple rechaza por env mismatch, regenerar provider en el OTRO
        // environment y retry una vez. Solo lo hacemos una vez por loop.
        const failedReason = r.failed[0]?.response?.reason as string | undefined;
        if (
          r.failed.length > 0 &&
          failedReason === 'BadEnvironmentKeyInToken' &&
          !envMismatchDetected
        ) {
          envMismatchDetected = true;
          this.logger.warn(
            `APNs env mismatch (envío fue ${startProd ? 'production' : 'sandbox'}) → retry con el otro env`,
          );
          provider.shutdown();
          provider = buildProvider(!startProd);
          r = await provider.send(note, d.pushToken);
          dumpFailed(!startProd ? 'prod' : 'sandbox');
        }
        sent += r.sent.length;
        skipped += r.failed.length;
        if (r.failed.length > 0) {
          const finalReason = r.failed[0]?.response?.reason as string | undefined;
          // Si Apple dice que el token está muerto, lo borramos para que el
          // re-install del .pkpass cree uno limpio sin colisionar.
          if (finalReason && STALE_REASONS.has(finalReason)) {
            await this.prisma.walletDevice
              .delete({ where: { id: d.id } })
              .catch(() => null);
            purged += 1;
          }
        }
      } catch (e) {
        skipped += 1;
        this.logger.warn(`APNs error: ${(e as Error).message}`);
      }
    }
    provider.shutdown();
    if (purged > 0) {
      this.logger.log(
        `pushPassUpdate(${passId}): ${purged} devices stale eliminados (re-instalar el pase para re-registrar)`,
      );
    }
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
