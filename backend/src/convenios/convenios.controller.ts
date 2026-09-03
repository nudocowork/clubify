import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { ConveniosService } from './convenios.service';
import { ConveniosCanjeService } from './convenios-canje.service';

// CuponBody va ANTES que ConvenioBody a propósito: `ConvenioBody.beneficio` lo
// referencia y, con `emitDecoratorMetadata`, el decorador emite un
// `design:type` que evalúa la clase en cuanto se define. Declararla después
// reventaría al arrancar con un ReferenceError, no al compilar.
class CuponBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['PERCENT_OFF', 'AMOUNT_OFF', 'FREEBIE', 'TWO_FOR_ONE', 'OTHER'])
  tipo?: any;
  @IsOptional() @IsInt() @Min(0) valor?: number;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(1) maxPorPersona?: number | null;
  @IsOptional() @IsIn(['SIEMPRE', 'DIA', 'SEMANA', 'MES', 'ANIO']) periodo?: any;
  @IsOptional() @IsInt() @Min(1) maxTotal?: number | null;
  @IsOptional() @IsInt() @Min(0) compraMinima?: number | null;
  @IsOptional() @IsInt() @Min(0) topeDescuento?: number | null;
  /** null o ausente = sin fecha de fin. */
  @IsOptional() @IsString() endsAt?: string | null;
}

class ConvenioBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string | null;
  @IsOptional() @IsString() @MaxLength(160) contactEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string | null;
  @IsOptional() @IsIn(['ABIERTO', 'CODIGO', 'LISTA'])
  verificacion?: 'ABIERTO' | 'CODIGO' | 'LISTA';
  @IsOptional() @IsString() @MaxLength(40) codigo?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED', 'FINISHED'])
  status?: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  /** null o ausente = vigencia ILIMITADA. Ver `parsearVigencia`. */
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) sedeIds?: string[];
  /**
   * Primer beneficio, para crear la alianza entera de una vez desde el
   * asistente. Sin validación anidada a propósito: el servicio llama a
   * `validarCupon`, que es donde vive la regla de verdad (la misma que usa
   * `crearCupon`), y así no hay dos sitios que puedan discrepar.
   */
  @IsOptional() beneficio?: CuponBody | null;
}

class BloqueoBody {
  @IsBoolean() bloquear!: boolean;
}

class DocumentoBody {
  @IsString() @MaxLength(40) documento!: string;
}

class ListaBody {
  /** Documentos o correos, uno por línea (o separados por comas). */
  @IsString() @MaxLength(200_000) texto!: string;
}

class DisenoBody {
  /**
   * Todos opcionales: el editor manda solo lo que el dueño tocó. Un campo
   * ausente no se toca; uno vacío vuelve al valor por defecto.
   *
   * Los colores se validan como texto y no con un patrón estricto porque el
   * servicio ya descarta lo que no sea un hex de 6 dígitos — fallar aquí
   * impediría guardar el resto del diseño por un color mal pegado.
   */
  @IsOptional() @IsString() @MaxLength(60) name?: string | null;
  @IsOptional() @IsString() @MaxLength(9) primaryColor?: string | null;
  @IsOptional() @IsString() @MaxLength(9) secondaryColor?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string | null;
}

class CanjeBody {
  @IsString() tarjetaId!: string;
  @IsString() cuponId!: string;
  @IsOptional() @IsString() locationId?: string | null;
  @IsOptional() @IsInt() @Min(0) compraMonto?: number | null;
}

/**
 * Panel del negocio. `tenantId` por query solo lo usa un SUPER_ADMIN que entra
 * al negocio desde el panel de admin; para todos los demás sale del token.
 *
 * PERMISOS: por defecto SOLO EL DUEÑO. Antes toda la clase admitía también
 * `TENANT_STAFF`, y eso significaba que un cajero podía borrar convenios y
 * editar cupones — subirse a sí mismo el descuento del 10% al 90% —. Las rutas
 * de caja vuelven a abrirle la puerta una a una, que es lo único que necesita:
 * escanear, canjear y anular.
 */
@Controller('convenios')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class ConveniosController {
  constructor(
    private svc: ConveniosService,
    private canje: ConveniosCanjeService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.get(user, id, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: ConvenioBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body as any, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ConvenioBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.update(user, id, body as any, tenantId);
  }

  @Post(':id/cupones')
  crearCupon(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CuponBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.crearCupon(user, id, body as any, tenantId);
  }

  /** Incluye el interruptor: `PATCH { isActive: false }` apaga el cupón. */
  @Patch('cupones/:cuponId')
  actualizarCupon(
    @CurrentUser() user: AuthUser,
    @Param('cuponId') cuponId: string,
    @Body() body: CuponBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.actualizarCupon(user, cuponId, body as any, tenantId);
  }

  @Delete('cupones/:cuponId')
  borrarCupon(
    @CurrentUser() user: AuthUser,
    @Param('cuponId') cuponId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.borrarCupon(user, cuponId, tenantId);
  }

  // ─────────────────────── Lista de quién puede activar ───────────────────────

  @Get(':id/lista')
  verLista(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.verLista(user, id, tenantId);
  }

  @Post(':id/lista')
  cargarLista(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ListaBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.cargarLista(user, id, body.texto, tenantId);
  }

  @Delete('lista/:filaId')
  quitarDeLista(
    @CurrentUser() user: AuthUser,
    @Param('filaId') filaId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.quitarDeLista(user, filaId, tenantId);
  }

  // ───────────────────────────── Enlaces ─────────────────────────────

  /** Los dos enlaces: el que reparte el aliado y el de su portal. */
  @Get(':id/enlaces')
  enlaces(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.enlaces(user, id, tenantId);
  }

  /** Si el enlace del portal se filtró: cierra esa puerta sin tocar nada más. */
  @Post(':id/enlaces/rotar')
  rotarToken(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.rotarTokenAliado(user, id, tenantId);
  }

  // ─────────────────── Diseño de la tarjeta de la alianza ───────────────────

  /** Cómo se ve hoy el pase, más los valores por defecto para el editor. */
  @Get(':id/diseno')
  diseno(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.diseno(user, id, tenantId);
  }

  /**
   * Guarda el diseño. Solo el DUEÑO: `TENANT_STAFF` es la caja, y cambiarle el
   * aspecto a la tarjeta de una empresa aliada no es una operación de caja.
   */
  @Put(':id/diseno')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  guardarDiseno(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DisenoBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.guardarDiseno(user, id, dto, tenantId);
  }

  // ──────────────────── Tarjetas emitidas a los empleados ────────────────────

  @Get(':id/tarjetas')
  tarjetas(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.tarjetas(user, id, tenantId);
  }

  @Patch('tarjetas/:tarjetaId/bloqueo')
  bloquear(
    @CurrentUser() user: AuthUser,
    @Param('tarjetaId') tarjetaId: string,
    @Body() body: BloqueoBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.bloquearTarjeta(user, tarjetaId, body.bloquear, tenantId);
  }

  /**
   * Corrige la cédula de una tarjeta. Un dedazo al activar dejaba a la persona
   * fuera para siempre: el documento se fija en la primera activación y luego
   * ya nunca coincide con el que escribe.
   */
  @Patch('tarjetas/:tarjetaId/documento')
  corregirDocumento(
    @CurrentUser() user: AuthUser,
    @Param('tarjetaId') tarjetaId: string,
    @Body() body: DocumentoBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.corregirDocumento(user, tarjetaId, body.documento, tenantId);
  }

  /**
   * Libera la tarjeta para que esa persona pueda volver a activar desde cero.
   * Solo si no tiene canjes — con canjes se corrige el documento, porque
   * borrarla se llevaría su historial en cascada.
   */
  @Delete('tarjetas/:tarjetaId')
  liberarTarjeta(
    @CurrentUser() user: AuthUser,
    @Param('tarjetaId') tarjetaId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.liberarTarjeta(user, tarjetaId, tenantId);
  }

  // ─────────────────────────── Caja / escáner ───────────────────────────
  //
  // Las tres rutas que SÍ necesita el cajero, y solo esas. El resto de la clase
  // es del dueño.

  /** Qué mostrarle al cajero tras escanear una tarjeta de convenio. */
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('caja/pase/:passId')
  resolverCaja(
    @CurrentUser() user: AuthUser,
    @Param('passId') passId: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.canje.resolverParaCaja(user, passId, locationId ?? null);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Post('caja/canjear')
  canjear(@CurrentUser() user: AuthUser, @Body() body: CanjeBody) {
    return this.canje.canjear(user, body);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Post('caja/anular/:canjeId')
  anular(@CurrentUser() user: AuthUser, @Param('canjeId') canjeId: string) {
    return this.canje.anular(user, canjeId);
  }
}
