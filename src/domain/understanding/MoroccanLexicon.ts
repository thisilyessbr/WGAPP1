/**
 * The shared Moroccan dictionary: every word list the deterministic layers
 * use, in one place. Add a word here once and it works everywhere it applies.
 *
 * - LEXICON_CONCEPTS: products and services named across French, English,
 *   Arabic, Darija (Arabic script) and Arabizi (catalog/service matching).
 * - LEXICON_ARABIZI_WORDS: words that mark a Latin-script message as Darija.
 * - LEXICON_PROMPT_GLOSSARY: Darija meanings given to the answer model.
 *
 * Wording specific to one business is learned automatically instead
 * (LearnedPhraseStore) and reviewed by the business in the admin.
 * Routing grammar (negations, word order for delivery/payment/returns
 * questions) stays in TurnDecision, WorkflowCancellationDetector and
 * HandoffService because it is pattern logic, not vocabulary.
 */

export const LEXICON_CONCEPTS: Record<string, string[]> = {
  caftan: ['caftan', 'caftans', 'kaftan', 'qaftan', 'قفطان', 'قفاطن', '9eftan', '9oftan', 'kaftane'],
  takchita: ['takchita', 'tekchita', 'تكشيطة', 'تكاشط'],
  djellaba: ['djellaba', 'djellabas', 'jellaba', 'jelaba', 'jallaba', 'gandoura', 'جلابة', 'جلابية', 'جلالب', 'jlaba', 'jlayb'],
  abaya: ['abaya', 'abayas', 'abaya', 'عباية', 'عباءة', 'عبايات', '3baya', '3abaya'],
  jeans: ['jean', 'jeans', 'denim', 'djin', 'jin', 'jinz', 'جين', 'جينز', 'دجين', 'دجينز'],
  pants: ['pantalon', 'pantalons', 'pants', 'trousers', 'jean', 'jeans', 'سروال', 'سراول', 'بنطلون', 'بنطال', 'serwal', 'sarwal', 'srawl'],
  sneakers: ['basket', 'baskets', 'sneaker', 'sneakers', 'trainers', 'tennis', 'running', 'runner', 'sbrdila', 'sbardila', 'sbrdilat', 'sbardilat', 'sebrdilat', 'sebrdila', 'sbadri', 'espadrille', 'espadrilles', 'سبرديلة', 'سبرديلات', 'سبادري', 'رياضي', 'رياضية', 'sport', 'sportif', 'sportive'],
  // Generic footwear only: specific types (baskets, babouches) must not tie
  // every shoe in a "Chaussures" category.
  shoes: ['chaussure', 'chaussures', 'shoe', 'shoes', 'footwear', 'صباط', 'سباط', 'صبابط', 'حذاء', 'أحذية', 'احذية', 'sbat', 'sebbat', 'sabbat'],
  babouche: ['babouche', 'babouches', 'belgha', 'blgha', 'balgha', 'bel8a', 'بلغة', 'بلاغي', 'بلغات'],
  bag: ['sac', 'sacs', 'bag', 'bags', 'handbag', 'sacoche', 'pochette', 'sak', 'sakk', 'saka', 'صاك', 'صاكات', 'حقيبة', 'حقائب', 'شنطة', 'chanta', 'sacados', 'cartable'],
  leather: ['cuir', 'leather', 'جلد', 'جلدية', 'جلدي', 'jeld', 'jild', 'jlad'],
  watch: ['montre', 'montres', 'watch', 'watches', 'ساعة', 'ساعات', 'مونطر', 'مونطرة', 'montra', 'magana', 'ماكانة'],
  hoodie: ['hoodie', 'hoodies', 'hoody', 'sweat', 'sweatshirt', 'capuche', 'capuchon', 'كابوشون', 'كابيشون', 'هودي', 'هوديز', 'kabbouchon', 'kapuchon', 'kabouchon'],
  tshirt: ['tshirt', 'tshirts', 'teeshirt', 'tee', 'tricot', 'tricots', 'تيشورت', 'تيشيرت', 'تيشرت', 'تريكو', 'tishort', 'tichort', 'tichirt', 'tishirt', 'قميص'],
  shirt: ['chemise', 'chemises', 'shirt', 'shirts', 'قميص', 'قمجة', 'kamis', '9amis', 'kamija', '9amija'],
  dress: ['robe', 'robes', 'dress', 'dresses', 'كسوة', 'روبة', 'فستان', 'فساتين', 'ksswa', 'kswa', 'keswa', 'roba'],
  jacket: ['veste', 'vestes', 'jacket', 'jackets', 'blouson', 'jaquette', 'جاكيط', 'جاكيت', 'جاكيطة', 'jakit', 'jakita'],
  coat: ['manteau', 'manteaux', 'coat', 'coats', 'كبوط', 'معطف', 'kabbot', 'kabbout'],
  perfume: ['parfum', 'parfums', 'perfume', 'perfumes', 'fragrance', 'عطر', 'عطور', 'ريحة', 'ri7a', 'parfan'],
  // Brand names (iPhone) are products, not synonyms: a store without iPhones must say so.
  phone: ['phone', 'telephone', 'téléphone', 'smartphone', 'تيليفون', 'هاتف', 'portable', 'tilifoun'],
  jersey: ['maillot', 'maillots', 'jersey', 'مايو', 'مايوه', 'mayo'],
  scarf: ['foulard', 'foulards', 'scarf', 'hijab', 'echarpe', 'écharpe', 'زيف', 'حجاب', 'شال', 'zif'],
  // Electronics, home and beauty words customers use for common catalog items.
  headphones: ['casque', 'casques', 'headphone', 'headphones', 'headset', 'ecouteur', 'ecouteurs', 'écouteur', 'écouteurs', 'earbuds', 'earphones', 'buds', 'kask', 'kasque', 'سماعة', 'سماعات', 'كاسك', 'كاسكات', 'ايكوتور'],
  charger: ['chargeur', 'chargeurs', 'charger', 'chargers', 'شارجور', 'شاحن', 'charjor', 'charjour', 'charjeur'],
  speaker: ['enceinte', 'enceintes', 'speaker', 'speakers', 'baffle', 'بافل', 'سبيكر', 'مكبر', 'spiker', 'bafle'],
  powerbank: ['powerbank', 'batterie', 'batteries', 'باطري', 'باتري', 'بطارية', 'batri', 'batrie'],
  smartwatch: ['smartwatch', 'smartwatches', 'connectee', 'connectée', 'connected'],
  sunglasses: ['lunettes', 'lunette', 'sunglasses', 'glasses', 'نظارات', 'نظارة', 'ندادر', 'نوادر', 'ndader', 'nwader', 'nadador'],
  backpack: ['backpack', 'backpacks', 'sacados', 'cartable', 'sac à dos', 'شكارة الظهر', 'sakado'],
  lipstick: ['lipstick', 'lipsticks', 'روج', 'rouj', 'أحمر الشفاه'],
  tajine: ['tajine', 'tajines', 'tagine', 'tajin', 'طاجين', 'طواجن', 'طجين'],
  rug: ['tapis', 'rug', 'rugs', 'carpet', 'kilim', 'زربية', 'زرابي', 'zarbia', 'zrbiya', 'zerbiya'],
  teapot: ['théière', 'theiere', 'teapot', 'براد', 'براريد', 'berrad', 'brrad', 'berad'],
  cushion: ['coussin', 'coussins', 'cushion', 'cushions', 'pillow', 'مخدة', 'خدادي', 'mkhadda', 'mkhda'],
  argan: ['argan', 'argane', 'أركان', 'اركان', 'أرگان'],
  oil: ['huile', 'huiles', 'oil', 'oils', 'زيت', 'zit'],
  soap: ['savon', 'soap', 'صابون', 'sabon', 'sabone'],
  cream: ['crème', 'creme', 'cream', 'creams', 'كريم', 'كريمة', 'krim', 'krima'],
  lantern: ['lanterne', 'lanternes', 'lantern', 'فانوس', 'فنار', 'fanous', 'fanar'],
  belt: ['ceinture', 'ceintures', 'belt', 'belts', 'سمطة', 'smta', 'semta'],
  cap: ['casquette', 'casquettes', 'cap', 'caps', 'كاسكيطة', 'كسكيطة', 'kasketa', 'casquita'],
  sandals: ['sandale', 'sandales', 'sandal', 'sandals', 'claquette', 'claquettes', 'صندالة', 'صنادل', 'شلاكة', 'sandala', 'chlaka'],
  casablanca: ['casablanca', 'casa', 'كازا', 'كازابلانكا', 'البيضاء', 'kaza'],
  marrakech: ['marrakech', 'marrakesh', 'مراكش', 'mrakch', 'rrakch'],
  fes: ['fes', 'fès', 'fez', 'فاس'],
  accessories: ['accessoire', 'accessoires', 'accessories', 'accessory', 'اكسسوارات', 'إكسسوارات', 'aksiswar'],
  // Beauty and wellness services (Moroccan spas, salons, hammams).
  hammam: ['hammam', 'hamam', 'hammams', 'حمام', 'الحمام', '7mam', 'l7mam', '7ammam'],
  scrub: ['gommage', 'scrub', 'exfoliation', 'kessa', 'kassa', 'كسالة', 'الكسالة', 'تقشير', 'kessala', 'kesala', 'ghassoul', 'غاسول', 'enveloppement', 'wrap'],
  massage: ['massage', 'massages', 'massaj', 'masaj', 'مساج', 'تدليك', 'ماساج', 'tadlik'],
  facial: ['visage', 'facial', 'face', 'skincare', 'وجه', 'الوجه', 'بشرة', 'البشرة', 'wjeh', 'wajh', 'lwejh', 'bachra'],
  manicure: ['manucure', 'manicure', 'مانيكير', 'المانيكير', 'manikir', 'ongles', 'nails', 'أظافر', 'ظفار', 'dfar', 'vernis', 'polish'],
  pedicure: ['pédicure', 'pedicure', 'باديكير', 'الباديكير', 'pedikir', 'pieds', 'feet', 'foot', 'قدمين', 'القدمين'],
  // In Darija رجلين covers both legs and feet; it ranks with leg services.
  legs: ['jambes', 'jambe', 'legs', 'leg', 'ساقين', 'الساقين', 'ساق', 'رجلين', 'الرجلين', 'rjlin', 'rjel', 'rejlin'],
  traditional: ['traditionnel', 'traditionnelle', 'traditional', 'beldi', 'bldi', 'بلدي', 'البلدي', 'تقليدي', 'التقليدي'],
  complete: ['complet', 'complète', 'complete', 'full', 'rituel', 'ritual', 'كامل', 'كاملة', 'الكاملة', 'باقة', 'kamel', 'kamla'],
  waxing: ['épilation', 'epilation', 'waxing', 'wax', 'cire', 'حلاوة', 'الحلاوة', 'شمع', 'الشمع', '7lawa', 'l7lawa', 'إزالة', 'ازالة'],
  haircut: ['coupe', 'coiffure', 'haircut', 'cut', 'brushing', 'blowdry', 'قص', 'حلاقة', 'تسريح', 'براشينغ', 'بروشينغ', '9ess', 'kess', 'cha3r', 'شعر', 'الشعر', 'coiffeur', 'coiffeuse'],
  coloring: ['coloration', 'couleur', 'coloring', 'dye', 'صباغة', 'sbagha', 'teinture', 'mèches', 'meches', 'balayage'],
  henna: ['henné', 'henne', 'henna', 'حناء', 'الحناء', 'حنة', 'الحنة', 'l7enna', '7enna', 'nekcha', 'n9cha', 'نقش', 'نقشة', 'النقشة'],
  eyebrows: ['sourcils', 'eyebrows', 'brows', 'حواجب', 'الحواجب', '7wajeb'],
  makeup: ['maquillage', 'makeup', 'ماكياج', 'مكياج', 'makiyaj', 'maquiyaj']
};

export const LEXICON_ARABIZI_WORDS: string[] = [
    'bghit', 'bghiti', 'bghina', 'dakchi', 'katbi3o', 'dyal', 'dyalk', 'dyalna', 'dyalkom',
    'rjli', 'rjlia', 'rjliya', 'fiha', 'fih', 'chmn', 'chmen', 'achmen', 'nakhod', 'nakhd', 'nmra', 'nemra', '9yas', 'qyas', 'tswirto', 'tswirtha', 'sift', 'siftli', 'chouf', 'wakha',
    'dial', 'diyalna', 'wach', 'chno', 'chnou', 'ashno', 'chhal', 'kifach', 'kifash',
    'fayn', 'fin', 'kayn', 'kayna', 'daba', 'hadi', 'hada', 'homa', 'chokran', 'shukran',
    'salam', 'ahlan', 'mzyan', 'mezyan', 'khass', 'khesni', 'khasni', '3ndkom', '3ndek', '3ndi',
    'shhar', 'chhar', 'nsowl', 'nswl', 'nswlo', 'swal', 'soual', 'fhad', 'hadchi', '3afak',
    'afak', 'ila', 'walakin', 'chof', 'sbah', 'sba7', 'labas', 'lkhir',
    'kidayr', 'kidayra', 'rje3', 'arja3', 'wakha', 'iyih', 'wah', 'flous', 'flousi', 'zwin',
    'zwina', 'bzzaf', 'bzaf', 'n3ref', 'n3raf', 't9dro', 't3awnoni', 'katkhedmo', 'taman',
    'khedma', 'ndir', 'bach', 'mouchkil', 'baghi', 'baghya', 'nchri', 'nshri', 'ncommandi',
    'mabghitch', 'mabghitsh', 'makaynch', 'machi', 'bghitch', 'nhder', 'ndwi', 'wahed', 'ch7al', 'sh7al', 'bch7al',
    'bchhal', 'bchehal', 'bche7al', 'bshal', 'safi', 'nlghi', 'n7jez', 'mn', 'ach', 'achno', 'msawb', 'msawba', 'wla', 'mazal', 'ba9i', 'tswira', 'tsawer', 'sift', 'mrakch', 'twslo', 'katwslo', 'twsalni', 'nkhles', 'ntb3', 'ntbe3', 'fabor', 'fabour', 'batel', 'b7al', 'imta', 'emta', 'katsdo', 'katsedo', 'kat7lo', 'kat7elo', 'fo9ach', 'fou9ach', 'foqach', 'khdamin', 'khdama', 'letnin', 'tnin', 'smiti', 'smitek', 'smitk', 'ykhalik', 'ykhallik', 'm7lolin', 'mhlolin', 'l7ed', 'ghedda', 'l3chiya', 'lw9t', 'lwe9t', 'kayakhod', 'kaydoum', 'n9ess', '9ess', 'wjeh', 'lwejh', 'l7lawa', 'l7enna', 'rjlin', 'katjiw', 'rjal', 'y9dro', 'yjiw', 'nparki', 'nbdel', 'lghit', 'nfs'
  ];

export const LEXICON_PROMPT_GLOSSARY = 'Moroccan vocabulary: "nkhles 3nd stilam", "lkhlas f lbab", "الخلاص عند الاستلام", "ملي توصلني السلعة" mean paying cash when the order is delivered (cash on delivery). "livraison", "twsil", "ليفريزون", "التوصيل" mean delivery. "nbedel", "نبدل" mean exchange. "trj3o lflouss", "ترجعو الفلوس" mean refund. "lkarta", "carte guichet" mean bank card. "khdamin", "حالين" mean open. "lghit", "nlghi", "لغيت", "نلغي" mean cancel; "khlas" right after a cancellation means a fee. "nbdel rdv", "نبدل الموعد" mean reschedule. "rdv", "موعد" mean appointment. "7lawa", "الحلاوة" mean waxing. "l7enna", "الحنة" mean henna. "fo9ach kat7lo", "فوقاش كتحلو" ask the opening time; "katsdo", "كتسدو" ask the closing time. Weekdays in Darija: lundi = tnin / الاثنين, mardi = tlat / الثلاثاء, mercredi = larb3 / الأربعاء, jeudi = lkhmis / الخميس, vendredi = jjem3a / الجمعة, samedi = sebt / السبت, dimanche = l7ed / الحد; never swap one day for another. Write Arabic script with standard Arabic letters only (no پ, ڤ, چ).';
