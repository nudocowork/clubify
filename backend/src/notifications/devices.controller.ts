import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { IsIn, IsString, MinLength } from 'class-validator';
import { DevicesService } from './devices.service';
import { AppPushService } from './app-push.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class RegistrarBody {
  @IsString() @MinLength(10) token!: string;
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
}

/**
 * SIN @Roles a propósito: cualquier cuenta que inicie sesión en la app tiene
 * que poder registrar su teléfono — dueño, staff, empresa de domicilios,
 * cuponera o afiliado. El guard exige sesión igual; lo que no hace es
 * restringir por rol.
 */
@Controller('devices')
export class DevicesController {
  constructor(
    private svc: DevicesService,
    private push: AppPushService,
  ) {}

  @Post()
  registrar(@CurrentUser() user: AuthUser, @Body() body: RegistrarBody) {
    return this.svc.registrar(user.id, body.token, body.platform);
  }

  @Delete(':token')
  borrar(@Param('token') token: string) {
    return this.svc.borrar(token);
  }

  /**
   * Manda una notificación de prueba a los dispositivos de QUIEN LLAMA.
   * Solo a uno mismo: así no hace falta restringir por rol y nadie puede
   * usarlo para molestar a otra cuenta.
   */
  @Post('prueba')
  async prueba(@CurrentUser() user: AuthUser) {
    const dispositivos = await this.svc.tokensDe(user.id);
    const r = await this.push.enviarAUsuario(user.id, {
      titulo: 'Clubify',
      cuerpo: 'Las notificaciones están funcionando 🎉',
      ruta: '/hub',
    });
    return { registrados: dispositivos.length, enviados: r.enviados };
  }
}
