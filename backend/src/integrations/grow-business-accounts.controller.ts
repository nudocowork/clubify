import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { GrowBusinessAccountsService } from './grow-business-accounts.service';
import { Roles } from '../common/decorators/roles.decorator';

class CreateAccountDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(3) locationId!: string;
  @IsString() @MinLength(10) apiKey!: string;
  @IsOptional() @IsInt() @Min(1) switchNumber?: number | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() purpose?: string;
}

class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() @MinLength(3) locationId?: string;
  @IsOptional() @IsString() @MinLength(10) apiKey?: string;
  @IsOptional() switchNumber?: number | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() purpose?: string;
}

@Controller('admin/integrations/grow-business-accounts')
@Roles('SUPER_ADMIN', 'MARKETING')
export class GrowBusinessAccountsController {
  constructor(private svc: GrowBusinessAccountsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body() body: CreateAccountDto) {
    return this.svc.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateAccountDto) {
    return this.svc.update(id, body);
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.svc.test(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
