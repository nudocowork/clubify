import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderRecurrence } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';

export type CreateReminderDto = {
  employeeId?: string | null;
  employeeName: string;
  employeePhone: string;
  recurrence: ReminderRecurrence;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  timeOfDay: string;
  message: string;
};

export type UpdateReminderDto = Partial<CreateReminderDto> & {
  isActive?: boolean;
};

@Injectable()
export class RemindersService {
  private logger = new Logger('Reminders');

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  list(tenantId: string) {
    return this.prisma.reminder.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(tenantId: string, dto: CreateReminderDto) {
    return this.prisma.reminder.create({
      data: {
        tenantId,
        employeeId: dto.employeeId || null,
        employeeName: dto.employeeName.trim(),
        employeePhone: dto.employeePhone.trim(),
        recurrence: dto.recurrence,
        dayOfWeek: dto.recurrence === 'WEEKLY' ? dto.dayOfWeek ?? 1 : null,
        dayOfMonth: dto.recurrence === 'MONTHLY' ? dto.dayOfMonth ?? 1 : null,
        timeOfDay: dto.timeOfDay || '09:00',
        message: dto.message,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateReminderDto) {
    const existing = await this.prisma.reminder.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException();

    const recurrence = dto.recurrence ?? existing.recurrence;
    return this.prisma.reminder.update({
      where: { id },
      data: {
        employeeId: dto.employeeId !== undefined ? dto.employeeId : existing.employeeId,
        employeeName: dto.employeeName?.trim() ?? existing.employeeName,
        employeePhone: dto.employeePhone?.trim() ?? existing.employeePhone,
        recurrence,
        dayOfWeek: recurrence === 'WEEKLY' ? (dto.dayOfWeek ?? existing.dayOfWeek ?? 1) : null,
        dayOfMonth: recurrence === 'MONTHLY' ? (dto.dayOfMonth ?? existing.dayOfMonth ?? 1) : null,
        timeOfDay: dto.timeOfDay ?? existing.timeOfDay,
        message: dto.message ?? existing.message,
        isActive: dto.isActive ?? existing.isActive,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.reminder.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException();
    await this.prisma.reminder.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Envía un recordatorio inmediatamente (botón "Enviar mensaje" en la UI),
   * sin afectar el schedule ni `lastSentAt` del recurrente.
   */
  async sendOneOff(
    tenantId: string,
    body: { phone: string; message: string },
  ) {
    if (!body.phone || !body.message) {
      throw new NotFoundException('phone y message obligatorios');
    }
    const r = await this.growBusiness.sendSms(
      tenantId,
      body.phone,
      body.message,
    );
    return r;
  }

  /**
   * Cron diario a las 8am (zona del server). Evalúa cada recordatorio
   * activo y dispara los que correspondan a HOY según su recurrencia.
   * Idempotente: usa lastSentAt comparado contra la "ventana del día".
   */
  @Cron('0 0 8 * * *')
  async dailyTick() {
    const sent = await this.runDailyTick();
    if (sent > 0) {
      this.logger.log(`Reminders enviados hoy: ${sent}`);
    }
  }

  async runDailyTick(now: Date = new Date()) {
    const reminders = await this.prisma.reminder.findMany({
      where: { isActive: true },
    });

    const dow = now.getDay(); // 0=Sun
    const dom = now.getDate();
    let sent = 0;

    for (const r of reminders) {
      const matches =
        r.recurrence === 'DAILY' ||
        (r.recurrence === 'WEEKLY' && r.dayOfWeek === dow) ||
        (r.recurrence === 'MONTHLY' && r.dayOfMonth === dom);
      if (!matches) continue;

      // Idempotencia: si ya se envió hoy, saltear
      if (r.lastSentAt && sameDay(r.lastSentAt, now)) continue;

      try {
        await this.growBusiness.sendSms(
          r.tenantId,
          r.employeePhone,
          r.message,
        );
        await this.prisma.reminder.update({
          where: { id: r.id },
          data: { lastSentAt: now },
        });
        sent++;
      } catch (e) {
        this.logger.warn(
          `Reminder ${r.id} fallo envío a ${r.employeePhone}: ${
            (e as Error).message
          }`,
        );
      }
    }
    return sent;
  }
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
