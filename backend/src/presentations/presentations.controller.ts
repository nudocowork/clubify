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
import { PresentationsService } from './presentations.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

/**
 * Admin CRUD de Presentations + Slides. Todo bajo SUPER_ADMIN.
 *
 * Estructura de URLs:
 * - /admin/presentations?industryId=xxx           → lista de una industria
 * - /admin/presentations/:id                      → detalle (con slides)
 * - /admin/presentations/:id/slides               → CRUD anidado de slides
 * - /admin/presentations/reorder                  → batch reorder presentations
 * - /admin/presentations/slides/:id               → slide individual
 * - /admin/presentations/slides/reorder           → batch reorder slides
 *
 * Orden de rutas: las literales (/reorder, /slides) van ANTES que las
 * paramétricas (/:id). Ver feedback_nestjs_route_order.md.
 */
@Controller('admin/presentations')
@Roles('SUPER_ADMIN', 'MARKETING')
export class PresentationsAdminController {
  constructor(private svc: PresentationsService) {}

  // ───────────── Presentations ───────────── //

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('industryId') industryId: string,
  ) {
    return this.svc.listByIndustry(user, industryId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.create(user, body);
  }

  @Patch('reorder')
  reorderPresentations(
    @CurrentUser() user: AuthUser,
    @Body() body: { items: Array<{ id: string; sortOrder: number }> },
  ) {
    return this.svc.reorderPresentations(user, body?.items ?? []);
  }

  // ───────────── Slides — anidados ───────────── //
  // Declarados ANTES de los handlers /:id para que el router no capture
  // "slides" como id literal.

  @Patch('slides/reorder')
  reorderSlides(
    @CurrentUser() user: AuthUser,
    @Body() body: { items: Array<{ id: string; sortOrder: number }> },
  ) {
    return this.svc.reorderSlides(user, body?.items ?? []);
  }

  @Get('slides/:id')
  getSlide(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getSlide(user, id);
  }

  @Patch('slides/:id')
  updateSlide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.svc.updateSlide(user, id, body);
  }

  @Delete('slides/:id')
  removeSlide(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeSlide(user, id);
  }

  @Post('slides/:id/duplicate')
  duplicateSlide(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.duplicateSlide(user, id);
  }

  // ───────────── Presentations — paramétricas ───────────── //

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.duplicate(user, id);
  }

  @Get(':id/slides')
  listSlides(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.listSlides(user, id);
  }

  @Post(':id/slides')
  createSlide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.svc.createSlide(user, id, body);
  }
}

/**
 * Controller PÚBLICO — sin auth. Sirve el slide deck en la vista pública
 * (/industria/{industrySlug}/{presentationSlug}). Solo expone presentaciones
 * activas dentro de industrias activas, con sus slides ordenados.
 */
@Controller('public/presentations')
@Public()
export class PresentationsPublicController {
  constructor(private svc: PresentationsService) {}

  @Get(':industrySlug/:presentationSlug')
  getBySlug(
    @Param('industrySlug') industrySlug: string,
    @Param('presentationSlug') presentationSlug: string,
  ) {
    return this.svc.getBySlugPublic(industrySlug, presentationSlug);
  }
}
