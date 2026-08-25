import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MktProviderService } from './provider/mkt-provider.service';
import { MktContactService } from './mkt-contact.service';
import { MktEngineService } from './mkt-engine.service';

class TestSendDto {
  @IsIn(['email', 'sms']) channel!: 'email' | 'sms';
  @IsString() @MaxLength(200) to!: string;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsString() @MaxLength(5000) body!: string;
}

class ContactDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}
class ImportDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ContactDto) rows!: ContactDto[];
}
class OptOutDto {
  @IsBoolean() optOut!: boolean;
}

/**
 * API del módulo de Email Marketing (contact-based) — apartado de automatizaciones
 * de la MARCA. Brand-scoped por `whiteLabelId` (mismo patrón que brand-workflows).
 * Fase 1: estado de la conexión + envío de prueba.
 */
@Controller('admin/marketing')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class MarketingController {
  constructor(
    private prisma: PrismaService,
    private provider: MktProviderService,
    private contacts: MktContactService,
    private engine: MktEngineService,
  ) {}

  private async brandId(user: AuthUser): Promise<string> {
    if (user.whiteLabelId) return user.whiteLabelId;
    const clubify = await this.prisma.whiteLabel.findUnique({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    if (!clubify) throw new NotFoundException('Marca no resuelta');
    return clubify.id;
  }

  /** Estado de la conexión del proveedor de envío (solo lectura, proveedor anónimo). */
  @Get('connection')
  async connection(@CurrentUser() user: AuthUser) {
    return this.provider.getConnectionInfo(await this.brandId(user));
  }

  /**
   * Panel Infolinks (freemium): métricas + lista de usuarios "Solo InfoLink" de
   * la marca. Brand-scoped. Solo lectura. Alimenta la sección admin Infolinks (2F).
   */
  @Get('infolinks')
  async infolinks(@CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const tenants = await this.prisma.tenant.findMany({
      where: { whiteLabelId, businessType: 'INFOLINK' },
      select: {
        id: true,
        brandName: true,
        email: true,
        phone: true,
        slug: true,
        infolinkTier: true,
        status: true,
        createdAt: true,
        infoLinks: { select: { slug: true, views: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const users = tenants.map((t) => {
      const first = t.infoLinks[0];
      return {
        id: t.id,
        name: t.brandName,
        email: t.email,
        phone: t.phone,
        url: first ? `${t.slug}/${first.slug}` : t.slug,
        tier: (t.infolinkTier ?? 'PRO') as 'FREE' | 'PRO',
        status: t.status,
        createdAt: t.createdAt,
        visits: first?.views ?? 0,
      };
    });
    const metrics = {
      total: users.length,
      free: users.filter((u) => u.tier === 'FREE').length,
      pro: users.filter((u) => u.tier === 'PRO').length,
      active: users.filter((u) => u.status === 'ACTIVE').length,
      suspended: users.filter((u) => u.status !== 'ACTIVE').length,
      totalVisits: users.reduce((s, u) => s + u.visits, 0),
    };
    return { metrics, users };
  }

  /** Envío de prueba (email o SMS) para validar credenciales/permisos. */
  @Post('test-send')
  async testSend(@Body() body: TestSendDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    if (body.channel === 'email') {
      const html = /<[a-z][\s\S]*>/i.test(body.body) ? body.body : body.body.replace(/\n/g, '<br>');
      return this.provider.sendEmail({
        whiteLabelId,
        toEmail: body.to,
        subject: body.subject || 'Prueba de conexión',
        html,
      });
    }
    return this.provider.sendSms({ whiteLabelId, toPhone: body.to, message: body.body });
  }

  // ── Contactos (base de leads/clientes de la marca; dedup por identidad) ──
  @Get('contacts')
  async listContacts(
    @Query('q') q: string | undefined,
    @Query('take') take: string | undefined,
    @Query('skip') skip: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const whiteLabelId = await this.brandId(user);
    return this.contacts.list(whiteLabelId, {
      q,
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  @Post('contacts')
  async createContact(@Body() body: ContactDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const contact = await this.contacts.upsert(whiteLabelId, body);
    // Dispara el trigger contact_created (idempotente: enroll no re-inscribe).
    this.engine.fireTrigger('contact_created', contact.id, whiteLabelId).catch(() => {});
    return contact;
  }

  @Post('contacts/import')
  async importContacts(@Body() body: ImportDto, @CurrentUser() user: AuthUser) {
    return this.contacts.importMany(await this.brandId(user), body.rows ?? []);
  }

  @Delete('contacts/:id')
  async deleteContact(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.contacts.remove(await this.brandId(user), id);
  }

  @Patch('contacts/:id/optout')
  async optOut(@Param('id') id: string, @Body() body: OptOutDto, @CurrentUser() user: AuthUser) {
    return this.contacts.setOptOut(await this.brandId(user), id, body.optOut);
  }
}
