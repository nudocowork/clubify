import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  brandWhiteLabelWhere,
  resolveBrandScope,
} from '../common/white-label/brand-scope.util';
import { getCanonicalBundlePrice } from '../common/plan-pricing';
import { MediaService } from '../media/media.service';
import { TenantsService } from '../tenants/tenants.service';
import { ReferralsService } from '../referrals/referrals.service';
import {
  FormularioCrudo,
  firmaValida,
  partirToken,
  tokenDelCloser,
  usdSugerido,
  validarFormulario,
} from './registro-de-pago';

/** Comprobantes: foto o PDF. Un audio o un video no prueban una transferencia. */
const TIPOS_DE_COMPROBANTE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/**
 * Pagos por fuera que registran los closers y aprueba un admin.
 *
 * El closer llena el formulario desde SU enlace (el afiliado sale del enlace),
 * sube el comprobante, y nada más: no se crea el negocio, ni la comisión, ni
 * el ingreso. Todo eso pasa en `aprobar`, cuando alguien comprobó que el
 * dinero llegó — y pasa por los MISMOS caminos que ya usa el panel (alta de
 * negocio, pago manual, asignación de afiliado), no por una copia.
 */
@Injectable()
export class PagosPorAprobarService {
  private readonly logger = new Logger(PagosPorAprobarService.name);

  constructor(
    private prisma: PrismaService,
    private media: MediaService,
    private tenants: TenantsService,
    private referrals: ReferralsService,
  ) {}

  // ── Lado del closer (público, por enlace) ────────────────────────────────

  private async closerDelToken(token: string) {
    const partes = partirToken(String(token ?? '').trim());
    // Mismo mensaje para todo: no decirle a quien prueba enlaces si el código
    // existe y solo falla la firma.
    const invalido = new NotFoundException('Este enlace no es válido. Pídele uno nuevo a tu líder.');
    if (!partes) throw invalido;
    const code = await this.prisma.referralCode.findUnique({
      where: { code: partes.code },
      select: { id: true, code: true, ownerName: true, isActive: true, whiteLabelId: true },
    });
    if (!code || !firmaValida(code.id, partes.sig)) throw invalido;
    if (code.isActive === false) {
      throw new NotFoundException('Este enlace está desactivado. Habla con tu líder.');
    }
    return code;
  }

  /** Lo que el formulario necesita para pintarse: quién es el closer y su marca. */
  async abrirEnlace(token: string) {
    const code = await this.closerDelToken(token);
    const marca = code.whiteLabelId
      ? await this.prisma.whiteLabel.findUnique({
          where: { id: code.whiteLabelId },
          select: { name: true, logoUrl: true },
        })
      : null;
    return {
      closer: code.ownerName,
      // Sin marca resuelta no se pinta ninguna: nunca «Clubify» por defecto.
      marca: marca ? { nombre: marca.name, logoUrl: marca.logoUrl } : null,
    };
  }

  async registrar(token: string, crudo: FormularioCrudo, archivo?: Express.Multer.File) {
    const code = await this.closerDelToken(token);
    const v = validarFormulario(crudo);
    if (!v.ok) throw new BadRequestException({ message: 'Revisa los datos del formulario.', errores: v.errores });
    if (!archivo) {
      throw new BadRequestException({ message: 'Falta el comprobante de pago.', errores: { comprobante: 'Sube la foto o el PDF del comprobante.' } });
    }
    if (!TIPOS_DE_COMPROBANTE.test(archivo.mimetype)) {
      throw new BadRequestException({ message: 'El comprobante debe ser una foto o un PDF.', errores: { comprobante: 'Sube una foto (JPG, PNG) o un PDF.' } });
    }
    const d = v.datos;

    // El correo del dueño se vuelve su usuario, y es único: si ya existe, la
    // aprobación fallaría días después. Mejor decirlo ahora, a quien lo sabe.
    const usuario = await this.prisma.user.findUnique({ where: { email: d.ownerEmail }, select: { id: true } });
    if (usuario) {
      throw new ConflictException({
        message: 'Ese correo ya tiene una cuenta.',
        errores: { ownerEmail: 'Ese correo ya tiene una cuenta en la plataforma. Usa otro correo del dueño o avisa a tu líder.' },
      });
    }
    // El mismo registro dos veces (doble clic, o lo reenvió porque no vio la
    // confirmación): uno basta.
    const repetida = await this.prisma.manualPaymentRequest.findFirst({
      where: { referralCodeId: code.id, ownerEmail: d.ownerEmail, status: { in: ['PENDIENTE', 'APROBANDO'] } },
      select: { id: true },
    });
    if (repetida) {
      throw new ConflictException({
        message: 'Ya enviaste este registro.',
        errores: { ownerEmail: 'Ya enviaste un registro para este correo y está esperando aprobación.' },
      });
    }

    const subido = await this.media.upload({ folder: 'comprobantes', file: archivo });
    const fila = await this.prisma.manualPaymentRequest.create({
      data: {
        referralCodeId: code.id,
        closerName: code.ownerName,
        whiteLabelId: code.whiteLabelId,
        brandName: d.brandName,
        ownerEmail: d.ownerEmail,
        ownerPhone: d.ownerPhone,
        ownerFullName: d.ownerFullName,
        planPeriodicity: d.planPeriodicity,
        businessType: d.businessType,
        businessCategorySlug: d.businessCategorySlug,
        method: d.method,
        amount: d.amount,
        currency: d.currency,
        paidAt: d.paidAt,
        reference: d.reference,
        proofUrl: subido.url,
        note: d.note,
      },
      select: { id: true, brandName: true },
    });
    this.logger.log(`Pago por aprobar ${fila.id}: ${fila.brandName} (closer ${code.ownerName})`);
    return { ok: true, id: fila.id };
  }

  // ── Lado del admin ───────────────────────────────────────────────────────

  private async alcance(user: AuthUser) {
    return brandWhiteLabelWhere(await resolveBrandScope(this.prisma, user?.whiteLabelId));
  }

  async listar(user: AuthUser, estado?: string) {
    const filtroEstado =
      estado === 'TODOS' ? {} : estado ? { status: estado } : { status: { in: ['PENDIENTE', 'APROBANDO'] } };
    const filas = await this.prisma.manualPaymentRequest.findMany({
      where: { AND: [await this.alcance(user), filtroEstado] },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return Promise.all(filas.map((f) => this.presentar(f)));
  }

  async contarPendientes(user: AuthUser) {
    const n = await this.prisma.manualPaymentRequest.count({
      where: { AND: [await this.alcance(user), { status: { in: ['PENDIENTE', 'APROBANDO'] } }] },
    });
    return { pendientes: n };
  }

  private async buscar(user: AuthUser, id: string) {
    const f = await this.prisma.manualPaymentRequest.findFirst({
      where: { AND: [await this.alcance(user), { id }] },
    });
    if (!f) throw new NotFoundException('Solicitud no encontrada');
    return f;
  }

  async detalle(user: AuthUser, id: string) {
    return this.presentar(await this.buscar(user, id));
  }

  private async presentar(f: Awaited<ReturnType<PagosPorAprobarService['buscar']>>) {
    const precioDelPlan = await getCanonicalBundlePrice(this.prisma, f.planPeriodicity);
    const amount = Number(f.amount);
    const revisor = f.reviewedById
      ? await this.prisma.user.findUnique({ where: { id: f.reviewedById }, select: { fullName: true, email: true } })
      : null;
    return {
      ...f,
      amount,
      amountUsd: f.amountUsd == null ? null : Number(f.amountUsd),
      precioDelPlanUsd: precioDelPlan,
      usdSugerido: f.amountUsd == null ? usdSugerido(amount, f.currency, precioDelPlan) : Number(f.amountUsd),
      revisadoPor: revisor ? revisor.fullName || revisor.email : null,
    };
  }

  /**
   * Aprueba: crea el negocio, registra el pago (lo activa, cubre su ciclo y lo
   * apunta en Contabilidad), le asigna el closer y genera la comisión.
   *
   * Se puede REINTENTAR: si un paso falla, la solicitud vuelve a PENDIENTE con
   * el error, y el siguiente intento retoma el negocio ya creado en vez de
   * crear otro. El pago repetido lo rechaza el propio registro de pagos.
   */
  async aprobar(user: AuthUser, id: string, body: { amountUsd?: number }) {
    const s = await this.buscar(user, id);
    if (s.status === 'APROBADO') throw new ConflictException('Esta solicitud ya está aprobada.');
    if (s.status === 'RECHAZADO') throw new ConflictException('Esta solicitud está rechazada.');
    const precioDelPlan = await getCanonicalBundlePrice(this.prisma, s.planPeriodicity);
    const amountUsd = Math.round(
      Number(body.amountUsd ?? usdSugerido(Number(s.amount), s.currency, precioDelPlan)) * 100,
    ) / 100;
    if (!(amountUsd > 0)) throw new BadRequestException('Escribe el monto en dólares que entra a Contabilidad.');

    // Dos personas pulsando «Aprobar» a la vez crearían dos negocios. Solo
    // sigue quien consigue pasarla de PENDIENTE a APROBANDO.
    const reclamo = await this.prisma.manualPaymentRequest.updateMany({
      where: { id: s.id, status: 'PENDIENTE' },
      data: { status: 'APROBANDO', amountUsd, lastError: null },
    });
    if (reclamo.count !== 1) {
      throw new ConflictException('Otra persona la está aprobando en este momento. Recarga en unos segundos.');
    }

    try {
      let tenantId = s.createdTenantId;
      let ownerTempPassword: string | null = null;
      if (!tenantId) {
        const creado = await this.tenants.create(
          {
            brandName: s.brandName,
            email: s.ownerEmail,
            phone: s.ownerPhone ?? undefined,
            ownerFullName: s.ownerFullName,
            planPeriodicity: s.planPeriodicity as never,
            businessType: s.businessType as never,
            businessCategorySlug: s.businessCategorySlug ?? undefined,
          } as never,
          user,
        );
        tenantId = creado.tenant.id as string;
        ownerTempPassword = creado.ownerTempPassword ?? null;
        await this.prisma.manualPaymentRequest.update({ where: { id: s.id }, data: { createdTenantId: tenantId } });
      }

      // El precio pactado es lo que pagó: es la base de su comisión y de sus
      // renovaciones, y así Contabilidad y Comisiones cuentan la misma cifra.
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { subscriptionPriceUsd: amountUsd } });

      const ref = s.reference ? ` · ref. ${s.reference}` : '';
      const enMoneda = s.currency !== 'USD' ? ` · cobrado ${Number(s.amount)} ${s.currency}` : '';
      try {
        await this.tenants.registerManualPayment(
          tenantId,
          {
            method: s.method as never,
            amount: amountUsd,
            currency: 'USD',
            reference: s.reference ?? undefined,
            note: `Registrado por ${s.closerName}${enMoneda}${ref}. Comprobante: ${s.proofUrl}`.slice(0, 1000),
            paidAt: s.paidAt.toISOString(),
          },
          user.id,
        );
      } catch (e) {
        // Ya registrado en un intento anterior que falló después: se sigue.
        if (!(e instanceof ConflictException)) throw e;
      }

      // La asignación genera la comisión del ciclo que el pago acaba de cubrir.
      await this.referrals.setTenantAssignment(tenantId, s.referralCodeId, user.id);
      const comisiones = await this.prisma.commission.findMany({
        where: { referralUse: { tenantId } },
        select: { amount: true, status: true, recipientCode: { select: { ownerName: true } } },
      });

      await this.prisma.manualPaymentRequest.update({
        where: { id: s.id },
        data: { status: 'APROBADO', reviewedById: user.id, reviewedAt: new Date(), lastError: null },
      });
      this.logger.log(`Pago por aprobar ${s.id} APROBADO → negocio ${tenantId}, ${comisiones.length} comisión(es)`);
      return {
        ok: true,
        tenantId,
        ownerEmail: s.ownerEmail,
        ownerTempPassword,
        amountUsd,
        comisiones: comisiones.map((c) => ({
          afiliado: c.recipientCode?.ownerName ?? null,
          monto: Number(c.amount),
          estado: c.status,
        })),
      };
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      await this.prisma.manualPaymentRequest
        .update({ where: { id: s.id }, data: { status: 'PENDIENTE', lastError: msg.slice(0, 500) } })
        .catch(() => null);
      throw e;
    }
  }

  async rechazar(user: AuthUser, id: string, motivo: string) {
    const s = await this.buscar(user, id);
    const texto = String(motivo ?? '').trim();
    if (!texto) throw new BadRequestException('Escribe por qué se rechaza: el closer lo necesita para corregirlo.');
    if (s.createdTenantId) {
      throw new ConflictException('Esta solicitud ya creó un negocio: revísalo desde Negocios en vez de rechazarla.');
    }
    const r = await this.prisma.manualPaymentRequest.updateMany({
      where: { id: s.id, status: 'PENDIENTE' },
      data: { status: 'RECHAZADO', rejectReason: texto.slice(0, 1000), reviewedById: user.id, reviewedAt: new Date() },
    });
    if (r.count !== 1) throw new ConflictException('Esta solicitud ya no está pendiente.');
    return { ok: true };
  }

  /** El enlace de cada closer de la marca, para copiarlo y mandárselo. */
  async enlaces(user: AuthUser) {
    const codes = await this.prisma.referralCode.findMany({
      where: {
        AND: [
          await this.alcance(user),
          { isActive: true, role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] } },
        ],
      },
      select: { id: true, code: true, ownerName: true, role: true },
      orderBy: { ownerName: 'asc' },
    });
    return codes.map((c) => ({ ...c, token: tokenDelCloser(c) }));
  }

  /** El enlace del afiliado que tiene la sesión abierta. */
  async miEnlace(user: AuthUser) {
    const code = await this.prisma.referralCode.findFirst({
      where: { ownerUserId: user.id, isActive: true },
      select: { id: true, code: true },
    });
    return { token: code ? tokenDelCloser(code) : null };
  }
}
