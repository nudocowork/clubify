import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ScannerService {
  constructor(private prisma: PrismaService) {}

  async verifyQr(user: AuthUser, qrToken: string) {
    let payload: { pid: string; tid: string };
    try {
      payload = verify(qrToken, process.env.QR_HMAC_SECRET ?? 'dev-qr') as any;
    } catch {
      throw new UnauthorizedException('Invalid QR');
    }

    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== payload.tid) {
      throw new ForbiddenException('QR belongs to another business');
    }

    const pass = await this.prisma.pass.findUnique({
      where: { id: payload.pid },
      include: {
        card: true,
        customer: true,
        tenant: { select: { brandName: true, primaryColor: true, logoUrl: true } },
      },
    });
    if (!pass) throw new NotFoundException('Pass');

    const recent = await this.prisma.stamp.findMany({
      where: { passId: pass.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { pass, recent };
  }
}
