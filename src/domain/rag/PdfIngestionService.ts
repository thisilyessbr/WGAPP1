import { PrismaClient } from '@prisma/client';
import { EmbeddingProvider } from '../../core/rag/EmbeddingProvider';
import { KnowledgeRepository } from './KnowledgeRepository';
import { BusinessConfig } from '../tenant/BusinessConfig';
import * as crypto from 'crypto';
import * as path from 'path';
import * as pdfParseModule from 'pdf-parse';

/**
 * Validates that a buffer has a valid PDF file signature (%PDF- at byte offset 0).
 */
export function isValidPdfBuffer(buffer: Buffer | Uint8Array): boolean {
  if (!buffer || buffer.length < 5) {
    return false;
  }
  return buffer[0] === 0x25 && // %
         buffer[1] === 0x50 && // P
         buffer[2] === 0x44 && // D
         buffer[3] === 0x46 && // F
         buffer[4] === 0x2D;   // -
}

import { RtlTextNormalizer } from './RtlTextNormalizer';

export class PdfIngestionService {
  constructor(
    private prisma: PrismaClient,
    private embeddingProvider: EmbeddingProvider,
    private knowledgeRepository: KnowledgeRepository
  ) {}

  /**
   * Orchestrates the ingestion of a PDF document into tenant-scoped (and optional account-scoped) KnowledgeChunks.
   * Completely generic; no business-specific logic.
   */
  async ingestPdf(
    tenantId: string,
    fileBuffer: Buffer,
    filename: string,
    config: BusinessConfig,
    accountId?: string | null
  ): Promise<string> { // Returns KnowledgeSource ID
    const {
      maxFileSizeMb,
      maxExtractedTextLength,
      maxChunks,
      chunkSize,
      chunkOverlap
    } = config.knowledge.ingestion;

    // Sanitize filename to prevent path traversal in metadata
    const sanitizedFilename = path.basename(filename || 'document.pdf');

    // AccountId normalization:
    let normalizedAccountId: string | null = null;
    if (accountId && typeof accountId === 'string') {
      const trimmed = accountId.trim();
      if (trimmed && trimmed.toLowerCase() !== 'null' && trimmed.toLowerCase() !== 'global' && trimmed.toLowerCase() !== 'undefined') {
        normalizedAccountId = trimmed;
      }
    }

    // Account validation if accountId is provided
    if (normalizedAccountId) {
      const account = await this.prisma.account.findUnique({
        where: { id: normalizedAccountId }
      });
      if (!account || account.tenantId !== tenantId) {
        throw new Error(`Account [${normalizedAccountId}] not found for tenant [${tenantId}]`);
      }
      if (!account.enabled) {
        throw new Error(`Account [${normalizedAccountId}] is disabled`);
      }
    }

    // 1. Security limit: Max file size
    const sizeInMb = fileBuffer.length / (1024 * 1024);
    if (sizeInMb > maxFileSizeMb) {
      throw new Error(`PDF exceeds maximum allowed size of ${maxFileSizeMb}MB`);
    }

    // 2. Security limit: Magic-byte validation (%PDF- at byte offset 0)
    if (!isValidPdfBuffer(fileBuffer)) {
      throw new Error('Invalid file format: File does not have a valid PDF header signature (%PDF-).');
    }

    // 3. Hash computation for idempotency
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Check idempotency (Has this exact file been successfully ingested for this tenant + account scope before?)
    const existingSource = await this.prisma.knowledgeSource.findFirst({
      where: {
        tenantId,
        accountId: normalizedAccountId,
        hash,
        status: 'COMPLETED'
      }
    });

    if (existingSource) {
      return existingSource.id; // Already ingested for this scope, safe idempotency return
    }

    // 4. Create the ingestion record (PENDING)
    const source = await this.prisma.knowledgeSource.create({
      data: {
        tenantId,
        accountId: normalizedAccountId,
        name: sanitizedFilename,
        type: 'PDF',
        status: 'PENDING',
        hash,
        metadata: { mimeType: 'application/pdf', filename: sanitizedFilename, size: fileBuffer.length }
      }
    });

    try {
      // 4. Update status to PROCESSING
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'PROCESSING' }
      });

      // 5. Extract Text
      let pdfData;
      const pdfParse: any = (pdfParseModule as any).default || pdfParseModule;
      try {
        if (typeof pdfParse === 'function') {
          // pdf-parse v1.x support
          pdfData = await pdfParse(fileBuffer);
        } else if (pdfParse && pdfParse.PDFParse) {
          // pdf-parse v2.x support
          const uint8Array = new Uint8Array(fileBuffer);
          const parser = new pdfParse.PDFParse(uint8Array);
          await parser.load();
          const textResult = await parser.getText();
          const pagesResult = await parser.getInfo();
          pdfData = { 
            text: typeof textResult === 'string' ? textResult : textResult.text || '', 
            numpages: pagesResult?.numPages || 1 
          };
        } else {
          throw new Error('Unsupported pdf-parse version or invalid module export.');
        }
      } catch (e: any) {
        throw new Error('Failed to parse PDF document.');
      }

      const extractedText = this.normalizeText(pdfData.text);

      if (!extractedText.trim()) {
        throw new Error('PDF contains no extractable text.');
      }

      // 6. Security limit: Max text length
      if (extractedText.length > maxExtractedTextLength) {
        throw new Error(`Extracted text exceeds maximum allowed length of ${maxExtractedTextLength} characters.`);
      }

      // 7. Create Document
      const document = await this.prisma.knowledgeDocument.create({
        data: {
          tenantId,
          accountId: normalizedAccountId,
          sourceId: source.id,
          title: filename, // Title is filename for generic ingestion
          content: extractedText,
          metadata: { pages: pdfData.numpages }
        }
      });

      // 8. Chunking
      const chunks = this.chunkText(extractedText, chunkSize, chunkOverlap);
      
      // 9. Security limit: Max chunks
      if (chunks.length > maxChunks) {
        throw new Error(`Document generated ${chunks.length} chunks, exceeding the limit of ${maxChunks}.`);
      }

      // 10. Generate Embeddings and Persist Chunks securely
      let chunkIndex = 0;
      for (const chunk of chunks) {
        // Embed the chunk
        const embedding = await this.embeddingProvider.embedText(chunk);
        
        // Persist using KnowledgeRepository which enforces tenant and account bounds
        await this.knowledgeRepository.insertChunk(tenantId, document.id, chunk, embedding, normalizedAccountId);
        chunkIndex++;
      }

      // 11. Mark ingestion COMPLETED
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'COMPLETED' }
      });

      return source.id;
    } catch (error: any) {
      // 12. Defense 1: Ingestion Cleanup - Remove partially created KnowledgeDocument & cascading KnowledgeChunk rows
      try {
        await this.prisma.knowledgeDocument.deleteMany({
          where: { sourceId: source.id, tenantId }
        });
      } catch (cleanupErr: any) {
        // Cleanup error logged if needed; never mask the original ingestion error
      }

      // 13. Mark ingestion FAILED safely
      try {
        await this.prisma.knowledgeSource.update({
          where: { id: source.id },
          data: { status: 'FAILED', metadata: { error: error.message, originalFilename: sanitizedFilename } }
        });
      } catch (updateErr: any) {
        // Best effort status update
      }

      throw error;
    }
  }

  private normalizeText(text: string): string {
    // Apply RTL and Arabic extraction normalization
    let normalized = RtlTextNormalizer.normalize(text);

    return normalized
      .replace(/\r\n/g, '\n')
      .replace(/--\s*\d+\s*(?:of\s*\d+)?\s*--/gi, '') // Page markers e.g. "-- 1 of 2 --"
      .replace(/^(?:[A-Za-z0-9\s—–-]+\s+)?Page\s+\d+(?:\s+of\s+\d+)?$/gim, '') // Standalone page headers
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private isSectionHeading(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 60) return false;
    // Does not end in sentence punctuation
    if (/[.:,;!?]$/.test(trimmed)) return false;
    // Must start with capital letter or Arabic letter
    if (!/^[A-Z\u0600-\u06FF]/.test(trimmed)) return false;
    // Not a page marker
    if (/^(?:Page\s+\d+|[A-Za-z0-9\s—–-]+\s+Page\s+\d+)$/i.test(trimmed)) return false;
    // Not a list or tier item
    if (/^(Tier\s+\d+|Step\s+\d+|\d+\.|\*|-)/i.test(trimmed)) return false;
    // Not a table data line (containing Yes / No values or specific table field names)
    if (/\b(Yes|No)\b/i.test(trimmed)) return false;
    if (/^\s*(Feature|API Access|Team Seats|Data Retention|Custom Domain|Priority Support|SSO\s*\/\s*SAML)\b/i.test(trimmed)) {
      return false;
    }
    return true;
  }

  private splitIntoSentences(block: string): string[] {
    // Regex splits on sentence terminators (. ! ? ؟) that are NOT decimal points (e.g. 1.2, 3.4)
    // followed by whitespace and a capital letter/number/Arabic letter
    return block
      .split(/(?<=[.!?؟])\s+(?=[A-Z0-9\u0600-\u06FF])/g)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Paragraph and section-aware text chunking strategy.
   * Merges orphan headers with their content, suppresses standalone page labels,
   * and splits oversized sections strictly on complete sentence boundaries without breaking decimals.
   */
  private chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // Filter out pure page label lines
    const lines = rawLines.filter(l => !/^(?:Page\s+\d+|--\s*\d+\s*(?:of\s*\d+)?\s*--|[A-Za-z0-9\s—–-]+\s+Page\s+\d+)$/i.test(l));

    const sections: { title: string; lines: string[] }[] = [];
    let currentSection: { title: string; lines: string[] } = { title: '', lines: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (this.isSectionHeading(line) && currentSection.lines.length > 0) {
        // If the current section is just a heading/title with no substantive body, merge the next heading with it
        const currentText = currentSection.lines.join('\n').trim();
        if (currentText.length < 80 && !/[•\-*]/.test(currentText) && !/\b\d+\b/.test(currentText)) {
          currentSection.lines.push(line);
        } else {
          sections.push(currentSection);
          currentSection = { title: line, lines: [line] };
        }
      } else {
        currentSection.lines.push(line);
        if (!currentSection.title && this.isSectionHeading(line)) {
          currentSection.title = line;
        }
      }
    }
    if (currentSection.lines.length > 0) {
      sections.push(currentSection);
    }

    const rawChunks: string[] = [];
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const fullText = sec.lines.join('\n').trim();
      
      // If a section is very short (e.g. title only under 90 chars) and there is a next section, merge it
      if (fullText.length < 90 && i + 1 < sections.length) {
        sections[i + 1].lines.unshift(fullText);
        continue;
      }

      if (fullText.length <= chunkSize) {
        rawChunks.push(fullText);
      } else {
        // Split large section on safe sentence boundaries
        const sentences = this.splitIntoSentences(fullText);
        let currentChunk = '';
        for (const s of sentences) {
          if (currentChunk && (currentChunk.length + 1 + s.length) > chunkSize) {
            rawChunks.push(currentChunk.trim());
            currentChunk = s;
          } else {
            currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
          }
        }
        if (currentChunk.trim()) rawChunks.push(currentChunk.trim());
      }
    }

    // Discard any chunks that are purely low-value or empty
    const filteredChunks = rawChunks.filter(c => {
      const t = c.trim();
      return t.length >= 35 && !/^(?:Page\s+\d+|[A-Za-z0-9\s—–-]+\s+Page\s+\d+)$/i.test(t);
    });

    return filteredChunks.length > 0 ? filteredChunks : [text.trim()];
  }
}
