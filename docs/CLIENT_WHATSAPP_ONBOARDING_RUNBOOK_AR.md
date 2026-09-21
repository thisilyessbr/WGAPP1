# Relayqo — دليل إضافة عملاء WhatsApp وتشغيل Chatbot

**نوع الملف:** تعليمات تشغيل فعلية  
**آخر تحديث:** 12 سبتمبر 2026  
**اللغة:** العربية  
**الحالة:** Meta وQR منفّذان في الكود؛ QR متوقف افتراضيًا ولا يُفعّل إلا كتجربة محدودة

---

## 1. الهدف

هذا الدليل يشرح كيف تضيف عميل تجارة إلكترونية عنده عدة أرقام WhatsApp ويريد أن يرد Chatbot من كل رقم بدلًا منه.

القواعد الأساسية:

- كل عميل يملك Meta Business Portfolio والأرقام وطريقة الدفع الخاصة به.
- Relayqo يدير Chatbot والتكامل التقني فقط.
- كل رسالة يجب أن تخرج من الرقم نفسه الذي استقبلها.
- منتجات وطلبات ومحادثات كل عميل تبقى منفصلة.
- Meta Cloud API هو المسار الأساسي.
- QR مسار استثنائي مؤقت للأرقام الإضافية فقط، ولا يوجد ضمان ضد فصله أو تقييده.

---

## 2. شجرة القرار الرئيسية

```text
START: عميل جديد يريد Chatbot على أرقامه
│
├── هل عنده أوراق نشاط مقبولة لدى Meta؟
│   │
│   ├── نعم
│   │   ├── أنشئ/استعمل Meta Business Portfolio الخاص به
│   │   ├── أكمل Business Verification بأوراقه
│   │   ├── أنشئ Meta App وWABA خاصين به
│   │   ├── اربط جميع أرقامه رسميًا عبر Meta
│   │   └── لا تستعمل QR
│   │
│   └── لا
│       ├── اربط رقمًا أو رقمين رسميًا عبر Meta
│       │
│       ├── هل يقبل أن تبقى الأرقام الأخرى يدوية؟
│       │   └── نعم → META فقط + الأرقام الأخرى يدوية
│       │
│       └── هل يشترط Chatbot على جميع الأرقام؟
│           ├── لا يقبل خطر QR → STOP: لا يوجد حل رسمي يحقق ذلك بلا أوراق
│           └── يقبل الخطر كتابةً → Pilot QR ثم Hybrid تدريجي
```

---

## 3. قبل قبول أي عميل

### 3.1 معلومات العميل

اجمع المعلومات التالية:

- [ ] الاسم الكامل لصاحب الحساب.
- [ ] اسم المتجر والعلامة التجارية.
- [ ] البلد والمدينة.
- [ ] رابط الموقع أو صفحة المتجر.
- [ ] رابط Facebook وInstagram إن وُجدا.
- [ ] عدد أرقام WhatsApp المطلوبة.
- [ ] قائمة الأرقام بصيغة دولية، مثل `+2126XXXXXXXX`.
- [ ] وظيفة كل رقم أو مصدر الإعلانات المرتبط به.
- [ ] هل الأرقام تعمل حاليًا على WhatsApp العادي أو WhatsApp Business؟
- [ ] هل كل رقم يستطيع استقبال SMS أو مكالمة OTP؟
- [ ] هل العميل عنده Meta Business Portfolio؟
- [ ] هل Meta Business موثّق؟
- [ ] هل عنده أوراق نشاط؟
- [ ] من سيدخل طريقة الدفع الخاصة برسائل Meta؟
- [ ] اسم الموظف المسؤول عن استلام المحادثة من البوت.

### 3.2 معلومات المتجر والبوت

- [ ] قائمة المنتجات والأسماء والأسعار.
- [ ] المخزون أو طريقة التأكد منه.
- [ ] المدن التي يشحن إليها.
- [ ] ثمن الشحن لكل مدينة أو منطقة.
- [ ] سياسة الاستبدال والاسترجاع.
- [ ] الأسئلة المتكررة.
- [ ] اللغات المطلوبة: العربية، الدارجة، الفرنسية أو الإنجليزية.
- [ ] بيانات الطلب: الاسم، الهاتف، المدينة، العنوان، المنتَج، الكمية.
- [ ] الحالات التي يجب فيها تحويل الزبون إلى موظف.
- [ ] ساعات العمل.

### 3.3 تصنيف حساسية الأرقام

صنّف كل رقم:

```text
CRITICAL   = رقم رئيسي، قديم أو عليه مبيعات كثيرة
STANDARD   = رقم مبيعات عادي
TEST       = رقم غير مهم ويمكن استعماله للتجربة
```

قواعد التصنيف:

- لا تستعمل QR أول مرة على رقم `CRITICAL`.
- أول Pilot يجب أن يكون على رقم `TEST`.
- الأرقام `CRITICAL` تستعمل Meta الرسمي كلما كان ذلك ممكنًا.

---

## 4. تعليمات جلسة AnyDesk

### 4.1 الملكية والأمان

- العميل يدخل إلى Facebook وMeta بنفسه.
- العميل لا يرسل لك كلمة السر.
- العميل يدخل OTP بنفسه.
- العميل يدخل معلومات بطاقته البنكية بنفسه.
- لا تحفظ صورة للشاشة تحتوي Token أو App Secret أو QR.
- لا تنقل ملكية WABA أو الأرقام إلى Relayqo.
- العميل يمنحك صلاحية Admin أو Developer اللازمة فقط.
- بعد انتهاء العمل، يراجع العميل قائمة الأشخاص والصلاحيات.

### 4.2 ترتيب جلسة AnyDesk

```text
1. افتح Meta Business Suite في حساب العميل.
2. تأكد من اسم Business Portfolio الصحيح.
3. افحص حالة Business Verification.
4. افحص WhatsApp Manager والأرقام الموجودة.
5. افحص Meta for Developers والتطبيقات الموجودة.
6. اختر CASE A أو CASE B من هذا الدليل.
7. نفّذ الإعداد رقمًا بعد رقم.
8. اختبر كل رقم قبل الانتقال إلى التالي.
9. سجل IDs فقط في مكان آمن؛ لا تسجل الأسرار في ملف عادي.
10. أعط العميل ملخصًا بالأرقام المتصلة وحالتها.
```

---

## 5. CASE A — العميل عنده أوراق

### 5.1 الأوراق

يستعمل العميل المستندات التي تعرضها له صفحة Meta أثناء Business Verification. قد تشمل، حسب البلد ونوع النشاط:

- شهادة تسجيل أو تأسيس النشاط.
- رخصة تجارية أو مهنية.
- وثيقة ضريبية رسمية للنشاط.
- كشف حساب بنكي تجاري.
- فاتورة خدمات لإثبات العنوان أو الهاتف عندما تسمح Meta بذلك.

يجب أن يتطابق الاسم القانوني والعنوان والهاتف في النموذج مع المستندات. لا تستعمل أوراق شخص أو شركة أخرى.

### 5.2 خطوات Meta

```text
1. Client logs into his Facebook account.
2. افتح Business Settings.
3. افتح Business Info وتأكد من البيانات.
4. افتح Security Center / Verification.
5. ابدأ Business Verification.
6. أدخل الاسم القانوني كما هو في الأوراق.
7. ارفع المستندات المطلوبة.
8. انتظر قرار Meta وعالج أي طلب تصحيح.
9. بعد VERIFIED افتح Meta for Developers.
10. أنشئ App خاصًا بهذا العميل أو استعمل App يملكه.
11. أضف WhatsApp use case.
12. أنشئ أو اختر WABA الخاص بالعميل.
13. أضف طريقة الدفع الخاصة بالعميل.
14. اربط Webhook الخاص بـRelayqo.
15. اشترك في Webhook events المطلوبة.
16. أضف كل رقم واستقبل OTP.
17. اختبر الرقم قبل إضافة الرقم التالي.
```

### 5.3 البنية النهائية

```text
Client A — VERIFIED
├── Meta Business Portfolio A
├── Meta App A
├── WABA A
├── Number A1 → META
├── Number A2 → META
├── Number A3 → META
├── Number A4 → META
├── Number A5 → META
├── Number A6 → META
├── Number A7 → META
└── Number A8 → META
```

### 5.4 النتيجة المطلوبة

- [ ] جميع الأرقام تظهر في WhatsApp Manager.
- [ ] جميع الأرقام مرتبطة بالعميل الصحيح داخل Relayqo.
- [ ] كل رقم يستقبل رسالة ويرد من الرقم نفسه.
- [ ] لا توجد جلسات QR لهذا العميل.

---

## 6. CASE B — العميل ما عندوش أوراق

### 6.1 المسار الآمن أولًا

```text
1. العميل ينشئ Meta Business Portfolio خاصًا به.
2. ينشئ App وWABA خاصين به.
3. نربط رقمًا رسميًا واحدًا.
4. نختبره كاملًا.
5. نضيف الرقم الرسمي الثاني عندما يسمح الحساب بذلك.
6. تبقى الأرقام الأخرى يدوية إذا لم يقبل العميل QR.
```

### 6.2 إذا أراد Chatbot على جميع الأرقام

اشرح له قبل أي عمل:

> الأرقام الرسمية تستعمل Meta Cloud API. الأرقام الإضافية ستستعمل اتصال QR غير رسمي ومؤقت. قد تنفصل الجلسة أو تحتاج إعادة ربط، وقد يقيّد WhatsApp الرقم. Relayqo يستطيع تقليل الأخطاء وحماية البيانات، لكنه لا يستطيع ضمان قبول WhatsApp لهذا الاتصال.

احصل على موافقته كتابةً، ثم اتبع هذه الخطة فقط عند اتخاذ قرار تنفيذ QR لاحقًا:

```text
1. اختر رقم TEST واحدًا.
2. لا تبدأ بالأرقام الرئيسية.
3. العميل يمسح QR بنفسه من Linked devices.
4. اربط Session بالـTenant والـAccount الصحيحين.
5. فعّل Client Safety Guard.
6. اختبر الرسائل الواردة فقط.
7. اختبر Human takeover وKill Switch.
8. راقب Pilot مدة متفقًا عليها.
9. IF الجلسة مستقرة ولا توجد إنذارات
       أضف رقمًا واحدًا آخر
   ELSE
       أوقف QR وابقَ على Meta الرسمي
10. لا تضف جميع الأرقام في يوم واحد.
```

### 6.3 البنية المختلطة لثمانية أرقام

```text
Client B — UNVERIFIED / HYBRID
├── Number B1 → META الرسمي
├── Number B2 → META الرسمي
├── Number B3 → QR مؤقت
├── Number B4 → QR مؤقت
├── Number B5 → QR مؤقت
├── Number B6 → QR مؤقت
├── Number B7 → QR مؤقت
└── Number B8 → QR مؤقت
```

### 6.4 قواعد QR الإجبارية

- [ ] البوت يرد فقط عندما يرسل الزبون أولًا.
- [ ] لا توجد رسائل جماعية.
- [ ] لا توجد حملات يبدأها البوت.
- [ ] تجاهل Groups وStatus وBroadcast.
- [ ] تجاهل الرسائل الصادرة من صاحب الرقم.
- [ ] رقم واحد لا يرى محادثات رقم آخر.
- [ ] Tenant لا يستطيع الوصول إلى Tenant آخر.
- [ ] Session مشفرة ولا تُحفظ في Git.
- [ ] يوجد حد للردود في الدقيقة.
- [ ] يوجد منع للرسائل المكررة.
- [ ] يوجد Human takeover.
- [ ] يوجد Kill Switch لكل محادثة ورقم وعميل.
- [ ] يوجد تنبيه عند فصل الجلسة.
- [ ] يوجد سجل تدقيق لعمليات الربط والإيقاف.

### 6.5 ما لا نعد به العميل

- لا نعد بأن QR رسمي.
- لا نعد بأن الجلسة لن تنفصل.
- لا نعد بأن الرقم لن يتعرض للتقييد.
- لا نعد بتشغيل الرسائل الجماعية.
- لا نضع أرقام العميل داخل حساب Relayqo.

---

## 7. CASE C — العميل حصل على الأوراق لاحقًا

الهدف هو إزالة QR تدريجيًا:

```text
2 META + 6 QR
      ↓
4 META + 4 QR
      ↓
6 META + 2 QR
      ↓
8 META + 0 QR
```

خطوات نقل كل رقم:

```text
1. اختر رقم QR واحدًا.
2. أوقف البوت عليه.
3. احفظ الطلبات والمحادثات اللازمة.
4. اتبع مسار Meta المتاح لنقل أو تسجيل الرقم.
5. استقبل OTP من العميل.
6. اربط phoneNumberId الرسمي بالـTenant نفسه.
7. اختبر رسالة واردة وجوابًا من الرقم نفسه.
8. اختبر الطلب وHuman takeover.
9. احذف Session QR ومفاتيحها لذلك الرقم.
10. انتقل إلى الرقم التالي.
```

---

## 8. Architecture داخل Relayqo

### 8.1 المسار العام

```text
                  ┌── Meta Webhook ───────┐
WhatsApp Number ──┤                        ├── Channel Router
                  └── QR Session Event ───┘         │
                                                     ↓
                                           Resolve phone/session
                                                     ↓
                                            Resolve Tenant/Account
                                                     ↓
                                            Client Safety Guard
                                                     ↓
                                           Conversation + Products
                                                     ↓
                                            Order / Human handoff
                                                     ↓
                                   Reply through the originating channel
```

### 8.2 قاعدة IF / ELSE للإرسال

```text
IF incoming transport = META
    استعمل Meta token الخاص بذلك العميل
    أرسل من phoneNumberId الذي استقبل الرسالة

ELSE IF incoming transport = QR
    استعمل Session الخاصة بذلك الرقم
    أرسل من Session التي استقبلت الرسالة

ELSE
    BLOCK ولا تحاول استعمال رقم آخر
```

### 8.3 عزل العملاء

```text
Client A Tenant
├── Products A
├── Orders A
├── Conversations A
├── Meta Credentials A
└── QR Sessions A

Client B Tenant
├── Products B
├── Orders B
├── Conversations B
├── Meta Credentials B
└── QR Sessions B
```

لا توجد مشاركة Credentials أو Sessions أو Product data بين العميلين.

---

## 9. Client Safety Guard

```text
IF phone/session لا ينتمي إلى Tenant
    BLOCK + SECURITY ALERT

ELSE IF client أو number متوقف
    BLOCK

ELSE IF Human takeover مفعّل
    BLOCK BOT واترك الموظف يجيب

ELSE IF message مكررة
    IGNORE

ELSE IF group/status/broadcast/fromMe
    IGNORE

ELSE IF rate limit متجاوز
    PAUSE + ALERT

ELSE IF disconnects أو failures متكررة
    KILL SWITCH للرقم

ELSE
    ALLOW reply من نفس الرقم
```

حالات كل رقم:

```text
SAFE       → يعمل
WATCH      → يعمل بحدود أقل مع مراقبة
PAUSED     → الموظف يجيب
BLOCKED    → متوقف حتى المراجعة
LOGGED_OUT → يحتاج إعادة ربط من العميل
```

---

## 10. قائمة اختبار كل رقم

لا تعتبر الرقم جاهزًا قبل نجاح جميع الاختبارات:

### الاتصال

- [ ] الرقم يظهر `CONNECTED`.
- [ ] الرقم مربوط بالعميل والحساب الصحيحين.
- [ ] وسيلة الاتصال صحيحة: `META` أو `QR`.
- [ ] لا تظهر Credentials في Logs أو Responses.

### الرسائل

- [ ] أرسل `سلام` من رقم زبون تجريبي.
- [ ] وصلت الرسالة إلى Tenant الصحيح.
- [ ] جاء الرد من الرقم نفسه.
- [ ] اللغة مناسبة.
- [ ] الرسالة نفسها لم تُعالج مرتين.

### المنتجات والطلبات

- [ ] اسأل عن منتج موجود.
- [ ] السعر والوصف يعودان للعميل الصحيح.
- [ ] اختبر منتجًا غير موجود.
- [ ] أنشئ طلبًا تجريبيًا.
- [ ] الطلب يحتوي البيانات المطلوبة.
- [ ] الطلب يظهر للعميل الصحيح فقط.

### الأمان

- [ ] اختبر Human takeover.
- [ ] اختبر Pause conversation.
- [ ] اختبر Pause number.
- [ ] اختبر Pause client.
- [ ] اختبر أن توقف رقم لا يوقف عميلًا آخر.
- [ ] اختبر أن رسالة Group لا تشغّل البوت.
- [ ] اختبر حد سرعة الردود.
- [ ] اختبر فصل الاتصال والتنبيه.

### الموافقة النهائية

- [ ] العميل أرسل رسالة بنفسه ورأى الرد.
- [ ] العميل يعرف كيف يوقف البوت.
- [ ] العميل يعرف كيف يأخذ المحادثة يدويًا.
- [ ] العميل يعرف من يتصل به عند العطل.

---

## 11. تشغيل 10 عملاء

لا تضف 10 عملاء دفعة واحدة.

```text
Wave 1: عميل واحد + رقم واحد
Wave 2: نفس العميل + الرقم الثاني
Wave 3: عميل ثانٍ
Wave 4: ثلاثة عملاء
Wave 5: زيادة تدريجية بعد قياس الاستقرار والدعم
```

البنية المقترحة عند التوسع:

```text
Relayqo Core
├── Client A connection worker
├── Client B connection worker
├── Client C connection worker
└── Client N connection worker
```

تعطل Worker عميل واحد لا يجب أن يوقف بقية العملاء.

### ملاحظة الاستضافة

- الموقع التسويقي `relayqo.online` يمكن أن يبقى على Vercel.
- Meta Webhook يحتاج Backend متاحًا عبر HTTPS.
- QR يحتاج خادمًا مستمرًا واتصال WebSocket طويلًا وقاعدة بيانات دائمة.
- لا تخطط لتشغيل QR داخل وظيفة Vercel Serverless قصيرة.

---

## 12. المراقبة اليومية

راجع يوميًا:

- [ ] حالة كل رقم.
- [ ] عدد الرسائل الواردة والردود الناجحة.
- [ ] أخطاء الإرسال.
- [ ] مرات فصل QR.
- [ ] الرسائل المكررة التي تم منعها.
- [ ] المحادثات المحولة للإنسان.
- [ ] شكاوى أو طلبات إلغاء الاشتراك.
- [ ] جودة أرقام Meta والتنبيهات الموجودة في WhatsApp Manager.

قواعد التصعيد:

```text
IF خطأ إرسال واحد مؤقت
    RETRY محدود

ELSE IF أخطاء متكررة
    PAUSE number + ALERT

ELSE IF Account warning أو logout
    BLOCK number + تواصل مع العميل

ELSE IF اشتباه في اختلاط بيانات العملاء
    EMERGENCY STOP + تحقيق قبل إعادة التشغيل
```

---

## 13. إلغاء خدمة عميل

```text
1. أوقف البوت لجميع أرقام العميل.
2. سلّم العميل قائمة الأصول والحالة.
3. أزل صلاحية Relayqo من Meta إذا انتهت الخدمة.
4. ألغِ QR Linked devices الخاصة بالخدمة.
5. احذف Sessions ومفاتيحها من Relayqo.
6. ألغِ Jobs المجدولة لذلك العميل.
7. صدّر أو احذف بياناته حسب الاتفاق.
8. تحقق أن الإلغاء لم يؤثر في أي Tenant آخر.
9. سجل العملية في Audit log.
```

---

## 14. بطاقة تنفيذ لكل عميل

انسخ هذه البطاقة عند إضافة عميل:

```text
CLIENT ONBOARDING CARD

Client name:
Tenant ID:
Account ID:
Store name:
Owner:
Meta Business ID:
Meta App ID:
WABA ID:
Verification status: VERIFIED / UNVERIFIED / PENDING
Documents available: YES / NO
Payment owner:
Human takeover contact:

Numbers:
1. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______
2. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______
3. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______
4. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______
5. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______
6. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______
7. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______
8. __________  META / QR  CRITICAL / STANDARD / TEST  Status: ______

Pilot number:
Pilot start date:
Pilot result:
Safety tests passed: YES / NO
Client approval received: YES / NO
Production date:
Notes:
```

لا تضع Access Token أو App Secret أو QR أو كلمات السر في هذه البطاقة.

---

## 15. الوضع المعماري المنفّذ في المشروع (Phases 1–4 Complete)

تم تنفيذ وتفعيل معمارية WhatsApp متعددة العملاء (Multi-Client) بالكامل داخل الكود واجتياز جميع الاختبارات:

- [x] **Channel Router (`ChannelRouter`, `MetaCloudTransport`):** توجيه الإرسال الصادر والوارد بدقة تامة إلى الرقم المستقبِل حصراً بدون أي Fallback cross-tenant.
- [x] **Encrypted Connection Store (`SecretBox` + `ChannelConnection`):** تشفير AES-256-GCM لمفاتيح كل عميل وحفظها مشفرة في قاعدة البيانات دون تخزين أو كشف Tokens في الـ Logs أو الـ APIs.
- [x] **Signed Embedded Signup State:** توقيع HMAC-SHA256 لـ State مع التحقق الصارم من انتهاء الصلاحية والتلاعب، وإلغاء الـ PIN الثابت، ومعالجة فشل التسجيل/الاشتراك كـ `FAILED`.
- [x] **Client Safety Guard (`ClientSafetyGuard`):** فحص عزل الـ Tenant/Account/Number، إيقاف الردود عند `Human Takeover`، وحدود السرعة (Rate Limiting)، وحماية الأعطال المتكررة (Circuit Breaker).
- [x] **Kill Switch APIs:** إيقاف واستئناف رقم، محادثة، أو العميل بالكامل، بالإضافة لمفتاح طوارئ إيقاف QR.
- [x] **Admin Dashboard & UI:** واجهة غير تقنية متاحة على `/api/v1/channels/ui` و `/api/v1/channels/dashboard` تعرض حالة الأرقام ومعدلات الرسائل مع شارات مميزة (`Official Meta` و `Temporary QR`) وتحذيرات واضحة دون كشف أي Secrets.
- [x] **Tenant isolation tests:** اجتياز 75 اختباراً شاملاً بنجاح 100%.

```text
ملاحظة هامة حول QR:
مسار QR يبقى معطلاً افتراضياً (Feature Flag: Disabled / Emergency Stop Active)،
ولا يُفعّل إلا في بيئة استضافة مستمرة بطلب صريح وموافقة كتابية من العميل على المخاطر.
```

---

## 16. المراجع

- شروط مقدمي خدمات WhatsApp: https://www.whatsapp.com/legal/business-terms-for-service-providers
- شروط WhatsApp Business Solution: https://www.whatsapp.com/legal/business-solution-terms
- شروط WhatsApp Business: https://www.whatsapp.com/legal/business-terms
- حدود الأرقام والتوثيق لدى مزود رسمي: https://www.twilio.com/docs/whatsapp/api
- تسجيل WhatsApp Senders: https://www.twilio.com/docs/whatsapp/self-sign-up
