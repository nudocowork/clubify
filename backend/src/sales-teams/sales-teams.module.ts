import { Module } from '@nestjs/common';
import { SalesTeamsService } from './sales-teams.service';
import { SalesTeamsController } from './sales-teams.controller';

@Module({
  providers: [SalesTeamsService],
  controllers: [SalesTeamsController],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
