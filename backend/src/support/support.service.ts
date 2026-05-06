import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma/prisma.service';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

const MAX_HISTORY = 10;
const MODEL = 'claude-haiku-4-5-20251001';

@Injectable()
export class SupportService {
  private logger = new Logger(SupportService.name);
  private client: Anthropic | null;

  constructor(private prisma: PrismaService) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY no configurado — el widget de IA responderá con un fallback estático',
      );
    }
  }

  // ---------------- Knowledge CRUD (admin) ---------------- //

  list() {
    return this.prisma.knowledgeEntry.findMany({
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    });
  }

  create(data: { title: string; content: string; category?: string }) {
    return this.prisma.knowledgeEntry.create({
      data: {
        title: data.title.trim(),
        content: data.content.trim(),
        category: data.category?.trim() || 'General',
      },
    });
  }

  update(
    id: string,
    data: Partial<{
      title: string;
      content: string;
      category: string;
      isActive: boolean;
    }>,
  ) {
    return this.prisma.knowledgeEntry.update({
      where: { id },
      data: {
        title: data.title?.trim(),
        content: data.content?.trim(),
        category: data.category?.trim() || undefined,
        isActive: data.isActive,
      },
    });
  }

  remove(id: string) {
    return this.prisma.knowledgeEntry.delete({ where: { id } });
  }

  // ---------------- Ask (cliente del widget) ---------------- //

  async ask(
    question: string,
    history: ChatMessage[] = [],
  ): Promise<{ reply: string }> {
    const q = question?.trim();
    if (!q) throw new BadRequestException('Pregunta vacía');
    if (q.length > 1000)
      throw new BadRequestException('Pregunta muy larga (máx 1000 caracteres)');

    if (!this.client) {
      return {
        reply:
          'El asistente IA no está configurado todavía. Contacta al equipo de Clubify por WhatsApp para resolver tus dudas.',
      };
    }

    const entries = await this.prisma.knowledgeEntry.findMany({
      where: { isActive: true },
      orderBy: { category: 'asc' },
    });

    const knowledgeBlock =
      entries.length === 0
        ? '(El admin todavía no agregó knowledge — responde con info general de Clubify y aclara que pueden contactar al soporte.)'
        : entries
            .map(
              (e) =>
                `### ${e.category} — ${e.title}\n${e.content}`,
            )
            .join('\n\n');

    const systemPrompt = `Eres el asistente virtual de Clubify (clubify.app), un SaaS para negocios locales en LATAM que ofrece:
- Tarjetas de fidelización digitales (Apple Wallet + Google Wallet)
- Menú digital, pedidos online y delivery
- WhatsApp y push notifications
- Multi-rubro: cafeterías, autolavados, barberías, gimnasios, etc.

Tono: cercano, español neutro LATAM (no acento argentino ni español de España). Sé breve (1-3 párrafos máximo). No uses bullet lists largos. No inventes funciones que no existan.

Si no sabes la respuesta concreta, sugiere contactar al soporte humano por WhatsApp y di que el equipo responde rápido.

Esta es la base de conocimiento curada por el equipo:

${knowledgeBlock}

Si la pregunta del usuario no se relaciona con Clubify (ej. cómo cocinar pasta), redirige amablemente: solo respondes cosas de Clubify.`;

    const messages = [
      ...history
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: q },
    ];

    try {
      const resp = await this.client.messages.create({
        model: MODEL,
        max_tokens: 600,
        system: systemPrompt,
        messages,
      });
      const text = resp.content
        .map((c: any) => (c.type === 'text' ? c.text : ''))
        .join('')
        .trim();
      return {
        reply:
          text ||
          'No pude generar una respuesta ahora. Intenta de nuevo en unos segundos.',
      };
    } catch (e: any) {
      this.logger.error(`Anthropic error: ${e?.message ?? e}`);
      throw new ServiceUnavailableException(
        'El asistente está saturado. Intenta de nuevo en unos minutos.',
      );
    }
  }
}
