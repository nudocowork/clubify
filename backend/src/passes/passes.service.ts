import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class PassesService {
  constructor(private prisma: PrismaService) {}

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
      process.env.QR_HMAC_SECRET ?? 'dev-qr',
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
      process.env.QR_HMAC_SECRET ?? 'dev-qr',
      { algorithm: 'HS256' },
    );
    return this.prisma.pass.update({ where: { id: pass.id }, data: { qrToken: finalQr } });
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
    dto: { fullName: string; email?: string; phone: string },
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
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          tenantId: card.tenantId,
          fullName: dto.fullName.trim(),
          phone: phoneNorm,
          email: email ?? undefined,
        },
      });
    } else if (
      customer.fullName !== dto.fullName.trim() ||
      (email && !customer.email)
    ) {
      // Actualizar nombre si cambió, y email si lo deja por primera vez
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          fullName: dto.fullName.trim(),
          email: email ?? customer.email,
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

    // Crear pass nuevo (mismo flujo que issue() pero sin auth check)
    const serial = `CLB-${nanoid(10).toUpperCase()}`;
    const authToken = nanoid(32);
    const tmp = await this.prisma.pass.create({
      data: {
        tenantId: card.tenantId,
        cardId,
        customerId: customer.id,
        serialNumber: serial,
        qrToken: 'placeholder',
        authToken,
      },
    });
    const finalQr = sign(
      { pid: tmp.id, tid: card.tenantId },
      process.env.QR_HMAC_SECRET ?? 'dev-qr',
      { algorithm: 'HS256' },
    );
    await this.prisma.pass.update({
      where: { id: tmp.id },
      data: { qrToken: finalQr },
    });

    return { passId: tmp.id, customerId: customer.id, isNew: true };
  }

  list(user: AuthUser, tenantId?: string) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId ?? undefined;
    return this.prisma.pass.findMany({
      where: tid ? { tenantId: tid } : {},
      include: { card: true, customer: true },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
  }
}
