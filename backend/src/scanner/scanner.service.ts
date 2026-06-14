import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ReservationsService } from '../reservations/reservations.service';

const QR_RESERVATION_PROTOCOL = 'clubify-reservation:';

@Injectable()
export class ScannerService {
  constructor(
    private prisma: PrismaService,
    private appConfig: AppConfigService,
    private reservations: ReservationsService,
  ) {}

  async verifyQr(user: AuthUser, qrToken: string) {
    const value = qrToken?.trim();
    // 400 (no 401): el token vacío es bug del cliente, no sesión expirada.
    // Devolver 401 hacía que el frontend api.ts redirigiera a /login?expired
    // como si el usuario hubiera perdido la sesión.
    if (!value) throw new BadRequestException('Código vacío');

    // Pase de reserva: clubify-reservation:<id>. El scanner del staff lo
    // detecta acá → delega a ReservationsService.handleScannedReservation
    // que marca SEATED + dispara grantReservationStamp + devuelve el Pass
    // de sellos resultante (o respuesta especial si no hay STAMPS card).
    if (value.startsWith(QR_RESERVATION_PROTOCOL)) {
      const reservationId = value.slice(QR_RESERVATION_PROTOCOL.length).trim();
      if (!reservationId) throw new BadRequestException('Reserva inválida');
      return this.reservations.handleScannedReservation(user, reservationId);
    }

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
      payload = verify(value, this.appConfig.QR_HMAC_SECRET) as any;
    } catch {
      return null;
    }
    return this.prisma.pass.findUnique({ where: { id: payload.pid }, include: this.passInclude });
  }

  private async findBySerial(value: string) {
    return this.prisma.pass.findFirst({ where: { serialNumber: value }, include: this.passInclude });
  }
}
