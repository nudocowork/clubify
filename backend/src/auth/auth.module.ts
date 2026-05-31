import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../common/prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { RefreshTokenService } from './refresh-token.service';
import { TwoFactorService } from './two-factor.service';
import { PreregAlertsService } from './prereg-alerts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantStatusGuard } from '../common/guards/tenant-status.guard';
import { TenantLockGuard } from '../common/guards/tenant-lock.guard';
import { MaintenanceGuard } from '../maintenance/maintenance.guard';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    PassportModule,
    MaintenanceModule,
    IntegrationsModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        secret: appConfig.JWT_SECRET,
        signOptions: { expiresIn: appConfig.JWT_EXPIRES },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    RefreshTokenService,
    TwoFactorService,
    PreregAlertsService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantStatusGuard },
    { provide: APP_GUARD, useClass: TenantLockGuard },
    // MaintenanceGuard al final — necesita req.user ya populado por
    // JwtAuthGuard para hacer el bypass de SUPER_ADMIN.
    { provide: APP_GUARD, useClass: MaintenanceGuard },
    TenantLockGuard,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    JwtModule,
    RefreshTokenService,
    TwoFactorService,
    TenantLockGuard,
  ],
})
export class AuthModule {}
