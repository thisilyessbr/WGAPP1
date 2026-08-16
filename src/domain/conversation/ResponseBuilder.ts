import { BusinessConfig, WorkflowStateConfig } from '../../domain/tenant/BusinessConfig';

export class ResponseBuilder {
  buildMissingFieldResponse(state: WorkflowStateConfig, config: BusinessConfig): string {
    const field = state.field;
    if (state.prompt) return state.prompt;
    if (field?.extractionPrompt) return field.extractionPrompt;

    const fieldName = field?.name || 'missing information';
    if (config.prompts.missingFieldPrompt) {
      return config.prompts.missingFieldPrompt.replace('{{fieldName}}', fieldName);
    }

    if (config.prompts.workflow) {
      return config.prompts.workflow.replace('{{fieldName}}', fieldName);
    }

    return `Please provide: ${fieldName}`;
  }

  buildConfirmationResponse(contextData: Record<string, any>, config: BusinessConfig, state?: WorkflowStateConfig): string {
    const summary = Object.entries(contextData)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, val]) => `${key}: ${val}`)
      .join('\n');

    if (state?.prompt && state.prompt !== 'confirm') {
      return state.prompt.replace('{{summary}}', summary);
    }

    const template = config.prompts.confirmationPrompt || 'Please confirm the following details:\n{{summary}}\n\n(Reply \'yes\' to confirm or \'no\' to cancel)';
    return template.replace('{{summary}}', summary);
  }

  buildChoiceResponse(state: WorkflowStateConfig): string {
    const prompt = state.prompt || 'Please choose an option:';
    if (!state.options || state.options.length === 0) {
      return prompt;
    }
    const optionsList = state.options
      .map((opt, idx) => `${idx + 1}. ${opt.label}`)
      .join('\n');
    return `${prompt}\n\n${optionsList}`;
  }

  buildChoiceReprompt(state: WorkflowStateConfig, repromptPrompt?: string): string {
    const prompt = repromptPrompt || 'Please choose an option to continue:';
    if (!state.options || state.options.length === 0) {
      return prompt;
    }
    const optionsList = state.options
      .map((opt, idx) => `${idx + 1}. ${opt.label}`)
      .join('\n');
    return `${prompt}\n\n${optionsList}`;
  }

  buildGenericResponse(state: WorkflowStateConfig, config: BusinessConfig): string {
    if (state.prompt) return state.prompt;
    if (typeof config.prompts.fallback === 'string') return config.prompts.fallback;
    return config.prompts.fallback?.en || 'I did not understand that. Could you rephrase?';
  }
}
