import { Module } from '@nestjs/common';
import { BusinessGroupsService } from './business-groups.service';
import { BusinessGroupsController } from './business-groups.controller';

@Module({
  providers: [BusinessGroupsService],
  controllers: [BusinessGroupsController],
  // Exportado para que HotmartService cascadee los pagos del grupo.
  exports: [BusinessGroupsService],
})
export class BusinessGroupsModule {}
