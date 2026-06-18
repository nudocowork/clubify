import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
  /** ID del SUPER_ADMIN/MARKETING que originó la impersonación. null si
   *  la sesión es legítima del owner. Audit logs deben incluirlo cuando
   *  está presente para que pintarse correctamente "quién hizo qué". */
  impersonatedBy?: string | null;
  /** Marca blanca activa de la sesión (impersonación de white-label por un
   *  PLATFORM_OWNER). Presente → los dashboards de /admin scopean sus
   *  métricas a los tenants de esta marca. null → vista global. */
  whiteLabelId?: string | null;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
