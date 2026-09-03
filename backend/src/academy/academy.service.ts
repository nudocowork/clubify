import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/** Claves canónicas de los módulos que pueden tener video-tutorial. Debe
 *  coincidir con el registro del frontend (lib/academy-modules.ts). Agregar un
 *  módulo nuevo = sumar su clave aquí + colocar el botón una vez en su header. */
export const ACADEMY_MODULE_KEYS = [
  'wallet',
  'clientes',
  'push',
  'reviews',
  'agenda',
  'plano',
  'eventos',
  'reservas-online',
  'reportes',
  'qr',
  'menu',
  'menu-libro',
  'traducciones',
  'pedidos',
  'equipo',
  'configuracion',
  'referidos',
] as const;

const KEY_SET = new Set<string>(ACADEMY_MODULE_KEYS);

@Injectable()
export class AcademyService {
  constructor(private prisma: PrismaService) {}

  /** Resuelve la marca del admin. Un SUPER_ADMIN de marca trae whiteLabelId;
   *  el admin de plataforma (Clubify) no → cae a la marca 'clubify'. Aislado:
   *  toda lectura/escritura va scopeada por este id. */
  private async resolveBrandId(user: AuthUser): Promise<string> {
    if (user.whiteLabelId) return user.whiteLabelId;
    const clubify = await this.prisma.whiteLabel.findFirst({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    if (!clubify) throw new BadRequestException('No se pudo resolver la marca');
    return clubify.id;
  }

  /** Videos de la marca (todos los configurados). El frontend los cruza con el
   *  registro de módulos para mostrar la lista completa. */
  async listForBrand(user: AuthUser) {
    const whiteLabelId = await this.resolveBrandId(user);
    const rows = await this.prisma.academyVideo.findMany({
      where: { whiteLabelId },
      orderBy: { moduleKey: 'asc' },
    });
    return rows.map((r) => ({
      moduleKey: r.moduleKey,
      youtubeUrl: r.youtubeUrl,
      active: r.active,
      title: r.title,
      description: r.description,
    }));
  }

  /** Upsert de un video por módulo, SIEMPRE en la marca del admin (no puede
   *  tocar la de otra marca). */
  async upsert(
    user: AuthUser,
    moduleKey: string,
    dto: { youtubeUrl?: string; active?: boolean; title?: string; description?: string },
  ) {
    const key = String(moduleKey || '').trim();
    if (!KEY_SET.has(key)) throw new BadRequestException(`Módulo desconocido: ${key}`);
    const whiteLabelId = await this.resolveBrandId(user);
    const data = {
      youtubeUrl: (dto.youtubeUrl ?? '').trim().slice(0, 500),
      active: dto.active === undefined ? true : !!dto.active,
      title: (dto.title ?? '').trim().slice(0, 120),
      description: (dto.description ?? '').trim().slice(0, 400),
    };
    const row = await this.prisma.academyVideo.upsert({
      where: { whiteLabelId_moduleKey: { whiteLabelId, moduleKey: key } },
      create: { whiteLabelId, moduleKey: key, ...data },
      update: data,
    });
    return {
      moduleKey: row.moduleKey,
      youtubeUrl: row.youtubeUrl,
      active: row.active,
      title: row.title,
      description: row.description,
    };
  }

  /** Mapa de videos ACTIVOS con URL de una marca, para el panel del negocio:
   *  { moduleKey: { youtubeUrl, title, description } }. Solo lo que se debe
   *  mostrar (el botón se oculta si el módulo no está aquí). */
  static toActiveMap(
    rows: Array<{ moduleKey: string; youtubeUrl: string; active: boolean; title: string; description: string }>,
  ): Record<string, { youtubeUrl: string; title: string; description: string }> {
    const map: Record<string, { youtubeUrl: string; title: string; description: string }> = {};
    for (const r of rows) {
      if (r.active && r.youtubeUrl && r.youtubeUrl.trim()) {
        map[r.moduleKey] = {
          youtubeUrl: r.youtubeUrl.trim(),
          title: r.title || '',
          description: r.description || '',
        };
      }
    }
    return map;
  }
}
