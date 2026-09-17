import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Los logs del webservice de Apple Wallet.
 *
 * EL FALLO (arqueo 2026-09-17):
 *  · Al rechazar un registro, se escribían 8 caracteres del `authToken` REAL
 *    del pase («expected abcd1234…»). Es la llave con la que Apple pide el
 *    pase actualizado; en los logs de Railway no pinta nada.
 *  · Al fallar un push, se volcaba la respuesta de APNs en JSON, y esa
 *    respuesta lleva el token COMPLETO del dispositivo.
 *  · `POST v1/log` es público y escribía una línea por entrada, sin límite de
 *    entradas ni de longitud: cualquiera llenaba los logs.
 */

vi.mock('apn', () => {
  class Notification {
    topic = '';
    payload: Record<string, unknown> = {};
  }
  return { Notification, default: { Notification } };
});

function controlador(pase: Record<string, unknown> | null) {
  const prisma: any = { pass: { findUnique: async () => pase } };
  const ctrl = new WalletController(prisma, {} as never);
  const avisos: string[] = [];
  const log = (m: unknown) => avisos.push(String(m));
  (ctrl as any).logger = { log, warn: log, error: log, debug: log };
  return { ctrl, avisos };
}

describe('WalletController', () => {
  it('un registro con token equivocado no escribe el token real del pase', async () => {
    const REAL = 'TOKENREAL' + 'q'.repeat(23);
    const { ctrl, avisos } = controlador({ id: 'p1', authToken: REAL });
    const req: any = { headers: { authorization: 'ApplePass intruso-0000000000' } };
    await expect(
      ctrl.register('device-lib-123456', 'CLB-1', { pushToken: 'f'.repeat(64) }, req),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const todo = avisos.join('\n');
    expect(todo).not.toContain(REAL.slice(0, 4));
    expect(todo).not.toContain('intruso');
  });

  it('`v1/log` acota cuántas líneas escribe y cuánto mide cada una', () => {
    const { ctrl, avisos } = controlador(null);
    const logs = Array.from({ length: 5000 }, (_, i) => `error ${i} ` + 'x'.repeat(50_000));
    ctrl.log({ logs });
    expect(avisos.length).toBeLessThanOrEqual(25);
    expect(Math.max(...avisos.map((a) => a.length))).toBeLessThanOrEqual(1200);
  });

  it('`v1/log` no deja inyectar líneas falsas con saltos de línea', () => {
    const { ctrl, avisos } = controlador(null);
    ctrl.log({ logs: ['uno\n[Nest] 1 - LOG [AuthService] login OK admin'] });
    expect(avisos.every((a) => !a.includes('\n'))).toBe(true);
  });
});

describe('WalletService.pushPassUpdate', () => {
  it('un fallo de APNs no vuelca el token completo del dispositivo', async () => {
    const TOKEN = 'a1b2c3d4'.repeat(8);
    const prisma: any = {
      walletDevice: {
        findMany: async () => [{ id: 'd1', pushToken: TOKEN }],
        delete: async () => ({}),
      },
    };
    const google: any = { pushUpdate: async () => ({ ok: true, status: 'ok' }) };
    const srv = new WalletService(prisma, google, {} as never);
    (srv as any).apnsProvider = async () => ({
      send: async () => ({
        sent: [],
        failed: [{ device: TOKEN, status: '400', response: { reason: 'BadDeviceToken' } }],
      }),
    });
    const lineas: string[] = [];
    const log = (m: unknown) => lineas.push(String(m));
    (srv as any).logger = { log, warn: log, error: log, debug: log };
    await srv.pushPassUpdate('pase-1');
    const todo = lineas.join('\n');
    expect(todo).toContain('BadDeviceToken');
    expect(todo).not.toContain(TOKEN);
    expect(todo).not.toContain(TOKEN.slice(12, 40));
  });
});
