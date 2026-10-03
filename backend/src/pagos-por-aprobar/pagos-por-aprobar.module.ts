import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { PagosPorAprobarService } from './pagos-por-aprobar.service';
import {
  MiRegistroDePagoController,
  PagosPorAprobarController,
  RegistroDePagoPublicoController,
} from './pagos-por-aprobar.controller';

@Module({
  imports: [MediaModule, TenantsModule, ReferralsModule],
  controllers: [RegistroDePagoPublicoController, PagosPorAprobarController, MiRegistroDePagoController],
  providers: [PagosPorAprobarService],
})
export class PagosPorAprobarModule {}
