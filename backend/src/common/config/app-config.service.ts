import { Injectable } from '@nestjs/common';
import { AppEnv, validateEnv } from './env.validation';

/**
 * Wrapper tipado sobre process.env validado al boot.
 *
 * USO:
 *   constructor(private appConfig: AppConfigService) {}
 *   ...
 *   this.appConfig.JWT_SECRET   // string garantizado
 *
 * Reemplaza patrones como `process.env.JWT_SECRET ?? 'dev-secret'` que firmaban
 * tokens con secret débil si la env var faltaba en producción.
 */
@Injectable()
export class AppConfigService {
  private readonly env: AppEnv;

  constructor() {
    this.env = validateEnv(process.env as Record<string, unknown>);
  }

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.env[key];
  }

  // Getters explícitos para los más usados (mejor DX en autocomplete).
  get NODE_ENV() {
    return this.env.NODE_ENV;
  }
  get isProd() {
    return this.env.NODE_ENV === 'production';
  }
  get isDev() {
    return this.env.NODE_ENV === 'development';
  }
  get isTest() {
    return this.env.NODE_ENV === 'test';
  }

  get JWT_SECRET() {
    return this.env.JWT_SECRET;
  }
  get JWT_REFRESH_SECRET() {
    return this.env.JWT_REFRESH_SECRET;
  }
  get JWT_EXPIRES() {
    return this.env.JWT_EXPIRES;
  }
  get JWT_REFRESH_EXPIRES() {
    return this.env.JWT_REFRESH_EXPIRES;
  }
  get QR_HMAC_SECRET() {
    return this.env.QR_HMAC_SECRET;
  }
  get APP_URL() {
    return this.env.APP_URL;
  }
}
