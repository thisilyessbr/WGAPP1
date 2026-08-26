import { DEFAULT_GEMINI_MODEL } from '../../core/llm/GeminiLLMProvider';

export interface IdentityConfig {
  botName: string;
  language: string;
  brand?: string;
  industry?: string;
  country?: string;
  currency?: string;
  businessHours?: string;
  locations?: string[];
  support?: {
    email?: string;
    sales?: string;
    returns?: string;
    phone?: string;
  };
}

export interface BehaviorConfig {
  tone: string;
  verbosity: 'short' | 'medium' | 'long';
  stayOnTopic: boolean;
  answerOnlyFromKnowledge: boolean;
  allowSmallTalk: boolean;
  allowHumanHandoff: boolean;
}

export interface LimitsConfig {
  maxConversationHistory: number;
  maxWorkflowSteps: number;
  maxResponseLength: number;
  maxAutomationTurns?: number;
}

export type LocalizedPrompt = string | {
  en?: string;
  fr?: string;
  ar?: string;
  darija?: string;
  [key: string]: string | undefined;
};

export function resolveLocalizedPrompt(
  prompt: LocalizedPrompt | undefined,
  lang: string,
  defaultEn: string
): string {
  if (!prompt) return defaultEn;
  if (typeof prompt === 'string') {
    const trimmed = prompt.trim();
    if (!trimmed || trimmed === '[object Object]' || trimmed.includes('[object Object]')) {
      return defaultEn;
    }
    return prompt;
  }
  const resolved = prompt[lang] || prompt.en || defaultEn;
  if (typeof resolved === 'string') {
    const trimmed = resolved.trim();
    if (!trimmed || trimmed === '[object Object]' || trimmed.includes('[object Object]')) {
      return defaultEn;
    }
    return resolved;
  }
  return defaultEn;
}

export const DEFAULT_POST_COMPLETION_MESSAGES = {
  closing: {
    en: "I'll let our team take it from here — they'll follow up with you shortly.",
    fr: "Je laisse notre équipe prendre le relais — ils vous contacteront sous peu.",
    ar: "سيتولى فريقنا المتابعة معك من هنا — سيتواصلون معك قريباً.",
    darija: "ghadi nkhlli l-fariq dyalna ykmml m3ak mn hna — ghadi y-ttaslou bik 9riban."
  },
  fallback: {
    en: "I can help with questions related to your request. Our team will follow up with you shortly.",
    fr: "Je peux vous aider avec les questions liées à votre demande. Notre équipe vous contactera sous peu.",
    ar: "يمكنني المساعدة في الأسئلة المتعلقة بطلبك. سيتواصل معك فريقنا قريباً.",
    darija: "n9der n3awnek f l-as'ila dyal talab dyalek. l-fariq dyalna ghadi y-ttasel bik 9riban."
  }
};

export const DEFAULT_HANDOFF_MESSAGES = {
  en: "I am transferring you to a team member.",
  fr: "Je vous transfère à un conseiller.",
  ar: "أقوم بتحويلك إلى أحد أعضاء فريقنا.",
  darija: "ghadi n7ewlek l 3end wa7d mn l-fariq dyalna."
};

export const DEFAULT_IMAGE_FALLBACK_MESSAGES = {
  en: "I can't process images right now — could you describe what you're looking for?",
  fr: "Je ne peux pas traiter les images pour le moment — pourriez-vous décrire ce que vous recherchez ?",
  ar: "لا يمكنني معالجة الصور في الوقت الحالي — هل يمكنك وصف ما تبحث عنه؟",
  darija: "ما كنعالجش التصاور دابا — عفاك واش تقدر توصف ليا شنو بغيتي؟"
};

export const DEFAULT_LIMIT_EXCEEDED_MESSAGES = {
  en: "Conversation has reached the maximum allowed length. Please start a new conversation.",
  fr: "La conversation a atteint la longueur maximale autorisée. Veuillez démarrer une nouvelle conversation.",
  ar: "وصلت المحادثة إلى الحد الأقصى المسموح به. يرجى بدء محادثة جديدة.",
  darija: "l-mo7adatha wslat l l-7add l-aqsa. 3afak bda mo7adatha jdida."
};

export interface PromptsConfig {
  system: string;
  knowledge: string;
  workflow: string;
  fallback: LocalizedPrompt;
  greeting: LocalizedPrompt;
  handoff: LocalizedPrompt;
  postCompletionClosing?: LocalizedPrompt;
  postCompletionFallback?: LocalizedPrompt;
  imageFallback?: LocalizedPrompt;
  limitExceeded?: LocalizedPrompt;
  intentClassification: string;
  fieldExtraction: string;
  workflowUnavailable: string;
  workflowCancelled: string;
  missingFieldPrompt: string;
  confirmationPrompt: string;
}

export interface WorkflowFieldConfig {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'time' | 'datetime' | 'enum';
  required: boolean;
  options?: string[]; // for enum
  extractionPrompt?: string;
  validationRegex?: string; // legacy generic pattern, keep for compatibility
  pattern?: string; // explicit pattern
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

export interface WorkflowChoiceOption {
  label: string;
  next: string;
}

export interface WorkflowStateConfig {
  id?: string;
  name?: string;
  label?: string;
  type: 'choice' | 'collect' | 'confirm' | 'message' | 'rag' | 'handoff' | 'end';
  prompt?: string | LocalizedPrompt;
  field?: string | WorkflowFieldConfig; // For 'collect' state type: camelCase string key or legacy object
  next?: string; // For 'collect' / linear states: target stateId
  options?: WorkflowChoiceOption[]; // for 'choice' state type: { label: string, next: string }[]
  confirmKeywords?: string[]; // e.g. ['yes', 'confirm', 'oui', 'si']
  cancelKeywords?: string[];  // e.g. ['no', 'cancel', 'non', 'annuler']
  cancellationPrompt?: string | LocalizedPrompt;
  transitions?: {
    condition?: string; // generic condition evaluation
    intent?: string;
    target: string;
    default?: boolean;
  }[];
}

export interface WorkflowActivationConfig {
  mode?: 'explicit_intent' | 'auto_start';
  intents?: string[];
  allowManualStart?: boolean;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  initialState: string;
  states: Record<string, WorkflowStateConfig>;
  allowInterruption?: boolean;
  activation?: WorkflowActivationConfig;
}

export interface KnowledgeConfig {
  enabled: boolean;
  topK: number;
  minSimilarityScore: number;
  maxContextSize: number;
  ingestion: {
    chunkSize: number;
    chunkOverlap: number;
    maxFileSizeMb: number;
    maxExtractedTextLength: number;
    maxChunks: number;
  };
}

export interface LlmConfig {
  provider: string; // e.g. "deepseek" | "gemini" | "mock"
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface FaqEntry {
  id: string;
  category?: string;
  question?: string;
  answer?: string;
  questions?: { en?: string; fr?: string; ar?: string; darija?: string };
  answers?: { en?: string; fr?: string; ar?: string; darija?: string };
  keywords?: { en?: string[]; fr?: string[]; ar?: string[]; darija?: string[] } | string[];
}

export interface EcommerceTaxonomyConfig {
  categories?: Record<string, string[]>;
  attributes?: Record<string, string[]>;
}

export type ShippingDestinationScope =
  | 'DOMESTIC_ONLY'
  | 'SELECTED_COUNTRIES'
  | 'WORLDWIDE';

export interface ShippingScopeConfig {
  scope?: ShippingDestinationScope;
  domesticCountry?: string;
  supportedCountries?: string[];
  supportedRegions?: string[];
}

export interface CapabilitiesConfig {
  intents: { id: string; description: string; workflowId?: string }[];
  faq?: FaqEntry[];
  imageEnabled?: boolean;
  ecommerceEnabled?: boolean;
  ecommerceTaxonomy?: EcommerceTaxonomyConfig;
  ecommerceCategories?: Record<string, string[]>;
  shippingScope?: ShippingScopeConfig;
}

export interface BusinessConfig {
  identity: IdentityConfig;
  behavior: BehaviorConfig;
  limits: LimitsConfig;
  prompts: PromptsConfig;
  capabilities: CapabilitiesConfig;
  workflows: Record<string, WorkflowConfig>;
  knowledge: KnowledgeConfig;
  llm: LlmConfig;
  ecommerce?: {
    categories?: Record<string, string[]>;
    attributes?: Record<string, string[]>;
  };
  catalog?: any[];
  customers?: any[];
  orders?: any[];
  shippingZones?: any[];
  promotions?: any[];
}

// Default configuration ensures safety and reasonable starting points.
// No business-specific defaults allowed.
export const DEFAULT_BUSINESS_CONFIG: BusinessConfig = {
  identity: {
    botName: 'Assistant',
    language: 'en',
  },
  behavior: {
    tone: 'professional',
    verbosity: 'medium',
    stayOnTopic: true,
    answerOnlyFromKnowledge: false,
    allowSmallTalk: true,
    allowHumanHandoff: false,
  },
  limits: {
    maxConversationHistory: 20,
    maxWorkflowSteps: 10,
    maxResponseLength: 500,
    maxAutomationTurns: 500,
  },
  prompts: {
    system: 'You are a helpful assistant. Always respond in the same language, dialect, and script the user just wrote in — English, French, Modern Standard Arabic, or Moroccan Darija. If the user writes Darija (Moroccan Arabic, often in Latin transliteration like \'bghit n3rf\'), reply in Darija using the exact same script (Latin transliteration/Arabizi) they used — do not switch to Arabic script, French, or MSA unless the user does.',
    knowledge: 'Use the following context to answer the question: {{context}}',
    workflow: 'Please provide the requested information.',
    fallback: {
      en: 'I did not understand that. Could you rephrase?',
      fr: 'Je n\'ai pas compris. Pourriez-vous reformuler ?',
      ar: 'لم أفهم ذلك. هل يمكنك إعادة الصياغة؟',
      darija: 'mafhemtch hadchi. momkin t3awed tchra7 liya?'
    },
    greeting: {
      en: 'Hello! How can I help you today?',
      fr: 'Bonjour ! Comment puis-je vous aider aujourd\'hui ?',
      ar: 'مرحبًا! كيف يمكنني مساعدتك اليوم؟',
      darija: 'Salam! Kifach n9der n3awnk lyoum?'
    },
    handoff: DEFAULT_HANDOFF_MESSAGES,
    postCompletionClosing: DEFAULT_POST_COMPLETION_MESSAGES.closing,
    postCompletionFallback: DEFAULT_POST_COMPLETION_MESSAGES.fallback,
    imageFallback: DEFAULT_IMAGE_FALLBACK_MESSAGES,
    limitExceeded: DEFAULT_LIMIT_EXCEEDED_MESSAGES,
    intentClassification: 'You are an intent classification engine. Classify the user message into exactly ONE of the following intents: [{{intents}}]. If it matches none, reply with "null". Reply ONLY with the exact intent string or "null". Do not include quotes or any other text.',
    fieldExtraction: 'You are a data extraction engine. Extract the field of type "{{fieldType}}" from the user\'s message. Reply ONLY with valid JSON in this format: {"value": <extracted_value>}. If the information is not present, reply with {"value": null}. Do not include markdown code blocks.',
    workflowUnavailable: 'This workflow is no longer available.',
    workflowCancelled: 'Workflow cancelled.',
    missingFieldPrompt: 'Please provide: {{fieldName}}',
    confirmationPrompt: 'Please confirm the following details:\n{{summary}}\n\n(Reply \'yes\' to confirm or \'no\' to cancel)'
  },
  capabilities: {
    intents: [
      { id: 'GREETING', description: 'User greetings, hellos, introductions, and casual openings' },
      { id: 'PRODUCT_INQUIRY', description: 'Questions about products, offerings, services, features, plans, or pricing' },
      { id: 'SUPPORT_REQUEST', description: 'Customer support, help, technical assistance, or refund inquiries' }
    ],
    faq: [],
  },
  workflows: {},
  knowledge: {
    enabled: true,
    topK: 3,
    minSimilarityScore: 0.52,
    maxContextSize: 4000,
    ingestion: {
      chunkSize: 800,
      chunkOverlap: 100,
      maxFileSizeMb: 10,
      maxExtractedTextLength: 100000,
      maxChunks: 500
    }
  },
  llm: {
    // Default provider is explicitly hardcoded to DeepSeek ('deepseek-chat').
    // Previously, this evaluated `process.env.GOOGLE_API_KEY ? 'gemini' : 'deepseek'`,
    // which caused fresh/reset tenants to silently revert to Gemini if GOOGLE_API_KEY
    // was present in .env for embeddings. Provider selection must be explicit, not an
    // environment variable presence side-effect.
    provider: 'deepseek',
    model: 'deepseek-chat',
    temperature: 0.2,
    maxTokens: 1000,
    timeoutMs: 15000,
  }
};
