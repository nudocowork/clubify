import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { X509Certificate } from 'crypto';
import { readFileSync, existsSync } from 'fs';

/**
 * Monitorea la fecha de expiración de los certs Apple (pass signing + WWDR
 * + APNs si está en formato cert). Si falta menos de 30 días para que
 * expiren, loguea WARN. Si Sentry está configurado, también captura un
 * evento de severidad warning con context del archivo.
 *
 * Por qué importa: si el cert de Apple Pass expira, TODAS las tarjetas
 * dejan de instalarse en wallets nuevos (y los push de update fallan).
 * Renovar Apple cert requiere ~24h de coordinación con Apple Developer.
 *
 * Google Wallet service account JSON no tiene expiry (a menos que rotes
 * manualmente la key), por eso no se monitorea aquí. Si en el futuro
 * agregamos JWT-signed keys con expiry, se extiende este servicio.
 */
@Injectable()
export class CertMonitorService {
  private readonly logger = new Logger(CertMonitorService.name);

  /** Diario a las 6 AM UTC. Run lightweight — solo lee 3 archivos. */
  @Cron('0 6 * * *', { name: 'wallet.cert-monitor' })
  async checkCerts() {
    const targets: Array<{ envKey: string; description: string }> = [
      { envKey: 'APPLE_PASS_CERT_PATH', description: 'Apple Pass signing cert' },
      { envKey: 'APPLE_WWDR_PATH', description: 'Apple WWDR intermediate' },
      { envKey: 'APNS_KEY_PATH', description: 'APNs key (si es .pem)' },
    ];

    for (const t of targets) {
      const p = process.env[t.envKey];
      if (!p) continue;
      this.checkOne(t.envKey, t.description, p);
    }
  }

  /** Lectura del cert + comparación contra fecha actual. */
  private checkOne(envKey: string, description: string, path: string) {
    if (!existsSync(path)) {
      this.logger.warn(
        `Cert monitor · ${envKey}=${path} no existe en disco. Saltado.`,
      );
      return;
    }

    let cert: X509Certificate;
    try {
      const pem = readFileSync(path);
      cert = new X509Certificate(pem);
    } catch (e: any) {
      this.logger.warn(
        `Cert monitor · ${envKey} no parseable como X509: ${e?.message ?? e}`,
      );
      return;
    }

    const validTo = new Date(cert.validTo);
    const now = Date.now();
    const daysLeft = Math.floor((validTo.getTime() - now) / 86_400_000);

    if (daysLeft < 0) {
      this.logger.error(
        `❌ CERT EXPIRADO · ${description} (${envKey}) venció hace ${-daysLeft}d (${cert.validTo}). ` +
          `Renovalo YA — wallets no se generan.`,
      );
      this.captureSentry('error', description, envKey, daysLeft, cert.validTo);
    } else if (daysLeft <= 30) {
      this.logger.warn(
        `⚠ CERT POR EXPIRAR · ${description} (${envKey}) vence en ${daysLeft}d (${cert.validTo}).`,
      );
      this.captureSentry('warning', description, envKey, daysLeft, cert.validTo);
    } else {
      this.logger.log(
        `Cert OK · ${description} (${envKey}) vence en ${daysLeft}d.`,
      );
    }
  }

  private async captureSentry(
    level: 'warning' | 'error',
    description: string,
    envKey: string,
    daysLeft: number,
    validTo: string,
  ) {
    if (!process.env.SENTRY_DSN) return;
    try {
      // Import dinámico para no requerir Sentry como dep dura.
      const Sentry = await import('@sentry/node');
      Sentry.withScope((scope) => {
        scope.setLevel(level);
        scope.setTag('subsystem', 'wallet.cert-monitor');
        scope.setTag('envKey', envKey);
        scope.setExtra('daysLeft', daysLeft);
        scope.setExtra('validTo', validTo);
        Sentry.captureMessage(
          `Wallet cert ${description}: ${daysLeft}d left`,
        );
      });
    } catch {
      // Sentry opcional — si no está, no romper el cron.
    }
  }
}
