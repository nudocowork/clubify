import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AutomationsService } from '../automations/automations.service';

@Injectable()
export class PassesService {
  constructor(
    private prisma: PrismaService,
    private automations: AutomationsService,
    private appConfig: AppConfigService,
  ) {}

  private guardTenant(user: AuthUser, tenantId: string) {
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== tenantId) {
      throw new ForbiddenException();
    }
  }

  async issue(user: AuthUser, cardId: string, customerId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card');
    this.guardTenant(user, card.tenantId);

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.tenantId !== card.tenantId) {
      throw new NotFoundException('Customer not in this tenant');
    }

    const existing = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId, customerId } },
    });
    if (existing) return existing;

    const serial = `CLB-${nanoid(10).toUpperCase()}`;
    const authToken = nanoid(32);
    const qrToken = sign(
      { pid: '__placeholder__', tid: card.tenantId },
      this.appConfig.QR_HMAC_SECRET,
      { algorithm: 'HS256' },
    );

    const pass = await this.prisma.pass.create({
      data: {
        tenantId: card.tenantId,
        cardId,
        customerId,
        serialNumber: serial,
        qrToken,
        authToken,
      },
    });

    const finalQr = sign(
      { pid: pass.id, tid: card.tenantId },
      this.appConfig.QR_HMAC_SECRET,
      { algorithm: 'HS256' },
    );
    const updated = await this.prisma.pass.update({ where: { id: pass.id }, data: { qrToken: finalQr } });

    // Hook PASS_CREATED — dispara mensaje de bienvenida si hay regla activa.
    this.automations
      .emit('PASS_CREATED', {
        tenantId: card.tenantId,
        customerId,
        cardId,
        passId: pass.id,
        customerName: customer.fullName,
        cardName: card.name,
      })
      .catch(() => null);

    return updated;
  }

  async get(user: AuthUser, id: string) {
    const pass = await this.prisma.pass.findUnique({
      where: { id },
      include: { card: true, customer: true, tenant: true },
    });
    if (!pass) throw new NotFoundException('Pass');
    if (user.role !== 'SUPER_ADMIN' && pass.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return pass;
  }

  async getPublic(id: string) {
    const pass = await this.prisma.pass.findUnique({
      where: { id },
      include: {
        card: true,
        customer: { select: { id: true, fullName: true } },
        tenant: { select: { brandName: true, logoUrl: true, primaryColor: true } },
      },
    });
    if (!pass) throw new NotFoundException('Pass');
    return pass;
  }

  /**
   * Búsqueda pública desde el storefront: dado un slug de tenant y un teléfono,
   * devuelve los pases activos del cliente. Usado por el tab "Mi tarjeta".
   * Normaliza el teléfono a últimos dígitos para tolerar variaciones de formato.
   */
  async findByPhonePublic(slug: string, phoneRaw: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('Tenant');

    const digits = (phoneRaw || '').replace(/\D/g, '');
    if (digits.length < 7) {
      return { passes: [] };
    }

    const tail = digits.slice(-10);

    const customers = await this.prisma.customer.findMany({
      where: {
        tenantId: tenant.id,
        phone: { contains: tail },
      },
      select: { id: true, fullName: true },
    });

    if (customers.length === 0) return { passes: [] };

    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: tenant.id,
        customerId: { in: customers.map((c) => c.id) },
        status: 'ACTIVE',
      },
      include: {
        card: { select: { id: true, name: true, type: true, stampsRequired: true, primaryColor: true } },
        customer: { select: { id: true, fullName: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });

    return {
      passes: passes.map((p) => ({
        id: p.id,
        serialNumber: p.serialNumber,
        stampsCount: p.stampsCount,
        pointsBalance: Number(p.pointsBalance ?? 0),
        card: p.card,
        customer: p.customer,
      })),
    };
  }

  /**
   * Auto-enrollment público: el cliente final escanea el QR genérico de la
   * tarjeta, llena form (nombre + email + teléfono con código país) y queda
   * con un pase emitido. Si ya tiene pase para esta tarjeta, lo retorna sin
   * crear duplicado (match por teléfono normalizado).
   */
  async enrollPublic(
    cardId: string,
    dto: {
      fullName: string;
      email?: string;
      phone: string;
      birthday?: string;
      utmSlug?: string;
    },
  ) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { tenant: { select: { id: true, status: true } } },
    });
    if (!card || !card.isActive)
      throw new NotFoundException('Tarjeta no disponible');
    if (card.tenant.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    const phoneNorm = (dto.phone || '').replace(/\s/g, '').trim();
    if (phoneNorm.length < 8) {
      throw new ForbiddenException('Teléfono inválido');
    }

    const email = dto.email?.trim().toLowerCase() || null;

    // Match-or-create customer por teléfono exacto en este tenant
    let customer = await this.prisma.customer
      .findUnique({
        where: { tenantId_phone: { tenantId: card.tenantId, phone: phoneNorm } },
      })
      .catch(() => null);
    // Birthday: aceptamos YYYY-MM-DD. El año es ficticio (2000), solo
    // usamos día/mes para el cron BIRTHDAY que filtra por extract().
    const birthdayDate = dto.birthday ? new Date(dto.birthday) : null;
    const validBday =
      birthdayDate && !Number.isNaN(birthdayDate.getTime()) ? birthdayDate : null;

    if (!customer) {
      // HOTFIX 2026-06-05 (bug D): el match-or-create de customer no
      // estaba en transacción. Dos POST simultáneos del mismo teléfono
      // pasaban ambos por el findUnique → ambos llegaban al create →
      // uno tiraba P2002 sin handler → 500 al cliente. Con el catch
      // P2002 re-leemos el customer existente (lo creó el otro request)
      // y seguimos con ese.
      try {
        customer = await this.prisma.customer.create({
          data: {
            tenantId: card.tenantId,
            fullName: dto.fullName.trim(),
            phone: phoneNorm,
            email: email ?? undefined,
            birthday: validBday ?? undefined,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          customer = await this.prisma.customer.findUnique({
            where: {
              tenantId_phone: { tenantId: card.tenantId, phone: phoneNorm },
            },
          });
          if (!customer) throw e;
        } else {
          throw e;
        }
      }
    } else if (
      customer.fullName !== dto.fullName.trim() ||
      (email && !customer.email) ||
      (validBday && !customer.birthday)
    ) {
      // Actualizar nombre si cambió, email si lo deja por primera vez,
      // birthday si lo deja por primera vez (no sobreescribe si ya estaba).
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          fullName: dto.fullName.trim(),
          email: email ?? customer.email,
          birthday: validBday ?? customer.birthday,
        },
      });
    }

    // Si ya tiene pase para esta tarjeta, devolverlo (no duplicar)
    const existing = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId, customerId: customer.id } },
    });
    if (existing) {
      return { passId: existing.id, customerId: customer.id, isNew: false };
    }

    // Aplicamos bonus de bienvenida si vino vía link UTM con bonus activo.
    let bonusStamps = 0;
    let bonusPoints = 0;
    if (dto.utmSlug) {
      const utm = await this.prisma.cardUtmLink.findUnique({
        where: { slug: dto.utmSlug },
      });
      if (utm && utm.cardId === cardId) {
        const bonusActive =
          !utm.bonusExpiresAt || utm.bonusExpiresAt.getTime() > Date.now();
        if (bonusActive) {
          bonusStamps = utm.welcomeStamps ?? 0;
          bonusPoints = utm.welcomePoints ? Number(utm.welcomePoints) : 0;
          await this.prisma.cardUtmLink.update({
            where: { id: utm.id },
            data: { useCount: { increment: 1 } },
          });
        }
      }
    }

    // Crear pass nuevo (mismo flujo que issue() pero sin auth check).
    // Mismo handler P2002 que customer.create: si dos enrollments
    // simultáneos pasan por el findUnique y ambos llegan al create, el
    // 2do tira P2002 — devolvemos el pass que creó el primero.
    const serial = `CLB-${nanoid(10).toUpperCase()}`;
    const authToken = nanoid(32);
    let tmp;
    try {
      tmp = await this.prisma.pass.create({
        data: {
          tenantId: card.tenantId,
          cardId,
          customerId: customer.id,
          serialNumber: serial,
          qrToken: 'placeholder',
          authToken,
          stampsCount: bonusStamps,
          pointsBalance: bonusPoints,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const winner = await this.prisma.pass.findUnique({
          where: { cardId_customerId: { cardId, customerId: customer.id } },
        });
        if (winner) {
          return { passId: winner.id, customerId: customer.id, isNew: false };
        }
      }
      throw e;
    }
    const finalQr = sign(
      { pid: tmp.id, tid: card.tenantId },
      this.appConfig.QR_HMAC_SECRET,
      { algorithm: 'HS256' },
    );
    await this.prisma.pass.update({
      where: { id: tmp.id },
      data: { qrToken: finalQr },
    });

    return { passId: tmp.id, customerId: customer.id, isNew: true };
  }

  /**
   * Demo wallet flow — el prospect entra a /demo-wallet, completa nombre +
   * whatsapp, y recibe un pase real para su iPhone/Android. Internamente
   * reusa enrollPublic con la card configurada via Setting `demo.cardId`.
   *
   * Pensado para que afiliados/embajadores compartan el link y el prospect
   * tenga un "aha moment" de tener la tarjeta de fidelización Clubify en
   * SU teléfono — sin que el negocio tenga que hacer setup.
   */
  async enrollDemoWallet(dto: {
    fullName: string;
    phone: string;
    email?: string;
    ref?: string;
  }) {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'demo.cardId' },
    });
    const demoCardId = setting?.value?.trim();
    if (!demoCardId) {
      throw new ServiceUnavailableException(
        'El modo demo no está configurado todavía. Pídele al super admin que asigne una tarjeta demo desde el panel.',
      );
    }
    // Pasamos el ref como utmSlug para que enrollPublic lo guarde como
    // atribución del customer creado. Si después ese prospect compra
    // Clubify, podemos hacer follow-up al afiliado que lo trajo.
    const result = await this.enrollPublic(demoCardId, {
      fullName: dto.fullName,
      phone: dto.phone,
      email: dto.email,
      utmSlug: dto.ref,
    });
    return { ...result, cardId: demoCardId };
  }

  list(user: AuthUser, tenantId?: string, locationId?: string) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId ?? undefined;
    return this.prisma.pass.findMany({
      where: {
        ...(tid ? { tenantId: tid } : {}),
        ...(locationId ? { card: { locationId } } : {}),
      },
      include: { card: true, customer: true },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
  }
}
