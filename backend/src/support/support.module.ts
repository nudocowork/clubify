import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SettingsModule } from '../settings/settings.module';
import { MediaModule } from '../media/media.module';
import { VoyageService } from './voyage.service';
import { KnowledgeDocumentService } from './knowledge-document.service';

@Module({
  imports: [SettingsModule, MediaModule],
  providers: [SupportService, VoyageService, KnowledgeDocumentService],
  controllers: [SupportController],
})
export class SupportModule {}
