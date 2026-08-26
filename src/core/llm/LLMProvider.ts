export type LLMErrorType = 'timeout' | 'rate_limit' | 'auth' | 'invalid_response' | 'unknown';

export class LLMProviderError extends Error {
  public readonly type: LLMErrorType;
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly originalError?: any;

  constructor(options: {
    message: string;
    type: LLMErrorType;
    provider: string;
    statusCode?: number;
    originalError?: any;
  }) {
    super(options.message);
    this.name = 'LLMProviderError';
    this.type = options.type;
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.originalError = options.originalError;
  }
}

export interface LLMRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMProvider {
  classifyIntent(systemPrompt: string, message: string, allowedIntents: string[], options?: LLMRequestOptions): Promise<string | null>;
  extractField(systemPrompt: string, message: string, fieldType: string, options?: LLMRequestOptions): Promise<any | null>;
  generateResponse(systemPrompt: string, history: {role: string, content: string}[], options?: LLMRequestOptions): Promise<string>;
}

export class LLMMockProvider implements LLMProvider {
  public intentMock: string | null = null;
  public extractedFieldMock: any | null = null;
  public generatedResponseMock: string = 'Mocked response';
  public responseResolver?: (systemPrompt: string, history: {role: string, content: string}[], options?: LLMRequestOptions) => string | Promise<string>;
  public shouldFail: boolean = false;
  public failureType: LLMErrorType = 'unknown';
  public lastSystemPrompt: string | null = null;
  public lastHistory: any[] | null = null;
  public lastOptions: LLMRequestOptions | null = null;
  public callCount: number = 0;

  async classifyIntent(systemPrompt: string, message: string, allowedIntents: string[], options?: LLMRequestOptions): Promise<string | null> {
    this.callCount++;
    this.lastOptions = options || null;
    if (this.shouldFail) {
      throw new LLMProviderError({
        message: 'Mock LLM Failure',
        type: this.failureType,
        provider: 'mock'
      });
    }
    return this.intentMock;
  }

  async extractField(systemPrompt: string, message: string, fieldType: string, options?: LLMRequestOptions): Promise<any | null> {
    this.callCount++;
    this.lastOptions = options || null;
    if (this.shouldFail) {
      throw new LLMProviderError({
        message: 'Mock LLM Failure',
        type: this.failureType,
        provider: 'mock'
      });
    }
    return this.extractedFieldMock;
  }

  async generateResponse(systemPrompt: string, history: {role: string, content: string}[], options?: LLMRequestOptions): Promise<string> {
    this.callCount++;
    this.lastSystemPrompt = systemPrompt;
    this.lastHistory = history;
    this.lastOptions = options || null;
    if (this.shouldFail) {
      throw new LLMProviderError({
        message: 'Mock LLM Failure',
        type: this.failureType,
        provider: 'mock'
      });
    }
    if (this.responseResolver) {
      return this.responseResolver(systemPrompt, history, options);
    }
    return this.generatedResponseMock;
  }
}
