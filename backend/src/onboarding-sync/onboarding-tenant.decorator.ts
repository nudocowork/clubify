import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OnboardingRequest } from './onboarding-token.guard';

// Inyecta el tenantId que resolvió OnboardingTokenGuard. Los handlers /sync/*
// operan SOLO sobre este negocio (nunca sobre un tenantId del body).
export const OnboardingTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<OnboardingRequest>();
    return req.onboardingTenantId as string;
  },
);
