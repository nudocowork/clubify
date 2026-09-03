import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  resolveContact,
  phoneKeyOf,
  phoneNormOf,
  emailNormOf,
  samePhone,
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

/** Etiqueta que marca a los contactos que vienen de un NEGOCIO (Tenant) de la marca. */
const TAG_NEGOCIO = 'negocio';

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

  /**
   * Sincroniza los NEGOCIOS (Tenant) de la marca como contactos, con la
   * etiqueta `negocio` para distinguirlos de los leads. Idempotente por diseño:
   *  - Toda alta pasa por el resolver de identidad → correrlo dos veces no
   *    duplica fichas.
   *  - En fichas que YA existían solo se AGREGA la etiqueta y se RELLENA el
   *    nombre vacío; nunca se pisa lo editado a mano ni se toca email/phone de
   *    una ficha existente: la identidad solo se escribe vía resolver, porque
   *    los índices únicos parciales de producción dependen de ese camino.
   */
  async syncTenants(whiteLabelId: string): Promise<{
    created: number;
    updated: number;
    skipped: number;
    contacts: number;
  }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { whiteLabelId, deletedAt: null },
      select: {
        id: true,
        name: true,
        brandName: true,
        email: true,
        phone: true,
        whatsappPhone: true,
      },
    });
    // Fotografía de ids previos: distingue «creado» de «ya existía» sin
    // duplicar la lógica de identidad fuera del resolver.
    const existing = new Set(
      (
        await this.prisma.mktContact.findMany({
          where: { whiteLabelId },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const t of tenants) {
      // `||` y no `??`: un whatsappPhone en cadena vacía no debe tapar el phone real.
      const phone = t.whatsappPhone || t.phone;
      const name = t.brandName || t.name;
      if (!emailNormOf(t.email) && !phoneNormOf(phone)) {
        skipped++; // sin correo ni teléfono no hay a quién escribirle
        continue;
      }
      const row = await this.upsert(whiteLabelId, {
        name,
        email: t.email,
        phone,
        tags: [TAG_NEGOCIO],
      });
      if (!existing.has(row.id)) {
        existing.add(row.id); // dos negocios con el mismo teléfono → un solo «creado»
        created++;
        continue;
      }
      // Ficha preexistente: el resolver la reusó sin escribir. Solo etiqueta y
      // nombre vacío; se cuenta «actualizado» únicamente si de verdad se
      // escribió algo, así la segunda corrida reporta 0 y se ve la idempotencia.
      const cur = await this.prisma.mktContact.findUnique({
        where: { id: row.id },
        select: { name: true, tags: true },
      });
      const data: { tags?: { set: string[] }; name?: string } = {};
      if (cur && !cur.tags.includes(TAG_NEGOCIO)) data.tags = { set: [...cur.tags, TAG_NEGOCIO] };
      if (cur && !cur.name && name) data.name = name;
      if (Object.keys(data).length) {
        await this.prisma.mktContact.update({ where: { id: row.id }, data });
        updated++;
      }
    }
    const contacts = await this.prisma.mktContact.count({
      where: { whiteLabelId, deleted: false },
    });
    return { created, updated, skipped, contacts };
  }

  /**
   * Negocio (Tenant) de la marca que corresponde a un contacto, por identidad
   * (mismo veredicto samePhone / email exacto del resolver). Best-effort y
   * resuelto al momento del envío: MktContact no guarda tenantId (el schema lo
   * edita otra persona en paralelo) y el historial MessageLog sí lo necesita.
   */
  async findTenantIdForContact(
    whiteLabelId: string,
    contact: { email: string | null; phone: string | null },
  ): Promise<string | null> {
    const email = emailNormOf(contact.email);
    if (!email && !phoneNormOf(contact.phone)) return null;
    const tenants = await this.prisma.tenant.findMany({
      where: { whiteLabelId, deletedAt: null },
      select: { id: true, email: true, phone: true, whatsappPhone: true },
    });
    const match = tenants.find(
      (t) =>
        (contact.phone &&
          (samePhone(t.whatsappPhone, contact.phone) || samePhone(t.phone, contact.phone))) ||
        (email && emailNormOf(t.email) === email),
    );
    return match?.id ?? null;
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
