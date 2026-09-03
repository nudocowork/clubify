import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { QueueService } from '../jobs/queue.service';
import {
  cambiaLoQueSeVe,
  describirBeneficioCorto,
  estaAgotado,
  motivoDelConvenio,
  normalizarDocumento,
  normalizarEmail,
  quienApago,
} from './alianzas-estado';
import { avisarPasesDeAlianza, avisarUnPase } from './alianzas-pase.util';

/**
 * El portal de la EMPRESA ALIADA. Sin cuenta ni contraseña: se entra con un
 * enlace que le pasa el negocio.
 *
 * Javier quiso que las dos partes pudieran encender y apagar. La forma de que
 * eso no acabe en una pelea de interruptores es que cada parte tenga el suyo:
 * el negocio manda sobre `ConvenioCupon.isActive` y el aliado sobre
 * `activoAliado`, y el canje exige los dos. Así el aliado no puede encender lo
 * que apagó el negocio ni al revés, por construcción y no por una validación
 * que alguien pueda saltarse.
 *
 * Lo que el aliado NO puede hacer, y es deliberado: crear o editar cupones,
 * tocar valores ni topes, y ver un solo dato personal de sus empleados. Si
 * pudiera editar el valor, un enlace filtrado convertiría un 10% en un 90%.
 */
@Injectable()
export class AlianzasPortalService {
  private logger = new Logger(AlianzasPortalService.name);

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  private async porToken(token: string) {
    const t = (token ?? '').trim();
    if (!t) throw new NotFoundException('Enlace no válido.');
    const convenio = await this.prisma.convenio.findFirst({
      where: { aliadoToken: t },
      include: {
        cupones: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        tenant: {
          select: {
            id: true,
            brandName: true,
            logoUrl: true,
            primaryColor: true,
            status: true,
            conveniosEnabled: true,
          },
        },
      },
    });
    if (!convenio) throw new NotFoundException('Enlace no válido.');
    // Apagar el módulo tiene que apagarlo TODO, portal incluido. Los datos no
    // se tocan: reencenderlo lo devuelve tal cual estaba.
    if (
      convenio.tenant.status === 'SUSPENDED' ||
      !convenio.tenant.conveniosEnabled
    ) {
      throw new NotFoundException('Enlace no válido.');
    }
    return convenio;
  }

  /** Lo que ve el aliado al entrar: sus interruptores y su informe. */
  async ver(token: string) {
    const convenio = await this.porToken(token);
    const ahora = new Date();
    const motivoGlobal = motivoDelConvenio(convenio, ahora);
    const soloLectura = convenio.status === 'FINISHED';

    const [tarjetasActivas, tarjetasBloqueadas, agregados] = await Promise.all([
      this.prisma.convenioTarjeta.count({
        where: { convenioId: convenio.id, status: 'ACTIVE' },
      }),
      this.prisma.convenioTarjeta.count({
        where: { convenioId: convenio.id, status: 'BLOCKED' },
      }),
      this.prisma.convenioCanje.aggregate({
        where: { convenioId: convenio.id, revertedAt: null },
        _count: true,
        _sum: { descuentoMonto: true },
      }),
    ]);

    return {
      negocio: {
        nombre: convenio.tenant.brandName,
        logoUrl: convenio.tenant.logoUrl,
        color: convenio.tenant.primaryColor,
      },
      convenio: {
        nombre: convenio.name,
        logoUrl: convenio.logoUrl,
        status: convenio.status,
        endsAt: convenio.endsAt,
        /** El aliado ve el código porque es quien lo reparte. No puede rotarlo. */
        codigo: convenio.verificacion === 'CODIGO' ? convenio.codigo : null,
        verificacion: convenio.verificacion,
      },
      soloLectura,
      motivoGlobal,
      cupones: convenio.cupones.map((c) => {
        const apagado = quienApago(c);
        return {
          id: c.id,
          nombre: c.name,
          // En corto: el aliado no es el cajero. «Entregar gratis: Bebida» es
          // una instrucción de caja, no lo que él le da a su gente.
          resumen: describirBeneficioCorto(c.tipo, c.valor, c.name),
          descripcion: c.description,
          /** SU interruptor. El de la otra parte solo se informa. */
          miInterruptor: c.activoAliado,
          apagadoPorElNegocio: !c.isActive,
          agotado: estaAgotado(c),
          vencido: !!(c.endsAt && c.endsAt <= ahora),
          /** Lo que de verdad pasa hoy, ya combinado. */
          estado: this.textoEstado(c, apagado, ahora, motivoGlobal),
          canjes: c.canjesCount,
        };
      }),
      informe: {
        tarjetasActivas,
        tarjetasBloqueadas,
        canjesTotales: agregados._count,
        // Solo se sabe cuando el negocio pide el total del tiquete en caja. Sin
        // eso el informe cuenta canjes, no pesos.
        descuentoTotal: agregados._sum.descuentoMonto ?? null,
      },
    };
  }

  private textoEstado(
    c: { isActive: boolean; activoAliado: boolean; endsAt: Date | null; maxTotal: number | null; canjesCount: number },
    apagado: ReturnType<typeof quienApago>,
    ahora: Date,
    motivoGlobal: string | null,
  ): string {
    if (motivoGlobal) return motivoGlobal;
    if (apagado === 'ambos') return 'Apagado por ti y por el negocio';
    if (apagado === 'aliado') return 'Apagado por ti';
    if (apagado === 'negocio') return 'Apagado por el negocio';
    if (c.endsAt && c.endsAt <= ahora) return 'Venció';
    if (estaAgotado(c)) return 'Agotado';
    return 'Activo';
  }

  /**
   * El interruptor del aliado.
   *
   * Nunca se deshabilita en la interfaz aunque el negocio tenga el suyo
   * apagado: cada parte puede dejar el suyo como quiera. Lo que se muestra
   * aparte es el estado efectivo. Así encender y apagar jamás se pisan.
   */
  async interruptor(token: string, cuponId: string, activo: boolean) {
    const convenio = await this.porToken(token);
    if (convenio.status === 'FINISHED') {
      throw new BadRequestException(
        'Este convenio finalizó. Ya no se puede cambiar.',
      );
    }
    const cupon = convenio.cupones.find((c) => c.id === cuponId);
    if (!cupon) throw new NotFoundException('Beneficio no encontrado.');
    if (cupon.activoAliado === activo) {
      return { ok: true, cambio: false };
    }

    const actualizado = await this.prisma.convenioCupon.update({
      where: { id: cuponId },
      data: { activoAliado: activo },
    });

    // Empujar el pase SOLO si cambió lo que el empleado ve. Encender mi llave
    // con la del negocio apagada no cambia nada en su tarjeta: empujar por eso
    // gasta cuota de Apple y Google y hace vibrar teléfonos para nada.
    const ahora = new Date();
    if (cambiaLoQueSeVe(cupon, actualizado, ahora)) {
      await this.avisarPases(convenio.id);
    }
    this.logger.log(
      `Alianza ${convenio.slug} · el aliado ${activo ? 'encendió' : 'apagó'} el cupón ${cuponId}`,
    );
    return { ok: true, cambio: true };
  }

  /**
   * Baja a ciegas por documento: alguien dejó la empresa.
   *
   * El aliado es quien sabe que esa persona ya no trabaja allí, pero no debe
   * ver el listado de tarjetas —serían los nombres, los teléfonos y los hábitos
   * de consumo de su propia gente—. Así que escribe el documento y el sistema
   * actúa sin enseñarle nada.
   *
   * La respuesta es SIEMPRE la misma, exista o no esa tarjeta. Si cambiara,
   * el portal se convertiría en un buscador para averiguar quién tiene tarjeta.
   */
  async baja(token: string, documentoRaw: string) {
    const convenio = await this.porToken(token);
    const documento = normalizarDocumento(documentoRaw);
    if (!documento || documento.length < 4) {
      throw new BadRequestException('Escribe el documento completo.');
    }

    const tarjeta = await this.prisma.convenioTarjeta.findFirst({
      where: { convenioId: convenio.id, documento },
      // El correo del cliente hace falta para poder limpiar también su fila de
      // la lista blanca cargada por correo — ver abajo.
      select: {
        id: true,
        passId: true,
        status: true,
        customer: { select: { email: true } },
      },
    });
    if (tarjeta && tarjeta.status !== 'BLOCKED') {
      await this.prisma.convenioTarjeta.update({
        where: { id: tarjeta.id },
        data: {
          status: 'BLOCKED',
          blockedAt: new Date(),
          // Convención: quién bloqueó. El negocio lo ve en el panel para no
          // levantar un bloqueo del aliado sin preguntarle.
          blockedBy: 'aliado',
        },
      });
      if (tarjeta.passId) {
        await avisarUnPase(this.prisma, this.queue, tarjeta.passId, 'convenio_baja');
      }
    }

    // Quitarlo también de la lista blanca, si estaba: si no, en modo LISTA
    // podría volver a activar mañana y el bloqueo no habría servido de nada.
    //
    // Por documento Y por correo. La lista admite las dos formas —quien la
    // carga pega lo que le dio RRHH—, así que borrar solo por documento dejaba
    // viva la fila de correo de esa misma persona: bastaba con volver a entrar
    // dando ese correo, y la baja no habría servido de nada. Es justo lo que
    // esta función promete evitar.
    const correo = normalizarEmail(tarjeta?.customer?.email);
    await this.prisma.convenioListaBlanca.deleteMany({
      where: {
        convenioId: convenio.id,
        OR: [{ documento }, ...(correo ? [{ email: correo }] : [])],
      },
    });

    this.logger.log(
      `Alianza ${convenio.slug} · baja pedida por el aliado (encontrada: ${!!tarjeta})`,
    );
    return {
      ok: true,
      mensaje:
        'Listo. Si esa persona tenía tarjeta, quedó desactivada y no podrá volver a activarla.',
    };
  }

  private avisarPases(convenioId: string) {
    return avisarPasesDeAlianza(
      this.prisma,
      this.queue,
      convenioId,
      'convenio_estado',
    );
  }
}
