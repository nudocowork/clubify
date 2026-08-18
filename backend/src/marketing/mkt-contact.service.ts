import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  resolveContact,
  phoneKeyOf,
  phoneNormOf,
  emailNormOf,
  UniqueContactViolation,
  type ContactRow,
  type ContactStore,
  type ResolveInput,
} from './identity';

/** ¿El error de Prisma es una violación de índice único (la carrera)? */
function isUniqueViolation(e: any): boolean {
  if (!e) return false;
  if (e.code === 'P2002') return true; // Prisma mapea 23505 → P2002
  const msg = String(e.message ?? '');
  return e.code === 'P2010' || /23505|unique constraint|duplicate key/i.test(msg);
}

const ROW = {
  id: true,
  email: true,
  phone: true,
  phoneKey: true,
  phoneNorm: true,
  deleted: true,
} as const;

/**
 * Base de contactos (leads/clientes) de la marca para el motor de email
 * marketing. Toda alta/actualización que toque teléfono o email pasa por
 * `resolveContact` (marketing/identity.ts) → un contacto por identidad.
 */
@Injectable()
export class MktContactService {
  constructor(private prisma: PrismaService) {}

  /** Store Prisma-backed para el resolver, scoped a una marca. */
  private store(whiteLabelId: string): ContactStore {
    const prisma = this.prisma;
    return {
      async findCandidates({ phoneKey, email }) {
        if (!phoneKey && !email) return [];
        const or: any[] = [];
        if (phoneKey) or.push({ phoneKey });
        if (email) or.push({ email });
        return prisma.mktContact.findMany({
          where: { whiteLabelId, OR: or }, // GLOBAL por marca, incluye eliminados
          select: ROW,
        }) as Promise<ContactRow[]>;
      },
      async create(data) {
        try {
          return (await prisma.mktContact.create({
            data: { whiteLabelId, ...data },
            select: ROW,
          })) as ContactRow;
        } catch (e) {
          if (isUniqueViolation(e)) throw new UniqueContactViolation(String((e as any)?.message));
          throw e;
        }
      },
      async reactivate(id, input) {
        return (await prisma.mktContact.update({
          where: { id },
          data: {
            deleted: false,
            // deja constancia: refresca datos con lo que llega, sin borrar lo previo
            ...(input.name ? { name: input.name } : {}),
            ...(input.company ? { company: input.company } : {}),
            ...(input.tags && input.tags.length ? { tags: { set: input.tags } } : {}),
          },
          select: ROW,
        })) as ContactRow;
      },
      async findByUnique({ phoneNorm, email }) {
        const or: any[] = [];
        if (phoneNorm) or.push({ phoneNorm });
        if (email) or.push({ email });
        if (!or.length) return null;
        return (await prisma.mktContact.findFirst({
          where: { whiteLabelId, deleted: false, OR: or },
          select: ROW,
        })) as ContactRow | null;
      },
    };
  }

  /** Alta o reutilización idempotente de un contacto (un contacto por identidad). */
  async upsert(whiteLabelId: string, input: ResolveInput): Promise<ContactRow> {
    return resolveContact(this.store(whiteLabelId), input);
  }

  /** Import de una lista → cada fila pasa por el resolver (dedup automático). */
  async importMany(
    whiteLabelId: string,
    rows: ResolveInput[],
  ): Promise<{ processed: number; contacts: number }> {
    let processed = 0;
    for (const r of rows) {
      if (!emailNormOf(r.email) && !phoneNormOf(r.phone)) continue; // fila sin identidad
      await this.upsert(whiteLabelId, r);
      processed++;
    }
    const contacts = await this.prisma.mktContact.count({ where: { whiteLabelId, deleted: false } });
    return { processed, contacts };
  }

  async list(whiteLabelId: string, opts: { q?: string; take?: number; skip?: number }) {
    const q = (opts.q ?? '').trim();
    const where: any = { whiteLabelId, deleted: false };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.mktContact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(opts.take ?? 50, 200),
        skip: opts.skip ?? 0,
      }),
      this.prisma.mktContact.count({ where }),
    ]);
    return { rows, total };
  }

  /** Baja lógica (deleted=true): al volver a escribir, el resolver la reactiva. */
  async remove(whiteLabelId: string, id: string) {
    await this.prisma.mktContact.updateMany({ where: { id, whiteLabelId }, data: { deleted: true } });
    return { ok: true };
  }

  async setOptOut(whiteLabelId: string, id: string, optOut: boolean) {
    await this.prisma.mktContact.updateMany({ where: { id, whiteLabelId }, data: { optOut } });
    return { ok: true };
  }
}
