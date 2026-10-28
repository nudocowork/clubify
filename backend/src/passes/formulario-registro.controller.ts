import { Body, Controller, ForbiddenException, Get, Put } from '@nestjs/common';
import { IsArray, IsIn, IsOptional } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import { normalizarFormulario, type ModoDeCampo } from './formulario-de-registro';

const MODOS: ModoDeCampo[] = ['obligatorio', 'opcional', 'oculto'];

class GuardarFormularioDto {
  @IsOptional() @IsIn(MODOS) email?: ModoDeCampo;
  @IsOptional() @IsIn(MODOS) cumpleanos?: ModoDeCampo;
  // Cada casilla se limpia en `normalizarFormulario`: lo que no se entiende
  // se descarta en vez de rechazar el guardado entero.
  @IsOptional() @IsArray() extras?: unknown[];
}

/**
 * El formulario con el que los clientes del negocio obtienen su tarjeta
 * (Tarjetas → «Formulario»). Lo lee `/c/<cardId>` y lo exige `enrollPublic`.
 */
@Controller('tenants/me/formulario-registro')
@Roles('TENANT_OWNER', 'TENANT_STAFF')
export class FormularioRegistroController {
  constructor(
    private prisma: PrismaService,
    private brand: WhitelabelBrandService,
  ) {}

  private async negocio(user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const t = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { id: true, whiteLabelId: true, formularioRegistro: true },
    });
    if (!t) throw new ForbiddenException();
    const marca = await this.brand.resolveByWhiteLabelId(t.whiteLabelId);
    return { t, marca: marca.slug };
  }

  @Get()
  async ver(@CurrentUser() user: AuthUser) {
    const { t, marca } = await this.negocio(user);
    return normalizarFormulario(t.formularioRegistro, marca);
  }

  @Put()
  @Roles('TENANT_OWNER')
  async guardar(@CurrentUser() user: AuthUser, @Body() body: GuardarFormularioDto) {
    const { t, marca } = await this.negocio(user);
    const formulario = normalizarFormulario(body, marca);
    await this.prisma.tenant.update({
      where: { id: t.id },
      data: { formularioRegistro: formulario as object },
    });
    return formulario;
  }
}
