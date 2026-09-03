import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { AlianzasPublicoService } from './alianzas-publico.service';
import { AlianzasPortalService } from './alianzas-portal.service';

class ActivacionBody {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsString() @MinLength(8) @MaxLength(40) phone!: string;
  @IsString() @MinLength(4) @MaxLength(40) documento!: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string | null;
  @IsOptional() @IsString() @MaxLength(40) codigo?: string | null;
  @IsOptional() @IsString() @MaxLength(40) via?: string | null;
  @IsOptional() @IsBoolean() dataPolicyAccepted?: boolean;
}

class InterruptorBody {
  @IsBoolean() activo!: boolean;
}

class BajaBody {
  @IsString() @MinLength(4) @MaxLength(40) documento!: string;
}

/**
 * Todo lo que se toca SIN cuenta: la página del enlace que reparte la empresa
 * aliada entre sus empleados, y el portal del propio aliado.
 *
 * Va en un controlador aparte del panel (`ConveniosController`) a propósito:
 * aquí no hay `AuthUser` del que sacar el `tenantId`, así que cada ruta tiene
 * que resolverlo de su slug o de su token y volver a comprobar TODO. Mezclarlo
 * con las rutas autenticadas es como se cuelan los endpoints públicos sin
 * guarda.
 */
@Controller('public/alianzas')
export class AlianzasPublicoController {
  constructor(private publico: AlianzasPublicoService) {}

  // ─────────────────── El enlace único que reparte el aliado ───────────────────

  @Public()
  @Get(':tenantSlug/:convenioSlug')
  info(
    @Param('tenantSlug') tenantSlug: string,
    @Param('convenioSlug') convenioSlug: string,
  ) {
    return this.publico.info(tenantSlug, convenioSlug);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post(':tenantSlug/:convenioSlug/activar')
  activar(
    @Param('tenantSlug') tenantSlug: string,
    @Param('convenioSlug') convenioSlug: string,
    @Body() body: ActivacionBody,
    @Query('via') via?: string,
  ) {
    return this.publico.activar(tenantSlug, convenioSlug, {
      ...body,
      via: body.via ?? via ?? null,
    });
  }

}

/**
 * El portal de la empresa aliada, en su PROPIO prefijo.
 *
 * No cuelga de `public/alianzas` a propósito. Ahí vive
 * `@Get(':tenantSlug/:convenioSlug')`, que es un comodín de dos segmentos y se
 * traga cualquier ruta de dos segmentos declarada después: con el portal en
 * `public/alianzas/portal/:token`, Nest resolvía `portal` como el slug del
 * negocio y el token como el del convenio, y el portal respondía 404 SIEMPRE.
 *
 * Reordenar los métodos también lo arreglaba, pero dejaba la trampa puesta: un
 * negocio que se llamara «Portal» volvería a romperlo, y eso aparecería un año
 * después sin que nadie supiera de dónde salió. Con prefijo propio no hay
 * colisión posible.
 *
 * La ruta casa además con la del frontend (`/aliado/<token>`).
 */
@Controller('public/aliado')
export class AlianzasPortalController {
  constructor(private portal: AlianzasPortalService) {}

  @Public()
  @Get(':token')
  ver(@Param('token') token: string) {
    return this.portal.ver(token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Patch(':token/cupones/:cuponId')
  interruptor(
    @Param('token') token: string,
    @Param('cuponId') cuponId: string,
    @Body() body: InterruptorBody,
  ) {
    return this.portal.interruptor(token, cuponId, body.activo);
  }

  /** Baja a ciegas: el aliado escribe un documento y no ve nada más. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':token/baja')
  baja(@Param('token') token: string, @Body() body: BajaBody) {
    return this.portal.baja(token, body.documento);
  }
}
