import { BusinessConfig, WorkflowStateConfig, resolveLocalizedPrompt } from '../../domain/tenant/BusinessConfig';

export const DEFAULT_WORKFLOW_MESSAGES = {
  missingField: {
    en: 'Could you share {{fieldName}}, please?',
    fr: "Pourriez-vous m'indiquer {{fieldName}}, s'il vous plaît ?",
    ar: 'هل يمكنك تزويدي ب{{fieldName}} من فضلك؟',
    darija: '3afak, 3tini {{fieldName}}.'
  },
  confirmation: {
    en: 'Here is a summary of your request:\n{{summary}}\n\nIs everything correct? Reply "yes" to confirm or "no" to cancel.',
    fr: 'Voici le récapitulatif de votre demande :\n{{summary}}\n\nTout est correct ? Répondez « oui » pour confirmer ou « non » pour annuler.',
    ar: 'هذا ملخص طلبك:\n{{summary}}\n\nهل كل المعلومات صحيحة؟ أجب بـ«نعم» للتأكيد أو «لا» للإلغاء.',
    darija: 'Hahouma l-ma3lomat dyal talab dyalek:\n{{summary}}\n\nKolchi mzyan? Jawb b "wakha" bach t2akked wla "la" bach nlghiwh.'
  },
  choice: {
    en: 'Which option would you like?',
    fr: 'Quelle option vous convient ?',
    ar: 'أي خيار تفضّل؟',
    darija: 'Achmen ikhtiyar bghiti?'
  },
  choiceReprompt: {
    en: 'Just choose one of these options so we can continue:',
    fr: "Choisissez simplement l'une de ces options pour continuer :",
    ar: 'يُرجى اختيار أحد هذه الخيارات لنكمل:',
    darija: 'Khtar wa7d mn had l-ikhtiyarat bach nkemlo:'
  },
  fallback: {
    en: "Sorry, I didn't quite catch that. Could you say it another way?",
    fr: "Désolé, je n'ai pas bien compris. Pouvez-vous le formuler autrement ?",
    ar: 'عذراً، لم أفهم قصدك تماماً. هل يمكنك توضيح ذلك بطريقة أخرى؟',
    darija: 'Smeh liya, ma fhemtch mzyan. Momkin tgoulha b tari9a khra?'
  },
  completion: {
    en: 'Thank you! Our team will contact you shortly.',
    fr: 'Merci ! Notre équipe vous contactera très bientôt.',
    ar: 'شكراً لك! سيتواصل معك فريقنا قريباً.',
    darija: "Chokran! L'équipe dyalna ghadi ttwasel m3ak 9riban."
  },
  choiceRedirect: {
    en: "Let's finish this step first. Please choose one of the options below:",
    fr: "Terminons d'abord cette étape. Choisissez l'une des options ci-dessous :",
    ar: 'لنكمل هذه الخطوة أولاً. يُرجى اختيار أحد الخيارات أدناه:',
    darija: 'Nkemlo had l-khatwa lwla. Khtar wa7d mn had l-ikhtiyarat:'
  },
  collectFallback: {
    en: "Happy to help with that. Let's first finish your request:",
    fr: "Avec plaisir. Terminons d'abord votre demande :",
    ar: 'بكل سرور. لنكمل طلبك أولاً:',
    darija: 'Mra7ba. Nkemlo talab dyalek lwel:'
  },
  workflowCancelled: {
    en: "No problem, I've cancelled this request. Let me know if you need anything else.",
    fr: "Pas de souci, j'ai annulé cette demande. Dites-moi si vous avez besoin d'autre chose.",
    ar: 'حسناً، تم إلغاء هذا الطلب. أخبرني إذا احتجت أي شيء آخر.',
    darija: 'Wakha, tlgha had talab. Ila bghiti chi haja khra, ana hna.'
  },
  workflowUnavailable: {
    en: 'This request is no longer available. How else can I help you?',
    fr: "Cette demande n'est plus disponible. Comment puis-je vous aider ?",
    ar: 'هذا الطلب لم يعد متاحاً. كيف يمكنني مساعدتك؟',
    darija: 'Had talab ma b9ach mota7. Kifach n9der n3awnek?'
  }
};

const DARIJA_ARABIC_WORKFLOW_MESSAGES: Record<keyof typeof DEFAULT_WORKFLOW_MESSAGES, string> = {
  missingField: 'عافاك، عطيني {{fieldName}}.',
  confirmation: 'هاهوما المعلومات ديال الطلب ديالك:\n{{summary}}\n\nكلشي مزيان؟ جاوب بـ«واخا» باش تأكد، ولا «لا» باش نلغيوه.',
  choice: 'شمن اختيار بغيتي؟',
  choiceReprompt: 'ختار واحد من هاد الاختيارات باش نكملو:',
  fallback: 'سمح ليا، ما فهمتش مزيان. ممكن تقولها بطريقة أخرى؟',
  completion: 'شكرا! الفريق ديالنا غادي يتواصل معاك قريب.',
  choiceRedirect: 'نكملو هاد الخطوة اللولة. ختار واحد من هاد الاختيارات:',
  collectFallback: 'مرحبا. نكملو الطلب ديالك اللول:',
  workflowCancelled: 'واخا، تلغى الطلب ديالك. إلا بغيتي شي حاجة أخرى، أنا هنا.',
  workflowUnavailable: 'هاد الطلب ما بقاش متوفر. كيفاش نقدر نعاونك؟'
};

/**
 * Earlier built-in texts. Tenant configs saved before a wording change keep a
 * copy of the old default; they are still treated as "default", so customers
 * get the current localized text instead of an old English string.
 */
const LEGACY_WORKFLOW_MESSAGES: Partial<Record<keyof typeof DEFAULT_WORKFLOW_MESSAGES, string[]>> = {
  missingField: ['Please provide: {{fieldName}}', 'Veuillez fournir : {{fieldName}}', 'يرجى تقديم: {{fieldName}}', '3afak 3tina: {{fieldName}}', 'عفاك عطينا {{fieldName}}.'],
  confirmation: ["Please confirm the following details:\n{{summary}}\n\n(Reply 'yes' to confirm or 'no' to cancel)",
    "Veuillez confirmer les détails suivants :\n{{summary}}\n\n(Répondez 'oui' pour confirmer ou 'non' pour annuler)",
    "يرجى تأكيد التفاصيل التالية:\n{{summary}}\n\n(أجب بـ 'نعم' للتأكيد أو 'لا' للإلغاء)",
    "3afak akkid had l-ma3loumat:\n{{summary}}\n\n(jawb b 'ih' / 'wakha' bach t-akked awla 'la' bach t-anuli)",
    'هادو هما المعلومات اللي عطيتينا:\n{{summary}}\n\nواش نسجلو طلب الديمو؟ جاوب بـ «واخا» أو «لا».'],
  choice: ['Please choose an option:', 'Veuillez choisir une option :', 'يرجى اختيار أحد الخيارات:', '3afak khtar wahd mn l-ikhtiyarat:', 'عفاك اختار واحد من هاد الاختيارات:'],
  choiceReprompt: ['Please choose an option to continue:', 'Veuillez choisir une option pour continuer :', 'يرجى اختيار خيار للمتابعة:', '3afak khtar kheyart bach tkemel:'],
  completion: ['Thank you — a member of our team will contact you shortly.', 'Merci — un membre de notre équipe vous contactera sous peu.',
    'شكراً لك — سيتواصل معك أحد أعضاء فريقنا قريباً.', 'chokran — wahd mn l-fariq dyalna ghadi y-ttasel bik 9riban.', 'شكرا! تسجلات المعلومات ديالك.'],
  choiceRedirect: ["Let's finish this first — please choose one of the options below:", "Terminons d'abord ceci — veuillez choisir l'une des options ci-dessous :",
    'دعنا نكمل هذا أولاً — يرجى اختيار أحد الخيارات أدناه:', 'nkhemlou hadchi lowel 3afak — khtar wahd mn had l-kheyarat:'],
  collectFallback: ["I can help with questions related to your request. Let's finish this first:", "Je peux vous aider avec les questions liées à votre demande. Terminons d'abord ceci :",
    'يمكنني المساعدة في الأسئلة المتعلقة بطلبك. دعنا نكمل هذا أولاً:', "n9der n3awnek f l-as'ila dyal talab dyalek. nkhemlou hadchi lowel:"],
  workflowUnavailable: ['This workflow is no longer available.', "Ce processus n'est plus disponible.", 'هذا المسار لم يعد متاحاً.', 'had l-workflow ma b9ach mota7.']
};

/** Every built-in text (current, Darija Arabic-script, earlier versions) for one message. */
export function defaultWorkflowValues(key: keyof typeof DEFAULT_WORKFLOW_MESSAGES): string[] {
  return [...Object.values(DEFAULT_WORKFLOW_MESSAGES[key]), DARIJA_ARABIC_WORKFLOW_MESSAGES[key], ...(LEGACY_WORKFLOW_MESSAGES[key] || [])];
}

export function getWorkflowMessage(key: keyof typeof DEFAULT_WORKFLOW_MESSAGES, lang: string, script?: string): string {
  if (lang === 'darija' && script === 'arabic') return DARIJA_ARABIC_WORKFLOW_MESSAGES[key];
  return DEFAULT_WORKFLOW_MESSAGES[key][lang as 'en' | 'fr' | 'ar' | 'darija'] || DEFAULT_WORKFLOW_MESSAGES[key].en;
}

/**
 * Built-in cancellation texts, current and previous. Stored tenant configs
 * often carry a copy of an old default ("Workflow cancelled."); treat those as
 * defaults so customers get the localized message, not technical wording.
 */
export const DEFAULT_CANCELLED_VALUES: string[] = [
  ...Object.values(DEFAULT_WORKFLOW_MESSAGES.workflowCancelled),
  DARIJA_ARABIC_WORKFLOW_MESSAGES.workflowCancelled,
  'Workflow cancelled.', 'Processus annulé.', 'تم إلغاء العملية.', 't-anulat l-3amaliya.', 'تلغى الطلب ديالك.'
];

/** Natural Darija questions for the order fields Moroccan shops collect most. */
const DARIJA_FIELD_QUESTIONS: { pattern: RegExp; arabizi: string; arabic: string }[] = [
  { pattern: /^(?:product|productname|item|itemname|produit|article)$/i, arabizi: 'Chno howa l-produit li bghiti?', arabic: 'شنو هو المنتوج اللي بغيتي؟' },
  { pattern: /^(?:size|taille|pointure|sizecolor|variant|variante)$/i, arabizi: 'Chmen taille w chmen lon bghiti?', arabic: 'شمن مقاس وشمن لون بغيتي؟' },
  { pattern: /^(?:colou?r|couleur)$/i, arabizi: 'Chmen lon bghiti?', arabic: 'شمن لون بغيتي؟' },
  { pattern: /^(?:quantity|qty|quantite|quantité)$/i, arabizi: 'Ch7al mn wa7da bghiti?', arabic: 'شحال من وحدة بغيتي؟' },
  { pattern: /^(?:service|services|servicename|prestation|soin|treatment)$/i, arabizi: 'Achmen service bghiti 3afak?', arabic: 'شمن خدمة بغيتي عافاك؟' },
  { pattern: /^(?:preferredtime|preferreddate|preferreddatetime|preferreddemotime|appointmenttime|appointmentdate|date|time|datetime|slot|creneau|créneau|day|rdv)$/i, arabizi: 'Achmen nhar w ach men sa3a kaynasbek?', arabic: 'أشمن نهار وأشمن ساعة كيناسبك؟' },
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
  private fieldLabel(fieldName: string, state: WorkflowStateConfig | undefined, lang: string, script?: string): string {
    if (state?.label?.trim()) return state.label.trim();
    const labels: Record<string, Record<string, string>> = {
      fullName: { en: 'your full name', fr: 'votre nom complet', ar: 'الاسم الكامل', darija: 'smitk kamla', darija_arabic: 'السمية الكاملة' },
      name: { en: 'your name', fr: 'votre nom', ar: 'الاسم الكامل', darija: 'smitk', darija_arabic: 'السميّة ديالك' },
      businessNeed: { en: 'what you need the chatbot for', fr: 'votre besoin', ar: 'احتياجك', darija: '3lach bghiti chatbot', darija_arabic: 'شنو بغيتي الشات بوت يعاونك فيه' },
      preferredDemoTime: { en: 'your preferred day and time', fr: 'le jour et l\'heure qui vous conviennent', ar: 'اليوم والوقت المناسبين', darija: 'nhar w lwe9t li ynasbk', darija_arabic: 'النهار والوقت اللي كيناسبوك' },
      phone: { en: 'your phone number', fr: 'votre numéro de téléphone', ar: 'رقم الهاتف', darija: 'nemra dyal telephone', darija_arabic: 'نمرة التليفون' }
    };
    const key = lang === 'darija' && script === 'arabic' ? 'darija_arabic' : lang;
    if (labels[fieldName]?.[key] || state?.name?.trim()) return labels[fieldName]?.[key] || state!.name!.trim();
    // Never ask for a raw key such as "customerEmail".
    const label = ResponseBuilder.summaryLabel(fieldName, key);
    return lang === 'en' ? `your ${label.toLowerCase()}` : lang === 'fr' ? `votre ${label.toLowerCase()}` : label;
  }

  buildMissingFieldResponse(state: WorkflowStateConfig, config: BusinessConfig, lang: string = 'en', script?: string): string {
    const field = state.field;
    const rawFieldName = typeof field === 'string' ? field : (field?.name || 'missing information');
    const fieldName = this.fieldLabel(rawFieldName, state, lang, script);
    const fieldFallback = getWorkflowMessage('missingField', lang, script).replace('{{fieldName}}', fieldName);
    if (state.prompt) {
      // Merchants usually write the Darija question in Arabic script only. For
      // a Darija customer in the other script, a natural per-field Darija
      // question (or the merchant's own French / Arabic question) beats a raw
      // field key such as "3afak 3tina: size".
      const darijaQuestion = lang === 'darija'
        ? (darijaFieldQuestion(rawFieldName, script) ?? darijaFieldQuestion(fieldName, script))
        : undefined;
      const sameScriptQuestion = darijaQuestion
        ?? (typeof state.prompt === 'object'
          ? (script === 'arabizi' ? state.prompt.fr : script === 'arabic' ? state.prompt.ar : undefined)
          : undefined);
      const darijaDefault = typeof sameScriptQuestion === 'string' && sameScriptQuestion.trim() ? sameScriptQuestion : fieldFallback;
      const defaultP = lang === 'darija' && script
        ? darijaDefault
        : (typeof state.prompt === 'string' && lang !== 'ar' ? state.prompt : fieldFallback);
      return resolveLocalizedPrompt(state.prompt, lang, defaultP, script);
    }
    if (typeof field !== 'string' && field?.extractionPrompt) {
      const defaultP = field.extractionPrompt;
      return resolveLocalizedPrompt(field.extractionPrompt, lang, lang === 'darija' && script ? fieldFallback : defaultP, script);
    }

    const defaultTpl = getWorkflowMessage('missingField', lang, script);
    const defaultVals = defaultWorkflowValues('missingField');

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

  /** Customer-facing label for a collected field; never a raw key such as "preferred_time". */
  static summaryLabel(key: string, language: string): string {
    const k = key.replace(/[\s_-]/g, '').toLowerCase();
    const kind = /^(?:name|fullname|customername|nom|nomcomplet|prenom)$/.test(k) ? 'name'
      : /^(?:phone|phonenumber|telephone|tel|mobile|numero|whatsapp)$/.test(k) ? 'phone'
      : /^(?:service|services|servicename|prestation|soin|treatment)$/.test(k) ? 'service'
      : /^(?:preferredtime|preferreddate|preferreddatetime|appointmenttime|appointmentdate|date|time|datetime|slot|creneau|day|rdv)$/.test(k) ? 'time'
      : /^(?:size|taille|pointure|sizecolor|variant)$/.test(k) ? 'size'
      : /^(?:colou?r|couleur)$/.test(k) ? 'color'
      : /^(?:city|ville|town)$/.test(k) ? 'city'
      : /^(?:address|adresse|deliveryaddress)$/.test(k) ? 'address'
      : /^(?:product|productname|item|produit|article)$/.test(k) ? 'product'
      : /^(?:email|mail|customeremail|emailaddress|adressemail)$/.test(k) ? 'email'
      : /^(?:note|notes|message|comment|comments|remarque)$/.test(k) ? 'note' : '';
    const labels: Record<string, Record<string, string>> = {
      en: { name: 'Name', phone: 'Phone', service: 'Service', time: 'Preferred time', size: 'Size', color: 'Colour', city: 'City', address: 'Address', product: 'Product', email: 'Email', note: 'Note' },
      fr: { name: 'Nom', phone: 'Téléphone', service: 'Prestation', time: 'Créneau souhaité', size: 'Taille', color: 'Couleur', city: 'Ville', address: 'Adresse', product: 'Produit', email: 'E-mail', note: 'Remarque' },
      ar: { name: 'الاسم', phone: 'الهاتف', service: 'الخدمة', time: 'الموعد المفضل', size: 'المقاس', color: 'اللون', city: 'المدينة', address: 'العنوان', product: 'المنتج', email: 'البريد الإلكتروني', note: 'ملاحظة' },
      darija: { name: 'Smiya', phone: 'Téléphone', service: 'Service', time: 'Nhar w sa3a', size: 'Taille', color: 'Lon', city: 'Lmdina', address: 'L3onwan', product: 'Lproduit', email: 'Email', note: 'Mola7aza' },
      darija_arabic: { name: 'السمية', phone: 'نمرة التيليفون', service: 'الخدمة', time: 'النهار والساعة', size: 'المقاس', color: 'اللون', city: 'المدينة', address: 'العنوان', product: 'المنتوج', email: 'الإيميل', note: 'ملاحظة' }
    };
    if (kind) return labels[language]?.[kind] || labels.en[kind];
    const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
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
      .map(([key, val]) => `${checkoutLabels[labelLanguage]?.[key] || ResponseBuilder.summaryLabel(key, labelLanguage)}: ${val}`)
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
    const defaultVals = defaultWorkflowValues('confirmation');

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
    const defaultVals = defaultWorkflowValues('choice');
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
    const defaultVals = defaultWorkflowValues('choiceReprompt');
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
