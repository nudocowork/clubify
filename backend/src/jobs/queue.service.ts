import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, JobsOptions, ConnectionOptions } from 'bullmq';

export type JobName = 'wallet.push' | 'email.send' | 'cleanup.expired_passes';

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
      this.logger.log(`[stub] enqueue ${name} ${JSON.stringify(payload)}`);
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
   * Registra un worker para procesar un tipo de job.
   * Si no hay Redis, no hace nada (modo stub).
   */
  registerWorker(
    name: JobName,
    handler: (data: JobPayload) => Promise<void>,
  ) {
    if (!this.connection) {
      this.logger.log(`[stub] worker no iniciado para ${name}`);
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
