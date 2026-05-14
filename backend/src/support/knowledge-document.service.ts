import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  KnowledgeAudience,
  KnowledgeDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { VoyageService } from './voyage.service';

const CHUNK_TARGET_CHARS = 1500; // ~ 300-400 tokens
const CHUNK_OVERLAP_CHARS = 200;
const MAX_CHUNKS = 500; // safety cap

type ParsedDoc = {
  text: string;
  totalChars: number;
};

/**
 * Pipeline de procesamiento de documentos de knowledge:
 *   1. Upload del archivo a R2 (vía MediaService.uploadRaw)
 *   2. Parse según mime: PDF → pdf-parse, DOCX → mammoth, TXT/MD → utf8
 *   3. Chunk por overlap sliding window (~1500 chars + 200 overlap)
 *   4. Embed con Voyage AI (si configurado) o deja embedding=null
 *   5. Persiste KnowledgeDocument + N KnowledgeEntry (uno por chunk)
 *
 * Las entries quedan filtradas por audience al consultar — cada doc
 * tiene una audience (TENANT, AFFILIATE, BOTH) y los chunks heredan.
 *
 * Idempotente: re-procesar un doc borra sus chunks viejos y crea nuevos.
 */
@Injectable()
export class KnowledgeDocumentService {
  private logger = new Logger(KnowledgeDocumentService.name);

  constructor(
    private prisma: PrismaService,
    private media: MediaService,
    private voyage: VoyageService,
  ) {}

  /**
   * Lista de documentos. Soporta filtro por audience.
   */
  async list(filter?: { audience?: KnowledgeAudience }) {
    return this.prisma.knowledgeDocument.findMany({
      where: filter?.audience ? { audience: filter.audience } : undefined,
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        title: true,
        fileUrl: true,
        fileType: true,
        fileSize: true,
        audience: true,
        category: true,
        status: true,
        totalChars: true,
        chunkCount: true,
        errorMessage: true,
        isActive: true,
        uploadedAt: true,
        processedAt: true,
      },
    });
  }

  /**
   * Sube y procesa un documento en una sola llamada. Síncrono (no
   * background job) — para docs típicos de <30 páginas tarda 5-15s con
   * Voyage habilitado. Si Voyage no está, casi instant.
   */
  async uploadAndProcess(opts: {
    title: string;
    audience: KnowledgeAudience;
    category?: string;
    file: Express.Multer.File;
  }) {
    if (!opts.file) throw new BadRequestException('No file');
    if (!opts.title?.trim()) throw new BadRequestException('title required');

    const mime = opts.file.mimetype || '';
    const ext = (opts.file.originalname.split('.').pop() ?? '').toLowerCase();
    const fileType = inferFileType(mime, ext);
    if (!fileType) {
      throw new BadRequestException(
        `Tipo no soportado (recibí ${mime || ext}). Soportados: PDF, DOCX, TXT, MD.`,
      );
    }

    // 1. Subir a R2
    const uploaded = await this.media.uploadRaw({
      folder: 'knowledge-docs',
      fileName: opts.file.originalname,
      buffer: opts.file.buffer,
      contentType: mime || 'application/octet-stream',
    });

    // 2. Crear row del documento en status UPLOADED
    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        title: opts.title.trim().slice(0, 200),
        fileUrl: uploaded.url,
        fileType,
        fileSize: uploaded.size,
        audience: opts.audience,
        category: opts.category?.trim().slice(0, 80) || 'General',
        status: KnowledgeDocumentStatus.UPLOADED,
      },
    });

    // 3. Procesar
    try {
      await this.processDocument(doc.id, opts.file.buffer, fileType);
    } catch (e: any) {
      this.logger.error(`processDocument falló: ${e?.message ?? e}`);
      await this.prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: KnowledgeDocumentStatus.FAILED,
          errorMessage: (e?.message ?? String(e)).slice(0, 1000),
        },
      });
    }

    return this.prisma.knowledgeDocument.findUnique({ where: { id: doc.id } });
  }

  /**
   * Procesa el archivo crudo: parse → chunk → embed → save chunks.
   * Lo factorizamos para poder re-procesar un doc existente (ej si la
   * embedding API estaba caída).
   */
  async processDocument(
    docId: string,
    buffer: Buffer,
    fileType: string,
  ): Promise<void> {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: docId },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');

    await this.prisma.knowledgeDocument.update({
      where: { id: docId },
      data: { status: KnowledgeDocumentStatus.PROCESSING, errorMessage: null },
    });

    // Borrar chunks previos (re-procesado idempotente)
    await this.prisma.knowledgeEntry.deleteMany({
      where: { documentId: docId },
    });

    // 1. Parse
    const parsed = await this.parseFile(buffer, fileType);
    const text = parsed.text.trim();
    if (!text) {
      throw new BadRequestException('El documento no contiene texto extraíble');
    }

    // 2. Chunk
    const chunks = chunkText(text, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS);
    if (chunks.length === 0) throw new BadRequestException('Sin chunks');
    if (chunks.length > MAX_CHUNKS) {
      throw new BadRequestException(
        `Documento muy grande: ${chunks.length} chunks > ${MAX_CHUNKS}. Subdividilo.`,
      );
    }

    // 3. Embed (si Voyage activado)
    let embeddings: number[][] | null = null;
    if (this.voyage.isEnabled()) {
      embeddings = await this.voyage.embed(chunks, 'document');
      if (!embeddings) {
        this.logger.warn(
          `Voyage falló para doc ${docId} — guardo chunks sin embedding (fallback lexical).`,
        );
      } else if (embeddings.length !== chunks.length) {
        this.logger.warn(
          `Voyage devolvió ${embeddings.length} ≠ ${chunks.length} chunks → drop embeddings`,
        );
        embeddings = null;
      }
    }

    // 4. Persist chunks como KnowledgeEntry
    const baseTitle = doc.title;
    await this.prisma.knowledgeEntry.createMany({
      data: chunks.map((content, idx) => ({
        title:
          chunks.length > 1
            ? `${baseTitle.slice(0, 160)} — parte ${idx + 1}/${chunks.length}`
            : baseTitle.slice(0, 200),
        content,
        category: doc.category,
        audience: doc.audience,
        isActive: true,
        documentId: doc.id,
        chunkIndex: idx,
        embedding: embeddings ? (embeddings[idx] as any) : null,
        embeddingModel: embeddings ? this.voyage.getModel() : null,
        tokenCount: Math.ceil(content.length / 4),
      })),
    });

    // 5. Update doc status
    await this.prisma.knowledgeDocument.update({
      where: { id: docId },
      data: {
        status: KnowledgeDocumentStatus.READY,
        totalChars: parsed.totalChars,
        chunkCount: chunks.length,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    this.logger.log(
      `Doc ${docId} procesado: ${chunks.length} chunks · ${parsed.totalChars} chars · embeddings=${embeddings ? 'yes' : 'no'}`,
    );
  }

  async remove(id: string) {
    const exists = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException();
    // Cascade borra entries por la FK ON DELETE CASCADE
    await this.prisma.knowledgeDocument.delete({ where: { id } });
    return { ok: true };
  }

  async setActive(id: string, isActive: boolean) {
    const doc = await this.prisma.knowledgeDocument.update({
      where: { id },
      data: { isActive },
    });
    // Replicamos al estado de las entries para que el filtro en /support/ask
    // las incluya/excluya correctamente.
    await this.prisma.knowledgeEntry.updateMany({
      where: { documentId: id },
      data: { isActive },
    });
    return doc;
  }

  // ─── parser ──────────────────────────────────────────────────────────

  private async parseFile(buffer: Buffer, fileType: string): Promise<ParsedDoc> {
    if (fileType === 'pdf') {
      // pdf-parse v2 expone una clase PDFParse en vez de la función default
      // de v1. getText() devuelve { text, info, ... }.
      const { PDFParse } = await import('pdf-parse');
      const parser = new (PDFParse as any)({ data: buffer });
      try {
        const r = await parser.getText();
        const text = (r?.text ?? '') as string;
        return { text, totalChars: text.length };
      } finally {
        await parser.destroy?.().catch(() => null);
      }
    }
    if (fileType === 'docx') {
      const mammoth = await import('mammoth');
      const r = await mammoth.extractRawText({ buffer });
      return { text: r.value || '', totalChars: (r.value || '').length };
    }
    if (fileType === 'txt' || fileType === 'md') {
      const text = buffer.toString('utf8');
      return { text, totalChars: text.length };
    }
    throw new BadRequestException(`Tipo ${fileType} no soportado por el parser`);
  }
}

function inferFileType(mime: string, ext: string): string | null {
  const m = mime.toLowerCase();
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  )
    return 'docx';
  if (m === 'text/plain' || ext === 'txt') return 'txt';
  if (m === 'text/markdown' || ext === 'md') return 'md';
  return null;
}

/**
 * Sliding window chunker por caracteres. Intenta respetar fronteras de
 * párrafo (doble newline) y, dentro de cada chunk, no cortar palabras.
 *
 * Es simple a propósito — para mejor calidad podemos meter semantic
 * chunking (langchain TextSplitter / semantic similarity) en Fase 6.
 */
function chunkText(text: string, target: number, overlap: number): string[] {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/ /g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned.length <= target * 1.3) return [cleaned];

  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    let end = i + target;
    if (end >= cleaned.length) {
      chunks.push(cleaned.slice(i).trim());
      break;
    }
    // Buscar boundary cercano: doble newline → newline → punto → espacio.
    const slice = cleaned.slice(i, end + 200);
    let cutAt = end - i;
    const boundaries = [
      slice.lastIndexOf('\n\n', cutAt),
      slice.lastIndexOf('. ', cutAt),
      slice.lastIndexOf('\n', cutAt),
      slice.lastIndexOf(' ', cutAt),
    ].filter((x) => x > target * 0.5);
    if (boundaries.length) cutAt = Math.max(...boundaries) + 1;
    const chunk = cleaned.slice(i, i + cutAt).trim();
    if (chunk) chunks.push(chunk);
    i += Math.max(cutAt - overlap, 1);
  }
  return chunks.filter((c) => c.length > 20);
}
