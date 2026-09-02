import { Module } from '@nestjs/common';
import { ConveniosService } from './convenios.service';
import { ConveniosCanjeService } from './convenios-canje.service';
import { ConveniosController } from './convenios.controller';
import { AlianzasPublicoService } from './alianzas-publico.service';
import { AlianzasPortalService } from './alianzas-portal.service';
import {
  AlianzasPublicoController,
  AlianzasPortalController,
} from './alianzas-publico.controller';
import { JobsModule } from '../jobs/jobs.module';
import { AutomationsModule } from '../automations/automations.module';

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
  // `AutomationsModule` para poder emitir `PASS_CREATED` al activar una
  // alianza: sin él, el empleado no recibe el mensaje de bienvenida y ninguna
  // regla del negocio se entera de que existe.
  imports: [JobsModule, AutomationsModule],
  providers: [
    ConveniosService,
    ConveniosCanjeService,
    AlianzasPublicoService,
    AlianzasPortalService,
  ],
  // Dos controladores a propósito: uno con sesión (el panel del negocio) y otro
  // sin ella (el enlace del empleado y el portal del aliado). Separados porque
  // en el público no hay `AuthUser` del que sacar el `tenantId` y cada ruta
  // tiene que resolverlo y comprobarlo por su cuenta; mezclarlos es como se
  // acaban colando rutas públicas sin guarda entre las que sí la tienen.
  controllers: [
    ConveniosController,
    AlianzasPublicoController,
    AlianzasPortalController,
  ],
  exports: [ConveniosService, ConveniosCanjeService],
})
export class ConveniosModule {}
