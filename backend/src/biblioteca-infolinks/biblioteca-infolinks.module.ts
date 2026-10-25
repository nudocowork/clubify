import { Module } from '@nestjs/common';
import { BibliotecaInfolinksController } from './biblioteca-infolinks.controller';
import { BibliotecaInfolinksService } from './biblioteca-infolinks.service';

/** «Biblioteca de Infolinks» del panel /admin. Solo lee. */
@Module({
  controllers: [BibliotecaInfolinksController],
  providers: [BibliotecaInfolinksService],
})
export class BibliotecaInfolinksModule {}
