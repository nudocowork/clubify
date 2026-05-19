import { Module } from '@nestjs/common';
import { SupportMaterialsService } from './support-materials.service';
import {
  SupportMaterialsAdminController,
  SupportMaterialsAffiliateController,
} from './support-materials.controller';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  providers: [SupportMaterialsService],
  controllers: [
    SupportMaterialsAdminController,
    SupportMaterialsAffiliateController,
  ],
})
export class SupportMaterialsModule {}
