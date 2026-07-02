import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { verify, decode } from 'jsonwebtoken';
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

    // Orden de resolución del barcode:
    //  1. qrToken corto (formato actual 2026-06-17: `QR-...`, inforjable).
    //  2. JWT firmado (legacy fix #1 2026-06-16) — pases instalados antes
    //     del refresh global todavía muestran el JWT largo en el barcode.
    //  3. serial plano (legacy pre-fix) — fallback final.
    let pass = await this.findByQrToken(value);
    if (!pass) pass = await this.findByJwt(value);
    if (!pass) pass = await this.findBySerial(value);
    if (!pass)
      throw new NotFoundException(
        'Pase no encontrado. El código del cliente puede estar desactualizado: ' +
          'escribí el código del pase (CLB-…) en el campo de abajo, o pedile al ' +
          'cliente que reinstale el pase en su billetera.',
      );

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

  private async findByQrToken(value: string) {
    // Token opaco actual: `QR-<nanoid>`. Búsqueda directa por índice @unique.
    // No es un JWT (sin puntos) → evita el verify innecesario.
    if (value.includes('.')) return null;
    const direct = await this.prisma.pass.findUnique({
      where: { qrToken: value },
      include: this.passInclude,
    });
    if (direct) return direct;
    // Fallback: token ANTERIOR (pass fusionado/regenerado). Garantiza que un
    // código ya instalado en la billetera del cliente NUNCA deje de escanear
    // aunque su pass se haya fusionado en otro (customers.merge) o rotado.
    return this.prisma.pass.findFirst({
      where: { legacyQrTokens: { has: value } },
      include: this.passInclude,
    });
  }

  private async findByJwt(value: string) {
    if (!value.includes('.') || value.split('.').length !== 3) return null;
    let payload: any = null;
    try {
      payload = verify(value, this.appConfig.QR_HMAC_SECRET) as any;
    } catch {
      // FIX 2026-06-19 (scan VALMONT): si la firma NO valida (rotación de
      // secreto o pases viejos del período JWT 2026-06-16), decodificamos el
      // JWT SIN verificar para extraer el `pid` y resolver el pase igual. Es
      // seguro acá: el endpoint /scanner es staff-only (Roles) y verifyQr
      // valida abajo que el pase pertenezca al tenant del usuario, así que un
      // pid forjado solo podría apuntar a pases del propio negocio.
      try {
        payload = decode(value) as any;
      } catch {
        payload = null;
      }
    }
    if (!payload?.pid) return null;
    return this.prisma.pass.findUnique({
      where: { id: payload.pid },
      include: this.passInclude,
    });
  }

  private async findBySerial(value: string) {
    return this.prisma.pass.findFirst({ where: { serialNumber: value }, include: this.passInclude });
  }
}
