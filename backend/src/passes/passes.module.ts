import { Module } from '@nestjs/common';
import { PassesService } from './passes.service';
import { PassesController } from './passes.controller';
import { WalletModule } from '../wallet/wallet.module';
import { AutomationsModule } from '../automations/automations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [WalletModule, AutomationsModule, CatalogModule, JobsModule],
  providers: [PassesService],
  controllers: [PassesController],
  exports: [PassesService],
})
export class PassesModule {}
