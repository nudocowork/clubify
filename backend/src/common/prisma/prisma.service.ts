import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantMiddleware } from './prisma-tenant-middleware';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    // Multi-tenant enforcement automático para todas las queries que tengan
    // contexto activo (request HTTP con user autenticado). Ver detalles en
    // prisma-tenant-middleware.ts.
    this.$use(tenantMiddleware());
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected · multi-tenant middleware activo');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
