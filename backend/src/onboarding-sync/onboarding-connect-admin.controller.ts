import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { OnboardingService } from './onboarding.service';
import { Roles } from '../common/decorators/roles.decorator';

class CreateTokenBody {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}

// "Conectar con Onboarding" — versión ADMIN (2026-07-19, PDF1145). El operador
// de Clubify (SUPER_ADMIN) gestiona los tokens de integración de CUALQUIER
// negocio desde la ficha del tenant (/admin/tenants/[id]) — ya NO desde la
// config del propio negocio. El tenantId viene por PATH (no de la sesión).
// Reutiliza OnboardingService, que ya está parametrizado por tenantId.
@Controller('admin/onboarding')
// MARKETING (ej. Samuel) gestiona el onboarding de los negocios Clubify, así que
// también puede generar/revocar sus tokens. SUPER_ADMIN sigue teniendo acceso.
@Roles('SUPER_ADMIN', 'MARKETING')
export class OnboardingConnectAdminController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get(':tenantId/tokens')
  list(@Param('tenantId') tenantId: string) {
    return this.onboarding.listTokens(tenantId);
  }

  @Post(':tenantId/token')
  create(
    @Param('tenantId') tenantId: string,
    @Body() body: CreateTokenBody,
  ) {
    return this.onboarding.createToken(tenantId, body?.label);
  }

  @Delete(':tenantId/token/:id')
  revoke(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.onboarding.revokeToken(tenantId, id);
  }
}
