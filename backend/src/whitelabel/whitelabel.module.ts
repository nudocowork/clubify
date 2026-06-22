import { Global, Module } from '@nestjs/common';
import { WhitelabelBrandService } from './whitelabel-brand.service';

/**
 * Módulo global del resolver de marca por tenant. Cualquier servicio (storefront,
 * stamps, reservas, qr) puede inyectar WhitelabelBrandService sin wiring extra.
 */
@Global()
@Module({
  providers: [WhitelabelBrandService],
  exports: [WhitelabelBrandService],
})
export class WhitelabelModule {}
