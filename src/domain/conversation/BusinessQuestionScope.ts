/** Cheap coverage check before returning a single FAQ for several business questions.
 * A missed topic falls back to grounded generation, rather than silently dropping it.
 */
export class BusinessQuestionScope {
  private static normalize(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا');
  }

  // JS \b only sees ASCII word characters, so Arabic-script tokens that also
  // occur inside longer words use explicit Unicode letter boundaries instead.
  private static readonly topics: Array<{ id?: string; subsumedBy?: string; query: RegExp; answer: RegExp }> = [
    { query: /\b(?:price|cost|coute|cout|prix|tarif\w*|bch[7h]al|taman)\b|\bhow\s+much\s+(?:is|does|for)\b|ثمن|سعر|تكلف|شحال(?!\s*(?:كتدوم|كيدوم|كتطول|كيطول|كتاخد|كياخد|من\s+الوقت|مدة))/, answer: /\b(?:price|cost|coute|prix|tarif\w*|mad|dh|eur|usd|free|gratuit\w*|taman)\b|درهم|ثمن|سعر|مجاني|[$€]/ },
    { id: 'duration', subsumedBy: 'delivery', query: /\b(?:duration|how long|dure\w*|duree|combien de temps|kayakhod|katakhod|kaykhed|wa9t|lwe9t)\b|(?<![\p{L}])(?:ال)?مد[ةه](?![\p{L}])|كتاخد|كياخد|كتدوم|كيدوم|كتطول|كيطول|كم من الوقت/u, answer: /\b(?:\d+\s*(?:min\w*|hours?|heures?|days?|jours?|h|d9i9a|sa3a)|duration|duree)\b|دقيق|ساعة|ساعه|ساعات|يوم|أيام|ايام/ },
    { query: /\b(?:open\w*|clos\w*|hours|horaires?|ferme\w*|ouvr\w*|ouvert\w*|heure|katseddo|katsedou|kat7ello|kathllo)\b|كتحلو|كتسدو|تفتح|تغلق|اوقات العمل|ساعات العمل/, answer: /\b(?:open\w*|clos\w*|hours|horaires?|ferme\w*|ouvr\w*|ouvert\w*|katsed\w*|kat7ell\w*)\b|\d{1,2}[:h]\d{2}|كتحل|كتسد|تفتح|تغلق|ساعات العمل/ },
    { query: /\b(?:where|address|location|adresse|situe\w*|fayn|fin\s+(?:kayn\w*|jay\w*|l?ma7al|l?mahal|l?adresse|l?blasa))\b|(?<![\p{L}])(?:و)?(?:فين|اين)(?![\p{L}])|عنوان/u, answer: /\b(?:address|location|located|based|adresse|situe\w*|rue|street|road|avenue|boulevard|quartier)\b|عنوان|شارع|حي |مقر|موقع/ },
    { query: /\b(?:pay\w*|cash|card|carte|paiement|especes|nkhless|n5les)\b|نخلص|دفع|بطاقة/, answer: /\b(?:pay\w*|paid|fees?|deposit|cash|card|carte|paiement|especes|nkhless|n5les)\b|نخلص|دفع|بطاقة/ },
    { id: 'delivery', query: /\b(?:deliver\w*|ship\w*|livraison|livrer|tawsil|twsil)\b|توصيل|التوصيل|شحن/, answer: /\b(?:deliver\w*|ship\w*|livraison|livrer|tawsil|twsil|\d+\s*(?:days?|jours?))\b|توصيل|الشحن|أيام|ايام/ },
    { query: /\b(?:sms|tracking|track\w*|tracking\s+link)\b|تتبع|رسالة\s+نصية/, answer: /\b(?:sms|tracking|track\w*|tracking\s+link)\b|تتبع|رسالة\s+نصية/ },
    { query: /\b(?:return\w*|refund\w*|exchange\w*|retour\w*|rembours\w*|rje3|trji3)\b|ترجيع|ارجاع|الارجاع|استرجاع|الاسترجاع|الرجوع|تبديل/, answer: /\b(?:return\w*|refund\w*|exchange\w*|retour\w*|rembours\w*|rje3|trji3)\b|ترجيع|ارجاع|الارجاع|استرجاع|الاسترجاع|الرجوع|تبديل/ },
    { query: /\b(?:unworn|not worn|unused|non port[eé]s?)\b|غير ملبوس|ما ملبوس/, answer: /\b(?:unworn|not worn|unused|non port[eé]s?)\b|غير ملبوس|ما ملبوس/ },
    { query: /\b(?:tags?|labels?|[eé]tiquettes?)\b|بطاقات|التيكيت/, answer: /\b(?:tags?|labels?|[eé]tiquettes?)\b|بطاقات|التيكيت/ },
    { query: /\b(?:warranty|guarantee|garantie|daman)\b|ضمان/, answer: /\b(?:warranty|guarantee|garantie|daman)\b|ضمان/ },
    { query: /\b(?:wash\w*|care instructions?|launder\w*|lavage|laver|entretien|nghsel|ghsil)\b|غسيل|نغسل|عناية/, answer: /\b(?:wash\w*|care|dry|launder\w*|lavage|laver|entretien|nghsel|ghsil|degrees?|celsius)\b|غسيل|نغسل|عناية|درجة/ },
    // A bare "كي" is a Darija verb prefix/conjunction (كيفاش, كيدوم, كي داير); only the noun form names ironing.
    { query: /\b(?:iron|ironing|bleach|repasser|javel)\b|(?<![\p{L}])(?:ال|بال|وال)كي(?![\p{L}])|مكوا[ةه]|(?<![\p{L}])[نتي]كوي(?![\p{L}])/u,
      answer: /\b(?:iron|ironing|bleach|repasser|javel)\b|(?<![\p{L}])(?:ال|بال|وال)كي(?![\p{L}])|مكوا[ةه]|(?<![\p{L}])[نتي]كوي(?![\p{L}])/u },
    { query: /\b(?:cancel\w*|cancellation|annul\w*)\b|الغاء|الالغاء|نلغي/, answer: /\b(?:cancel\w*|cancellation|annul\w*|notice)\b|الغاء|الالغاء|نلغي/ },
    { query: /\b(?:support|contact|phone|email|assistance|aide)\b|الدعم|التواصل|الاتصال/, answer: /\b(?:support|contact|phone|email|assistance|aide)\b|الدعم|التواصل|الاتصال|@/ }
  ];

  private static requested(question: string) {
    const query = this.normalize(question);
    return this.topics.filter(topic => topic.query.test(query));
  }

  static isCovered(question: string, answer: string): boolean {
    const requested = this.requested(question);
    if (requested.length === 0) return true;
    const evidence = this.normalize(answer);
    return requested.every(topic => topic.answer.test(evidence));
  }

  /** Distinct questions asked. A duration asked about delivery is one delivery
   * question, although its answer must still state the duration. */
  static requestedTopicCount(question: string): number {
    const matched = this.requested(question);
    return matched.filter(topic => !topic.subsumedBy || !matched.some(other => other.id === topic.subsumedBy)).length;
  }

  static hasAnyCoveredTopic(question: string, answer: string): boolean {
    const requested = this.requested(question);
    if (requested.length === 0) return true;
    const evidence = this.normalize(answer);
    return requested.some(topic => topic.answer.test(evidence));
  }
}
