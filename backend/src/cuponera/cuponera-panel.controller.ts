import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  IsArray, IsBoolean, IsEnum, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString,
  MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CuponeraService } from './cuponera.service';
import { MercadoPagoService } from './mercadopago.service';
import { CardDto } from '../cards/cards.service';
import { CardType } from '@prisma/client';

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

class PanelCategoryPatchBody {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PanelPlanBody {
  @IsString() @MaxLength(60) name!: string;
  @IsInt() @Min(0) priceCents!: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsIn(['MONTHLY', 'ANNUAL']) interval?: 'MONTHLY' | 'ANNUAL';
  @IsOptional() @IsInt() @Min(0) level?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) benefitsAllowance?: number | null;
  @IsOptional() @IsString() @MaxLength(280) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PanelPlanPatchBody {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsIn(['MONTHLY', 'ANNUAL']) interval?: 'MONTHLY' | 'ANNUAL';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) benefitsAllowance?: number | null;
  @IsOptional() @IsString() @MaxLength(280) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  // ── Mapeo a las pasarelas (§24) ───────────────────────────────────────────
  // Tienen que estar declarados acá o el whitelist del ValidationPipe los tira
  // ANTES de llegar al servicio: el mapeo se "guardaría" sin error y sin
  // guardar nada. Se acepta null explícito para DESmapear sin borrar el plan.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) hotmartProductId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) hotmartOfferCode?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) stripePriceId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) hotmartCheckoutUrl?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) stripeCheckoutUrl?: string | null;
}

/** Ajustes propios de la cuponera. `status` NO está: publicar o pausar es
 *  decisión de Fidelity (§1-2), no de la cuponera sobre sí misma. */
class PanelSettingsBody {
  @IsOptional() @IsString() @MaxLength(400) welcomeText?: string;
  @IsOptional() @IsBoolean() requireBenefitApproval?: boolean;
  @IsOptional() @IsInt() @Min(0) allyPushPerWeek?: number;
}

/** Aviso a la comunidad (§20). Sin plan ni aliado = a todos. */
class PanelPushBody {
  @IsString() @MaxLength(60) title!: string;
  @IsString() @MaxLength(300) body!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) planId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) allyId?: string | null;
  @IsOptional() @IsString() scheduledAt?: string;
}

class PanelGeopushBody {
  @IsString() @MaxLength(80) name!: string;
  @IsNumber() latitude!: number;
  @IsNumber() longitude!: number;
  @IsOptional() @IsInt() @Min(0) radiusMeters?: number;
  @IsOptional() @IsString() @MaxLength(120) walletRelevantText?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
}

class PanelGeopushPatchBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsInt() @Min(0) radiusMeters?: number;
  @IsOptional() @IsString() @MaxLength(120) walletRelevantText?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
}

class PanelStampBody {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsInt() @Min(1) stampsRequired?: number;
  @IsOptional() @IsString() @MaxLength(160) rewardText?: string;
  @IsOptional() @IsInt() @Min(1) maxPerDay?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) status?: string;
}

class PanelApprovalBody {
  @IsIn(['PENDING', 'APPROVED', 'REJECTED']) approval!: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/** Diseño de la tarjeta Wallet. Mismo juego de campos que usaba el Master
 *  Admin: acá se repite en vez de importarse para no acoplar los dos
 *  controladores, que tienen roles distintos. */
class PanelCardBody {
  @IsOptional() @IsEnum(CardType) type?: CardType;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() walletBrandName?: string | null;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() @MaxLength(160) rewardText?: string;
  @IsOptional() @IsString() @MaxLength(280) howToEarnText?: string;
  @IsOptional() @IsString() @MaxLength(80) businessName?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsBoolean() termsEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(8) stampIcon?: string;
  @IsOptional() @IsArray() activeLinks?: Array<{ type: string; url: string; label: string }>;
  @IsOptional() @IsArray() tiers?: Array<{ name: string; threshold: number }>;
}

class PanelMpBody {
  @IsOptional() @IsString() @MaxLength(400) accessToken?: string;
  @IsOptional() @IsString() @MaxLength(200) publicKey?: string;
  @IsOptional() @IsString() @MaxLength(200) webhookSecret?: string;
}

@Controller('cuponera/panel')
@Roles('CUPONERA_ADMIN', 'PLATFORM_OWNER', 'SUPER_ADMIN')
export class CuponeraPanelController {
  constructor(
    private svc: CuponeraService,
    private mp: MercadoPagoService,
  ) {}

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

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PanelCategoryPatchBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelUpdateCategory(user, id, body, campaignId);
  }

  @Delete('categories/:id')
  deleteCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelDeleteCategory(user, id, campaignId);
  }

  @Post('plans')
  createPlan(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelPlanBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelCreatePlan(user, body, campaignId);
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PanelPlanPatchBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelUpdatePlan(user, id, body, campaignId);
  }

  @Delete('plans/:id')
  deletePlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelDeletePlan(user, id, campaignId);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelSettings(user, campaignId);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelSettingsBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelUpdateSettings(user, body, campaignId);
  }

  // ── Alcance al beneficiario ───────────────────────────────────────────────

  /** A cuánta gente llegaría el envío. Se consulta ANTES de mandar. */
  @Get('push/reach')
  pushReach(
    @CurrentUser() user: AuthUser,
    @Query('planId') planId?: string,
    @Query('allyId') allyId?: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelPushReach(user, { planId, allyId }, campaignId);
  }

  @Get('push')
  pushHistory(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelNotifications(user, campaignId);
  }

  @Post('push')
  sendPush(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelPushBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelSendPush(
      user,
      { ...body, planId: body.planId ?? undefined, allyId: body.allyId ?? undefined },
      campaignId,
    );
  }

  @Get('geopush')
  geopush(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelGeopush(user, campaignId);
  }

  @Post('geopush')
  createGeopush(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelGeopushBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelCreateGeopush(user, body, campaignId);
  }

  @Patch('geopush/:id')
  updateGeopush(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PanelGeopushPatchBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelUpdateGeopush(user, id, body, campaignId);
  }

  @Delete('geopush/:id')
  deleteGeopush(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelDeleteGeopush(user, id, campaignId);
  }

  // ── Sellos comunitarios (§21) ─────────────────────────────────────────────

  @Get('stamp-programs')
  stampPrograms(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelStampPrograms(user, campaignId);
  }

  @Post('stamp-programs')
  createStampProgram(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelStampBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelCreateStampProgram(user, body, campaignId);
  }

  @Patch('stamp-programs/:id')
  updateStampProgram(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PanelStampBody,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelUpdateStampProgram(user, id, body, campaignId);
  }

  @Delete('stamp-programs/:id')
  deleteStampProgram(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.svc.panelDeleteStampProgram(user, id, campaignId);
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

  // ── Tarjeta Wallet y cobro ────────────────────────────────────────────────
  // Estaban solo en /superadmin/living-card, sobre endpoints clavados a la
  // PRIMERA cuponera. Sin esto, unificar las dos pantallas del Master Admin
  // habría dejado a las demás cuponeras sin diseñar su tarjeta ni cobrar.

  @Get('card')
  card(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelCard(user, campaignId);
  }

  @Put('card')
  designCard(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelCardBody,
    @Query('campaignId') campaignId?: string,
  ) {
    const dto = { ...body, type: body.type ?? 'MEMBERSHIP' } as CardDto;
    return this.svc.panelDesignCard(user, dto, campaignId);
  }

  /** Hotmart y Stripe: qué URL pegar en cada proveedor y cuántos planes hay
   *  mapeados. Solo lectura — el mapeo se hace plan por plan. */
  @Get('gateways')
  gateways(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelGateways(user, campaignId);
  }

  /** MercadoPago es POR CUPONERA: sus credenciales viven en la config de la
   *  campaña, no en la marca. Por eso se resuelve la campaña antes de tocarlo. */
  @Get('mercadopago')
  async mercadopago(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    const campaign = await this.svc.resolveAdminCampaign(user, campaignId);
    return this.mp.status(campaign);
  }

  @Patch('mercadopago')
  async setMercadopago(
    @CurrentUser() user: AuthUser,
    @Body() body: PanelMpBody,
    @Query('campaignId') campaignId?: string,
  ) {
    const campaign = await this.svc.resolveAdminCampaign(user, campaignId);
    return this.mp.setConfig(body, campaign);
  }
}
