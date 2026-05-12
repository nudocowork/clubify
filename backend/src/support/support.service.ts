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

  /**
   * Import masivo de knowledge desde un documento de texto. Modos:
   *   - 'sections': splittea por headers Markdown "## " — cada sección
   *     se convierte en un KnowledgeEntry independiente. Title = la
   *     línea del header, content = el cuerpo hasta el próximo header.
   *   - 'paragraphs': splittea por doble salto de línea, usando la
   *     primera oración como título.
   *   - 'whole': crea UN solo KnowledgeEntry con todo el documento. Útil
   *     cuando el dueño tiene un brief largo y quiere subirlo entero.
   *
   * Todos los entries creados quedan en la misma categoría. Si el dueño
   * ya tenía entries con el mismo title, se updatean (upsert por title).
   * Devuelve los entries creados/actualizados.
   */
  async bulkImport(opts: {
    text: string;
    mode: 'sections' | 'paragraphs' | 'whole';
    category?: string;
  }) {
    const text = opts.text?.trim();
    if (!text) throw new BadRequestException('Documento vacío');
    if (text.length > 200_000) {
      throw new BadRequestException('Documento muy largo (máx 200k chars)');
    }
    const category = opts.category?.trim() || 'General';

    type Item = { title: string; content: string };
    const items: Item[] = [];

    if (opts.mode === 'whole') {
      items.push({
        title: text.split('\n')[0].slice(0, 200) || 'Documento importado',
        content: text,
      });
    } else if (opts.mode === 'sections') {
      // Splittea por "## " al inicio de línea. La primera parte (antes
      // del primer ##) se ignora si está vacía, o se incluye como
      // "Intro" si tiene contenido.
      const parts = text.split(/^##\s+/m).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) {
        throw new BadRequestException('No se encontró ningún "## Título"');
      }
      for (const part of parts) {
        const [firstLine, ...rest] = part.split('\n');
        const title = firstLine.replace(/^#+\s*/, '').trim().slice(0, 200);
        const content = rest.join('\n').trim();
        if (title && content) items.push({ title, content });
      }
    } else {
      // 'paragraphs'
      const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      for (const p of paragraphs) {
        // Primera oración como title (hasta 200 chars)
        const firstSentence = p.split(/[.!?\n]/)[0].trim();
        const title = firstSentence.slice(0, 200) || 'Sin título';
        if (p.length > 20) items.push({ title, content: p });
      }
    }

    if (items.length === 0) {
      throw new BadRequestException('Documento no produjo entries válidos');
    }

    // Upsert: si existe un entry con el mismo title, lo actualizamos.
    const results = await Promise.all(
      items.map(async (it) => {
        const existing = await this.prisma.knowledgeEntry.findFirst({
          where: { title: it.title, category },
        });
        if (existing) {
          return this.prisma.knowledgeEntry.update({
            where: { id: existing.id },
            data: { content: it.content, isActive: true },
          });
        }
        return this.prisma.knowledgeEntry.create({
          data: { title: it.title, content: it.content, category },
        });
      }),
    );

    return { count: results.length, entries: results };
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

    const [entries, masterPromptSetting] = await Promise.all([
      this.prisma.knowledgeEntry.findMany({
        where: { isActive: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.setting.findUnique({
        where: { key: 'support.masterPrompt' },
      }),
    ]);

    const knowledgeBlock =
      entries.length === 0
        ? '(El admin todavía no agregó knowledge — responde con info general de Clubify y aclara que pueden contactar al soporte.)'
        : entries
            .map(
              (e) =>
                `### ${e.category} — ${e.title}\n${e.content}`,
            )
            .join('\n\n');

    // Master prompt opcional editado por el admin desde /admin/ai-knowledge.
    // Se prepone al system prompt default para que pueda override tono,
    // estilo o agregar instrucciones específicas sin tocar código.
    const masterPrompt = masterPromptSetting?.value?.trim();
    const masterPromptBlock = masterPrompt
      ? `${masterPrompt}\n\n---\n\n`
      : '';

    const systemPrompt = `${masterPromptBlock}Eres el asistente virtual de Clubify (clubify.app), un SaaS para negocios locales en LATAM que ofrece:
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
