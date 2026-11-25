import { Body, Controller, Logger, Post, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { Roles } from '../common/decorators/roles.decorator';
import { MediaService } from '../media/media.service';
import { WalletService } from './wallet.service';
import { GoogleWalletService } from './google-wallet.service';
import { cabeceraDelPase, validarPaseDeLaboratorio } from './franja-de-laboratorio';

/**
 * Pase de PRUEBA desde el laboratorio de tarjetas (/laboratorio-tarjetas):
 * arma un .pkpass y un enlace de Google con el diseño que está en pantalla,
 * para verlo instalado en un celular de verdad.
 *
 * No crea tarjeta, ni cliente, ni pase en la base. Lo único que queda son dos
 * archivos en `laboratorio/` del bucket (la franja, que Google descarga, y el
 * .pkpass, que el iPhone abre sin sesión).
 *
 * SOLO EL EQUIPO DE LA PLATAFORMA: firma con el certificado de Apple y la
 * cuenta de Google de Clubify. Abierto a cualquiera, serviría para fabricar
 * pases firmados por nosotros con cualquier texto.
 */
@Controller('wallet/laboratorio')
export class LaboratorioDePaseController {
  private logger = new Logger(LaboratorioDePaseController.name);

  constructor(
    private wallet: WalletService,
    private google: GoogleWalletService,
    private media: MediaService,
  ) {}

  @Post('pase')
  @Roles('PLATFORM_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async crearPase(@Body() cuerpo: unknown) {
    const { config, negocio, titular } = validarPaseDeLaboratorio(cuerpo);
    const id = randomUUID().replace(/-/g, '').slice(0, 20);
    const cabecera = cabeceraDelPase(config);

    const franja = await this.wallet.dibujarFranjaDeLaboratorio(config);
    const hero = await this.media.uploadRaw({
      folder: 'laboratorio',
      fileName: 'franja.png',
      buffer: franja['strip@3x.png'],
      contentType: 'image/png',
    });

    const pkpass = await this.wallet.generarPaseDeLaboratorio({ id, negocio, titular, config, cabecera, franja });
    const apple = pkpass
      ? await this.media.uploadRaw({
          folder: 'laboratorio',
          fileName: 'tarjeta.pkpass',
          buffer: pkpass,
          contentType: 'application/vnd.apple.pkpass',
        })
      : null;

    const googleUrl = this.google.urlDeLaboratorio({
      id,
      negocio,
      titular,
      premio: config.premio,
      fondo: config.fondo,
      cabecera,
      heroUrl: hero.url,
    });

    if (!apple && !googleUrl) {
      throw new ServiceUnavailableException('Las billeteras no están configuradas en este servidor.');
    }
    this.logger.log(`Pase de laboratorio ${id}: estilo=${config.estilo} apple=${!!apple} google=${!!googleUrl}`);
    return { id, franjaUrl: hero.url, appleUrl: apple?.url ?? null, googleUrl };
  }
}
