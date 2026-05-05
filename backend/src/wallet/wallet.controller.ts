import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { WalletService } from './wallet.service';

/**
 * Endpoints que Apple Wallet llama desde el dispositivo del usuario.
 * Spec: https://developer.apple.com/library/archive/documentation/PassKit/Reference/PassKit_WebService/WebService.html
 */
@Controller('wallet/apple')
export class WalletController {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
  ) {}

  // Registro de dispositivo
  @Public()
  @Post('v1/devices/:deviceLibId/registrations/:passTypeId/:serial')
  @HttpCode(201)
  async register(
    @Param('deviceLibId') deviceLibId: string,
    @Param('serial') serial: string,
    @Body() body: { pushToken: string },
    @Req() req: Request,
  ) {
    const auth = req.headers['authorization'] ?? '';
    const token = String(auth).replace(/^ApplePass /, '');
    const pass = await this.prisma.pass.findUnique({ where: { serialNumber: serial } });
    if (!pass || pass.authToken !== token) return { error: 'unauthorized' };

    await this.prisma.walletDevice.upsert({
      where: { passId_deviceLibraryId: { passId: pass.id, deviceLibraryId: deviceLibId } },
      update: { pushToken: body.pushToken },
      create: {
        passId: pass.id,
        deviceLibraryId: deviceLibId,
        pushToken: body.pushToken,
        platform: 'APPLE',
      },
    });
    return { ok: true };
  }

  @Public()
  @Delete('v1/devices/:deviceLibId/registrations/:passTypeId/:serial')
  async unregister(
    @Param('deviceLibId') deviceLibId: string,
    @Param('serial') serial: string,
  ) {
    const pass = await this.prisma.pass.findUnique({ where: { serialNumber: serial } });
    if (!pass) return { ok: true };
    await this.prisma.walletDevice.deleteMany({
      where: { passId: pass.id, deviceLibraryId: deviceLibId },
    });
    return { ok: true };
  }

  @Public()
  @Get('v1/devices/:deviceLibId/registrations/:passTypeId')
  async listUpdates(@Param('deviceLibId') deviceLibId: string) {
    const devices = await this.prisma.walletDevice.findMany({
      where: { deviceLibraryId: deviceLibId },
      include: { pass: true },
    });
    return {
      lastUpdated: new Date().toISOString(),
      serialNumbers: devices.map((d) => d.pass.serialNumber),
    };
  }

  @Public()
  @Post('v1/log')
  log(@Body() body: any) {
    // Apple manda errores de pase aquí; en prod loguear a Sentry/Pino
    return { ok: true };
  }

  /**
   * Apple Wallet llama esto para descargar el .pkpass actualizado cuando
   * recibe un push silencioso. Spec exige:
   * - Authorization: ApplePass <authToken>
   * - 200 con bytes del .pkpass + If-Modified-Since soportado
   * - 401 si auth falla, 304 si nada cambió
   */
  @Public()
  @Get('v1/passes/:passTypeId/:serial')
  async fetchUpdatedPass(
    @Param('serial') serial: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const auth = req.headers['authorization'] ?? '';
    const token = String(auth).replace(/^ApplePass /, '');
    const meta = await this.wallet.getPassMeta(serial, token);
    if (!meta) {
      res.status(401).end();
      return;
    }

    // If-Modified-Since: si el cliente ya tiene esta versión, devolvemos 304
    const ims = req.headers['if-modified-since'];
    if (ims) {
      const since = new Date(String(ims)).getTime();
      if (since >= meta.lastUpdated.getTime()) {
        res.status(304).end();
        return;
      }
    }

    const buf = await this.wallet.generateApplePass(meta.id);
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': meta.lastUpdated.toUTCString(),
    });
    res.send(buf);
  }
}
