import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { GrowBusinessService } from './grow-business.service';
import { Roles } from '../common/decorators/roles.decorator';

class ConnectDto {
  @IsString() @MinLength(3) locationId!: string;
  @IsString() @MinLength(10) apiKey!: string;
  @IsOptional() @IsInt() @Min(1) switchNumber?: number;
}

class SwitchDto {
  // switchNumber puede ser null explícito para limpiar el prefijo.
  @IsOptional() @IsInt() @Min(1) switchNumber?: number | null;
}

@Controller('admin/tenants/:id/grow-business')
@Roles('SUPER_ADMIN')
export class GrowBusinessController {
  constructor(private svc: GrowBusinessService) {}

  @Get()
  status(@Param('id') id: string) {
    return this.svc.getStatus(id);
  }

  @Post()
  connect(@Param('id') id: string, @Body() body: ConnectDto) {
    return this.svc.connect(id, body.locationId, body.apiKey, body.switchNumber);
  }

  /** PATCH solo del switch — sin volver a pedir locationId+apiKey. Útil
   *  cuando el admin quiere ajustar el #Switch{N} de un tenant ya
   *  conectado. */
  @Patch('switch')
  setSwitch(@Param('id') id: string, @Body() body: SwitchDto) {
    return this.svc.setSwitchNumber(id, body.switchNumber ?? null);
  }

  @Post('test')
  test(@Param('id') id: string) {
    return this.svc.testConnection(id);
  }

  @Delete()
  disconnect(@Param('id') id: string) {
    return this.svc.disconnect(id);
  }
}
