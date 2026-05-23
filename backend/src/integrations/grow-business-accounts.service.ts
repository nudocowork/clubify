import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const API = 'https://services.leadconnectorhq.com';

/**
 * CRUD de subcuentas globales de Grow Business compartidas entre
 * múltiples tenants. La diferencia con `GrowBusinessService` (que
 * trabaja con credenciales por tenant) es que estas viven solas en su
 * propia tabla y un tenant las "consume" via `reviewAlertsAccountId`.
 *
 * Soft-delete con `deletedAt` para no romper FKs de tenants que aún
 * apuntan al registro. La FK tiene ON DELETE SET NULL como red de
 * seguridad por si se ejecuta DELETE manual desde DB.
 */
@Injectable()
export class GrowBusinessAccountsService {
  private readonly log = new Logger(GrowBusinessAccountsService.name);

  constructor(private prisma: PrismaService) {}

  /** Lista todas las subcuentas activas (sin las soft-deleted) +
   *  cuántos tenants tiene asignados cada una. */
  async list() {
    const accounts = await this.prisma.growBusinessAccount.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { tenants: true } } },
    });
    // Sanitizar: no devolver apiKey completa en la lista (solo prefijo).
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      locationId: a.locationId,
      apiKeyPreview: a.apiKey
        ? a.apiKey.slice(0, 4) + '…' + a.apiKey.slice(-4)
        : null,
      switchNumber: a.switchNumber,
      isDefault: a.isDefault,
      lastTestAt: a.lastTestAt,
      lastTestOk: a.lastTestOk,
      tenantsCount: a._count.tenants,
      createdAt: a.createdAt,
    }));
  }

  async create(input: {
    name: string;
    locationId: string;
    apiKey: string;
    switchNumber?: number | null;
    isDefault?: boolean;
  }) {
    if (!input.name?.trim()) throw new BadRequestException('Name requerido');
    if (!input.locationId?.trim())
      throw new BadRequestException('Location ID requerido');
    if (!input.apiKey?.trim() || input.apiKey.length < 10)
      throw new BadRequestException('API key inválida');

    // Si lo marcan como default, desmarcar los demás. Garantiza único default.
    if (input.isDefault) {
      await this.prisma.growBusinessAccount.updateMany({
        where: { isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
    }

    return this.prisma.growBusinessAccount.create({
      data: {
        name: input.name.trim(),
        locationId: input.locationId.trim(),
        apiKey: input.apiKey.trim(),
        switchNumber: input.switchNumber ?? null,
        isDefault: !!input.isDefault,
      },
    });
  }

  async update(
    id: string,
    input: {
      name?: string;
      locationId?: string;
      apiKey?: string;
      switchNumber?: number | null;
      isDefault?: boolean;
    },
  ) {
    const existing = await this.prisma.growBusinessAccount.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt)
      throw new NotFoundException('Subcuenta no encontrada');

    if (input.isDefault) {
      await this.prisma.growBusinessAccount.updateMany({
        where: { isDefault: true, deletedAt: null, NOT: { id } },
        data: { isDefault: false },
      });
    }

    return this.prisma.growBusinessAccount.update({
      where: { id },
      data: {
        name: input.name?.trim() ?? undefined,
        locationId: input.locationId?.trim() ?? undefined,
        apiKey: input.apiKey?.trim() ?? undefined,
        switchNumber:
          input.switchNumber === undefined ? undefined : input.switchNumber,
        isDefault:
          input.isDefault === undefined ? undefined : !!input.isDefault,
      },
    });
  }

  /** Soft delete: SET deletedAt y rompe asignaciones (los tenants
   *  vinculados quedan con reviewAlertsAccountId=null por la FK
   *  ON DELETE SET NULL). */
  async remove(id: string) {
    const existing = await this.prisma.growBusinessAccount.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.tenant.updateMany({
        where: { reviewAlertsAccountId: id },
        data: { reviewAlertsAccountId: null },
      }),
      this.prisma.growBusinessAccount.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false },
      }),
    ]);
    return { ok: true };
  }

  /** Ping al endpoint de Grow Business para validar credenciales. No
   *  manda mensaje real — usa el endpoint de "locations" que es read-only. */
  async test(id: string) {
    const acc = await this.prisma.growBusinessAccount.findUnique({
      where: { id },
    });
    if (!acc || acc.deletedAt)
      throw new NotFoundException('Subcuenta no encontrada');

    try {
      const res = await fetch(`${API}/locations/${acc.locationId}`, {
        headers: {
          Authorization: `Bearer ${acc.apiKey}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
      });
      const ok = res.ok;
      await this.prisma.growBusinessAccount.update({
        where: { id },
        data: { lastTestAt: new Date(), lastTestOk: ok },
      });
      if (ok) {
        return { ok: true };
      }
      let detail: any = null;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => '');
      }
      return { ok: false, status: res.status, detail };
    } catch (e: any) {
      this.log.warn(`[grow-business-account] test failed id=${id} err=${e?.message}`);
      await this.prisma.growBusinessAccount.update({
        where: { id },
        data: { lastTestAt: new Date(), lastTestOk: false },
      });
      return { ok: false, error: e?.message ?? 'network_error' };
    }
  }

  /** Cargar full record (incluye apiKey) — solo para uso interno de
   *  GrowBusinessService.sendSmsWithAccount. NO exponer en endpoints. */
  async findInternal(id: string) {
    return this.prisma.growBusinessAccount.findFirst({
      where: { id, deletedAt: null },
    });
  }
}
