import { Global, Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

@Global()
@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
