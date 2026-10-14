import { BusinessConfig, WorkflowConfig } from '../tenant/BusinessConfig';
import { GreetingRouter } from './GreetingRouter';
import { TurnDecision } from './TurnDecision';

/**
 * Resolves whether an incoming message should start a configured workflow,
 * via deterministic matching only (workflow IDs, declared intent IDs, and
 * configured keyword phrases). LLM-based intent classification is a separate,
 * opt-in fallback handled by the caller — this resolver never calls an LLM.
 */
export class WorkflowTriggerResolver {
  static normalizeForPhraseMatching(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static matchesTriggerPhrase(userText: string, phrase: string): boolean {
    if (!userText || !phrase) return false;
    const normUser = this.normalizeForPhraseMatching(userText);
    const normPhrase = this.normalizeForPhraseMatching(phrase);
    if (!normUser || !normPhrase) return false;

    if (normUser === normPhrase) return true;

    const userTokens = normUser.split(' ');
    const phraseTokens = normPhrase.split(' ');

    if (phraseTokens.length > userTokens.length) return false;

    for (let i = 0; i <= userTokens.length - phraseTokens.length; i++) {
      let match = true;
      for (let j = 0; j < phraseTokens.length; j++) {
        if (userTokens[i + j] !== phraseTokens[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }

    return false;
  }

  static resolve(
    content: string,
    config: BusinessConfig,
    turnDecision?: TurnDecision
  ): { workflowId: string; workflowConfig: WorkflowConfig } | null {
    if (!config.workflows || Object.keys(config.workflows).length === 0) {
      return null;
    }

    const trimmed = content.trim();
    const lower = trimmed.toLowerCase();
    const normalized = GreetingRouter.normalize(content);
    const normUser = this.normalizeForPhraseMatching(content);

    // 0. Auto-start workflows (if workflow.activation.mode === 'auto_start' or legacy autoStartWorkflow flag or explicit 'start' command)
    for (const [wfId, wf] of Object.entries(config.workflows)) {
      if (wf.activation?.mode === 'auto_start' || (config as any).autoStartWorkflow === true) {
        return { workflowId: wfId, workflowConfig: wf };
      }
      if (wf.activation?.allowManualStart !== false && ['start', 'begin', 'commencer', 'demarrer', 'ابدأ'].includes(lower)) {
        return { workflowId: wfId, workflowConfig: wf };
      }
    }

    // 1. Exact workflow ID match (when allowManualStart !== false)
    for (const [wfId, wf] of Object.entries(config.workflows)) {
      const allowManual = wf.activation?.allowManualStart !== false;
      if (allowManual && lower === wfId.toLowerCase()) {
        return { workflowId: wfId, workflowConfig: wf };
      }
    }

    // 2. Normalized workflow ID match (when allowManualStart !== false)
    for (const [wfId, wf] of Object.entries(config.workflows)) {
      const allowManual = wf.activation?.allowManualStart !== false;
      const wfIdNorm = this.normalizeForPhraseMatching(wfId.replace(/_/g, ' '));
      if (allowManual && (normalized === wfId.toLowerCase().replace(/_/g, ' ') || normUser === wfIdNorm)) {
        return { workflowId: wfId, workflowConfig: wf };
      }
    }

    const declaredIntents = config.capabilities?.intents || [];

    // 3. Explicit configured intent match (turnDecision or literal intent ID)
    for (const [wfId, wf] of Object.entries(config.workflows)) {
      const linkedIntentIds = new Set<string>();

      if (wf.activation?.intents && Array.isArray(wf.activation.intents)) {
        for (const id of wf.activation.intents) {
          if (id) linkedIntentIds.add(id);
        }
      }

      for (const intent of declaredIntents) {
        const matchesWf = intent.workflowId === wfId || (!intent.workflowId && intent.id === wfId);
        if (matchesWf && intent.id) {
          linkedIntentIds.add(intent.id);
        }
      }

      for (const intentId of linkedIntentIds) {
        const intentIdLower = intentId.toLowerCase();
        const intentIdNorm = this.normalizeForPhraseMatching(intentId.replace(/_/g, ' '));

        // A. TurnDecision intent match
        if (turnDecision?.intent && !['GENERAL_CONVERSATION', 'None', 'null'].includes(turnDecision.intent)) {
          if (turnDecision.intent.toLowerCase() === intentIdLower) {
            return { workflowId: wfId, workflowConfig: wf };
          }
        }

        // B. Literal match of exact intent ID
        if (lower === intentIdLower || normUser === intentIdNorm) {
          return { workflowId: wfId, workflowConfig: wf };
        }
      }
    }

    // 4. Configured intent keywords (capabilities.intents[].keywords)
    for (const [wfId, wf] of Object.entries(config.workflows)) {
      const linkedIntents = declaredIntents.filter(i => {
        if (i.workflowId === wfId || (!i.workflowId && i.id === wfId)) return true;
        if (wf.activation?.intents && Array.isArray(wf.activation.intents) && wf.activation.intents.includes(i.id)) return true;
        return false;
      });

      for (const intentObj of linkedIntents) {
        if (intentObj.keywords && Array.isArray(intentObj.keywords)) {
          for (const kw of intentObj.keywords) {
            if (kw && this.matchesTriggerPhrase(content, kw)) {
              return { workflowId: wfId, workflowConfig: wf };
            }
          }
        }
      }
    }

    // 5. Workflow activation keywords (workflow.activation.keywords)
    for (const [wfId, wf] of Object.entries(config.workflows)) {
      const activationKeywords = [
        ...(wf.activation?.keywords && Array.isArray(wf.activation.keywords) ? wf.activation.keywords : []),
        ...((wf as any).keywords && Array.isArray((wf as any).keywords) ? (wf as any).keywords : [])
      ];

      for (const kw of activationKeywords) {
        if (kw && this.matchesTriggerPhrase(content, kw)) {
          return { workflowId: wfId, workflowConfig: wf };
        }
      }
    }

    return null;
  }

  static buildIntentClassificationPrompt(
    config: BusinessConfig,
    allowedIntents: string[],
    intentWfMap: Map<string, string>
  ): string {
    const intentDescriptions = allowedIntents.map(id => {
      const intentObj = config.capabilities?.intents?.find(i => i.id === id);
      const wfKey = intentWfMap.get(id);
      const wf = wfKey ? config.workflows?.[wfKey] : undefined;

      const descParts: string[] = [];
      if (intentObj?.description) {
        descParts.push(intentObj.description);
      }
      if (wf?.name) {
        descParts.push(`Workflow: ${wf.name}`);
      }
      if (wf?.description && wf.description !== intentObj?.description) {
        descParts.push(`Purpose: ${wf.description}`);
      }
      const fullDesc = descParts.length > 0 ? descParts.join('. ') : id;
      return `- "${id}": ${fullDesc}`;
    }).join('\n');

    let intentPrompt: string;
    if (config.prompts?.intentClassification && config.prompts.intentClassification.includes('{{intentDescriptions}}')) {
      intentPrompt = config.prompts.intentClassification
        .replace('{{intentDescriptions}}', intentDescriptions)
        .replace('{{sampleIntent}}', allowedIntents[0] || 'intent_id')
        .replace('{{intents}}', allowedIntents.join(', '));
    } else {
      const defaultTemplate =
        'You are a multilingual intent classification engine supporting English, French, Standard Arabic, and Moroccan Darija (Arabic script and Latin Arabizi). Classify the user message into exactly ONE of the following intent IDs based on their descriptions:\n{{intentDescriptions}}\n\nRules:\n1. If the user message expresses an intention matching one of the intents above (in English, French, Arabic, Darija, or Arabizi), reply with ONLY that exact intent ID (e.g. "{{sampleIntent}}").\n2. If the user message is a general greeting, knowledge/pricing question, or unrelated inquiry, reply with "null".\n3. Reply ONLY with the exact intent ID or "null", with no markdown, punctuation, or explanation.';

      if (config.prompts?.intentClassification && config.prompts.intentClassification.includes('{{intents}}')) {
        intentPrompt = `${config.prompts.intentClassification.replace('{{intents}}', allowedIntents.join(', '))}\n\nCandidate intent descriptions (support English, French, Arabic, Darija, and Arabizi):\n${intentDescriptions}`;
      } else {
        intentPrompt = defaultTemplate
          .replace('{{intentDescriptions}}', intentDescriptions)
          .replace('{{sampleIntent}}', allowedIntents[0] || 'intent_id')
          .replace('{{intents}}', allowedIntents.join(', '));
      }
    }

    return intentPrompt;
  }
}
