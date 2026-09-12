import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { SalesLeadsService } from './sales-leads.service';
import { ResumenDeEquipoService } from './resumen-de-equipo.service';
import {
  ListasDeEquipoService,
  type FiltroDeLista,
} from './listas-de-equipo.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

/**
 * El tablero del equipo de ventas de una marca.
 *
 * Cuelga de `/sales-teams/:teamId/...` y NO de `/admin/...` a propósito: aquí
 * entra el vendedor, no el super admin. Quién puede y con qué permisos lo
 * decide `resolveTeamAccess` en cada método del servicio — incluido el
 * interruptor del módulo, que se comprueba en el servidor y no solo escondiendo
 * el menú.
 *
 * Los roles del decorador son la primera puerta (hay que tener sesión de casa
 * o de marca); la segunda, la que de verdad aísla, está dentro.
 */
class LeadBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(160) email?: string | null;
  @IsOptional() @IsString() @MaxLength(80) instagram?: string | null;
  @IsOptional() @IsString() @MaxLength(120) company?: string | null;
  @IsOptional() @IsString() @MaxLength(60) source?: string | null;
  @IsOptional() @IsNumber() value?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() assignedUserId?: string | null;
  @IsOptional() @IsString() stageId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) lostReason?: string | null;
}

class MoverBody {
  @IsString() stageId!: string;
  /** La columna en la que el vendedor CREÍA que estaba, para no pisar a otro. */
  @IsOptional() @IsString() stageIdActual?: string | null;
}

class ColumnaBody {
  @IsString() @MaxLength(40) name!: string;
  @IsOptional() @IsString() @MaxLength(9) color?: string | null;
}

class ColumnaEditBody {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsString() @MaxLength(9) color?: string | null;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

class NotaBody {
  @IsString() @MaxLength(4000) body!: string;
  /** nota · llamada · mensaje · cita. Lo que no reconozca cae en «nota». */
  @IsOptional() @IsString() @MaxLength(20) kind?: string;
}

@Controller('sales-teams/:teamId')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_STAFF')
export class SalesLeadsController {
  constructor(
    private svc: SalesLeadsService,
    private resumen: ResumenDeEquipoService,
    private listas: ListasDeEquipoService,
  ) {}

  /** Banco · Contactos · Clientes: la misma lista con otro filtro. */
  @Get('lista')
  lista(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('filtro') filtro?: string,
    @Query('buscar') buscar?: string,
  ) {
    const valido: FiltroDeLista[] = ['banco', 'contactos', 'clientes'];
    return this.listas.leads(user, teamId, {
      filtro: valido.includes(filtro as FiltroDeLista)
        ? (filtro as FiltroDeLista)
        : 'contactos',
      buscar,
    });
  }

  @Get('seguimientos')
  seguimientos(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('estado') estado?: string,
  ) {
    const valido = ['pendientes', 'hechos', 'todos'] as const;
    return this.listas.seguimientos(user, teamId, {
      estado: (valido as readonly string[]).includes(estado ?? '')
        ? (estado as 'pendientes' | 'hechos' | 'todos')
        : 'pendientes',
    });
  }

  /**
   * El Resumen del equipo. Cuelga de aquí y no de `admin/sales-teams` porque
   * es una vista POR EQUIPO: los mismos roles y el mismo prefijo que el resto
   * de pantallas del equipo, y `resolveTeamAccess` dentro.
   */
  @Get('resumen')
  resumenDelEquipo(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    const d = desde ? new Date(desde) : undefined;
    const h = hasta ? new Date(hasta) : undefined;
    return this.resumen.resumen(user, teamId, {
      desde: d && !Number.isNaN(d.getTime()) ? d : undefined,
      hasta: h && !Number.isNaN(h.getTime()) ? h : undefined,
    });
  }

  @Get('board')
  tablero(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.svc.tablero(user, teamId);
  }

  @Post('stages')
  crearColumna(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Body() body: ColumnaBody,
  ) {
    return this.svc.crearColumna(user, teamId, body);
  }

  @Patch('stages/:stageId')
  editarColumna(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('stageId') stageId: string,
    @Body() body: ColumnaEditBody,
  ) {
    return this.svc.editarColumna(user, teamId, stageId, body);
  }

  @Delete('stages/:stageId')
  borrarColumna(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('stageId') stageId: string,
  ) {
    return this.svc.borrarColumna(user, teamId, stageId);
  }

  @Post('leads')
  crearLead(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Body() body: LeadBody,
  ) {
    return this.svc.crearLead(user, teamId, body);
  }

  @Get('leads/:leadId')
  verLead(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
  ) {
    return this.svc.verLead(user, teamId, leadId);
  }

  @Patch('leads/:leadId')
  editarLead(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
    @Body() body: LeadBody,
  ) {
    return this.svc.editarLead(user, teamId, leadId, body);
  }

  @Patch('leads/:leadId/stage')
  moverLead(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
    @Body() body: MoverBody,
  ) {
    return this.svc.moverLead(
      user,
      teamId,
      leadId,
      body.stageId,
      body.stageIdActual,
    );
  }

  @Delete('leads/:leadId')
  borrarLead(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
  ) {
    return this.svc.borrarLead(user, teamId, leadId);
  }

  @Post('leads/:leadId/notes')
  anotar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
    @Body() body: NotaBody,
  ) {
    return this.svc.anotarNota(user, teamId, leadId, body);
  }
}
