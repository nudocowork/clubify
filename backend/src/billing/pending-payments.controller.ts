import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { HotmartService } from './hotmart.service';
import { Roles } from '../common/decorators/roles.decorator';

class ResendBody {
  @IsEmail() email!: string;
  // Solo se auto-reenvía Hotmart hoy; Stripe/Cross usan el link visible.
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
  constructor(private hotmart: HotmartService) {}

  @Roles('SUPER_ADMIN')
  @Get()
  list() {
    return this.hotmart.listPendingPayments();
  }

  @Roles('SUPER_ADMIN')
  @Post('resend')
  async resend(@Body() body: ResendBody) {
    // Hoy solo Hotmart tiene reenvío automático (email + WhatsApp/SMS al
    // comprador). Para Stripe/Cross el admin usa el link visible en la fila.
    const r = await this.hotmart.resendPendingRecovery(body.email);
    return { ...r, gateway: body.gateway ?? 'HOTMART' };
  }
}
