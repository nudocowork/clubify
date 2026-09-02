import { Module } from '@nestjs/common';
import { ClubService } from './club.service';
import { ClubController } from './club.controller';
import { WalletModule } from '../wallet/wallet.module';

/**
 * Tarjeta de Club — suscripción del cliente al negocio con cupo mensual.
 *
 * `WalletModule` va aquí porque `ClubService` inyecta `WalletService` para
 * empujar el pase al móvil cuando el socio consume, cuando se le pausa y
 * cuando le entra el cupo del mes. Sin este import la aplicación NO ARRANCA
 * —«Nest can't resolve dependencies of the ClubService»— y el contenedor
 * muere en el healthcheck: producción se queda con la imagen anterior y lo
 * único que lo delata es que las rutas nuevas dan 404.
 *
 * Los tests no lo ven porque construyen `ClubService` a mano con sus tres
 * dependencias; el grafo de módulos solo se arma de verdad al arrancar.
 *
 * `QueueService` no hace falta declararlo: `JobsModule` es `@Global()`.
 */
@Module({
  imports: [WalletModule],
  providers: [ClubService],
  controllers: [ClubController],
  exports: [ClubService],
})
export class ClubModule {}
