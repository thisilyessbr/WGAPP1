export interface EmbeddingProvider {
  embedText(text: string): Promise<number[]>;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  public generateFixedVector = false;
  public dimension: number = 3072;

  constructor(dimension: number = 3072) {
    this.dimension = dimension;
  }
  
  async embedText(text: string): Promise<number[]> {
    const dim = this.dimension;
    if (this.generateFixedVector) {
      return Array(dim).fill(0.1);
    }

    const lower = text.toLowerCase();
    
    // Explicit orthogonal vector contracts for unit test suites
    if (lower.includes('unrelated') || lower.includes('apple') || lower.includes('fruit')) {
      return Array(dim).fill(0).map((_, i) => i === 1 ? 1 : 0);
    }
    if (lower.includes('test') || lower.includes('dog') || lower.includes('animal') || lower.includes('secret')) {
      return Array(dim).fill(0).map((_, i) => i === 0 ? 1 : 0);
    }
    
    // Default mock behavior for test suite: positive-quadrant vectors so test queries match test docs
    const vector = Array(dim).fill(0);
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) % 2147483647;
    }
    
    for (let i = 0; i < dim; i++) {
      seed = (seed * 16807) % 2147483647;
      vector[i] = 0.9 + (seed / 2147483647) * 0.1;
    }
    
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    for (let i = 0; i < dim; i++) {
      vector[i] /= magnitude;
    }
    
    return vector;
  }
}

export { GeminiEmbeddingProvider } from './GeminiEmbeddingProvider';
