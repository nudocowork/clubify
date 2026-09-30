import { Injectable, Logger } from '@nestjs/common';

/**
 * El cliente de la API de Hotmart — la dirección CONTRARIA al webhook.
 *
 * El webhook (HOTMART_HOTTOK) es Hotmart avisándonos; esto es NOSOTROS
 * ordenándole algo a Hotmart. Existe desde el 2026-09-30, cuando Jhon creó
 * las credenciales en developers.hotmart.com y quedaron en Railway como
 * `HOTMART_CLIENT_ID` / `HOTMART_CLIENT_SECRET`. Contrato verificado ese
 * mismo día contra la API real (token 200, bearer, expira 48 h) y contra la
 * documentación oficial del endpoint de cancelación.
 *
 * Lo único que hace hoy: CANCELAR una suscripción. Lo usan
 *  - `BillingService.cancelSubscription`: el dueño cancela en NUESTRO panel
 *    y la suscripción se cancela también en Hotmart — sin esto, Hotmart le
 *    cobraba el ciclo siguiente y el sistema lo re-activaba como
 *    «arrepentido» (lo que Javier señaló el 2026-09-30).
 *  - El upgrade a anual (`PlanUpgradeService`): desconectar el plan mensual
 *    viejo sin panel de Hotmart ni checkbox de confianza.
 *
 * Reglas de la casa:
 *  - NUNCA lanza: devuelve `{ ok: false, motivo }` y quien llama decide.
 *    Una cancelación local jamás puede fallar porque Hotmart esté caído.
 *  - `send_mail: false` por defecto: el correo de cancelación que ve el
 *    cliente es el de SU MARCA (sale por nuestro webhook), no el de Hotmart.
 *  - El token se cachea en memoria (~48 h de vida, margen de 2 min).
 */

const URL_TOKEN = 'https://api-sec-vlc.hotmart.com/security/oauth/token';
const URL_PAGOS = 'https://developers.hotmart.com/payments/api/v1';
const TIMEOUT_MS = 12_000;
const MARGEN_DEL_TOKEN_MS = 2 * 60 * 1000;

export type ResultadoDeCancelacion =
  | { ok: true; status: string | null }
  | { ok: false; motivo: string };

@Injectable()
export class HotmartApiService {
  private readonly logger = new Logger(HotmartApiService.name);
  private token: { valor: string; venceEn: number } | null = null;

  estaConfigurada(): boolean {
    return Boolean(
      process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET,
    );
  }

  /**
   * Cancela la suscripción `subscriberCode` en Hotmart.
   *
   * `mandarCorreo` controla el correo DE HOTMART al comprador (el de la marca
   * lo manda nuestro webhook de cancelación, siempre). Por defecto apagado.
   */
  async cancelarSuscripcion(
    subscriberCode: string,
    opts: { mandarCorreo?: boolean } = {},
  ): Promise<ResultadoDeCancelacion> {
    const code = (subscriberCode ?? '').trim();
    if (!code) return { ok: false, motivo: 'Sin código de suscriptor.' };
    if (!this.estaConfigurada()) {
      return { ok: false, motivo: 'La API de Hotmart no está configurada.' };
    }
    try {
      const token = await this.tokenVigente();
      if (!token) {
        return { ok: false, motivo: 'Hotmart no entregó token (credenciales o red).' };
      }
      const r = await this.conTimeout(
        `${URL_PAGOS}/subscriptions/${encodeURIComponent(code)}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ send_mail: opts.mandarCorreo === true }),
        },
      );
      const cuerpo = (await r.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
        error_description?: string;
        message?: string;
      };
      if (!r.ok) {
        const motivo =
          cuerpo.error_description || cuerpo.message || cuerpo.error || `HTTP ${r.status}`;
        this.logger.warn(`Hotmart cancel ${code} → ${r.status}: ${motivo}`);
        return { ok: false, motivo };
      }
      this.logger.log(`Hotmart cancel ${code} → ${cuerpo.status ?? 'OK'}`);
      return { ok: true, status: cuerpo.status ?? null };
    } catch (e) {
      const motivo = (e as Error)?.message ?? 'error de red';
      this.logger.warn(`Hotmart cancel ${code} falló: ${motivo}`);
      return { ok: false, motivo };
    }
  }

  /** El access token, del caché o pedido de nuevo. Null si no se pudo. */
  private async tokenVigente(): Promise<string | null> {
    if (this.token && Date.now() < this.token.venceEn) return this.token.valor;
    const id = process.env.HOTMART_CLIENT_ID ?? '';
    const secret = process.env.HOTMART_CLIENT_SECRET ?? '';
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    try {
      const r = await this.conTimeout(
        `${URL_TOKEN}?grant_type=client_credentials` +
          `&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (!r.ok) {
        this.logger.warn(`Hotmart token → HTTP ${r.status}`);
        return null;
      }
      const cuerpo = (await r.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!cuerpo.access_token) return null;
      const vidaMs = Math.max(60_000, (cuerpo.expires_in ?? 3600) * 1000);
      this.token = {
        valor: cuerpo.access_token,
        venceEn: Date.now() + vidaMs - MARGEN_DEL_TOKEN_MS,
      };
      return this.token.valor;
    } catch (e) {
      this.logger.warn(`Hotmart token falló: ${(e as Error)?.message}`);
      return null;
    }
  }

  private async conTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }
}
