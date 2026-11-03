import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AbonosService } from './abonos.service';

class EnlazarBody {
  @IsString() @MaxLength(60) pagoTx!: string;
  @IsOptional() @IsString() @MaxLength(300) nota?: string;
}

class NotaBody {
  @IsOptional() @IsString() @MaxLength(300) nota?: string;
}

/** Abonos de USD 20 de Clubify. Dinero de la plataforma: solo SUPER_ADMIN. */
@UseGuards(SoloPlataformaGuard)
@Controller('admin/contabilidad/abonos')
export class AbonosController {
  constructor(private abonos: AbonosService) {}

  @Roles('SUPER_ADMIN')
  @Get()
  listar() {
    return this.abonos.listar();
  }

  @Roles('SUPER_ADMIN')
  @Post(':tx/enlazar')
  enlazar(@Param('tx') tx: string, @Body() body: EnlazarBody, @CurrentUser() user: AuthUser) {
    return this.abonos.enlazar(tx, body.pagoTx, body.nota?.trim() || null, user?.id ?? null);
  }

  @Roles('SUPER_ADMIN')
  @Post(':tx/no-pagara')
  noPagara(@Param('tx') tx: string, @Body() body: NotaBody, @CurrentUser() user: AuthUser) {
    return this.abonos.marcarNoPagara(tx, body.nota?.trim() || null, user?.id ?? null);
  }

  @Roles('SUPER_ADMIN')
  @Delete(':tx/decision')
  deshacer(@Param('tx') tx: string) {
    return this.abonos.deshacer(tx);
  }
}
