import { Module } from '@nestjs/common';
import { VigilanteService } from './vigilante.service';
import { VigilanciaDeActividadService } from './vigilancia-de-actividad.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Vigilancia: lo que se rompe en silencio.
 *
 * Módulo aparte y no dentro de billing o de orders a propósito: mira VARIOS
 * dominios a la vez —cobros, pedidos, datos de contacto— y precisamente su
 * valor está en cruzarlos. Metido dentro de uno de ellos acabaría heredando
 * sus dependencias y nadie se atrevería a añadirle comprobaciones.
 *
 * Dos vigilantes, y no se pisan:
 *
 *  · `VigilanteService` busca INCOHERENCIAS —dos sitios que deberían decir lo
 *    mismo y no lo dicen—. Una pasada al día, un solo mensaje con todo.
 *  · `VigilanciaDeActividadService` busca que siga PASANDO lo que tiene que
 *    pasar: cero pedidos un viernes a las 8 es una avería aunque todos los
 *    números cuadren entre sí. Cada hora, y avisa solo cuando cambia el estado.
 *
 * Uno caza «el número está mal», el otro «dejó de pasar». Ninguno de los dos
 * ve lo del otro.
 */
@Module({
  imports: [AuthModule],
  providers: [VigilanteService, VigilanciaDeActividadService],
})
export class VigilanciaModule {}
