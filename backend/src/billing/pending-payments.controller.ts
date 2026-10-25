import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { HotmartService } from './hotmart.service';
import { StripeService } from './stripe.service';
import {
  PendingAssignmentService,
  PendingGateway,
} from './pending-assignment.service';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { brandWhiteLabelWhere, resolveBrandScope } from '../common/white-label/brand-scope.util';
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
    private prisma: PrismaService,
  ) {}

  /**
   * Cada marca ve y toca SOLO sus pagos sin activar, los de la pasarela que
   * tiene conectada: Clubify los suyos (y los legacy sin marca), Sellea los
   * suyos. Antes la lista no filtraba y el panel de Clubify enseñaba los pagos
   * de Stripe de Sellea (Javier, 2026-10-25). `@Roles('SUPER_ADMIN')` no
   * aísla marcas: el admin de una marca blanca también es SUPER_ADMIN.
   */
  private async alcance(user: AuthUser | undefined) {
    return brandWhiteLabelWhere(await resolveBrandScope(this.prisma, user?.whiteLabelId ?? null));
  }

  /** 404 si la fila pendiente o el negocio no son de la marca de la sesión. */
  private async exigirAlcance(
    user: AuthUser | undefined,
    gateway: PendingGateway,
    pendingId: string,
    tenantId?: string,
  ) {
    const alcance = await this.alcance(user);
    const where = { id: pendingId, ...alcance };
    const fila =
      gateway === 'STRIPE'
        ? await this.prisma.pendingStripePayment.findFirst({ where, select: { id: true } })
        : gateway === 'CROSS'
          ? await this.prisma.pendingCrossPayment.findFirst({ where, select: { id: true } })
          : await this.prisma.pendingHotmartPayment.findFirst({ where, select: { id: true } });
    if (!fila) throw new NotFoundException('Pago no encontrado.');
    if (tenantId) {
      const t = await this.prisma.tenant.findFirst({
        where: { id: tenantId, AND: [alcance] },
        select: { id: true },
      });
      if (!t) throw new NotFoundException('Negocio no encontrado.');
    }
  }

  @Roles('SUPER_ADMIN')
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.hotmart.listPendingPayments(await this.alcance(user));
  }

  /** Buscador de negocios para «Asignar a negocio»: por marca, nombre, slug
   *  o correo (del tenant O del dueño — el correo del pago suele ser otro). */
  @Roles('SUPER_ADMIN')
  @Get('tenants')
  async searchTenants(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.assignment.searchTenants(q ?? '', await this.alcance(user));
  }

  /** Vista previa de la asignación: fechas exactas que quedarían, contraste
   *  de correos y cuántos pagos del comprador se aplicarían. No escribe. */
  @Roles('SUPER_ADMIN')
  @Post('assign/preview')
  async previewAssign(@CurrentUser() user: AuthUser, @Body() body: AssignBody) {
    await this.exigirAlcance(user, body.gateway, body.pendingId, body.tenantId);
    return this.assignment.preview(body.gateway, body.pendingId, body.tenantId);
  }

  /** Asigna el pago pendiente a un negocio existente. Mueve fechas de cobro
   *  reales: queda auditado con el admin que lo hizo. */
  @Roles('SUPER_ADMIN')
  @Post('assign')
  async assign(@CurrentUser() user: AuthUser, @Body() body: AssignBody) {
    await this.exigirAlcance(user, body.gateway, body.pendingId, body.tenantId);
    return this.assignment.assign({
      gateway: body.gateway,
      pendingId: body.pendingId,
      tenantId: body.tenantId,
      actorId: user?.id ?? null,
    });
  }

  @Roles('SUPER_ADMIN')
  @Post('resend')
  async resend(@CurrentUser() user: AuthUser, @Body() body: ResendBody) {
    // Solo se reenvía un pago de la marca de la sesión.
    const alcance = await this.alcance(user);
    const email = { equals: body.email.trim(), mode: 'insensitive' as const };
    const [h, s] = await Promise.all([
      body.gateway === 'STRIPE'
        ? null
        : this.prisma.pendingHotmartPayment.findFirst({ where: { email, consumedAt: null, ...alcance }, select: { id: true } }),
      body.gateway === 'HOTMART'
        ? null
        : this.prisma.pendingStripePayment.findFirst({ where: { email, consumedAt: null, ...alcance }, select: { id: true } }),
    ]);
    if (!h && !s) throw new NotFoundException('Pago no encontrado.');
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
