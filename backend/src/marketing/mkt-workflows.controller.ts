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
import { TenantContext } from '../common/tenant/tenant-context';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MktEngineService } from './mkt-engine.service';
import { MktProviderService } from './provider/mkt-provider.service';
import { catalogoDeContactos, htmlToText, MKT_OPERADORES, resolveMerge, type ListasDeLaMarca } from './mkt-workflow.util';
import {
  claveCorreoDePrueba,
  claveTelefonoDePrueba,
  conPrefijoDePrueba,
  correoDelPaso,
  ctxDePrueba,
  ejecutarPruebaDeFlujo,
  FEATURE_PRUEBA,
  VENTANA_PRUEBAS_MIN,
  type CanalDePrueba,
} from './prueba-y-plantilla.util';
import { disparadoresParaGuardar } from '../superadmin/brand-workflows/wf-filtros.util';

/** `trigger` + `triggers` listos para la base, o un 400 que dice qué falla. */
function disparadoresDelCuerpo(body: { trigger?: unknown; triggers?: unknown }) {
  const r = disparadoresParaGuardar(
    body,
    MKT_OPERADORES.map((o) => o.value),
  );
  if (!r.ok) throw new BadRequestException(r.error);
  return r.data;
}

class SaveWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() folderId?: string | null;
  @IsOptional() @IsString() status?: string;
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
class EnrollDto {
  @IsArray() @IsString({ each: true }) contactIds!: string[];
}
/** Lo que hay escrito EN ESE MOMENTO en el paso, sin guardar el flujo. */
class PruebaDto {
  @IsString() canal!: string; // sms | email
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() @MaxLength(200_000) body?: string;
  @IsOptional() @IsString() templateId?: string;
  /** Solo si la marca todavía no tiene destino de prueba guardado. */
  @IsOptional() @IsString() @MaxLength(200) destino?: string;
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
    /** La única puerta de salida del motor: la prueba sale por la misma. */
    private provider: MktProviderService,
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

  /**
   * El catálogo que dibuja la pantalla: disparadores, pasos y sus campos.
   *
   * Va ANTES de `@Get(':id')` a propósito: Nest resuelve por orden de
   * declaración y más abajo «catalogo» se leería como el id de un workflow.
   *
   * Existe porque el catálogo estaba copiado a mano en el front y se
   * desincronizó: la pantalla ofrecía el disparador `tag_added` que el motor no
   * lanzaba nunca. Ahora hay una sola copia, la del backend.
   */
  @Get('catalogo')
  async catalogo(@CurrentUser() user: AuthUser) {
    return catalogoDeContactos(await this.listasDeLaMarca(await this.brandId(user)));
  }

  // ── Envío de prueba de un paso de mensaje ──────────────────────────────────
  // Va ANTES de `@Get(':id')`, igual que el catálogo: si no, «prueba» se leería
  // como el id de un workflow.

  /** El teléfono y el correo de prueba que tiene guardados la marca. */
  @Get('prueba/destinos')
  async destinosDePrueba(@CurrentUser() user: AuthUser) {
    return this.leerDestinos(await this.brandId(user));
  }

  private async leerDestinos(whiteLabelId: string) {
    const claves = [claveTelefonoDePrueba(whiteLabelId), claveCorreoDePrueba(whiteLabelId)];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: claves } } });
    const valor = (clave: string) => rows.find((r) => r.key === clave)?.value?.trim() || null;
    return { telefono: valor(claves[0]), correo: valor(claves[1]) };
  }

  /**
   * Manda EXACTAMENTE lo que hay escrito en el paso, sin guardar el flujo, al
   * destino de prueba de la marca.
   *
   * Aislamiento: la marca es SIEMPRE la del que pide la prueba —sale de su
   * sesión, no del cuerpo— y el envío va por la subcuenta de esa marca. El
   * destino solo puede ser el que la marca tiene guardado como suyo (o el que
   * se guarde en esta misma llamada), para que el botón no sirva de remitente
   * prestado contra el teléfono de un tercero.
   */
  @Post('prueba')
  async prueba(@Body() body: PruebaDto, @CurrentUser() user: AuthUser) {
    const whiteLabelId = await this.brandId(user);
    const canal: CanalDePrueba = body.canal === 'email' ? 'email' : 'sms';
    const [wl, negocio] = await Promise.all([
      this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId }, select: { name: true } }),
      // Un negocio de verdad de la marca para {{negocio}}/{{empresa}}: la
      // prueba tiene que parecerse a lo que recibe un cliente.
      this.prisma.tenant.findFirst({
        where: { whiteLabelId, deletedAt: null },
        select: { name: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const ctx = ctxDePrueba({ marca: wl?.name, negocio: negocio?.name });
    const merge = (t: string) => resolveMerge(t, ctx);

    // Qué se manda. El correo pasa por la MISMA función que usa el motor, así
    // que la prueba enseña la plantilla que se va a enviar de verdad — y falla
    // por lo mismo si la plantilla no sirve.
    let enviar: (destino: string) => Promise<{ ok: boolean; motivo?: string }>;
    if (canal === 'email') {
      const templateId = (body.templateId ?? '').trim();
      const plantilla = templateId
        ? await this.prisma.mktEmailTemplate.findUnique({
            where: { id: templateId },
            select: { id: true, whiteLabelId: true, isPreset: true, subject: true, html: true },
          })
        : null;
      const correo = correoDelPaso({ templateId, plantilla, whiteLabelId, subject: body.subject, body: body.body, merge });
      if (!correo.ok) throw new BadRequestException(correo.motivo);
      if (!correo.html.trim()) throw new BadRequestException('Escribe el correo antes de probarlo.');
      const subject = conPrefijoDePrueba(correo.subject || '(sin asunto)');
      enviar = async (destino) => {
        const r = await this.provider.sendEmail({
          whiteLabelId,
          toEmail: destino,
          subject,
          html: correo.html,
          text: htmlToText(correo.html),
          ctx: { whiteLabelId, feature: FEATURE_PRUEBA },
        });
        return { ok: r.ok, motivo: r.error };
      };
    } else {
      const texto = merge(String(body.message ?? '')).trim();
      if (!texto) throw new BadRequestException('Escribe el mensaje antes de probarlo.');
      const message = conPrefijoDePrueba(texto);
      enviar = async (destino) => {
        const r = await this.provider.sendSms({
          whiteLabelId,
          toPhone: destino,
          message,
          ctx: { whiteLabelId, feature: FEATURE_PRUEBA },
        });
        return { ok: r.ok, motivo: r.error };
      };
    }

    const clave = canal === 'sms' ? claveTelefonoDePrueba(whiteLabelId) : claveCorreoDePrueba(whiteLabelId);
    // SIN el filtro por negocio, a propósito.
    //
    // `MessageLog` lleva `tenantId`, así que el middleware global lo filtra por
    // los negocios de la marca en cada consulta. En una sesión de marca blanca
    // eso dejaba el tope en nada —el contador siempre daba 0— y encima impedía
    // escribir la fila de la prueba (nace sin negocio), así que la prueba no
    // aparecía en el historial. Justo para el usuario del que protege el tope.
    const res = await TenantContext.runWithoutTenant(() =>
      ejecutarPruebaDeFlujo({
      canal,
      destino: body.destino,
      leerDestinoGuardado: async () =>
        (await this.prisma.setting.findUnique({ where: { key: clave } }).catch(() => null))?.value ?? null,
      guardarDestino: async (valor) => {
        await this.prisma.setting.upsert({ where: { key: clave }, update: { value: valor }, create: { key: clave, value: valor } });
      },
      contarPruebas: () =>
        this.prisma.messageLog.count({
          where: {
            whiteLabelId,
            feature: FEATURE_PRUEBA,
            createdAt: { gte: new Date(Date.now() - VENTANA_PRUEBAS_MIN * 60_000) },
          },
        }),
        enviar,
      }),
    );
    if (!res.ok && res.deEntrada) throw new BadRequestException(res.motivo);
    return res;
  }

  /**
   * Los embudos, las etapas y los miembros de los equipos de ventas DE ESTA
   * MARCA, para los desplegables de los pasos y disparadores de ventas.
   *
   * Los embudos y las etapas van por NOMBRE (ver `ListasDeLaMarca`): una marca
   * puede tener varios equipos con su propia copia de «Closers», y el paso
   * tiene que caer en el embudo del equipo DEL LEAD. Se agrupan por nombre y se
   * dice entre paréntesis en cuántos equipos existe, para que quien configura
   * entienda que no está eligiendo el tablero de uno concreto.
   *
   * Se parte de los EQUIPOS de la marca y no del `whiteLabelId` del embudo:
   * esa columna es una desnormalización y los embudos de antes pueden tenerla
   * vacía — filtrando por ella desaparecerían de la lista.
   */
  private async listasDeLaMarca(whiteLabelId: string): Promise<ListasDeLaMarca> {
    const [equipos, plantillas] = await Promise.all([
      this.prisma.salesTeam.findMany({ where: { whiteLabelId }, select: { id: true } }),
      // Las de la marca + las de fábrica, que son las mismas que ofrece la
      // galería de Email Marketing. Se leen aquí y no en la pantalla porque una
      // segunda copia del catálogo en el front es cómo se desincronizó la vez
      // anterior.
      this.prisma.mktEmailTemplate.findMany({
        where: { OR: [{ whiteLabelId }, { isPreset: true }] },
        orderBy: [{ isPreset: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, isPreset: true },
      }),
    ]);
    const listaDePlantillas = plantillas.map((p) => ({
      value: p.id,
      label: p.isPreset ? `${p.name} (de fábrica)` : p.name,
    }));
    if (!equipos.length) return { embudos: [], etapas: [], miembros: [], plantillas: listaDePlantillas };
    const salesTeamId = { in: equipos.map((t) => t.id) };
    const [embudos, etapas, miembros] = await Promise.all([
      this.prisma.salesPipeline.findMany({
        where: { salesTeamId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { name: true },
      }),
      this.prisma.salesPipelineStage.findMany({
        where: { salesTeamId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { name: true },
      }),
      this.prisma.salesTeamMember.findMany({
        where: { teamId: salesTeamId, isActive: true },
        select: { userId: true, user: { select: { fullName: true, email: true } } },
      }),
    ]);
    const porNombre = (filas: { name: string }[]) => {
      const cuenta = new Map<string, number>();
      for (const f of filas) cuenta.set(f.name, (cuenta.get(f.name) ?? 0) + 1);
      return [...cuenta.entries()].map(([name, n]) => ({
        value: name,
        label: n > 1 ? `${name} (en ${n} equipos)` : name,
      }));
    };
    const personas = new Map<string, string>();
    for (const m of miembros) {
      personas.set(m.userId, m.user?.fullName?.trim() || m.user?.email || 'Sin nombre');
    }
    return {
      embudos: porNombre(embudos),
      etapas: porNombre(etapas),
      miembros: [...personas.entries()].map(([value, label]) => ({ value, label })),
      plantillas: listaDePlantillas,
    };
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
    const disparadores = disparadoresDelCuerpo(body);
    if (disparadores) Object.assign(data, disparadores);
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
