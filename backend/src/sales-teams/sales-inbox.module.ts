import { Module } from '@nestjs/common';
import { SalesInboxService } from './sales-chat.service';

/**
 * Solo «lo que entra» del chat de ventas.
 *
 * Existe para romper un ciclo de módulos, no por diseño: el webhook de
 * marketing necesita guardar el mensaje entrante, y el módulo de equipos ya
 * importa marketing para poder ENVIAR. Si el servicio entero viviera en el
 * módulo de equipos, los dos se importarían en círculo y Nest no arranca.
 *
 * Este módulo no importa nada (Prisma es global), así que se puede colgar de
 * donde haga falta sin arrastrar dependencias.
 */
@Module({
  providers: [SalesInboxService],
  exports: [SalesInboxService],
})
export class SalesInboxModule {}
