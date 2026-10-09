(() => {
  const translations = new Map([
    ['Keep your catalog in one place. Open a product to edit its details, photos and options.','Gérez votre catalogue au même endroit. Ouvrez un produit pour modifier ses détails, photos et options.','أدر كتالوجك في مكان واحد. افتح المنتج لتعديل تفاصيله وصوره وخياراته.'],
    ['No products yet. Add your first product to start your catalog.','Aucun produit pour le moment. Ajoutez votre premier produit.','لا توجد منتجات بعد. أضف أول منتج لبدء الكتالوج.'],
    ['PRODUCT DETAILS','DÉTAILS DU PRODUIT','تفاصيل المنتج'],['Back to products','Retour aux produits','العودة إلى المنتجات'],['Remove product','Supprimer le produit','حذف المنتج'],
    ['Basic information','Informations principales','المعلومات الأساسية'],['What customers see and what you charge.','Ce que voient les clients et le prix demandé.','ما يراه العملاء والسعر الذي تحدده.'],
    ['Photos','Photos','الصور'],['The first photo is shown as the main product image.','La première photo est l’image principale du produit.','تظهر الصورة الأولى بوصفها الصورة الرئيسية للمنتج.'],
    ['Only add options if this product comes in different sizes or colors.','Ajoutez des options seulement si le produit existe en plusieurs tailles ou couleurs.','أضف الخيارات فقط إذا كان المنتج متاحًا بمقاسات أو ألوان مختلفة.'],
    ['No options added. This product has one price and stock count.','Aucune option. Ce produit a un seul prix et stock.','لا توجد خيارات. لهذا المنتج سعر واحد وكمية مخزون واحدة.'],
    ['Add size or color','Ajouter une taille ou une couleur','إضافة مقاس أو لون'],['No SKU','Sans référence','بدون رمز منتج'],['in stock','en stock','في المخزون'],['Edit ›','Modifier ›','تعديل ›'],
    ['Main photo','Photo principale','الصورة الرئيسية'],['Remove photo','Supprimer la photo','حذف الصورة'],['Add photos','Ajouter des photos','إضافة صور'],
    ['Up to 10 JPEG, PNG or WebP photos, 5 MB each.','Jusqu’à 10 photos JPEG, PNG ou WebP de 5 Mo chacune.','حتى 10 صور JPEG أو PNG أو WebP، بحجم 5 ميغابايت للصورة.'],
    ['Photo for this option','Photo de cette option','صورة هذا الخيار'],['Use main product photo','Utiliser la photo principale','استخدام الصورة الرئيسية للمنتج'],
    ['Stock (when no options)','Stock (sans options)','المخزون (عند عدم وجود خيارات)'],
    ["Follow-ups", "Suivis clients", "متابعة العملاء"],
    ["Open follow-ups", "Ouvrir les suivis", "فتح متابعة العملاء"],
    ["Later", "Plus tard", "لاحقًا"],
    ["Done", "Terminé", "تم"],
    ["Reply", "Répondre", "الرد"],
    ["Remind me later", "Me rappeler plus tard", "ذكّرني لاحقًا"],
    ["Remind me on", "Me rappeler le", "ذكّرني في"],
    ["Save changes", "Enregistrer les modifications", "حفظ التغييرات"],
    ["Reminder & details", "Rappel et détails", "التذكير والتفاصيل"],
    ["View details", "Voir les détails", "عرض التفاصيل"],
    ["Report a problem", "Signaler un problème", "الإبلاغ عن مشكلة"],
    ["Reported · Under review", "Signalé · En cours de vérification", "تم الإبلاغ · قيد المراجعة"],
    ["Problem resolved", "Problème résolu", "تم حل المشكلة"],
    ["Problem reported to your administrator.", "Problème signalé à votre administrateur.", "تم إرسال المشكلة إلى المسؤول."],
    ["A reminder brings this customer back to Needs reply. It does not send them a message.", "Un rappel remet ce client dans À répondre. Aucun message ne lui est envoyé.", "يعيد التذكير هذا العميل إلى قائمة يحتاج ردك. ولا يرسل إليه أي رسالة."],
    ["Done. Reopen if this customer needs more help.", "Terminé. Rouvrez si ce client a encore besoin d’aide.", "تمت المتابعة. أعد فتحها إذا احتاج العميل إلى مساعدة أخرى."],
    ["Customers asking about your services. Reply, set a reminder, or mark done.", "Les clients intéressés par vos services. Répondez, fixez un rappel ou terminez le suivi.", "عملاء يسألون عن خدماتك. رد عليهم أو حدد تذكيرًا أو أنهِ المتابعة."],
    ["Customers asking about products. Reply, set a reminder, or mark done.", "Les clients intéressés par vos produits. Répondez, fixez un rappel ou terminez le suivi.", "عملاء يسألون عن المنتجات. رد عليهم أو حدد تذكيرًا أو أنهِ المتابعة."],
    ["Sales stage", "Étape commerciale", "مرحلة البيع"],
    ["Sales details are optional. A request is not a confirmed order.", "Les détails de vente sont facultatifs. Une demande n’est pas une commande confirmée.", "تفاصيل البيع اختيارية. الطلب هنا لا يعني تأكيد الشراء."],
    ["Details are optional. A request is not a confirmed booking.", "Les détails sont facultatifs. Une demande n’est pas une réservation confirmée.", "التفاصيل اختيارية. طلب العميل لا يعني تأكيد الحجز."],
    ["Customers you have finished helping.", "Les clients dont le suivi est terminé.", "العملاء الذين أنهيت مساعدتهم."],
    ["No completed follow-ups yet.", "Aucun suivi terminé pour le moment.", "لم تُنهَ أي متابعة بعد."],
    ["Customer asked about a product", "Le client a posé une question sur un produit", "سأل العميل عن منتج"],
    ["Customer asked about a service", "Le client a posé une question sur un service", "سأل العميل عن خدمة"],

    ['Loading…','Chargement…','جارٍ التحميل…'],
    ['Experimental','Expérimental','تجريبي'],
    ['Your administrator is preparing a connection to your own Meta app and WhatsApp Business Account.','Votre administrateur prépare la connexion à votre application Meta et à votre compte WhatsApp Business.','يجهّز المسؤول الاتصال بتطبيق Meta وحساب واتساب للأعمال الخاصين بك.'],
    ['Official API','API officielle','واجهة واتساب الرسمية'],
    ['QR · Experimental','QR · Expérimental','رمز QR · تجريبي'],
    ['Additional number via QR','Numéro supplémentaire par QR','رقم إضافي عبر رمز QR'],
    ['Each additional WhatsApp account needs its own QR scan. The administrator activates chatbot replies separately for each number.','Chaque compte WhatsApp supplémentaire nécessite son propre QR. L’administrateur active les réponses du chatbot séparément pour chaque numéro.','كل حساب واتساب إضافي يحتاج إلى مسح رمز QR خاص به. يفعّل المسؤول ردود المساعد لكل رقم على حدة.'],
    ['Number allowance reached','Quota de numéros atteint','بلغت الحد الأقصى للأرقام'],
    ["To add another WhatsApp number, ask your administrator to increase this account's number allowance.",'Pour ajouter un autre numéro WhatsApp, demandez à l’administrateur d’augmenter le quota de ce compte.','لإضافة رقم واتساب آخر، اطلب من المسؤول رفع حصة الأرقام لهذا الحساب.'],
    ['Replies on','Réponses activées','الردود مفعّلة'],
    ['Replies paused','Réponses en pause','الردود متوقفة'],
    ['Activate replies','Activer les réponses','تفعيل الردود'],
    ['Pause replies','Mettre les réponses en pause','إيقاف الردود'],
    ['QR WhatsApp numbers','Numéros WhatsApp par QR','أرقام واتساب عبر QR'],
    ['Edit WhatsApp number allowance','Modifier le quota des numéros WhatsApp','تعديل حصة أرقام واتساب'],
    ['Add number with QR (experimental)','Ajouter un numéro par QR (expérimental)','إضافة رقم عبر رمز QR (تجريبي)'],
    ['Disconnect QR','Déconnecter le QR','فصل اتصال QR'],
    ['QR connection disconnected.','Connexion QR déconnectée.','تم فصل اتصال QR.'],
    ['I understand and accept the QR connection limitations.','Je comprends et accepte les limites de la connexion QR.','أفهم وأوافق على قيود الاتصال عبر رمز QR.'],
    ['The official WhatsApp API is the recommended connection. QR uses an unofficial linked-device connection that can disconnect or lead to number restrictions. Relayqo cannot guarantee availability or prevent restrictions.','La connexion recommandée est l’API officielle WhatsApp. Le QR utilise une connexion non officielle d’appareil associé qui peut se déconnecter ou entraîner des restrictions du numéro. Relayqo ne garantit pas sa disponibilité ni l’absence de restrictions.','نوصي بواجهة واتساب الرسمية. يستخدم رمز QR اتصال جهاز مرتبط غير رسمي قد ينقطع أو يؤدي إلى تقييد الرقم. لا تضمن Relayqo استمرار الاتصال أو منع القيود.'],
    ['QR supports text replies to customers who messaged you recently. It is not for campaigns or unsolicited messages.','Le QR permet des réponses textuelles aux clients qui vous ont écrit récemment. Il ne sert pas aux campagnes ni aux messages non sollicités.','يدعم اتصال QR الردود النصية على العملاء الذين راسلوك مؤخراً. لا يستخدم للحملات أو الرسائل غير المطلوبة.'],
    ['Optional QR connection','Connexion QR facultative','اتصال QR اختياري'],
    ['The official API remains the default. Allow QR only for a pilot account whose plan includes it.','L’API officielle reste le choix par défaut. Autorisez le QR uniquement pour un compte pilote dont le forfait le prévoit.','تبقى الواجهة الرسمية الخيار الافتراضي. فعّل QR فقط لحساب تجريبي تتضمن باقته هذه الميزة.'],
    ['Disable QR','Désactiver le QR','تعطيل QR'],
    ['Allow QR','Autoriser le QR','السماح باتصال QR'],
    ['QR included in this plan.','Le QR est inclus dans ce forfait.','تتضمن هذه الباقة اتصال QR.'],
    ['Assign a QR pilot plan to enable this option.','Attribuez un forfait pilote QR pour activer cette option.','عيّن باقة QR تجريبية لتفعيل هذا الخيار.'],
    ['Client accepted the QR limitations.','Le client a accepté les limites du QR.','وافق العميل على قيود اتصال QR.'],
    ['The client must accept the QR limitations before scanning.','Le client doit accepter les limites du QR avant de scanner.','يجب أن يوافق العميل على قيود QR قبل المسح.'],
    ['Service Assistant · QR Pilot','Assistant de services · Pilote QR','مساعد الخدمات · QR تجريبي'],
    ['Sales Assistant · QR Pilot','Assistant de vente · Pilote QR','مساعد المبيعات · QR تجريبي'],
    ['Official API by default. Additional QR numbers require admin-approved number allowance and client acceptance. Experimental text replies only.','API officielle par défaut. Plusieurs numéros QR nécessitent un quota approuvé par l’administrateur et l’accord du client. Réponses textuelles expérimentales uniquement.','الواجهة الرسمية افتراضياً. إضافة أرقام QR تتطلب حصة يوافق عليها المسؤول وموافقة العميل. الردود النصية تجريبية فقط.'],
    ['Official API by default. Additional QR numbers require admin-approved number allowance and client acceptance. No campaigns.','API officielle par défaut. Plusieurs numéros QR nécessitent un quota approuvé par l’administrateur et l’accord du client. Aucune campagne.','الواجهة الرسمية افتراضياً. إضافة أرقام QR تتطلب حصة يوافق عليها المسؤول وموافقة العميل. لا حملات.'],
    ['Product photos','Photos du produit','صور المنتج'],
    ['Sales follow-up','Suivi des ventes','متابعة المبيعات'],
    ['Leads to work','Prospects à contacter','عملاء محتملون للمتابعة'],
    ['Open leads','Voir les prospects','عرض العملاء المحتملين'],
    ['Open requests','Voir les demandes','عرض الطلبات'],
    ['Manage WhatsApp ›','Gérer WhatsApp ›','إدارة واتساب ›'],
    ['Variant photo','Photo de la variante','صورة الخيار'],
    ['Use product photo','Utiliser la photo du produit','استخدام صورة المنتج'],
    ['Remove from product','Retirer du produit','إزالة من المنتج'],
    ['Up to 10 photos per product. First photo is the main photo. JPEG, PNG or WebP, up to 5 MB each.','Jusqu’à 10 photos par produit. La première est la photo principale. JPEG, PNG ou WebP, 5 Mo maximum par photo.','حتى 10 صور لكل منتج. الصورة الأولى هي الرئيسية. بصيغة JPEG أو PNG أو WebP، حتى 5 ميغابايت لكل صورة.'],
    ['Your workspace','Votre espace','مساحة عملك'],['Workspace','Espace de travail','مساحة العمل'],['Platform','Plateforme','المنصة'],['Overview','Vue d’ensemble','نظرة عامة'],['Business data','Données de l’entreprise','بيانات النشاط'],['Plans','Offres','الباقات'],['Clients','Clients','العملاء'],['Users','Utilisateurs','المستخدمون'],['Usage & costs','Utilisation et coûts','الاستخدام والتكاليف'],['Secure workspace','Espace sécurisé','مساحة عمل آمنة'],['Business owner','Propriétaire','صاحب النشاط'],['Administrator','Administrateur','المشرف'],['Need help?','Besoin d’aide ?','تحتاج إلى مساعدة؟'],['Our team can help you prepare your chatbot.','Notre équipe peut vous aider à préparer votre chatbot.','يمكن لفريقنا مساعدتك في إعداد روبوت المحادثة.'],['Log out','Se déconnecter','تسجيل الخروج'],
    ['Chatbot status','Statut du chatbot','حالة روبوت المحادثة'],['Active','Actif','نشط'],['Paused','En pause','متوقف مؤقتًا'],['Action needed','Action requise','يلزم اتخاذ إجراء'],['In setup','En préparation','قيد الإعداد'],['Your chatbot is enabled for your connected WhatsApp number.','Votre chatbot est activé pour votre numéro WhatsApp connecté.','روبوت المحادثة مفعّل لرقم واتساب المتصل.'],['Your setup is safely saved while you finish the remaining steps.','Votre configuration est enregistrée pendant que vous terminez les étapes restantes.','تم حفظ إعدادك أثناء إكمال الخطوات المتبقية.'],['Plan','Offre','الباقة'],['Not assigned','Non attribuée','غير معيّنة'],['Connected','Connecté','متصل'],['Not connected','Non connecté','غير متصل'],['Published data','Données publiées','البيانات المنشورة'],['Not published','Non publiées','غير منشورة'],['Edit business data','Modifier les données','تعديل بيانات النشاط'],['Manage WhatsApp','Gérer WhatsApp','إدارة واتساب'],['Connect WhatsApp','Connecter WhatsApp','ربط واتساب'],['Here is how your chatbot performed during the last 30 days.','Voici les résultats de votre chatbot sur les 30 derniers jours.','إليك أداء روبوت المحادثة خلال آخر 30 يومًا.'],['Complete your workspace and we will prepare the chatbot for launch.','Complétez votre espace et nous préparerons le chatbot au lancement.','أكمل مساحة عملك وسنجهز روبوت المحادثة للإطلاق.'],
    ['Conversations','Conversations','المحادثات'],['Customer contacts','Contacts clients','جهات اتصال العملاء'],['Unique contacts','Contacts uniques','جهات اتصال فريدة'],['Messages used','Messages utilisés','الرسائل المستخدمة'],['Needs a person','Besoin d’un conseiller','تحتاج إلى موظف'],['Handoff requests','Demandes de transfert','طلبات التحويل'],['Last 30 days','30 derniers jours','آخر 30 يومًا'],['Message activity','Activité des messages','نشاط الرسائل'],['Customer and chatbot messages · last 14 days','Messages des clients et du chatbot · 14 derniers jours','رسائل العملاء والروبوت · آخر 14 يومًا'],['Last 14 days','14 derniers jours','آخر 14 يومًا'],['No customer messages yet. Activity will appear after your first WhatsApp conversation.','Aucun message client pour le moment. L’activité apparaîtra après votre première conversation WhatsApp.','لا توجد رسائل من العملاء بعد. سيظهر النشاط بعد أول محادثة عبر واتساب.'],['Monthly allowance','Quota mensuel','الحصة الشهرية'],['messages left','messages restants','رسالة متبقية'],['used','utilisés','مستخدمة'],['total','au total','الإجمالي'],['View plan details ›','Voir les détails de l’offre ›','عرض تفاصيل الباقة ›'],['Recent conversations','Conversations récentes','المحادثات الأخيرة'],['Latest activity across your connected number','Dernière activité sur votre numéro connecté','آخر نشاط على رقمك المتصل'],['Customer conversations will appear here.','Les conversations clients apparaîtront ici.','ستظهر محادثات العملاء هنا.'],['Needs reply','Réponse nécessaire','تحتاج إلى رد'],['Keep your chatbot accurate','Gardez votre chatbot à jour','حافظ على دقة روبوت المحادثة'],['Update business data','Mettre à jour les données','تحديث بيانات النشاط'],['Products, services, policies and FAQs','Produits, services, politiques et FAQ','المنتجات والخدمات والسياسات والأسئلة الشائعة'],['WhatsApp connection','Connexion WhatsApp','اتصال واتساب'],['Connected and ready','Connecté et prêt','متصل وجاهز'],['Connection needs attention','Connexion à vérifier','الاتصال يحتاج إلى مراجعة'],['Knowledge documents','Documents de référence','مستندات المعرفة'],
    ['Launch checklist','Liste de lancement','قائمة الإطلاق'],['Business profile','Profil de l’entreprise','ملف النشاط'],['Tell the chatbot what your business offers','Expliquez au chatbot ce que propose votre entreprise','عرّف الروبوت بما يقدمه نشاطك'],['Choose a plan','Choisir une offre','اختر باقة'],['Select the capacity your business needs','Choisissez la capacité adaptée à votre activité','اختر السعة المناسبة لنشاطك'],['Link the number your customers use','Associez le numéro utilisé par vos clients','اربط الرقم الذي يستخدمه عملاؤك'],['Submit for review','Soumettre pour validation','إرسال للمراجعة'],['Send your setup to the Relayqo team','Envoyez votre configuration à l’équipe Relayqo','أرسل إعدادك إلى فريق Relayqo'],['Review ›','Vérifier ›','مراجعة ›'],['Start ›','Commencer ›','ابدأ ›'],['What happens next','Prochaine étape','الخطوة التالية'],['Administrator feedback','Retour de l’administrateur','ملاحظات المشرف'],['Complete the checklist and send your setup for review.','Terminez la liste et envoyez votre configuration pour validation.','أكمل القائمة ثم أرسل إعدادك للمراجعة.'],['Your administrator checks the business information, plan and WhatsApp connection before activation.','Votre administrateur vérifie les données, l’offre et la connexion WhatsApp avant l’activation.','يراجع المشرف بيانات النشاط والباقة واتصال واتساب قبل التفعيل.'],['Continue setup','Continuer la configuration','متابعة الإعداد'],
    ['Business information','Informations sur l’entreprise','معلومات النشاط'],['Saved data is published after administrator review.','Les données enregistrées sont publiées après validation par un administrateur.','تُنشر البيانات المحفوظة بعد مراجعة المشرف.'],['Business name','Nom de l’entreprise','اسم النشاط'],['Contact email','E-mail de contact','البريد الإلكتروني للتواصل'],['Phone','Téléphone','الهاتف'],['Website','Site web','الموقع الإلكتروني'],['What does your business offer?','Que propose votre entreprise ?','ماذا يقدم نشاطك؟'],['Address or service area','Adresse ou zone de service','العنوان أو نطاق الخدمة'],['Opening hours','Horaires d’ouverture','ساعات العمل'],['Currency (3 letters)','Devise (3 lettres)','العملة (3 أحرف)'],['Customer policies','Politiques clients','سياسات العملاء'],['Shipping / delivery','Expédition / livraison','الشحن / التوصيل'],['Returns','Retours','الإرجاع'],['Payment','Paiement','الدفع'],['Privacy / booking','Confidentialité / réservation','الخصوصية / الحجز'],['Products','Produits','المنتجات'],['Services','Services','الخدمات'],['FAQs','Questions fréquentes','الأسئلة الشائعة'],['Add product','Ajouter un produit','إضافة منتج'],['Add service','Ajouter un service','إضافة خدمة'],['Add FAQ','Ajouter une question','إضافة سؤال'],['No entries yet.','Aucune entrée pour le moment.','لا توجد عناصر بعد.'],['SKU','Référence','رمز المنتج'],['Product name','Nom du produit','اسم المنتج'],['Price','Prix','السعر'],['Stock','Stock','المخزون'],['Category','Catégorie','الفئة'],['Description','Description','الوصف'],['Service name','Nom du service','اسم الخدمة'],['Availability','Disponibilité','التوفر'],['Question','Question','السؤال'],['Answer','Réponse','الإجابة'],['Language: en, fr, ar or darija','Langue : en, fr, ar ou darija','اللغة: en أو fr أو ar أو darija'],['Sizes and colors','Tailles et couleurs','المقاسات والألوان'],['Add variant','Ajouter une variante','إضافة خيار'],['Variant SKU','Référence de la variante','رمز الخيار'],['Size','Taille','المقاس'],['Color','Couleur','اللون'],['Price override (blank uses product price)','Prix spécifique (vide = prix du produit)','سعر خاص (اتركه فارغًا لاستخدام سعر المنتج)'],['Remove variant','Supprimer la variante','حذف الخيار'],['Remove item','Supprimer l’élément','حذف العنصر'],['Unsaved changes','Modifications non enregistrées','تغييرات غير محفوظة'],['All changes saved','Toutes les modifications sont enregistrées','تم حفظ جميع التغييرات'],['Save changes','Enregistrer','حفظ التغييرات'],['Send for review','Envoyer pour validation','إرسال للمراجعة'],['Business data saved.','Données enregistrées.','تم حفظ بيانات النشاط.'],['PDFs up to 10 MB. Indexing starts after administrator approval.','PDF jusqu’à 10 Mo. L’indexation commence après validation de l’administrateur.','ملفات PDF حتى 10 ميغابايت. تبدأ الفهرسة بعد موافقة المشرف.'],['Choose a PDF','Choisir un PDF','اختر ملف PDF'],['Upload PDF','Téléverser le PDF','رفع ملف PDF'],['No documents yet.','Aucun document pour le moment.','لا توجد مستندات بعد.'],['Remove','Supprimer','حذف'],
    ['Choose what your business needs. Your administrator confirms the final plan.','Choisissez ce dont votre entreprise a besoin. Votre administrateur confirme l’offre finale.','اختر ما يناسب نشاطك. يؤكد المشرف الباقة النهائية.'],['Current plan','Offre actuelle','الباقة الحالية'],['Available','Disponible','متاحة'],['Assigned','Attribuée','معيّنة'],['Request this plan','Demander cette offre','طلب هذه الباقة'],['Plans will appear here when your administrator publishes them.','Les offres apparaîtront ici après leur publication par votre administrateur.','ستظهر الباقات هنا بعد نشرها من المشرف.'],['Plan request sent to your administrator.','Demande envoyée à votre administrateur.','تم إرسال طلب الباقة إلى المشرف.'],['messages','messages','رسائل'],['products','produits','منتجات'],['documents','documents','مستندات'],['WhatsApp number','numéro WhatsApp','رقم واتساب'],['WhatsApp numbers','numéros WhatsApp','أرقام واتساب'],['/ month','/ mois','/ شهر'],
    ['Link your business number. The administrator controls activation.','Associez votre numéro professionnel. L’activation est gérée par l’administrateur.','اربط رقم نشاطك. يتحكم المشرف في التفعيل.'],['Your connections','Vos connexions','اتصالاتك'],['No number connected yet.','Aucun numéro connecté pour le moment.','لا يوجد رقم متصل بعد.'],['Link a business number','Associer un numéro professionnel','ربط رقم نشاط'],['Your plan must be approved before linking a number.','Votre offre doit être approuvée avant d’associer un numéro.','يجب الموافقة على باقتك قبل ربط رقم.'],['Connect with Meta','Se connecter avec Meta','الربط عبر ميتا'],['Connect with QR','Se connecter par QR','الربط عبر رمز QR'],['Your administrator must complete Meta setup.','Votre administrateur doit terminer la configuration Meta.','يجب أن يكمل المشرف إعداد ميتا.'],['Existing WhatsApp verification PIN (if required)','Code PIN WhatsApp existant (si nécessaire)','رمز PIN الحالي لواتساب (عند الحاجة)'],['Continue to WhatsApp','Continuer vers WhatsApp','المتابعة إلى واتساب'],['Reconnect','Reconnecter','إعادة الاتصال'],['Loading secure WhatsApp sign-in…','Chargement de la connexion WhatsApp sécurisée…','جارٍ تحميل تسجيل الدخول الآمن إلى واتساب…'],['Connecting your number…','Connexion de votre numéro…','جارٍ ربط رقمك…'],['WhatsApp connected. Your administrator can activate the chatbot.','WhatsApp connecté. Votre administrateur peut activer le chatbot.','تم ربط واتساب. يمكن للمشرف تفعيل روبوت المحادثة.'],['WhatsApp connected.','WhatsApp connecté.','تم ربط واتساب.'],['Ready. Continue to sign in with your Meta business account.','Prêt. Connectez-vous avec votre compte professionnel Meta.','جاهز. تابع تسجيل الدخول بحساب ميتا للأعمال.'],['Waiting for a fresh QR code…','En attente d’un nouveau code QR…','بانتظار رمز QR جديد…'],['Open WhatsApp → Linked devices → Link a device.','Ouvrez WhatsApp → Appareils connectés → Connecter un appareil.','افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز.'],['Scan to link WhatsApp','Scanner pour connecter WhatsApp','امسح الرمز لربط واتساب'],
    ['Your business, connected','Votre entreprise, connectée','نشاطك، متصل'],['Every conversation.','Chaque conversation.','كل محادثة.'],['A little more human.','Un peu plus humaine.','بلمسة إنسانية أكثر.'],['Give your customers helpful answers on WhatsApp, powered by what makes your business yours.','Offrez à vos clients des réponses utiles sur WhatsApp, fondées sur votre activité.','قدّم لعملائك إجابات مفيدة على واتساب مستندة إلى معرفة نشاطك.'],['Add your business information','Ajoutez vos informations professionnelles','أضف معلومات نشاطك'],['Connect your WhatsApp','Connectez votre WhatsApp','اربط واتساب الخاص بك'],['Let your chatbot take it from there','Laissez le chatbot prendre le relais','دع روبوت المحادثة يتولى الباقي'],['Your business knowledge. One simple workspace.','La connaissance de votre entreprise. Un espace simple.','معرفة نشاطك في مساحة عمل واحدة بسيطة.'],['Relayqo workspace','Espace Relayqo','مساحة Relayqo'],['Create your workspace','Créer votre espace','أنشئ مساحة عملك'],['Create your account','Créer votre compte','أنشئ حسابك'],['Welcome back','Bon retour','مرحبًا بعودتك'],['Forgot your password?','Mot de passe oublié ?','هل نسيت كلمة المرور؟'],['Your name','Votre nom','اسمك'],['Email address','Adresse e-mail','البريد الإلكتروني'],['Password','Mot de passe','كلمة المرور'],['New password','Nouveau mot de passe','كلمة مرور جديدة'],['Everything your chatbot needs, in one place.','Tout ce dont votre chatbot a besoin, au même endroit.','كل ما يحتاجه روبوت المحادثة في مكان واحد.'],['Sign in to manage your workspace.','Connectez-vous pour gérer votre espace.','سجّل الدخول لإدارة مساحة عملك.'],['Use your email address or the secure link we sent you.','Utilisez votre e-mail ou le lien sécurisé que nous vous avons envoyé.','استخدم بريدك الإلكتروني أو الرابط الآمن الذي أرسلناه إليك.'],['Create account','Créer un compte','إنشاء حساب'],['Log in','Se connecter','تسجيل الدخول'],['Forgot password?','Mot de passe oublié ?','هل نسيت كلمة المرور؟'],['New here?','Nouveau ici ?','جديد هنا؟'],['Already have an account?','Vous avez déjà un compte ?','لديك حساب بالفعل؟'],['Choose later','Choisir plus tard','الاختيار لاحقًا'],['Send reset link','Envoyer le lien','إرسال رابط إعادة التعيين'],['Update password','Modifier le mot de passe','تحديث كلمة المرور'],['Confirm','Confirmer','تأكيد'],['Back to login','Retour à la connexion','العودة إلى تسجيل الدخول'],['Use 12–256 characters.','Utilisez 12 à 256 caractères.','استخدم من 12 إلى 256 حرفًا.'],['Local testing · Email confirmation is off.','Test local · La confirmation par e-mail est désactivée.','اختبار محلي · تأكيد البريد الإلكتروني معطّل.'],['Opening your workspace…','Ouverture de votre espace…','جارٍ فتح مساحة عملك…'],['Enable JavaScript to use your Relayqo workspace.','Activez JavaScript pour utiliser votre espace Relayqo.','فعّل JavaScript لاستخدام مساحة Relayqo.'],
    ['Light mode','Mode clair','الوضع الفاتح'],['Dark mode','Mode sombre','الوضع الداكن'],['Switch to light mode','Passer au mode clair','التبديل إلى الوضع الفاتح'],['Switch to dark mode','Passer au mode sombre','التبديل إلى الوضع الداكن'],['Profile','Profil','الملف'],['Policies','Politiques','السياسات'],['Documents','Documents','المستندات'],['Chatbot & limits','Chatbot et limites','الروبوت والحدود'],['Channels','Canaux','القنوات'],['Workflows & intents','Parcours et intentions','مسارات العمل والنوايا'],['Statistics','Statistiques','الإحصاءات'],['History','Historique','السجل'],['Language','Langue','اللغة'],['Relayqo · Your business, connected','Relayqo · Votre entreprise, connectée','Relayqo · نشاطك، متصل'],['DRAFT','BROUILLON','مسودة'],['SUBMITTED','SOUMIS','مُرسل'],['NEEDS CHANGES','MODIFICATIONS REQUISES','يتطلب تعديلات'],['APPROVED','APPROUVÉ','موافق عليه'],['ACTIVE','ACTIF','نشط'],['SUSPENDED','SUSPENDU','معلّق'],['READY','PRÊT','جاهز'],['FAILED','ÉCHEC','فشل'],['PROCESSING','EN COURS','قيد المعالجة'],['CONNECTED','CONNECTÉ','متصل'],['remaining','restants','متبقية'],['ready','prêts','جاهزة']
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
    ['Create your account first. Your administrator will assign your plan afterward.','Créez d’abord votre compte. Votre administrateur vous attribuera ensuite une offre.','أنشئ حسابك أولاً، ثم سيعيّن لك المشرف الباقة.'],
    ['Find a client by their name, email or business, then manage their plan and chatbot.','Recherchez un client par son nom, son e-mail ou son entreprise, puis gérez son offre et son chatbot.','ابحث عن العميل باسمه أو بريده أو نشاطه، ثم أدر باقته وروبوت المحادثة.'],
    ['All client accounts','Tous les comptes clients','جميع حسابات العملاء'],
    ['Search name, email or business','Rechercher un nom, un e-mail ou une entreprise','ابحث بالاسم أو البريد أو النشاط'],
    ['Search client name, email or business','Rechercher un client par nom, e-mail ou entreprise','ابحث عن العميل بالاسم أو البريد أو النشاط'],
    ['Business','Entreprise','النشاط'],['Client','Client','العميل'],['Assigned plan','Offre attribuée','الباقة المعيّنة'],
    ['Updated','Mise à jour','آخر تحديث'],['Manage ›','Gérer ›','إدارة ›'],['Name unavailable','Nom indisponible','الاسم غير متاح'],
    ['No email','Aucun e-mail','لا يوجد بريد'],['Awaiting assignment','En attente d’attribution','بانتظار التعيين'],
    ['No client accounts found.','Aucun compte client trouvé.','لم يتم العثور على حسابات عملاء.'],
    ['Customer conversations','Conversations clients','محادثات العملاء'],
    ['Review what customers asked and how the chatbot answered. This view is read-only.','Consultez les questions des clients et les réponses du chatbot. Cette vue est en lecture seule.','راجع أسئلة العملاء وإجابات الروبوت. هذه الصفحة للقراءة فقط.'],
    ['Refresh','Actualiser','تحديث'],['Search customer or message','Rechercher un client ou un message','ابحث عن عميل أو رسالة'],
    ['Search conversations','Rechercher des conversations','البحث في المحادثات'],
    ['All conversations','Toutes les conversations','جميع المحادثات'],
    ['No conversations match your search.','Aucune conversation ne correspond à votre recherche.','لا توجد محادثات تطابق بحثك.'],
    ['No messages yet','Aucun message pour le moment','لا توجد رسائل بعد'],
    ['Loading transcript…','Chargement de la conversation…','جارٍ تحميل المحادثة…'],
    ['Could not load this conversation.','Impossible de charger cette conversation.','تعذر تحميل هذه المحادثة.'],
    ['Could not load conversations.','Impossible de charger les conversations.','تعذر تحميل المحادثات.'],
    ['No messages in this conversation yet.','Aucun message dans cette conversation.','لا توجد رسائل في هذه المحادثة بعد.'],
    ['Assigned to','Attribuée à','مُسندة إلى'],['Chatbot','Chatbot','روبوت المحادثة'],['Team','Équipe','الفريق']
  ]) translations.set(en, { fr, ar });

  for (const [en, fr, ar] of [
    ['Requests','Demandes','الطلبات'],['Inquiries','Demandes de renseignements','الاستفسارات'],['Request','Demande','الطلب'],['Customer conversation','Conversation client','محادثة العميل'],
    ['Inquiry details','Détails de la demande','تفاصيل الاستفسار'],['Inquiry queue','Demandes à traiter','قائمة الاستفسارات'],
    ['Customer follow-up','Suivi des clients','متابعة العملاء'],['Inquiries to review','Demandes à examiner','استفسارات للمراجعة'],
    ['Service requests and booking inquiries from customer conversations.','Demandes de services et de réservation issues des conversations clients.','طلبات الخدمات والحجز من محادثات العملاء.'],
    ['Inquiry details','Détails de la demande','تفاصيل الاستفسار'],['Order details','Détails de la commande','تفاصيل الطلب'],
    ['Service or course','Service ou cours','الخدمة أو الدورة'],['Preferred date or time','Date ou heure souhaitée','التاريخ أو الوقت المفضل'],
    ['Delivery city','Ville de livraison','مدينة التوصيل'],['Delivery address','Adresse de livraison','عنوان التوصيل'],
    ['Request ticket','Fiche de demande','بطاقة الطلب'],['Customer request','Demande du client','طلب العميل'],
    ['Follow-ups due','Relances à effectuer','متابعات مستحقة'],['Qualified','Qualifiés','مؤهلون'],['Confirmed','Confirmé','مؤكد'],['Closed','Clôturé','مغلق'],
    ['New requests and upcoming follow-ups appear here.','Les nouvelles demandes et les relances à venir apparaissent ici.','تظهر هنا الطلبات الجديدة والمتابعات القادمة.'],
    ['Track the request and follow up. Mark Confirmed only when the service or booking is agreed.','Suivez la demande. Marquez-la comme confirmée uniquement après accord sur le service ou la réservation.','تابع الطلب ولا تضعه كمؤكد إلا بعد الاتفاق على الخدمة أو الحجز.'],
    ['Use the conversation to confirm the service and preferred time. This is not a confirmed booking.','Vérifiez le service et l’horaire avec le client. Il ne s’agit pas encore d’une réservation confirmée.','تأكد من الخدمة والموعد مع العميل. هذا ليس حجزاً مؤكداً بعد.'],
    ['Follow up with this customer and record the result.','Recontactez ce client et notez le résultat.','تابع مع هذا العميل وسجّل النتيجة.'],['All inquiries','Toutes les demandes','كل الاستفسارات'],['All leads','Tous les prospects','كل العملاء المحتملين'],
    ['Not recorded','Non renseigné','غير مسجل'],['Detected from','Détecté dans','تم رصده من'],['First seen','Première détection','أول رصد'],['Open conversation ›','Ouvrir la conversation ›','فتح المحادثة ›'],['Conversation unavailable.','Conversation indisponible.','المحادثة غير متاحة.'],
    ['Next action','Prochaine action','الإجراء التالي'],['Customer name','Nom du client','اسم العميل'],['Customer','Client','العميل'],['Interest','Intérêt','الاهتمام'],['Product','Produit','المنتج'],['Quantity','Quantité','الكمية'],
    ['Stage','Étape','المرحلة'],['New','Nouveau','جديد'],['Contacted','Contacté','تم التواصل'],['Won','Gagné','مؤكد'],['Lost','Perdu','مغلق'],['All','Tous','الكل'],
    ['Follow up at','Relancer le','موعد المتابعة'],['Internal note','Note interne','ملاحظة داخلية'],['Save inquiry','Enregistrer la demande','حفظ الاستفسار'],['Save lead','Enregistrer le prospect','حفظ العميل المحتمل'],
    ['Sales conversation','Conversation commerciale','محادثة بيع'],['Sales request','Demande commerciale','طلب شراء'],['Purchase request','Demande d’achat','طلب شراء'],['Booking or quote request','Demande de réservation ou de devis','طلب حجز أو عرض سعر'],['Completed sales request','Demande commerciale terminée','طلب بيع مكتمل'],
    ['Sales inquiry','Demande commerciale','استفسار شراء'],['Service inquiry','Demande de service','استفسار عن خدمة'],['Inquiry','Demande','استفسار'],['Lead','Prospect','عميل محتمل'],['Lead details','Détails du prospect','تفاصيل العميل المحتمل'],['Lead queue','Prospects à traiter','قائمة العملاء المحتملين'],
    ['Check order details with the customer before marking the sale complete.','Vérifiez les détails de la commande avec le client avant de confirmer la vente.','تحقق من تفاصيل الطلب مع العميل قبل تأكيد البيع.'],['Update the stage after speaking with the customer. Mark Won only when the order is confirmed.','Mettez à jour l’étape après avoir parlé au client. Marquez la vente comme gagnée uniquement après confirmation de la commande.','حدّث المرحلة بعد التحدث مع العميل. لا تؤكد البيع إلا بعد تأكيد الطلب.'],
    ['Sales opportunities found in customer conversations.','Opportunités de vente détectées dans les conversations clients.','فرص بيع رُصدت في محادثات العملاء.'],['Export CSV','Exporter en CSV','تصدير CSV'],['Previous','Précédent','السابق'],['Next','Suivant','التالي']
  ]) translations.set(en, { fr, ar });

  const supported = new Set(['en', 'fr', 'ar']);
  const stored = (() => { try { return localStorage.getItem('relayqo-language'); } catch { return null; } })();
  const requested = new URLSearchParams(location.search).get('lang');
  let locale = supported.has(requested) ? requested : supported.has(stored) ? stored : 'en';
  if (supported.has(requested)) {
    try { localStorage.setItem('relayqo-language', requested); } catch {}
    try {
      const url = new URL(location.href);
      url.searchParams.delete('lang');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch {}
  }
  for (const [en, fr, ar] of [
    ['Chatbot settings','Paramètres du chatbot','إعدادات روبوت المحادثة'],
    ['Control optional features of your chatbot.','Gérez les fonctionnalités facultatives de votre chatbot.','تحكم في الميزات الاختيارية لروبوت المحادثة.'],
    ['CUSTOMER MESSAGES','MESSAGES CLIENTS','رسائل العملاء'],
    ['Understand customer voice notes sent through WhatsApp.','Comprendre les messages vocaux envoyés par les clients sur WhatsApp.','فهم الرسائل الصوتية التي يرسلها العملاء عبر واتساب.'],
    ['When the audio is unclear, the chatbot asks the customer to write their question.','Si le message vocal est peu clair, le chatbot demande au client de rédiger sa question.','إذا كان الصوت غير واضح، يطلب الروبوت من العميل كتابة سؤاله.'],
    ['HOW IT WORKS','FONCTIONNEMENT','كيف تعمل الميزة'],
    ['Who controls this?','Qui contrôle cette fonction ?','من يتحكم في هذه الميزة؟'],
    ['Your administrator chooses the voice model and makes this feature available to your account. Once allowed, you can turn voice understanding on or off here.','Votre administrateur choisit le modèle vocal et active cette fonction pour votre compte. Vous pouvez ensuite l’activer ou la désactiver ici.','يختار المسؤول نموذج الصوت ويتيح هذه الميزة لحسابك. بعد السماح بها، يمكنك تشغيل فهم الصوت أو إيقافه هنا.'],
    ['Manage WhatsApp connection ›','Gérer la connexion WhatsApp ›','إدارة اتصال واتساب ›'],
    ['Voice notes enabled. New audio messages will be transcribed.','Messages vocaux activés. Les nouveaux messages seront transcrits.','الرسائل الصوتية مفعّلة. سيتم تفريغ الرسائل الجديدة.'],
    ['Instagram DMs require an Instagram-enabled plan.','Les messages privés Instagram nécessitent une offre qui inclut Instagram.','تتطلب رسائل إنستغرام الخاصة باقة تتضمن إنستغرام.'],
    ['Your administrator has not enabled Instagram for this account.','Votre administrateur n’a pas activé Instagram pour ce compte.','لم يفعّل المسؤول إنستغرام لهذا الحساب.'],
    ['Voice notes','Messages vocaux','الرسائل الصوتية'],
    ['Voice notes: up to 5 minutes and 5 MB each.','Messages vocaux : jusqu’à 5 minutes et 5 Mo chacun.','الرسائل الصوتية: حتى 5 دقائق و5 ميغابايت لكل رسالة.'],
    ['Understand customer voice notes','Comprendre les messages vocaux des clients','فهم الرسائل الصوتية للعملاء'],
    ['Allow voice notes','Autoriser les messages vocaux','السماح بالرسائل الصوتية'],
    ['Revoke voice notes','Retirer les messages vocaux','إلغاء السماح بالرسائل الصوتية'],
    ['Your administrator has not enabled voice notes for this account.','Votre administrateur n’a pas activé les messages vocaux pour ce compte.','لم يفعّل المسؤول الرسائل الصوتية لهذا الحساب.'],
    ['Voice notes are not configured yet. Ask your administrator to enable the transcription service.','Les messages vocaux ne sont pas encore configurés. Demandez à votre administrateur d’activer la transcription.','الرسائل الصوتية غير مُعدّة بعد. اطلب من المسؤول تفعيل خدمة التفريغ الصوتي.'],
    ['Off by default. You can change this at any time.','Désactivé par défaut. Vous pouvez modifier ce choix à tout moment.','معطّل افتراضيًا. يمكنك تغيير هذا الخيار في أي وقت.'],
    ['Your administrator has locked chatbot settings.','Votre administrateur a verrouillé les paramètres du chatbot.','أقفل المسؤول إعدادات روبوت المحادثة.'],
    ['Customers can send voice notes. Your administrator selects the transcription model; unclear notes receive a request to type the message.','Les clients peuvent envoyer des messages vocaux. Votre administrateur choisit le modèle de transcription ; si l’audio est peu clair, le client est invité à écrire.','يمكن للعملاء إرسال رسائل صوتية. يختار المسؤول نموذج التفريغ الصوتي، وإذا لم يكن الصوت واضحاً يُطلب من العميل كتابة رسالته.'],
    ['Allow this client to turn on customer voice-note understanding. Revoking access also turns their switch off immediately.','Autorisez ce client à activer la compréhension des messages vocaux. Le retrait de l’autorisation la désactive immédiatement.','اسمح لهذا العميل بتفعيل فهم الرسائل الصوتية. إلغاء السماح يعطّل الخيار فورًا.'],
    ['Choose one transcription provider for this account. Deepgram targets Moroccan Arabic; Groq handles several languages. The client can only turn voice notes on after you allow them.','Choisissez un seul service de transcription pour ce compte. Deepgram cible l’arabe marocain ; Groq prend en charge plusieurs langues. Le client ne peut activer les messages vocaux qu’après votre autorisation.','اختر مزوداً واحداً للتفريغ الصوتي لهذا الحساب. يستهدف Deepgram الدارجة المغربية، بينما يدعم Groq عدة لغات. لا يمكن للعميل تفعيل الرسائل الصوتية إلا بعد سماحك.'],
    ['Transcription model','Modèle de transcription','نموذج التفريغ الصوتي'],
    ['Groq · multilingual','Groq · multilingue','Groq · متعدد اللغات'],
    ['Deepgram · Moroccan Arabic','Deepgram · arabe marocain','Deepgram · الدارجة المغربية'],
    ['Provider ready','Service prêt','الخدمة جاهزة'],
    ['The selected provider needs an API key.','Le service choisi nécessite une clé API.','المزود المختار يحتاج إلى مفتاح API.'],
    ['Save voice model','Enregistrer le modèle vocal','حفظ النموذج الصوتي']
  ]) translations.set(en, {fr, ar});
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
    const accountCount = key.match(/^(\d+) (matching )?accounts$/);
    if (accountCount) return left + (locale === 'fr' ? `${accountCount[1]} ${accountCount[2] ? 'comptes correspondants' : 'comptes'}` : `${accountCount[1]} ${accountCount[2] ? 'حسابات مطابقة' : 'حسابات'}`) + right;
    const adminStatus = key.match(/^Status: (DRAFT|SUBMITTED|NEEDS_CHANGES|APPROVED|ACTIVE|SUSPENDED)\. Changes are recorded in the activity history\.$/);
    if (adminStatus) {
      const value = translations.get(adminStatus[1].replaceAll('_', ' '))?.[locale] || adminStatus[1];
      return left + (locale === 'fr' ? `Statut : ${value}. Les changements sont consignés dans l’historique.` : `الحالة: ${value}. تُسجّل التغييرات في سجل النشاط.`) + right;
    }
    const savedPlan = key.match(/^Saved plan: (.+)$/);
    if (savedPlan) return left + (locale === 'fr' ? 'Offre enregistrée : ' : 'الباقة المحفوظة: ') + savedPlan[1] + right;
    const connectedInstagram = key.match(/^Connected as (@.+)$/);
    if (connectedInstagram) return left + (locale === 'fr' ? 'Connecté en tant que ' : 'متصل باسم ') + connectedInstagram[1] + right;
    const draftCount = key.match(/^Create (\d+) draft plans?$/);
    if (draftCount) return left + (locale === 'fr' ? `Créer ${draftCount[1]} offre${draftCount[1] === '1' ? '' : 's'} en brouillon` : `إنشاء ${draftCount[1]} باقة كمسودة`) + right;
    const customerMessages = key.match(/^(\d+) customer messages$/);
    if (customerMessages) return left + (locale === 'fr' ? `${customerMessages[1]} messages clients` : `${customerMessages[1]} رسالة عميل`) + right;
    const numberCount = key.match(/^(\d+) WhatsApp numbers?$/);
    if (numberCount) return left + (locale === 'fr' ? `${numberCount[1]} numéro${numberCount[1] === '1' ? '' : 's'} WhatsApp` : `${numberCount[1]} رقم واتساب`) + right;
    const costCeiling = key.match(/^Internal AI ceiling: \$(.+)$/);
    if (costCeiling) return left + (locale === 'fr' ? `Plafond IA interne : ${costCeiling[1]} $` : `حد تكلفة الذكاء الاصطناعي الداخلي: ${costCeiling[1]} دولار`) + right;
    const recentMessages = key.match(/^Messages · last (\d+) days$/);
    if (recentMessages) return left + (locale === 'fr' ? `Messages · ${recentMessages[1]} derniers jours` : `الرسائل · آخر ${recentMessages[1]} يومًا`) + right;
    const providerSwitch = key.match(/^(Provider ready|The selected provider needs an API key\.) · Client switch: (On|Off)$/);
    if (providerSwitch) return left + `${translations.get(providerSwitch[1])?.[locale] || providerSwitch[1]} · ${translations.get('Client switch:')?.[locale] || 'Client switch:'} ${translations.get(providerSwitch[2])?.[locale] || providerSwitch[2]}` + right;
    const planPrice = key.match(/^MAD \/ month · suggested$/);
    if (planPrice) return left + (locale === 'fr' ? 'MAD / mois · suggéré' : 'درهم / شهر · مقترح') + right;
    const planSuggestion = key.match(/^(.+) · suggested (\d+) MAD$/);
    if (planSuggestion) return left + `${translations.get(planSuggestion[1])?.[locale] || planSuggestion[1]}${locale === 'fr' ? ` · suggéré ${planSuggestion[2]} MAD` : ` · سعر مقترح ${planSuggestion[2]} درهم`}` + right;
    const transitionCount = key.match(/^Conditional transitions \((\d+)\)$/);
    if (transitionCount) return left + `${translations.get('Conditional transitions')?.[locale]} (${transitionCount[1]})` + right;
    const transitionField = key.match(/^(Transition|Default transition|Remove transition) (\d+)( intent| condition| target)?$/);
    if (transitionField) {
      const field = transitionField[3] ? translations.get(transitionField[3].trim())?.[locale] || transitionField[3].trim() : '';
      const action = translations.get(transitionField[1])?.[locale] || transitionField[1];
      return left + `${action} ${transitionField[2]}${field ? ` · ${field}` : ''}` + right;
    }
    const workflowMessageField = key.match(/^(Existing open request message|Bot message) · (en|fr|ar|darija)$/);
    if (workflowMessageField) return left + `${translations.get(workflowMessageField[1])?.[locale] || workflowMessageField[1]} · ${workflowMessageField[2]}` + right;
    const intentField = key.match(/^Intent (\d+) (ID|description|shared use cases — one per line|custom keywords — one per line|workflow)$/);
    if (intentField) {
      const parts = locale === 'fr'
        ? { ID: 'identifiant', description: 'description', 'shared use cases — one per line': 'cas d’usage communs — un par ligne', 'custom keywords — one per line': 'mots-clés personnalisés — un par ligne', workflow: 'parcours' }
        : { ID: 'المعرّف', description: 'الوصف', 'shared use cases — one per line': 'حالات الاستخدام المشتركة — واحدة في كل سطر', 'custom keywords — one per line': 'كلمات مخصصة — كلمة في كل سطر', workflow: 'مسار العمل' };
      return left + (locale === 'fr' ? `Intention ${intentField[1]} · ${parts[intentField[2]]}` : `النية ${intentField[1]} · ${parts[intentField[2]]}`) + right;
    }
    const graphEdge = key.match(/^(Next|Continue) → (.+)$/);
    if (graphEdge) return left + `${translations.get(graphEdge[1])?.[locale] || graphEdge[1]} → ${graphEdge[2]}` + right;
    const inquiryCount = key.match(/^(\d+) (inquiry|inquiries|lead|leads)$/);
    if (inquiryCount) {
      const singular = inquiryCount[2] === 'inquiry' || inquiryCount[2] === 'lead';
      const label = singular ? (inquiryCount[2] === 'inquiry' ? 'Inquiry' : 'Lead') : (inquiryCount[2] === 'inquiries' ? 'Inquiries' : 'Leads');
      return left + inquiryCount[1] + ' ' + (translations.get(label)?.[locale] || inquiryCount[2]) + right;
    }
    const serviceDate = key.match(/^(Received|Reminder:) (.+)$/);
    if (serviceDate) return left + (locale === 'fr' ? (serviceDate[1] === 'Received' ? 'Reçue le ' : 'Rappel : ') : (serviceDate[1] === 'Received' ? 'وصل في ' : 'تذكير: ')) + serviceDate[2] + right;
    const followUp = key.match(/^(Follow up|Last updated) (.+)$/);
    if (followUp) return left + (locale === 'fr' ? (followUp[1] === 'Follow up' ? 'Relancer le ' : 'Mis à jour le ') : (followUp[1] === 'Follow up' ? 'المتابعة: ' : 'آخر تحديث: ')) + followUp[2] + right;
    const ready = key.match(/^(\d+\/\d+) ready$/);
    if (ready) return left + ready[1] + ' ' + translations.get('ready')[locale] + right;
    const version = key.match(/^Version (\d+)$/);
    if (version) return left + (locale === 'fr' ? `Version ${version[1]}` : `الإصدار ${version[1]}`) + right;
    const steps = key.match(/^(\d+) of (\d+) steps complete$/);
    if (steps) return left + (locale === 'fr' ? `${steps[1]} étapes sur ${steps[2]} terminées` : `اكتملت ${steps[1]} من ${steps[2]} خطوات`) + right;
    return source;
  }

  function textNode(node) {
    if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.parentElement?.tagName) || node.parentElement?.isContentEditable) return;
    if (node.parentElement?.closest('[data-no-translate], .inbox-msg-content, .admin-convo-message p, .admin-convo-snippet, .preview-message p')) return;
    const raw = node.nodeValue || '';
    const previous = originals.get(node);
    const source = previous && raw === previous.rendered ? previous.source : raw;
    if (node.parentElement?.tagName === 'OPTION' && !node.parentElement.hasAttribute('value')) node.parentElement.value = source.trim();
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

  translations.set('Show', { fr: 'Afficher', ar: 'إظهار' });
  translations.set('Hide', { fr: 'Masquer', ar: 'إخفاء' });
  translations.set('Show password', { fr: 'Afficher le mot de passe', ar: 'إظهار كلمة المرور' });
  translations.set('Hide password', { fr: 'Masquer le mot de passe', ar: 'إخفاء كلمة المرور' });
  for (const [en, fr, ar] of [
    ['Signing in…','Connexion en cours…','جارٍ تسجيل الدخول…'],
    ['We couldn’t sign you in. Check your email and password, then try again.','Connexion impossible. Vérifiez votre adresse e-mail et votre mot de passe, puis réessayez.','ما قدرناش نسجلو دخولك. تأكد من البريد الإلكتروني وكلمة المرور، وعاود حاول.'],
    ['Please verify your email before signing in.','Confirmez votre adresse e-mail avant de vous connecter.','أكد البريد الإلكتروني ديالك قبل تسجيل الدخول.'],
    ['Too many attempts. Please wait a few minutes and try again.','Trop de tentatives. Patientez quelques minutes avant de réessayer.','كانت محاولات بزاف. تسنى بضع دقائق وعاود حاول.'],
    ['We couldn’t connect. Check your internet connection and try again.','Connexion au service impossible. Vérifiez votre connexion Internet et réessayez.','ما قدرناش نتاصلو بالخدمة. تأكد من الإنترنت وعاود حاول.'],
    ['We couldn’t sign you in right now. Please try again shortly.','Connexion momentanément impossible. Veuillez réessayer dans un instant.','ما قدرناش نسجلو دخولك دابا. عاود حاول من بعد شوية.']
  ]) translations.set(en, { fr, ar });
  for (const [en, fr, ar] of [
    ['Permissions & advanced','Autorisations et paramètres avancés','الصلاحيات والإعدادات المتقدمة'],
    ['Identity & voice','Identité et voix','الهوية والأسلوب'],['Answer policy','Règles de réponse','قواعد الرد'],
    ['Knowledge','Connaissances','المعرفة'],['Model & response limits','Modèle et limites de réponse','النموذج وحدود الرد'],
    ['Plan allowances','Limites de l’offre','حدود الباقة'],['Show settings','Afficher les paramètres','إظهار الإعدادات'],
    ['Hide settings','Masquer les paramètres','إخفاء الإعدادات'],['Default language','Langue par défaut','اللغة الافتراضية'],
    ['Customer messages','Messages clients','رسائل العملاء'],['AI calls','Appels IA','استدعاءات الذكاء الاصطناعي'],
    ['Estimated AI spend (USD)','Coût IA estimé (USD)','تكلفة الذكاء الاصطناعي المقدرة (دولار)'],
    ['Image analyses','Analyses d’images','تحليلات الصور'],['Embeddings','Représentations vectorielles','التضمينات'],
    ['WhatsApp numbers','Numéros WhatsApp','أرقام واتساب'],['Products','Produits','المنتجات'],
    ['Document storage (MB)','Stockage des documents (Mo)','تخزين المستندات (ميغابايت)'],
    ['Raw configuration (JSON)','Configuration brute (JSON)','الإعدادات الخام (JSON)']
  ]) translations.set(en, { fr, ar });
  for (const [en, fr, ar] of [
    ['Customer requests','Demandes clients','طلبات العملاء'],['Customers to contact','Clients à contacter','عملاء يحتاجون إلى تواصل'],
    ['Need a reply','Réponse attendue','يحتاج إلى رد'],['Needs reply','Réponse attendue','يحتاج إلى رد'],['Planned','Planifiés','مجدول'],['Handled','Traités','تمت المعالجة'],
    ['Open requests','Ouvrir les demandes','فتح الطلبات'],['Customer request','Demande du client','طلب العميل'],
    ['Customers who asked about a service or booking. Decide who needs a reply and when.','Clients qui ont demandé un service ou une réservation. Décidez à qui répondre et quand.','العملاء الذين سألوا عن خدمة أو حجز. حدد من يحتاج إلى رد ومتى.'],
    ['Open the chat to answer, or choose a reminder.','Ouvrez la conversation pour répondre ou programmez un rappel.','افتح المحادثة للرد أو حدد تذكيرًا.'],
    ['Requests return to Needs reply when their reminder is due.','Les demandes reviennent dans Réponse attendue à l’échéance du rappel.','تعود الطلبات إلى «يحتاج إلى رد» عند حلول موعد التذكير.'],
    ['Requests you have finished handling.','Demandes que vous avez traitées.','الطلبات التي انتهيت من معالجتها.'],
    ['No customers need a reply right now.','Aucun client n’attend de réponse pour le moment.','لا يوجد عميل يحتاج إلى رد الآن.'],
    ['No reminders planned.','Aucun rappel prévu.','لا توجد تذكيرات مجدولة.'],['No handled requests yet.','Aucune demande traitée pour le moment.','لا توجد طلبات منتهية بعد.'],
    ['Reply in chat','Répondre dans la conversation','الرد في المحادثة'],['Manage request','Gérer la demande','إدارة الطلب'],['View request','Voir la demande','عرض الطلب'],
    ['See what the customer needs, then choose the next step.','Voyez le besoin du client, puis choisissez la suite.','اطلع على طلب العميل ثم اختر الخطوة التالية.'],
    ['All requests','Toutes les demandes','كل الطلبات'],['Customer asked about a service','Le client a posé une question sur un service','سأل العميل عن خدمة'],
    ['What happens next?','Quelle est la prochaine étape ?','ما الخطوة التالية؟'],['Remind me at','Me rappeler le','ذكّرني في'],
    ['Back in Needs reply on','De retour dans Réponse attendue le','يعود إلى «يحتاج إلى رد» في'],['Return to Needs reply on','Revenir dans Réponse attendue le','إعادة إظهاره في «يحتاج إلى رد» يوم'],['Request saved.','Demande enregistrée.','تم حفظ الطلب.'],
    ['Private note','Note privée','ملاحظة داخلية'],['(optional)','(facultatif)','(اختياري)'],['What should you check before replying?','Que vérifier avant de répondre ?','ما الذي يجب التحقق منه قبل الرد؟'],
    ['Save follow-up','Enregistrer le suivi','حفظ المتابعة'],['Mark handled','Marquer comme traité','تمت المعالجة'],['Reopen request','Rouvrir la demande','إعادة فتح الطلب'],
    ['More details','Plus de détails','تفاصيل إضافية'],['Use these only if they help your team. A request is not a confirmed booking.','Utilisez-les seulement si cela aide votre équipe. Une demande n’est pas une réservation confirmée.','استخدم هذه الحقول إذا أفادت فريقك. الطلب ليس حجزًا مؤكدًا.'],
    ['Customer\'s preferred time','Horaire préféré du client','الوقت الذي يفضله العميل'],['Received','Reçue','وصل'],
    ['This request returns to Needs reply on the chosen date. No notification or WhatsApp message is sent automatically.','Cette demande revient dans Réponse attendue à la date choisie. Aucune notification ni message WhatsApp n’est envoyé automatiquement.','يعود الطلب إلى «يحتاج إلى رد» في الموعد المحدد. لا يُرسل إشعار أو رسالة واتساب تلقائيًا.'],
    ['Reply to the customer now, or set a time to come back to this request.','Répondez maintenant ou fixez un rappel pour cette demande.','رد على العميل الآن أو حدد وقتًا للعودة إلى هذا الطلب.'],
    ['This request is marked handled. Reopen it if you still need to respond.','Cette demande est traitée. Rouvrez-la si vous devez encore répondre.','هذا الطلب معالَج. أعد فتحه إذا كنت بحاجة إلى الرد.'],
    ['Leads','Prospects','العملاء المحتملون'],
    ['Follow up on people who showed buying or booking intent.','Suivez les personnes intéressées par un achat ou une réservation.','تابع الأشخاص المهتمين بالشراء أو الحجز.'],
    ['Export CSV','Exporter en CSV','تصدير CSV'],
    ['New','Nouveau','جديد'],['Contacted','Contacté','تم التواصل'],['Qualified','Qualifié','مؤهل'],['Won','Gagné','ناجح'],['Lost','Perdu','مفقود'],
    ['Lead pipeline','Suivi des prospects','متابعة العملاء المحتملين'],
    ['Lead detection does not confirm an order. Check the conversation before marking a sale.','La détection d’un prospect ne confirme pas une commande. Vérifiez la conversation avant de valider une vente.','اكتشاف عميل محتمل لا يؤكد الطلب. راجع المحادثة قبل تأكيد البيع.'],
    ['Status','Statut','الحالة'],['Contact','Contact','جهة الاتصال'],['Order / booking details','Détails de commande ou réservation','تفاصيل الطلب أو الحجز'],
    ['Updated','Mis à jour','آخر تحديث'],['Conversation','Conversation','محادثة'],['Open chat ›','Ouvrir la conversation ›','فتح المحادثة ›'],
    ['Not collected','Non recueilli','لم تُجمع المعلومات'],['No leads in this view yet.','Aucun prospect dans cette vue.','لا يوجد عملاء محتملون هنا بعد.'],
    ['Create clear offers for clients and keep provider costs under control.','Créez des offres claires tout en maîtrisant les coûts des fournisseurs.','أنشئ باقات واضحة مع التحكم في تكاليف الخدمات.'],
    ['Create plan','Créer une offre','إنشاء باقة'],['Edit plan','Modifier l’offre','تعديل الباقة'],
    ['Start from a suggested offer','Commencer avec une offre suggérée','ابدأ بباقة مقترحة'],['Custom plan','Offre personnalisée','باقة مخصصة'],
    ['Monthly price','Prix mensuel','السعر الشهري'],['Plan name','Nom de l’offre','اسم الباقة'],['Currency','Devise','العملة'],
    ['What does the client get?','Que reçoit le client ?','ماذا يحصل عليه العميل؟'],['Included features','Fonctionnalités incluses','الميزات المشمولة'],
    ['Capacity','Capacité','السعة'],['Unlimited customer messages','Messages clients illimités','رسائل العملاء غير محدودة'],
    ['AI replies','Réponses IA','ردود الذكاء الاصطناعي'],['AI spend ceiling (USD)','Plafond de dépenses IA (USD)','حد تكلفة الذكاء الاصطناعي (دولار)'],
    ['Save plan','Enregistrer l’offre','حفظ الباقة'],['Cancel','Annuler','إلغاء'],['Advanced configuration','Configuration avancée','إعدادات متقدمة'],
    ['FAQs and PDF knowledge','FAQ et documents PDF','الأسئلة الشائعة وملفات PDF'],['Services and appointments','Services et rendez-vous','الخدمات والمواعيد'],
    ['Product catalog','Catalogue de produits','كتالوج المنتجات'],['Product images','Images des produits','صور المنتجات'],
    ['QR connection (experimental)','Connexion QR (expérimentale)','اتصال QR (تجريبي)'],
    ['Cash on delivery','Paiement à la livraison','الدفع عند التسليم'],['View captured details','Voir les informations recueillies','عرض المعلومات المجمعة'],
    ['Review the chat before confirming this order.','Vérifiez la conversation avant de confirmer cette commande.','راجع المحادثة قبل تأكيد هذا الطلب.'],
    ['Lead follow-up and CSV export','Suivi des prospects et export CSV','متابعة العملاء المحتملين وتصدير CSV'],
    ['Pick the features that fit your business. Your administrator confirms the final offer.','Choisissez les fonctionnalités adaptées à votre activité. Votre administrateur confirme l’offre finale.','اختر الميزات المناسبة لنشاطك. يؤكد المشرف الباقة النهائية.'],
    ['Showing the latest 1,000 leads. CSV export includes the full history.','Affichage des 1 000 prospects les plus récents. L’export CSV contient tout l’historique.','يتم عرض آخر ١٠٠٠ عميل محتمل. يتضمن تصدير CSV السجل الكامل.']
  ]) translations.set(en, {fr, ar});

  // Administrator pages are rendered from several modules. Keep their shared
  // vocabulary here so switching language works after every client-side render.
  for (const [en, fr, ar] of [
    ['Instagram DMs','Messages privés Instagram','رسائل إنستغرام الخاصة'],
    ['Let your chatbot answer private messages sent to your Instagram professional account.','Laissez votre chatbot répondre aux messages privés de votre compte Instagram professionnel.','دع روبوتك يرد على الرسائل الخاصة لحساب إنستغرام المهني.'],
    ['Your Instagram account','Votre compte Instagram','حساب إنستغرام الخاص بك'],
    ['No Instagram account connected yet.','Aucun compte Instagram connecté.','لم يتم ربط حساب إنستغرام بعد.'],
    ['Connect Instagram','Connecter Instagram','ربط إنستغرام'],
    ['Reconnect account','Reconnecter le compte','إعادة ربط الحساب'],
    ['Disconnect','Déconnecter','قطع الاتصال'],
    ['How it works','Comment ça marche','كيف يعمل'],
    ['Your chatbot uses the same published business information as WhatsApp. It answers incoming Instagram DMs only. Comments and unsolicited messages are not included.','Votre chatbot utilise les mêmes informations publiées que sur WhatsApp. Il répond uniquement aux messages privés Instagram entrants, sans commentaires ni messages non sollicités.','يستخدم روبوتك بيانات النشاط المنشورة نفسها المستخدمة في واتساب. يرد فقط على رسائل إنستغرام الخاصة الواردة، دون التعليقات أو الرسائل غير المطلوبة.'],
    ['A customer must message your professional account first. Human handoff and replies appear in your Inbox with an Instagram label.','Le client doit d’abord écrire à votre compte professionnel. Les transferts à un humain et les réponses apparaissent dans votre boîte de réception avec la mention Instagram.','يجب أن يرسل العميل رسالة إلى حسابك المهني أولًا. تظهر المحادثات المحوّلة إلى موظف والردود في صندوق الوارد مع علامة إنستغرام.'],
    ['AI replies are enabled.','Les réponses automatiques sont actives.','الردود الآلية مفعّلة.'],
    ['Your administrator has paused Instagram replies.','L’administrateur a suspendu les réponses Instagram.','أوقف المشرف ردود إنستغرام مؤقتًا.'],
    ['Instagram setup is not ready yet. Ask your administrator to configure Meta access.','Instagram n’est pas encore configuré. Demandez à votre administrateur de configurer l’accès Meta.','إعداد إنستغرام غير جاهز بعد. اطلب من المشرف ضبط الوصول إلى ميتا.'],
    ['The client connects their own Instagram professional account. You control whether chatbot replies are active.','Le client connecte son propre compte Instagram professionnel. Vous contrôlez l’activation des réponses.','يربط العميل حساب إنستغرام المهني الخاص به. وتتحكم أنت في تفعيل الردود.'],
    ['Chatbot replies enabled','Réponses du chatbot actives','ردود الروبوت مفعّلة'],
    ['Chatbot replies paused','Réponses du chatbot suspendues','ردود الروبوت متوقفة'],
    ['Pause replies','Suspendre les réponses','إيقاف الردود مؤقتًا'],
    ['Enable replies','Activer les réponses','تفعيل الردود'],
    ['No activity yet.','Aucune activité pour le moment.','لا يوجد نشاط بعد.'],
    ['Manage plans','Gérer les offres','إدارة الباقات'],
    ['Review & edit data','Vérifier et modifier les données','مراجعة البيانات وتعديلها'],
    ['Publish data','Publier les données','نشر البيانات'],
    ['Save controls','Enregistrer les paramètres','حفظ الإعدادات'],
    ['Chatbot controls','Paramètres du chatbot','إعدادات روبوت المحادثة'],
    ['Usage & statistics','Utilisation et statistiques','الاستخدام والإحصاءات'],
    ['Account status','Statut du compte','حالة الحساب'],
    ['Activation requires an approved plan, published data and a WhatsApp connection.','L’activation nécessite une offre approuvée, des données publiées et une connexion WhatsApp.','يتطلب التفعيل باقة معتمدة وبيانات منشورة واتصال واتساب.'],
    ['Client review note','Note de révision du client','ملاحظة مراجعة العميل'],
    ['Choose a plan','Choisir une offre','اختر باقة'],
    ['No plan assigned yet. Select a plan, then save or publish.','Aucune offre attribuée. Choisissez-en une, puis enregistrez ou publiez.','لم تُعيّن باقة بعد. اختر باقة ثم احفظ الإعدادات أو انشرها.'],
    ['Connection status can be enabled or paused from this account.','Vous pouvez activer ou suspendre la connexion depuis ce compte.','يمكن تفعيل الاتصال أو إيقافه مؤقتًا من هذا الحساب.'],
    ['The client has not linked a WhatsApp number yet.','Le client n’a pas encore associé de numéro WhatsApp.','لم يربط العميل رقم واتساب بعد.'],
    ['Pause','Suspendre','إيقاف مؤقت'],['Enable','Activer','تفعيل'],
    ['Only administrators can edit technical behavior.','Seuls les administrateurs peuvent modifier le comportement technique.','يمكن للمشرفين فقط تعديل سلوك الروبوت التقني.'],
    ['Lock client business fields','Verrouiller les champs de l’entreprise','قفل حقول بيانات النشاط للعميل'],
    ['Automatically publish client changes','Publier automatiquement les changements du client','نشر تغييرات العميل تلقائيًا'],
    ['Publish validated changes while active','Publier les changements validés pendant l’activation','نشر التغييرات المعتمدة أثناء تفعيل الحساب'],
    ['Advanced chatbot configuration (JSON)','Configuration avancée du chatbot (JSON)','إعدادات الروبوت المتقدمة (JSON)'],
    ['Model, prompts, workflow, retrieval and chatbot rules. Invalid configuration is rejected.','Modèle, instructions, parcours, recherche et règles du chatbot. Une configuration invalide est refusée.','النموذج والتعليمات ومسار العمل والاسترجاع وقواعد الروبوت. تُرفض الإعدادات غير الصالحة.'],
    ['Usage and statistics','Utilisation et statistiques','الاستخدام والإحصاءات'],
    ['Actual receipts where available; conservative reservations otherwise.','Coûts réels lorsqu’ils sont disponibles ; estimations prudentes sinon.','تكاليف فعلية عند توفرها، وتقديرات احتياطية في غير ذلك.'],
    ['Test this client’s chatbot','Tester le chatbot de ce client','اختبار روبوت هذا العميل'],
    ['Run an isolated conversation without sending a WhatsApp message.','Lancez une conversation isolée sans envoyer de message WhatsApp.','ابدأ محادثة اختبار مستقلة دون إرسال رسالة واتساب.'],
    ['New session','Nouvelle session','جلسة جديدة'],['Configuration','Configuration','الإعدادات'],
    ['Saved draft','Brouillon enregistré','المسودة المحفوظة'],['Published version','Version publiée','النسخة المنشورة'],
    ['Start with a customer question in English, French, Arabic or Darija.','Commencez par une question en anglais, français, arabe ou darija.','ابدأ بسؤال عميل بالإنجليزية أو الفرنسية أو العربية أو الدارجة.'],
    ['Customer message','Message du client','رسالة العميل'],['Type a customer message…','Saisissez un message client…','اكتب رسالة العميل…'],['Send test','Envoyer le test','إرسال الاختبار'],
    ['Publication history','Historique des publications','سجل النشر'],['Restore','Restaurer','استعادة'],['No published version yet.','Aucune version publiée.','لم تُنشر أي نسخة بعد.'],
    ['Client editing','Modification par le client','تعديل العميل'],
    ['Chatbot information is frozen for this client.','Les informations du chatbot sont verrouillées pour ce client.','بيانات الروبوت مقفلة لهذا العميل.'],
    ['This client can edit their chatbot information.','Ce client peut modifier les informations de son chatbot.','يمكن لهذا العميل تعديل بيانات روبوته.'],
    ['WhatsApp replies and inbox work continue.','Les réponses WhatsApp et la boîte de réception restent actives.','تستمر ردود واتساب وصندوق الوارد في العمل.'],
    ['Freeze editing','Verrouiller les modifications','قفل التعديل'],['Unfreeze editing','Déverrouiller les modifications','فتح التعديل'],
    ['Client editing frozen.','Modifications du client verrouillées.','تم قفل تعديل العميل.'],['Client editing unfrozen.','Modifications du client déverrouillées.','تم فتح تعديل العميل.'],
    ['Contacts','Contacts','جهات الاتصال'],['Estimated AI cost','Coût IA estimé','تكلفة الذكاء الاصطناعي المقدّرة'],
    ['CLIENT CONFIGURATION','CONFIGURATION DU CLIENT','إعدادات العميل'],
    ['Changes affect this client only. Saving settings updates an active chatbot immediately; Publish data also releases the latest business content.','Ces changements concernent uniquement ce client. Enregistrer met à jour immédiatement un chatbot actif ; publier les données rend aussi le dernier contenu disponible.','تخص هذه التغييرات هذا العميل فقط. يحفظ الإعدادات تغييرات الروبوت النشط فورًا؛ وينشر زر «نشر البيانات» أحدث محتوى للنشاط.'],
    ['Overrides apply only to this client. Recorded usage remains unchanged.','Les dérogations concernent uniquement ce client. L’utilisation enregistrée reste inchangée.','تخص الحدود المعدّلة هذا العميل فقط. يبقى الاستخدام المسجل دون تغيير.'],
    ['AI calls and estimated spend still have separate limits.','Les appels IA et les dépenses estimées conservent des limites distinctes.','تبقى لاستدعاءات الذكاء الاصطناعي والتكلفة المقدّرة حدود منفصلة.'],
    ['Apply the latest version of the selected plan when saving','Appliquer la dernière version de l’offre choisie à l’enregistrement','تطبيق أحدث نسخة من الباقة المحددة عند الحفظ'],
    ['Assign a plan in Overview to set this account’s allowances.','Attribuez une offre dans Vue d’ensemble pour définir les limites de ce compte.','عيّن باقة في «نظرة عامة» لتحديد حدود هذا الحساب.'],
    ['No recorded activity in this period.','Aucune activité enregistrée pendant cette période.','لا يوجد نشاط مسجل خلال هذه الفترة.'],
    ['AI and voice usage','Utilisation de l’IA et de la voix','استخدام الذكاء الاصطناعي والصوت'],
    ['Languages, intents and response sources','Langues, intentions et sources des réponses','اللغات والنوايا ومصادر الردود'],
    ['Lead status','Statut des prospects','حالة العملاء المحتملين'],
    ['WhatsApp delivery and retries','Envois WhatsApp et nouvelles tentatives','إرسال واتساب وإعادة المحاولة'],
    ['Connect this client’s Meta app','Connecter l’application Meta de ce client','ربط تطبيق ميتا الخاص بهذا العميل'],
    ['Prepare connection','Préparer la connexion','إعداد الاتصال'],['Show setup','Afficher la configuration','عرض الإعداد'],
    ['Meta webhook callback URL','URL de rappel du webhook Meta','رابط استدعاء ويب هوك ميتا'],
    ['Meta webhook verify token','Jeton de vérification du webhook Meta','رمز التحقق من ويب هوك ميتا'],
    ['Activate after Meta verification','Activer après vérification Meta','تفعيل بعد تحقق ميتا'],
    ['Saved plans','Offres enregistrées','الباقات المحفوظة'],
    ['These are the actual offers in your account.','Voici les offres réellement enregistrées dans votre compte.','هذه هي الباقات المحفوظة فعليًا في حسابك.'],
    ['No saved plans yet.','Aucune offre enregistrée.','لا توجد باقات محفوظة بعد.'],
    ['Suggested offers','Offres suggérées','باقات مقترحة'],
    ['Service Assistant','Assistant de services','مساعد الخدمات'],
    ['Sales Assistant','Assistant commercial','مساعد المبيعات'],
    ['For service businesses: answer FAQs and PDFs, explain services, capture appointment requests and follow up on inquiries. No product catalog or COD.','Pour les entreprises de services : répondre aux FAQ et aux PDF, présenter les services, recueillir les demandes de rendez-vous et suivre les demandes. Sans catalogue ni paiement à la livraison.','للأنشطة الخدمية: الرد على الأسئلة وملفات PDF، وشرح الخدمات، وتسجيل طلبات المواعيد ومتابعتها. دون كتالوج منتجات أو دفع عند التسليم.'],
    ['For shops: answer FAQs and PDFs, show products and images, capture purchase requests and optionally configure COD. No service bookings.','Pour les commerces : répondre aux FAQ et aux PDF, présenter les produits et les images, recueillir les demandes d’achat et, si nécessaire, configurer le paiement à la livraison. Sans réservations de services.','للمتاجر: الرد على الأسئلة وملفات PDF، وعرض المنتجات والصور، وتسجيل طلبات الشراء، مع إمكانية إعداد الدفع عند التسليم. دون حجز خدمات.'],
    ['Suggested · not saved','Suggérée · non enregistrée','مقترحة · غير محفوظة'],
    ['Already saved','Déjà enregistrée','محفوظة مسبقًا'],
    ['Review & create draft','Vérifier et créer le brouillon','مراجعة المسودة وإنشاؤها'],
    ['Edit saved plan','Modifier l’offre enregistrée','تعديل الباقة المحفوظة'],
    ['Review a template, or save the missing offers as unpublished drafts.','Vérifiez un modèle ou enregistrez les offres manquantes comme brouillons non publiés.','راجع نموذجًا أو احفظ الباقات الناقصة كمسودات غير منشورة.'],
    ['Cash on delivery (COD)','Paiement à la livraison','الدفع عند التسليم'],
    ['Offer','Offre','الباقة'],['Prices are suggestions. Review them before publishing.','Les prix sont suggérés. Vérifiez-les avant publication.','الأسعار مقترحة. راجعها قبل النشر.'],
    ['Only enable what this offer can actually provide.','N’activez que les fonctions réellement disponibles dans cette offre.','فعّل فقط الميزات التي توفرها هذه الباقة فعليًا.'],
    ['QR sessions require separate infrastructure; leave off for normal Meta Cloud plans.','Les sessions QR nécessitent une infrastructure distincte ; désactivez-les pour les offres Meta Cloud classiques.','تحتاج جلسات QR إلى بنية منفصلة؛ اتركها معطّلة في باقات ميتا السحابية المعتادة.'],
    ['AI reply and spend ceilings still apply. Do not market unlimited AI replies.','Les plafonds de réponses IA et de dépenses restent applicables. Ne promettez pas de réponses IA illimitées.','تبقى حدود ردود الذكاء الاصطناعي والتكلفة سارية. لا تسوّق ردودًا غير محدودة.'],
    ['Technical template (JSON)','Modèle technique (JSON)','النموذج التقني (JSON)'],
    ['Publish this plan so clients can request it','Publier cette offre pour que les clients puissent la demander','نشر هذه الباقة ليتمكن العملاء من طلبها'],
    ['Saving does not change plans already assigned to clients.','L’enregistrement ne modifie pas les offres déjà attribuées aux clients.','لا يغيّر الحفظ الباقات المعيّنة للعملاء مسبقًا.'],
    ['Correct the advanced JSON before editing workflows.','Corrigez le JSON avancé avant de modifier les parcours.','صحّح إعدادات JSON المتقدمة قبل تعديل مسارات العمل.'],
    ['Guided workflows','Parcours guidés','مسارات العمل الموجّهة'],
    ['Build conversation steps, branching choices and customer information forms.','Créez des étapes de conversation, des choix et des formulaires clients.','أنشئ خطوات المحادثة والخيارات المتفرعة ونماذج بيانات العملاء.'],
    ['Start from a template','Commencer avec un modèle','ابدأ بنموذج'],['Conversation steps','Étapes de conversation','خطوات المحادثة'],
    ['Input validation and extraction','Validation et extraction des données','التحقق من المدخلات واستخراج البيانات'],
    ['Customer choices','Choix du client','خيارات العميل'],['Conditional transitions','Transitions conditionnelles','الانتقالات المشروطة'],
    ['Transition','Transition','انتقال'],['Default transition','Transition par défaut','الانتقال الافتراضي'],['Remove transition','Supprimer la transition','حذف الانتقال'],
    ['intent','intention','النية'],['condition','condition','الشرط'],['target','destination','الوجهة'],
    ['Step identifier','Identifiant de l’étape','معرّف الخطوة'],['Live flow preview','Aperçu du parcours','معاينة المسار'],
    ['Select a step in the diagram to edit it.','Choisissez une étape dans le schéma pour la modifier.','اختر خطوة في المخطط لتعديلها.'],
    ['No workflows yet. Add one or start from a template.','Aucun parcours pour le moment. Ajoutez-en un ou partez d’un modèle.','لا توجد مسارات عمل بعد. أضف مسارًا أو ابدأ بنموذج.'],
    ['Intents & routing','Intentions et routage','النوايا وتوجيه المحادثات'],
    ['Connect what the customer asks to the right workflow.','Associez la demande du client au bon parcours.','اربط طلب العميل بمسار العمل المناسب.'],
    ['No custom intents configured.','Aucune intention personnalisée configurée.','لم تُضبط نوايا مخصصة.'],
    ['Ends here','Se termine ici','ينتهي هنا'],
    ['Verified','Vérifié','تم التحقق'],['Pending','En attente','قيد الانتظار'],
    ['Restore access','Rétablir l’accès','استعادة الوصول'],['Disable access','Désactiver l’accès','تعطيل الوصول'],
    ['Reserved','Réservé','محجوز'],['Monthly cap','Plafond mensuel','الحد الشهري'],
    ['No accounts yet.','Aucun compte pour le moment.','لا توجد حسابات بعد.'],
    ['Estimates exclude WhatsApp, hosting, taxes and payment fees. Unknown provider outcomes keep their reservation.','Les estimations excluent WhatsApp, l’hébergement, les taxes et les frais de paiement. Les coûts incertains restent réservés.','لا تشمل التقديرات واتساب والاستضافة والضرائب ورسوم الدفع. تبقى التكلفة محجوزة عند عدم معرفة نتيجة المزود.']
  ]) translations.set(en, { fr, ar });
  for (const [en, fr, ar] of [
    ['Name','Nom','الاسم'],['Email','E-mail','البريد الإلكتروني'],['Address','Adresse','العنوان'],['Hours','Horaires','ساعات العمل'],
    ['name','nom','الاسم'],['email','e-mail','البريد الإلكتروني'],['phone','téléphone','الهاتف'],['website','site web','الموقع الإلكتروني'],
    ['description','description','الوصف'],['address','adresse','العنوان'],['hours','horaires','ساعات العمل'],['currency','devise','العملة'],
    ['policies','politiques','السياسات'],['faqs','FAQ','الأسئلة الشائعة'],['services','services','الخدمات'],
    ['short','court','قصير'],['medium','moyen','متوسط'],['long','long','طويل'],['professional','professionnel','مهني'],
    ['Draft','Brouillon','مسودة'],['Published','Publié','منشور'],['NEEDS_CHANGES','MODIFICATIONS REQUISES','يتطلب تعديلات'],
    ['New isolated test session started.','Nouvelle session de test isolée lancée.','بدأت جلسة اختبار مستقلة جديدة.'],
    ['Published version restored.','Version publiée restaurée.','تمت استعادة النسخة المنشورة.'],
    ['The chatbot returned no response.','Le chatbot n’a pas répondu.','لم يقدّم الروبوت ردًا.'],
    ['Correct the advanced configuration before changing these settings.','Corrigez la configuration avancée avant de modifier ces paramètres.','صحّح الإعدادات المتقدمة قبل تغيير هذه الخيارات.'],
    ['Control which fields clients can edit. Raw configuration is available only when needed.','Définissez les champs modifiables par le client. La configuration brute reste disponible au besoin.','حدّد الحقول التي يمكن للعميل تعديلها. تتوفر الإعدادات الخام عند الحاجة فقط.'],
    ['No messages yet','Aucun message pour le moment','لا توجد رسائل بعد'],
    ['Load older messages','Charger les messages précédents','تحميل الرسائل الأقدم'],
    ['Select a conversation to read the transcript.','Choisissez une conversation pour afficher les messages.','اختر محادثة لعرض رسائلها.'],
    ['No plan','Aucune offre','لا توجد باقة'],['Current month','Ce mois-ci','الشهر الحالي'],
    ['Status:','Statut :','الحالة:'],['Client switch:','Option du client :','خيار العميل:'],
    ['On','Activé','مفعّل'],['Off','Désactivé','معطّل'],
    ['Verification','Vérification','التحقق'],['Access','Accès','الوصول'],['Images','Images','الصور'],
    ['Estimated spend','Coût estimé','التكلفة المقدّرة'],['Messages','Messages','الرسائل'],['Version','Version','النسخة'],
    ['Try again','Réessayer','حاول مجددًا'],['COD order workflow can be added per client','Le parcours de commande à la livraison peut être ajouté par client','يمكن إضافة مسار طلب الدفع عند التسليم لكل عميل'],
    ['Preserves existing intent and condition rules. A direct next step can take precedence for linear steps.','Conserve les règles d’intention et de condition existantes. Une étape suivante directe peut prévaloir dans les parcours linéaires.','يحافظ على قواعد النوايا والشروط الحالية. قد تتقدم الخطوة التالية المباشرة في المسارات المتتابعة.'],
    ['Chatbot information is frozen for this client. WhatsApp replies and inbox work continue.','Les informations du chatbot sont verrouillées pour ce client. Les réponses WhatsApp et la boîte de réception restent actives.','بيانات الروبوت مقفلة لهذا العميل. تستمر ردود واتساب وصندوق الوارد في العمل.'],
    ['This client can edit their chatbot information. WhatsApp replies and inbox work continue.','Ce client peut modifier les informations de son chatbot. Les réponses WhatsApp et la boîte de réception restent actives.','يمكن لهذا العميل تعديل بيانات روبوته. تستمر ردود واتساب وصندوق الوارد في العمل.']
  ]) translations.set(en, { fr, ar });

  for (const [en, fr, ar] of [
    ['Client data review','Vue des données client','مراجعة بيانات العميل'],
    ['Editing client data','Modification des données client','تعديل بيانات العميل'],
    ['Read the saved draft below. Edit only when you need to make a change.','Consultez le brouillon enregistré ci-dessous. Modifiez-le seulement si nécessaire.','راجع المسودة المحفوظة أدناه، وعدّلها عند الحاجة فقط.'],
    ['Changes save automatically. Finish editing to return to the review.','Les modifications sont enregistrées automatiquement. Terminez pour revenir à la vue.','تُحفظ التغييرات تلقائياً. أنهِ التعديل للعودة إلى المراجعة.'],
    ['Edit client data','Modifier les données client','تعديل بيانات العميل'],
    ['Done editing','Terminer la modification','إنهاء التعديل'],
    ['Client knowledge · Draft','Connaissances client · Brouillon','معرفة العميل · مسودة'],
    ['Review what the chatbot knows before publishing changes.','Vérifiez les connaissances du chatbot avant de publier les modifications.','راجع ما يعرفه روبوت المحادثة قبل نشر التغييرات.'],
    ['At a glance','En bref','نظرة سريعة'],
    ['The information currently saved for this client.','Les informations actuellement enregistrées pour ce client.','البيانات المحفوظة حالياً لهذا العميل.'],
    ['Identity, offer and contact details','Identité, offre et coordonnées','الهوية والخدمات وبيانات الاتصال'],
    ['Answers customers may need before deciding','Réponses utiles aux clients avant leur décision','إجابات قد يحتاجها العملاء قبل اتخاذ قرارهم'],
    ['Catalog entries available to the chatbot','Articles du catalogue disponibles pour le chatbot','عناصر الكتالوج المتاحة لروبوت المحادثة'],
    ['Services and appointment information','Informations sur les services et les rendez-vous','معلومات الخدمات والمواعيد'],
    ['Frequently asked questions','Questions fréquentes','الأسئلة الشائعة'],
    ['Approved answers for common customer questions','Réponses approuvées aux questions courantes des clients','إجابات معتمدة لأسئلة العملاء الشائعة'],
    ['What they offer','Ce que propose cette entreprise','ما يقدمه هذا النشاط'],
    ['Variants','Variantes','الخيارات'],
    ['Nothing added yet.','Aucune information ajoutée.','لم تُضف بيانات بعد.'],
    ['Not provided','Non renseigné','غير مذكور'],
    ['No plan assigned','Aucune offre attribuée','لم تُعيّن باقة']
  ]) translations.set(en, { fr, ar });

  for (const [en, fr, ar] of [
    ['Today','Aujourd’hui','اليوم'],
    ['Answer reviews','Révision des réponses','مراجعة الإجابات'],
    ['Everything that needs a person, in one place.','Toutes les actions humaines au même endroit.','كل ما يحتاج إلى تدخل بشري في مكان واحد.'],
    ['Needs a person','Intervention humaine','يحتاج إلى موظف'],
    ['Customer requests due','Demandes clients à traiter','طلبات العملاء المستحقة'],
    ['Answers to review','Réponses à vérifier','إجابات للمراجعة'],
    ['Conversations waiting for you','Conversations en attente','محادثات تنتظر تدخلك'],
    ['Requests to follow up','Demandes à relancer','طلبات للمتابعة'],
    ['Chatbot answers to improve','Réponses du chatbot à améliorer','إجابات الروبوت للتحسين'],
    ['No handoffs waiting.','Aucun transfert en attente.','لا توجد محادثات تنتظر التدخل.'],
    ['No requests due now.','Aucune demande à traiter maintenant.','لا توجد طلبات مستحقة الآن.'],
    ['No answers flagged.','Aucune réponse signalée.','لا توجد إجابات مبلّغ عنها.'],
    ['Report answer','Signaler la réponse','الإبلاغ عن الإجابة'],
    ['What was wrong with this answer?','Quel était le problème avec cette réponse ?','ما الخطأ في هذه الإجابة؟'],
    ['Send for review','Envoyer pour révision','إرسال للمراجعة'],
    ['Who will handle this?','Qui traitera cette demande ?','من سيتولى هذا الطلب؟'],
    ['Unassigned · account team','Non attribué · équipe du compte','غير معيّن · فريق الحساب'],
    ['Customer asked','Le client a demandé','سأل العميل'],
    ['Chatbot replied','Le chatbot a répondu','رد روبوت المحادثة'],
    ['Why it was flagged:','Motif du signalement :','سبب الإبلاغ:'],
    ['Edit business knowledge','Modifier les informations','تعديل معلومات النشاط'],
    ['Retest draft','Retester le brouillon','إعادة اختبار المسودة'],
    ['Retest published','Retester la version publiée','إعادة اختبار النسخة المنشورة'],
    ['What changed?','Qu’est-ce qui a changé ?','ما الذي تغيّر؟'],
    ['Mark reviewed','Marquer comme révisé','تأكيد المراجعة'],
    ['No answers need review.','Aucune réponse à réviser.','لا توجد إجابات تحتاج إلى مراجعة.'],
    ['Claim the chat to take over. Open chats are shared with your account team.','Prenez en charge la conversation. Les conversations ouvertes sont partagées avec votre équipe.','تولَّ المحادثة للرد بنفسك. تُعرض المحادثات المفتوحة لفريق حسابك.'],
    ['Open the request, reply to the customer, or choose a later follow-up time.','Ouvrez la demande, répondez au client ou planifiez une relance.','افتح الطلب وردّ على العميل، أو حدّد موعداً لاحقاً للمتابعة.'],
    ['Handoff requested','Intervention demandée','طلب تدخل موظف'],
    ['Follow-up due','Relance à effectuer','حان موعد المتابعة'],
    ['New request','Nouvelle demande','طلب جديد'],
    ['Unassigned','Non attribué','غير معيّن'],
    ['Answer review','Révision de réponse','مراجعة إجابة'],
    ['Reported issue','Problème signalé','مشكلة مبلّغ عنها'],
    ['Needs correction','À corriger','تحتاج إلى تصحيح'],
    ['Reviewed','Révisée','تمت المراجعة'],
    ['Open client','Voir le client','فتح حساب العميل'],
    ['Open conversation','Ouvrir la conversation','فتح المحادثة'],
    ['Question unavailable','Question indisponible','السؤال غير متاح'],
    ['Correct approved knowledge, retest the original question, publish, then confirm the live answer.','Corrigez les informations approuvées, retestez la question, publiez puis vérifiez la réponse publiée.','صحّح المعلومات المعتمدة، وأعد اختبار السؤال، وانشر التعديلات، ثم تحقّق من الإجابة المنشورة.'],
    ['Answers reported from your customer conversations. Your administrator can correct and retest them.','Réponses signalées dans vos conversations. Votre administrateur peut les corriger et les retester.','إجابات مبلّغ عنها في محادثات عملائك. يمكن للمسؤول تصحيحها وإعادة اختبارها.'],
    ['Back to client','Retour au client','العودة إلى حساب العميل'],
    ['Describe the correction and confirm the published retest answer is right.','Décrivez la correction et confirmez que la réponse publiée est correcte.','اشرح التصحيح وأكّد صحة الإجابة عند اختبار النسخة المنشورة.'],
    ['No completed reviews yet.','Aucune révision terminée.','لا توجد مراجعات مكتملة بعد.'],
    ['Retest complete. Review the answer before closing.','Test terminé. Vérifiez la réponse avant de clôturer.','اكتمل الاختبار. راجع الإجابة قبل إغلاق المراجعة.'],
    ['Review completed.','Révision terminée.','اكتملت المراجعة.']
  ]) translations.set(en, { fr, ar });

  // Keep administrator and connection controls aligned with the three workspace languages.
  for (const [en, fr, ar] of [
    ['Administration','Administration','الإدارة'],
    ['Client account','Compte client','حساب العميل'],
    ['All controls saved.','Tous les paramètres sont enregistrés.','تم حفظ جميع الإعدادات.'],
    ['Unsaved changes. Save controls, or save and publish together.','Modifications non enregistrées. Enregistrez les paramètres ou enregistrez et publiez ensemble.','هناك تغييرات غير محفوظة. احفظ الإعدادات أو احفظها وانشر البيانات معًا.'],
    ['How the assistant introduces itself and speaks to customers.','Comment l’assistant se présente et parle aux clients.','كيف يعرّف المساعد بنفسه ويتحدث إلى العملاء.'],
    ['Chatbot name','Nom du chatbot','اسم روبوت المحادثة'],
    ['Darija writing','Écriture de la darija','طريقة كتابة الدارجة'],
    ['Tone','Ton','نبرة الرد'],
    ['Reply length','Longueur des réponses','طول الرد'],
    ['Automatic','Automatique','تلقائي'],
    ['Arabic script','Écriture arabe','حروف عربية'],
    ['Latin script (Arabizi)','Écriture latine (Arabizi)','حروف لاتينية (عربيزي)'],
    ['Short','Courte','قصير'],['Medium','Moyenne','متوسط'],['Long','Longue','طويل'],
    ['Set boundaries for replies and decide when a person should take over.','Définissez les limites des réponses et quand un membre de l’équipe doit intervenir.','حدد حدود الردود ومتى يجب أن يتدخل أحد أعضاء الفريق.'],
    ['Stay on business topics','Rester sur les sujets de l’entreprise','الالتزام بمواضيع النشاط'],
    ['Answer only from approved knowledge','Répondre uniquement à partir des informations validées','الإجابة من المعلومات المعتمدة فقط'],
    ['Allow small talk','Autoriser les échanges courtois','السماح بالمحادثات الودية القصيرة'],
    ['Allow human handoff','Permettre le transfert à un humain','السماح بتحويل المحادثة إلى موظف'],
    ['Redirect unrelated questions to the business.','Ramener les questions hors sujet à l’activité.','إعادة الأسئلة غير المرتبطة إلى موضوع النشاط.'],
    ['Avoid unsupported claims when approved information is missing.','Éviter les affirmations non vérifiées si les informations validées manquent.','تجنب المعلومات غير المؤكدة عند غياب بيانات معتمدة.'],
    ['Allow brief greetings before returning to the business.','Autoriser une courte salutation avant de revenir au sujet.','السماح بتحية قصيرة قبل العودة لموضوع النشاط.'],
    ['Offer a person when the chatbot cannot resolve the request.','Proposer un membre de l’équipe si le chatbot ne peut pas résoudre la demande.','اقتراح تدخل موظف عندما لا يستطيع الروبوت حل الطلب.'],
    ['Control whether approved business information is retrieved for an answer.','Choisissez si les informations validées sont consultées pour répondre.','تحكم في استخدام معلومات النشاط المعتمدة عند الرد.'],
    ['Use knowledge retrieval','Utiliser la recherche documentaire','استخدام البحث في المعرفة'],
    ['Search approved documents and FAQs before replying.','Consulter les documents et questions fréquentes validés avant de répondre.','البحث في المستندات والأسئلة الشائعة المعتمدة قبل الرد.'],
    ['Knowledge matches per answer','Résultats documentaires par réponse','نتائج المعرفة لكل رد'],
    ['Advanced performance and cost settings for this client.','Paramètres avancés de performance et de coût pour ce client.','إعدادات الأداء والتكلفة المتقدمة لهذا العميل.'],
    ['DeepSeek model','Modèle DeepSeek','نموذج DeepSeek'],
    ['Creativity (0–2)','Créativité (0–2)','الإبداع (0–2)'],
    ['Maximum response tokens','Nombre maximal de tokens par réponse','الحد الأقصى لرموز الرد'],
    ['Response timeout (milliseconds)','Délai maximal de réponse (millisecondes)','مهلة الرد (مللي ثانية)'],
    ['Maximum response characters','Nombre maximal de caractères par réponse','الحد الأقصى لأحرف الرد'],
    ['Automated turns per conversation','Tours automatisés par conversation','عدد الردود الآلية لكل محادثة'],
    ['Official WhatsApp API','API officielle WhatsApp','واجهة واتساب الرسمية'],
    ['Back to controls','Retour aux paramètres','العودة إلى الإعدادات'],
    ['Review business data','Vérifier les données de l’entreprise','مراجعة بيانات النشاط'],
    ['Your administrator has frozen chatbot information edits. Your inbox and WhatsApp connection still work.','Votre administrateur a bloqué la modification des données du chatbot. La messagerie et WhatsApp restent actifs.','أوقف المسؤول تعديل معلومات الروبوت. يبقى صندوق الوارد واتصال واتساب يعملان.'],
    ['Approve indexing','Approuver l’indexation','الموافقة على الفهرسة'],
    ['WhatsApp connected','WhatsApp connecté','واتساب متصل'],
    ['Your business number is connected and ready. Use Reconnect only if Meta access stops working.','Votre numéro professionnel est connecté. Ne le reconnectez que si l’accès Meta cesse de fonctionner.','رقم نشاطك متصل وجاهز. أعد الاتصال فقط إذا توقف وصول Meta عن العمل.'],
    ['Choose the WhatsApp number to connect','Choisir le numéro WhatsApp à connecter','اختر رقم واتساب الذي تريد ربطه'],
    ['Connect selected number','Connecter le numéro choisi','ربط الرقم المحدد'],
    ['Change name','Modifier le nom','تغيير الاسم'],
    ['User access','Accès des utilisateurs','وصول المستخدمين'],
    ['Client name','Nom du client','اسم العميل'],
    ['Save name','Enregistrer le nom','حفظ الاسم'],
    ['Resend verification email','Renvoyer l’e-mail de vérification','إعادة إرسال رسالة التحقق'],
    ['Some changes are not saved. Leave this page?','Certaines modifications ne sont pas enregistrées. Quitter cette page ?','هناك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟'],
    ['Something went wrong.','Une erreur est survenue.','حدث خطأ.']
  ]) translations.set(en, { fr, ar });

  for (const [en, fr, ar] of [
    ['Add workflow','Ajouter un parcours','إضافة مسار عمل'],
    ['Sales & support','Vente et assistance','المبيعات والدعم'],
    ['Contact request','Demande de contact','طلب تواصل'],
    ['Feedback','Avis client','رأي العميل'],
    ['Workflow','Parcours','مسار العمل'],
    ['Duplicate','Dupliquer','نسخ'],
    ['Delete workflow','Supprimer le parcours','حذف مسار العمل'],
    ['Workflow name','Nom du parcours','اسم مسار العمل'],
    ['Workflow description','Description du parcours','وصف مسار العمل'],
    ['Starting step','Première étape','خطوة البداية'],
    ['Start on matching intent or phrase','Démarrer avec une intention ou expression reconnue','البدء عند التعرف على نية أو عبارة'],
    ['Start automatically','Démarrer automatiquement','البدء تلقائيًا'],
    ['Trigger phrases — one per line','Expressions déclencheuses — une par ligne','عبارات التفعيل — عبارة في كل سطر'],
    ['Examples: bghit ncommandi, commander, place an order.','Exemples : bghit ncommandi, commander, place an order.','أمثلة: bghit ncommandi، commander، place an order.'],
    ['Trigger intent IDs — one per line','Identifiants d’intention — un par ligne','معرّفات النوايا — واحد في كل سطر'],
    ['Create or edit these intents below.','Créez ou modifiez ces intentions ci-dessous.','أنشئ هذه النوايا أو عدّلها أدناه.'],
    ['Allow manual start','Autoriser le démarrage manuel','السماح بالبدء يدويًا'],
    ['Allow interruption','Autoriser l’interruption','السماح بالمقاطعة'],
    ['Create CRM follow-up on completion','Créer un suivi CRM à la fin','إنشاء متابعة في CRM عند الاكتمال'],
    ['Saves the collected request in Today and Follow-ups in the same transaction.','Enregistre la demande dans Aujourd’hui et Suivis clients en une seule opération.','يحفظ الطلب في «اليوم» و«متابعة العملاء» في عملية واحدة.'],
    ['Allow another request while one is open','Autoriser une autre demande si une demande est ouverte','السماح بطلب آخر أثناء وجود طلب مفتوح'],
    ['Leave off to prevent duplicate forms until the team marks the existing request done.','Laissez désactivé pour éviter les doublons jusqu’à ce que l’équipe termine la demande ouverte.','اتركه معطلاً لمنع تكرار النماذج حتى ينهي الفريق الطلب المفتوح.'],
    ['Existing open request message','Message pour une demande déjà ouverte','رسالة عند وجود طلب مفتوح'],
    ['Move completed conversation to team','Transférer la conversation terminée à l’équipe','تحويل المحادثة المكتملة إلى الفريق'],
    ['Stops automatic replies and places the conversation in Needs reply.','Arrête les réponses automatiques et place la conversation dans Réponse attendue.','يوقف الردود الآلية ويضع المحادثة في «تحتاج إلى رد».'],
    ['Pause bot for hours','Suspendre le bot pendant (heures)','إيقاف الروبوت لمدة (ساعات)'],
    ['Execution limit','Limite d’exécution','حد مرات التشغيل'],
    ['Once per conversation','Une fois par conversation','مرة واحدة لكل محادثة'],
    ['Custom limit','Limite personnalisée','حد مخصص'],
    ['Maximum executions','Nombre maximal d’exécutions','الحد الأقصى لمرات التشغيل'],
    ['Limit reached message','Message lorsque la limite est atteinte','رسالة عند بلوغ الحد'],
    ['Add step','Ajouter une étape','إضافة خطوة'],
    ['New step','Nouvelle étape','خطوة جديدة'],
    ['Step name','Nom de l’étape','اسم الخطوة'],
    ['Step type','Type d’étape','نوع الخطوة'],
    ['Collect information','Collecter des informations','جمع المعلومات'],
    ['Knowledge answer','Réponse fondée sur les connaissances','إجابة من المعرفة'],
    ['Human handoff','Transfert à un humain','تحويل إلى موظف'],
    ['End workflow','Terminer le parcours','إنهاء مسار العمل'],
    ['Bot message','Message du bot','رسالة الروبوت'],
    ['Data field name','Nom du champ','اسم حقل البيانات'],
    ['Use a stable name, for example fullName or phone.','Utilisez un nom stable, par exemple fullName ou phone.','استخدم اسماً ثابتاً، مثل fullName أو phone.'],
    ['Input type','Type de saisie','نوع الإدخال'],
    ['Text answer meaning','Sens de la réponse textuelle','معنى الإجابة النصية'],
    ['Open text answer','Réponse libre','إجابة نصية مفتوحة'],
    ['Person name','Nom de la personne','اسم الشخص'],
    ['Use Person name when the bot asks for a customer name; unrelated questions will not be saved as a name.','Choisissez Nom de la personne lorsque le bot demande le nom du client ; une question sans rapport ne sera pas enregistrée comme nom.','اختر «اسم الشخص» عندما يسأل الروبوت عن اسم العميل؛ لن تُحفظ الأسئلة غير المرتبطة كأسماء.'],
    ['Allowed values — one per line','Valeurs autorisées — une par ligne','القيم المسموح بها — قيمة في كل سطر'],
    ['Used for enum fields.','Utilisé pour les champs à choix définis.','تُستخدم للحقول ذات الخيارات المحددة.'],
    ['Validation pattern','Expression de validation','نمط التحقق'],
    ['Extraction instructions','Instructions d’extraction','تعليمات استخراج البيانات'],
    ['Add choice','Ajouter un choix','إضافة خيار'],
    ['New choice','Nouveau choix','خيار جديد'],
    ['Choose a step','Choisir une étape','اختر خطوة'],
    ['Confirmation words — one per line','Mots de confirmation — un par ligne','كلمات التأكيد — كلمة في كل سطر'],
    ['Cancellation words — one per line','Mots d’annulation — un par ligne','كلمات الإلغاء — كلمة في كل سطر'],
    ['Cancellation message','Message d’annulation','رسالة الإلغاء'],
    ['Pause bot for (hours)','Suspendre le bot pendant (heures)','إيقاف الروبوت لمدة (ساعات)'],
    ['The conversation moves to Needs reply. If nobody resolves it, bot automation resumes after this time.','La conversation passe dans Réponse attendue. Sans intervention, le bot reprend après ce délai.','تنتقل المحادثة إلى «تحتاج إلى رد». إذا لم يتدخل أحد، يستأنف الروبوت بعد هذه المدة.'],
    ['Next step','Étape suivante','الخطوة التالية'],
    ['Use transition rules below','Utiliser les règles de transition ci-dessous','استخدام قواعد الانتقال أدناه'],
    ['End here','Terminer ici','الانتهاء هنا'],
    ['Add transition','Ajouter une transition','إضافة انتقال'],
    ['Rename step ID','Renommer l’identifiant de l’étape','تغيير معرّف الخطوة'],
    ['New step ID','Nouvel identifiant d’étape','معرّف الخطوة الجديد'],
    ['Set as starting step','Définir comme première étape','تعيين كخطوة بداية'],
    ['Delete step','Supprimer l’étape','حذف الخطوة'],
    ['Change the starting step and incoming paths before deleting this step.','Modifiez la première étape et les chemins entrants avant de supprimer cette étape.','غيّر خطوة البداية والمسارات الواردة قبل حذف هذه الخطوة.'],
    ['Add intent','Ajouter une intention','إضافة نية'],
    ['Normal chatbot answer','Réponse normale du chatbot','رد الروبوت العادي'],
    ['Update conditional transitions using this intent before deleting it.','Modifiez les transitions conditionnelles liées à cette intention avant de la supprimer.','عدّل الانتقالات المشروطة التي تستخدم هذه النية قبل حذفها.'],
    ['Intent IDs must be nonempty and unique.','Les identifiants d’intention doivent être renseignés et uniques.','يجب ألا تكون معرّفات النوايا فارغة أو مكررة.'],
    ['Choose a unique step ID using letters, numbers, underscores or hyphens.','Choisissez un identifiant d’étape unique avec des lettres, chiffres, tirets bas ou tirets.','اختر معرّفاً فريداً للخطوة باستخدام أحرف أو أرقام أو شرطات.']
  ]) translations.set(en, { fr, ar });

  // Operational text used by the inbox and account editor is translated without
  // touching customer-authored conversation content.
  for (const [en, fr, ar] of [
    ['CLIENT CONFIGURATION','CONFIGURATION DU CLIENT','إعدادات العميل'],
    ['Knowledge','Connaissances','المعرفة'],
    ['Permissions & advanced','Autorisations et paramètres avancés','الصلاحيات والإعدادات المتقدمة'],
    ['Show settings','Afficher les paramètres','إظهار الإعدادات'],
    ['Raw configuration (JSON)','Configuration brute (JSON)','الإعدادات الخام (JSON)'],
    ['A recent outbound message outcome is unconfirmed. Reconciling delivery status with WhatsApp…','Le statut d’un message récent n’est pas confirmé. Vérification auprès de WhatsApp…','حالة إرسال رسالة حديثة غير مؤكدة. جارٍ التحقق من واتساب…'],
    ['No messages in this conversation.','Aucun message dans cette conversation.','لا توجد رسائل في هذه المحادثة.'],
    ['Type a reply…','Écrire une réponse…','اكتب ردًا…'],
    ['Type a reply','Écrire une réponse','اكتب ردًا'],
    ['Back to conversations','Retour aux conversations','العودة إلى المحادثات'],
    ['‹ Back','‹ Retour','‹ رجوع'],
    ['✓ Sent','✓ Envoyé','✓ أُرسلت'],
    ['✓✓ Delivered','✓✓ Livré','✓✓ تم التسليم'],
    ['✓✓ Read','✓✓ Lu','✓✓ قُرئت'],
    ['⚠️ Unconfirmed','⚠️ Non confirmé','⚠️ غير مؤكدة'],
    ['✕ Failed to send','✕ Échec de l’envoi','✕ فشل الإرسال'],
    ['Wrong fact, missed question, wrong language…','Fait incorrect, question oubliée, mauvaise langue…','معلومة خاطئة، سؤال لم يُجب عنه، لغة غير مناسبة…'],
    ['You','Vous','أنت'],
    ['AI','IA','الذكاء الاصطناعي']
  ]) translations.set(en, { fr, ar });

  for (const [en, fr, ar] of [
    ['Review','Vérifier','مراجعة'],['Start','Commencer','بدء'],
    ['Activation','Activation','طريقة التفعيل'],['Unlimited','Illimité','غير محدود'],
    ['Required','Obligatoire','مطلوب'],['Confirmation','Confirmation','تأكيد'],
    ['Message','Message','رسالة'],['Choice','Choix','خيار'],
    ['Default','Par défaut','افتراضي'],['Continue','Continuer','متابعة'],
    ['Finish','Terminer','إنهاء'],['Next →','Suivant →','التالي ←'],
    ['Intent','Intention','نية'],
    ['Variant','Variante','خيار'],['Untitled entry','Élément sans titre','عنصر بدون عنوان'],
    ['Setup sent for review.','Configuration envoyée pour validation.','أُرسل الإعداد للمراجعة.'],
    ['Choose a PDF first.','Choisissez d’abord un PDF.','اختر ملف PDF أولًا.'],
    ['PDF uploaded for review.','PDF envoyé pour validation.','رُفع ملف PDF للمراجعة.'],
    ['All changes are saved.','Toutes les modifications sont enregistrées.','حُفظت جميع التغييرات.'],
    ['Document queued for indexing.','Document en attente d’indexation.','المستند بانتظار الفهرسة.'],
    ['Save & publish data','Enregistrer et publier les données','حفظ البيانات ونشرها'],
    ['No plan assigned yet. Select a plan before publishing.','Aucun forfait attribué. Choisissez-en un avant de publier.','لم تُعيّن باقة بعد. اختر باقة قبل النشر.'],
    ['Choose an Assigned plan in Overview, then click Save & publish data.','Choisissez un forfait attribué dans Vue d’ensemble, puis enregistrez et publiez.','اختر باقة معيّنة في «نظرة عامة»، ثم احفظ البيانات وانشرها.'],
    ['Business data published.','Données de l’entreprise publiées.','نُشرت بيانات النشاط.'],
    ['Admin controls saved.','Paramètres administrateur enregistrés.','حُفظت إعدادات الإدارة.'],
    ['Voice notes enabled.','Messages vocaux activés.','فُعّلت الرسائل الصوتية.'],
    ['Voice notes disabled.','Messages vocaux désactivés.','أُوقفت الرسائل الصوتية.'],
    ['Voice-note permission revoked.','Autorisation des messages vocaux retirée.','أُلغيت صلاحية الرسائل الصوتية.'],
    ['Voice-note permission granted. The client can now turn it on.','Messages vocaux autorisés. Le client peut maintenant les activer.','سُمح بالرسائل الصوتية. يمكن للعميل تفعيلها الآن.'],
    ['Voice model saved for this account.','Modèle vocal enregistré pour ce compte.','حُفظ النموذج الصوتي لهذا الحساب.'],
    ['Answer sent for review.','Réponse envoyée pour révision.','أُرسلت الإجابة للمراجعة.'],
    ['Access allowed.','Accès autorisé.','سُمح بالوصول.'],
    ['Access blocked.','Accès bloqué.','مُنع الوصول.'],
    ['Revoke access','Retirer l’accès','إلغاء الوصول'],
    ['Allow access','Autoriser l’accès','السماح بالوصول'],
    ['Instagram status unavailable.','Statut Instagram indisponible.','حالة إنستغرام غير متاحة.'],
    ['Meta app ID','Identifiant de l’application Meta','معرّف تطبيق Meta'],
    ['WhatsApp Business Account ID','Identifiant du compte WhatsApp Business','معرّف حساب واتساب للأعمال'],
    ['Phone number ID','Identifiant du numéro','معرّف رقم الهاتف'],
    ['Meta app secret','Clé secrète de l’application Meta','المفتاح السري لتطبيق Meta'],
    ['System-user access token','Jeton d’accès de l’utilisateur système','رمز وصول مستخدم النظام'],
    ['Client-owned Meta app','Application Meta du client','تطبيق Meta الخاص بالعميل'],
    ['Client-owned Meta connection prepared. Configure the webhook in Meta.','Connexion Meta du client préparée. Configurez le webhook dans Meta.','أُعد اتصال Meta الخاص بالعميل. اضبط رابط استقبال الأحداث في Meta.'],
    ['Manage client access. Administrator accounts are protected.','Gérez l’accès des clients. Les comptes administrateur sont protégés.','أدر وصول العملاء. حسابات المسؤولين محمية.'],
    ['Enter a client name.','Saisissez un nom de client.','أدخل اسم العميل.'],
    ['Client name updated.','Nom du client mis à jour.','حُدّث اسم العميل.'],
    ['Failed to load conversations','Impossible de charger les conversations','تعذّر تحميل المحادثات'],
    ['Failed to load more conversations','Impossible de charger davantage de conversations','تعذّر تحميل محادثات إضافية'],
    ['Failed to load conversation','Impossible de charger la conversation','تعذّر تحميل المحادثة'],
    ['Error loading conversation','Erreur de chargement de la conversation','خطأ أثناء تحميل المحادثة'],
    ['Outcome unconfirmed; reconciling with WhatsApp…','Résultat non confirmé ; vérification auprès de WhatsApp…','النتيجة غير مؤكدة؛ جارٍ التحقق من واتساب…'],
    ['Could not report answer','Impossible de signaler la réponse','تعذّر الإبلاغ عن الإجابة'],
    ['Conversation claimed.','Conversation prise en charge.','تولّيت المحادثة.'],
    ['Takeover failed','Échec de la prise en charge','تعذّر تولّي المحادثة'],
    ['Conversation resolved.','Conversation résolue.','أُغلقت المحادثة.'],
    ['Resolve failed','Échec de la résolution','تعذّر إغلاق المحادثة'],
    ['Conversation reopened. AI automation active.','Conversation rouverte. L’automatisation IA est active.','أُعيد فتح المحادثة. الروبوت نشط.'],
    ['Reopen failed','Échec de la réouverture','تعذّر إعادة فتح المحادثة'],
    ['Failed to send message','Échec de l’envoi du message','تعذّر إرسال الرسالة'],
    ['Core chatbot','Chatbot principal','روبوت المحادثة الأساسي'],
    ['Unlimited inbound messages','Messages entrants illimités','رسائل واردة غير محدودة'],
    ['Instagram DM channel (admin enabled)','Canal Instagram DM (activé par l’administrateur)','رسائل إنستغرام الخاصة (بتفعيل المسؤول)'],
    ['Instagram replies are currently paused by your administrator or plan.','Les réponses Instagram sont suspendues par votre administrateur ou votre forfait.','ردود إنستغرام متوقفة حاليًا بسبب إعدادات المسؤول أو الباقة.']
  ]) translations.set(en, { fr, ar });

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
