import { Module } from '@nestjs/common';
import { SalesTeamsService } from './sales-teams.service';
import { SalesTeamsController } from './sales-teams.controller';
import { SalesLeadsService } from './sales-leads.service';
import { SalesLeadsController } from './sales-leads.controller';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CrmModule],
  providers: [SalesTeamsService, SalesLeadsService],
  controllers: [SalesTeamsController, SalesLeadsController],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
