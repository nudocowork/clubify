import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma/prisma.service';

// Fase 2 i18n menú: traducción on-the-fly del contenido dinámico
// (categorías, productos, variantes, extras) con cache en DB. Modelo:
//   1. Por cada locale solicitado, se hace una sola query a la cache
//      filtrando por (tenantId, locale) y los IDs de entidades visibles.
//   2. Items con sourceText idéntico al actual = HIT. Si source='manual',
//      respetar siempre (override admin, Fase 4).
//   3. Los MISS se mandan en UNA sola llamada a Claude Haiku como lista
//      numerada para minimizar overhead. La respuesta se parsea y se
//      upsertea en la cache.
//   4. Si Claude falla o no hay API key, devolvemos el sourceText
//      original. Política: NUNCA campos vacíos.

// Locales públicos que el sistema sabe servir. ES es la fuente canónica
// (identidad). Cualquier valor fuera del set se normaliza a 'es' para
// que el resto del código pueda asumir un valor válido.
export const SUPPORTED_PUBLIC_LOCALES = ['es', 'en', 'pt'] as const;
export type PublicLocale = (typeof SUPPORTED_PUBLIC_LOCALES)[number];

export function normalizeLocale(raw?: string | null): PublicLocale {
  return raw && (SUPPORTED_PUBLIC_LOCALES as readonly string[]).includes(raw)
    ? (raw as PublicLocale)
    : 'es';
}

// Sets exportados para validación runtime en endpoints admin. Los
// mantenemos sincronizados con los union types de TranslatableItem.
export const TRANSLATABLE_ENTITY_TYPES = [
  'category',
  'product',
  'variant',
  'extra',
  'promotion',
  'storefront',
  'infolink',
  'card',
] as const;
export type TranslatableEntityType = (typeof TRANSLATABLE_ENTITY_TYPES)[number];

export const TRANSLATABLE_FIELDS = [
  'name',
  'description',
  'tagline',
  'groupName',
  'title',
  'subtitle',
  'rewardText',
  'businessName',
] as const;
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];

export type TranslatableItem = {
  entityType: TranslatableEntityType;
  entityId: string;
  field: TranslatableField;
  text: string;
};

const MODEL = 'claude-haiku-4-5-20251001';

@Injectable()
export class TranslationService {
  private logger = new Logger(TranslationService.name);
  private client: Anthropic | null;

  constructor(private prisma: PrismaService) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY no configurado — traducciones de menú usarán fallback al texto original',
      );
    }
  }

  /**
   * Traduce un batch de strings del menú para un tenant. Devuelve un Map
   * `${entityType}:${entityId}:${field}` → texto traducido. Si para
   * algún ítem no hay traducción posible, devuelve el sourceText.
   *
   * `locale='es'` es identidad (devuelve el sourceText) y NO toca cache
   * ni llama a Claude.
   */
  async translateMenuBatch(
    tenantId: string,
    items: TranslatableItem[],
    locale: string,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    // Filtrar items vacíos / null arriba — nunca llamamos a Claude con basura.
    const valid = items.filter((it) => it.text && it.text.trim().length > 0);

    // ES = idioma fuente (canónico). Identidad, no hay traducción.
    if (locale === 'es' || locale === 'es-CO' || locale === 'es-MX') {
      for (const it of valid) {
        result.set(`${it.entityType}:${it.entityId}:${it.field}`, it.text);
      }
      return result;
    }

    if (valid.length === 0) return result;

    // 1. Cache lookup. `OR` por cada item es lo más específico, pero la
    //    matriz puede ser grande; con un menú de 200 ítems serían 200 OR
    //    clauses. Postgres lo maneja, y los índices (tenantId, locale)
    //    hacen el filtro rápido. Si crece más, conviene cambiar a IN
    //    sobre un compuesto.
    const cached = await this.prisma.menuTranslation.findMany({
      where: {
        tenantId,
        locale,
        OR: valid.map((it) => ({
          entityType: it.entityType,
          entityId: it.entityId,
          field: it.field,
        })),
      },
    });

    const cachedByKey = new Map<string, (typeof cached)[number]>();
    for (const c of cached) {
      cachedByKey.set(`${c.entityType}:${c.entityId}:${c.field}`, c);
    }

    const toTranslate: Array<{ key: string; text: string; item: TranslatableItem }> = [];

    for (const it of valid) {
      const key = `${it.entityType}:${it.entityId}:${it.field}`;
      const hit = cachedByKey.get(key);
      if (hit?.source === 'manual') {
        // Override admin — siempre respetar.
        result.set(key, hit.text);
      } else if (hit && hit.sourceText === it.text) {
        // Cache válida (texto fuente no cambió).
        result.set(key, hit.text);
      } else {
        toTranslate.push({ key, text: it.text, item: it });
      }
    }

    // 2. Llamar a Claude para los misses.
    if (toTranslate.length > 0 && this.client) {
      try {
        const translations = await this.callClaudeBatch(
          toTranslate.map((x) => ({ key: x.key, text: x.text })),
          locale,
        );
        // 3. Persistir + completar el result map. Limitamos concurrencia
        //    para no saturar el pool de Prisma (default 10 conexiones):
        //    si un tenant grande genera 200 misses, los 200 upserts
        //    paralelos starvean cualquier otro request al backend.
        //    Chunks de 8 dejan margen para tráfico simultáneo.
        const originalByKey = new Map(
          toTranslate.map((x) => [x.key, x] as const),
        );
        const UPSERT_CHUNK = 8;
        for (let i = 0; i < translations.length; i += UPSERT_CHUNK) {
          const chunk = translations.slice(i, i + UPSERT_CHUNK);
          await Promise.all(
            chunk.map(async (tr) => {
              const original = originalByKey.get(tr.key);
              if (!original) return;
              const [entityType, entityId, field] = tr.key.split(':');
              try {
                await this.prisma.menuTranslation.upsert({
                  where: {
                    tenantId_entityType_entityId_field_locale: {
                      tenantId,
                      entityType,
                      entityId,
                      field,
                      locale,
                    },
                  },
                  update: {
                    text: tr.text,
                    sourceText: original.text,
                    source: 'auto',
                  },
                  create: {
                    tenantId,
                    entityType,
                    entityId,
                    field,
                    locale,
                    text: tr.text,
                    sourceText: original.text,
                    source: 'auto',
                  },
                });
              } catch (e: any) {
                this.logger.warn(
                  `Failed to upsert translation ${tr.key} (${locale}): ${e?.message}`,
                );
              }
              result.set(tr.key, tr.text);
            }),
          );
        }
      } catch (e: any) {
        this.logger.error(
          `Claude batch failed (tenant=${tenantId}, locale=${locale}): ${e?.message ?? e}`,
        );
        // Fallback al sourceText en el siguiente paso.
      }
    }

    // 4. Fallback final: cualquier item sin traducir devuelve el original.
    //    Nunca campos vacíos.
    for (const it of valid) {
      const key = `${it.entityType}:${it.entityId}:${it.field}`;
      if (!result.has(key)) result.set(key, it.text);
    }

    return result;
  }

  /**
   * Una sola llamada a Claude Haiku con todos los strings del menú
   * formateados como lista numerada. Más eficiente que N llamadas
   * (menos roundtrip, mejor uso de contexto).
   */
  private async callClaudeBatch(
    items: Array<{ key: string; text: string }>,
    locale: string,
  ): Promise<Array<{ key: string; text: string }>> {
    if (!this.client || items.length === 0) return [];
    const target =
      locale === 'en'
        ? 'English (US, neutral)'
        : locale === 'pt'
          ? 'Brazilian Portuguese'
          : locale;

    const numbered = items.map((it, i) => `${i + 1}. ${it.text}`).join('\n');

    const system = `You translate restaurant / cafe / retail menu content from Spanish to ${target}.

Rules:
- Translate ONLY the meaning. Keep it natural, concise, and idiomatic for a menu / mobile UI.
- Preserve emojis, special characters, currencies, and ALL line numbering "N. " prefixes exactly.
- Proper names of dishes (e.g. "Empanada Salteña", "Açaí") and brand names stay as-is unless there's an obvious target-locale equivalent.
- Do NOT wrap translations in quotes.
- Do NOT add notes, explanations, headers, or any extra text. Output the numbered list and nothing else.
- One translation per input line. Same count of lines in, same count of lines out.`;

    const resp = await this.client.messages.create(
      {
        model: MODEL,
        max_tokens: Math.min(4000, 200 + items.length * 60),
        system,
        messages: [{ role: 'user', content: numbered }],
      },
      // Timeout duro + sin retries: si Anthropic se cuelga, fallamos
      // rápido y el caller hace fallback al sourceText (ES). El default
      // del SDK (timeout 10min, 2 retries) podía colgar un request
      // público al menú por minutos. Próximo request al menú re-intenta
      // la cache miss sin esperar aquí.
      { timeout: 8000, maxRetries: 0 },
    );

    const raw = resp.content
      .map((c: any) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim();

    const parsed: Array<{ key: string; text: string }> = [];
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(\d+)\.\s*(.+?)\s*$/);
      if (!m) continue;
      const idx = parseInt(m[1], 10) - 1;
      if (idx < 0 || idx >= items.length) continue;
      const text = m[2];
      if (!text) continue;
      parsed.push({ key: items[idx].key, text });
    }

    return parsed;
  }
}
