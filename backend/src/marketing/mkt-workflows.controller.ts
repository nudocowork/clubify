import {
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
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MktEngineService } from './mkt-engine.service';

class SaveWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() folderId?: string | null;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsObject() trigger?: Record<string, unknown>;
  @IsOptional() rootId?: string | null;
  @IsOptional() @IsObject() nodes?: Record<string, unknown>;
  @IsOptional() @IsObject() drip?: Record<string, unknown>;
  @IsOptional() @IsObject() sendWindow?: Record<string, unknown>;
  @IsOptional() @IsBoolean() reentry?: boolean;
}
class NameDto {
  @IsString() @MaxLength(60) name!: string;
}
class EnrollDto {
  @IsArray() @IsString({ each: true }) contactIds!: string[];
}

/**
 * CRUD de workflows de email marketing (contact-based). Brand-scoped por
 * whiteLabelId. Espejo del controller de brand-workflows, pero la audiencia son
 * CONTACTOS y el registro de ejecución sale de MktAction (estado + eventos).
 */
@Controller('admin/marketing/workflows')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class MktWorkflowsController {
  constructor(
    private prisma: PrismaService,
    private engine: MktEngineService,
  ) {}

  private async brandId(user: AuthUser): Promise<string> {
    if (user.whiteLabelId) return user.whiteLabelId;
    const clubify = await this.prisma.whiteLabel.findUnique({ where: { slug: 'clubify' }, select: { id: true } });
    if (!clubify) throw new NotFoundException('Marca no resuelta');
    return clubify.id;
  }

  private async own(id: string, whiteLabelId: string) {
    const wf = await this.prisma.mktWorkflow.findFirst({ where: { id, whiteLabelId } });
    if (!wf) throw new NotFoundException('Workflow no encontrado');
    return wf;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const [wfs, folders, grouped] = await Promise.all([
      this.prisma.mktWorkflow.findMany({ where: { whiteLabelId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.mktWorkflowFolder.findMany({
        where: { whiteLabelId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.mktEnrollment.groupBy({ by: ['workflowId', 'status'], where: { whiteLabelId }, _count: true }),
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
  async create(@Body() body: NameDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.prisma.mktWorkflow.create({
      data: {
        whiteLabelId,
        name: body.name?.trim() || 'Nuevo workflow',
        status: 'draft',
        trigger: { type: 'manual' },
        nodes: {},
        drip: {},
        sendWindow: {},
      },
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.own(id, await this.brandId(user));
  }

  @Patch(':id')
  async save(@Param('id') id: string, @Body() body: SaveWorkflowDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    await this.own(id, whiteLabelId);
    const data: Record<string, unknown> = {};
    if (body.name != null) data.name = body.name.trim() || 'Workflow';
    if (body.folderId !== undefined) data.folderId = body.folderId;
    if (body.status != null) data.status = body.status === 'published' ? 'published' : 'draft';
    if (body.trigger != null) data.trigger = body.trigger;
    if (body.rootId !== undefined) data.rootId = body.rootId;
    if (body.nodes != null) data.nodes = body.nodes;
    if (body.drip != null) data.drip = body.drip;
    if (body.sendWindow != null) data.sendWindow = body.sendWindow;
    if (body.reentry != null) data.reentry = body.reentry;
    await this.prisma.mktWorkflow.update({ where: { id }, data });
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    await this.own(id, whiteLabelId);
    await this.prisma.mktEnrollment.deleteMany({ where: { workflowId: id } });
    await this.prisma.mktWorkflow.delete({ where: { id } });
    return { ok: true };
  }

  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const wf = await this.own(id, whiteLabelId);
    return this.prisma.mktWorkflow.create({
      data: {
        whiteLabelId,
        name: `${wf.name} (copia)`.slice(0, 120),
        status: 'draft',
        folderId: wf.folderId ?? null,
        trigger: (wf.trigger as object) ?? { type: 'manual' },
        rootId: wf.rootId ?? null,
        nodes: (wf.nodes as object) ?? {},
        drip: (wf.drip as object) ?? {},
        sendWindow: (wf.sendWindow as object) ?? {},
        reentry: wf.reentry ?? false,
      },
    });
  }

  // ── Carpetas ──
  @Post('folders')
  async createFolder(@Body() body: NameDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const position = await this.prisma.mktWorkflowFolder.count({ where: { whiteLabelId } });
    return this.prisma.mktWorkflowFolder.create({ data: { whiteLabelId, name: body.name.trim() || 'Carpeta', position } });
  }
  @Patch('folders/:folderId')
  async renameFolder(@Param('folderId') folderId: string, @Body() body: NameDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const f = await this.prisma.mktWorkflowFolder.findFirst({ where: { id: folderId, whiteLabelId } });
    if (!f) throw new NotFoundException('Carpeta no encontrada');
    await this.prisma.mktWorkflowFolder.update({ where: { id: folderId }, data: { name: body.name.trim() || 'Carpeta' } });
    return { ok: true };
  }
  @Delete('folders/:folderId')
  async deleteFolder(@Param('folderId') folderId: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const f = await this.prisma.mktWorkflowFolder.findFirst({ where: { id: folderId, whiteLabelId } });
    if (!f) throw new NotFoundException('Carpeta no encontrada');
    await this.prisma.mktWorkflow.updateMany({ where: { whiteLabelId, folderId }, data: { folderId: null } });
    await this.prisma.mktWorkflowFolder.delete({ where: { id: folderId } });
    return { ok: true };
  }

  // ── Inscripción manual: contactos de la marca ──
  @Get('meta/contacts')
  async contacts(@Query('q') q: string | undefined, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    return this.prisma.mktContact.findMany({
      where: {
        whiteLabelId,
        deleted: false,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, name: true, email: true, phone: true },
    });
  }

  @Post(':id/enroll')
  async enroll(@Param('id') id: string, @Body() body: EnrollDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const wf = await this.own(id, whiteLabelId);
    if (wf.status !== 'published') throw new NotFoundException('Publica el workflow antes de inscribir.');
    for (const cid of body.contactIds) await this.engine.enroll(id, cid);
    return { ok: true, count: body.contactIds.length };
  }

  // ── Registro de ejecución (por envío: estado, intentos, eventos del correo) ──
  @Get(':id/logs')
  async logs(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    await this.own(id, whiteLabelId);
    const rows = await this.prisma.mktAction.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const cids = [...new Set(rows.map((r) => r.contactId))];
    const contacts = cids.length
      ? await this.prisma.mktContact.findMany({ where: { id: { in: cids } }, select: { id: true, name: true, email: true, phone: true } })
      : [];
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return rows.map((r) => ({
      ...r,
      contact: byId.get(r.contactId) ?? null,
    }));
  }
}
