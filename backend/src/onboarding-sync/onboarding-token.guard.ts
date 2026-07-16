import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { OnboardingService } from './onboarding.service';

// Request con el tenantId resuelto por el token de onboarding.
export type OnboardingRequest = Request & { onboardingTenantId?: string };

// Guard para los endpoints /sync/*: lee `Authorization: Bearer <token>`,
// resuelve el negocio dueño del token y lo deja en req.onboardingTenantId.
// IMPOSIBLE tocar otro negocio: el tenantId viene del token, nunca del body.
@Injectable()
export class OnboardingTokenGuard implements CanActivate {
  constructor(private readonly onboarding: OnboardingService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<OnboardingRequest>();
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
    const token = match?.[1]?.trim();
    if (!token) {
      throw new UnauthorizedException(
        'Falta el token de onboarding (Authorization: Bearer <token>).',
      );
    }
    const tenantId = await this.onboarding.resolveToken(token);
    if (!tenantId) {
      throw new UnauthorizedException('Token inválido o revocado.');
    }
    req.onboardingTenantId = tenantId;
    return true;
  }
}
