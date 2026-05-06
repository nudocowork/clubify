import { Module } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import { SystemHealthController } from './system-health.controller';

@Module({
  providers: [SystemHealthService],
  controllers: [SystemHealthController],
})
export class SystemHealthModule {}
