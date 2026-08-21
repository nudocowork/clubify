import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { HotmartService } from './hotmart.service';
import { StripeService } from './stripe.service';
import { Roles } from '../common/decorators/roles.decorator';

class ResendBody {
  @IsEmail() email!: string;
  // Hotmart y Stripe se auto-reenvían; Cross usa el link visible (su tabla no
  // tiene recoveryNotifiedAt y no hay cómo dedupear el aviso automático).
  @IsOptional() @IsIn(['HOTMART', 'STRIPE', 'CROSS']) @IsString()
  gateway?: string;
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
  ) {}

  @Roles('SUPER_ADMIN')
  @Get()
  list() {
    return this.hotmart.listPendingPayments();
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
