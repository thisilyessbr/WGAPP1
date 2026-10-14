(() => {
  const translations = new Map([
    ['Your workspace','Votre espace','مساحة عملك'],['Workspace','Espace de travail','مساحة العمل'],['Platform','Plateforme','المنصة'],['Overview','Vue d’ensemble','نظرة عامة'],['Business data','Données de l’entreprise','بيانات النشاط'],['Plans','Offres','الباقات'],['Clients','Clients','العملاء'],['Users','Utilisateurs','المستخدمون'],['Usage & costs','Utilisation et coûts','الاستخدام والتكاليف'],['Secure workspace','Espace sécurisé','مساحة عمل آمنة'],['Business owner','Propriétaire','صاحب النشاط'],['Administrator','Administrateur','المشرف'],['Need help?','Besoin d’aide ?','تحتاج إلى مساعدة؟'],['Our team can help you prepare your chatbot.','Notre équipe peut vous aider à préparer votre chatbot.','يمكن لفريقنا مساعدتك في إعداد روبوت المحادثة.'],['Log out','Se déconnecter','تسجيل الخروج'],
    ['Chatbot status','Statut du chatbot','حالة روبوت المحادثة'],['Active','Actif','نشط'],['Paused','En pause','متوقف مؤقتًا'],['Action needed','Action requise','يلزم اتخاذ إجراء'],['In setup','En préparation','قيد الإعداد'],['Your chatbot is enabled for your connected WhatsApp number.','Votre chatbot est activé pour votre numéro WhatsApp connecté.','روبوت المحادثة مفعّل لرقم واتساب المتصل.'],['Your setup is safely saved while you finish the remaining steps.','Votre configuration est enregistrée pendant que vous terminez les étapes restantes.','تم حفظ إعدادك أثناء إكمال الخطوات المتبقية.'],['Plan','Offre','الباقة'],['Mode','Mode','الوضع'],['Commerce','Commerce','التجارة الإلكترونية'],['Standard chatbot','Chatbot standard','روبوت محادثة عادي'],['Not assigned','Non attribuée','غير معيّنة'],['Connected','Connecté','متصل'],['Not connected','Non connecté','غير متصل'],['Published data','Données publiées','البيانات المنشورة'],['Not published','Non publiées','غير منشورة'],['Edit business data','Modifier les données','تعديل بيانات النشاط'],['Manage WhatsApp','Gérer WhatsApp','إدارة واتساب'],['Connect WhatsApp','Connecter WhatsApp','ربط واتساب'],['Here is how your chatbot performed during the last 30 days.','Voici les résultats de votre chatbot sur les 30 derniers jours.','إليك أداء روبوت المحادثة خلال آخر 30 يومًا.'],['Complete your workspace and we will prepare the chatbot for launch.','Complétez votre espace et nous préparerons le chatbot au lancement.','أكمل مساحة عملك وسنجهز روبوت المحادثة للإطلاق.'],
    ['Conversations','Conversations','المحادثات'],['Customer contacts','Contacts clients','جهات اتصال العملاء'],['Unique contacts','Contacts uniques','جهات اتصال فريدة'],['Messages used','Messages utilisés','الرسائل المستخدمة'],['Needs a person','Besoin d’un conseiller','تحتاج إلى موظف'],['Handoff requests','Demandes de transfert','طلبات التحويل'],['Last 30 days','30 derniers jours','آخر 30 يومًا'],['Message activity','Activité des messages','نشاط الرسائل'],['Customer and chatbot messages · last 14 days','Messages des clients et du chatbot · 14 derniers jours','رسائل العملاء والروبوت · آخر 14 يومًا'],['Last 14 days','14 derniers jours','آخر 14 يومًا'],['No customer messages yet. Activity will appear after your first WhatsApp conversation.','Aucun message client pour le moment. L’activité apparaîtra après votre première conversation WhatsApp.','لا توجد رسائل من العملاء بعد. سيظهر النشاط بعد أول محادثة عبر واتساب.'],['Monthly allowance','Quota mensuel','الحصة الشهرية'],['messages left','messages restants','رسالة متبقية'],['used','utilisés','مستخدمة'],['total','au total','الإجمالي'],['View plan details ›','Voir les détails de l’offre ›','عرض تفاصيل الباقة ›'],['Recent conversations','Conversations récentes','المحادثات الأخيرة'],['Latest activity across your connected number','Dernière activité sur votre numéro connecté','آخر نشاط على رقمك المتصل'],['Customer conversations will appear here.','Les conversations clients apparaîtront ici.','ستظهر محادثات العملاء هنا.'],['Needs reply','Réponse nécessaire','تحتاج إلى رد'],['Keep your chatbot accurate','Gardez votre chatbot à jour','حافظ على دقة روبوت المحادثة'],['Update business data','Mettre à jour les données','تحديث بيانات النشاط'],['Products, services, policies and FAQs','Produits, services, politiques et FAQ','المنتجات والخدمات والسياسات والأسئلة الشائعة'],['Services, policies and FAQs','Services, politiques et FAQ','الخدمات والسياسات والأسئلة الشائعة'],['WhatsApp connection','Connexion WhatsApp','اتصال واتساب'],['Connected and ready','Connecté et prêt','متصل وجاهز'],['Connection needs attention','Connexion à vérifier','الاتصال يحتاج إلى مراجعة'],['Knowledge documents','Documents de référence','مستندات المعرفة'],
    ['Launch checklist','Liste de lancement','قائمة الإطلاق'],['Business profile','Profil de l’entreprise','ملف النشاط'],['Tell the chatbot what your business offers','Expliquez au chatbot ce que propose votre entreprise','عرّف الروبوت بما يقدمه نشاطك'],['Choose a plan','Choisir une offre','اختر باقة'],['Select the capacity your business needs','Choisissez la capacité adaptée à votre activité','اختر السعة المناسبة لنشاطك'],['Link the number your customers use','Associez le numéro utilisé par vos clients','اربط الرقم الذي يستخدمه عملاؤك'],['Submit for review','Soumettre pour validation','إرسال للمراجعة'],['Send your setup to the Relayqo team','Envoyez votre configuration à l’équipe Relayqo','أرسل إعدادك إلى فريق Relayqo'],['Review ›','Vérifier ›','مراجعة ›'],['Start ›','Commencer ›','ابدأ ›'],['What happens next','Prochaine étape','الخطوة التالية'],['Administrator feedback','Retour de l’administrateur','ملاحظات المشرف'],['Complete the checklist and send your setup for review.','Terminez la liste et envoyez votre configuration pour validation.','أكمل القائمة ثم أرسل إعدادك للمراجعة.'],['Your administrator checks the business information, plan and WhatsApp connection before activation.','Votre administrateur vérifie les données, l’offre et la connexion WhatsApp avant l’activation.','يراجع المشرف بيانات النشاط والباقة واتصال واتساب قبل التفعيل.'],['Continue setup','Continuer la configuration','متابعة الإعداد'],
    ['Business information','Informations sur l’entreprise','معلومات النشاط'],['Saved data is published after administrator review.','Les données enregistrées sont publiées après validation par un administrateur.','تُنشر البيانات المحفوظة بعد مراجعة المشرف.'],['Business name','Nom de l’entreprise','اسم النشاط'],['Contact email','E-mail de contact','البريد الإلكتروني للتواصل'],['Phone','Téléphone','الهاتف'],['Website','Site web','الموقع الإلكتروني'],['What does your business offer?','Que propose votre entreprise ?','ماذا يقدم نشاطك؟'],['Address or service area','Adresse ou zone de service','العنوان أو نطاق الخدمة'],['Opening hours','Horaires d’ouverture','ساعات العمل'],['Currency (3 letters)','Devise (3 lettres)','العملة (3 أحرف)'],['Customer policies','Politiques clients','سياسات العملاء'],['Shipping / delivery','Expédition / livraison','الشحن / التوصيل'],['Returns','Retours','الإرجاع'],['Payment','Paiement','الدفع'],['Privacy / booking','Confidentialité / réservation','الخصوصية / الحجز'],['Products','Produits','المنتجات'],['Services','Services','الخدمات'],['FAQs','Questions fréquentes','الأسئلة الشائعة'],['Add product','Ajouter un produit','إضافة منتج'],['Add service','Ajouter un service','إضافة خدمة'],['Add FAQ','Ajouter une question','إضافة سؤال'],['No entries yet.','Aucune entrée pour le moment.','لا توجد عناصر بعد.'],['SKU','Référence','رمز المنتج'],['Product name','Nom du produit','اسم المنتج'],['Price','Prix','السعر'],['Stock','Stock','المخزون'],['Category','Catégorie','الفئة'],['Description','Description','الوصف'],['Service name','Nom du service','اسم الخدمة'],['Availability','Disponibilité','التوفر'],['Question','Question','السؤال'],['Answer','Réponse','الإجابة'],['Language: en, fr, ar or darija','Langue : en, fr, ar ou darija','اللغة: en أو fr أو ar أو darija'],['Sizes and colors','Tailles et couleurs','المقاسات والألوان'],['Add variant','Ajouter une variante','إضافة خيار'],['Variant SKU','Référence de la variante','رمز الخيار'],['Size','Taille','المقاس'],['Color','Couleur','اللون'],['Price override (blank uses product price)','Prix spécifique (vide = prix du produit)','سعر خاص (اتركه فارغًا لاستخدام سعر المنتج)'],['Remove variant','Supprimer la variante','حذف الخيار'],['Remove item','Supprimer l’élément','حذف العنصر'],['Unsaved changes','Modifications non enregistrées','تغييرات غير محفوظة'],['All changes saved','Toutes les modifications sont enregistrées','تم حفظ جميع التغييرات'],['Save changes','Enregistrer','حفظ التغييرات'],['Send for review','Envoyer pour validation','إرسال للمراجعة'],['Business data saved.','Données enregistrées.','تم حفظ بيانات النشاط.'],['PDFs up to 10 MB. Indexing starts after administrator approval.','PDF jusqu’à 10 Mo. L’indexation commence après validation de l’administrateur.','ملفات PDF حتى 10 ميغابايت. تبدأ الفهرسة بعد موافقة المشرف.'],['Choose a PDF','Choisir un PDF','اختر ملف PDF'],['Upload PDF','Téléverser le PDF','رفع ملف PDF'],['No documents yet.','Aucun document pour le moment.','لا توجد مستندات بعد.'],['Remove','Supprimer','حذف'],
    ['Choose what your business needs. Your administrator confirms the final plan.','Choisissez ce dont votre entreprise a besoin. Votre administrateur confirme l’offre finale.','اختر ما يناسب نشاطك. يؤكد المشرف الباقة النهائية.'],['Current plan','Offre actuelle','الباقة الحالية'],['Available','Disponible','متاحة'],['Assigned','Attribuée','معيّنة'],['Request this plan','Demander cette offre','طلب هذه الباقة'],['Plans will appear here when your administrator publishes them.','Les offres apparaîtront ici après leur publication par votre administrateur.','ستظهر الباقات هنا بعد نشرها من المشرف.'],['Plan request sent to your administrator.','Demande envoyée à votre administrateur.','تم إرسال طلب الباقة إلى المشرف.'],['messages','messages','رسائل'],['products','produits','منتجات'],['documents','documents','مستندات'],['WhatsApp number','numéro WhatsApp','رقم واتساب'],['WhatsApp numbers','numéros WhatsApp','أرقام واتساب'],['/ month','/ mois','/ شهر'],
    ['Link your business number. The administrator controls activation.','Associez votre numéro professionnel. L’activation est gérée par l’administrateur.','اربط رقم نشاطك. يتحكم المشرف في التفعيل.'],['Your connections','Vos connexions','اتصالاتك'],['No number connected yet.','Aucun numéro connecté pour le moment.','لا يوجد رقم متصل بعد.'],['Link a business number','Associer un numéro professionnel','ربط رقم نشاط'],['Your plan must be approved before linking a number.','Votre offre doit être approuvée avant d’associer un numéro.','يجب الموافقة على باقتك قبل ربط رقم.'],['Connect with Meta','Se connecter avec Meta','الربط عبر ميتا'],['Connect with QR','Se connecter par QR','الربط عبر رمز QR'],['Your administrator must complete Meta setup.','Votre administrateur doit terminer la configuration Meta.','يجب أن يكمل المشرف إعداد ميتا.'],['Existing WhatsApp verification PIN (if required)','Code PIN WhatsApp existant (si nécessaire)','رمز PIN الحالي لواتساب (عند الحاجة)'],['Continue to WhatsApp','Continuer vers WhatsApp','المتابعة إلى واتساب'],['Reconnect','Reconnecter','إعادة الاتصال'],['Loading secure WhatsApp sign-in…','Chargement de la connexion WhatsApp sécurisée…','جارٍ تحميل تسجيل الدخول الآمن إلى واتساب…'],['Connecting your number…','Connexion de votre numéro…','جارٍ ربط رقمك…'],['WhatsApp connected. Your administrator can activate the chatbot.','WhatsApp connecté. Votre administrateur peut activer le chatbot.','تم ربط واتساب. يمكن للمشرف تفعيل روبوت المحادثة.'],['WhatsApp connected.','WhatsApp connecté.','تم ربط واتساب.'],['Ready. Continue to sign in with your Meta business account.','Prêt. Connectez-vous avec votre compte professionnel Meta.','جاهز. تابع تسجيل الدخول بحساب ميتا للأعمال.'],['Waiting for a fresh QR code…','En attente d’un nouveau code QR…','بانتظار رمز QR جديد…'],['Open WhatsApp → Linked devices → Link a device.','Ouvrez WhatsApp → Appareils connectés → Connecter un appareil.','افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز.'],['Scan to link WhatsApp','Scanner pour connecter WhatsApp','امسح الرمز لربط واتساب'],
    ['Your business, connected','Votre entreprise, connectée','نشاطك، متصل'],['Every conversation.','Chaque conversation.','كل محادثة.'],['A little more human.','Un peu plus humaine.','بلمسة إنسانية أكثر.'],['Give your customers helpful answers on WhatsApp, powered by what makes your business yours.','Offrez à vos clients des réponses utiles sur WhatsApp, fondées sur votre activité.','قدّم لعملائك إجابات مفيدة على واتساب مستندة إلى معرفة نشاطك.'],['Add your business information','Ajoutez vos informations professionnelles','أضف معلومات نشاطك'],['Connect your WhatsApp','Connectez votre WhatsApp','اربط واتساب الخاص بك'],['Let your chatbot take it from there','Laissez le chatbot prendre le relais','دع روبوت المحادثة يتولى الباقي'],['Your business knowledge. One simple workspace.','La connaissance de votre entreprise. Un espace simple.','معرفة نشاطك في مساحة عمل واحدة بسيطة.'],['Relayqo workspace','Espace Relayqo','مساحة Relayqo'],['Create your account','Créer votre compte','أنشئ حسابك'],['Welcome back','Bon retour','مرحبًا بعودتك'],['Forgot your password?','Mot de passe oublié ?','هل نسيت كلمة المرور؟'],['Your name','Votre nom','اسمك'],['Email address','Adresse e-mail','البريد الإلكتروني'],['Password','Mot de passe','كلمة المرور'],['New password','Nouveau mot de passe','كلمة مرور جديدة'],['Everything your chatbot needs, in one place.','Tout ce dont votre chatbot a besoin, au même endroit.','كل ما يحتاجه روبوت المحادثة في مكان واحد.'],['Sign in to manage your workspace.','Connectez-vous pour gérer votre espace.','سجّل الدخول لإدارة مساحة عملك.'],['Use your email address or the secure link we sent you.','Utilisez votre e-mail ou le lien sécurisé que nous vous avons envoyé.','استخدم بريدك الإلكتروني أو الرابط الآمن الذي أرسلناه إليك.'],['Create account','Créer un compte','إنشاء حساب'],['Log in','Se connecter','تسجيل الدخول'],['Forgot password?','Mot de passe oublié ?','هل نسيت كلمة المرور؟'],['New here?','Nouveau ici ?','جديد هنا؟'],['Already have an account?','Vous avez déjà un compte ?','لديك حساب بالفعل؟'],['Choose later','Choisir plus tard','الاختيار لاحقًا'],['Send reset link','Envoyer le lien','إرسال رابط إعادة التعيين'],['Update password','Modifier le mot de passe','تحديث كلمة المرور'],['Confirm','Confirmer','تأكيد'],['Back to login','Retour à la connexion','العودة إلى تسجيل الدخول'],['Use 12–256 characters.','Utilisez 12 à 256 caractères.','استخدم من 12 إلى 256 حرفًا.'],['Local testing · Email confirmation is off.','Test local · La confirmation par e-mail est désactivée.','اختبار محلي · تأكيد البريد الإلكتروني معطّل.'],['Opening your workspace…','Ouverture de votre espace…','جارٍ فتح مساحة عملك…'],['Enable JavaScript to use your Relayqo workspace.','Activez JavaScript pour utiliser votre espace Relayqo.','فعّل JavaScript لاستخدام مساحة Relayqo.'],
    ['Light mode','Mode clair','الوضع الفاتح'],['Dark mode','Mode sombre','الوضع الداكن'],['Switch to light mode','Passer au mode clair','التبديل إلى الوضع الفاتح'],['Switch to dark mode','Passer au mode sombre','التبديل إلى الوضع الداكن'],['Profile','Profil','الملف'],['Policies','Politiques','السياسات'],['Documents','Documents','المستندات'],['Chatbot & limits','Chatbot et limites','الروبوت والحدود'],['Workflows & intents','Parcours et intentions','مسارات العمل والنوايا'],['Statistics','Statistiques','الإحصاءات'],['History','Historique','السجل'],['Language','Langue','اللغة'],['Relayqo · Your business, connected','Relayqo · Votre entreprise, connectée','Relayqo · نشاطك، متصل'],['DRAFT','BROUILLON','مسودة'],['SUBMITTED','SOUMIS','مُرسل'],['NEEDS CHANGES','MODIFICATIONS REQUISES','يتطلب تعديلات'],['APPROVED','APPROUVÉ','موافق عليه'],['ACTIVE','ACTIF','نشط'],['SUSPENDED','SUSPENDU','معلّق'],['READY','PRÊT','جاهز'],['FAILED','ÉCHEC','فشل'],['PROCESSING','EN COURS','قيد المعالجة'],['CONNECTED','CONNECTÉ','متصل'],['remaining','restants','متبقية'],['ready','prêts','جاهزة']
  ].map(([en, fr, ar]) => [en, { fr, ar }]));
  for (const [en, fr, ar] of [
    ['Platform dashboard','Tableau de bord','لوحة تحكم المنصة'],['Dashboard','Tableau de bord','لوحة التحكم'],['Your client activity, chatbot traffic and operating costs in one place.','Activité des clients, trafic du chatbot et coûts en un seul endroit.','نشاط العملاء ورسائل الروبوت والتكاليف في مكان واحد.'],['Manage clients','Gérer les clients','إدارة العملاء'],['Client accounts','Comptes clients','حسابات العملاء'],['All businesses','Toutes les entreprises','جميع الأنشطة'],['Active chatbots','Chatbots actifs','الروبوتات النشطة'],['Enabled accounts','Comptes activés','الحسابات المفعّلة'],['Awaiting review','En attente de validation','بانتظار المراجعة'],['Submitted setups','Configurations soumises','الإعدادات المرسلة'],['Connected numbers','Numéros connectés','الأرقام المتصلة'],['Enabled WhatsApp numbers','Numéros WhatsApp activés','أرقام واتساب المفعّلة'],['Messages this month','Messages ce mois-ci','رسائل هذا الشهر'],['AI calls this month','Appels IA ce mois-ci','استدعاءات الذكاء الاصطناعي هذا الشهر'],['Estimated AI spend','Coût IA estimé','تكلفة الذكاء الاصطناعي المقدّرة'],['This month · USD','Ce mois-ci · USD','هذا الشهر · دولار'],['Incoming and chatbot messages · last 14 days','Messages entrants et réponses du chatbot · 14 derniers jours','الرسائل الواردة وردود الروبوت · آخر 14 يومًا'],['No customer messages in the last 14 days.','Aucun message client ces 14 derniers jours.','لا توجد رسائل عملاء خلال آخر 14 يومًا.'],['Needs attention','À traiter','تحتاج إلى متابعة'],['Setups awaiting review','Configurations en attente','إعدادات بانتظار المراجعة'],['Accounts needing changes','Comptes à modifier','حسابات تحتاج إلى تعديل'],['Handoff requests · 30 days','Demandes de transfert · 30 jours','طلبات التحويل · آخر 30 يومًا'],['Failed WhatsApp deliveries · 30 days','Envois WhatsApp échoués · 30 jours','رسائل واتساب التي فشل إرسالها · آخر 30 يومًا'],['Open client accounts ›','Ouvrir les comptes clients ›','فتح حسابات العملاء ›'],['Recent client accounts','Comptes clients récents','حسابات العملاء الأخيرة'],['Latest account changes','Dernières modifications des comptes','آخر تغييرات الحسابات'],['All clients ›','Tous les clients ›','كل العملاء ›'],['Platform activity','Activité de la plateforme','نشاط المنصة'],['Recent recorded actions','Actions récentes enregistrées','الإجراءات المسجلة مؤخرًا'],['No client accounts yet.','Aucun compte client pour le moment.','لا توجد حسابات عملاء بعد.'],['Activity uses recorded account and message data. AI spend is an estimate; hosting and WhatsApp charges are excluded.','L’activité provient des données enregistrées. Le coût IA est estimé ; l’hébergement et WhatsApp sont exclus.','يعتمد النشاط على البيانات المسجلة. تكلفة الذكاء الاصطناعي تقديرية ولا تشمل الاستضافة أو رسوم واتساب.'],['No plan assigned','Aucune offre attribuée','لم تُعيّن باقة'],['Plan not assigned','Offre non attribuée','لم تُعيّن باقة'],['Your monthly allowance will appear when an administrator assigns a plan.','Votre quota mensuel apparaîtra après l’attribution d’une offre par un administrateur.','ستظهر حصتك الشهرية بعد تعيين باقة من المشرف.']
  ]) translations.set(en, { fr, ar });
  for (const [en, fr, ar] of [
    ['Customer messages','Messages des clients','رسائل العملاء'],
    ['WhatsApp activity','Activité WhatsApp','نشاط واتساب'],
    ['How your connected number is doing','Activité de votre numéro connecté','نشاط رقمك المتصل'],
    ['Chatbot replies','Réponses du chatbot','ردود روبوت المحادثة'],
    ['Connection','Connexion','الاتصال'],
    ['Included:','Inclus :','المتضمن:'],
    ['Unlimited customer messages','Messages clients illimités','رسائل عملاء غير محدودة'],
    ['AI calls and estimated monthly AI spend remain capped internally. Meta charges are separate.','Les appels IA et le coût IA mensuel estimé restent plafonnés en interne. Les frais Meta sont distincts.','تبقى استدعاءات الذكاء الاصطناعي وتكلفته الشهرية التقديرية محدودة داخليًا. رسوم ميتا منفصلة.'],
    ['AI call and estimated monthly spend limits still apply.','Les limites d’appels IA et de coût mensuel estimé restent en vigueur.','تظل حدود استدعاءات الذكاء الاصطناعي والتكلفة الشهرية التقديرية سارية.']
  ]) translations.set(en, { fr, ar });
  for (const [en, fr, ar] of [
    ['Inbox','Boîte de réception','صندوق الوارد'],
    ['AI active','IA active','الذكاء الاصطناعي نشط'],
    ['Needs you','Nécessite votre attention','يحتاج ردك'],
    ["You're handling this",'Vous gérez','أنت تتولى المحادثة'],
    ['Resolved','Résolu','تم الحل'],
    ['Take over','Prendre en charge','تولّ المحادثة'],
    ['Resolve','Résoudre','إنهاء المحادثة'],
    ['Reopen','Rouvrir','إعادة فتح'],
    ['Send','Envoyer','إرسال'],
    ['Open','Ouvertes','المفتوحة'],
    ['Human active','Gérées par un humain','يتولاها بشري'],
    ['Unread','Non lues','غير المقروءة'],
    ['All','Toutes','الكل'],
    ['No conversations found.','Aucune conversation trouvée.','لم يتم العثور على محادثات.'],
    ['Select a conversation to read the transcript.','Sélectionnez une conversation pour voir l’historique.','اختر محادثة لعرض سجل الرسائل.'],
    ['Customer','Client','العميل'],
    ['AI','IA','الذكاء الاصطناعي'],
    ['You','Vous','أنت'],
    ['Sending…','Envoi en cours…','جارٍ الإرسال…'],
    ['Sent','Envoyé','تم الإرسال'],
    ['Failed to send','Échec de l’envoi','فشل الإرسال'],
    ['Retry','Réessayer','إعادة المحاولة'],
    ['Load older messages','Charger les messages plus anciens','تحميل الرسائل السابقة'],
    ["The WhatsApp customer-service window has expired. A free-form reply can't be sent.","La fenêtre de service client WhatsApp a expiré. Une réponse libre ne peut pas être envoyée.","انتهت نافذة خدمة عملاء واتساب (24 ساعة). لا يمكن إرسال رد حر."],
    ["Take over this conversation to reply manually.","Prenez en charge cette conversation pour répondre manuellement.","تولّ هذه المحادثة لتتمكن من الرد يدويًا."],
    ['Back','Retour','رجوع'],
    ['Search conversations…','Rechercher des conversations…','البحث في المحادثات…'],
    ['Type a reply…','Écrire une réponse…','اكتب ردًا…']
  ]) translations.set(en, { fr, ar });
  for (const [en, fr, ar] of [
    ['Business outcomes','Résultats de l’activité','نتائج النشاط'],
    ['Here are the business results your chatbot generated.','Voici les résultats générés par votre chatbot.','إليك النتائج التي حققها روبوت المحادثة.'],
    ['New leads','Nouveaux prospects','عملاء محتملون جدد'],
    ['Qualified leads','Prospects qualifiés','عملاء محتملون مؤهلون'],
    ['Confirmed bookings','Réservations confirmées','حجوزات مؤكدة'],
    ['Confirmed orders','Commandes confirmées','طلبات مؤكدة'],
    ['Missed questions','Questions sans réponse','أسئلة لم تتم الإجابة عليها'],
    ['Resolved handoffs','Transferts résolus','تحويلات مكتملة'],
    ['Total created','Total créés','الإجمالي المُنشأ'],
    ['Via workflows','Via les parcours','عبر مسارات العمل'],
    ['Questions to teach your chatbot','Questions pour entraîner votre chatbot','أسئلة لتعليم روبوت المحادثة'],
    ['Customer questions your chatbot could not answer yet. Review and add them to your business data or FAQs.','Questions clients auxquelles votre chatbot n’a pas pu répondre. Ajoutez-les à vos données ou FAQ.','أسئلة من العملاء لم يتمكن الروبوت من الإجابة عليها. راجعها وأضفها إلى بيانات النشاط أو الأسئلة الشائعة.'],
    ['Mark resolved','Marquer comme résolu','تحديد كمحلول'],
    ['Marked resolved','Résolu','تم الحل'],
    ['No missed questions. Your chatbot is answering smoothly!','Aucune question sans réponse. Votre chatbot répond parfaitement !','لا توجد أسئلة دون إجابة. الروبوت يجيب بسلاسة!'],
    ['Platform outcomes','Résultats de la plateforme','نتائج المنصة'],
    ['Aggregated business results across client accounts.','Résultats agrégés sur l’ensemble des comptes clients.','النتائج المجمعة عبر حسابات العملاء.'],
    ['Platform total','Total plateforme','إجمالي المنصة'],
    ['All clients','Tous les clients','جميع العملاء'],
    ['High missed questions alert','Alerte questions sans réponse élevées','تنبيه: نسبة أسئلة مرتفعة دون إجابة'],
    ['Clients with elevated missed question volume and low resolution rates:','Clients ayant un volume élevé de questions sans réponse et un faible taux de résolution :','عملاء لديهم حجم أسئلة مرتفع دون إجابة ونسبة حل منخفضة:'],
    ['Open client ›','Ouvrir le client ›','فتح حساب العميل ›'],
    ['7 days','7 jours','7 أيام'],
    ['30 days','30 jours','30 يومًا'],
    ['90 days','90 jours','90 يومًا'],
    ['Track business result','Suivre un résultat d’activité','تتبع نتيجة تجارية'],
    ['No business result','Aucun résultat d’activité','بدون نتيجة تجارية'],
    ['Booking confirmed (BOOKING_CONFIRMED)','Réservation confirmée (BOOKING_CONFIRMED)','تأكيد حجز (BOOKING_CONFIRMED)'],
    ['Order confirmed (ORDER_CONFIRMED)','Commande confirmée (ORDER_CONFIRMED)','تأكيد طلب (ORDER_CONFIRMED)'],
    ['Order value field','Champ montant de la commande','حقل قيمة الطلب'],
    ['Order currency field','Champ devise de la commande','حقل عملة الطلب'],
    ['Select collected field','Sélectionner un champ collecté','اختر حقلاً تم جمعه'],
    ['Default business currency','Devise par défaut de l’entreprise','عملة النشاط الافتراضية'],
    ['Terminal outcome override','Remplacement du résultat final','تجاوز نتيجة الخطوة النهائية'],
    ['Outcome tracking override','Remplacement du suivi des résultats','تجاوز تتبع النتائج'],
    ['Inherit from workflow','Hériter du parcours','وراثة من مسار العمل'],
    ['None (suppress outcome)','Aucun (désactiver le résultat)','بدون (إلغاء النتيجة)']
  ]) translations.set(en, { fr, ar });

  for (const [en, fr, ar] of [
    ['Add photos and details customers can ask your chatbot about.','Ajoutez les photos et les détails que vos clients peuvent demander au chatbot.','أضف الصور والتفاصيل التي يمكن للعملاء سؤال الروبوت عنها.'],
    ['Search products','Rechercher des produits','البحث عن المنتجات'],
    ['Search by name or SKU','Rechercher par nom ou référence','ابحث بالاسم أو الرمز'],
    ['New product','Nouveau produit','منتج جديد'],['Untitled product','Produit sans nom','منتج بدون اسم'],
    ['In stock','En stock','متوفر'],['Out of stock','Rupture de stock','غير متوفر'],
    ['Product photos','Photos du produit','صور المنتج'],['Upload photos','Ajouter des photos','إضافة صور'],
    ['JPEG, PNG or WebP, up to 5 MB each. First photo is the cover.','JPEG, PNG ou WebP, 5 Mo maximum par photo. La première est la couverture.','JPEG أو PNG أو WebP، حتى 5 ميغابايت للصورة. الصورة الأولى هي الغلاف.'],
    ['No photos yet. Add a photo so customers can see this product.','Aucune photo. Ajoutez-en une pour montrer le produit aux clients.','لا توجد صور بعد. أضف صورة ليتمكن العملاء من رؤية المنتج.'],
    ['Variant photo','Photo de la variante','صورة النوع'],['Use product cover','Utiliser la couverture du produit','استخدام صورة غلاف المنتج'],
    ['Set cover','Définir comme couverture','تعيين كغلاف'],['Cover','Couverture','الغلاف'],
    ['Remove variant','Supprimer la variante','حذف النوع'],['Remove product','Supprimer le produit','حذف المنتج'],
    ['Edit','Modifier','تعديل'],['No products yet. Add your first product.','Aucun produit. Ajoutez votre premier produit.','لا توجد منتجات بعد. أضف منتجك الأول.'],
    ['Photo uploaded. Save your changes to keep it on this product.','Photo ajoutée. Enregistrez pour la conserver sur ce produit.','تمت إضافة الصورة. احفظ التغييرات للاحتفاظ بها على هذا المنتج.'],
    ['Not published yet','Pas encore publié','لم يُنشر بعد'],['You have draft changes awaiting review.','Vos modifications attendent une validation.','تغييراتك تنتظر المراجعة.'],['Changes appear in the chatbot after publication.','Les changements apparaissent dans le chatbot après publication.','تظهر التغييرات في الروبوت بعد النشر.']
  ]) translations.set(en, { fr, ar });

  for (const [en, fr, ar] of [
    ['Leads','Prospects','العملاء المحتملون'],['Lead details','Détails du prospect','تفاصيل العميل المحتمل'],
    ['Sales opportunities found in customer conversations.','Opportunités commerciales issues des conversations clients.','فرص البيع المكتشفة من محادثات العملاء.'],
    ['Follow up with this customer and record the result.','Recontactez ce client et enregistrez le résultat.','تابع مع هذا العميل وسجل النتيجة.'],
    ['All leads','Tous les prospects','جميع العملاء المحتملين'],['New','Nouveau','جديد'],['Contacted','Contacté','تم التواصل'],['Qualified','Qualifié','مؤهل'],['Won','Gagné','مكتمل'],['Lost','Perdu','مفقود'],
    ['Follow-ups due','Relances à effectuer','متابعات مستحقة'],['Lead queue','Liste des prospects','قائمة العملاء المحتملين'],
    ['New and qualified leads appear first.','Les nouveaux prospects et les prospects qualifiés apparaissent en premier.','يظهر العملاء الجدد والمؤهلون أولاً.'],
    ['No leads in this stage yet. New sales inquiries will appear here.','Aucun prospect à cette étape. Les nouvelles demandes apparaîtront ici.','لا يوجد عملاء محتملون في هذه المرحلة بعد. ستظهر طلبات البيع الجديدة هنا.'],
    ['Customer','Client','العميل'],['Interest','Intérêt','الاهتمام'],['Detected from','Détecté par','مصدر الاكتشاف'],['First seen','Premier contact','أول ظهور'],
    ['Open conversation ›','Ouvrir la conversation ›','فتح المحادثة ›'],['Next action','Prochaine action','الإجراء التالي'],
    ['Update the stage after you speak with the customer. Mark Won only when the sale is confirmed.','Mettez à jour l’étape après avoir parlé au client. Marquez Gagné uniquement après confirmation de la vente.','حدّث المرحلة بعد التحدث مع العميل. اختر مكتمل فقط بعد تأكيد البيع.'],
    ['Stage','Étape','المرحلة'],['Follow up at','Date de relance','موعد المتابعة'],['Internal note','Note interne','ملاحظة داخلية'],['Save lead','Enregistrer le prospect','حفظ العميل المحتمل'],
    ['Sales follow-up','Suivi commercial','متابعة المبيعات'],['Leads to work','Prospects à suivre','عملاء يحتاجون متابعة'],['Open leads ›','Ouvrir les prospects ›','فتح العملاء المحتملين ›'],
    ['Previous','Précédent','السابق'],['Next','Suivant','التالي'],['Not recorded','Non renseigné','غير مسجل'],['Sales inquiry','Demande commerciale','استفسار مبيعات'],['Conversation unavailable.','Conversation indisponible.','المحادثة غير متاحة.'],
    ['Sales conversation','Conversation commerciale','محادثة مبيعات'],['Completed sales request','Demande commerciale terminée','طلب بيع مكتمل'],['Sales request','Demande commerciale','طلب بيع'],['Purchase request','Demande d’achat','طلب شراء'],['Booking or quote request','Demande de réservation ou devis','طلب حجز أو عرض سعر'],['Lead updated.','Prospect mis à jour.','تم تحديث العميل المحتمل.']
  ]) translations.set(en, { fr, ar });

  const supported = new Set(['en', 'fr', 'ar']);
  const stored = (() => { try { return localStorage.getItem('relayqo-language'); } catch { return null; } })();
  let locale = supported.has(stored) ? stored : 'en';
  const originals = new WeakMap();
  const attributeOriginals = new WeakMap();
  const title = 'Relayqo · Your business, connected';

  function translate(source) {
    if (locale === 'en') return source;
    const left = source.match(/^\s*/)?.[0] || '';
    const right = source.match(/\s*$/)?.[0] || '';
    const key = source.trim();
    const found = translations.get(key)?.[locale];
    if (found) return left + found + right;
    const greeting = key.match(/^(Welcome back|Let’s get you live), (.+)$/);
    if (greeting) return left + (locale === 'fr' ? `${greeting[1] === 'Welcome back' ? 'Bon retour' : 'Préparons votre lancement'}, ${greeting[2]}` : `${greeting[1] === 'Welcome back' ? 'مرحبًا بعودتك' : 'لنبدأ إعدادك'}، ${greeting[2]}`) + right;
    const count = key.match(/^([\d\s,.\u00a0]+) (messages|products|documents|WhatsApp numbers?|used|total|remaining)$/);
    if (count) return left + count[1] + ' ' + (translations.get(count[2])?.[locale] || count[2]) + right;
    const stock = key.match(/^(.+ · )(In stock|Out of stock)$/);
    if (stock) return left + stock[1] + translations.get(stock[2])[locale] + right;
    const photo = key.match(/^Photo (\d+)( \(cover\))?$/);
    if (photo) return left + (locale === 'fr' ? `Photo ${photo[1]}${photo[2]?' (couverture)':''}` : `الصورة ${photo[1]}${photo[2]?' (الغلاف)':''}`) + right;
    const ready = key.match(/^(\d+\/\d+) ready$/);
    if (ready) return left + ready[1] + ' ' + translations.get('ready')[locale] + right;
    const leadCount = key.match(/^(\d+) leads$/);
    if (leadCount) return left + (locale === 'fr' ? `${leadCount[1]} prospects` : `${leadCount[1]} عملاء محتملون`) + right;
    const leadUpdated = key.match(/^Last updated (.+)$/);
    if (leadUpdated) return left + (locale === 'fr' ? `Dernière mise à jour ${leadUpdated[1]}` : `آخر تحديث ${leadUpdated[1]}`) + right;
    const leadLatest = key.match(/^Latest: (.+)$/);
    if (leadLatest) return left + (locale === 'fr' ? `Dernier message : ${leadLatest[1]}` : `آخر رسالة: ${leadLatest[1]}`) + right;
    const leadFollowUp = key.match(/^Follow up (.+)$/);
    if (leadFollowUp) return left + (locale === 'fr' ? `Relance ${leadFollowUp[1]}` : `متابعة ${leadFollowUp[1]}`) + right;
    const version = key.match(/^Version (\d+)$/);
    if (version) return left + (locale === 'fr' ? `Version ${version[1]}` : `الإصدار ${version[1]}`) + right;
    const published = key.match(/^Published version (\d+)$/);
    if (published) return left + (locale === 'fr' ? `Version publiée ${published[1]}` : `الإصدار المنشور ${published[1]}`) + right;
    const steps = key.match(/^(\d+) of (\d+) steps complete$/);
    if (steps) return left + (locale === 'fr' ? `${steps[1]} étapes sur ${steps[2]} terminées` : `اكتملت ${steps[1]} من ${steps[2]} خطوات`) + right;
    return source;
  }

  function textNode(node) {
    if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.parentElement?.tagName) || node.parentElement?.isContentEditable) return;
    // These option strings are API status codes. Translating them also changes
    // the submitted value when an option has no explicit value attribute.
    if (node.parentElement?.closest('#astatus')) return;
    const raw = node.nodeValue || '';
    const previous = originals.get(node);
    const source = previous && raw === previous.rendered ? previous.source : raw;
    const rendered = translate(source);
    originals.set(node, { source, rendered });
    if (raw !== rendered) node.nodeValue = rendered;
  }

  function attributes(element) {
    if (!(element instanceof HTMLElement)) return;
    let saved = attributeOriginals.get(element);
    if (!saved) { saved = new Map(); attributeOriginals.set(element, saved); }
    for (const name of ['placeholder', 'aria-label', 'title', 'alt']) {
      if (!element.hasAttribute(name)) continue;
      const raw = element.getAttribute(name);
      const previous = saved.get(name);
      const source = previous && raw === previous.rendered ? previous.source : raw;
      const rendered = translate(source);
      saved.set(name, { source, rendered });
      if (raw !== rendered) element.setAttribute(name, rendered);
    }
  }

  function apply() {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    const translatedTitle = translate(title);
    if (document.title !== translatedTitle) document.title = translatedTitle;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNode(walker.currentNode);
    document.body.querySelectorAll('*').forEach(attributes);
    document.querySelectorAll('.language-select').forEach(select => { if (select.value !== locale) select.value = locale; });
  }

  function setLocale(next) {
    if (!supported.has(next)) return;
    locale = next;
    try { localStorage.setItem('relayqo-language', next); } catch {}
    apply();
  }

  function decorate() {
    for (const [host, suffix] of [[document.querySelector('.top-actions'), 'workspace'], [document.querySelector('.auth-pane'), 'auth']]) {
      if (!host || host.querySelector('.language-select')) continue;
      const label = document.createElement('label');
      label.className = `language-control language-control-${suffix}`;
      label.innerHTML = `<span class="sr-only">Language</span><select class="language-select" aria-label="Language"><option value="en">English</option><option value="fr">Français</option><option value="ar">العربية</option></select>`;
      host.insertAdjacentElement('afterbegin', label);
      label.querySelector('select').value = locale;
      label.querySelector('select').addEventListener('change', event => setLocale(event.target.value));
    }
    apply();
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (locale === 'en') return;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; apply(); });
  }).observe(document, { childList: true, characterData: true, subtree: true });
  document.addEventListener('DOMContentLoaded', decorate);
  window.RelayqoI18n = { decorate, setLocale, getLocale: () => locale };
})();
