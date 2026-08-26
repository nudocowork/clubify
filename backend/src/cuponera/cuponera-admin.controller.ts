import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  IsArray,
  IsObject,
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CardType } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CuponeraService } from './cuponera.service';
import { MercadoPagoService } from './mercadopago.service';
import { CardDto } from '../cards/cards.service';
import { AllyProfileBody } from './cuponera.dto';

// --- DTOs -------------------------------------------------------------------

class CampaignBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(280) welcomeText?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'PAUSED']) status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  @IsOptional() marketplace?: Record<string, any>;
}

/** DTO enfocado en los campos VISUALES de la tarjeta Living Card (membresía).
 *  No exponemos la config de sellos/puntos/cashback en Fase 1. */
class LivingCardBody {
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

class PlanBody {
  @IsString() @MaxLength(60) name!: string;
  @IsInt() @Min(0) priceCents!: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsIn(['MONTHLY', 'ANNUAL']) interval?: 'MONTHLY' | 'ANNUAL';
  @IsOptional() @IsInt() @Min(0) level?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) benefitsAllowance?: number | null;
  @IsOptional() @IsString() @MaxLength(280) description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PlanPatchBody {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsIn(['MONTHLY', 'ANNUAL']) interval?: 'MONTHLY' | 'ANNUAL';
  @IsOptional() @IsInt() @Min(0) level?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) benefitsAllowance?: number | null;
  @IsOptional() @IsString() @MaxLength(280) description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class CategoryBody {
  @IsString() @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

class CategoryPatchBody {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class EnrollBody {
  @IsString() @MaxLength(120) fullName!: string;
  @IsString() @MaxLength(30) phone!: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() planId?: string | null;
}

class MpConfigBody {
  @IsOptional() @IsString() @MaxLength(400) accessToken?: string;
  @IsOptional() @IsString() @MaxLength(200) publicKey?: string;
  @IsOptional() @IsString() @MaxLength(200) webhookSecret?: string;
}

class CreateAllyBody {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(160) email!: string;
  @IsString() @MaxLength(120) ownerFullName!: string;
  @IsOptional() @IsString() @MaxLength(80) password?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  /** Tipo A (§16): el negocio de la marca blanca que ES este aliado. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() tenantId?: string | null;
  // Ficha (§5)
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() logoUrl?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() coverUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(120) instagram?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
  /** Primer beneficio (§5, §6, §7). Sin él el aliado no sale en la cartelera. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsObject() benefit?: {
    title: string;
    type?: string;
    percentOff?: number | null;
    amountOffCents?: number | null;
    terms?: string;
    validUntil?: string | null;
    maxPerMember?: number | null;
    limitPeriod?: string;
  } | null;
}

class AllyStatusBody {
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'])
  status!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}

class BenefitApprovalBody {
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  approval!: 'PENDING' | 'APPROVED' | 'REJECTED';
}

class RequireApprovalBody {
  @IsBoolean() value!: boolean;
}

class GeopushBody {
  @IsString() @MaxLength(120) name!: string;
  @IsNumber() latitude!: number;
  @IsNumber() longitude!: number;
  @IsOptional() @IsInt() @Min(50) radiusMeters?: number;
  @IsOptional() @IsString() @MaxLength(200) walletRelevantText?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
}
class GeopushPatchBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsInt() @Min(50) radiusMeters?: number;
  @IsOptional() @IsString() @MaxLength(200) walletRelevantText?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
}
class PushBody {
  @IsString() @MaxLength(80) title!: string;
  @IsString() @MaxLength(240) body!: string;
  @IsOptional() @IsString() scheduledAt?: string;
  /** Segmento: si viene planId o allyId, se envía solo a ese segmento. */
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsString() allyId?: string;
}

class StampProgramBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(280) description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsInt() @Min(1) stampsRequired?: number;
  @IsOptional() @IsString() @MaxLength(160) rewardText?: string;
  @IsOptional() @IsInt() @Min(1) maxPerDay?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() categoryId?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) status?: 'ACTIVE' | 'PAUSED';
}

/** Alta del administrador de una cuponera (spec §3). */
class CampaignAdminBody {
  @IsString() @MaxLength(180) email!: string;
  @IsString() @MaxLength(120) fullName!: string;
  /** Si no viene, se genera una y se devuelve una sola vez. */
  @IsOptional() @IsString() @MaxLength(200) password?: string;
}

/** Alta de cuponera (spec §2). La marca blanca es obligatoria. */
class CampaignCreateBody {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(120) whiteLabelId!: string;
  @IsOptional() @IsString() @MaxLength(60) slug?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsString() @MaxLength(200) domain?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(32) primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(32) secondaryColor?: string;
}

/** Edición. El slug no se edita: cuelga de URLs vivas. */
class CampaignUpdateBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) whiteLabelId?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsString() @MaxLength(200) domain?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(32) primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(32) secondaryColor?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'PAUSED']) status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
}

/**
 * Panel Master Admin de la campaña Living Card (Cuponera). PLATFORM_OWNER (o
 * SUPER_ADMIN de la marca). Todo cuelga de la única campaña Living Card, que se
 * crea on-demand junto a su Tenant de sistema en la primera llamada.
 */
@Controller('cuponera/admin')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class CuponeraAdminController {
  constructor(
    private svc: CuponeraService,
    private mp: MercadoPagoService,
  ) {}

  @Get()
  overview() {
    return this.svc.getCampaignAdmin();
  }

  // --- CUPONERAS (spec §1 y §2) ---
  // Fidelity administra VARIAS. Van con /campaigns en PLURAL para no chocar con
  // /campaign (singular), que edita la única de Living Card.
  @Get('campaigns')
  listCampaigns() {
    return this.svc.listCampaigns();
  }
  @Post('campaigns')
  createCampaign(@Body() body: CampaignCreateBody) {
    return this.svc.createCampaign(body);
  }
  @Patch('campaigns/:id')
  updateCampaignById(@Param('id') id: string, @Body() body: CampaignUpdateBody) {
    return this.svc.updateCampaignById(id, body);
  }

  // Administrador propio de una cuponera (spec §3). NO entra al Master Admin de
  // Fidelity: solo ve el panel de SU cuponera. La clave temporal se devuelve UNA
  // sola vez — queda hasheada y no hay forma de recuperarla después.
  @Get('campaigns/:id/admins')
  listCampaignAdmins(@Param('id') id: string) {
    return this.svc.listCampaignAdmins(id);
  }
  @Post('campaigns/:id/admins')
  createCampaignAdmin(@Param('id') id: string, @Body() body: CampaignAdminBody) {
    return this.svc.createCampaignAdmin(id, body);
  }

  @Get('metrics')
  metrics() {
    return this.svc.metrics();
  }

  @Patch('campaign')
  updateCampaign(@Body() body: CampaignBody) {
    return this.svc.updateCampaign(body);
  }

  /** Diseña (crea/actualiza) la tarjeta Wallet de la campaña. */
  @Put('card')
  designCard(@Body() body: LivingCardBody) {
    const dto = { ...body, type: body.type ?? 'MEMBERSHIP' } as CardDto;
    return this.svc.designCard(dto);
  }

  // --- Planes ---
  @Get('plans')
  listPlans() {
    return this.svc.listPlans();
  }
  @Post('plans')
  createPlan(@Body() body: PlanBody) {
    return this.svc.createPlan(body);
  }
  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() body: PlanPatchBody) {
    return this.svc.updatePlan(id, body);
  }
  @Delete('plans/:id')
  deletePlan(@Param('id') id: string) {
    return this.svc.deletePlan(id);
  }

  // --- Categorías ---
  @Get('categories')
  listCategories() {
    return this.svc.listCategories();
  }
  @Post('categories')
  createCategory(@Body() body: CategoryBody) {
    return this.svc.createCategory(body);
  }
  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() body: CategoryPatchBody) {
    return this.svc.updateCategory(id, body);
  }
  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.svc.deleteCategory(id);
  }

  // --- Miembros ---
  @Get('members')
  listMembers() {
    return this.svc.listMembers();
  }
  /** Alta MANUAL de un miembro (sin cobro): crea el cliente y emite su tarjeta. */
  @Post('members')
  enrollManual(@Body() body: EnrollBody) {
    return this.svc.enrollMember({
      fullName: body.fullName,
      phone: body.phone,
      email: body.email ?? null,
      planId: body.planId ?? null,
      source: 'MANUAL',
    });
  }

  // --- MercadoPago (Fase 1b) ---
  @Get('mercadopago')
  mpStatus() {
    return this.mp.status();
  }
  /** Guarda (cifradas) las credenciales de MercadoPago de la campaña. */
  @Patch('mercadopago')
  setMp(@Body() body: MpConfigBody) {
    return this.mp.setConfig(body);
  }

  // --- Negocios aliados (Fase 2) ---
  @Get('allies')
  listAllies() {
    return this.svc.listAllies();
  }
  /** Crea un negocio aliado + su cuenta de login (devuelve la clave temporal). */
  @Post('allies')
  createAlly(@Body() body: CreateAllyBody) {
    return this.svc.createAlly(body);
  }
  /** Negocios elegibles como aliado Tipo A (§16). */
  @Get('allies/tenants')
  listTenantsForAlly() {
    return this.svc.listTenantsForAlly();
  }
  @Patch('allies/:id/status')
  setAllyStatus(@Param('id') id: string, @Body() body: AllyStatusBody) {
    return this.svc.setAllyStatus(id, body.status);
  }
  @Patch('allies/:id')
  updateAlly(@Param('id') id: string, @Body() body: AllyProfileBody) {
    return this.svc.updateAllyByAdmin(id, body);
  }

  // --- Beneficios (aprobación por la campaña) — Fase 3 ---
  @Get('benefits')
  listBenefits() {
    return this.svc.listAllBenefits();
  }
  @Patch('benefits/:id/approval')
  setBenefitApproval(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: BenefitApprovalBody,
  ) {
    return this.svc.setBenefitApproval(id, body.approval, user);
  }

  /** Historial de cambios de cualquier beneficio (spec §6). */
  @Get('benefits/:id/history')
  benefitHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.listBenefitHistory(user, id);
  }
  @Patch('benefit-approval-required')
  setRequireApproval(@Body() body: RequireApprovalBody) {
    return this.svc.setRequireBenefitApproval(body.value);
  }

  // --- Geopush (geofence en Wallet) — Fase 4 ---
  @Get('geopush')
  listGeopush() {
    return this.svc.listGeopush();
  }
  @Post('geopush')
  createGeopush(@Body() body: GeopushBody) {
    return this.svc.createGeopush(body);
  }
  @Patch('geopush/:id')
  updateGeopush(@Param('id') id: string, @Body() body: GeopushPatchBody) {
    return this.svc.updateGeopush(id, body);
  }
  @Delete('geopush/:id')
  deleteGeopush(@Param('id') id: string) {
    return this.svc.deleteGeopush(id);
  }

  // --- Push notifications — Fase 4 ---
  @Get('notifications')
  listNotifications() {
    return this.svc.listNotifications();
  }
  /** Push general (broadcast) o por segmento (si viene planId/allyId). */
  @Post('push')
  sendPush(@Body() body: PushBody) {
    if (body.planId || body.allyId) {
      return this.svc.sendSegmentPush({
        planId: body.planId,
        allyId: body.allyId,
        title: body.title,
        body: body.body,
      });
    }
    return this.svc.sendBroadcast(body);
  }

  // --- Sellos comunitarios — Fase 5 ---
  @Get('stamp-programs')
  listStampPrograms() {
    return this.svc.listStampPrograms();
  }
  @Post('stamp-programs')
  createStampProgram(@Body() body: StampProgramBody) {
    return this.svc.createStampProgram(body);
  }
  @Patch('stamp-programs/:id')
  updateStampProgram(@Param('id') id: string, @Body() body: StampProgramBody) {
    return this.svc.updateStampProgram(id, body);
  }
  @Delete('stamp-programs/:id')
  deleteStampProgram(@Param('id') id: string) {
    return this.svc.deleteStampProgram(id);
  }
}
