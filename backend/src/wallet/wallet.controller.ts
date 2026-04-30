import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Endpoints que Apple Wallet llama desde el dispositivo del usuario.
 * Spec: https://developer.apple.com/library/archive/documentation/PassKit/Reference/PassKit_WebService/WebService.html
 */
@Controller('wallet/apple')
export class WalletController {
  constructor(private prisma: PrismaService) {}

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
}
