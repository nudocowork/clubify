import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './common/config/app-config.module';
import { validateEnv } from './common/config/env.validation';
import { TenantModule } from './common/tenant/tenant.module';
import { RetentionModule } from './common/retention/retention.module';
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
import { AccountingModule } from './accounting/accounting.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { BadgesModule } from './badges/badges.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { PayoutsModule } from './payouts/payouts.module';
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
import { CrmModule } from './crm/crm.module';
import { SequencesModule } from './sequences/sequences.module';
import { SalesTeamsModule } from './sales-teams/sales-teams.module';
import { EmailModule } from './email/email.module';
import { JobsModule } from './jobs/jobs.module';
import { AuditModule } from './audit/audit.module';
import { BillingModule } from './billing/billing.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { SettingsModule } from './settings/settings.module';
import { SystemHealthModule } from './system-health/system-health.module';
import { SupportModule } from './support/support.module';
import { ReviewsModule } from './reviews/reviews.module';
import { QrPostersModule } from './qr-posters/qr-posters.module';
import { AdminModule } from './admin/admin.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { QuotesModule } from './quotes/quotes.module';
import { SupportMaterialsModule } from './support-materials/support-materials.module';
import { IndustriesModule } from './industries/industries.module';
import { PresentationsModule } from './presentations/presentations.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { AdminReportsModule } from './admin-reports/admin-reports.module';
import { LabModule } from './lab/lab.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SuperAdminModule } from './superadmin/superadmin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Validación estricta de env al boot — si falta un secret crítico en
      // prod, el proceso NO arranca (en lugar de firmar JWT con un fallback
      // débil). Ver common/config/env.validation.ts.
      validate: (raw) => validateEnv(raw),
    }),
    AppConfigModule,
    TenantModule,
    RetentionModule,
    ScheduleModule.forRoot(),
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
    AccountingModule,
    CampaignsModule,
    BadgesModule,
    AffiliateModule,
    PayoutsModule,
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
    CrmModule,
    SequencesModule,
    SalesTeamsModule,
    EmailModule,
    JobsModule,
    AuditModule,
    BillingModule,
    IntegrationsModule,
    SettingsModule,
    SystemHealthModule,
    SupportModule,
    ReviewsModule,
    QrPostersModule,
    AdminModule,
    OnboardingModule,
    QuotesModule,
    SupportMaterialsModule,
    IndustriesModule,
    PresentationsModule,
    MaintenanceModule,
    AdminUsersModule,
    AdminReportsModule,
    LabModule,
    BroadcastsModule,
    ReservationsModule,
    SuperAdminModule,
  ],
  providers: [
    // Sin esto, `ThrottlerModule.forRoot()` y los `@Throttle({...})` por
    // endpoint son NO-OP. NestJS Throttler 5+ requiere registrar el guard
    // como APP_GUARD para que la verificación de rate limit corra en cada
    // request.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
