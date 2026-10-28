import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

// Origen comercial deducido del identificador de suscripción. Es la MISMA regla
// que `cobroDe` del reporte por empresa (referrals.service): si cambia allá, cambia
// aquí. Cortesías, pruebas y negocios de sistema se devuelven con su condición, no
// como clientes de pago.
export function condicionComercial(code: string | null | undefined): string {
  const c = (code ?? '').trim();
  if (!c) return 'SIN_COBRO';
  if (/^trial-/i.test(c)) return 'TRIAL';
  if (/^comp-/i.test(c)) return 'CORTESIA';
  if (/^(campaign-|sim-)/i.test(c)) return 'SISTEMA';
  if (/^manual-/i.test(c)) return 'MANUAL';
  if (/^wl-/i.test(c)) return 'MARCA_BLANCA';
  return 'HOTMART';
}

/**
 * Lista de negocios para las fichas de Team Soporte (TeamClubify). SOLO LECTURA y
 * exposición mínima: datos de contacto, plan, fechas y origen comercial. Sin montos,
 * comisiones, tokens ni notas internas: soporte no los necesita y programación no
 * debe verlos.
 */
@Injectable()
export class SupportIntegrationService {
  constructor(private prisma: PrismaService) {}

  async businesses() {
    const tenants = await this.prisma.tenant.findMany({
      // Retirados (fusiones de duplicados) y el negocio de sistema de campañas no
      // son clientes: quedan fuera. Todo lo demás entra con su estado.
      where: { deletedAt: null, isCampaignHost: false },
      select: {
        id: true,
        name: true,
        brandName: true,
        slug: true,
        status: true,
        createdAt: true,
        purchasedAt: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        hotmartSubscriberCode: true,
        country: true,
        phone: true,
        whatsappPhone: true,
        email: true,
        plan: { select: { name: true } },
        whiteLabel: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const ids = tenants.map((t) => t.id);

    // Dueño: el TENANT_OWNER activo más antiguo (puede haber varios tras una fusión).
    const owners = await this.prisma.user.findMany({
      where: { tenantId: { in: ids }, role: 'TENANT_OWNER', isActive: true },
      select: { tenantId: true, fullName: true, phone: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    const ownerOf = new Map<string, (typeof owners)[number]>();
    for (const o of owners) if (o.tenantId && !ownerOf.has(o.tenantId)) ownerOf.set(o.tenantId, o);

    // Afiliado o closer que lo vendió: la atribución más reciente del negocio.
    const uses = await this.prisma.referralUse.findMany({
      where: { tenantId: { in: ids } },
      select: { tenantId: true, referralCode: { select: { code: true, ownerName: true, role: true, ownerUserId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const codeOf = new Map<string, (typeof uses)[number]['referralCode']>();
    for (const u of uses) if (u.tenantId && u.referralCode && !codeOf.has(u.tenantId)) codeOf.set(u.tenantId, u.referralCode);

    // Equipo comercial de origen: SOLO si el dueño del código pertenece a UN equipo
    // de ventas activo. Con cero o varios equipos no hay certeza → null, y Team
    // Soporte lo muestra «Por identificar». El vínculo manual negocio↔equipo
    // (SalesTeamSale) NO se usa como fuente: lo pone una persona y no se verifica.
    const ownerUserIds = [...new Set([...codeOf.values()].map((c) => c?.ownerUserId).filter(Boolean) as string[])];
    const memberships = ownerUserIds.length
      ? await this.prisma.salesTeamMember.findMany({
          where: { userId: { in: ownerUserIds }, isActive: true, team: { isActive: true } },
          select: { userId: true, team: { select: { id: true, name: true } } },
        })
      : [];
    const teamsOf = new Map<string, Map<string, string>>();
    for (const m of memberships) {
      const t = teamsOf.get(m.userId) ?? new Map<string, string>();
      t.set(m.team.id, m.team.name);
      teamsOf.set(m.userId, t);
    }

    return {
      generatedAt: new Date().toISOString(),
      count: tenants.length,
      businesses: tenants.map((t) => {
        const o = ownerOf.get(t.id);
        const c = codeOf.get(t.id);
        const teams = c?.ownerUserId ? teamsOf.get(c.ownerUserId) : undefined;
        const team = teams && teams.size === 1 ? [...teams.entries()][0] : null;
        return {
          id: t.id,
          name: t.brandName || t.name,
          slug: t.slug,
          status: t.status,
          createdAt: t.createdAt,
          purchasedAt: t.purchasedAt,
          renewalAt: t.currentPeriodEnd,
          lastChargeAt: t.lastChargeAt,
          planName: t.plan?.name ?? null,
          periodicity: t.planPeriodicity,
          condition: condicionComercial(t.hotmartSubscriberCode),
          whiteLabel: t.whiteLabel ? { id: t.whiteLabel.id, name: t.whiteLabel.name } : null,
          country: t.country,
          phone: t.phone,
          whatsapp: t.whatsappPhone,
          email: t.email,
          owner: o ? { name: o.fullName, phone: o.phone, email: o.email } : null,
          affiliate: c ? { code: c.code, name: c.ownerName, role: c.role } : null,
          originTeam: team ? { id: team[0], name: team[1], via: 'afiliado' } : null,
        };
      }),
    };
  }
}
