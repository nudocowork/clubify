import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { GrowBusinessService } from './grow-business.service';
import { Roles } from '../common/decorators/roles.decorator';

class ConnectDto {
  @IsString() @MinLength(3) locationId!: string;
  @IsString() @MinLength(10) apiKey!: string;
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
    return this.svc.connect(id, body.locationId, body.apiKey);
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
