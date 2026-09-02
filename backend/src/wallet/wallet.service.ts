import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { GoogleWalletService } from './google-wallet.service';
import { resolveStampIconRenderer, resolveCustomImageRenderer } from './stamp-icons';
import { removeBorderConnectedWhite } from './logo-chroma';
import { nextRewardLabel } from './free-rewards.util';
import { resolveWalletAdvanced, WalletAdvancedFlags } from '../common/white-label/wallet-advanced.util';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import { passLabels, type PassLocale, normalizePassLocale } from './pass-labels';
import { alianzaDelPase } from '../convenios/alianzas-pase.util';

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
    private brand: WhitelabelBrandService,
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

  /** Wallet V3 — fondo del área de sellos EFECTIVO según los permisos de la
   * marca. Si la marca apagó "fondos personalizados", una tarjeta con IMAGE cae
   * a color uniforme (SOLID) y se ignora la imagen — AUNQUE ya estuviera guardada
   * (revocación retroactiva) o venga de un clonado que saltó el gate de guardado. */
  private effectiveStampBg(
    card: { stampBgType?: string | null; stampBgImageUrl?: string | null },
    wa: WalletAdvancedFlags,
  ): { stampBgType: 'GRADIENT' | 'SOLID' | 'IMAGE'; stampBgImageUrl: string | null } {
    let type = (card.stampBgType as any) || 'GRADIENT';
    let img = card.stampBgImageUrl ?? null;
    if (!wa.customBackgrounds) {
      if (type === 'IMAGE') type = 'SOLID';
      img = null;
    }
    return { stampBgType: type, stampBgImageUrl: img };
  }

  /** Wallet V3 — permisos "Wallet Avanzado" de la marca del negocio. Aislado:
   * se resuelve por el whiteLabel del tenant. null/ausente = todo activo. */
  private async getWalletAdvancedForTenant(tenantId: string): Promise<WalletAdvancedFlags> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whiteLabel: { select: { walletAdvanced: true } } },
    });
    return resolveWalletAdvanced(t?.whiteLabel?.walletAdvanced);
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
    // #24 (2026-06-16): si la tarjeta tiene walletBrandName propio, ese gana
    // sobre el brandName del negocio (para el nombre mostrado en el pase).
    // Fallback = nombre real del negocio, NUNCA 'Clubify' (delataría la
    // plataforma en el pase de una marca blanca). brandName es el nombre a
    // mostrar del negocio; si falta, su `name` de registro.
    const brandName =
      (pass.card.walletBrandName?.trim() || pass.tenant.brandName || pass.tenant.name).trim() ||
      pass.tenant.name;
    // Marca blanca dueña del pass — el link "Creado por X" del reverso apunta
    // al dominio público de la marca (no hardcode Clubify). resolveTenant cae
    // al row real `clubify` cuando el negocio no tiene whiteLabelId (legacy).
    const passBrand = await this.brand.resolveTenant(pass.tenantId);
    // Tarjeta de ALIANZA: no cuenta sellos, dice si el beneficio está en pie.
    // Solo se consulta cuando `convenioId` está puesto, así que los millones de
    // pases normales no pagan ni una consulta extra por generarse.
    const alianza = pass.card.convenioId
      ? await alianzaDelPase(this.prisma, pass.card.convenioId, pass.id)
      : null;
    const passBrandHref = passBrand.websiteUrl;
    const passBrandDomain = passBrand.websiteUrl.replace(/^https?:\/\//, '');
    // Idioma del cliente (persistido al enrolarse). Localiza TODOS los labels
    // del pase (Apple). Default 'es' para clientes sin locale. (PDF 854)
    const L = passLabels(pass.customer?.locale);
    const cardName = (pass.card.name || L.loyalty_card).trim() || L.loyalty_card;
    const description = cardName;

    // Para que Apple Wallet muestre banner "Tu pase de X cambió", el .pkpass
    // tiene que cambiar de bytes Y tener un field con changeMessage que cambió.
    // Embebimos el último mensaje de notificación — si cambió desde la última
    // fetch del iPhone, Apple muestra el banner.
    // CRÍTICO (2026-06-23): SOLO mensajes de ESTE cliente (customerId == dueño
    // del pase) o broadcasts (customerId null). Antes tomaba la última del
    // TENANT → el saludo de cumpleaños personalizado de un cliente ("Feliz
    // cumple Caroline") aparecía en el lockscreen de TODOS los demás clientes.
    const latestNotif = await this.prisma.notification.findFirst({
      where: {
        tenantId: pass.tenantId,
        OR: [{ cardId: pass.cardId }, { cardId: null }],
        sentAt: { not: null },
        AND: [
          { OR: [{ customerId: null }, { customerId: pass.customerId }] },
        ],
      },
      orderBy: { sentAt: 'desc' },
    });
    const lastMsgValue = latestNotif
      ? `${latestNotif.title}\n${latestNotif.body}`.trim().slice(0, 200)
      : L.no_messages;

    // Wallet V3 — "Próximo Premio" dinámico (si la marca lo permite). Reemplaza
    // la recompensa estática por el siguiente hito según los sellos actuales.
    const wa = await this.getWalletAdvancedForTenant(pass.tenantId);
    let rewardFieldLabel = L.reward;
    let rewardFieldValue = pass.card.rewardText || '—';
    // Solo activamos "Próximo Premio" si la tarjeta REALMENTE tiene Premios Free
    // activos → las tarjetas sin premios intermedios conservan "RECOMPENSA" tal
    // cual (no cambia el aspecto de las tarjetas existentes).
    const hasActiveFree =
      wa.freeRewards &&
      Array.isArray((pass.card as any).freeRewards) &&
      (pass.card as any).freeRewards.some((fr: any) => fr && fr.active !== false);
    if (
      wa.showNextReward &&
      hasActiveFree &&
      (pass.card.type === 'STAMPS' || pass.card.type === 'HYBRID' || pass.card.type === 'VISITS')
    ) {
      const cur = pass.card.type === 'VISITS' ? pass.visitsCount : pass.stampsCount;
      const next = nextRewardLabel({
        freeRewards: (pass.card as any).freeRewards,
        rewardText: pass.card.rewardText,
        stampsRequired:
          pass.card.type === 'VISITS' ? pass.card.visitsRequired : pass.card.stampsRequired,
        current: cur,
      });
      if (next) {
        rewardFieldLabel = L.next_reward;
        rewardFieldValue = next.label;
      }
    }
    // En una tarjeta de alianza el campo de recompensa lo ocupan los beneficios
    // vivos («10% de descuento · Bebida gratis»), que es lo que la persona
    // enseña en la caja. «Próximo premio» ahí no significa nada: no se acumula
    // nada hacia ningún sitio.
    if (alianza) {
      rewardFieldLabel = L.alliance;
      rewardFieldValue = alianza.vivos.length
        ? alianza.vivos.join(' · ').slice(0, 120)
        : L.alliance_ask(alianza.empresa);
    }

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
          // FIX 2026-06-16 (review #1): codificar el qrToken FIRMADO (JWT
          // HMAC verificable por el scanner), no el serial plano. Antes el
          // barcode llevaba el serialNumber y el scanner lo aceptaba pelado
          // (findBySerial) → cualquiera con un serial podía sumar sellos /
          // redimir. Con el JWT, findByJwt verifica la firma. Los pases
          // viejos siguen con serial hasta refrescarse (fallback legacy).
          message: pass.qrToken,
          // Marca per-marca (no hardcodear Clubify): hereda el nombre de la
          // marca blanca del tenant (Sellea, etc.).
          altText: `Creado por ${passBrand.name}`,
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
        relevantText: l.walletRelevantText?.trim() || L.near_place(brandName),
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
        headerFields: alianza
          ? [this.headerAlianza(alianza, L)]
          : pass.card.type === 'COUPON'
            ? []
            : [this.buildHeaderField(pass, L)],
        // primaryFields vacío → el strip image actúa de hero principal sin
        // texto encima.
        primaryFields: [],
        secondaryFields: [
          { key: 'reward', label: rewardFieldLabel, value: rewardFieldValue },
        ],
        auxiliaryFields: [
          { key: 'member', label: L.customer, value: pass.customer.fullName },
        ],
        backFields: [
          {
            // Mensaje del último push de marketing — al cambiar muestra
            // banner en lockscreen automático.
            key: 'lastMessage',
            label: L.last_message,
            value: lastMsgValue,
            changeMessage: '%@',
          },
          { key: 'serial', label: L.card_number, value: pass.serialNumber },
          { key: 'terms', label: L.terms, value: pass.card.terms || '—' },
          { key: 'contact', label: L.contact, value: brandName },
          {
            // Apple Wallet detecta URLs en value y las hace clickeables.
            // El usuario tap el ⓘ del pase, ve "Creado por <marca>" con el
            // link y al tap abre Safari en el dominio de la marca dueña.
            key: 'powered',
            label: `Creado por ${passBrand.name}`,
            value: passBrandHref,
            attributedValue: `<a href="${passBrandHref}">${passBrandDomain}</a>`,
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
      stampIconImageUrl: c.stampIconImageUrl ?? null,
        // Colores avanzados (opcionales). Si null, generateStampsStrip
        // usa defaults computados desde primary/secondary.
        stampActiveColor: c.stampActiveColor ?? null,
        stampInactiveColor: c.stampInactiveColor ?? null,
        stampContourColor: c.stampContourColor ?? null,
        centerBgColor: c.centerBgColor ?? null,
        // Wallet V3 — fondo del área de sellos EFECTIVO (gate de render de
        // customBackgrounds: si la marca lo apagó, IMAGE cae a uniforme aunque
        // ya estuviera guardado o venga de un clonado).
        ...this.effectiveStampBg(c, wa),
        // Premios Free solo si la marca lo permite (gate de render, además del
        // gate de guardado en cards.service).
        freeRewards: wa.freeRewards ? ((c.freeRewards as any) ?? []) : [],
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
    // #22 (2026-06-16): el logo de LA TARJETA (card.logoUrl) tiene PRIORIDAD.
    //   Antes el pase solo miraba el logo del tenant → cambiar el logo de la
    //   tarjeta no se reflejaba (bug Valmont). card.logoUrl ya está en
    //   VISUAL_FIELDS (dispara wallet.push al cambiar), así que la intención
    //   siempre fue que se viera en el pase.
    // 1. card.logoUrl (logo propio de la tarjeta).
    // 2. walletLogoUrl (logo dedicado para wallet del tenant).
    // 3. logoUrl (logo general de la marca) como fallback.
    // String vacío se trata como ausente (?? no cae con '').
    // Si un candidato produce un logo "vacío" (todo blanco tras chroma-key),
    // automáticamente probamos el siguiente.
    const normalize = (u: any): string | null =>
      typeof u === 'string' && u.trim() ? u.trim() : null;
    const candidates = [
      // Nivel 1: logo propio del negocio (tarjeta > wallet > general).
      normalize((pass.card as any).logoUrl),
      normalize((pass.tenant as any).walletLogoUrl),
      normalize(pass.tenant.logoUrl),
      // Nivel 2: logo de la MARCA BLANCA propietaria (Sellea→Sellea). passBrand
      // viene de WhitelabelBrandService.resolveTenant → NUNCA cae a Clubify para
      // otra marca. Así un negocio sin logo hereda el logo de su marca, no Clubify.
      normalize(passBrand.logoUrl),
      normalize(passBrand.iconUrl),
    ].filter((u): u is string => u !== null);

    let tenantLogos: Record<string, Buffer> = {};
    let usedLogoUrl: string | null = null;
    const logoChip = (pass.card as any).logoBgColor as string | null | undefined;
    for (const url of candidates) {
      const attempt = await this.generateTenantLogos(url, logoChip);
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

  private headerAlianza(
    a: { estado: string; empresa: string },
    L: ReturnType<typeof passLabels>,
  ) {
    const valor =
      a.estado === 'ACTIVO'
        ? L.alliance_active
        : a.estado === 'FINALIZADO'
          ? L.alliance_ended
          : a.estado === 'BLOQUEADA'
            ? L.alliance_blocked
            : L.alliance_paused;
    return {
      key: 'alliance',
      label: L.alliance,
      value: valor,
      changeMessage: L.alliance_change,
    };
  }

  /**
   * Calcula el header field principal del pkpass según el tipo de tarjeta.
   * Cada tipo muestra el dato relevante (sellos / saldo / visitas / tier).
   */
  private buildHeaderField(
    pass: any,
    L: ReturnType<typeof passLabels>,
  ): {
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
        label: L.balance,
        value: `$${bal.toLocaleString('es-CO')}`,
        changeMessage: L.balance_change,
      };
    }
    if (t === 'VISITS') {
      return {
        key: 'visits',
        label: L.visits,
        value: `${pass.visitsCount ?? 0} / ${pass.card.visitsRequired ?? 10}`,
        changeMessage: L.visits_change,
      };
    }
    if (t === 'POINTS') {
      const pts = Math.round(Number(pass.pointsBalance ?? 0));
      return {
        key: 'points',
        label: L.points,
        value: `${pts}`,
        changeMessage: L.points_change,
      };
    }
    if (t === 'MEMBERSHIP') {
      return {
        key: 'tier',
        label: L.tier,
        value: pass.currentTier || L.member_default,
        changeMessage: L.tier_change,
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
        label: L.coupon,
        value: redeemed ? L.coupon_redeemed : L.coupon_available,
        changeMessage: L.coupon_change,
      };
    }
    // STAMPS / HYBRID / DISCOUNT / GIFT / MULTI: comportamiento clásico de sellos.
    return {
      key: 'stamps',
      label: L.stamps,
      value: `${pass.stampsCount} / ${pass.card.stampsRequired ?? 10}`,
      changeMessage: L.stamps_change,
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
      include: { card: true, customer: { select: { locale: true } } },
    });
    if (!pass) return null;
    const L = passLabels(pass.customer?.locale);
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
    const title = L.accumulate;

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
        label: L.missing_stamps,
        value: L.stamps_left(remaining),
      },
      {
        icon: '<path d="M-18 -4 h36 v20 h-36 z M-18 -4 h36 v-6 h-36 z M0 -10 v26 M-12 -10 a6 6 0 1 1 12 0 a6 6 0 1 1 12 0" stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round"/>',
        label: L.rewards,
        value: L.rewards_count(0),
      },
      {
        icon: '<path d="M-14 -16 h28 v8 a14 14 0 0 1 -14 14 a14 14 0 0 1 -14 -14 z M-14 -10 h-6 v4 a6 6 0 0 0 6 6 M14 -10 h6 v4 a6 6 0 0 1 -6 6 M-6 12 h12 v6 h-12 z" stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
        label: L.next_reward,
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

    // Modo glass (heroImageUrl): foto base + overlay oscuro gradient para
    // legibilidad del texto blanco. Mismo patrón visual que el strip.
    // Modo gradient (sin hero): fallback original con colors de la card.
    const heroImageUrl = (pass.card as any).heroImageUrl as string | null;
    const usingHero = !!heroImageUrl;
    const bgRect = usingHero
      ? `<rect width="100%" height="100%" fill="url(#heroOverlay)"/>`
      : `<rect width="100%" height="100%" fill="url(#bg)"/>
         <rect width="100%" height="100%" fill="url(#depth)"/>`;
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
    <linearGradient id="heroOverlay" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,0.40)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.78)"/>
    </linearGradient>
  </defs>
  ${bgRect}
  <text x="${W / 2}" y="100" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="48" fill="white" font-weight="800" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.40));">${this.escapeXml(title)}</text>
  ${colSvg}
</svg>`.trim();

    // Si usamos hero: bajar la imagen, cover 1032×336, y componer SVG encima.
    // Si falla la red: fallback al SVG-only para no romper el render.
    let baseImage: Buffer | null = null;
    if (usingHero && heroImageUrl) {
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
          `[PASS HERO] heroImageUrl fetch falló: ${e?.message ?? e} — fallback gradient`,
        );
      }
    }
    const compositeBase = baseImage
      ? sharp(baseImage).composite([{ input: Buffer.from(svg, 'utf8') }])
      : sharp(Buffer.from(svg, 'utf8'));
    return compositeBase.png().toBuffer();
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
    const waStrip = await this.getWalletAdvancedForTenant(pass.tenantId);
    const result = await this.generateStampsStrip({
      primary: pass.card.primaryColor,
      secondary: pass.card.secondaryColor,
      required,
      stamped,
      icon: c.stampIcon || '☕',
      stampIconImageUrl: c.stampIconImageUrl ?? null,
      stampActiveColor: c.stampActiveColor ?? null,
      stampInactiveColor: c.stampInactiveColor ?? null,
      stampContourColor: c.stampContourColor ?? null,
      centerBgColor: c.centerBgColor ?? null,
      // Opción 2 (glassmorphism con foto hero) — si la card tiene
      // heroImageUrl, la usamos como base del strip con overlay oscuro
      // y los sellos en glass encima. Sino, fallback al gradient actual.
      heroImageUrl: c.heroImageUrl ?? null,
      // Wallet V3 — fondo del área de sellos EFECTIVO (gate de render de
      // customBackgrounds, ver effectiveStampBg).
      ...this.effectiveStampBg(c, waStrip),
      freeRewards: waStrip.freeRewards ? ((c.freeRewards as any) ?? []) : [],
    });
    // Usamos la versión @2x (640×246) que se ve bien en Android y desktop.
    return result['strip@2x.png'] ?? result['strip.png'] ?? null;
  }

  /**
   * PREVIEW del strip de sellos para el panel (config aún NO guardada). Usa el
   * MISMO generador que produce el strip real del pase (`generateStampsStrip`)
   * — no reimplementa el dibujo — y devuelve las 3 imágenes PNG reales (data
   * URLs base64) en los estados VACÍO (0), MITAD (floor(n/2)) y COMPLETO (n).
   * No toca DB: recibe la config del cuerpo del request. Así el negocio ve la
   * imagen EXACTA que recibirá el cliente en su Wallet, sin persistir nada.
   */
  async previewStampStrips(cfg: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    stampsRequired?: number | null;
    stampIcon?: string | null;
    stampIconImageUrl?: string | null;
    stampActiveColor?: string | null;
    stampInactiveColor?: string | null;
    stampContourColor?: string | null;
    centerBgColor?: string | null;
    heroImageUrl?: string | null;
    stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE' | null;
    stampBgImageUrl?: string | null;
    freeRewards?: Array<{
      pos: number;
      text?: string | null;
      emoji?: string | null;
      circleColor?: string | null;
      textColor?: string | null;
      active?: boolean;
    }>;
  }): Promise<{ empty: string; half: string; full: string }> {
    // Clamp defensivo: el grid soporta hasta 2 filas; > ~20 se ve mal.
    const required = Math.min(
      Math.max(Math.floor(cfg.stampsRequired ?? 10), 1),
      20,
    );
    const base = {
      primary: cfg.primaryColor || '#6366F1',
      secondary: cfg.secondaryColor || '#A855F7',
      required,
      icon: cfg.stampIcon || '☕',
      stampIconImageUrl: cfg.stampIconImageUrl ?? null,
      stampActiveColor: cfg.stampActiveColor ?? null,
      stampInactiveColor: cfg.stampInactiveColor ?? null,
      stampContourColor: cfg.stampContourColor ?? null,
      centerBgColor: cfg.centerBgColor ?? null,
      heroImageUrl: cfg.heroImageUrl ?? null,
      stampBgType: cfg.stampBgType ?? undefined,
      stampBgImageUrl: cfg.stampBgImageUrl ?? null,
      freeRewards: cfg.freeRewards ?? [],
    };
    const counts = [0, Math.floor(required / 2), required];
    const [emptyR, halfR, fullR] = await Promise.all(
      counts.map((stamped) =>
        this.generateStampsStrip({ ...base, stamped }),
      ),
    );
    const toDataUri = (r: Record<string, Buffer>): string => {
      const buf = r['strip@2x.png'] ?? r['strip.png'];
      return `data:image/png;base64,${buf.toString('base64')}`;
    };
    return {
      empty: toDataUri(emptyR),
      half: toDataUri(halfR),
      full: toDataUri(fullR),
    };
  }

  private async generateStampsStrip(opts: {
    primary: string;
    secondary: string;
    required: number;
    stamped: number;
    icon: string;
    /** Ícono de sello personalizado (imagen PNG/SVG). Si está, se usa en lugar
     *  del emoji: lleno = a color, vacío = atenuado. */
    stampIconImageUrl?: string | null;
    stampActiveColor?: string | null;
    stampInactiveColor?: string | null;
    stampContourColor?: string | null;
    centerBgColor?: string | null;
    heroImageUrl?: string | null;
    // Wallet V3 — modo de fondo del área de sellos:
    //   GRADIENT (legacy) | SOLID (uniforme = color de la tarjeta) | IMAGE.
    stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
    stampBgImageUrl?: string | null;
    // Wallet V3 — Premios Free: se dibujan DENTRO del círculo en su posición
    // (badge 🎁 en la esquina + texto). pos es 1-based.
    freeRewards?: Array<{
      pos: number;
      text?: string | null;
      emoji?: string | null;
      circleColor?: string | null;
      textColor?: string | null;
      active?: boolean;
    }>;
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
      heroImageUrl,
      stampBgImageUrl,
    } = opts;
    // Wallet V3 — Premios Free por posición (1-based). Solo los activos.
    const prizeByPos = new Map<number, NonNullable<typeof opts.freeRewards>[number]>();
    for (const fr of opts.freeRewards ?? []) {
      if (fr && fr.active !== false && Number.isFinite(fr.pos)) prizeByPos.set(Math.floor(fr.pos), fr);
    }
    const hasPrizes = prizeByPos.size > 0;
    // Sin stampBgType (llamadas viejas / tarjetas legacy) → GRADIENT, el
    // comportamiento actual, para no cambiar el aspecto de tarjetas existentes.
    const bgType = opts.stampBgType ?? 'GRADIENT';
    // Imagen base detrás de los sellos:
    //  - IMAGE: la imagen dedicada del área de sellos (Wallet V3).
    //  - GRADIENT + heroImageUrl (modo "glass" legacy): se mantiene para no
    //    romper tarjetas viejas que usaban la foto hero como fondo del strip.
    //  - SOLID: sin imagen (fondo uniforme).
    const bgImageUrl =
      bgType === 'IMAGE'
        ? stampBgImageUrl || null
        : bgType === 'GRADIENT'
          ? heroImageUrl || null
          : null;
    // Defaults estilo Starbucks / Apple Wallet: filled = blanco sólido,
    // empty = relleno sutil glassmorphism sin borde marcado. El contorno
    // sólo se dibuja si el tenant lo configuró explícitamente.
    // Cuando hay heroImageUrl (modo glass): los vacíos se ven más sutiles
    // para no competir con la foto, y los llenos quedan blancos puros.
    const usingImage = !!bgImageUrl;
    const fillFull = stampActiveColor ?? '#FFFFFF';
    const fillEmpty =
      stampInactiveColor ?? (usingImage ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.13)');
    const customStroke = stampContourColor ?? null;

    // Resolvemos el renderer del ícono UNA vez (todos los sellos usan el
    // mismo). Emojis con dibujo curado → SVG gourmet; cualquier otro →
    // Twemoji color (antes caía a un check). Bug fix 2026-06-15.
    const iconRenderer = await resolveStampIconRenderer(icon);

    // Ícono de sello PERSONALIZADO (imagen propia). Si carga bien, reemplaza al
    // emoji: sello lleno = imagen a color; sello vacío = misma imagen atenuada
    // (decisión "tu imagen atenuada"). Si la imagen falla → cae al emoji.
    const customUrl = (opts.stampIconImageUrl || '').trim();
    const customFull = customUrl
      ? await resolveCustomImageRenderer(customUrl, { opacity: 1 })
      : null;
    const customFaded = customUrl
      ? await resolveCustomImageRenderer(customUrl, { opacity: 0.34 })
      : null;

    // Wallet V3 — renderers de Premios Free: badge 🎁 (esquina) + emoji propio
    // de cada premio. Emoji color va por Twemoji (no por <text>).
    const giftBadgeRenderer = hasPrizes ? await resolveStampIconRenderer('🎁') : null;
    const prizeEmojiRenderers = new Map<string, typeof iconRenderer>();
    if (hasPrizes) {
      for (const fr of prizeByPos.values()) {
        const e = (fr.emoji || '').trim();
        if (e && !prizeEmojiRenderers.has(e)) {
          prizeEmojiRenderers.set(e, await resolveStampIconRenderer(e));
        }
      }
    }

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

    // Wallet V3 — dibuja un círculo de Premio Free: fondo (colorCírculo o el
    // relleno normal), emoji + texto (≤2 líneas) dentro, y badge 🎁 en la
    // esquina superior derecha para que se lea "hay un premio aquí".
    const renderPrize = (
      cx: number,
      cy: number,
      prize: NonNullable<typeof opts.freeRewards>[number],
      filled: boolean,
    ): string[] => {
      const out: string[] = [];
      const bg = prize.circleColor || (filled ? fillFull : fillEmpty);
      const shadow = filled ? ' filter="url(#stampShadow)"' : '';
      out.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${bg}"${shadow}/>`);
      const emoji = (prize.emoji || '').trim();
      const text = (prize.text || '').trim();
      const txtColor = prize.textColor || (filled ? '#111827' : '#FFFFFF');
      const emojiR = emoji ? prizeEmojiRenderers.get(emoji) : null;
      const uid = `p${Math.round(cx)}_${Math.round(cy)}`;
      const textLines = (t: string, fs: number, baseY: number) => {
        const lines = this.splitLines(t.toUpperCase(), 9, 2);
        lines.forEach((ln, li) => {
          out.push(
            `<text x="${cx}" y="${baseY + li * fs * 1.05}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${fs}" font-weight="800" fill="${txtColor}">${this.escapeXml(ln)}</text>`,
          );
        });
      };
      if (emojiR && text) {
        out.push(emojiR(cx, cy - radius * 0.3, radius * 0.72, uid));
        textLines(text, Math.max(9, radius * 0.34), cy + radius * 0.36);
      } else if (emojiR) {
        out.push(emojiR(cx, cy, radius * 1.05, uid));
      } else if (text) {
        const fs = Math.max(10, radius * 0.4);
        const start = cy - (this.splitLines(text.toUpperCase(), 9, 2).length - 1) * fs * 0.52 + fs * 0.34;
        textLines(text, fs, start);
      }
      if (giftBadgeRenderer) {
        const bx = cx + radius * 0.6;
        const by = cy - radius * 0.6;
        const br = radius * 0.44;
        out.push(`<circle cx="${bx}" cy="${by}" r="${br * 0.95}" fill="#FFFFFF" filter="url(#stampShadow)"/>`);
        out.push(giftBadgeRenderer(bx, by, br * 1.45, `${uid}b`));
      }
      return out;
    };

    const circles: string[] = [];
    for (let i = 0; i < required; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const cx = padX + col * (cellW + gap) + cellW / 2;
      const cy = padY + row * (cellH + gap) + cellH / 2;
      const filled = i < stamped;

      const prize = prizeByPos.get(i + 1);
      if (prize) {
        circles.push(...renderPrize(cx, cy, prize, filled));
        continue;
      }

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
        // Emoji: tamaño ≈55% del diámetro (radius * 1.1 = 55% de 2r).
        // Imagen propia: llena el círculo COMPLETO (diámetro = radius * 2) y va
        // recortada en círculo; si no, queda un anillo blanco alrededor.
        circles.push(
          customFull
            ? customFull(cx, cy, radius * 2, `${i}`)
            : iconRenderer(cx, cy, radius * 1.1, `${i}`),
        );
      } else {
        // Vacío: glassmorphism sutil sin borde. Borde sólo si el tenant
        // configuró stampContourColor.
        const strokeAttr = customStroke
          ? ` stroke="${customStroke}" stroke-width="1" stroke-opacity="0.32"`
          : '';
        circles.push(
          `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fillEmpty}"${strokeAttr}/>`,
        );
        // Con ícono personalizado, el vacío también muestra la imagen atenuada.
        if (customFaded) {
          circles.push(customFaded(cx, cy, radius * 2, `${i}`));
        }
      }
    }

    // Background del strip según el modo (Wallet V3):
    //  - IMAGE / glass legacy (usingImage): foto base + overlay oscuro para
    //    legibilidad de los sellos. El SVG se compone ENCIMA de la foto.
    //  - SOLID (uniforme): color plano = centerBgColor o el primaryColor de la
    //    tarjeta, SIN degradado ni gloss → "área de sellos = color tarjeta".
    //  - GRADIENT (legacy): gradiente diagonal de la card + gloss sutil.
    const solidBg = centerBgColor ? centerBgColor : primary;
    const legacyBgFill = centerBgColor ? centerBgColor : 'url(#bg)';
    // IMAGE sin imagen cargada → uniforme (no caer al degradado legacy).
    const solidMode = bgType === 'SOLID' || bgType === 'IMAGE';
    const bgRect = usingImage
      ? `<rect width="100%" height="100%" fill="url(#heroOverlay)"/>`
      : solidMode
        ? `<rect width="100%" height="100%" fill="${solidBg}"/>`
        : `<rect width="100%" height="100%" fill="${legacyBgFill}"/>
         <rect width="100%" height="100%" fill="url(#gloss)"/>`;
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
    <linearGradient id="heroOverlay" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,0.30)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.75)"/>
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
  ${bgRect}
  ${circles.join('\n  ')}
</svg>`.trim();

    // Si usamos hero: bajamos la imagen, cover 640×246, y componemos el SVG
    // del overlay + sellos encima. Si falla la red, fallback al SVG-only
    // (gradient + sellos) para no romper el strip.
    let baseImage: Buffer | null = null;
    if (usingImage && bgImageUrl) {
      try {
        const res = await fetch(bgImageUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          baseImage = await sharp(buf)
            .resize(W, H, { fit: 'cover', position: 'center' })
            .png()
            .toBuffer();
        }
      } catch (e: any) {
        this.logger.warn(
          `[STAMPS STRIP] fondo de sellos fetch falló: ${e?.message ?? e} — fallback color`,
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
    logoBgColor?: string | null,
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
      // fondo del pase en vez de mostrar un cuadro blanco detrás.
      // OJO: solo el blanco CONECTADO al borde (flood-fill) — el fondo real.
      // Las letras/detalles blancos dentro del logo se conservan; el
      // chroma-key global anterior los borraba también y el logo quedaba
      // ilegible (PDF de peticiones de clientes 2026-08).
      const prepared = await this.prepareLogoForWallet(src);

      // Chip/fondo detrás del logo (opcional, por tarjeta). Si el negocio lo
      // activó, aplanamos el logo (que puede haber quedado transparente tras
      // el chroma-key, o traer contenido blanco) SOBRE ese color → el logo
      // vuelve a ser visible. Sin chip, se mantiene el fondo transparente
      // histórico (logo sobre el gradiente del pase).
      const chip = this.parseChipColor(logoBgColor);
      const make = (w: number, h: number) => {
        const img = sharp(prepared).resize(w, h, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
        return (chip ? img.flatten({ background: chip }) : img)
          .png()
          .toBuffer();
      };
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
   * vuelve transparente SOLO el blanco conectado al borde de la imagen (el
   * fondo real) para que se integre con el fondo del pase. Los blancos
   * interiores — letras o detalles blancos dentro del logo — se conservan:
   * quitarlos dejaba el logo ilegible (PDF de peticiones de clientes
   * 2026-08). Si la fuente ya tiene transparencia REAL (al menos un píxel
   * con alpha != 255), se respeta el diseño original completo — ahí el
   * diseñador ya decidió qué es fondo vs. qué es contenido.
   */
  /** Parsea el color del chip/fondo del logo (#rgb o #rrggbb) a {r,g,b}
   *  para sharp. Devuelve null si viene vacío, 'transparent' o inválido
   *  (= sin chip). */
  private parseChipColor(
    hex?: string | null,
  ): { r: number; g: number; b: number } | null {
    if (!hex) return null;
    let h = hex.trim().replace(/^#/, '');
    if (h.toLowerCase() === 'transparent') return null;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

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

    // Fuente plana sin transparencia → recortar el fondo blanco por
    // flood-fill desde los bordes. Un logo SIN blanco en el borde (p. ej.
    // letras blancas sobre fondo de color) sale intacto.
    const out = removeBorderConnectedWhite(data, info.width, info.height);
    return sharp(Buffer.from(out.buffer, out.byteOffset, out.byteLength), {
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
  async pushPassUpdate(
    passId: string,
    opts: { silent?: boolean; message?: { header: string; body: string } } = {},
  ) {
    // Google Wallet PATCH — propaga sellos/saldo/visitas/tier a Android.
    // En paralelo con APNs para que ambos lleguen lo antes posible. En modo
    // silent (refresh global), Google actualiza sin notificar; Apple ya es
    // silencioso por diseño (re-fetch del .pkpass sin alerta).
    const googlePromise = this.googleWallet.pushUpdate(passId, opts).catch((e) => {
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

  // ============================================================
  //              .pkpass DE RESERVA (eventTicket)
  // ============================================================

  /**
   * Genera un .pkpass eventTicket para una reserva de restaurante.
   *
   * A diferencia del pkpass de fidelización (`generateApplePass`), este
   * es one-off:
   *  - No persiste en BD ni linkea con `webServiceURL` para updates push.
   *  - Si la reserva cambia (CANCELLED/SEATED), el cliente vuelve al pase
   *    web `/r/pase/<token>` y re-descarga.
   *  - Reusa el cert + WWDR del programa de fidelización (mismo Team ID).
   *
   * Si los certs no están configurados, devuelve un mock JSON del passJson
   * para no bloquear el flujo dev.
   */
  async generateReservationPkpass(reservationId: string): Promise<Buffer> {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            brandName: true,
            primaryColor: true,
            logoUrl: true,
            walletLogoUrl: true,
            pushLogoUrl: true,
            timezone: true,
            locations: {
              where: { isActive: true },
              select: {
                latitude: true,
                longitude: true,
                walletRelevantText: true,
                radiusMeters: true,
              },
            },
          },
        },
        zone: { select: { name: true } },
        table: { select: { number: true } },
      },
    });
    if (!r) throw new NotFoundException('Reservation');

    // Fallback = nombre del negocio, nunca 'Clubify' (fuga en pase marca blanca).
    const brandName = (r.tenant.brandName || r.tenant.name).trim() || r.tenant.name;
    const resBrand = await this.brand.resolveTenant(r.tenant.id);
    const resBrandHref = resBrand.websiteUrl;
    const resBrandDomain = resBrand.websiteUrl.replace(/^https?:\/\//, '');
    const dateStr = r.date.toISOString().slice(0, 10);
    const primary = r.tenant.primaryColor || '#22C55E';

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier:
        process.env.APPLE_PASS_TYPE_ID ?? 'pass.com.clubify.loyalty',
      teamIdentifier: process.env.APPLE_TEAM_ID ?? 'XXXXXXXXXX',
      organizationName: brandName,
      // Apple requiere serialNumber único — usamos el ID de la reserva con
      // prefijo para no chocar con serials de Pass (loyalty).
      serialNumber: `res_${r.id}`,
      description: `Reserva en ${brandName}`,
      logoText: brandName,
      foregroundColor: 'rgb(255,255,255)',
      backgroundColor: this.hexToRgb(primary),
      labelColor: 'rgb(245,241,232)',
      barcodes: [
        {
          // PDF 2026-06-30: mismo estilo de código de barras que las tarjetas
          // de fidelización (PDF417, 1D) en vez de QR.
          format: 'PKBarcodeFormatPDF417',
          message: `clubify-reservation:${r.id}`,
          altText: r.id.slice(0, 8).toUpperCase(),
          messageEncoding: 'iso-8859-1',
        },
      ],
      // Apple Wallet lockscreen relevance: cuando el iPhone está cerca de
      // alguna location del tenant, muestra el pase en lockscreen.
      locations: r.tenant.locations.map((l) => ({
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
        relevantText:
          l.walletRelevantText?.trim() || `Tu reserva en ${brandName}`,
      })),
      maxDistance: r.tenant.locations.reduce(
        (max, l) => Math.max(max, l.radiusMeters || 300),
        300,
      ),
      // `relevantDate` activa el pase en lockscreen unas horas antes del
      // momento real. Usamos el instante UTC computed con timezone tenant.
      relevantDate: this.reservationUtcInstant(
        r.date,
        r.time,
        r.tenant.timezone || 'America/Bogota',
      ).toISOString(),
      eventTicket: {
        headerFields: [
          { key: 'time', label: 'HORA', value: r.time },
        ],
        primaryFields: [
          { key: 'event', label: 'RESERVA', value: brandName },
        ],
        // PDF 2026-06-30: mostrar SIEMPRE la zona y la mesa elegida (antes
        // mostraba solo una de las dos).
        secondaryFields: [
          { key: 'date', label: 'FECHA', value: dateStr },
          { key: 'zone', label: 'ZONA', value: r.zone?.name ?? 'Por asignar' },
        ],
        auxiliaryFields: [
          { key: 'name', label: 'TITULAR', value: r.customerName },
          {
            key: 'table',
            label: 'MESA',
            value: r.table?.number ? `Mesa ${r.table.number}` : '—',
          },
          { key: 'party', label: 'PERSONAS', value: String(r.party) },
        ],
        backFields: [
          { key: 'reservation', label: 'Reserva', value: r.id.slice(0, 8).toUpperCase() },
          { key: 'phone', label: 'Teléfono', value: r.customerPhone },
          {
            key: 'powered',
            label: `Creado por ${resBrand.name}`,
            value: resBrandHref,
            attributedValue: `<a href="${resBrandHref}">${resBrandDomain}</a>`,
          },
        ],
      },
    };

    const certPem = this.loadAppleCert();
    const wwdrPem = this.loadAppleWwdr();

    if (!certPem || !wwdrPem) {
      this.logger.warn(
        'Apple Wallet certs not configured; returning mock reservation pass.json',
      );
      return Buffer.from(JSON.stringify(passJson, null, 2));
    }

    const { PKPass } = await import('passkit-generator');

    // Imágenes del tenant — icon (push notification) + logo (header del pase).
    const normalize = (u: any): string | null =>
      typeof u === 'string' && u.trim() ? u.trim() : null;
    const logoCandidates = [
      normalize(r.tenant.walletLogoUrl),
      normalize(r.tenant.logoUrl),
      // Nivel 2: logo de la marca blanca propietaria (Sellea→Sellea, no Clubify).
      normalize(resBrand.logoUrl),
      normalize(resBrand.iconUrl),
    ].filter((u): u is string => u !== null);
    let tenantLogos: Record<string, Buffer> = {};
    let usedLogoUrl: string | null = null;
    for (const url of logoCandidates) {
      const attempt = await this.generateTenantLogos(url);
      const main = attempt['logo.png'];
      if (main && main.length >= 500) {
        tenantLogos = attempt;
        usedLogoUrl = url;
        break;
      }
    }
    const pushLogoUrl =
      normalize(r.tenant.pushLogoUrl) ?? usedLogoUrl ?? logoCandidates[0] ?? null;
    const tenantIcons = await this.generateTenantIcons(pushLogoUrl);

    const buffers: Record<string, Buffer> = {
      'pass.json': Buffer.from(JSON.stringify(passJson)),
      ...this.loadDefaultImages(),
      ...tenantIcons,
      ...tenantLogos,
    };

    const blob = certPem.toString('utf8');
    const certOnly = this.extractPemBlock(blob, 'CERTIFICATE');
    const keyOnly =
      this.extractPemBlock(blob, 'RSA PRIVATE KEY') ||
      this.extractPemBlock(blob, 'PRIVATE KEY') ||
      this.extractPemBlock(blob, 'ENCRYPTED PRIVATE KEY');

    if (!certOnly || !keyOnly) {
      this.logger.warn(
        `Apple cert/key no separables para reserva (cert=${!!certOnly}, key=${!!keyOnly}); mock`,
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

  /** Mismo round-trip Intl que ReservationsService.reservationMomentUtc.
   *  Duplicado mínimo aquí para no romper el contrato privado del service
   *  de reservas. Devuelve el instante UTC del momento local de la reserva. */
  private reservationUtcInstant(
    date: Date,
    time: string,
    timezone: string,
  ): Date {
    const [h, m] = time.split(':').map(Number);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth();
    const d = date.getUTCDate();
    const asUtc = Date.UTC(y, mo, d, h, m, 0);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date(asUtc));
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? 0);
    let tzH = get('hour');
    if (tzH === 24) tzH = 0;
    const projected = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      tzH,
      get('minute'),
      get('second'),
    );
    const offset = projected - asUtc;
    return new Date(asUtc - offset);
  }
}
