import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SalesTeamsService } from './sales-teams.service';
import { CrmService } from '../crm/crm.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class TeamCreateBody {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() leadUserId?: string | null;
}

class TeamUpdateBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() leadUserId?: string | null;
}

class MemberAddBody {
  @IsString() userId!: string;
}

/**
 * Endpoints super admin para gestionar equipos de ventas (C4).
 * Path: /admin/sales-teams/* — agrupado bajo admin/ para mantener el
 * patrón del resto del panel super admin.
 *
 * MARKETING NO accede aquí por diseño — esto es estructura organizativa
 * del equipo de ventas, no un asset de marketing.
 */
@Controller('admin/sales-teams')
@Roles('SUPER_ADMIN')
export class SalesTeamsController {
  constructor(
    private svc: SalesTeamsService,
    private crm: CrmService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  /** Leaderboard global (C8): rankings de usuarios y equipos por
   *  totalContacts / clientCount / conversionRate. Path fijo ANTES de
   *  :id para no chocar con get(:id). */
  @Get('leaderboard')
  leaderboard(@CurrentUser() user: AuthUser) {
    return this.crm.getLeaderboard(user);
  }

  /** Users elegibles para sumar al equipo (afiliados activos). El query
   *  `teamId` opcional excluye los que ya son miembros. */
  @Get('eligible-users')
  eligible(@CurrentUser() user: AuthUser, @Query('teamId') teamId?: string) {
    return this.svc.listEligibleUsers(user, teamId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() body: TeamCreateBody) {
    return this.svc.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: TeamUpdateBody) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() body: MemberAddBody) {
    return this.svc.addMember(id, body.userId);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.svc.removeMember(id, userId);
  }
}
