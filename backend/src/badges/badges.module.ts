import { Module } from '@nestjs/common';
import { BadgesService } from './badges.service';
import { GamificationService } from './gamification.service';
import { BadgesController } from './badges.controller';

@Module({
  providers: [BadgesService, GamificationService],
  controllers: [BadgesController],
  exports: [BadgesService, GamificationService],
})
export class BadgesModule {}
