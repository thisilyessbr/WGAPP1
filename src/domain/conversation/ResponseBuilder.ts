import { BusinessConfig, WorkflowStateConfig, resolveLocalizedPrompt } from '../../domain/tenant/BusinessConfig';

export const DEFAULT_WORKFLOW_MESSAGES = {
  missingField: {
    en: 'Please provide: {{fieldName}}',
    fr: 'Veuillez fournir : {{fieldName}}',
    ar: 'يرجى تقديم: {{fieldName}}',
    darija: '3afak 3tina: {{fieldName}}'
  },
  confirmation: {
    en: "Please confirm the following details:\n{{summary}}\n\n(Reply 'yes' to confirm or 'no' to cancel)",
    fr: "Veuillez confirmer les détails suivants :\n{{summary}}\n\n(Répondez 'oui' pour confirmer ou 'non' pour annuler)",
    ar: "يرجى تأكيد التفاصيل التالية:\n{{summary}}\n\n(أجب بـ 'نعم' للتأكيد أو 'لا' للإلغاء)",
    darija: "3afak akkid had l-ma3loumat:\n{{summary}}\n\n(jawb b 'ih' / 'wakha' bach t-akked awla 'la' bach t-anuli)"
  },
  choice: {
    en: 'Please choose an option:',
    fr: 'Veuillez choisir une option :',
    ar: 'يرجى اختيار أحد الخيارات:',
    darija: '3afak khtar wahd mn l-ikhtiyarat:'
  },
  choiceReprompt: {
    en: 'Please choose an option to continue:',
    fr: 'Veuillez choisir une option pour continuer :',
    ar: 'يرجى اختيار خيار للمتابعة:',
    darija: '3afak khtar kheyart bach tkemel:'
  },
  fallback: {
    en: 'I did not understand that. Could you rephrase?',
    fr: "Je n'ai pas compris. Pourriez-vous reformuler ?",
    ar: 'لم أفهم ذلك. هل يمكنك إعادة الصياغة؟',
    darija: 'mafhemtch mezyan. 3afak 3awed chr7 liya?'
  },
  completion: {
    en: 'Thank you — a member of our team will contact you shortly.',
    fr: 'Merci — un membre de notre équipe vous contactera sous peu.',
    ar: 'شكراً لك — سيتواصل معك أحد أعضاء فريقنا قريباً.',
    darija: 'chokran — wahd mn l-fariq dyalna ghadi y-ttasel bik 9riban.'
  },
  choiceRedirect: {
    en: "Let's finish this first — please choose one of the options below:",
    fr: "Terminons d'abord ceci — veuillez choisir l'une des options ci-dessous :",
    ar: "دعنا نكمل هذا أولاً — يرجى اختيار أحد الخيارات أدناه:",
    darija: "nkhemlou hadchi lowel 3afak — khtar wahd mn had l-kheyarat:"
  },
  collectFallback: {
    en: "I can help with questions related to your request. Let's finish this first:",
    fr: "Je peux vous aider avec les questions liées à votre demande. Terminons d'abord ceci :",
    ar: "يمكنني المساعدة في الأسئلة المتعلقة بطلبك. دعنا نكمل هذا أولاً:",
    darija: "n9der n3awnek f l-as'ila dyal talab dyalek. nkhemlou hadchi lowel:"
  },
  workflowCancelled: {
    en: 'Workflow cancelled.',
    fr: 'Processus annulé.',
    ar: 'تم إلغاء العملية.',
    darija: 't-anulat l-3amaliya.'
  },
  workflowUnavailable: {
    en: 'This workflow is no longer available.',
    fr: "Ce processus n'est plus disponible.",
    ar: 'هذا المسار لم يعد متاحاً.',
    darija: 'had l-workflow ma b9ach mota7.'
  }
};

export class ResponseBuilder {
  buildMissingFieldResponse(state: WorkflowStateConfig, config: BusinessConfig, lang: string = 'en'): string {
    const field = state.field;
    if (state.prompt) return resolveLocalizedPrompt(state.prompt, lang, state.prompt);
    if (typeof field !== 'string' && field?.extractionPrompt) {
      return resolveLocalizedPrompt(field.extractionPrompt, lang, field.extractionPrompt);
    }

    const fieldName = typeof field === 'string' ? field : (field?.name || 'missing information');
    const defaultTpl = DEFAULT_WORKFLOW_MESSAGES.missingField[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.missingField] || DEFAULT_WORKFLOW_MESSAGES.missingField.en;
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.missingField);

    let template = defaultTpl;
    const customPrompt = config.prompts?.missingFieldPrompt || config.prompts?.workflow;
    if (customPrompt && typeof customPrompt === 'string' && !defaultVals.includes(customPrompt)) {
      template = resolveLocalizedPrompt(customPrompt, lang, defaultTpl);
    } else if (customPrompt && typeof customPrompt === 'object') {
      template = resolveLocalizedPrompt(customPrompt, lang, defaultTpl);
    }

    return template.replace('{{fieldName}}', fieldName);
  }

  buildConfirmationResponse(
    contextData: Record<string, any>,
    config: BusinessConfig,
    state?: WorkflowStateConfig,
    lang: string = 'en'
  ): string {
    const summary = Object.entries(contextData)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, val]) => `${key}: ${val}`)
      .join('\n');

    if (state?.prompt && state.prompt !== 'confirm') {
      const localized = resolveLocalizedPrompt(state.prompt, lang, state.prompt);
      return localized.replace('{{summary}}', summary);
    }

    const defaultTpl = DEFAULT_WORKFLOW_MESSAGES.confirmation[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.confirmation] || DEFAULT_WORKFLOW_MESSAGES.confirmation.en;
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.confirmation);

    let template = defaultTpl;
    if (config.prompts?.confirmationPrompt && typeof config.prompts.confirmationPrompt === 'string' && !defaultVals.includes(config.prompts.confirmationPrompt)) {
      template = resolveLocalizedPrompt(config.prompts.confirmationPrompt, lang, defaultTpl);
    } else if (config.prompts?.confirmationPrompt && typeof config.prompts.confirmationPrompt === 'object') {
      template = resolveLocalizedPrompt(config.prompts.confirmationPrompt, lang, defaultTpl);
    }
    return template.replace('{{summary}}', summary);
  }

  buildChoiceResponse(state: WorkflowStateConfig, lang: string = 'en'): string {
    const defaultPrompt = DEFAULT_WORKFLOW_MESSAGES.choice[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.choice] || DEFAULT_WORKFLOW_MESSAGES.choice.en;
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.choice);
    const prompt = state.prompt && (!defaultVals.includes(state.prompt) || typeof state.prompt === 'object')
      ? resolveLocalizedPrompt(state.prompt, lang, defaultPrompt)
      : defaultPrompt;
    if (!state.options || state.options.length === 0) {
      return prompt;
    }
    const optionsList = state.options
      .map((opt, idx) => `${idx + 1}. ${opt.label}`)
      .join('\n');
    return `${prompt}\n\n${optionsList}`;
  }

  buildChoiceReprompt(state: WorkflowStateConfig, repromptPrompt?: string, lang: string = 'en'): string {
    const defaultReprompt = DEFAULT_WORKFLOW_MESSAGES.choiceReprompt[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.choiceReprompt] || DEFAULT_WORKFLOW_MESSAGES.choiceReprompt.en;
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.choiceReprompt);
    const prompt = repromptPrompt && (!defaultVals.includes(repromptPrompt) || typeof repromptPrompt === 'object')
      ? resolveLocalizedPrompt(repromptPrompt, lang, defaultReprompt)
      : defaultReprompt;

    if (!state.options || state.options.length === 0) {
      return prompt;
    }
    const optionsList = state.options
      .map((opt, idx) => `${idx + 1}. ${opt.label}`)
      .join('\n');
    return `${prompt}\n\n${optionsList}`;
  }

  buildGenericResponse(state: WorkflowStateConfig, config: BusinessConfig, lang: string = 'en'): string {
    if (state.prompt) return resolveLocalizedPrompt(state.prompt, lang, state.prompt);
    const defaultFallback = DEFAULT_WORKFLOW_MESSAGES.fallback[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.fallback] || DEFAULT_WORKFLOW_MESSAGES.fallback.en;
    return resolveLocalizedPrompt(config.prompts?.fallback, lang, defaultFallback);
  }
}
