import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { HotmartService } from './hotmart.service';
import { StripeService } from './stripe.service';
import {
  PendingAssignmentService,
  PendingGateway,
} from './pending-assignment.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class ResendBody {
  @IsEmail() email!: string;
  // Hotmart y Stripe se auto-reenvían; Cross usa el link visible (su tabla no
  // tiene recoveryNotifiedAt y no hay cómo dedupear el aviso automático).
  @IsOptional() @IsIn(['HOTMART', 'STRIPE', 'CROSS']) @IsString()
  gateway?: string;
}

class AssignBody {
  /** id de la fila Pending*Payment (el de su propia tabla, según gateway). */
  @IsString() pendingId!: string;
  @IsIn(['HOTMART', 'STRIPE', 'CROSS']) gateway!: PendingGateway;
  /** Negocio EXISTENTE al que se aplica el pago. */
  @IsString() tenantId!: string;
}

/**
 * PDF Soft 10: panel admin de "compras PAGADAS sin cuenta activada".
 * Lista unificada de los 3 Pending*Payment sin consumir con datos del comprador
 * + link de activación para reenviar. Guards globales (mismo patrón que
 * AdminCommissionsController): @Roles a nivel método.
 */
@Controller('admin/pending-payments')
export class PendingPaymentsController {
  constructor(
    private hotmart: HotmartService,
    private stripe: StripeService,
    private assignment: PendingAssignmentService,
  ) {}

  @Roles('SUPER_ADMIN')
  @Get()
  list() {
    return this.hotmart.listPendingPayments();
  }

  /** Buscador de negocios para «Asignar a negocio»: por marca, nombre, slug
   *  o correo (del tenant O del dueño — el correo del pago suele ser otro). */
  @Roles('SUPER_ADMIN')
  @Get('tenants')
  searchTenants(@Query('q') q?: string) {
    return this.assignment.searchTenants(q ?? '');
  }

  /** Vista previa de la asignación: fechas exactas que quedarían, contraste
   *  de correos y cuántos pagos del comprador se aplicarían. No escribe. */
  @Roles('SUPER_ADMIN')
  @Post('assign/preview')
  previewAssign(@Body() body: AssignBody) {
    return this.assignment.preview(body.gateway, body.pendingId, body.tenantId);
  }

  /** Asigna el pago pendiente a un negocio existente. Mueve fechas de cobro
   *  reales: queda auditado con el admin que lo hizo. */
  @Roles('SUPER_ADMIN')
  @Post('assign')
  assign(@CurrentUser() user: AuthUser, @Body() body: AssignBody) {
    return this.assignment.assign({
      gateway: body.gateway,
      pendingId: body.pendingId,
      tenantId: body.tenantId,
      actorId: user?.id ?? null,
    });
  }

  @Roles('SUPER_ADMIN')
  @Post('resend')
  async resend(@Body() body: ResendBody) {
    // El reenvío usa el MISMO camino que el aviso automático del webhook
    // (correo por la subcuenta de la marca + WhatsApp/SMS): reenviar sirve de
    // verdad, no repite un canal muerto.
    if (body.gateway === 'STRIPE') {
      const r = await this.stripe.resendPendingRecovery(body.email);
      return { ...r, gateway: 'STRIPE' };
    }
    if (body.gateway === 'CROSS') {
      // Cross sigue sin reenvío automático: el admin usa el link de la fila.
      return { ok: false, found: false, gateway: 'CROSS' };
    }
    const r = await this.hotmart.resendPendingRecovery(body.email);
    // Sin pasarela explícita probamos también Stripe: el frontend viejo solo
    // manda gateway para Hotmart y el comprador puede estar en cualquiera.
    if (!r.found && !body.gateway) {
      const s = await this.stripe.resendPendingRecovery(body.email);
      if (s.found) return { ...s, gateway: 'STRIPE' };
    }
    return { ...r, gateway: body.gateway ?? 'HOTMART' };
  }
}
