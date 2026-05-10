import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class UtmBody {
  @IsString() source!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) welcomeStamps?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() welcomePoints?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() bonusExpiresAt?: string | null;
}

@Controller('cards/:cardId/utm')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class CardUtmController {
  constructor(private prisma: PrismaService) {}

  private async assertCardAccess(user: AuthUser, cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { tenantId: true },
    });
    if (!card) throw new NotFoundException('Card');
    if (user.role !== 'SUPER_ADMIN' && card.tenantId !== user.tenantId) {
      throw new NotFoundException('Card');
    }
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('cardId') cardId: string) {
    await this.assertCardAccess(user, cardId);
    return this.prisma.cardUtmLink.findMany({
      where: { cardId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Body() body: UtmBody,
  ) {
    await this.assertCardAccess(user, cardId);
    // slug corto único — 6 caracteres bastan; reintentamos en colisión.
    let slug = nanoid(6);
    for (let i = 0; i < 5; i++) {
      const exists = await this.prisma.cardUtmLink.findUnique({ where: { slug } });
      if (!exists) break;
      slug = nanoid(6);
    }
    return this.prisma.cardUtmLink.create({
      data: {
        cardId,
        source: body.source.trim(),
        slug,
        welcomeStamps: body.welcomeStamps ?? null,
        welcomePoints: body.welcomePoints ?? null,
        bonusExpiresAt: body.bonusExpiresAt ? new Date(body.bonusExpiresAt) : null,
      },
    });
  }

  @Delete(':utmId')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('cardId') cardId: string,
    @Param('utmId') utmId: string,
  ) {
    await this.assertCardAccess(user, cardId);
    await this.prisma.cardUtmLink.delete({ where: { id: utmId } });
    return { ok: true };
  }
}

@Controller('public/c/u')
export class PublicUtmController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get(':slug')
  async resolve(@Param('slug') slug: string) {
    const utm = await this.prisma.cardUtmLink.findUnique({
      where: { slug },
      include: { card: { select: { id: true, tenantId: true, isActive: true } } },
    });
    if (!utm || !utm.card.isActive) throw new NotFoundException('Link no disponible');
    return {
      cardId: utm.card.id,
      slug: utm.slug,
      source: utm.source,
      welcomeStamps: utm.welcomeStamps,
      welcomePoints: utm.welcomePoints ? Number(utm.welcomePoints) : null,
      bonusActive:
        utm.bonusExpiresAt == null || utm.bonusExpiresAt.getTime() > Date.now(),
    };
  }
}
