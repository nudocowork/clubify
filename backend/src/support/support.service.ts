import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { VoyageService } from './voyage.service';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

const MAX_HISTORY = 10;
const MODEL = 'claude-haiku-4-5-20251001';

@Injectable()
export class SupportService {
  private logger = new Logger(SupportService.name);
  private client: Anthropic | null;

  constructor(
    private prisma: PrismaService,
    private voyage: VoyageService,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY no configurado — el widget de IA responderá con un fallback estático',
      );
    }
  }

  // ---------------- Health / métricas ---------------- //

  /**
   * Estado del subsistema IA — usado por /admin/ai-knowledge header.
   * Incluye:
   *   - anthropic: si el modelo está configurado (key set)
   *   - voyage: si los embeddings están activos (key set)
   *   - counts: docs, entries, chunks, % con embedding por audience
   */
  async health() {
    const [
      totalDocs,
      docsReady,
      totalEntries,
      activeEntries,
      withEmbedding,
      byAudienceRaw,
    ] = await Promise.all([
      this.prisma.knowledgeDocument.count(),
      this.prisma.knowledgeDocument.count({ where: { status: 'READY' } }),
      this.prisma.knowledgeEntry.count(),
      this.prisma.knowledgeEntry.count({ where: { isActive: true } }),
      this.prisma.knowledgeEntry.count({
        where: { embedding: { not: Prisma.DbNull as any } },
      }),
      this.prisma.knowledgeEntry.groupBy({
        by: ['audience'],
        _count: { _all: true },
      }),
    ]);

    const byAudience: Record<string, number> = {};
    for (const row of byAudienceRaw) {
      byAudience[row.audience] = row._count._all;
    }

    return {
      anthropic: { configured: !!this.client, model: MODEL },
      voyage: {
        configured: this.voyage.isEnabled(),
        model: this.voyage.getModel(),
      },
      knowledge: {
        totalDocs,
        docsReady,
        totalEntries,
        activeEntries,
        withEmbedding,
        embeddingCoverage:
          totalEntries > 0
            ? Math.round((withEmbedding / totalEntries) * 100)
            : 0,
        byAudience,
      },
    };
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
      // Splittea por "## " al inicio de línea. El contenido ANTES del
      // primer "## " (si existe) se incluye como entry "Intro" porque
      // suele ser contexto importante del documento (descripción del
      // brief, instrucciones generales, etc.). Si está vacío se ignora.
      const hasLeadingH2 = /^##\s+/m.test(text.split('\n')[0]?.trim() ?? '');
      const parts = text.split(/^##\s+/m).map((p) => p.trim());
      // Si el primer split NO empieza con ##, parts[0] es el intro.
      const intro = !hasLeadingH2 ? parts.shift() ?? '' : '';
      const realParts = parts.filter(Boolean);
      if (intro && intro.length > 20) {
        // Sacar el primer # H1 si existe, usarlo como title, sino fallback.
        const firstLine = intro.split('\n')[0]?.replace(/^#+\s*/, '').trim();
        const titleFromH1 = firstLine && firstLine.length < 200 ? firstLine : 'Introducción';
        items.push({ title: titleFromH1, content: intro });
      }
      if (realParts.length === 0 && items.length === 0) {
        throw new BadRequestException('No se encontró ningún "## Título"');
      }
      for (const part of realParts) {
        const [firstLine, ...rest] = part.split('\n');
        const title = firstLine.replace(/^#+\s*/, '').trim().slice(0, 200);
        const content = rest.join('\n').trim();
        if (title && content) items.push({ title, content });
      }
    } else {
      // 'paragraphs' — title = primera oración. Para evitar que dos
      // párrafos con la misma frase inicial colisionen y se pierda uno,
      // contamos repetidos en memoria y le agregamos sufijo " (N)" al
      // title de los duplicados.
      const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const titleCounts = new Map<string, number>();
      for (const p of paragraphs) {
        if (p.length <= 20) continue;
        const firstSentence = p.split(/[.!?\n]/)[0].trim();
        let title = firstSentence.slice(0, 196) || 'Sin título';
        const seen = titleCounts.get(title) ?? 0;
        if (seen > 0) title = `${title} (${seen + 1})`;
        titleCounts.set(firstSentence.slice(0, 196) || 'Sin título', seen + 1);
        items.push({ title, content: p });
      }
    }

    if (items.length === 0) {
      throw new BadRequestException('Documento no produjo entries válidos');
    }

    // Upsert SERIAL (no Promise.all) — sino dos items con mismo title
    // ejecutan findFirst en paralelo, no ven el create del otro y dejan
    // 2 rows. Con el bucle for+await la consistencia se garantiza.
    const results = [] as Awaited<
      ReturnType<typeof this.prisma.knowledgeEntry.create>
    >[];
    for (const it of items) {
      const existing = await this.prisma.knowledgeEntry.findFirst({
        where: { title: it.title, category },
      });
      const row = existing
        ? await this.prisma.knowledgeEntry.update({
            where: { id: existing.id },
            data: { content: it.content, isActive: true },
          })
        : await this.prisma.knowledgeEntry.create({
            data: { title: it.title, content: it.content, category },
          });
      results.push(row);
    }

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
    audience: 'tenant' | 'affiliate' = 'tenant',
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

    // Filtrar knowledge por audience: TENANT/AFFILIATE/BOTH. La audience
    // del request pide la propia + BOTH (knowledge "compartida").
    const audienceFilter: ('TENANT' | 'AFFILIATE' | 'BOTH')[] =
      audience === 'affiliate'
        ? ['AFFILIATE', 'BOTH']
        : ['TENANT', 'BOTH'];

    // El master prompt es por audience: cada panel (tenant vs affiliate)
    // puede tener un texto distinto editable por el admin. Fallback al
    // default `support.masterPrompt` para retro-compat con el flujo legacy.
    const masterKey = `support.masterPrompt.${audience}`;
    const [entries, masterPromptSetting, masterPromptLegacy] =
      await Promise.all([
        this.prisma.knowledgeEntry.findMany({
          where: {
            isActive: true,
            audience: { in: audienceFilter as any },
          },
          orderBy: { category: 'asc' },
        }),
        this.prisma.setting.findUnique({ where: { key: masterKey } }),
        audience === 'tenant'
          ? this.prisma.setting.findUnique({
              where: { key: 'support.masterPrompt' },
            })
          : Promise.resolve(null),
      ]);

    // Retrieval semántico top-K cuando hay embeddings disponibles:
    //   1. Embebemos la pregunta con Voyage (input_type=query)
    //   2. Cosine similarity contra cada chunk con embedding
    //   3. Top 8 chunks (con threshold mínimo para evitar ruido)
    // Si no hay Voyage o ninguna entry tiene embedding, usamos las entries
    // tal cual concatenadas (modo lexical, retro-compat con sistema viejo).
    let activeEntries = entries;
    if (this.voyage.isEnabled() && entries.some((e) => e.embedding)) {
      const qVec = await this.voyage.embedOne(q, 'query');
      if (qVec) {
        const scored = entries
          .map((e) => {
            const vec = e.embedding as unknown as number[] | null;
            if (!vec || !Array.isArray(vec)) return { e, score: -1 };
            return { e, score: VoyageService.cosineSimilarity(qVec, vec) };
          })
          .filter((x) => x.score > 0.18)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        if (scored.length > 0) {
          activeEntries = scored.map((s) => s.e);
        }
      }
    }

    const knowledgeBlock =
      activeEntries.length === 0
        ? '(El admin todavía no agregó knowledge — responde con info general de Clubify y aclara que pueden contactar al soporte.)'
        : activeEntries
            .map(
              (e) =>
                `### ${e.category} — ${e.title}\n${e.content}`,
            )
            .join('\n\n');

    const masterPrompt = (
      masterPromptSetting?.value?.trim() ||
      masterPromptLegacy?.value?.trim() ||
      ''
    );
    const masterPromptBlock = masterPrompt
      ? `${masterPrompt}\n\n---\n\n`
      : '';

    const systemPrompt =
      audience === 'affiliate'
        ? `${masterPromptBlock}Eres el MENTOR DE VENTAS para afiliados de Clubify (influencers y embajadores) — un SaaS LATAM para negocios locales (cafeterías, restaurantes, barberías, gimnasios, autolavados, etc.) que ofrece pedidos por WhatsApp, fidelización en Apple/Google Wallet, automatizaciones, CRM y analítica.

Tu misión: ayudar a los afiliados a VENDER MÁS Clubify. Específicamente:
- Generar scripts de venta personalizados (primera llamada, mensaje frío, follow-up)
- Manejar objeciones (precio, tiempo, "ya tengo algo similar", "no es para mi negocio")
- Generar copies para WhatsApp e Instagram (Stories, posts, reels)
- Estrategias de prospección por rubro
- Cómo cerrar clientes y pedir referidos
- Cómo mostrar el ROI de Clubify (un cliente que vuelve más cubre 6 meses de Clubify)

Tono: motivador, directo, español neutro LATAM con preferencia colombiana (NO uses voseo argentino: di "puedes", no "podés"; "ingresa", no "ingresá"; "comparte", no "compartí"). Respuestas accionables: si te piden un script, dáselo listo para copiar — no expliques abstractamente. Si te piden manejo de objeción, di la frase exacta. Usa ejemplos concretos.

Cuando generes mensajes para WhatsApp/IG, incluye el link del afiliado donde corresponda (placeholder: [TU_LINK]).

Esta es la base de conocimiento del producto (úsala para detalles técnicos cuando el afiliado necesita info concreta para vender):

${knowledgeBlock}

Si la pregunta es totalmente off-topic (cocinar pasta, etc.), redirigí amablemente al objetivo: vender Clubify.`
        : `${masterPromptBlock}Eres el asistente virtual de Clubify (clubify.app), un SaaS para negocios locales en LATAM que ofrece:
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
