import { Module } from '@nestjs/common';
import { VigilanteService } from './vigilante.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Vigilancia: lo que se rompe en silencio.
 *
 * Módulo aparte y no dentro de billing o de orders a propósito: mira VARIOS
 * dominios a la vez —cobros, pedidos, datos de contacto— y precisamente su
 * valor está en cruzarlos. Metido dentro de uno de ellos acabaría heredando
 * sus dependencias y nadie se atrevería a añadirle comprobaciones.
 */
@Module({
  imports: [AuthModule],
  providers: [VigilanteService],
})
export class VigilanciaModule {}
