import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController, PublicCampaignsController } from './campaigns.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CampaignsService],
  controllers: [CampaignsController, PublicCampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
