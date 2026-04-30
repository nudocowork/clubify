import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { CardsModule } from './cards/cards.module';
import { CustomersModule } from './customers/customers.module';
import { PassesModule } from './passes/passes.module';
import { StampsModule } from './stamps/stamps.module';
import { LocationsModule } from './locations/locations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReferralsModule } from './referrals/referrals.module';
import { WalletModule } from './wallet/wallet.module';
import { ScannerModule } from './scanner/scanner.module';
import { MetricsModule } from './metrics/metrics.module';
import { HealthModule } from './health/health.module';
// v2
import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';
import { PromotionsModule } from './promotions/promotions.module';
import { StorefrontModule } from './storefront/storefront.module';
import { ChannelsModule } from './channels/channels.module';
import { AutomationsModule } from './automations/automations.module';
import { MediaModule } from './media/media.module';
import { InfoLinksModule } from './info-links/info-links.module';
import { PaymentsModule } from './payments/payments.module';
import { EmailModule } from './email/email.module';
import { JobsModule } from './jobs/jobs.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    TenantsModule,
    CardsModule,
    CustomersModule,
    PassesModule,
    StampsModule,
    LocationsModule,
    NotificationsModule,
    ReferralsModule,
    WalletModule,
    ScannerModule,
    MetricsModule,
    HealthModule,
    // v2
    CatalogModule,
    PromotionsModule,
    StorefrontModule,
    ChannelsModule,
    AutomationsModule,
    OrdersModule,
    MediaModule,
    InfoLinksModule,
    PaymentsModule,
    EmailModule,
    JobsModule,
    AuditModule,
  ],
})
export class AppModule {}
