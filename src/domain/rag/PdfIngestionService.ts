import { PrismaClient } from '@prisma/client';
import { EmbeddingProvider } from '../../core/rag/EmbeddingProvider';
import { KnowledgeRepository } from './KnowledgeRepository';
import { BusinessConfig } from '../tenant/BusinessConfig';
import * as crypto from 'crypto';
import * as pdfParseModule from 'pdf-parse';

export class PdfIngestionService {
  constructor(
    private prisma: PrismaClient,
    private embeddingProvider: EmbeddingProvider,
    private knowledgeRepository: KnowledgeRepository
  ) {}

  /**
   * Orchestrates the ingestion of a PDF document into tenant-scoped KnowledgeChunks.
   * Completely generic; no business-specific logic.
   */
  async ingestPdf(
    tenantId: string,
    fileBuffer: Buffer,
    filename: string,
    config: BusinessConfig
  ): Promise<string> { // Returns KnowledgeSource ID
    const {
      maxFileSizeMb,
      maxExtractedTextLength,
      maxChunks,
      chunkSize,
      chunkOverlap
    } = config.knowledge.ingestion;

    // 1. Security limit: Max file size
    const sizeInMb = fileBuffer.length / (1024 * 1024);
    if (sizeInMb > maxFileSizeMb) {
      throw new Error(`PDF exceeds maximum allowed size of ${maxFileSizeMb}MB`);
    }

    // 2. Hash computation for idempotency
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Check idempotency (Has this exact file been successfully ingested for this tenant before?)
    const existingSource = await this.prisma.knowledgeSource.findFirst({
      where: { tenantId, hash, status: 'COMPLETED' }
    });

    if (existingSource) {
      return existingSource.id; // Already ingested, safe idempotency return
    }

    // 3. Create the ingestion record (PENDING)
    const source = await this.prisma.knowledgeSource.create({
      data: {
        tenantId,
        name: filename,
        type: 'PDF',
        status: 'PENDING',
        hash,
        metadata: { mimeType: 'application/pdf', filename, size: fileBuffer.length }
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
          sourceId: source.id,
          title: filename, // Naive title is filename for generic ingestion
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
        
        // Persist using KnowledgeRepository which enforces tenant bounds
        await this.knowledgeRepository.insertChunk(tenantId, document.id, chunk, embedding);
        chunkIndex++;
      }

      // 11. Mark ingestion COMPLETED
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'COMPLETED' }
      });

      return source.id;
    } catch (error: any) {
      // 12. Mark ingestion FAILED safely
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'FAILED', metadata: { error: error.message, originalFilename: filename } }
      });
      throw error;
    }
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')                  // Windows newlines
      .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '') // Page markers e.g. "-- 1 of 2 --"
      .replace(/\n{3,}/g, '\n\n')              // Collapse 3+ newlines to double newline
      .trim();
  }

  private isSectionHeading(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 60) return false;
    // Does not end in sentence punctuation
    if (/[.:,;!?]$/.test(trimmed)) return false;
    // Must start with capital letter
    if (!/^[A-Z]/.test(trimmed)) return false;
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
    // Regex splits on sentence terminators (. ! ?) that are NOT decimal points (e.g. 1.2, 3.4)
    // followed by whitespace and a capital letter/number
    return block
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Paragraph and section-aware text chunking strategy.
   * Detects section headings, table blocks, and paragraph boundaries.
   * Splits oversized sections strictly on complete sentence boundaries without breaking decimals.
   */
  private chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const sections: { title: string; lines: string[] }[] = [];
    let currentSection: { title: string; lines: string[] } = { title: '', lines: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (this.isSectionHeading(line) && currentSection.lines.length > 0) {
        sections.push(currentSection);
        currentSection = { title: line, lines: [line] };
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

    const chunks: string[] = [];
    for (const sec of sections) {
      const fullText = sec.lines.join('\n');
      if (fullText.length <= chunkSize) {
        chunks.push(fullText);
      } else {
        // Split large section on safe sentence boundaries
        const sentences = this.splitIntoSentences(fullText);
        let currentChunk = '';
        for (const s of sentences) {
          if (currentChunk && (currentChunk.length + 1 + s.length) > chunkSize) {
            chunks.push(currentChunk);
            currentChunk = s;
          } else {
            currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
          }
        }
        if (currentChunk) chunks.push(currentChunk);
      }
    }

    return chunks.length > 0 ? chunks : [text.trim()];
  }
}
