import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** Best-effort: nunca tira la transacción que lo invoca. */
  async log(args: {
    actorId?: string | null;
    tenantId?: string | null;
    action: string;
    resource: string;
    metadata?: any;
    ip?: string | null;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: args.actorId ?? null,
          tenantId: args.tenantId ?? null,
          action: args.action,
          resource: args.resource,
          metadata: args.metadata ?? {},
          ip: args.ip ?? null,
        },
      });
    } catch {
      // ignore
    }
  }
}
