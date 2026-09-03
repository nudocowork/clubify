import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Registro de dispositivos para notificaciones push.
 *
 * El upsert va por TOKEN, no por usuario: en el mostrador de un local es
 * normal que dos empleados usen el mismo teléfono, y el token del aparato es
 * el mismo. Si se guardara por usuario, el que se fue seguiría recibiendo los
 * pedidos del que entró.
 */
@Injectable()
export class DevicesService {
  private readonly log = new Logger(DevicesService.name);

  constructor(private prisma: PrismaService) {}

  async registrar(userId: string, token: string, platform: 'ios' | 'android') {
    const dispositivo = await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      // Reasignar al usuario actual: el aparato pasó de manos.
      update: { userId, platform, lastSeenAt: new Date() },
    });
    this.log.log(`Dispositivo ${platform} registrado para ${userId}`);
    return { ok: true, id: dispositivo.id };
  }

  /**
   * Al cerrar sesión. No se filtra por usuario a propósito: si el token dejó
   * de ser de quien lo registró, igual hay que soltarlo — lo que importa es
   * que ese aparato deje de recibir.
   */
  async borrar(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
    return { ok: true };
  }

  /** Tokens activos de un usuario, para cuando haya que enviarle algo. */
  async tokensDe(userId: string) {
    return this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true, platform: true },
    });
  }
}
