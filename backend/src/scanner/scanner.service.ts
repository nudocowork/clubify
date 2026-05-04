import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ScannerService {
  constructor(private prisma: PrismaService) {}

  async verifyQr(user: AuthUser, qrToken: string) {
    const value = qrToken?.trim();
    if (!value) throw new UnauthorizedException('Empty token');

    let pass = await this.findByJwt(value);
    if (!pass) pass = await this.findBySerial(value);
    if (!pass) throw new NotFoundException('Pass');

    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== pass.tenantId) {
      throw new ForbiddenException('Code belongs to another business');
    }

    const recent = await this.prisma.stamp.findMany({
      where: { passId: pass.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { pass, recent };
  }

  private passInclude = {
    card: true,
    customer: true,
    tenant: { select: { brandName: true, primaryColor: true, logoUrl: true } },
  } as const;

  private async findByJwt(value: string) {
    if (!value.includes('.') || value.split('.').length !== 3) return null;
    let payload: { pid: string; tid: string };
    try {
      payload = verify(value, process.env.QR_HMAC_SECRET ?? 'dev-qr') as any;
    } catch {
      return null;
    }
    return this.prisma.pass.findUnique({ where: { id: payload.pid }, include: this.passInclude });
  }

  private async findBySerial(value: string) {
    return this.prisma.pass.findFirst({ where: { serialNumber: value }, include: this.passInclude });
  }
}
