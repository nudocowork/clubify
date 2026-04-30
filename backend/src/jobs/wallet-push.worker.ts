import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Worker que envía push notifications a Apple Wallet (APNs) y Google Wallet
 * cuando un pase fue actualizado (sello agregado, redimido, etc.).
 *
 * En modo stub (sin Redis) sólo loguea. Para producción:
 *   1. Configurar APNS_KEY_PATH + APNS_KEY_ID + APNS_TEAM_ID en .env
 *   2. Implementar callApnsPush() con http2 hacia api.push.apple.com
 *   3. Implementar callGoogleWalletPatch() con la Google Wallet API
 *   4. Configurar REDIS_URL para que BullMQ tome el control
 */
@Injectable()
export class WalletPushWorker implements OnModuleInit {
  private logger = new Logger(WalletPushWorker.name);

  constructor(
    private queue: QueueService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.queue.registerWorker('wallet.push', async (data) => {
      const { passId, reason } = data as { passId: string; reason: string };
      const pass = await this.prisma.pass.findUnique({
        where: { id: passId },
        include: { walletDevices: true, card: true },
      });
      if (!pass) {
        this.logger.warn(`pass ${passId} no existe — skip`);
        return;
      }
      this.logger.log(
        `Push wallet pass=${pass.id} reason=${reason} devices=${pass.walletDevices.length}`,
      );

      for (const device of pass.walletDevices) {
        if (device.platform === 'APPLE') {
          await this.callApnsPush(device.pushToken, passId).catch((e) =>
            this.logger.warn(`APNs falló dev=${device.id}: ${e.message}`),
          );
        }
        if (device.platform === 'GOOGLE') {
          await this.callGoogleWalletPatch(passId).catch((e) =>
            this.logger.warn(`Google Wallet falló: ${e.message}`),
          );
        }
      }
    });
  }

  /**
   * APNs (Apple Push Notification service).
   *
   * Stub. Implementación real:
   *   import http2 from 'node:http2';
   *   const client = http2.connect('https://api.push.apple.com');
   *   const req = client.request({
   *     ':path': `/3/device/${pushToken}`,
   *     ':method': 'POST',
   *     'apns-topic': process.env.APPLE_PASS_TYPE_ID,
   *     'authorization': `bearer ${jwtSignedWithApnsP8(...)}`,
   *   });
   *   req.end(JSON.stringify({}));     // Wallet push tiene body vacío
   */
  private async callApnsPush(_pushToken: string, _passId: string) {
    if (!process.env.APNS_KEY_PATH || !process.env.APNS_KEY_ID) {
      this.logger.debug('APNs no configurado — skip');
      return;
    }
    throw new Error('APNs no implementado todavía (ver wallet-push.worker.ts)');
  }

  /**
   * Google Wallet — PATCH al objeto del pase fuerza re-sync en el dispositivo.
   *
   * Stub. Implementación real:
   *   const auth = new GoogleAuth({ keyFile: GOOGLE_WALLET_SA_JSON, scopes: [...] });
   *   const client = await auth.getClient();
   *   const id = `${ISSUER_ID}.${passId}`;
   *   await client.request({
   *     url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${id}`,
   *     method: 'PATCH',
   *     data: { state: 'ACTIVE' },     // o el campo que cambió
   *   });
   */
  private async callGoogleWalletPatch(_passId: string) {
    if (!process.env.GOOGLE_WALLET_ISSUER_ID) {
      this.logger.debug('Google Wallet no configurado — skip');
      return;
    }
    throw new Error(
      'Google Wallet patch no implementado (ver wallet-push.worker.ts)',
    );
  }
}
