import { Body, Controller, Get, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PassesService } from './passes.service';
import { WalletService } from '../wallet/wallet.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class IssueBody {
  @IsUUID() cardId!: string;
  @IsUUID() customerId!: string;
}

class EnrollBody {
  @IsString() @MinLength(2) @MaxLength(80) fullName!: string;
  @IsString() @MinLength(8) @MaxLength(20) phone!: string;
  @IsOptional() @IsEmail() email?: string;
  // Cumpleaños opcional. Solo se usa el día/mes (el año es ficticio).
  // Formato YYYY-MM-DD para que Prisma lo acepte como @db.Date.
  @IsOptional() @IsString() birthday?: string;
  // Si vino el cliente vía un link UTM (/c/u/{slug}), aplicamos el bonus
  // de bienvenida configurado por el dueño.
  @IsOptional() @IsString() utmSlug?: string;
}

@Controller('passes')
export class PassesController {
  private logger = new Logger(PassesController.name);

  constructor(
    private svc: PassesService,
    private wallet: WalletService,
    private prisma: PrismaService,
  ) {}

  /**
   * Auto-enrollment público: muestra info de la tarjeta antes de que el
   * cliente llene el form. No expone tenantId ni datos sensibles.
   */
  @Public()
  @Get('enroll/:cardId')
  async getEnrollCard(@Param('cardId') cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        rewardText: true,
        terms: true,
        primaryColor: true,
        secondaryColor: true,
        stampsRequired: true,
        isActive: true,
        tenant: {
          select: {
            brandName: true,
            logoUrl: true,
            primaryColor: true,
            slug: true,
            status: true,
          },
        },
      },
    });
    if (!card || !card.isActive || card.tenant.status === 'SUSPENDED') {
      return { available: false };
    }
    return { available: true, card };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('enroll/:cardId')
  enroll(@Param('cardId') cardId: string, @Body() body: EnrollBody) {
    return this.svc.enrollPublic(cardId, body);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.svc.list(user, tenantId, locationId);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Post()
  issue(@CurrentUser() user: AuthUser, @Body() body: IssueBody) {
    return this.svc.issue(user, body.cardId, body.customerId);
  }

  // IMPORTANTE: las rutas con paths fijos (lookup/by-phone) deben ir
  // ANTES de las que usan path params (:id), sino NestJS captura el
  // segmento "lookup" como id y la específica nunca se alcanza.
  @Public()
  @Get('lookup/by-phone')
  lookupByPhone(
    @Query('slug') slug: string,
    @Query('phone') phone: string,
  ) {
    return this.svc.findByPhonePublic(slug, phone);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Public()
  @Get(':id/public')
  getPublic(@Param('id') id: string) {
    return this.svc.getPublic(id);
  }

  @Public()
  @Get(':id/apple.pkpass')
  async apple(@Param('id') id: string, @Res() res: Response) {
    this.logger.log(`Apple .pkpass download requested: passId=${id}`);
    const buf = await this.wallet.generateApplePass(id);
    this.logger.log(`Apple .pkpass served: passId=${id} size=${buf.length}b`);
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${id}.pkpass"`,
    });
    res.send(buf);
  }

  @Public()
  @Get(':id/google')
  async google(@Param('id') id: string) {
    const url = await this.wallet.generateGoogleSaveUrl(id);
    return { saveUrl: url };
  }

  /**
   * Dispara silent APNs push para forzar a Apple Wallet a re-fetchear el
   * .pkpass actualizado (refresca strip, logo, fields). Útil después de
   * deploys que cambian visualmente el pase. Requiere que el dispositivo
   * esté registrado (i.e. el cliente tiene el pase instalado).
   *
   * Acepta passId (UUID) o serialNumber en el param `:id`.
   * Devuelve { sent, skipped } o { error } si no existe / no es del tenant.
   */
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Post(':id/push-update')
  async pushUpdate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    // Lookup por UUID primero, luego por serialNumber. Permite que el dueño
    // pase el serial visible en el panel sin buscar el passId interno.
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    const pass = await this.prisma.pass.findFirst({
      where: isUuid ? { id } : { serialNumber: id },
      select: { id: true, tenantId: true, serialNumber: true },
    });
    if (!pass) return { sent: 0, skipped: 0, error: 'pass_not_found' };
    if (user.role !== 'SUPER_ADMIN' && pass.tenantId !== user.tenantId) {
      return { sent: 0, skipped: 0, error: 'forbidden' };
    }
    this.logger.log(
      `Admin push-update requested by ${user.id} for pass ${pass.serialNumber}`,
    );
    return this.wallet.pushPassUpdate(pass.id);
  }
}
