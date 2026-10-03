import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PagosPorAprobarService } from './pagos-por-aprobar.service';

/** Un comprobante es una foto o un PDF: 15 MB sobra y frena subidas abusivas. */
const LIMITE_COMPROBANTE = 15 * 1024 * 1024;

/** El formulario del closer: público, se entra por su enlace firmado. */
@Controller('public/registro-pago')
export class RegistroDePagoPublicoController {
  constructor(private svc: PagosPorAprobarService) {}

  @Public()
  @Get(':token')
  abrir(@Param('token') token: string) {
    return this.svc.abrirEnlace(token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post(':token')
  @UseInterceptors(FileInterceptor('comprobante', { limits: { fileSize: LIMITE_COMPROBANTE } }))
  registrar(
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() comprobante?: Express.Multer.File,
  ) {
    return this.svc.registrar(token, body, comprobante);
  }
}

/** La bandeja «Pendientes de aprobación» del panel de Negocios. */
@Controller('admin/pagos-por-aprobar')
@Roles('SUPER_ADMIN')
export class PagosPorAprobarController {
  constructor(private svc: PagosPorAprobarService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser, @Query('estado') estado?: string) {
    return this.svc.listar(user, estado);
  }

  @Get('contador')
  contador(@CurrentUser() user: AuthUser) {
    return this.svc.contarPendientes(user);
  }

  @Get('enlaces')
  enlaces(@CurrentUser() user: AuthUser) {
    return this.svc.enlaces(user);
  }

  @Get(':id')
  detalle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.detalle(user, id);
  }

  @Post(':id/aprobar')
  aprobar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { amountUsd?: number },
  ) {
    const usd = body?.amountUsd == null || (body.amountUsd as unknown) === '' ? undefined : Number(body.amountUsd);
    return this.svc.aprobar(user, id, { amountUsd: usd });
  }

  @Post(':id/rechazar')
  rechazar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { motivo?: string },
  ) {
    return this.svc.rechazar(user, id, body?.motivo ?? '');
  }
}

/** El enlace propio, para el panel del afiliado. */
@Controller('affiliate/registro-pago')
@Roles('AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_SOCIO', 'AFFILIATE_VENDOR')
export class MiRegistroDePagoController {
  constructor(private svc: PagosPorAprobarService) {}

  @Get()
  miEnlace(@CurrentUser() user: AuthUser) {
    return this.svc.miEnlace(user);
  }
}
