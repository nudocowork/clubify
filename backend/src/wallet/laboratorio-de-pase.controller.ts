import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { LaboratorioDePaseService } from './laboratorio-de-pase.service';

/**
 * Pases de PRUEBA del laboratorio de tarjetas (/laboratorio-tarjetas): armar
 * uno con el diseño en pantalla, ver los que ya se instalaron y sumarles o
 * quitarles sellos para ver en el celular lo que verá un cliente.
 *
 * No crea tarjeta, ni cliente, ni pase en la base. El estado vive en el bucket
 * (ver `LaboratorioDePaseService`).
 *
 * SOLO EL EQUIPO DE LA PLATAFORMA: firma con el certificado de Apple y la
 * cuenta de Google de Clubify. Abierto a cualquiera, serviría para fabricar
 * pases firmados por nosotros con cualquier texto.
 */
@Controller('wallet/laboratorio')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN', 'MARKETING')
export class LaboratorioDePaseController {
  constructor(private laboratorio: LaboratorioDePaseService) {}

  @Post('pase')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  crearPase(@Body() cuerpo: unknown) {
    return this.laboratorio.crear(cuerpo);
  }

  @Get('pases')
  listar() {
    return this.laboratorio.listar();
  }

  /** Cuerpo: `{ sellados?, gastado?, saldo? }`, valores absolutos. */
  @Post('pases/:id/progreso')
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  moverProgreso(@Param('id') id: string, @Body() cuerpo: unknown) {
    return this.laboratorio.moverProgreso(id, cuerpo);
  }

  /**
   * El QR de Android apunta aquí (ver `enlaceDeGoogle`). Público: lo abre el
   * celular sin sesión, igual que el .pkpass del iPhone, que también es público.
   */
  @Public()
  @Get('google/:id')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async abrirEnGoogle(@Param('id') id: string, @Res() res: Response) {
    const url = await this.laboratorio.enlaceLargoDeGoogle(id);
    if (!url) throw new NotFoundException('Esa prueba no existe.');
    res.redirect(302, url);
  }

  @Delete('pases/:id')
  quitar(@Param('id') id: string) {
    return this.laboratorio.quitar(id);
  }
}
