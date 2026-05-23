import { Module } from '@nestjs/common';
import { GrowBusinessService } from './grow-business.service';
import { GrowBusinessController } from './grow-business.controller';
import { GrowBusinessAccountsService } from './grow-business-accounts.service';
import { GrowBusinessAccountsController } from './grow-business-accounts.controller';

@Module({
  providers: [GrowBusinessService, GrowBusinessAccountsService],
  controllers: [GrowBusinessController, GrowBusinessAccountsController],
  exports: [GrowBusinessService, GrowBusinessAccountsService],
})
export class IntegrationsModule {}
