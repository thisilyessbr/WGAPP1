# Relayqo — تعليمات تنفيذ نظام WhatsApp متعدد العملاء لأي AI Agent

**هذا الملف Prompt تنفيذي للـAI Agent.**  
**لا تبدأ البرمجة لمجرد قراءة الملف؛ ابدأ فقط عندما يقول المستخدم صراحة: نفّذ الخطة.**  
**المصدر التشغيلي المكمل:** `docs/CLIENT_WHATSAPP_ONBOARDING_RUNBOOK_AR.md`

---

## 1. المهمة

طوّر مشروع Relayqo ليخدم عدة عملاء تجارة إلكترونية. كل عميل يملك أرقام WhatsApp ومنتجات وطلبات ومحادثات مستقلة. يجب أن يرد Chatbot من الرقم نفسه الذي استقبل الرسالة.

النظام يدعم مسارين:

1. `META_CLOUD`: المسار الرسمي والأساسي.
2. `QR_WEB`: مسار اختياري واستثنائي ومتوقف افتراضيًا.

لا تعد المستخدم أو العميل بأن QR رسمي أو مضمون. لا تستعمل QR للرسائل الجماعية أو الرسائل التي يبدأها البوت.

---

## 2. حدود المهمة

### مطلوب

- مفاتيح Meta منفصلة ومشفرة لكل عميل.
- ربط عدة أرقام بنفس العميل.
- Channel Router يختار Meta أو QR حسب الرقم المستقبِل.
- Tenant isolation صارم.
- Client Safety Guard.
- Human takeover.
- Kill Switch على مستوى المحادثة والرقم والعميل وQR كاملًا.
- حماية من الرسائل المكررة.
- حدود سرعة وفشل متكرر.
- مراقبة حالة كل رقم وتنبيهات.
- Audit log للعمليات الإدارية.
- QR متوقف افتراضيًا ولا يُنفذ قبل اكتمال Meta والعزل والحماية.
- دليل تشغيل واختبارات واضحة.

### غير مطلوب

- إنشاء أوراق تجارية أو تجاوز Business Verification.
- اختيار شركات أو سجلات عامة لا تخص العميل.
- رفع مستندات مزيفة.
- تخزين كلمات سر Facebook أو OTP.
- Bulk messaging أو scraping أو spam.
- نشر Production قبل نجاح الاختبارات وموافقة المستخدم الصريحة.

---

## 3. معلومات المشروع الحالية

مسار المشروع:

```text
C:\Users\IlyesSaber\Desktop\work
```

نقاط الربط المعروفة:

```text
src/app.ts
src/bootstrap.ts
src/domain/channel/whatsapp/WhatsAppWebhookRouter.ts
src/domain/channel/whatsapp/WhatsAppOnboardingRouter.ts
src/domain/channel/whatsapp/WhatsAppOnboardingService.ts
src/domain/channel/whatsapp/WhatsAppNumberService.ts
src/domain/channel/whatsapp/WhatsAppOutboundAdapter.ts
src/domain/channel/whatsapp/WhatsAppWorker.ts
src/domain/channel/whatsapp/WhatsAppPolicyAdapter.ts
src/domain/channel/whatsapp/MessageQueue.ts
prisma/schema.prisma
```

المسارات الحالية:

```text
/api/v1/webhook/whatsapp
/api/webhook/whatsapp
/api/v1/whatsapp/embedded-signup
/api/whatsapp/embedded-signup
/api/whatsapp
```

الحالة المعروفة:

- قاعدة البيانات تدعم `WhatsAppBusinessNumber` وربط الرقم بـTenant وAccount.
- `phoneNumberId` فريد.
- Worker يرد على الرقم المستقبِل.
- الإرسال الحالي يعتمد على `WHATSAPP_ACCESS_TOKEN` عام.
- Embedded signup يستقبل `tenantId`, `accountId`, `wabaId`, `phoneNumberId`.

مشاكل يجب إصلاحها قبل تعدد العملاء:

1. Meta access token عام بدل Token خاص بكل عميل.
2. Signup state مكتوب Base64 فقط ويجب توقيعه والتحقق منه cryptographically.
3. PIN افتراضي ثابت غير مقبول.
4. فشل Webhook subscription أو تسجيل الرقم لا يجب أن يتحول إلى `CONNECTED`.
5. Network failure لا يعني أن الرقم مسجل.

لا تعِد فحص المشروع كاملًا. اقرأ الملفات المذكورة ووسّع البحث فقط عندما يظهر dependency مباشر.

---

## 4. قواعد العمل للـAI Agent

1. افحص `AGENTS.md` إن وُجد قبل التعديل.
2. اعرض خطة قصيرة ثم نفّذ بعد تفويض المستخدم.
3. لا تمسح أو تستبدل تعديلات المستخدم غير المرتبطة.
4. خذ نسخة واضحة من `git status` وdiff قبل التعديل.
5. استعمل migrations ولا تستعمل destructive database reset.
6. لا تطبع Secrets في Tool output أو Logs.
7. لا تضع Secrets في Git أو `.env.example`.
8. لا تنشر أو تطبق migration على Production قبل موافقة المستخدم.
9. نفّذ كل Phase واختبرها قبل الانتقال للتي بعدها.
10. إذا كان المشروع يحتوي أخطاء TypeScript قديمة، افصل الأخطاء الجديدة عن القديمة وأبلغ عنها بدقة.

---

## 5. Architecture المطلوبة

```text
Inbound Message
      │
      ├── Meta Webhook
      └── QR Session Event
              │
              ↓
        Channel Router
              │
              ↓
   Resolve Connection + Number
              │
              ↓
    Resolve Tenant + Account
              │
              ↓
     Client Safety Guard
              │
              ↓
 Conversation Engine + Products
              │
              ↓
    Order / Human Takeover
              │
              ↓
 Outbound through originating channel
```

قاعدة الإرسال:

```text
IF transport = META_CLOUD
    load encrypted Meta token for the resolved connection
    send using the originating phoneNumberId

ELSE IF transport = QR_WEB
    verify QR feature flag and Safety Guard
    load the exact originating session
    send only an inbound reply through that session

ELSE
    block and alert
```

ممنوع fallback من رقم إلى رقم مختلف. إذا فشل الرقم المستقبِل، توقف الرسالة وسجّل الخطأ.

---

## 6. Data Model المقترح

الأسماء قابلة للتعديل لتناسب Naming conventions الموجودة، لكن العلاقات والقيود إلزامية.

### ChannelConnection

```text
id
tenantId
accountId
provider: META_CLOUD | QR_WEB
status: PENDING | CONNECTED | PAUSED | BLOCKED | LOGGED_OUT | FAILED
enabled
encryptedCredentials
appId?              // Meta
wabaId?             // Meta
sessionKey?         // QR internal identifier
lastConnectedAt?
lastError?
createdAt
updatedAt
```

قيود:

- كل Connection تنتمي إلى Tenant وAccount واحدين.
- `sessionKey` لا يحتوي رقم الهاتف أو Secret.
- Credentials مشفرة application-side قبل الكتابة.

### WhatsAppBusinessNumber

أضف أو ثبّت:

```text
connectionId
transport
phoneNumberId أو internalNumberKey
displayPhoneNumber
status
enabled
```

قيود:

- الرقم لا ينتقل إلى Tenant آخر بواسطة upsert.
- الرقم لا يملك أكثر من Connection فعّال.
- كل reply يستعمل Connection المرتبطة بالرقم المستقبِل.

### ConversationAutomationState

```text
tenantId
accountId
conversationId
botEnabled
humanTakeover
pausedUntil?
pauseReason?
updatedBy?
updatedAt
```

### ChannelAuditEvent

```text
tenantId
accountId
connectionId?
phoneNumberId?
conversationId?
actorId?
action
metadata بدون Secrets
createdAt
```

### QR Auth Store

إذا وصل التنفيذ إلى QR:

- احفظ credentials وSignal keys في database-backed store.
- شفّر كل قيمة باستخدام AES-256-GCM أو secret-management solution مناسبة.
- لا تستعمل file auth في Production.
- QR token نفسه Secret مؤقت ولا يظهر إلا لمستخدم Admin مخول.
- حذف Connection يحذف auth keys التابعة لها.

---

## 7. Phase 1 — Meta multi-client credentials

نفّذ هذا أولًا، ولا تبدأ QR قبله.

### المطلوب

1. إنشاء `ChannelConnection` أو `MetaConnection` لكل عميل.
2. إضافة `connectionId` لكل WhatsApp number.
3. إنشاء SecretBox لا يعمل بدون encryption key صحيح.
4. تخزين Meta token مشفرًا.
5. تعديل Outbound Adapter ليطلب Connection بواسطة `phoneNumberId`.
6. فك التشفير فقط لحظة الإرسال.
7. عدم تخزين decrypted token في Logs أو API responses.
8. إبقاء دعم المتغير العام فقط كخيار migration مؤقت إن لزم، مع Warning واضح، ثم إزالته بعد نقل البيانات.

### إصلاح onboarding

- وقّع state باستخدام HMAC secret.
- تحقق من tenant, account, timestamp وsignature.
- مدة صلاحية قصيرة.
- PIN يُدخل من العميل أو يولد بطريقة آمنة؛ لا يوجد `123456` افتراضي.
- Subscription failure = onboarding failed أو partial state واضح.
- Registration failure = `FAILED`, وليس `CONNECTED`.
- Retry يجب أن يكون idempotent.

### شروط القبول

- Token العميل A لا يمكن استعماله لرقم العميل B.
- خطأ Token لا يظهر قيمته في logs.
- signup state المعدل أو المنتهي يُرفض.
- فشل Meta لا ينتج رقمًا بحالة `CONNECTED`.
- الاختبارات الحالية لمسار Meta تبقى ناجحة.

---

## 8. Phase 2 — Channel Router

أنشئ interface موحدًا، مثل:

```text
ChannelTransport
├── sendText(...)
├── getStatus(...)
└── disconnect(...)

MetaCloudTransport implements ChannelTransport
QrWebTransport implements ChannelTransport لاحقًا
```

لا تجعل `WhatsAppWorker` يعرف تفاصيل Meta أو QR. Worker يرسل طلبًا موحدًا إلى Channel Router، والـRouter يختار Transport باستخدام الرقم/Connection بعد التحقق من Tenant.

### شروط القبول

- الرقم الرسمي يستمر في استعمال Meta.
- Unknown transport يُرفض.
- Disabled number يُرفض.
- Connection mismatch يُرفض.
- لا fallback إلى Token أو Session عميل آخر.

---

## 9. Phase 3 — Client Safety Guard

نفّذ Safety Guard قبل outbound send.

```text
IF tenant/account/number mismatch
    BLOCK + security audit

ELSE IF client/number/conversation paused
    BLOCK

ELSE IF humanTakeover
    BLOCK bot reply

ELSE IF duplicate
    IGNORE

ELSE IF rate exceeded
    PAUSE + alert

ELSE IF repeated provider failures
    circuit break the number

ELSE
    ALLOW
```

### Kill Switch APIs المطلوبة

- Pause/resume conversation.
- Pause/resume one number.
- Pause/resume one client.
- Disable all QR while Meta stays active.

كل endpoint إداري يحتاج authentication وauthorization وtenant scope.

### شروط القبول

- Agent من Client A لا يستطيع إيقاف أو قراءة Client B.
- Human takeover يمنع جواب البوت التالي.
- إيقاف رقم لا يوقف باقي أرقام العميل.
- Emergency QR stop لا يوقف Meta.
- كل تغيير يُكتب في Audit log.

---

## 10. Phase 4 — Admin UI

أنشئ واجهة غير تقنية تعرض:

```text
Client
Number
Transport
Status
Last connection
Last error sanitized
Message rate
Human takeover status
Pause / Resume
Disconnect
```

متطلبات الواجهة:

- لا تعرض Token أو App Secret أو QR session credentials.
- QR يظهر مؤقتًا للمستخدم المخول فقط.
- Confirmation مطلوب قبل logout/delete session.
- Badge واضح: `Official Meta` أو `Temporary QR`.
- Warning واضح فوق QR بأنه غير رسمي وغير مضمون.

---

## 11. Phase 5 — QR الاختياري

لا تبدأ هذه المرحلة إلا عندما:

- يطلب المستخدم تنفيذ QR صراحة.
- Phase 1–4 ناجحة.
- توجد استضافة Backend مستمرة.
- توجد قاعدة بيانات دائمة.
- توجد موافقة عميل مكتوبة على الخطر.

### اختيار المكتبة

تحقق وقت التنفيذ من المكتبات النشطة والإصدارات الحالية. إذا استُعمل Baileys أو بديل غير رسمي:

- سجّل أنه غير تابع لـWhatsApp.
- راجع توافق Node وESM/CommonJS.
- ثبّت إصدارًا محددًا في lockfile.
- لا تستعمل filesystem auth في Production.
- لا تستعمله في Vercel Serverless.

### سلوك QR

- Session واحدة لكل رقم.
- inbound direct messages فقط.
- تجاهل groups/status/broadcast/fromMe.
- لا outbound initiation.
- reply through same session.
- reconnect محدود مع exponential backoff.
- logout يوقف reconnect ويحذف secrets.
- repeated disconnects تنقل الرقم إلى `BLOCKED`.

### Pilot

```text
1. رقم TEST واحد.
2. عميل واحد.
3. رسائل واردة فقط.
4. اختبر disconnect/reconnect.
5. اختبر duplicate protection.
6. اختبر Human takeover.
7. اختبر Kill Switch.
8. راقب Pilot قبل إضافة رقم ثانٍ.
```

### شروط القبول

- restart لا يفقد الجلسة إذا بقيت صالحة.
- session A لا ترسل من session B.
- logout يمنع reconnect.
- QR لا يعمل عندما feature flag متوقف.
- no secret appears in logs/API/database plaintext.
- failure لا يسبب إرسالًا من رقم آخر.

---

## 12. APIs المقترحة

استخدم conventions الموجودة في المشروع، وحافظ على نسخ `/api/v1`.

```text
POST   /api/v1/channel-connections/meta
GET    /api/v1/channel-connections
GET    /api/v1/channel-connections/:id
PATCH  /api/v1/channel-connections/:id/status
DELETE /api/v1/channel-connections/:id

POST   /api/v1/whatsapp/numbers/:id/pause
POST   /api/v1/whatsapp/numbers/:id/resume
POST   /api/v1/conversations/:id/human-takeover
POST   /api/v1/conversations/:id/resume-bot
POST   /api/v1/tenants/:id/pause-automation

POST   /api/v1/channel-connections/qr           // optional Phase 5
GET    /api/v1/channel-connections/qr/:id/status
POST   /api/v1/channel-connections/qr/:id/reconnect
DELETE /api/v1/channel-connections/qr/:id
```

لا تعتمد على `tenantId` القادم من body وحده. استخرجه من authenticated principal ثم تحقق أن resource تنتمي إليه.

---

## 13. الاختبارات المطلوبة

### Unit

- Encryption round trip and tamper rejection.
- Signed state valid/invalid/expired.
- Channel Router selects correct transport.
- Safety Guard allow/block branches.
- Human takeover.
- Rate limit and circuit breaker.

### Integration

- Tenant A cannot register or control Tenant B number.
- Phone number maps to one connection.
- Meta token selected by originating number.
- Failed onboarding never becomes connected.
- Duplicate webhook is processed once.
- Pause number blocks outbound.
- Audit events contain no Secrets.

### QR optional

- Feature disabled by default.
- Admin authorization required.
- Session persistence mocked/tested.
- Direct inbound message enqueued once.
- Groups/status/fromMe ignored.
- reply uses same session.
- logout deletes auth state.

### Regression

- Run existing targeted WhatsApp tests.
- Run project test suite when feasible.
- Report old failures separately from failures introduced by the change.

---

## 14. Deployment plan

```text
Step 1: local migrations and tests
Step 2: staging database
Step 3: Meta test number
Step 4: one production client + one official number
Step 5: second official number
Step 6: more clients gradually
Step 7: optional QR Pilot only after explicit approval
```

لا تطبق Production migration أو تنشر دون عرض:

- migration SQL.
- environment variables المطلوبة بدون قيم Secrets.
- test results.
- rollback plan.
- known risks.

متطلبات الاستضافة:

- موقع Relayqo يبقى على Vercel.
- Backend Meta يمكن تشغيله على خدمة HTTPS مستقرة.
- QR يحتاج long-running process وpersistent database؛ لا يعمل كـVercel Serverless function قصيرة.

---

## 15. الأشياء التي تحتاج المستخدم ولا يستطيع Agent إتمامها وحده

- تسجيل دخول Facebook/Meta.
- Password و2FA.
- SMS أو voice OTP لكل رقم.
- رفع أوراق العميل.
- إدخال طريقة الدفع.
- قبول شروط Meta/WhatsApp باسم العميل.
- مسح QR من هاتف العميل.
- موافقة العميل على المخاطر.
- قرار نشر Production.

توقف عند هذه النقاط واعرض للمستخدم خطوة واضحة واحدة. لا تطلب منه مشاركة Password أو Token داخل المحادثة.

---

## 16. Definition of Done

تُعتبر المهمة البرمجية مكتملة فقط عندما:

- [ ] Meta credentials منفصلة ومشفرة لكل عميل.
- [ ] Signed onboarding state يعمل.
- [ ] فشل onboarding لا ينتج اتصالًا كاذبًا.
- [ ] Channel Router يختار وسيلة الرقم الصحيح.
- [ ] كل reply يخرج من الرقم المستقبِل.
- [ ] Tenant isolation tests ناجحة.
- [ ] Human takeover وKill Switch ناجحان.
- [ ] لا Secrets في logs أو API responses.
- [ ] Admin UI تعرض الحالة بدون كشف Secrets.
- [ ] Meta regression tests ناجحة.
- [ ] QR، إن نُفذ، متوقف افتراضيًا واجتاز Pilot tests.
- [ ] migrations وrollback موثقان.
- [ ] runbook محدث حسب التنفيذ النهائي.
- [ ] لم يتم النشر دون موافقة المستخدم.

---

## 17. المخرجات المطلوبة من الـAI Agent

عند نهاية التنفيذ، أعط المستخدم:

1. ملخص ما تغير ولماذا.
2. قائمة الملفات المعدلة.
3. migrations التي أُنشئت.
4. environment variables المطلوبة بدون القيم.
5. نتائج الاختبارات.
6. المخاطر أو القيود المتبقية.
7. خطوات تشغيل العميل الأول.
8. rollback steps.
9. رابط أو مسار Runbook المحدث.

لا تقل إن المهمة مكتملة إذا بقيت اختبارات مطلوبة أو فشل أمني أو migration غير مُراجع.

