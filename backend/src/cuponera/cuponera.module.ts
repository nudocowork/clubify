import { Module } from '@nestjs/common';
import { CuponeraService } from './cuponera.service';
import { CuponeraAdminController } from './cuponera-admin.controller';
import { CuponeraPublicController } from './cuponera-public.controller';
import { AllyPortalController } from './ally-portal.controller';
import { CuponeraPanelController } from './cuponera-panel.controller';
import { MercadoPagoService } from './mercadopago.service';
import { MembershipBillingService } from './membership-billing.service';
import { MercadoPagoController } from './mercadopago.controller';
import { CardsModule } from '../cards/cards.module';
import { PassesModule } from '../passes/passes.module';
import { LocationsModule } from '../locations/locations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';

/**
 * Cuponera / Living Card (Fase 1). Campañas de beneficios comunitarios sobre un
 * Tenant "de sistema" que reusa el stack Wallet. NO confundir con CampaignsModule
 * (afiliados/referidos).
 */
@Module({
  imports: [CardsModule, PassesModule, LocationsModule, NotificationsModule, WalletModule],
  providers: [CuponeraService, MercadoPagoService, MembershipBillingService],
  controllers: [
    CuponeraAdminController,
    CuponeraPublicController,
    AllyPortalController,
    CuponeraPanelController,
    MercadoPagoController,
  ],
  // MembershipBillingService lo consume BillingModule (webhooks de Hotmart y
  // Stripe). La ida y vuelta Billing↔Cuponera se resuelve con forwardRef allá.
  exports: [CuponeraService, MembershipBillingService],
})
export class CuponeraModule {}
