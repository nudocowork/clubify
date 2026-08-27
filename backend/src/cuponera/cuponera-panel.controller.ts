import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CuponeraService } from './cuponera.service';

/**
 * PANEL DE LA CUPONERA (spec §4). Lo usa el administrador de UNA cuponera
 * (role=CUPONERA_ADMIN), que NO entra al Master Admin de Fidelity.
 *
 * Deliberadamente SEPARADO de CuponeraAdminController: aquel tiene 35+
 * endpoints, incluidos listar todas las cuponeras y crear administradores en
 * cualquiera. Sumar el rol a su @Roles habría sido una línea y una escalada de
 * privilegios. Acá solo entra lo que el admin de una cuponera debe ver.
 *
 * PLATFORM_OWNER también entra —§1 pide poder "entrar administrativamente a
 * cualquier cuponera"— y solo él puede pasar `?campaignId=`. Para el
 * CUPONERA_ADMIN ese parámetro se ignora o se rechaza: la campaña sale de su
 * sesión, nunca del cliente. La regla vive en `resolveAdminCampaign`.
 */
/** Primer beneficio del aliado. Un aliado sin beneficio NO aparece en la
 *  cartelera, así que se ofrece en el mismo formulario del alta. */
class PanelBenefitBody {
  @IsString() @MaxLength(120) title!: string;
  @IsOptional() @IsIn(['PERCENT_OFF', 'AMOUNT_OFF', 'TWO_FOR_ONE', 'FREEBIE']) type?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) percentOff?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) amountOffCents?: number | null;
  @IsOptional() @IsString() @MaxLength(400) terms?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() validUntil?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) maxPerMember?: number | null;
  @IsOptional() @IsIn(['LIFETIME', 'DAY', 'WEEK', 'MONTH', 'YEAR']) limitPeriod?: string;
}

class PanelAllyBody {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(160) email!: string;
  @IsString() @MaxLength(120) ownerFullName!: string;
  @IsOptional() @IsString() @MaxLength(80) password?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  /** TIPO A (§16): el negocio ya es cliente de la marca y usará SU escáner. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) tenantId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) logoUrl?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) coverUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(120) instagram?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
  @IsOptional() @ValidateNested() @Type(() => PanelBenefitBody) benefit?: PanelBenefitBody | null;
}

class PanelAllyPatchBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) logoUrl?: string | null;
}

class PanelAllyStatusBody {
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']) status!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}

class PanelMemberBody {
  @IsString() @MaxLength(120) fullName!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) planId?: string | null;
}

class PanelCategoryBody {
  @IsString() @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

class PanelApprovalBody {
  @IsIn(['PENDING', 'APPROVED', 'REJECTED']) approval!: 'PENDING' | 'APPROVED' | 'REJECTED';
}

@Controller('cuponera/panel')
@Roles('CUPONERA_ADMIN', 'PLATFORM_OWNER', 'SUPER_ADMIN')
export class CuponeraPanelController {
  constructor(private svc: CuponeraService) {}

  /** Pantalla inicial: los números de §4. */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelOverview(user, campaignId);
  }

  @Get('allies')
  allies(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelAllies(user, campaignId);
  }

  @Get('members')
  members(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelMembers(user, campaignId);
  }

  @Get('redemptions')
  redemptions(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelRedemptions(user, campaignId);
  }

  // ── Escrituras (§28: "conseguir aliados, administrar miembros") ────────────
  // El panel era SOLO LECTURA: quien administra una cuponera no podía dar de
  // alta ni un aliado ni un beneficiario, que es exactamente su trabajo.

  @Get('categories')
  categories(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelCategories(user, campaignId);
  }

  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelCategoryBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelCreateCategory(user, body, campaignId);
  }

  /** Planes: hacen falta para elegir con cuál se da de alta a un beneficiario. */
  @Get('plans')
  plans(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelPlans(user, campaignId);
  }

  /** Negocios de la marca elegibles como aliado TIPO A (§16). */
  @Get('tenant-options')
  tenantOptions(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelTenantOptions(user, campaignId);
  }

  @Post('allies')
  createAlly(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelAllyBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelCreateAlly(user, body, campaignId);
  }

  @Patch('allies/:id')
  updateAlly(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PanelAllyPatchBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelUpdateAlly(user, id, body, campaignId);
  }

  /** El aliado nace PENDING: sin esto no aparece nunca en la cartelera. */
  @Patch('allies/:id/status')
  setAllyStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PanelAllyStatusBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelSetAllyStatus(user, id, body.status, campaignId);
  }

  @Post('members')
  createMember(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelMemberBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelEnrollMember(user, body, campaignId);
  }

  /** Bandeja de aprobación: si la cuponera exige revisión, un beneficio queda
   *  PENDING y sin esta pantalla no se publica nunca. */
  @Get('benefits')
  benefits(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelBenefits(user, campaignId);
  }

  @Patch('benefits/:id/approval')
  setBenefitApproval(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PanelApprovalBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelSetBenefitApproval(user, id, body.approval, campaignId);
  }
}
