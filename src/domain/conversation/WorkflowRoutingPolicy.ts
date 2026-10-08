import { BusinessConfig, WorkflowConfig } from '../tenant/BusinessConfig';
import { IntentTriggerLibrary, normalizeTriggerText, TriggerUseCase } from './IntentTriggerLibrary';
import { isActionNegated } from './IntentLanguage';
import { TurnDecision } from './TurnDecision';

export type WorkflowRouteDecision =
  | { kind: 'WORKFLOW'; workflowId: string; workflowConfig: WorkflowConfig; source: 'USE_CASE' | 'INTENT' | 'KEYWORD' | 'MANUAL' | 'AUTO'; useCase?: TriggerUseCase }
  | { kind: 'UNMAPPED_PURCHASE'; useCase: 'PURCHASE' }
  | { kind: 'AMBIGUOUS'; useCase: TriggerUseCase }
  | { kind: 'NONE' };

/** The same explicit mapping is used by validation and by runtime routing. */
export function explicitUseCaseTargets(config: BusinessConfig): Map<TriggerUseCase, Set<string>> {
  const targets = new Map<TriggerUseCase, Set<string>>();
  for (const intent of config.capabilities?.intents || []) {
    if (!intent.useCases?.length) continue;
    const workflowIds = new Set<string>();
    if (intent.workflowId && config.workflows?.[intent.workflowId]) workflowIds.add(intent.workflowId);
    for (const [workflowId, workflow] of Object.entries(config.workflows || {})) {
      if (workflow.activation?.intents?.includes(intent.id)) workflowIds.add(workflowId);
    }
    for (const useCase of intent.useCases) {
      let group = targets.get(useCase);
      if (!group) {
        group = new Set<string>();
        targets.set(useCase, group);
      }
      for (const workflowId of workflowIds) group.add(workflowId);
    }
  }
  return targets;
}

function phraseMatches(message: string, phrase: string): boolean {
  const user = normalizeTriggerText(message);
  const target = normalizeTriggerText(phrase);
  return Boolean(user && target && (` ${user} `).includes(` ${target} `));
}

/**
 * Pure policy layer: recognize a request once, then route using explicit tenant
 * configuration. Display names and workflow descriptions never authorize an
 * action. Unknown service purchases fail closed with a clarification.
 */
export class WorkflowRoutingPolicy {
  static resolve(content: string, config: BusinessConfig, turnDecision?: TurnDecision, recognizedUseCases?: TriggerUseCase[]): WorkflowRouteDecision {
    const workflows = config.workflows || {};
    const entries = Object.entries(workflows);
    const normalized = normalizeTriggerText(content);
    if (!normalized) return { kind: 'NONE' };

    const useCases = recognizedUseCases || IntentTriggerLibrary.match(content).map(match => match.useCase);
    const explicitTargets = explicitUseCaseTargets(config);
    const matchedTargets = new Set<string>();
    let matchedUseCase: TriggerUseCase | undefined;
    for (const useCase of useCases) {
      const ids = explicitTargets.get(useCase);
      if (!ids?.size) continue;
      if (ids.size !== 1) return { kind: 'AMBIGUOUS', useCase };
      matchedUseCase ||= useCase;
      for (const id of ids) matchedTargets.add(id);
    }
    if (matchedTargets.size > 1) return { kind: 'AMBIGUOUS', useCase: matchedUseCase! };
    if (matchedTargets.size === 1) {
      const workflowId = [...matchedTargets][0];
      return { kind: 'WORKFLOW', workflowId, workflowConfig: workflows[workflowId], source: 'USE_CASE', useCase: matchedUseCase };
    }

    for (const [workflowId, workflow] of entries) {
      if (workflow.activation?.mode === 'auto_start' || (config as any).autoStartWorkflow === true) {
        return { kind: 'WORKFLOW', workflowId, workflowConfig: workflow, source: 'AUTO' };
      }
      if (workflow.activation?.allowManualStart !== false &&
          (['start', 'begin', 'commencer', 'demarrer', 'ابدأ'].includes(normalized) ||
            normalized === normalizeTriggerText(workflowId.replace(/_/g, ' ')))) {
        return { kind: 'WORKFLOW', workflowId, workflowConfig: workflow, source: 'MANUAL' };
      }
    }

    const intents = config.capabilities?.intents || [];
    for (const [workflowId, workflow] of entries) {
      const linked = intents.filter(intent => intent.workflowId === workflowId || workflow.activation?.intents?.includes(intent.id));
      for (const intent of linked) {
        if (turnDecision?.intent?.toLowerCase() === intent.id.toLowerCase() ||
            normalized === normalizeTriggerText(intent.id.replace(/_/g, ' '))) {
          return { kind: 'WORKFLOW', workflowId, workflowConfig: workflow, source: 'INTENT' };
        }
        if (intent.keywords?.some(keyword => phraseMatches(content, keyword))) {
          return { kind: 'WORKFLOW', workflowId, workflowConfig: workflow, source: 'KEYWORD' };
        }
      }
      const legacyKeywords = [...(workflow.activation?.keywords || []), ...(((workflow as any).keywords || []) as string[])];
      if (legacyKeywords.some(keyword => phraseMatches(content, keyword))) {
        return { kind: 'WORKFLOW', workflowId, workflowConfig: workflow, source: 'KEYWORD' };
      }
    }

    // Commerce accounts retain their catalog/checkout route. A service account
    // without an explicit purchase mapping must not guess from workflow names.
    // Other legacy intents remain classifier-compatible until a tenant opts in.
    if (useCases.includes('PURCHASE') && !config.capabilities?.ecommerceEnabled &&
        !isActionNegated(content, 'purchase')) {
      return { kind: 'UNMAPPED_PURCHASE', useCase: 'PURCHASE' };
    }
    return { kind: 'NONE' };
  }
}
