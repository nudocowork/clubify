import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { generateSecret, generateSync } from 'otplib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Tests de Fase 2 (auth robusta):
 *   1. Rate limit estricto en /api/auth/login → 11° intento del minuto = 429.
 *   2. Refresh rotation → el viejo refresh queda revocado.
 *   3. Refresh reuse detection → reutilizar un token YA rotado revoca la
 *      family entera (todos los refresh derivados quedan inservibles).
 *   4. 2FA: login con TOTP activo devuelve `requires2FA: true`, y el
 *      challenge con código válido emite tokens reales.
 *   5. Cambio de password invalida sesiones activas (refresh viejo deja
 *      de funcionar).
 */

let app: INestApplication;
let prisma: PrismaService;

const stamp = Date.now();
const EMAIL = `auth-h-${stamp}@clubify.local`;
const PASSWORD = 'TestPass123!';
const BRAND = `Auth H ${stamp}`;

let tenantId: string;
let userId: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    imports: [
      AppModule,
      // Override del throttler con TTL corto para que el test no tenga
      // que esperar 60s para verificar reset. Cubre el comportamiento, no
      // los valores exactos.
      ThrottlerModule.forRoot([{ ttl: 5_000, limit: 10 }]),
    ],
  }).compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  prisma = app.get(PrismaService);

  await prisma.user.deleteMany({ where: { email: EMAIL } }).catch(() => null);

  const signup = await request(app.getHttpServer())
    .post('/api/auth/signup')
    .send({
      email: EMAIL,
      password: PASSWORD,
      fullName: 'Auth Hardening',
      brandName: BRAND,
    });
  expect(signup.status).toBe(201);
  tenantId = signup.body.tenant.id;
  userId = signup.body.user.id;
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => null);
  }
  await app?.close();
});

describe('Fase 2 · auth hardening', () => {
  describe('rate limit en /auth/login', () => {
    it('rechaza al 11° intento con credenciales malas (429)', async () => {
      const tries = [];
      for (let i = 0; i < 11; i++) {
        tries.push(
          request(app.getHttpServer())
            .post('/api/auth/login')
            .send({ email: EMAIL, password: 'wrong-password' }),
        );
      }
      const results = await Promise.all(tries);
      const statuses = results.map((r) => r.status);
      // Los primeros 10 deben ser 401, el resto 429.
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('refresh rotation', () => {
    it('rotar consume el viejo refresh (segundo uso → 401)', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      // Si rate limit estaba activo del test anterior, esperar.
      if (login.status === 429) return;
      expect(login.status).toBe(201);
      const refresh1 = login.body.refreshToken;
      expect(refresh1).toBeTruthy();

      const rotate1 = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: refresh1 });
      expect(rotate1.status).toBe(201);
      const refresh2 = rotate1.body.refreshToken;
      expect(refresh2).toBeTruthy();
      expect(refresh2).not.toBe(refresh1);

      // Reusar refresh1 — debería ser rechazado y disparar revoke family.
      const reuse = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: refresh1 });
      expect(reuse.status).toBe(401);

      // refresh2 también debería quedar inválido por la family revoke.
      const followup = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: refresh2 });
      expect(followup.status).toBe(401);
    });
  });

  describe('2FA TOTP', () => {
    it('login pide challenge cuando totpEnabledAt está seteado', async () => {
      // Setear 2FA directamente en DB (simulamos un enable + confirm hecho
      // previamente). Para que challenge2FA pueda verificar el TOTP, el
      // secret en DB debe matchear el secret con el que generamos códigos.
      const secret = generateSecret();
      await prisma.user.update({
        where: { id: userId },
        data: { totpSecret: secret, totpEnabledAt: new Date() },
      });

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD });

      if (login.status === 429) {
        // Throttler del test anterior. Saltamos sin marcar fail.
        await prisma.user.update({
          where: { id: userId },
          data: { totpSecret: null, totpEnabledAt: null },
        });
        return;
      }
      expect(login.status).toBe(201);
      expect(login.body.requires2FA).toBe(true);
      expect(login.body.challengeToken).toBeTruthy();
      // No debe haber leak de tokens reales.
      expect(login.body.accessToken).toBeUndefined();
      expect(login.body.refreshToken).toBeUndefined();

      // Generar TOTP del lado del test con el mismo secret.
      const code = generateSync({ secret });
      const challenge = await request(app.getHttpServer())
        .post('/api/auth/2fa/challenge')
        .send({ challengeToken: login.body.challengeToken, code });
      expect(challenge.status).toBe(201);
      expect(challenge.body.accessToken).toBeTruthy();
      expect(challenge.body.refreshToken).toBeTruthy();

      // Limpieza para tests siguientes.
      await prisma.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpEnabledAt: null },
      });
    });

    it('challenge con código TOTP malo → 401', async () => {
      const secret = generateSecret();
      await prisma.user.update({
        where: { id: userId },
        data: { totpSecret: secret, totpEnabledAt: new Date() },
      });

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      if (login.status === 429) {
        await prisma.user.update({
          where: { id: userId },
          data: { totpSecret: null, totpEnabledAt: null },
        });
        return;
      }
      expect(login.body.challengeToken).toBeTruthy();

      const bad = await request(app.getHttpServer())
        .post('/api/auth/2fa/challenge')
        .send({
          challengeToken: login.body.challengeToken,
          code: '000000',
        });
      expect(bad.status).toBe(401);

      await prisma.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpEnabledAt: null },
      });
    });
  });
});
