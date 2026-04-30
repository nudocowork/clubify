import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('audit')
@Roles('SUPER_ADMIN', 'TENANT_OWNER')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('actorId') actorId?: string,
    @Query('tenantId') tenantIdFilter?: string,
    @Query('take') take?: string,
  ) {
    // Super admin ve todo; tenant owner sólo su tenant
    const tenantWhere =
      user.role === 'SUPER_ADMIN'
        ? tenantIdFilter
          ? { tenantId: tenantIdFilter }
          : {}
        : { tenantId: user.tenantId };
    const items = await this.prisma.auditLog.findMany({
      where: {
        ...tenantWhere,
        ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
        ...(resource
          ? { resource: { contains: resource, mode: 'insensitive' } }
          : {}),
        ...(actorId ? { actorId } : {}),
      },
      include: {
        actor: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: take ? Math.min(500, Number(take)) : 100,
    });
    return items;
  }
}
