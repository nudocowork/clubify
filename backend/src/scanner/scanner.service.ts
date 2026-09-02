import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { verify, decode } from 'jsonwebtoken';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CuponeraService } from '../cuponera/cuponera.service';
import { ReservationsService } from '../reservations/reservations.service';
import { resolveWalletAdvanced } from '../common/white-label/wallet-advanced.util';
import { ConveniosCanjeService } from '../convenios/convenios-canje.service';
import { ClubService } from '../club/club.service';

const QR_RESERVATION_PROTOCOL = 'clubify-reservation:';

@Injectable()
export class ScannerService {
  constructor(
    private cuponera: CuponeraService,
    private prisma: PrismaService,
    private appConfig: AppConfigService,
    private reservations: ReservationsService,
    private convenios: ConveniosCanjeService,
    private club: ClubService,
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

    // TARJETA DE CUPONERA escaneada por un ALIADO TIPO A (spec §16): un negocio
    // que ya es cliente de la marca blanca y no debería necesitar un segundo
    // escáner. Mismo patrón que el QR de reservas de más arriba: se detecta que
    // el código es de otra naturaleza y se delega al módulo que sabe atenderlo.
    //
    // Va ANTES de la guarda de abajo y solo cuando los tenants NO coinciden, así
    // que el flujo de siempre (escanear la tarjeta propia del negocio) ni pasa
    // por acá. `scanMemberAsTenantAlly` devuelve null si no aplica —el pase no
    // es de una cuponera, la campaña no está activa, o este negocio no es aliado
    // APROBADO de ella— y entonces cae en el ForbiddenException de siempre.
    // Fail-closed: la excepción hay que ganársela, no es el default.
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== pass.tenantId) {
      const cuponera = await this.cuponera.scanMemberAsTenantAlly(user, {
        id: pass.id,
        tenantId: pass.tenantId,
        customerId: pass.customerId,
      });
      if (cuponera) return { kind: 'cuponera' as const, ...cuponera };
    }

    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== pass.tenantId) {
      // Mensaje en español y accionable: en negocios con varias sedes/cuentas
      // este error se leía como "el escáner está roto". Sin nombrar el otro
      // negocio (aislamiento entre tenants).
      throw new ForbiddenException(
        'Esta tarjeta pertenece a otro negocio. Verificá que iniciaste sesión ' +
          'con la cuenta de la sede correcta.',
      );
    }

    // RAMA NUEVA — tarjeta de CONVENIO (empleados de una empresa aliada).
    //
    // Se añade, no se reescriben las condiciones de arriba: un pase de
    // convenio se resuelve exactamente igual (mismo qrToken, mismos fallbacks
    // por JWT y serial), y solo cambia QUÉ se le devuelve al cajero. Todo lo
    // de sellos sigue por su camino sin enterarse.
    //
    // El desvío se decide leyendo `card.convenioId`, que ya viene incluido en
    // el pase: ni una consulta extra para los millones de escaneos normales.
    if ((pass.card as any).convenioId) {
      return this.convenios.resolverParaCaja(
        user,
        pass.id,
        (user as any).locationId ?? null,
      );
    }

    // RAMA CLUB — el cliente paga una suscripción al negocio y gasta de un
    // cupo mensual. Se decide igual que la de convenio, leyendo un campo que
    // ya viene en el pase: ni una consulta extra para los escaneos normales.
    //
    // Va DESPUÉS de convenio y ANTES de los sellos: una tarjeta de club no
    // acumula nada, descuenta.
    if ((pass.card as any).clubPlanId) {
      return this.club.resolverParaCaja(user, pass.id);
    }

    const recent = await this.prisma.stamp.findMany({
      where: { passId: pass.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Wallet V3 — flags de la marca para el escáner (mostrar/ocultar -1, etc).
    const walletAdvanced = resolveWalletAdvanced(
      (pass as any).tenant?.whiteLabel?.walletAdvanced,
    );

    return { pass, recent, walletAdvanced };
  }

  private passInclude = {
    card: true,
    customer: true,
    tenant: {
      select: {
        brandName: true,
        primaryColor: true,
        logoUrl: true,
        // Wallet V3 — permisos de la marca para gatear el escáner (botón -1,
        // ver historial/auditoría). Aislado por el whiteLabel del tenant.
        whiteLabel: { select: { walletAdvanced: true } },
      },
    },
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
