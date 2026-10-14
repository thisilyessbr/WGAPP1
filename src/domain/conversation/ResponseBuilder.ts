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

const DARIJA_ARABIC_WORKFLOW_MESSAGES: Record<keyof typeof DEFAULT_WORKFLOW_MESSAGES, string> = {
  missingField: 'عفاك عطينا: {{fieldName}}',
  confirmation: "عفاك أكد هاد المعلومات:\n{{summary}}\n\n(جاوب بواخا باش تأكد، أو لا باش تلغي)",
  choice: 'عفاك اختار واحد من هاد الاختيارات:',
  choiceReprompt: 'عفاك اختار واحد من هاد الاختيارات باش نكملو:',
  fallback: 'سمح ليا، ما فهمتش مزيان. عفاك عاود شرح ليا.',
  completion: 'شكرا! تسجلات المعلومات ديالك.',
  choiceRedirect: 'نكملو هاد الطلب اللول، عفاك اختار واحد من هاد الاختيارات:',
  collectFallback: 'نقدر نعاونك فالأسئلة ديال الطلب ديالك. نكملو هاد الخطوة اللولة:',
  workflowCancelled: 'تلغى الطلب ديالك.',
  workflowUnavailable: 'هاد الخدمة ما بقاتش متوفرة.'
};

export function getWorkflowMessage(key: keyof typeof DEFAULT_WORKFLOW_MESSAGES, lang: string, script?: string): string {
  if (lang === 'darija' && script === 'arabic') return DARIJA_ARABIC_WORKFLOW_MESSAGES[key];
  return DEFAULT_WORKFLOW_MESSAGES[key][lang as 'en' | 'fr' | 'ar' | 'darija'] || DEFAULT_WORKFLOW_MESSAGES[key].en;
}

/** Natural Darija questions for the order fields Moroccan shops collect most. */
const DARIJA_FIELD_QUESTIONS: { pattern: RegExp; arabizi: string; arabic: string }[] = [
  { pattern: /^(?:product|productname|item|itemname|produit|article)$/i, arabizi: 'Chno howa l-produit li bghiti?', arabic: 'شنو هو المنتوج اللي بغيتي؟' },
  { pattern: /^(?:size|taille|pointure|sizecolor|variant|variante)$/i, arabizi: 'Chmen taille w chmen lon bghiti?', arabic: 'شمن مقاس وشمن لون بغيتي؟' },
  { pattern: /^(?:colou?r|couleur)$/i, arabizi: 'Chmen lon bghiti?', arabic: 'شمن لون بغيتي؟' },
  { pattern: /^(?:quantity|qty|quantite|quantité)$/i, arabizi: 'Ch7al mn wa7da bghiti?', arabic: 'شحال من وحدة بغيتي؟' },
  { pattern: /^(?:name|fullname|customername|nom|nomcomplet)$/i, arabizi: '3afak 3tini smitek l-kamla.', arabic: 'عافاك عطيني سميتك الكاملة.' },
  { pattern: /^(?:city|ville|town)$/i, arabizi: 'F ina mdina nta? W 3tini l-3onwan 3afak.', arabic: 'فاشمن مدينة نتا؟ وعطيني العنوان عافاك.' },
  { pattern: /^(?:address|adresse|deliveryaddress)$/i, arabizi: '3afak 3tini l-3onwan dyal l-livraison.', arabic: 'عافاك عطيني العنوان ديال التوصيل.' },
  { pattern: /^(?:phone|phonenumber|telephone|tel|mobile|numero)$/i, arabizi: '3tini nmra dyal tilifoun dyalek 3afak.', arabic: 'عطيني النمرة ديال التيليفون ديالك عافاك.' }
];

function darijaFieldQuestion(fieldName: string, script?: string): string | undefined {
  if (script !== 'arabizi' && script !== 'arabic') return undefined;
  const key = fieldName.replace(/[\s_-]/g, '');
  const hit = DARIJA_FIELD_QUESTIONS.find(q => q.pattern.test(key));
  return hit ? (script === 'arabizi' ? hit.arabizi : hit.arabic) : undefined;
}

export class ResponseBuilder {
  buildMissingFieldResponse(state: WorkflowStateConfig, config: BusinessConfig, lang: string = 'en', script?: string): string {
    const field = state.field;
    const fieldName = typeof field === 'string' ? field : (field?.name || 'missing information');
    const fieldFallback = getWorkflowMessage('missingField', lang, script).replace('{{fieldName}}', fieldName);
    if (state.prompt) {
      // Merchants usually write the Darija question in Arabic script only. For
      // a Darija customer in the other script, the merchant's own French
      // (Arabizi readers) or Arabic question beats a raw field key such as
      // "3afak 3tina: size".
      const sameScriptQuestion = (lang === 'darija' ? darijaFieldQuestion(fieldName, script) : undefined)
        ?? (typeof state.prompt === 'object'
          ? (script === 'arabizi' ? state.prompt.fr : script === 'arabic' ? state.prompt.ar : undefined)
          : undefined);
      const darijaDefault = typeof sameScriptQuestion === 'string' && sameScriptQuestion.trim() ? sameScriptQuestion : fieldFallback;
      const defaultP = lang === 'darija' && script ? darijaDefault : typeof state.prompt === 'string' ? state.prompt : (state.prompt.en || '');
      return resolveLocalizedPrompt(state.prompt, lang, defaultP, script);
    }
    if (typeof field !== 'string' && field?.extractionPrompt) {
      const defaultP = field.extractionPrompt;
      return resolveLocalizedPrompt(field.extractionPrompt, lang, lang === 'darija' && script ? fieldFallback : defaultP, script);
    }

    const defaultTpl = getWorkflowMessage('missingField', lang, script);
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.missingField);

    let template = defaultTpl;
    const customPrompt = config.prompts?.missingFieldPrompt || config.prompts?.workflow;
    if (customPrompt && typeof customPrompt === 'string' && !defaultVals.includes(customPrompt)) {
      template = resolveLocalizedPrompt(customPrompt, lang, defaultTpl, script);
    } else if (customPrompt && typeof customPrompt === 'object') {
      template = resolveLocalizedPrompt(customPrompt, lang, defaultTpl, script);
    }

    return template.replace('{{fieldName}}', fieldName);
  }

  /**
   * Generic deterministic template interpolation helper.
   * Supports both {fieldName} and {{fieldName}}, as well as {summary} and {{summary}}.
   * Ignores internal keys beginning with '_'.
   * Replaces null/undefined with empty string.
   */
  public static interpolateTemplate(template: string, data: Record<string, unknown>): string {
    if (!template || typeof template !== 'string') return '';
    return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}|\{([a-zA-Z0-9_]+)\}/g, (_match, p1, p2) => {
      const key = p1 || p2;
      if (!key || key.startsWith('_')) {
        return '';
      }
      const val = data[key];
      if (val === null || val === undefined) {
        return '';
      }
      return String(val);
    });
  }

  buildConfirmationResponse(
    contextData: Record<string, any>,
    config: BusinessConfig,
    state?: WorkflowStateConfig,
    lang: string = 'en',
    script?: string
  ): string {
    const summary = Object.entries(contextData)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, val]) => `${key}: ${val}`)
      .join('\n');

    const interpolationData: Record<string, unknown> = {
      ...contextData,
      summary
    };

    if (state?.prompt && state.prompt !== 'confirm') {
      const defaultP = lang === 'darija' && script ? getWorkflowMessage('confirmation', lang, script) : typeof state.prompt === 'string' ? state.prompt : (state.prompt.en || '');
      const localized = resolveLocalizedPrompt(state.prompt, lang, defaultP, script);
      return ResponseBuilder.interpolateTemplate(localized, interpolationData);
    }

    const defaultTpl = getWorkflowMessage('confirmation', lang, script);
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.confirmation);

    let template = defaultTpl;
    if (config.prompts?.confirmationPrompt && typeof config.prompts.confirmationPrompt === 'string' && !defaultVals.includes(config.prompts.confirmationPrompt)) {
      template = resolveLocalizedPrompt(config.prompts.confirmationPrompt, lang, defaultTpl, script);
    } else if (config.prompts?.confirmationPrompt && typeof config.prompts.confirmationPrompt === 'object') {
      template = resolveLocalizedPrompt(config.prompts.confirmationPrompt, lang, defaultTpl, script);
    }
    return ResponseBuilder.interpolateTemplate(template, interpolationData);
  }

  buildChoiceResponse(state: WorkflowStateConfig, lang: string = 'en', script?: string): string {
    const defaultPrompt = getWorkflowMessage('choice', lang, script);
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.choice);
    const prompt = state.prompt && (!defaultVals.includes(state.prompt as string) || typeof state.prompt === 'object')
      ? resolveLocalizedPrompt(state.prompt, lang, defaultPrompt, script)
      : defaultPrompt;
    if (!state.options || state.options.length === 0) {
      return prompt;
    }
    const optionsList = state.options
      .map((opt, idx) => `${idx + 1}. ${opt.label}`)
      .join('\n');
    return `${prompt}\n\n${optionsList}`;
  }

  buildChoiceReprompt(state: WorkflowStateConfig, repromptPrompt?: string, lang: string = 'en', script?: string): string {
    const defaultReprompt = getWorkflowMessage('choiceReprompt', lang, script);
    const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.choiceReprompt);
    const prompt = repromptPrompt && (!defaultVals.includes(repromptPrompt) || typeof repromptPrompt === 'object')
      ? resolveLocalizedPrompt(repromptPrompt, lang, defaultReprompt, script)
      : defaultReprompt;

    if (!state.options || state.options.length === 0) {
      return prompt;
    }
    const optionsList = state.options
      .map((opt, idx) => `${idx + 1}. ${opt.label}`)
      .join('\n');
    return `${prompt}\n\n${optionsList}`;
  }

  buildGenericResponse(state: WorkflowStateConfig, config: BusinessConfig, lang: string = 'en', script?: string): string {
    if (state.prompt) {
      const defaultP = lang === 'darija' && script ? getWorkflowMessage('fallback', lang, script) : typeof state.prompt === 'string' ? state.prompt : (state.prompt.en || '');
      return resolveLocalizedPrompt(state.prompt, lang, defaultP, script);
    }
    const defaultFallback = getWorkflowMessage('fallback', lang, script);
    return resolveLocalizedPrompt(config.prompts?.fallback, lang, defaultFallback, script);
  }
}
