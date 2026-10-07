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
  missingField: 'عفاك عطينا {{fieldName}}.',
  confirmation: "هادو هما المعلومات اللي عطيتينا:\n{{summary}}\n\nواش نسجلو طلب الديمو؟ جاوب بـ «واخا» أو «لا».",
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

export class ResponseBuilder {
  private fieldLabel(fieldName: string, state: WorkflowStateConfig | undefined, lang: string, script?: string): string {
    if (state?.label?.trim()) return state.label.trim();
    const labels: Record<string, Record<string, string>> = {
      fullName: { en: 'your full name', fr: 'votre nom complet', ar: 'الاسم الكامل', darija: 'smitk kamla', darija_arabic: 'السمية الكاملة' },
      businessNeed: { en: 'what you need the chatbot for', fr: 'votre besoin', ar: 'احتياجك', darija: '3lach bghiti chatbot', darija_arabic: 'شنو بغيتي الشات بوت يعاونك فيه' },
      preferredDemoTime: { en: 'your preferred day and time', fr: 'le jour et l\'heure qui vous conviennent', ar: 'اليوم والوقت المناسبين', darija: 'nhar w lwe9t li ynasbk', darija_arabic: 'النهار والوقت اللي كيناسبوك' },
      phone: { en: 'your phone number', fr: 'votre numéro de téléphone', ar: 'رقم الهاتف', darija: 'nemra dyal telephone', darija_arabic: 'نمرة التليفون' }
    };
    const key = lang === 'darija' && script === 'arabic' ? 'darija_arabic' : lang;
    return labels[fieldName]?.[key] || state?.name?.trim() || fieldName;
  }

  buildMissingFieldResponse(state: WorkflowStateConfig, config: BusinessConfig, lang: string = 'en', script?: string): string {
    const field = state.field;
    const rawFieldName = typeof field === 'string' ? field : (field?.name || 'missing information');
    const fieldName = this.fieldLabel(rawFieldName, state, lang, script);
    const fieldFallback = getWorkflowMessage('missingField', lang, script).replace('{{fieldName}}', fieldName);
    if (state.prompt) {
      const defaultP = lang === 'darija' && script ? fieldFallback : typeof state.prompt === 'string' ? state.prompt : (state.prompt.en || '');
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

  buildValidationErrorResponse(error: string, lang: string = 'en', script?: string): string {
    if (lang === 'en') return error;
    const languageKey = lang === 'darija' && script === 'arabic' ? 'darija_arabic' : lang;
    const values = error.match(/-?\d+(?:\.\d+)?/g) || [];
    const firstValue = values[0] || '';
    const options = error.match(/^Value must be one of: (.+)\.$/)?.[1] || '';
    const messages: Record<string, Record<string, string>> = {
      fr: {
        string: 'Veuillez saisir un texte valide.', number: 'Veuillez saisir un nombre valide.', boolean: 'Veuillez choisir oui ou non.',
        email: 'Veuillez saisir une adresse e-mail valide.', phone: 'Veuillez saisir un numéro de téléphone valide.', time: 'Veuillez saisir une heure valide.',
        enum: `Veuillez choisir parmi ces options : ${options}.`, minLength: `La réponse doit contenir au moins ${firstValue} caractères.`,
        maxLength: `La réponse ne doit pas dépasser ${firstValue} caractères.`, min: `La valeur doit être au moins ${firstValue}.`,
        max: `La valeur ne doit pas dépasser ${firstValue}.`, date: 'Veuillez saisir une date valide.', format: 'Le format de la réponse est invalide.'
      },
      ar: {
        string: 'يرجى إدخال نص صحيح.', number: 'يرجى إدخال رقم صحيح.', boolean: 'يرجى اختيار نعم أو لا.',
        email: 'يرجى إدخال بريد إلكتروني صحيح.', phone: 'يرجى إدخال رقم هاتف صحيح.', time: 'يرجى إدخال وقت صحيح.',
        enum: `يرجى الاختيار من بين هذه الخيارات: ${options}.`, minLength: `يجب ألا تقل الإجابة عن ${firstValue} أحرف.`,
        maxLength: `يجب ألا تتجاوز الإجابة ${firstValue} أحرف.`, min: `يجب ألا تقل القيمة عن ${firstValue}.`,
        max: `يجب ألا تتجاوز القيمة ${firstValue}.`, date: 'يرجى إدخال تاريخ صحيح.', format: 'صيغة الإجابة غير صحيحة.'
      },
      darija: {
        string: '3afak kteb jawab s7i7.', number: '3afak kteb ra9m s7i7.', boolean: '3afak khtar ih wla la.',
        email: '3afak kteb email s7i7.', phone: '3afak kteb nemra dyal telephone s7i7a.', time: '3afak kteb lwe9t b tari9a s7i7a.',
        enum: `3afak khtar mn had l-ikhtiyarat: ${options}.`, minLength: `l-jawab khaso ykoun fih 3la l-a9al ${firstValue} 7orof.`,
        maxLength: `l-jawab ma khasoch yfout ${firstValue} 7orof.`, min: `l-9ima khas-ha tkoun 3la l-a9al ${firstValue}.`,
        max: `l-9ima ma khas-hach tfout ${firstValue}.`, date: '3afak kteb tarikh s7i7.', format: 'had format ma s7i7ch.'
      },
      darija_arabic: {
        string: 'عفاك كتب جواب صحيح.', number: 'عفاك كتب رقم صحيح.', boolean: 'عفاك اختار «واخا» أو «لا».',
        email: 'عفاك كتب إيميل صحيح.', phone: 'عفاك كتب نمرة تليفون صحيحة.', time: 'عفاك كتب الوقت بطريقة صحيحة.',
        enum: `عفاك اختار من هاد الاختيارات: ${options}.`, minLength: `الجواب خاصو يكون فيه على الأقل ${firstValue} حروف.`,
        maxLength: `الجواب ما خاصوش يفوت ${firstValue} حروف.`, min: `القيمة خاصها تكون على الأقل ${firstValue}.`,
        max: `القيمة ما خاصهاش تفوت ${firstValue}.`, date: 'عفاك كتب تاريخ صحيح.', format: 'هاد الصيغة ما صحيحةش.'
      }
    };
    const key = error === 'Value must be a string.' ? 'string'
      : error === 'Value must be a number.' ? 'number'
      : error === 'Value must be a boolean.' ? 'boolean'
      : error === 'Value must be a valid email address.' ? 'email'
      : error === 'Value must be a valid phone number.' ? 'phone'
      : error === 'Value must be a valid time.' ? 'time'
      : error.startsWith('Value must be one of:') ? 'enum'
      : error.startsWith('Length must be at least') ? 'minLength'
      : error.startsWith('Length must be at most') ? 'maxLength'
      : error.startsWith('Value must be at least') ? 'min'
      : error.startsWith('Value must be at most') ? 'max'
      : error === 'Value must be a valid date.' ? 'date'
      : 'format';
    return messages[languageKey]?.[key] || error;
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
    const checkoutLabels: Record<string, Record<string, string>> = {
      en: { product: 'Product', quantity: 'Quantity', customer_name: 'Customer name', fullName: 'Full name', businessNeed: 'Need', preferredDemoTime: 'Preferred demo time', phone: 'Phone', city: 'City', address: 'Address' },
      fr: { product: 'Produit', quantity: 'Quantité', customer_name: 'Nom', fullName: 'Nom complet', businessNeed: 'Besoin', preferredDemoTime: 'Créneau souhaité', phone: 'Téléphone', city: 'Ville', address: 'Adresse' },
      ar: { product: 'المنتج', quantity: 'الكمية', customer_name: 'الاسم', fullName: 'الاسم الكامل', businessNeed: 'الاحتياج', preferredDemoTime: 'الموعد المفضل', phone: 'الهاتف', city: 'المدينة', address: 'العنوان' },
      darija: { product: 'Lproduit', quantity: 'L3adad', customer_name: 'Smiya', fullName: 'Smiya kamla', businessNeed: 'Chno bghiti chatbot y3awnek fih', preferredDemoTime: 'Nhar w lwe9t li ynasbk', phone: 'Téléphone', city: 'Lmdina', address: 'L3onwan' },
      darija_arabic: { product: 'المنتوج', quantity: 'العدد', customer_name: 'السمية', fullName: 'السمية', businessNeed: 'الاحتياج', preferredDemoTime: 'الموعد المفضل', phone: 'نمرة التليفون', city: 'المدينة', address: 'العنوان' }
    };
    const labelLanguage = lang === 'darija' && script === 'arabic' ? 'darija_arabic' : lang;
    const summary = Object.entries(contextData)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, val]) => `${checkoutLabels[labelLanguage]?.[key] || key}: ${val}`)
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
