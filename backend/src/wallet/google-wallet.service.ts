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
    // COUPON single-use: balance es el estado del cupón.
    // DISPONIBLE antes del REDEEM, REDIMIDO después.
    if (t === 'COUPON') {
      const redeemed = pass.status === 'COMPLETED';
      return {
        balance: { string: redeemed ? 'REDIMIDO' : 'DISPONIBLE' },
        label: 'Cupón',
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
      const apiUrl = process.env.API_URL || 'https://api.soyclubify.com';
      const cacheBust = pass.lastActivityAt
        ? new Date(pass.lastActivityAt).getTime()
        : Date.now();
      // 1° hero — banner con título + stats (sellos faltantes, recompensas,
      // premio siguiente). Aparece como primer image module.
      imageModules.push({
        id: 'hero',
        mainImage: {
          sourceUri: {
            uri: `${apiUrl}/api/passes/${pass.id}/hero.png?v=${cacheBust}`,
          },
          contentDescription: {
            defaultValue: { language: 'es', value: 'Acumula sellos' },
          },
        },
      });
      // 2° strip — grilla de sellos con cookies/iconos.
      imageModules.push({
        id: 'strip',
        mainImage: {
          sourceUri: {
            uri: `${apiUrl}/api/passes/${pass.id}/strip.png?v=${cacheBust}`,
          },
          contentDescription: {
            defaultValue: { language: 'es', value: 'Tus sellos' },
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
    const base =
      pass.tenant.walletLogoUrl ||
      pass.tenant.logoUrl ||
      `${publicBase}/icons/icon-512.png`;
    // CACHE-BUST 2026-06-15: Google Wallet cachea las imágenes por URL. Sin
    // esto, cambiar el logo NO se reflejaba aunque patcheáramos la clase con
    // la misma URL. Usamos pass.lastActivityAt (igual que hero/strip): el
    // "Refresh global de wallets" lo bumpea, forzando a Google a re-descargar
    // el logo. (FIX: antes usaba tenant.updatedAt, campo que NO existe en el
    // modelo → era undefined → cache-bust nunca aplicaba.) R2 ignora el ?v.
    const v = pass?.lastActivityAt
      ? new Date(pass.lastActivityAt).getTime()
      : null;
    if (!v) return base;
    return base.includes('?') ? `${base}&v=${v}` : `${base}?v=${v}`;
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

  /**
   * Genera header+body de la notificación push de Android según el estado
   * actual del pase. Equivalente a `buildBalance` pero formateado para que
   * el usuario lo vea en la barra de notificaciones de Android.
   */
  private buildNotificationText(pass: any): { header: string; body: string } {
    const t = pass.card.type;
    const brand = pass.tenant?.brandName || pass.card.name || 'Tu tarjeta';
    if (t === 'CASHBACK') {
      const v = Math.round(Number(pass.cashbackBalance ?? 0));
      return {
        header: brand,
        body: `Saldo cashback: $${v.toLocaleString('es-CO')}`,
      };
    }
    if (t === 'VISITS') {
      return {
        header: brand,
        body: `Visitas: ${pass.visitsCount ?? 0}/${pass.card.visitsRequired ?? 10}`,
      };
    }
    if (t === 'POINTS') {
      return {
        header: brand,
        body: `Tienes ${Math.round(Number(pass.pointsBalance ?? 0))} puntos`,
      };
    }
    if (t === 'MEMBERSHIP') {
      return { header: brand, body: `Nivel: ${pass.currentTier || 'Miembro'}` };
    }
    if (t === 'DISCOUNT') {
      return {
        header: brand,
        body: `Descuento ${pass.card.discountPercent ?? 10}% disponible`,
      };
    }
    if (t === 'COUPON') {
      const redeemed = pass.status === 'COMPLETED';
      return {
        header: brand,
        body: redeemed ? 'Cupón redimido' : 'Cupón disponible',
      };
    }
    return {
      header: brand,
      body: `Sellos: ${pass.stampsCount ?? 0}/${pass.card.stampsRequired ?? 10}`,
    };
  }

  async pushUpdate(
    passId: string,
    opts: { silent?: boolean } = {},
  ): Promise<{ ok: boolean; status: string; notified?: boolean; error?: string }> {
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

      // PATCH de la CLASE: el logo (programLogo), el color de fondo y el
      // nombre del programa viven en el LoyaltyClass, no en el Object. Si no
      // patcheamos la clase, cambiar el logo/branding NO se reflejaba en el
      // pase instalado (fix 2026-06-15). El logoUri lleva cache-bust por
      // tenant.updatedAt para que Google re-descargue la imagen.
      try {
        const logoUri = this.resolveLogoUri(pass);
        const classBody = this.buildClass(pass, ids.classId, logoUri);
        await wallet.loyaltyclass.patch({
          resourceId: ids.classId,
          requestBody: classBody as any,
        });
        this.logger.log(`Google Wallet class patched: ${ids.classId}`);
      } catch (e: any) {
        // No bloquea el update del objeto si el patch de clase falla.
        this.logger.warn(
          `Google Wallet class patch failed: ${e?.message ?? e}`,
        );
      }

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

      // PATCH no dispara notificación push en Android. Para que el usuario
      // vea un toast en la barra de notificaciones (equivalente al APNs
      // silent push que re-renderiza Apple Wallet con un haptic) hay que
      // POST `loyaltyobject/{id}/addMessage` con `messageType: TEXT_AND_NOTIFY`.
      // En modo silent (refresh global masivo) lo OMITIMOS: la clase/objeto ya
      // quedaron actualizados (logo/strip/branding), pero no spameamos al
      // cliente con una notificación.
      let notified = false;
      if (!opts.silent)
      try {
        const { header, body } = this.buildNotificationText(pass);
        const msgId = `update-${Date.now()}`;
        await wallet.loyaltyobject.addmessage({
          resourceId: pass.googleObjectId,
          requestBody: {
            message: {
              id: msgId,
              header,
              body,
              messageType: 'TEXT_AND_NOTIFY',
            },
          } as any,
        });
        notified = true;
        this.logger.log(
          `Google Wallet notify sent: ${pass.googleObjectId} → "${body}"`,
        );
      } catch (e: any) {
        const code = e?.code || e?.response?.status;
        this.logger.warn(
          `Google Wallet addMessage failed (${code}): ${e?.message ?? e}`,
        );
      }

      return { ok: true, status: 'patched', notified };
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

  // ============================================================
  //               EVENT TICKET — PASE DE RESERVA
  // ============================================================

  /**
   * Genera el save URL de Google Wallet para una reserva. Usa
   * EventTicketClass/Object (en vez de LoyaltyClass que es para
   * fidelización) porque modela mejor un ticket con fecha+venue+seat.
   *
   * El cliente abre el URL desde Android Chrome → "Add to Google Wallet"
   * one-shot install. No requiere pre-crear la class (inline JWT crea
   * todo on-the-fly al primer save).
   *
   * NO persiste un objectId en BD — a diferencia del Pass de fidelización,
   * la reserva es one-off y no necesitamos hacer PATCH posterior. Si el
   * estado cambia (CANCELLED, SEATED), el cliente puede volver al pase
   * web y re-instalar.
   */
  async generateReservationSaveUrl(reservationId: string): Promise<string> {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        tenant: {
          select: {
            id: true,
            brandName: true,
            primaryColor: true,
            logoUrl: true,
            timezone: true,
          },
        },
        zone: { select: { name: true } },
        table: { select: { number: true } },
      },
    });
    if (!r) throw new NotFoundException('Reservation');

    const sa = this.loadServiceAccount();
    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
    if (!sa || !issuerId) {
      this.logger.warn(
        'Google Wallet not configured; returning mock URL for reservation',
      );
      return `https://pay.google.com/gp/v/save/MOCK_RES_${reservationId}`;
    }

    const safe = (s: string) => s.replace(/[^a-zA-Z0-9._]/g, '_');
    const classId = `${issuerId}.reservation_class_${safe(r.tenantId)}`;
    const objectId = `${issuerId}.reservation_${safe(r.id)}`;

    const tz = r.tenant.timezone || 'America/Bogota';
    const startIso = this.formatReservationDateTimeIso(r.date, r.time, tz, 0);
    const endIso = this.formatReservationDateTimeIso(r.date, r.time, tz, 120);
    const seatLabel = r.table?.number
      ? `Mesa ${r.table.number}`
      : r.zone?.name ?? 'Por asignar';
    const logoUri = r.tenant.logoUrl || undefined;
    const bgColor = r.tenant.primaryColor || '#22C55E';

    const eventClass: Record<string, unknown> = {
      id: classId,
      issuerName: r.tenant.brandName,
      eventName: {
        defaultValue: { language: 'es', value: `Reserva · ${r.tenant.brandName}` },
      },
      venue: {
        name: { defaultValue: { language: 'es', value: r.tenant.brandName } },
        address: { defaultValue: { language: 'es', value: r.tenant.brandName } },
      },
      dateTime: { start: startIso, end: endIso },
      hexBackgroundColor: bgColor,
      reviewStatus: 'UNDER_REVIEW',
      ...(logoUri
        ? {
            logo: {
              sourceUri: { uri: logoUri },
              contentDescription: {
                defaultValue: { language: 'es', value: r.tenant.brandName },
              },
            },
          }
        : {}),
    };

    const eventObject: Record<string, unknown> = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      ticketHolderName: r.customerName,
      seatInfo: {
        seat: { defaultValue: { language: 'es', value: seatLabel } },
      },
      barcode: {
        type: 'QR_CODE',
        value: `clubify-reservation:${r.id}`,
        alternateText: r.id.slice(0, 8).toUpperCase(),
      },
      textModulesData: [
        { id: 'party', header: 'Personas', body: String(r.party) },
        { id: 'time', header: 'Hora', body: r.time },
      ],
      hexBackgroundColor: bgColor,
    };

    const claims = {
      iss: sa.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: {
        eventTicketClasses: [eventClass],
        eventTicketObjects: [eventObject],
      },
    };
    const token = sign(claims, sa.private_key, { algorithm: 'RS256' });
    return `https://pay.google.com/gp/v/save/${token}`;
  }

  /**
   * Formatea el momento de la reserva como ISO 8601 con offset numérico
   * (`YYYY-MM-DDTHH:MM:SS±HH:MM`). Google Wallet usa este formato para
   * `dateTime.start/end`. Maneja DST: el offset se computa para ese
   * instante específico vía Intl.DateTimeFormat con timeZoneName.
   */
  private formatReservationDateTimeIso(
    date: Date,
    time: string,
    timezone: string,
    addMinutes = 0,
  ): string {
    const [h, m] = time.split(':').map(Number);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth();
    const d = date.getUTCDate();
    // Treat the local wall time as if it were UTC to get an instant we can
    // ask Intl to render in the target TZ. Round-trip → derive offset.
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
    const offsetMs = projected - asUtc;
    const realUtc = new Date(asUtc - offsetMs + addMinutes * 60_000);

    // Componentes "wall time" en el timezone target para el instante real.
    const wallParts = fmt.formatToParts(realUtc);
    const wallGet = (t: string) =>
      String(wallParts.find((p) => p.type === t)?.value ?? '00');
    let wallH = Number(wallGet('hour'));
    if (wallH === 24) wallH = 0;
    const dateStr = `${wallGet('year')}-${wallGet('month')}-${wallGet('day')}`;
    const timeStr = `${String(wallH).padStart(2, '0')}:${wallGet(
      'minute',
    )}:${wallGet('second')}`;

    // Offset numérico ±HH:MM derivado de timeZoneName: 'shortOffset'.
    const offFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const offParts = offFmt.formatToParts(realUtc);
    const offRaw =
      offParts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const match = offRaw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    let offset = 'Z';
    if (match) {
      const sign = match[1];
      const hh = String(match[2]).padStart(2, '0');
      const mm = match[3] ? String(match[3]).padStart(2, '0') : '00';
      offset = `${sign}${hh}:${mm}`;
    }
    return `${dateStr}T${timeStr}${offset}`;
  }
}
