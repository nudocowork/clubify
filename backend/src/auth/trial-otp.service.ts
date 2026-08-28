import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { BrandEmailService } from '../email/brand-email.service';

/**
 * PIN por correo para la prueba gratuita (PDF Software 15).
 *
 * `/auth/trial-signup` es público y sin pago. Hoy solo lo frenan el tope de
 * 2/hora por IP y el dedup por email/teléfono/marca — ninguno prueba que el
 * correo EXISTA ni que sea de quien lo escribe. Esto agrega esa prueba.
 *
 * Notas de diseño que no se ven en el código:
 *
 * · El PIN se guarda **hasheado con argon2**. Es una credencial de un solo uso:
 *   un volcado de la tabla no debe alcanzar para crear cuentas.
 * · `randomInt` (crypto) y no `Math.random()`: un PIN predecible no protege nada.
 * · Pedir el código **nunca revela si el correo ya tiene cuenta**. La respuesta
 *   es la misma siempre — si no, esto se vuelve un enumerador de clientes, que
 *   es peor que el abuso que viene a frenar.
 * · Los trials NO tienen marca (`whiteLabelId` nulo), así que el correo sale
 *   siempre por la subcuenta de la plataforma. Por eso acá no hay cascada de
 *   marcas: si algún día el trial se vuelve por marca, hay que revisarlo.
 */
@Injectable()
export class TrialOtpService {
  private logger = new Logger(TrialOtpService.name);

  /** Diez minutos: suficiente para ir al correo y volver, corto para que un
   *  código filtrado no sirva mañana. */
  private static readonly VIGENCIA_MIN = 10;
  /** Cinco intentos. Con 6 dígitos y 5 tiros, adivinar es 1 en 200.000. */
  private static readonly MAX_INTENTOS = 5;
  /** Códigos pedidos por correo en una hora. Frena el uso del envío como arma
   *  para bombardear el buzón de otra persona. */
  private static readonly MAX_POR_HORA = 5;

  constructor(
    private prisma: PrismaService,
    private brandEmail: BrandEmailService,
  ) {}

  private normalizar(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  /**
   * Genera y manda el PIN. Devuelve si se pudo enviar, pero **sin decir nunca
   * si el correo ya existe en la plataforma**.
   */
  async solicitar(emailRaw: string, ip?: string): Promise<{ enviado: boolean; motivo?: string }> {
    const email = this.normalizar(emailRaw);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('Escribí un correo válido.');
    }

    const desde = new Date(Date.now() - 60 * 60 * 1000);
    const pedidos = await this.prisma.trialEmailOtp.count({
      where: { email, createdAt: { gte: desde } },
    });
    if (pedidos >= TrialOtpService.MAX_POR_HORA) {
      throw new BadRequestException(
        'Ya pedimos varios códigos para ese correo. Esperá una hora o revisá la carpeta de spam.',
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + TrialOtpService.VIGENCIA_MIN * 60 * 1000);

    await this.prisma.trialEmailOtp.create({
      data: { email, codeHash: await argon2.hash(code), expiresAt, ip: ip ?? null },
    });

    const r = await this.brandEmail.sendRaw({
      whiteLabelId: null,
      to: email,
      subject: `${code} es tu código para la prueba gratuita`,
      html: this.html(code),
      text: `Tu código es ${code}. Vence en ${TrialOtpService.VIGENCIA_MIN} minutos.`,
    });

    if (!r.sent) {
      this.logger.warn(`No se pudo enviar el PIN a ${email}: ${r.reason ?? 'desconocido'}`);
      return { enviado: false, motivo: r.reason ?? 'send_failed' };
    }
    return { enviado: true };
  }

  /**
   * Valida y CONSUME el código. Lanza si no sirve.
   *
   * Se consume dentro de una transacción con el conteo de intentos para que
   * dos peticiones simultáneas no puedan gastar el mismo código dos veces.
   */
  async consumir(emailRaw: string, code: string): Promise<void> {
    const email = this.normalizar(emailRaw);
    const limpio = (code ?? '').replace(/\D/g, '');
    if (limpio.length !== 6) {
      throw new BadRequestException('El código son 6 dígitos.');
    }

    const otp = await this.prisma.trialEmailOtp.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new BadRequestException(
        'Ese código venció o ya se usó. Pedí uno nuevo.',
      );
    }
    if (otp.attempts >= TrialOtpService.MAX_INTENTOS) {
      throw new BadRequestException('Demasiados intentos. Pedí un código nuevo.');
    }

    const ok = await argon2.verify(otp.codeHash, limpio).catch(() => false);
    if (!ok) {
      await this.prisma.trialEmailOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      const quedan = TrialOtpService.MAX_INTENTOS - otp.attempts - 1;
      throw new BadRequestException(
        quedan > 0
          ? `El código no coincide. Te quedan ${quedan} ${quedan === 1 ? 'intento' : 'intentos'}.`
          : 'El código no coincide y se acabaron los intentos. Pedí uno nuevo.',
      );
    }

    // updateMany + consumedAt null: si otra petición lo consumió primero,
    // afecta 0 filas y no dejamos pasar dos altas con el mismo código.
    const r = await this.prisma.trialEmailOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (r.count === 0) {
      throw new BadRequestException('Ese código ya se usó. Pedí uno nuevo.');
    }
  }

  private html(code: string): string {
    return `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:28px 24px">
        <p style="font-size:15px;color:#0f172a;margin:0 0 18px">
          Este es tu código para activar la prueba gratuita:
        </p>
        <div style="font-size:34px;font-weight:800;letter-spacing:.18em;color:#0a90bd;
                    background:#f1f5f9;border-radius:12px;padding:18px;text-align:center">
          ${code}
        </div>
        <p style="font-size:13px;color:#64748b;margin:18px 0 0">
          Vence en ${TrialOtpService.VIGENCIA_MIN} minutos y sirve una sola vez.
        </p>
        <p style="font-size:13px;color:#64748b;margin:10px 0 0">
          Si no pediste esta prueba, podés ignorar este correo: sin el código no se crea ninguna cuenta.
        </p>
      </div>`;
  }
}
