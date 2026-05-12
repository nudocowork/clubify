import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class TenantModule {}
