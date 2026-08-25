import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { AppConfigService } from '../common/config/app-config.service';

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
  tenantId: string | null;
  // ID del SUPER_ADMIN/MARKETING que está impersonando este tenant. null
  // si la sesión es legítima del owner. Propagado al AuthUser para
  // auditar acciones destructivas hechas desde sesión impostada.
  impersonatedBy?: string | null;
  // Marca blanca activa de la sesión (cuando PLATFORM_OWNER "entra" a una
  // marca vía impersonateWhiteLabel). Cuando está presente, los dashboards
  // de /admin scopean sus métricas a los tenants de esta marca.
  whiteLabelId?: string | null;
  // Empresa de domicilios de la sesión (role=DELIVERY_COMPANY). El portal
  // /domicilios scopea sus domicilios a esta empresa. (Fase 2, 2026-06-30)
  deliveryCompanyId?: string | null;
  // Negocio aliado de la sesión (role=ALLY_BUSINESS). El portal
  // /cuponera/negocio scopea a esta ficha. (Cuponera Fase 2)
  allyBusinessId?: string | null;
  campaignId?: string | null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(appConfig: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: appConfig.JWT_SECRET,
    });
  }

  validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
      impersonatedBy: payload.impersonatedBy ?? null,
      whiteLabelId: payload.whiteLabelId ?? null,
      deliveryCompanyId: payload.deliveryCompanyId ?? null,
      allyBusinessId: payload.allyBusinessId ?? null,
      campaignId: payload.campaignId ?? null,
    };
  }
}
