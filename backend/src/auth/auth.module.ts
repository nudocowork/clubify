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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantStatusGuard } from '../common/guards/tenant-status.guard';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    PassportModule,
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantStatusGuard },
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, RefreshTokenService, TwoFactorService],
})
export class AuthModule {}
