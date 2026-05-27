import { Module } from '@nestjs/common';
import { SalesTeamsService } from './sales-teams.service';
import { SalesTeamsController } from './sales-teams.controller';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CrmModule],
  providers: [SalesTeamsService],
  controllers: [SalesTeamsController],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
