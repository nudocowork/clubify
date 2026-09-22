import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BrandWorkflowEngineService } from './brand-workflow-engine.service';
import { BrandWorkflowFoldersService } from './brand-workflow-folders.service';
import { catalogoDeMarca, WF_OPERADORES } from './brand-workflow.util';
import { disparadoresParaGuardar } from './wf-filtros.util';

/** `trigger` + `triggers` listos para la base, o un 400 que dice qué falla. */
function disparadoresDelCuerpo(body: { trigger?: unknown; triggers?: unknown }) {
  // Sin los de etiqueta: un negocio no tiene etiquetas y el filtro no casaría nunca.
  const r = disparadoresParaGuardar(
    body,
    WF_OPERADORES.map((o) => o.value),
  );
  if (!r.ok) throw new BadRequestException(r.error);
  return r.data;
}

class SaveWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() folderId?: string | null;
  @IsOptional() @IsString() status?: string; // draft | published
  /** El de antes: una pantalla vieja todavía abierta solo sabe mandar este. */
  @IsOptional() @IsObject() trigger?: Record<string, unknown>;
  /** Varios disparadores (entra si casa cualquiera). Si viene, manda sobre `trigger`. */
  @IsOptional() @IsArray() triggers?: unknown[];
  @IsOptional() rootId?: string | null;
  @IsOptional() @IsObject() nodes?: Record<string, unknown>;
  @IsOptional() @IsObject() drip?: Record<string, unknown>;
  @IsOptional() @IsObject() sendWindow?: Record<string, unknown>;
  @IsOptional() @IsBoolean() reentry?: boolean;
}
class NameDto {
  @IsString() @MaxLength(60) name!: string;
}
class CreateWorkflowDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  // Carpeta donde nace (la que el usuario está viendo). Se valida como propia.
  @IsOptional() folderId?: string | null;
}
class CreateFolderDto {
  @IsString() @MaxLength(60) name!: string;
  // Carpeta contenedora — permite crear una carpeta DENTRO de otra.
  @IsOptional() parentId?: string | null;
}
class MoveFolderDto {
  // null (o ausente) = mover a la raíz.
  @IsOptional() parentId?: string | null;
}
class BulkMoveDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
  // null (o ausente) = quitar de toda carpeta (raíz).
  @IsOptional() folderId?: string | null;
}
class BulkDeleteDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
}
class EnrollDto {
  @IsArray() @IsString({ each: true }) tenantIds!: string[];
}

@Controller('admin/workflows')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class BrandWorkflowsController {
  constructor(
    private prisma: PrismaService,
    private engine: BrandWorkflowEngineService,
    private folders: BrandWorkflowFoldersService,
  ) {}

  private async brandId(user: AuthUser): Promise<string> {
    if (user.whiteLabelId) return user.whiteLabelId;
    const clubify = await this.prisma.whiteLabel.findUnique({ where: { slug: 'clubify' }, select: { id: true } });
    if (!clubify) throw new NotFoundException('Marca no resuelta');
    return clubify.id;
  }

  private async ownWorkflow(id: string, whiteLabelId: string) {
    const wf = await this.prisma.brandWorkflow.findFirst({ where: { id, whiteLabelId } });
    if (!wf) throw new NotFoundException('Workflow no encontrado');
    return wf;
  }

  /**
   * El catálogo que dibuja la pantalla: disparadores, pasos y sus campos.
   *
   * Antes estaba copiado a mano en el front y se desincronizó (allí faltaban
   * disparadores; aquí faltaba `send_email`). Ahora hay una sola copia, esta.
   */
  @Get('catalogo')
  async catalogo(@CurrentUser() user: AuthUser) {
    // La pasarela decide qué disparadores de cobro tienen sentido para esta
    // marca: los suyos son los que sabemos leer.
    const whiteLabelId = await this.brandId(user);
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { paymentGateway: true },
    });
    return catalogoDeMarca(wl?.paymentGateway ?? null);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const [wfs, folders, grouped] = await Promise.all([
      this.prisma.brandWorkflow.findMany({ where: { whiteLabelId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.brandWorkflowFolder.findMany({ where: { whiteLabelId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.brandWorkflowEnrollment.groupBy({ by: ['workflowId', 'status'], _count: true }),
    ]);
    const stats: Record<string, { active: number; completed: number }> = {};
    for (const g of grouped) {
      const s = (stats[g.workflowId] ??= { active: 0, completed: 0 });
      if (g.status === 'active' || g.status === 'waiting') s.active += g._count;
      else if (g.status === 'completed') s.completed += g._count;
    }
    return {
      folders,
      workflows: wfs.map((w) => ({ ...w, _stats: stats[w.id] ?? { active: 0, completed: 0 } })),
    };
  }

  @Post()
  async create(@Body() body: CreateWorkflowDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    // Nace en la carpeta que el usuario está viendo. Se valida como carpeta
    // PROPIA: un folderId de otra marca haría aparecer el workflow en el árbol
    // de esa marca.
    const folderId = (body.folderId ?? '').trim() || null;
    if (folderId) {
      const f = await this.prisma.brandWorkflowFolder.findFirst({ where: { id: folderId, whiteLabelId } });
      if (!f) throw new NotFoundException('Carpeta no encontrada');
    }
    return this.prisma.brandWorkflow.create({
      data: { whiteLabelId, name: body.name?.trim() || 'Nuevo workflow', folderId, status: 'draft', trigger: { type: 'manual' }, nodes: {}, drip: {}, sendWindow: {} },
    });
  }

  // ── Acciones en lote (varias filas seleccionadas → una sola llamada) ──
  @Post('bulk/move')
  async bulkMove(@Body() body: BulkMoveDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.folders.bulkMoveWorkflows(whiteLabelId, body.ids, body.folderId ?? null);
  }

  @Post('bulk/delete')
  async bulkDelete(@Body() body: BulkDeleteDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.folders.bulkDeleteWorkflows(whiteLabelId, body.ids);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ownWorkflow(id, await this.brandId(user));
  }

  @Patch(':id')
  async save(@Param('id') id: string, @Body() body: SaveWorkflowDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    await this.ownWorkflow(id, whiteLabelId);
    const data: Record<string, unknown> = {};
    if (body.name != null) data.name = body.name.trim() || 'Workflow';
    if (body.folderId !== undefined) data.folderId = body.folderId;
    if (body.status != null) data.status = body.status === 'published' ? 'published' : 'draft';
    const disparadores = disparadoresDelCuerpo(body);
    if (disparadores) Object.assign(data, disparadores);
    if (body.rootId !== undefined) data.rootId = body.rootId;
    if (body.nodes != null) data.nodes = body.nodes;
    if (body.drip != null) data.drip = body.drip;
    if (body.sendWindow != null) data.sendWindow = body.sendWindow;
    if (body.reentry != null) data.reentry = body.reentry;
    await this.prisma.brandWorkflow.update({ where: { id }, data });
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    await this.ownWorkflow(id, whiteLabelId);
    await this.prisma.brandWorkflowEnrollment.deleteMany({ where: { workflowId: id } });
    await this.prisma.brandWorkflow.delete({ where: { id } });
    return { ok: true };
  }

  // Duplica un workflow (misma marca) como BORRADOR: copia disparador, nodos y
  // configuración; NO copia inscripciones ni historial. Aislado por whiteLabelId.
  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const wf = await this.ownWorkflow(id, whiteLabelId);
    return this.prisma.brandWorkflow.create({
      data: {
        whiteLabelId,
        name: `${wf.name} (copia)`.slice(0, 120),
        status: 'draft',
        folderId: wf.folderId ?? null,
        trigger: (wf.trigger as object) ?? { type: 'manual' },
        // Sin esto la copia se quedaba solo con el primer disparador.
        triggers: (wf.triggers as Prisma.InputJsonValue) ?? [],
        rootId: wf.rootId ?? null,
        nodes: (wf.nodes as object) ?? {},
        drip: (wf.drip as object) ?? {},
        sendWindow: (wf.sendWindow as object) ?? {},
        reentry: wf.reentry ?? false,
      },
    });
  }

  // ── Carpetas (árbol anidado — la lógica vive en BrandWorkflowFoldersService) ──
  @Post('folders')
  async createFolder(@Body() body: CreateFolderDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.folders.create(whiteLabelId, body.name, body.parentId ?? null);
  }
  @Patch('folders/:folderId')
  async renameFolder(@Param('folderId') folderId: string, @Body() body: NameDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.folders.rename(whiteLabelId, folderId, body.name);
  }
  // Mover una carpeta dentro de otra (o a la raíz). El servicio rechaza los
  // ciclos con un 400 claro.
  @Patch('folders/:folderId/move')
  async moveFolder(@Param('folderId') folderId: string, @Body() body: MoveFolderDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.folders.move(whiteLabelId, folderId, body.parentId ?? null);
  }
  // Borrar carpeta: su contenido (workflows y subcarpetas) sube al padre de la
  // carpeta borrada — nunca se borra ni se pierde un workflow por esta vía.
  @Delete('folders/:folderId')
  async deleteFolder(@Param('folderId') folderId: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.folders.remove(whiteLabelId, folderId);
  }

  // ── Inscripción manual: negocios de la marca ──
  @Get('meta/tenants')
  async tenants(@Query('q') q: string | undefined, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const rows = await this.prisma.tenant.findMany({
      where: { whiteLabelId, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      take: 40,
      select: { id: true, name: true, phone: true, whatsappPhone: true },
    });
    return rows;
  }

  @Post(':id/enroll')
  async enroll(@Param('id') id: string, @Body() body: EnrollDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const wf = await this.ownWorkflow(id, whiteLabelId);
    if (wf.status !== 'published') throw new NotFoundException('Publica el workflow antes de inscribir.');
    // Solo negocios de ESTA marca. Antes se inscribía el id que llegara: con un
    // id ajeno, una marca metía un negocio de otra en su flujo, y el mensaje
    // salía por la subcuenta de la marca del negocio.
    const clubify = await this.prisma.whiteLabel.findUnique({ where: { slug: 'clubify' }, select: { id: true } });
    const propios = await this.prisma.tenant.findMany({
      where: {
        id: { in: body.tenantIds },
        // Los negocios legacy sin marca son de Clubify de hecho.
        ...(whiteLabelId === clubify?.id ? { OR: [{ whiteLabelId }, { whiteLabelId: null }] } : { whiteLabelId }),
      },
      select: { id: true },
    });
    for (const t of propios) await this.engine.enroll(id, t.id);
    return { ok: true, count: propios.length };
  }

  @Get(':id/logs')
  async logs(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    await this.ownWorkflow(id, whiteLabelId);
    const rows = await this.prisma.brandWorkflowLog.findMany({ where: { workflowId: id }, orderBy: { createdAt: 'desc' }, take: 150 });
    const tIds = [...new Set(rows.map((r) => r.tenantId).filter(Boolean) as string[])];
    const tenants = tIds.length ? await this.prisma.tenant.findMany({ where: { id: { in: tIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((r) => ({ ...r, tenantName: r.tenantId ? nameOf.get(r.tenantId) ?? '—' : '—' }));
  }
}
