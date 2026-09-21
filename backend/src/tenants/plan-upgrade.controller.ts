import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PlanUpgradeService } from './plan-upgrade.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Upgrade a plan ANUAL.
 *
 * Vive en su propio controlador —y no dentro del ya enorme
 * `tenants.controller.ts`— porque es una operación con dinero de por medio y
 * conviene poder leerla entera de una sentada.
 *
 * SOBRE EL ORDEN DE RUTAS: aquí había un aviso que decía que
 * `GET /tenants/upgrades/cancelaciones-pendientes` competía con el `@Get(':id')`
 * de `TenantsController` y que por eso este controlador tenía que ir antes en el
 * array `controllers`. **Es falso y se comprobó empíricamente**: `@Get(':id')`
 * casa UN solo segmento, así que nunca captura `upgrades/cancelaciones-pendientes`
 * (son dos). El orden de registro da igual para estas rutas. Se deja dicho para
 * que nadie vuelva a proteger un problema que no existe — ni aquí ni en
 * `tenants.module.ts`.
 *
 * (Donde sí importa es entre rutas del MISMO controlador con la misma cantidad
 * de segmentos, como `@Get('ranking')` frente a `@Get(':id')`.)
 */

class CrearUpgradeBody {
  /**
   * Referencia de la operación. La pantalla la genera UNA vez al abrir el
   * modal y la manda igual en todos los reintentos: es lo que convierte un
   * doble clic en «ya estaba hecho» en vez de en un segundo cobro.
   */
  @IsString() @MinLength(6) @MaxLength(120) operationRef!: string;

  /**
   * Lo que el negocio pagó de verdad (USD). NO cambia su precio futuro.
   * Con `metodo: 'PASARELA'` es el monto ESPERADO: el que valga al final es el
   * que traiga el aviso de la pasarela.
   */
  @IsNumber() @Min(0.01) paidAmountUsd!: number;

  @IsOptional() @IsString() @MaxLength(8) currency?: string;

  @IsOptional() @IsIn(['MANUAL', 'PASARELA']) metodo?: 'MANUAL' | 'PASARELA';

  /** Cómo entró el dinero cuando el cobro fue por fuera de las pasarelas. */
  @IsOptional()
  @IsIn(['NEQUI', 'EFECTIVO', 'TRANSFERENCIA', 'OTRO'])
  metodoDePago?: 'NEQUI' | 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';

  @IsOptional() @IsString() @MaxLength(120) reference?: string;

  /**
   * «Ya cancelé la suscripción anterior en el panel de la pasarela».
   *
   * OBLIGATORIO cuando el negocio tiene una suscripción viva (Hotmart o
   * Stripe). Sin esto el POST devuelve 400: si el plan anterior sigue cobrando,
   * su próximo cobro le acorta la renovación al negocio —que aparece vencido y
   * el cron de mora lo suspende aunque tenga el año pagado— y le genera al
   * afiliado otra comisión que habrá que devolver.
   */
  @IsOptional() @IsBoolean() suscripcionAnteriorCancelada?: boolean;

  /** Cuándo se cobró (ISO). Default: ahora. Ni futura ni de hace >30 días. */
  @IsOptional() @IsISO8601() effectiveAt?: string;

  @IsOptional() @IsString() @MaxLength(1000) notas?: string;

  // `gatewayTxId` NO se acepta por el cuerpo a propósito: lo escribe el barrido
  // con la transacción del aviso de la pasarela, y la columna es ÚNICA. Dejar
  // que lo mandara una pantalla permitiría bloquear un cobro real con un
  // número tecleado a mano.
}

class ConfirmarCancelacionBody {
  @IsOptional() @IsString() @MaxLength(500) nota?: string;
}

class AnularUpgradeBody {
  /** Por qué se anula. Obligatorio: es lo que queda en la auditoría. */
  @IsString() @MinLength(5) @MaxLength(500) motivo!: string;
}

@Controller('tenants')
export class PlanUpgradeController {
  constructor(private svc: PlanUpgradeService) {}

  /** Todo lo que los upgrades dejaron pendiente (cancelaciones, cobros viejos
   *  y actas esperando el pago por pasarela). */
  @Get('upgrades/cancelaciones-pendientes')
  @Roles('SUPER_ADMIN')
  cancelacionesPendientes(@Query('horas') horas?: string) {
    const n = Number(horas);
    return this.svc.cancelacionesPendientes(
      Number.isFinite(n) && n > 0 ? n : 24,
    );
  }

  /**
   * El resumen para la pantalla ANTES de cobrar: plan actual, periodicidad,
   * precio estándar del anual, fecha efectiva y próxima renovación. No escribe
   * nada.
   */
  @Get(':id/upgrades/preview')
  @Roles('SUPER_ADMIN')
  preview(@Param('id') id: string) {
    return this.svc.previsualizar(id);
  }

  /** Historial de upgrades del negocio. */
  @Get(':id/upgrades')
  @Roles('SUPER_ADMIN')
  historial(@Param('id') id: string) {
    return this.svc.historial(id);
  }

  /**
   * Crea el upgrade. Con `metodo: 'MANUAL'` (el de por defecto) cobra y lo
   * aplica en el acto; con `'PASARELA'` deja el acta en PENDIENTE y devuelve el
   * enlace de pago del plan anual para mandárselo al cliente. Idempotente por
   * `operationRef`.
   */
  @Post(':id/upgrades')
  @Roles('SUPER_ADMIN')
  crear(
    @Param('id') id: string,
    @Body() body: CrearUpgradeBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.crear(id, body, user.id);
  }

  /**
   * «Ya cancelé la suscripción vieja en el panel de la pasarela». Queda quién
   * y cuándo. Solo hace falta para las actas anteriores a que la confirmación
   * fuera obligatoria al crear el upgrade.
   */
  @Post(':id/upgrades/:upgradeId/cancelacion-confirmada')
  @Roles('SUPER_ADMIN')
  confirmarCancelacion(
    @Param('id') id: string,
    @Param('upgradeId') upgradeId: string,
    @Body() body: ConfirmarCancelacionBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.confirmarCancelacionManual(id, upgradeId, user.id, body?.nota);
  }

  /**
   * Anula el acta de un upgrade. Libera el candado que impide crear otro.
   *
   * NO revierte el plan, ni el pago, ni la comisión: la respuesta lo dice y
   * lista lo que queda por arreglar a mano.
   */
  @Post(':id/upgrades/:upgradeId/anular')
  @Roles('SUPER_ADMIN')
  anular(
    @Param('id') id: string,
    @Param('upgradeId') upgradeId: string,
    @Body() body: AnularUpgradeBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.anular(id, upgradeId, user.id, body?.motivo);
  }
}
