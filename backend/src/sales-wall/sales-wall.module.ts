import { Module } from '@nestjs/common';
import { SalesWallController } from './sales-wall.controller';
import { SalesWallService } from './sales-wall.service';

/** Sales Wall: ventas y renovaciones del mes para la TV de la oficina. Solo lee. */
@Module({
  controllers: [SalesWallController],
  providers: [SalesWallService],
})
export class SalesWallModule {}
