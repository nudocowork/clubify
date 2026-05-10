import { Injectable, Logger } from '@nestjs/common';
import { StampAction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LEVEL_THRESHOLDS, levelFromXp } from './badges.service';

/**
 * XP que regala cada acción del scanner.
 * Pensado para que ~10 visitas suban a Plata y ~30 a Oro.
 */
const XP_PER_ACTION: Partial<Record<StampAction, number>> = {
  STAMP: 10,
  POINTS_ADD: 5,
  CASHBACK_ADD: 5,
  VISIT: 10,
  REDEEM: 50, // canjear un premio = mucho engagement
};

/**
 * Hook llamado tras cada Stamp creado. Procesa:
 *   1. XP → suma a customer.xpPoints
 *   2. Level → recalcula desde el nuevo total
 *   3. Streak → si scan == hoy y lastVisitDay == ayer → +1, sino reset a 1
 *   4. Badges automáticas (criteria.type) → otorga las que matcheen
 */
@Injectable()
export class GamificationService {
  private logger = new Logger(GamificationService.name);

  constructor(private prisma: PrismaService) {}

  async processStamp(opts: {
    customerId: string;
    tenantId: string;
    action: StampAction;
    cardId: string;
  }) {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: opts.customerId },
        select: {
          id: true,
          xpPoints: true,
          currentLevel: true,
          currentStreakDays: true,
          longestStreakDays: true,
          lastVisitDay: true,
          tenantId: true,
        },
      });
      if (!customer) return;

      // 1. XP
      const xpDelta = XP_PER_ACTION[opts.action] ?? 0;
      let newXp = customer.xpPoints + xpDelta;

      // 3. Streak: solo cuenta para acciones que demuestran visita real
      const streakActions: StampAction[] = ['STAMP', 'VISIT', 'POINTS_ADD', 'CASHBACK_ADD'];
      let newStreak = customer.currentStreakDays;
      let newLongest = customer.longestStreakDays;
      let newLastVisitDay = customer.lastVisitDay;
      if (streakActions.includes(opts.action)) {
        const today = new Date().toISOString().slice(0, 10);
        if (customer.lastVisitDay === today) {
          // mismo día — no cambia streak
        } else {
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
          if (customer.lastVisitDay === yesterday) {
            newStreak = customer.currentStreakDays + 1;
          } else {
            newStreak = 1;
          }
          if (newStreak > newLongest) newLongest = newStreak;
          newLastVisitDay = today;
        }
      }

      // 2. Level
      const newLevel = levelFromXp(newXp).level;
      const leveledUp = newLevel > customer.currentLevel;

      // 4. Badges automáticas — query criteria que matcheen
      const badges = await this.prisma.badge.findMany({
        where: { tenantId: opts.tenantId, isActive: true },
      });
      const earned = await this.prisma.customerBadge.findMany({
        where: { customerId: customer.id },
        select: { badgeId: true },
      });
      const earnedSet = new Set(earned.map((e) => e.badgeId));
      const candidateBadges = badges.filter((b) => !earnedSet.has(b.id));

      // Datos auxiliares para evaluar criteria (consultas mínimas).
      let scansTotal: number | null = null;
      let cardsCompleted: number | null = null;
      let cashbackEarned: number | null = null;
      const newlyAwarded: Array<{ id: string; xpReward: number; name: string; icon: string }> = [];

      for (const badge of candidateBadges) {
        const criteria = (badge.criteria as any) ?? {};
        const t = criteria.type as string;
        let match = false;
        if (t === 'FIRST_VISIT') {
          match = true; // primera vez en este hook
        } else if (t === 'STREAK_DAYS') {
          if (newStreak >= (criteria.threshold ?? 7)) match = true;
        } else if (t === 'SCANS_TOTAL') {
          if (scansTotal === null) {
            scansTotal = await this.prisma.stamp.count({
              where: { customerId: customer.id },
            });
          }
          if (scansTotal >= (criteria.threshold ?? 10)) match = true;
        } else if (t === 'CARDS_COMPLETED') {
          if (cardsCompleted === null) {
            cardsCompleted = await this.prisma.pass.count({
              where: { customerId: customer.id, status: 'COMPLETED' },
            });
          }
          if (cardsCompleted >= (criteria.threshold ?? 1)) match = true;
        } else if (t === 'CASHBACK_EARNED') {
          if (cashbackEarned === null) {
            const stamps = await this.prisma.stamp.findMany({
              where: { customerId: customer.id, action: 'CASHBACK_ADD' },
              select: { amount: true },
            });
            cashbackEarned = stamps.reduce((s, x) => s + Number(x.amount), 0);
          }
          if (cashbackEarned >= (criteria.threshold ?? 50000)) match = true;
        }
        // BIRTHDAY se otorga vía cron separado, no acá.
        // CUSTOM no se auto-otorga.
        if (match) {
          newlyAwarded.push({
            id: badge.id,
            xpReward: badge.xpReward ?? 0,
            name: badge.name,
            icon: badge.icon,
          });
          newXp += badge.xpReward ?? 0;
        }
      }

      const finalLevel = levelFromXp(newXp).level;

      await this.prisma.$transaction([
        this.prisma.customer.update({
          where: { id: customer.id },
          data: {
            xpPoints: newXp,
            currentLevel: finalLevel,
            currentStreakDays: newStreak,
            longestStreakDays: newLongest,
            lastVisitDay: newLastVisitDay,
          },
        }),
        ...newlyAwarded.map((b) =>
          this.prisma.customerBadge.create({
            data: { customerId: customer.id, badgeId: b.id },
          }),
        ),
      ]);

      return { xpDelta, leveledUp, newLevel: finalLevel, newStreak, newlyAwarded };
    } catch (e: any) {
      // No hacemos rollback de la stamp por error de gamification.
      this.logger.error(`processStamp failed: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Datos completos de gamificación de un cliente para mostrar en el panel. */
  async getCustomerGamification(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        xpPoints: true,
        currentLevel: true,
        currentStreakDays: true,
        longestStreakDays: true,
        lastVisitDay: true,
      },
    });
    if (!customer || customer.tenantId !== tenantId) return null;

    const tier = LEVEL_THRESHOLDS.find((l) => l.level === customer.currentLevel)
      ?? LEVEL_THRESHOLDS[0];
    const next = LEVEL_THRESHOLDS.find((l) => l.level === customer.currentLevel + 1);
    const xpToNext = next ? next.minXp - customer.xpPoints : 0;
    const xpInTier = customer.xpPoints - tier.minXp;
    const tierSpan = next ? next.minXp - tier.minXp : 1;
    const tierProgressPct = next
      ? Math.min(100, Math.round((xpInTier / tierSpan) * 100))
      : 100;

    const earned = await this.prisma.customerBadge.findMany({
      where: { customerId },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });

    // Ranking dentro del tenant (top 50 por XP)
    const top = await this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { xpPoints: 'desc' },
      take: 50,
      select: { id: true, xpPoints: true },
    });
    const rank =
      top.findIndex((c) => c.id === customerId) === -1
        ? null
        : top.findIndex((c) => c.id === customerId) + 1;

    return {
      level: customer.currentLevel,
      tier,
      nextTier: next ?? null,
      xpPoints: customer.xpPoints,
      xpToNext,
      tierProgressPct,
      currentStreak: customer.currentStreakDays,
      longestStreak: customer.longestStreakDays,
      lastVisitDay: customer.lastVisitDay,
      rank,
      badges: earned.map((e) => ({
        id: e.badge.id,
        name: e.badge.name,
        description: e.badge.description,
        icon: e.badge.icon,
        color: e.badge.color,
        earnedAt: e.earnedAt,
      })),
    };
  }

  /** Leaderboard top N del tenant. */
  async leaderboard(tenantId: string, limit = 10) {
    const top = await this.prisma.customer.findMany({
      where: { tenantId, xpPoints: { gt: 0 } },
      orderBy: { xpPoints: 'desc' },
      take: limit,
      select: {
        id: true,
        fullName: true,
        xpPoints: true,
        currentLevel: true,
        currentStreakDays: true,
      },
    });
    return top.map((c, i) => ({
      rank: i + 1,
      ...c,
      tier: LEVEL_THRESHOLDS.find((l) => l.level === c.currentLevel) ?? LEVEL_THRESHOLDS[0],
    }));
  }
}
