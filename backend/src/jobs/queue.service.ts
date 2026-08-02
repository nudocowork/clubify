import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, JobsOptions, ConnectionOptions } from 'bullmq';

export type JobName =
  | 'wallet.push'
  | 'email.send'
  | 'cleanup.expired_passes'
  // F2: secuencias / automatizaciones del CRM. process_step ejecuta UN
  // step del enrollment (con delay si está programado). start_enrollment
  // crea el enrollment y encola el primer step.
  | 'sequence.process_step'
  | 'sequence.start_enrollment'
  // F3: ejecutar un CrmButton con delaySeconds > 0. El worker llama
  // executeButtonImmediate después del delay.
  | 'crm.execute_button_delayed'
  // Fase D onboarding: entrega durable del webhook business.activated con
  // reintentos 1min/10min/1h (self-reschedule). Sobrevive reinicios.
  | 'onboarding.webhook';

type JobPayload = Record<string, any>;

/**
 * BullMQ wrapper. Si no hay REDIS_URL, queda en modo "stub":
 *  - enqueue() loguea pero no encola
 *  - los workers no se inician
 *
 * Cuando se configura REDIS_URL, todo se enchufa automáticamente.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(QueueService.name);
  private queues = new Map<JobName, Queue>();
  private workers = new Map<JobName, Worker>();
  private connection: ConnectionOptions | null = null;
  // Handlers registrados, también en modo stub. Sin Redis, los jobs SIN delay
  // (wallet.push, email.send) se ejecutan inline acá en vez de descartarse —
  // sino el wallet nunca se refrescaba al cambiar logo/branding (2026-06-15).
  private stubHandlers = new Map<
    JobName,
    (data: JobPayload) => Promise<void>
  >();

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL no configurado — modo stub (jobs no persistentes)');
      return;
    }
    try {
      this.connection = this.parseRedisUrl(url);
      this.logger.log(`BullMQ habilitado contra ${url.replace(/:[^:@]+@/, ':***@')}`);
    } catch (e) {
      this.logger.error(`No se pudo configurar Redis: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await Promise.all([
      ...Array.from(this.workers.values()).map((w) => w.close()),
      ...Array.from(this.queues.values()).map((q) => q.close()),
    ]);
  }

  private parseRedisUrl(url: string): ConnectionOptions {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
      ...(u.protocol === 'rediss:' ? { tls: {} as any } : {}),
    };
  }

  /** Encola un job. En modo stub sólo loguea. */
  async enqueue(name: JobName, payload: JobPayload, opts: JobsOptions = {}) {
    if (!this.connection) {
      // Sin Redis: en vez de descartar, ejecutamos inline los jobs SIN delay
      // (immediate) si hay un handler registrado. Fire-and-forget para no
      // bloquear al caller. Los jobs con delay (secuencias programadas) NO se
      // ejecutan inline — quedan como antes (no hay scheduler en stub).
      const handler = this.stubHandlers.get(name);
      if (handler && !opts.delay) {
        this.logger.log(`[stub] ejecutando inline ${name}`);
        handler(payload).catch((e) =>
          this.logger.warn(
            `[stub] ${name} inline falló: ${(e as Error).message}`,
          ),
        );
      } else {
        this.logger.log(`[stub] enqueue ${name} ${JSON.stringify(payload)}`);
      }
      return null;
    }
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q.add(name, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...opts,
    });
  }

  /**
   * Cancela un job ya encolado (no ejecutado). Útil para pausar/cancelar
   * un SequenceEnrollment: queda guardado el jobId en DB y al pausar lo
   * removemos para que el delay no dispare más. En modo stub no-op.
   */
  async removeJob(name: JobName, jobId: string): Promise<boolean> {
    if (!this.connection) return false;
    const q = this.queues.get(name);
    if (!q) return false;
    try {
      const job = await q.getJob(jobId);
      if (!job) return false;
      await job.remove();
      return true;
    } catch (e) {
      this.logger.warn(
        `removeJob(${name}, ${jobId}) falló: ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Registra un worker para procesar un tipo de job.
   * Si no hay Redis, no hace nada (modo stub).
   */
  registerWorker(
    name: JobName,
    handler: (data: JobPayload) => Promise<void>,
  ) {
    if (!this.connection) {
      // Guardamos el handler para poder ejecutarlo inline desde enqueue()
      // (jobs immediate sin delay). Sin esto el wallet.push se perdía.
      this.stubHandlers.set(name, handler);
      this.logger.log(`[stub] handler registrado inline para ${name}`);
      return;
    }
    if (this.workers.has(name)) return;
    const w = new Worker(
      name,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection, concurrency: 5 },
    );
    w.on('completed', (job) =>
      this.logger.debug(`✓ ${name} ${job.id}`),
    );
    w.on('failed', (job, err) =>
      this.logger.warn(`✗ ${name} ${job?.id} ${err.message}`),
    );
    this.workers.set(name, w);
    this.logger.log(`worker iniciado: ${name}`);
  }
}
