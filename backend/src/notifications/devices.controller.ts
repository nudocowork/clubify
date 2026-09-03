import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { IsIn, IsString, MinLength } from 'class-validator';
import { DevicesService } from './devices.service';
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
  constructor(private svc: DevicesService) {}

  @Post()
  registrar(@CurrentUser() user: AuthUser, @Body() body: RegistrarBody) {
    return this.svc.registrar(user.id, body.token, body.platform);
  }

  @Delete(':token')
  borrar(@Param('token') token: string) {
    return this.svc.borrar(token);
  }
}
