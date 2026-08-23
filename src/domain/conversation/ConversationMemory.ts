import { ConversationTurn } from './ConversationContext';

export interface ConversationSummary {
  text: string;
  turnCount: number;
  lastSummarizedAt?: Date;
}

/**
 * 3-Layer Controlled Conversation Memory Model
 * Layer A: Recent Turns (max 4 turns, strictly chronological)
 * Layer B: Conversation Summary (bounded summary of turns prior to active window)
 * Layer C: Structured Facts (authoritative facts from context & workflow)
 */
export interface ConversationMemory {
  tenantId: string;
  accountId?: string | null;
  customerId: string;
  conversationId: string;

  /** Layer A: Bounded recent turns (max 4 turns, user/assistant only, strictly chronological) */
  recentTurns: ConversationTurn[];

  /** Layer B: High-level summary of older turns prior to the recent window (null if <= 4 turns) */
  summary: ConversationSummary | null;

  /** Layer C: Explicit structured facts from workflow & conversation context */
  structuredFacts: Record<string, unknown>;

  /** Total message count in conversation */
  totalTurns: number;

  /** Indicates if memory was reset (e.g. on new session or explicit cancellation) */
  isReset: boolean;
}

export interface BuildMemoryParams {
  tenantId: string;
  accountId?: string | null;
  customerId: string;
  conversationId: string;
  recentMessages?: Array<{
    role: string;
    content: string;
    createdAt: Date;
  }>;
  totalMessageCount?: number;
  contextData?: Record<string, any> | null;
  activeSessionCollectedData?: Record<string, any> | null;
  existingSummary?: string | null;
  isCompletedOrClosed?: boolean;
}

export class ConversationMemoryManager {
  public static readonly MAX_RECENT_TURNS = 4;

  /**
   * Constructs the canonical, isolated 3-layer ConversationMemory model.
   * Enforces:
   * 1. Max 4 recent turns in strict chronological order.
   * 2. Summary is null if within window, or populated if conversation exceeds window.
   * 3. Structured facts only include explicit fields, not unverified model claims.
   * 4. Memory is strictly isolated by tenantId, accountId, and conversationId.
   */
  public static buildMemory(params: BuildMemoryParams): ConversationMemory {
    const rawMessages = params.recentMessages || [];
    const totalTurns = params.totalMessageCount !== undefined ? params.totalMessageCount : rawMessages.length;

    // Layer A: Recent Turns (max 4 turns, user/assistant only, reversed to chronological order)
    const bounded = rawMessages.slice(0, this.MAX_RECENT_TURNS);
    const chronological = [...bounded].reverse();
    const recentTurns: ConversationTurn[] = chronological.map(m => ({
      role: m.role.toLowerCase() === 'user' ? 'user' : 'assistant',
      content: m.content,
      timestamp: m.createdAt
    }));

    // Layer B: Conversation Summary (null if within window; populated if older turns exist)
    let summary: ConversationSummary | null = null;
    if (params.existingSummary) {
      summary = {
        text: params.existingSummary,
        turnCount: Math.max(0, totalTurns - recentTurns.length),
        lastSummarizedAt: new Date()
      };
    } else if (totalTurns > this.MAX_RECENT_TURNS) {
      summary = {
        text: `Conversation has ${totalTurns - recentTurns.length} earlier turn(s) prior to the active window.`,
        turnCount: totalTurns - recentTurns.length,
        lastSummarizedAt: new Date()
      };
    }

    // Layer C: Structured Facts (explicit contextData and active workflow collectedData)
    const structuredFacts: Record<string, unknown> = {
      ...((params.contextData as Record<string, unknown>) || {}),
      ...((params.activeSessionCollectedData as Record<string, unknown>) || {})
    };

    return {
      tenantId: params.tenantId,
      accountId: params.accountId ?? null,
      customerId: params.customerId,
      conversationId: params.conversationId,
      recentTurns,
      summary,
      structuredFacts,
      totalTurns,
      isReset: Boolean(params.isCompletedOrClosed)
    };
  }
}
