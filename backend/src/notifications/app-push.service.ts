import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

type Aviso = {
  titulo: string;
  cuerpo: string;
  /** Ruta del panel a abrir al tocar la notificación (ej. '/app/orders'). */
  ruta?: string;
  /** Datos extra que viajan con el push. */
  datos?: Record<string, string>;
};

/**
 * Notificaciones push a la APP de iOS/Android (distinto de las del pase de
 * Apple Wallet, que viven en WalletService con SU PROPIA clave APNs).
 *
 * Son credenciales separadas a propósito: revocar la del pase no debe dejar
 * la app muda, ni al revés. De ahí los nombres APP_PUSH_* en vez de APNS_*.
 */
@Injectable()
export class AppPushService {
  private readonly log = new Logger(AppPushService.name);

  constructor(private prisma: PrismaService) {}

  private cargarClave(): string | null {
    const b64 = process.env.APP_PUSH_KEY_BASE64;
    if (!b64) return null;
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch (e) {
      this.log.warn(`APP_PUSH_KEY_BASE64 inválida: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Manda un aviso a todos los dispositivos de un usuario.
   * Nunca lanza: una notificación que falla no puede tumbar la operación de
   * negocio que la disparó (confirmar un pedido, cerrar un corte).
   */
  async enviarAUsuario(userId: string, aviso: Aviso): Promise<{ enviados: number }> {
    try {
      const dispositivos = await this.prisma.deviceToken.findMany({
        where: { userId },
        select: { token: true, platform: true },
      });
      if (dispositivos.length === 0) return { enviados: 0 };

      const ios = dispositivos.filter((d) => d.platform === 'ios').map((d) => d.token);
      const android = dispositivos.filter((d) => d.platform === 'android');
      if (android.length > 0) {
        // FCM todavía sin configurar: se registra para que no parezca que
        // llegó y quede el misterio de por qué el Android no suena.
        this.log.warn(`${android.length} dispositivo(s) Android sin enviar: FCM no configurado`);
      }
      if (ios.length === 0) return { enviados: 0 };

      return { enviados: await this.enviarApns(ios, aviso) };
    } catch (e) {
      this.log.error(`Push a ${userId} falló: ${(e as Error).message}`);
      return { enviados: 0 };
    }
  }

  private async enviarApns(tokens: string[], aviso: Aviso): Promise<number> {
    const key = this.cargarClave();
    const keyId = process.env.APP_PUSH_KEY_ID;
    const teamId = process.env.APP_PUSH_TEAM_ID;
    const topic = process.env.APP_PUSH_BUNDLE_ID ?? 'com.soyclubify.app';

    if (!key || !keyId || !teamId) {
      this.log.warn(`APNs de la app sin configurar — ${tokens.length} avisos sin enviar`);
      return 0;
    }

    const apn = await import('apn');

    const construir = () => {
      const n = new apn.Notification();
      n.topic = topic;
      n.alert = { title: aviso.titulo, body: aviso.cuerpo };
      n.sound = 'default';
      // `apn` 2.x no tipa pushType, pero APNs lo exige desde iOS 13.
      (n as unknown as { pushType: string }).pushType = 'alert';
      // La ruta viaja como dato: la app la usa para abrir la pantalla que
      // corresponde en vez de dejar al usuario en el inicio.
      n.payload = { ruta: aviso.ruta ?? null, ...(aviso.datos ?? {}) };
      return n;
    };

    /**
     * Se prueba PRODUCTION y, si el token resulta ser de sandbox, se
     * reintenta ahí. Un build instalado por cable lleva entitlement
     * `development` y su token SOLO vale en sandbox; el mismo aparato con la
     * app de TestFlight tiene otro token que solo vale en production. Sin
     * este reintento, las pruebas por cable fallan siempre en silencio con
     * BadDeviceToken y uno cree que el push está roto.
     */
    const intentar = async (production: boolean) => {
      const proveedor = new apn.Provider({ token: { key, keyId, teamId }, production });
      try {
        return await proveedor.send(construir(), tokens);
      } finally {
        proveedor.shutdown();
      }
    };

    let res = await intentar(true);
    const soloEntorno =
      res.sent.length === 0 &&
      res.failed.length > 0 &&
      res.failed.every((f: any) => f.response?.reason === 'BadDeviceToken');
    if (soloEntorno) {
      this.log.debug('Tokens de sandbox — reintentando contra APNs de desarrollo');
      res = await intentar(false);
    }

    // Los tokens que APNs da por muertos se borran: seguir empujando a
    // aparatos desinstalados penaliza la reputación del emisor.
    const muertos = res.failed
      .filter((f: any) => ['Unregistered', 'BadDeviceToken'].includes(f.response?.reason))
      .map((f: any) => f.device);
    if (muertos.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: muertos } } });
      this.log.log(`${muertos.length} token(s) muerto(s) eliminados`);
    }

    if (res.failed.length > 0) {
      this.log.warn(
        `APNs: ${res.sent.length} enviados, ${res.failed.length} fallidos — ` +
          res.failed.map((f: any) => f.response?.reason ?? f.error?.message).join(', '),
      );
    }
    return res.sent.length;
  }
}
