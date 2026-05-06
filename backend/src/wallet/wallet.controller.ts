import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
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
  private logger = new Logger(WalletController.name);

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
    this.logger.log(
      `Apple Wallet REGISTER request: serial=${serial} device=${deviceLibId.slice(0, 12)} pushToken=${(body?.pushToken || '').slice(0, 12)}…`,
    );
    if (!body?.pushToken || typeof body.pushToken !== 'string') {
      this.logger.warn(`REGISTER rejected: pushToken inválido para ${serial}`);
      throw new BadRequestException('pushToken requerido');
    }
    const pass = await this.prisma.pass.findUnique({ where: { serialNumber: serial } });
    if (!pass) {
      this.logger.warn(`REGISTER rejected: pass serial ${serial} not found`);
      // Apple PassKit espera 401 (no 201 con body de error) — si devolvemos
      // 201, el dispositivo cree que el registro fue exitoso y deja de
      // reintentar.
      throw new UnauthorizedException('unauthorized');
    }
    if (pass.authToken !== token) {
      this.logger.warn(
        `REGISTER rejected: authToken mismatch for ${serial} (got ${token.slice(0, 8)}…, expected ${pass.authToken.slice(0, 8)}…)`,
      );
      throw new UnauthorizedException('unauthorized');
    }

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
    this.logger.log(`REGISTER OK: pass=${pass.id} device=${deviceLibId.slice(0, 12)}`);
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
    // Apple Wallet manda errores aquí cuando algo falla en el iPhone
    // (cert inválido, webServiceURL mal, pass.json mal armado, etc.)
    const logs = body?.logs;
    if (Array.isArray(logs) && logs.length > 0) {
      for (const entry of logs) {
        this.logger.warn(`Apple Wallet log: ${entry}`);
      }
    } else if (body) {
      this.logger.warn(`Apple Wallet log payload: ${JSON.stringify(body).slice(0, 800)}`);
    }
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
