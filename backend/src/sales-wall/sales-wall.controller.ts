import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';
import { SalesWallService, type MuroDelMes } from './sales-wall.service';

@Controller()
export class SalesWallController {
  constructor(
    private readonly svc: SalesWallService,
    private readonly prisma: PrismaService,
  ) {}

  /** Vista completa (montos, meta y servicios): solo SUPER_ADMIN de la plataforma. */
  @Get('admin/sales-wall')
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  delMes() {
    return this.svc.delMes();
  }

  /**
   * La misma pantalla para los equipos (Javier, 2026-10-26: «que la vean
   * todos los equipos… solo las ventas, ranking y celebraciones»).
   * El SUPER_ADMIN la recibe completa; marketing y afiliados, SIN ningún
   * monto: se quitan aquí, en el servidor, para que el dinero no viaje al
   * navegador de un vendedor aunque la pantalla no lo pinte. Solo personas de
   * Clubify: un afiliado de otra marca no ve las ventas de Clubify.
   */
  @Get('sales-wall')
  @Roles('SUPER_ADMIN', 'MARKETING', 'AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_VENDOR', 'AFFILIATE_SOCIO')
  async paraEquipos(@CurrentUser() user: AuthUser): Promise<MuroDelMes & { restringido: boolean }> {
    const scope = await resolveBrandScope(this.prisma, user?.whiteLabelId ?? null);
    if (!scope.isClubify) throw new ForbiddenException('Solo para el equipo de Clubify.');
    const muro = await this.svc.delMes();
    if (user?.role === 'SUPER_ADMIN') return { ...muro, restringido: false };
    return {
      ...muro,
      monto_usd: 0,
      eventos: muro.eventos.map((e) => ({ ...e, monto_usd: 0 })),
      servicios: { cantidad: 0, monto_usd: 0, items: [] },
      restringido: true,
    };
  }
}
