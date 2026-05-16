import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { GoogleWalletService } from './google-wallet.service';
import { renderStampIconSvg } from './stamp-icons';

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
  constructor(
    private prisma: PrismaService,
    private googleWallet: GoogleWalletService,
  ) {}

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
      // Apple Wallet muestra el pase en lock screen cuando el iPhone está
      // a menos de `maxDistance` metros (300 por default) de cualquiera de
      // estas locations. El `relevantText` es el texto que aparece — el
      // dueño lo edita en /app/locations. maxDistance va a nivel pass, no
      // por location, así que tomamos el mayor radius configurado.
      locations: pass.tenant.locations.map((l) => ({
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
        relevantText: l.walletRelevantText?.trim() || `Estás cerca de ${brandName}`,
      })),
      maxDistance: pass.tenant.locations.reduce(
        (max, l) => Math.max(max, l.radiusMeters || 300),
        300,
      ),
      storeCard: {
        // Header field principal — varía por tipo de tarjeta. Apple Wallet
        // muestra banner "Tu pase de X cambió: Y…" cuando este field cambia.
        // Para COUPON: array vacío. El estado DISPONIBLE/REDIMIDO va
        // pintado dentro del strip image como badge — así no hay overlap
        // visual con el logoText (brand name) que ocupa el mismo row.
        headerFields:
          pass.card.type === 'COUPON' ? [] : [this.buildHeaderField(pass)],
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
      const c: any = pass.card;
      dynamicStrips = await this.generateStampsStrip({
        primary: pass.card.primaryColor,
        secondary: pass.card.secondaryColor,
        required: pass.card.stampsRequired ?? 10,
        stamped: pass.stampsCount,
        icon: c.stampIcon || '☕',
        // Colores avanzados (opcionales). Si null, generateStampsStrip
        // usa defaults computados desde primary/secondary.
        stampActiveColor: c.stampActiveColor ?? null,
        stampInactiveColor: c.stampInactiveColor ?? null,
        stampContourColor: c.stampContourColor ?? null,
        centerBgColor: c.centerBgColor ?? null,
      });
    } else if (pass.card.type === 'COUPON') {
      dynamicStrips = await this.generateCouponStrip({
        primary: pass.card.primaryColor,
        secondary: pass.card.secondaryColor,
        rewardText: pass.card.rewardText || '',
        heroImageUrl: pass.card.heroImageUrl || null,
        redeemed: pass.status === 'COMPLETED',
      });
    }

    // Imágenes del tenant:
    // - icon.png (cuadrado): banner de push notification del iPhone + ícono
    //   en notification center.
    // - logo.png (rectangular, max 160×50): header arriba-izquierda del
    //   pase. Si el tenant NO tiene logoUrl, devolvemos un PNG transparente
    //   para que el logo de Clubify default no aparezca (pedido del cliente).
    // Logo del wallet: walletLogoUrl tiene prioridad (logo dedicado con
    // alpha que el dueño sube específicamente para wallet en /app/cards),
    // sino fallback al logoUrl general del negocio. Tratar string vacío
    // como ausente — el frontend puede mandar '' al borrar y ?? solo cae
    // con null/undefined, lo que dejaba el logo transparente aunque
    // logoUrl existiera.
    // Resolución del logo del pase:
    // 1. walletLogoUrl (logo dedicado para wallet) si existe y procesa bien.
    // 2. logoUrl (logo general de la marca) como fallback.
    // String vacío se trata como ausente (?? no cae con '').
    // Si el primer candidato produce un logo "vacío" (todo blanco tras
    // chroma-key, típico de uploads viejos que pasaron por el cropper que
    // exportaba JPG con relleno blanco), automáticamente probamos el
    // segundo candidato.
    const normalize = (u: any): string | null =>
      typeof u === 'string' && u.trim() ? u.trim() : null;
    const candidates = [
      normalize((pass.tenant as any).walletLogoUrl),
      normalize(pass.tenant.logoUrl),
    ].filter((u): u is string => u !== null);

    let tenantLogos: Record<string, Buffer> = {};
    let usedLogoUrl: string | null = null;
    for (const url of candidates) {
      const attempt = await this.generateTenantLogos(url);
      const main = attempt['logo.png'];
      // Un PNG 160×50 totalmente transparente pesa ~130 bytes. Si lo que
      // generamos es <500 bytes, asumimos que el chroma-key vació la
      // imagen (probablemente JPG todo-blanco del cropper viejo) y damos
      // chance al siguiente candidato.
      if (main && main.length >= 500) {
        tenantLogos = attempt;
        usedLogoUrl = url;
        break;
      }
      this.logger.log(
        `[LOGO] candidato ${url} produjo logo.png de ${main?.length ?? 0}b — intentando siguiente`,
      );
    }
    if (usedLogoUrl) {
      this.logger.log(`[LOGO] usando ${usedLogoUrl} para pass=${pass.id}`);
    } else {
      this.logger.log(`[LOGO] sin logo válido para pass=${pass.id} — pase sin logo`);
    }

    // icon.png usa pushLogoUrl con prioridad sobre walletLogoUrl/logoUrl.
    // Apple Wallet usa icon.png exclusivamente para:
    //  - banner de notificación push en lockscreen
    //  - ícono del pase en la lista de la app Wallet
    // El logo.png (header del pase abierto) sigue usando el candidate
    // resuelto arriba — así el diseño visual del pase NO cambia.
    const pushLogoUrl =
      normalize((pass.tenant as any).pushLogoUrl) ??
      usedLogoUrl ??
      candidates[0] ??
      null;
    const tenantIcons = await this.generateTenantIcons(pushLogoUrl);

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
   * Calcula el header field principal del pkpass según el tipo de tarjeta.
   * Cada tipo muestra el dato relevante (sellos / saldo / visitas / tier).
   */
  private buildHeaderField(pass: any): {
    key: string;
    label: string;
    value: string;
    changeMessage: string;
  } {
    const t = pass.card.type;
    if (t === 'CASHBACK') {
      const bal = Math.round(Number(pass.cashbackBalance ?? 0));
      return {
        key: 'cashback',
        label: 'SALDO',
        value: `$${bal.toLocaleString('es-CO')}`,
        changeMessage: 'Saldo: %@',
      };
    }
    if (t === 'VISITS') {
      return {
        key: 'visits',
        label: 'VISITAS',
        value: `${pass.visitsCount ?? 0} / ${pass.card.visitsRequired ?? 10}`,
        changeMessage: 'Visitas: %@',
      };
    }
    if (t === 'POINTS') {
      const pts = Math.round(Number(pass.pointsBalance ?? 0));
      return {
        key: 'points',
        label: 'PUNTOS',
        value: `${pts}`,
        changeMessage: 'Puntos: %@',
      };
    }
    if (t === 'MEMBERSHIP') {
      return {
        key: 'tier',
        label: 'NIVEL',
        value: pass.currentTier || 'Miembro',
        changeMessage: 'Nuevo nivel: %@',
      };
    }
    // COUPON: single-use. El header muestra el estado del cupón, no
    // sellos. DISPONIBLE = todavía no se redimió; REDIMIDO = ya se usó
    // (status COMPLETED). El operador escanea el QR → REDEEM → auto-
    // promote a stamps card.
    if (t === 'COUPON') {
      const redeemed = pass.status === 'COMPLETED';
      return {
        key: 'coupon',
        label: 'CUPÓN',
        value: redeemed ? 'REDIMIDO' : 'DISPONIBLE',
        changeMessage: 'Cupón: %@',
      };
    }
    // STAMPS / HYBRID / DISCOUNT / GIFT / MULTI: comportamiento clásico de sellos.
    return {
      key: 'stamps',
      label: 'SELLOS',
      value: `${pass.stampsCount} / ${pass.card.stampsRequired ?? 10}`,
      changeMessage: 'Sellos: %@',
    };
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
  /** Proxy del GET del LoyaltyObject de Google Wallet — para diagnóstico. */
  async getGoogleObjectRaw(objectId: string) {
    return this.googleWallet.getObjectRaw(objectId);
  }

  /**
   * Genera el hero image del pase para Google Wallet (1032×336 PNG).
   * Contiene título grande + 3 columnas de stats (sellos faltantes,
   * recompensas disponibles, premio siguiente). Renderiza por pase para
   * que las stats reflejen el estado real del cliente.
   */
  async generatePassHeroImage(passId: string): Promise<Buffer | null> {
    const sharp = (await import('sharp')).default;
    const pass = await this.prisma.pass.findUnique({
      where: { id: passId },
      include: { card: true },
    });
    if (!pass) return null;
    const t = pass.card.type;
    if (t !== 'STAMPS' && t !== 'HYBRID' && t !== 'VISITS') return null;
    const required =
      t === 'VISITS'
        ? pass.card.visitsRequired ?? 10
        : pass.card.stampsRequired ?? 10;
    const current = t === 'VISITS' ? pass.visitsCount : pass.stampsCount;
    const remaining = Math.max(0, required - current);
    const rewardText = pass.card.rewardText || 'Premio';
    const primary = pass.card.primaryColor || '#6366F1';
    const secondary = pass.card.secondaryColor || '#A855F7';

    const W = 1032;
    const H = 336;
    const title = 'Acumula sellos y obtén beneficios';

    // Tres columnas equidistantes ocupando 60% del ancho centrado.
    const colsAreaY = 200;
    const colsW = W * 0.78;
    const colsStart = (W - colsW) / 2;
    const colW = colsW / 3;
    const colCx = [
      colsStart + colW * 0.5,
      colsStart + colW * 1.5,
      colsStart + colW * 2.5,
    ];

    const stats = [
      {
        icon: '<path d="M-18 -20 h36 v40 h-36 z M-18 -12 h36 M-12 -16 h6 M-2 -16 h6 M10 -16 h6 M-12 -8 h6 M-2 -8 h6 M10 -8 h6 M-12 0 h6 M-2 0 h6 M10 0 h6 M-12 8 h6 M-2 8 h6 M10 8 h6" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
        label: 'Sellos faltantes',
        value: `${remaining} ${remaining === 1 ? 'sello' : 'sellos'}`,
      },
      {
        icon: '<path d="M-18 -4 h36 v20 h-36 z M-18 -4 h36 v-6 h-36 z M0 -10 v26 M-12 -10 a6 6 0 1 1 12 0 a6 6 0 1 1 12 0" stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round"/>',
        label: 'Recompensas',
        value: '0 premios',
      },
      {
        icon: '<path d="M-14 -16 h28 v8 a14 14 0 0 1 -14 14 a14 14 0 0 1 -14 -14 z M-14 -10 h-6 v4 a6 6 0 0 0 6 6 M14 -10 h6 v4 a6 6 0 0 1 -6 6 M-6 12 h12 v6 h-12 z" stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
        label: 'Premio siguiente',
        value: rewardText.length > 22 ? rewardText.slice(0, 20) + '…' : rewardText,
      },
    ];

    const colSvg = stats
      .map((s, i) => {
        const cx = colCx[i];
        return `
        <g transform="translate(${cx} ${colsAreaY})">
          ${s.icon}
        </g>
        <text x="${cx}" y="${colsAreaY + 50}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="20" fill="rgba(255,255,255,0.78)" font-weight="500">${this.escapeXml(s.label)}</text>
        <text x="${cx}" y="${colsAreaY + 80}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="26" fill="white" font-weight="700">${this.escapeXml(s.value)}</text>
      `;
      })
      .join('');

    const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <linearGradient id="depth" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="50%" stop-color="rgba(255,255,255,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.18)"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#depth)"/>
  <text x="${W / 2}" y="100" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="48" fill="white" font-weight="800">${this.escapeXml(title)}</text>
  ${colSvg}
</svg>`.trim();

    return sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
  }

  /**
   * Genera la imagen del strip de sellos del pase como PNG público.
   * Usado por Google Wallet (imageModulesData) para mostrar la grilla de
   * sellos similar al strip de Apple Wallet. Devuelve null si el tipo de
   * tarjeta no usa strip (CASHBACK/POINTS/etc).
   */
  async generatePassStripImage(passId: string): Promise<Buffer | null> {
    const pass = await this.prisma.pass.findUnique({
      where: { id: passId },
      include: { card: true },
    });
    if (!pass) return null;
    const t = pass.card.type;
    if (t !== 'STAMPS' && t !== 'HYBRID' && t !== 'VISITS') return null;
    const c: any = pass.card;
    const required =
      t === 'VISITS'
        ? pass.card.visitsRequired ?? 10
        : pass.card.stampsRequired ?? 10;
    const stamped = t === 'VISITS' ? pass.visitsCount : pass.stampsCount;
    const result = await this.generateStampsStrip({
      primary: pass.card.primaryColor,
      secondary: pass.card.secondaryColor,
      required,
      stamped,
      icon: c.stampIcon || '☕',
      stampActiveColor: c.stampActiveColor ?? null,
      stampInactiveColor: c.stampInactiveColor ?? null,
      stampContourColor: c.stampContourColor ?? null,
      centerBgColor: c.centerBgColor ?? null,
    });
    // Usamos la versión @2x (640×246) que se ve bien en Android y desktop.
    return result['strip@2x.png'] ?? result['strip.png'] ?? null;
  }

  private async generateStampsStrip(opts: {
    primary: string;
    secondary: string;
    required: number;
    stamped: number;
    icon: string;
    stampActiveColor?: string | null;
    stampInactiveColor?: string | null;
    stampContourColor?: string | null;
    centerBgColor?: string | null;
  }): Promise<Record<string, Buffer>> {
    const sharp = (await import('sharp')).default;
    const {
      primary,
      secondary,
      required,
      stamped,
      icon,
      stampActiveColor,
      stampInactiveColor,
      stampContourColor,
      centerBgColor,
    } = opts;
    // Defaults estilo Starbucks / Apple Wallet: filled = blanco sólido,
    // empty = relleno sutil glassmorphism sin borde marcado. El contorno
    // sólo se dibuja si el tenant lo configuró explícitamente.
    const fillFull = stampActiveColor ?? '#FFFFFF';
    const fillEmpty = stampInactiveColor ?? 'rgba(255,255,255,0.13)';
    const customStroke = stampContourColor ?? null;

    const rows = required > 6 ? 2 : 1;
    const perRow = Math.ceil(required / rows);

    // SVG en escala 2x (640×246). Padding/gap generosos para look minimal.
    const W = 640;
    const H = 246;
    const padX = 32;
    const padY = rows === 2 ? 26 : 36;
    const gap = rows === 2 ? 16 : 22;
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

      if (filled) {
        // Sombra sutil + círculo blanco sólido. Stroke sólo si el tenant
        // lo pidió explícitamente.
        const strokeAttr = customStroke
          ? ` stroke="${customStroke}" stroke-width="1.5"`
          : '';
        circles.push(
          `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fillFull}" filter="url(#stampShadow)"${strokeAttr}/>`,
        );
        // Ícono inline SVG (librsvg no renderiza color emoji aunque la
        // fuente esté instalada — sale como silueta monocromática negra).
        // El renderer mapea emoji → SVG estilo "gourmet" con gradient.
        // Tamaño ≈55% del diámetro del círculo (radius * 1.1 = 55% de 2r).
        const iconSize = radius * 1.1;
        circles.push(renderStampIconSvg(icon, cx, cy, iconSize, `${i}`));
      } else {
        // Vacío: glassmorphism sutil sin borde. Borde sólo si el tenant
        // configuró stampContourColor.
        const strokeAttr = customStroke
          ? ` stroke="${customStroke}" stroke-width="1" stroke-opacity="0.32"`
          : '';
        circles.push(
          `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fillEmpty}"${strokeAttr}/>`,
        );
      }
    }

    // Background del strip: gradiente diagonal de la card + gloss sutil
    // vertical (highlight blanco arriba que se desvanece, oscurecimiento
    // mínimo abajo) para dar profundidad sin opacar la marca.
    const bgFill = centerBgColor ? centerBgColor : 'url(#bg)';
    const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="55%" stop-color="rgba(255,255,255,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.10)"/>
    </linearGradient>
    <filter id="stampShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.5"/>
      <feOffset dx="0" dy="3" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.32"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="${bgFill}"/>
  <rect width="100%" height="100%" fill="url(#gloss)"/>
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
   * Genera strip*.png para tarjetas COUPON. Layout:
   * - Background: heroImageUrl si existe (recortada a 640×246), sino
   *   gradient primary→secondary.
   * - Si heroImageUrl: overlay oscuro 30% para legibilidad del texto.
   * - Centro: texto grande "REWARD" (rewardText de la card).
   * - Badge esquina superior derecha: "DISPONIBLE" verde o "REDIMIDO"
   *   gris, según el estado del pass.
   * - Si REDIMIDO: overlay extra 50% gris + stamp diagonal "USADO"
   *   para feedback visual claro.
   *
   * Apple Wallet strip dimensions: 320×123 / 640×246 / 960×369. Devolvemos
   * los 3 tamaños via sharp resize (renderizamos en 640×246 source).
   */
  private async generateCouponStrip(opts: {
    primary: string;
    secondary: string;
    rewardText: string;
    heroImageUrl: string | null;
    redeemed: boolean;
  }): Promise<Record<string, Buffer>> {
    const sharp = (await import('sharp')).default;
    const { primary, secondary, rewardText, heroImageUrl, redeemed } = opts;

    const W = 640;
    const H = 246;

    // Texto del centro: rewardText. Si vacío, "BENEFICIO". Trunca a ~32
    // chars para que no se monte. Wrap en 2 líneas si > 18 chars.
    const fullText = (rewardText || 'BENEFICIO').toUpperCase();
    const lines = this.splitLines(fullText, 18, 2);
    const textY = lines.length === 1 ? H / 2 + 14 : H / 2 - 4;

    const badgeText = redeemed ? 'REDIMIDO' : 'DISPONIBLE';
    const badgeFill = redeemed ? '#4B5563' : '#16A34A';
    const badgeStroke = redeemed
      ? 'rgba(255,255,255,0.5)'
      : 'rgba(255,255,255,0.7)';
    const badgeW = redeemed ? 130 : 150;

    // Si redimido: overlay oscuro full + stamp diagonal "USADO" central
    // para deshabilitar visualmente. Sino: solo overlay sutil para dar
    // profundidad al texto.
    const redeemedOverlay = redeemed
      ? `<rect width="${W}" height="${H}" fill="rgba(0,0,0,0.45)"/>
         <g transform="translate(${W / 2} ${H / 2}) rotate(-12)" opacity="0.9">
           <rect x="-130" y="-22" width="260" height="44" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="3" rx="6"/>
           <text x="0" y="9" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="800" fill="rgba(255,255,255,0.95)" letter-spacing="0.1em">USADO</text>
         </g>`
      : '';

    const bgRect = heroImageUrl
      ? ''
      : `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;

    const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${this.escapeXml(primary)}"/>
      <stop offset="100%" stop-color="${this.escapeXml(secondary)}"/>
    </linearGradient>
    <linearGradient id="overlay" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,0.25)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>
    </linearGradient>
  </defs>
  ${bgRect}
  ${heroImageUrl ? `<rect width="${W}" height="${H}" fill="url(#overlay)"/>` : ''}
  ${lines
    .map(
      (line, i) => `
  <text x="${W / 2}" y="${textY + i * 42}" text-anchor="middle"
        font-family="Inter, system-ui, sans-serif" font-size="${lines.length === 1 ? 44 : 36}" font-weight="800"
        fill="white" letter-spacing="-0.01em" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.35));">${this.escapeXml(line)}</text>`,
    )
    .join('')}
  <g transform="translate(${W - badgeW - 18} 18)">
    <rect width="${badgeW}" height="32" rx="16" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="1.5"/>
    <text x="${badgeW / 2}" y="22" text-anchor="middle"
          font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="700"
          fill="white" letter-spacing="0.08em">${badgeText}</text>
  </g>
  ${redeemedOverlay}
</svg>`.trim();

    // Si hay heroImageUrl: bajar la imagen, recortar a 640×246 cover y
    // componer SVG encima. Si falla la red, fallback al SVG-only.
    let baseImage: Buffer | null = null;
    if (heroImageUrl) {
      try {
        const res = await fetch(heroImageUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          baseImage = await sharp(buf)
            .resize(W, H, { fit: 'cover', position: 'center' })
            .png()
            .toBuffer();
        }
      } catch (e: any) {
        this.logger.warn(
          `[COUPON STRIP] heroImageUrl fetch falló: ${e?.message ?? e} — fallback a gradient`,
        );
      }
    }

    const compositeBase = baseImage
      ? sharp(baseImage).composite([{ input: Buffer.from(svg, 'utf8') }])
      : sharp(Buffer.from(svg, 'utf8'));

    const baseBuf = await compositeBase.png().toBuffer();
    const [s1, s2, s3] = await Promise.all([
      sharp(baseBuf).resize(320, 123).png().toBuffer(),
      sharp(baseBuf).resize(640, 246).png().toBuffer(),
      sharp(baseBuf).resize(960, 369).png().toBuffer(),
    ]);
    return {
      'strip.png': s1,
      'strip@2x.png': s2,
      'strip@3x.png': s3,
    };
  }

  /** Wrap helper — divide texto largo en N líneas (cada una ≤ maxCharsPerLine).
   *  Si no se puede dividir en maxLines, trunca con "…" en la última. */
  private splitLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
    if (text.length <= maxCharsPerLine) return [text];
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const cand = current ? `${current} ${w}` : w;
      if (cand.length <= maxCharsPerLine) {
        current = cand;
      } else {
        if (current) lines.push(current);
        current = w;
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (current) lines.push(current);
    if (lines.length > maxLines) {
      const truncated = lines.slice(0, maxLines);
      const last = truncated[maxLines - 1];
      truncated[maxLines - 1] = last.slice(0, maxCharsPerLine - 1) + '…';
      return truncated;
    }
    return lines;
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

      // Si el PNG/JPG fuente NO tiene canal alpha (fondo blanco sólido),
      // hacemos chroma-key automático para que el logo se integre con el
      // gradient del pase en vez de mostrar un cuadro blanco detrás.
      // Umbral conservador: RGB todos >= 240 → píxel considerado "blanco
      // de fondo" y se vuelve transparente. Píxeles más oscuros se
      // mantienen como están. Logos con detalles blancos legítimos (texto
      // blanco sobre forma oscura) NO se afectan porque están rodeados de
      // píxeles oscuros que se preservan.
      const prepared = await this.prepareLogoForWallet(src);

      const make = (w: number, h: number) =>
        sharp(prepared)
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

  /**
   * Si el logo subido tiene fondo blanco SÓLIDO (todos los píxeles opacos),
   * convierte los píxeles cercanos al blanco en transparentes para que se
   * integre con el gradient del pase. Si la fuente ya tiene transparencia
   * REAL (al menos un píxel con alpha != 255), se respeta el diseño
   * original completo — porque ahí el diseñador ya decidió qué es fondo
   * vs. qué es contenido, y un blanco intencional en el logo no debería
   * borrarse.
   */
  private async prepareLogoForWallet(src: Buffer): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(src)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Detectar transparencia real (variable alpha). Si ya existe → respetar.
    let hasRealTransparency = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) {
        hasRealTransparency = true;
        break;
      }
    }
    if (hasRealTransparency) {
      // El diseñador ya recortó el fondo — no tocar el logo (incluye casos
      // de logos con elementos blancos legítimos sobre fondo transparente).
      return src;
    }

    // Fuente plana sin transparencia → asumimos blanco como fondo y lo
    // recortamos. Logos con contenido blanco se verían afectados, pero un
    // diseñador que necesita blanco-sobre-color subiría PNG con alpha.
    const THRESHOLD = 240;
    const out = Buffer.from(data);
    for (let i = 0; i < out.length; i += 4) {
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      if (r >= THRESHOLD && g >= THRESHOLD && b >= THRESHOLD) {
        out[i + 3] = 0;
      }
    }
    return sharp(out, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
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

  /**
   * Delegado a GoogleWalletService para mantener wallet.service manageable.
   * Genera el JWT save URL con LoyaltyClass + LoyaltyObject inline para que
   * el cliente lo abra desde Android Chrome y lo agregue a Google Wallet.
   */
  async generateGoogleSaveUrl(passId: string): Promise<string> {
    return this.googleWallet.generateSaveUrl(passId);
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
    // Google Wallet PATCH — propaga sellos/saldo/visitas/tier a Android.
    // En paralelo con APNs para que ambos lleguen lo antes posible.
    const googlePromise = this.googleWallet.pushUpdate(passId).catch((e) => {
      this.logger.warn(`Google Wallet push failed: ${e?.message ?? e}`);
      return { ok: false, status: 'error', error: e?.message ?? String(e) };
    });

    const devices = await this.prisma.walletDevice.findMany({
      where: { passId, platform: 'APPLE' },
    });
    if (devices.length === 0) {
      this.logger.debug(`pushPassUpdate(${passId}): no Apple devices registered`);
      const google = await googlePromise;
      return { sent: 0, skipped: 0, google };
    }

    const keyBuf = this.loadApnsKey();
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const topic = process.env.APPLE_PASS_TYPE_ID ?? 'pass.com.clubify.loyalty';

    if (!keyBuf || !keyId || !teamId) {
      this.logger.warn(
        `pushPassUpdate(${passId}): APNs no configurado (${devices.length} dispositivos esperando) — skipeando`,
      );
      const google = await googlePromise;
      return { sent: 0, skipped: devices.length, google };
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
    const google = await googlePromise;
    this.logger.log(
      `pushPassUpdate(${passId}): google=${google?.status ?? 'unknown'}`,
    );
    return { sent, skipped, google };
  }

  private hexToRgb(hex: string): string {
    const m = hex.replace('#', '').match(/.{2}/g);
    if (!m) return 'rgb(15,61,46)';
    const [r, g, b] = m.map((x) => parseInt(x, 16));
    return `rgb(${r},${g},${b})`;
  }
}
