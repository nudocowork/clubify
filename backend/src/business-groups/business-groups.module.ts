import { Module } from '@nestjs/common';
import { BusinessGroupsService } from './business-groups.service';
import { BusinessGroupsController } from './business-groups.controller';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  // ReferralsModule: para generar la comisión del grupo al activarse/cobrarse
  // o al asignarle un recipiente (P1 PDF 2026-07-01). Sin ciclo: ReferralsService
  // no depende de BusinessGroups.
  imports: [ReferralsModule],
  providers: [BusinessGroupsService],
  controllers: [BusinessGroupsController],
  // Exportado para que HotmartService cascadee los pagos del grupo.
  exports: [BusinessGroupsService],
})
export class BusinessGroupsModule {}
