import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente de embeddings Voyage AI (voyage-3-large, 1024 dims).
 *
 * Se activa cuando `VOYAGE_API_KEY` está seteada. Si no, `embed()` devuelve
 * `null` y el SupportService cae al retrieval lexical (concat de entries
 * filtradas por audience). Esto permite desplegar Fase 5 sin esperar la
 * key — el sistema sigue funcionando con audience filter, y al activar
 * Voyage se "upgrade-a" automáticamente al retrieval semántico top-K.
 *
 * Modelo default: voyage-3-large (1024 dims, multilingüe nativo ES, muy
 * buena calidad para retrieval). Costo: ~$0.18/1M tokens (input).
 *
 * Docs: https://docs.voyageai.com/reference/embeddings-api
 */
@Injectable()
export class VoyageService {
  private logger = new Logger(VoyageService.name);
  private apiKey: string | undefined;
  private model: string;
  private endpoint = 'https://api.voyageai.com/v1/embeddings';

  constructor() {
    this.apiKey = process.env.VOYAGE_API_KEY?.trim() || undefined;
    this.model = process.env.VOYAGE_EMBED_MODEL?.trim() || 'voyage-3-large';
    if (!this.apiKey) {
      this.logger.warn(
        'VOYAGE_API_KEY no configurada → retrieval semántico deshabilitado, fallback a lexical.',
      );
    }
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Embebe una lista de textos (max 128 items por request, recomendado 32).
   * Devuelve array paralelo de vectores; cada vector es number[].
   *
   * Si la key no está, devuelve null (no throw — el caller debe manejarlo).
   *
   * `inputType`:
   *   - "document" cuando indexás (texto de la KB)
   *   - "query"    cuando consultás (pregunta del usuario)
   * Voyage usa esta hint para optimizar la representación.
   */
  async embed(
    texts: string[],
    inputType: 'document' | 'query' = 'document',
  ): Promise<number[][] | null> {
    if (!this.apiKey) return null;
    if (!texts.length) return [];
    // Batch máximo 128 según API. Si el caller manda más, dividimos.
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      batches.push(texts.slice(i, i + 64));
    }
    const out: number[][] = [];
    for (const batch of batches) {
      try {
        const r = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: batch,
            input_type: inputType,
            truncation: true,
          }),
        });
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          this.logger.error(
            `Voyage API ${r.status}: ${errText.slice(0, 300)}`,
          );
          return null;
        }
        const data = (await r.json()) as {
          data: Array<{ embedding: number[]; index: number }>;
        };
        // Reordenamos por index por si Voyage devuelve out-of-order.
        const sorted = [...data.data].sort((a, b) => a.index - b.index);
        for (const item of sorted) {
          out.push(item.embedding);
        }
      } catch (e: any) {
        this.logger.error(`Voyage fetch error: ${e?.message ?? e}`);
        return null;
      }
    }
    return out;
  }

  /** Embebe un solo texto. Wrapper conveniente. */
  async embedOne(
    text: string,
    inputType: 'document' | 'query' = 'document',
  ): Promise<number[] | null> {
    const r = await this.embed([text], inputType);
    return r?.[0] ?? null;
  }

  /**
   * Cosine similarity entre dos vectores. Asume mismo length (1024 para
   * voyage-3-large). No normaliza si ambos ya están normalizados (Voyage
   * los devuelve unit-length).
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
}
