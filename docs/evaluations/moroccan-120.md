# 120 fictional Moroccan-style chatbot questions

{
  "cases": 120,
  "passed": 115,
  "failed": 5,
  "llmCalls": 77,
  "inputTokens": 50715,
  "outputTokens": 3178,
  "p95LatencyMs": 1338
}

Rule checks are triage only. Manual transcript review is required, especially for language and unsupported claims. No customer accounts, live WhatsApp, PDFs, database or booking system were exercised.

## clothing/darija-price — PASS

Customer: salam 3afak bch7al Atlas cotton shirt?

Bot: Taman dyal Atlas cotton shirt howa 149 MAD.

Latency: 61 ms

## clothing/arabic-price — PASS

Customer: عفاك شحال ثمن Atlas cotton shirt؟

Bot: الثمن ديال Atlas cotton shirt هو 149 MAD.

Latency: 46 ms

## clothing/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، الخدمة من الاثنين إلى السبت، من 9:00 إلى 18:00. الأحد مسدود.

Latency: 1061 ms

## clothing/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Casablanca.

Latency: 15 ms

## clothing/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla cash f l-business.

Latency: 948 ms

## clothing/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma3luma 3la chi reduction dyal tolba ma kaynach f l-information li 3andna. Momkin t3ayet l-business f Casablanca mn tnin l-sbt, 9:00–18:00, bach t3ref.

Latency: 1318 ms

## clothing/delivery — PASS

Customer: twsil l Casablanca ch7al kayakhod?

Bot: Twsil l Casablanca kayakhod juj (2) yum.

Latency: 1186 ms

## clothing/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma3endna ta rendez-vous mssjel f had l-answer. L-business khdam mn tnin l-sbt, 9:00–18:00, f Fictional Main Street, Casablanca. Bghit tconfirmi chi maw3id? 3ayt l-business direct.

Latency: 1020 ms

## clothing/mixed — PASS

Customer: bch7al Atlas cotton shirt w fach katseddo?

Bot: Atlas cotton shirt tamanu 149 MAD, w kayn f stock (4). L-hourat: ltnen 7tal sebt, 9:00–18:00. Ma-kaynch ma3luma 3la shipping f had l-fact, ghir twsil f Casablanca kayakhod jouj yyam.

Latency: 975 ms

## clothing/cross-business — PASS

Customer: 3andkom Atlas headphones bch7al?

Bot: Smeh liya, had l-produit makaynch db f l-magasin dyalna.

Latency: 8 ms

## clothing/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Casablanca.

Latency: 10 ms

## clothing/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdoudin. L7wayj mn tnin l sebt, mn 9h00 l 18h00.

Latency: 948 ms

## electronics/darija-price — PASS

Customer: salam 3afak bch7al Atlas headphones?

Bot: Taman dyal Atlas headphones howa 390 MAD.

Latency: 9 ms

## electronics/arabic-price — PASS

Customer: عفاك شحال ثمن Atlas headphones؟

Bot: الثمن ديال Atlas headphones هو 390 MAD.

Latency: 11 ms

## electronics/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، خدامين من الاثنين إلى السبت، من 9:00 حتى 18:00. الأحد مسدود.

Latency: 806 ms

## electronics/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Rabat.

Latency: 10 ms

## electronics/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla b cash f l-business.

Latency: 763 ms

## electronics/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma3luma 3la chi reduction dyal tolba ma kaynach f l-information li 3andna. Momkin t3ayet l-business f Rabat (Monday–Saturday, 9:00–18:00) bach t2akked.

Latency: 1204 ms

## electronics/delivery — PASS

Customer: twsil l Rabat ch7al kayakhod?

Bot: Twsil l Rabat kayakhod juj (2) yum.

Latency: 1124 ms

## electronics/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma3endna ta khidma dyal rendez-vous m3a 4. L-business mahlul mn tnin l-sebt, 9:00–18:00, f Fictional Main Street, Rabat. Ma-ymkench nconfirmiw rendez-vous. 3afak 3ayet lihom direct.

Latency: 1419 ms

## electronics/mixed — FAIL

Customer: bch7al Atlas headphones w fach katseddo?

Bot: Atlas headphones tamanhom 390 MAD, w kaynin f stock (4). L-business khalssa cash wla card f l-mahal. Ma-kaynch ma3luma 3la shipping f had l-evidence.

Latency: 1133 ms

## electronics/cross-business — PASS

Customer: 3andkom brushing bch7al?

Bot: Smeh liya, had l-produit makaynch db f l-magasin dyalna.

Latency: 10 ms

## electronics/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Rabat.

Latency: 12 ms

## electronics/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdudin. L7orat: men tnin l sebt, men 9:00 hta l 18:00.

Latency: 1139 ms

## salon/darija-price — PASS

Customer: salam 3afak bch7al brushing?

Bot: Taman dyal brushing howa 80 MAD.

Latency: 4 ms

## salon/arabic-price — PASS

Customer: عفاك شحال ثمن brushing؟

Bot: الثمن ديال brushing هو 80 MAD.

Latency: 8 ms

## salon/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، الخدمة من الاثنين إلى السبت، من 9:00 إلى 18:00. الأحد مسدود.

Latency: 1256 ms

## salon/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Marrakech.

Latency: 3 ms

## salon/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla cash f salon.

Latency: 835 ms

## salon/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma-kaynch chi ma3luma 3la reduction dyal tolba f l-information li 3andna. Momkin t3ayet l-salon bach t3ref wla kayna chi 3ard.

Latency: 1123 ms

## salon/delivery — PASS

Customer: واش كتوصّلو حتى لدار؟

Bot: لا، المعلومات المتوفرة ما كتذكرش خدمة التوصيل للمنزل. الخدمات المتوفرة: بروسينغ بـ80 درهم، فالصالون. للاستفسار، تواصل مع الصالون مباشرة.

Latency: 1303 ms

## salon/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma ymkench liya nconfirmi rendez-vous. Ma3endna ta chi workflow kaydir booking hna. 3afak 3ayet l-salon f 9:00–18:00 mn tnin l-sebt bach tconfirmi m3ahom.

Latency: 1290 ms

## salon/mixed — PASS

Customer: bch7al brushing w fach katseddo?

Bot: Brushing: 80 MAD. L-salon khddam mn tnin l-sbt, mn 9:00 l-18:00.

Latency: 814 ms

## salon/cross-business — PASS

Customer: 3andkom lunch menu bch7al?

Bot: Ma3ndna lunch menu. Had l-business salon, khdemna ghir b brushing b 80 MAD. L-ma3lomat 3la menu makaynach f l-lista.

Latency: 919 ms

## salon/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Marrakech.

Latency: 2 ms

## salon/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdoudin. L7ours: tnin (Lundi) hta seb t (Samedi), men 9:00 hta 18:00.

Latency: 895 ms

## restaurant/darija-price — PASS

Customer: salam 3afak bch7al lunch menu?

Bot: Taman dyal lunch menu howa 95 MAD.

Latency: 6 ms

## restaurant/arabic-price — PASS

Customer: عفاك شحال ثمن lunch menu؟

Bot: الثمن ديال lunch menu هو 95 MAD.

Latency: 3 ms

## restaurant/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، المطعم خدام من الاثنين إلى السبت، من 9:00 حتى 18:00. الأحد مسدود.

Latency: 613 ms

## restaurant/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Tangier.

Latency: 3 ms

## restaurant/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla cash f l-business.

Latency: 628 ms

## restaurant/discount — FAIL

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma kayna ta reduction dyal tolba mktouba f l-ma3loumat li 3andna. L-lunch menu taman dyalo 95 MAD.

Latency: 1163 ms

## restaurant/delivery — PASS

Customer: واش كتوصّلو حتى لدار؟

Bot: لا، المعلومات المتوفرة ما كتشيرش لخدمة التوصيل. الخدمات المتوفرة: قائمة الغداء بـ95 درهم مغربي، والدفع نقداً أو بالبطاقة في المحل.

Latency: 1059 ms

## restaurant/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma momkinch nconfirmi lik ay rendez-vous. Ma kayn ta chi workflow kaydir booking. L-agenda: tnin l-sbt, 9:00–18:00. L-lunch menu: 95 MAD. Bghit rendez-vous? Twasel m3a l-restaurant nichan.

Latency: 1115 ms

## restaurant/mixed — PASS

Customer: bch7al lunch menu w fach katseddo?

Bot: Lunch menu b 95 MAD. L-restaurant khddam mn tnin l sebt, mn 9:00 l 18:00.

Latency: 681 ms

## restaurant/cross-business — PASS

Customer: 3andkom standard room bch7al?

Bot: Ma3ndna ta ghorfa f had l-business. Hna restaurant f Tangier, men tnin l sebt 9:00–18:00. L-lunch menu b 95 MAD.

Latency: 1062 ms

## restaurant/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Tangier.

Latency: 2 ms

## restaurant/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdodin. L7wayj: men tnin l sebt, men 9h00 l 18h00.

Latency: 1156 ms

## riad/darija-price — PASS

Customer: salam 3afak bch7al standard room?

Bot: Taman dyal standard room howa 450 MAD.

Latency: 6 ms

## riad/arabic-price — PASS

Customer: عفاك شحال ثمن standard room؟

Bot: الثمن ديال standard room هو 450 MAD.

Latency: 2 ms

## riad/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، الخدمة من الاثنين إلى السبت، من 9:00 إلى 18:00. الأحد مسدود.

Latency: 977 ms

## riad/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Fez.

Latency: 4 ms

## riad/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla cash f l-business.

Latency: 699 ms

## riad/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma-kaynch chi ma3luma 3la reduction dyal tolba f l-information li 3ndna. Thaman dyal standard room howa 450 MAD.

Latency: 741 ms

## riad/delivery — PASS

Customer: واش كتوصّلو حتى لدار؟

Bot: غير المعلومات المتوفرة: العنوان هو "Fictional Main Street, Fez"، وما كاينش تفاصيل على التوصيل. سعر الغرفة العادية 450 درهم مغربي، والدفع نقداً أو بالبطاقة.

Latency: 863 ms

## riad/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma momkinch nconfirmi lik ay rendez-vous. Ma kayn ta chi workflow kayn f had l-answer. L-ouverture: tnin l-sbt, 9:00–18:00. 3afak t7taj t3ayet l-business bach tconfirmi m3a 4.

Latency: 1097 ms

## riad/mixed — PASS

Customer: bch7al standard room w fach katseddo?

Bot: Standard room: 450 MAD. L-ouverture: tnin (lundi) hta sebth (samedi), men 9:00 hta 18:00.

Latency: 1105 ms

## riad/cross-business — PASS

Customer: 3andkom French course bch7al?

Bot: Ma3andna ta French course f l-lista dyalna. L-khedma l-mojouda hiya ghir standard room b 450 MAD. Ila bghit t3ref ktar, twasel m3ana mn tnin l-sebt, 9:00–18:00.

Latency: 1315 ms

## riad/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Fez.

Latency: 2 ms

## riad/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdoudin. L-horaires dyalna: men tnin l sebt, 9:00–18:00.

Latency: 881 ms

## school/darija-price — PASS

Customer: salam 3afak bch7al French course?

Bot: Taman dyal French course howa 600 MAD.

Latency: 4 ms

## school/arabic-price — PASS

Customer: عفاك شحال ثمن French course؟

Bot: الثمن ديال French course هو 600 MAD.

Latency: 3 ms

## school/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، المدرسة خدامة من الاثنين إلى السبت من 9:00 حتى 18:00. الأحد مسدود.

Latency: 849 ms

## school/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Agadir.

Latency: 7 ms

## school/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla cash f l-business.

Latency: 675 ms

## school/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma-kaynch chi ma3luma 3la reduction dyal tolba f l-information li 3andna. Thaman dyal French course howa 600 MAD.

Latency: 760 ms

## school/delivery — PASS

Customer: واش كتوصّلو حتى لدار؟

Bot: لا، المعلومات المتوفرة ما كتذكرش خدمة التوصيل للمنازل. العنوان: Fictional Main Street, Agadir. للاستفسار، تواصل مع المدرسة مباشرة.

Latency: 879 ms

## school/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma n9darch nconfirmi rendez-vous. Ma3endna ta chi workflow li kaydir booking. 3afak t3ayet l-numar dial l-business awla tzur l-address: Fictional Main Street, Agadir. L-hours: Monday to Saturday, 9:00–18:00.

Latency: 1274 ms

## school/mixed — PASS

Customer: bch7al French course w fach katseddo?

Bot: French course: 600 MAD. L-agenda: Monday–Saturday, 9:00–18:00. L-paiement: cash wla card f l-business.

Latency: 999 ms

## school/cross-business — PASS

Customer: 3andkom oil change bch7al?

Bot: Ma3ndna ta khidma dyal oil change f had l-business. L-khidma l-wahida li kayna hiya French course b 600 MAD. Ila bghit t3ref chi haja okhra, sewwel.

Latency: 1063 ms

## school/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Agadir.

Latency: 2 ms

## school/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed ma khdaminch. L-houraf: men tnin l sebt, men 9h00 l 18h00.

Latency: 893 ms

## garage/darija-price — PASS

Customer: salam 3afak bch7al oil change?

Bot: Taman dyal oil change howa 250 MAD.

Latency: 3 ms

## garage/arabic-price — PASS

Customer: عفاك شحال ثمن oil change؟

Bot: الثمن ديال oil change هو 250 MAD.

Latency: 4 ms

## garage/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، الخدمة كتكون من الاثنين إلى السبت من 9:00 حتى 18:00. الأحد مسدود.

Latency: 843 ms

## garage/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Kenitra.

Latency: 2 ms

## garage/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla cash f l-garage.

Latency: 759 ms

## garage/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma kayna ta chi ma3luma 3la reduction dyal tolba f l-ma3lumat li 3andna. Momkin t3ayet l-garage bach t3ref.

Latency: 1140 ms

## garage/delivery — PASS

Customer: واش كتوصّلو حتى لدار؟

Bot: لا، المعلومات المتوفرة ما كتشيرش بلي كاين خدمة توصيل حتى للدار. الخدمات المتوفرة: تبديل الزيت بـ250 درهم، والدفع نقداً أو بالبطاقة فالمحل.

Latency: 1145 ms

## garage/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma ymkench liya nconfirmi rendez-vous. Ma3endna ta chi workflow kaydir booking. 3afak 3ayet l-garage f 9:00–18:00 mn tnin l-sebt, wla sir 3ndhom f Fictional Main Street, Kenitra.

Latency: 1129 ms

## garage/mixed — PASS

Customer: bch7al oil change w fach katseddo?

Bot: Oil change: 250 MAD. L-garage katseddo mn tnin l-sebt, mn 9:00 l-18:00.

Latency: 718 ms

## garage/cross-business — PASS

Customer: 3andkom viewing request bch7al?

Bot: Ma3luminat 3la viewing request ma kaynin-ch f l-lista. Ghir oil change b 250 MAD. Momkin t3ayet l-garage bach tsawel.

Latency: 1224 ms

## garage/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Kenitra.

Latency: 9 ms

## garage/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdoudin. L7orari dyalhom men tnin l sebt, men 9:00 l 18:00.

Latency: 862 ms

## property/darija-price — PASS

Customer: salam 3afak fach kat7ello?

Bot: Salam! Kan7ello mn tnin l sebt, mn 9h00 l 18h00.

Latency: 663 ms

## property/arabic-price — PASS

Customer: عفاك فين كاينين؟

Bot: العنوان ديالنا: Fictional Main Street, Casablanca.

Latency: 1 ms

## property/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، خدامين من الاثنين إلى السبت، من 9:00 حتى 18:00. الأحد مسدود.

Latency: 786 ms

## property/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Casablanca.

Latency: 3 ms

## property/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla b cash f l-business.

Latency: 646 ms

## property/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma-kaynch ma3luma 3la chi reduction dyal tolba f l-information li 3andna. Momkin t3ayet l-business mn tnin l-sebt, 9:00–18:00, bach t2akked.

Latency: 892 ms

## property/delivery — PASS

Customer: واش كتوصّلو حتى لدار؟

Bot: لا توجد معلومات في البيانات المتاحة عن خدمة التوصيل إلى المنازل.

Latency: 764 ms

## property/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma ymkench liya nconfirmi ay rendez-vous. Ma3endich access l l-agenda wla l bookings. 3afak t7dd m3a l-business direct f wa9t l-khdma: tnin l sebt, 9:00–18:00.

Latency: 1123 ms

## property/mixed — FAIL

Customer: fin kaynin w fach katseddo?

Bot: Kaynin f Fictional Main Street, Casablanca.

Latency: 3 ms

## property/cross-business — PASS

Customer: 3andkom appointment request bch7al?

Bot: Ma3luma 3la taman appointment request ma-kayna-ch f l-information li 3andna. L-business khedma men tnin l-sebt, 9:00–18:00, f Fictional Main Street, Casablanca. L-khlass cash wla card f l-business.

Latency: 1366 ms

## property/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Casablanca.

Latency: 2 ms

## property/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdudin. L7wayj mn tnin l sebt, mn 9:00 l 18:00.

Latency: 719 ms

## clinic/darija-price — PASS

Customer: salam 3afak fach kat7ello?

Bot: Salam! Kan7ello mn tnin l-sebt, mn 9h00 l-18h00.

Latency: 747 ms

## clinic/arabic-price — PASS

Customer: عفاك فين كاينين؟

Bot: العنوان ديالنا: Fictional Main Street, Rabat.

Latency: 1 ms

## clinic/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، الخدمة من الاثنين إلى السبت من 9:00 إلى 18:00، والأحد مغلق.

Latency: 569 ms

## clinic/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Rabat.

Latency: 1 ms

## clinic/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte. Payment: cash wla carte f l-business.

Latency: 904 ms

## clinic/discount — PASS

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma3luma 3la reduction dyal tolba ma-kaynach f l-information li 3andna. Momkin t3ayet l-clinic f Rabat (Monday–Saturday, 9:00–18:00) bach tsewwel.

Latency: 1130 ms

## clinic/delivery — PASS

Customer: واش كتوصّلو حتى لدار؟

Bot: لا، المعلومات المتوفرة ما كتوضحش واش كاين توصيل للدار. الخدمات المتوفرة: لا توجد خدمات مدرجة. للاستفسار، تواصل مع العيادة مباشرة.

Latency: 1092 ms

## clinic/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma ymkench liya nconfirmi ay rendez-vous. Ana ma3ndi ta access l agenda wla l bookings. 3afak t3ayet l clinic direct f waqt l khedma: Monday–Saturday, 9:00–18:00.

Latency: 1438 ms

## clinic/mixed — FAIL

Customer: fin kaynin w fach katseddo?

Bot: Kaynin f Fictional Main Street, Rabat.

Latency: 3 ms

## clinic/cross-business — PASS

Customer: 3andkom Atlas olive oil bch7al?

Bot: Ma3luma 3la Atlas olive oil ma kaynach f l-lista dyalna. Ma n9drouch n3tiwk taman. Sifet lina sual dyalek b tafsil wla 3ayet l-clinic.

Latency: 1338 ms

## clinic/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Rabat.

Latency: 3 ms

## clinic/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdudin. L7wayj: men tnin l sebt, men 9:00 l 18:00.

Latency: 865 ms

## grocery/darija-price — PASS

Customer: salam 3afak bch7al Atlas olive oil?

Bot: Taman dyal Atlas olive oil howa 65 MAD.

Latency: 96 ms

## grocery/arabic-price — PASS

Customer: عفاك شحال ثمن Atlas olive oil؟

Bot: الثمن ديال Atlas olive oil هو 65 MAD.

Latency: 62 ms

## grocery/sunday — PASS

Customer: واش خدامين نهار الحد؟

Bot: لا، الخدمة من الاثنين إلى السبت، من 9:00 إلى 18:00. الأحد مسدود.

Latency: 1001 ms

## grocery/location — PASS

Customer: fin kaynin 3afak?

Bot: Kaynin f Fictional Main Street, Oujda.

Latency: 6 ms

## grocery/card — PASS

Customer: wach n9der nkhelles b carte?

Bot: Iyeh, momkin tkhelles b carte wla b cash f l-business.

Latency: 870 ms

## grocery/discount — FAIL

Customer: wach kayna chi reduction dyal tolba?

Bot: Ma kayna ta reduction dyal tolba mktouba f l-ma3lumat li 3andna. Ghir l-as3ar l-madrouba b l-3omla MAD. Ila bghit t3ref chi haja khra, sewwel.

Latency: 1415 ms

## grocery/delivery — PASS

Customer: twsil l Oujda ch7al kayakhod?

Bot: Twsil l Oujda kayakhod jouj (2) yum.

Latency: 1187 ms

## grocery/booking — PASS

Customer: 3afak confirmi lia rendez-vous ghdda m3a 4

Bot: Ma3endna ta rendez-vous mssjel. L-business khedma mn tnin l-sbt, 9:00–18:00, f Fictional Main Street, Oujda. Momkin tzur wla t3ayet f wa9t l-khedma bach tconfirmi m3ahom.

Latency: 1492 ms

## grocery/mixed — PASS

Customer: bch7al Atlas olive oil w fach katseddo?

Bot: Atlas olive oil: 65 MAD, w kayn f stock (4). L-oujda, katwslo f 2 yum. L-horaires: tnin l-sbt, 9:00–18:00.

Latency: 1324 ms

## grocery/cross-business — PASS

Customer: 3andkom Atlas cotton shirt bch7al?

Bot: Smeh liya, had l-produit makaynch db f l-magasin dyalna.

Latency: 3 ms

## grocery/followup-location — PASS

Customer: salam, fin kaynin?

Bot: Kaynin f Fictional Main Street, Oujda.

Latency: 3 ms

## grocery/followup-hours — PASS

Customer: w nhar l7ed, khdamin?

Bot: La, nhar l7ed msdoudin. L7orari dyalhom men tnin l sebt, men 9:00 l 18:00.

Latency: 1211 ms