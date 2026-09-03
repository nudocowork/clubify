import { Module } from '@nestjs/common';
import { ConveniosService } from './convenios.service';
import { ConveniosCanjeService } from './convenios-canje.service';
import { ConveniosController } from './convenios.controller';
import { JobsModule } from '../jobs/jobs.module';

/**
 * Convenios: un negocio le da un beneficio permanente a los empleados de una
 * empresa aliada.
 *
 * NO confundir con:
 *   - `CampaignsModule`  → campañas de influencers (afiliados y comisiones).
 *   - `CuponeraModule`   → Living Card: la plataforma monta la campaña, los
 *                          negocios son los aliados y el miembro paga.
 *
 * Tres cosas que se llamaban «campaña» era una de más; por eso esto se llama
 * Convenios, que además es como lo dicen los negocios.
 */
@Module({
  imports: [JobsModule],
  providers: [ConveniosService, ConveniosCanjeService],
  controllers: [ConveniosController],
  exports: [ConveniosService, ConveniosCanjeService],
})
export class ConveniosModule {}
