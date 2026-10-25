// Copy for "The Relayqo app" section, following the site's language switch (EN / FR / AR).
(() => {
  const copy = {
    en: {
      navApp: "App", newBadge: "New", kicker: "The Relayqo app",
      title: "Your whole business, in your pocket.",
      lead: "Install Relayqo on your phone like an app. The assistant answers your customers; when one needs you, your phone buzzes and you reply in one tap.",
      pillAlerts: "Instant “customer needs you” alerts", pillInstall: "Installs like an app", pillLang: "Darija · العربية · Français", pillTheme: "Dark and light mode",
      inboxTitle: "Every chat, one inbox", inboxText: "WhatsApp conversations in one list. The ones that need you are marked.",
      chatTitle: "Take over in one tap", chatText: "See what the assistant answered, then reply yourself when a customer needs a person.",
      requestsTitle: "No request gets lost", requestsText: "Who asked what, and when. Reply now or set a reminder for later.",
      calendarTitle: "Bookings, day by day", calendarText: "The assistant books only free times. Call or WhatsApp the customer from the booking.",
      ordersTitle: "Orders ready to confirm", ordersText: "Orders taken in WhatsApp, with the total. Confirm, call, then follow the delivery.",
      ctaTry: "Try it on WhatsApp", ctaOpen: "Open the app", ctaNote: "Screens from the Relayqo app with sample data."
    },
    fr: {
      navApp: "App", newBadge: "Nouveau", kicker: "L’app Relayqo",
      title: "Toute votre activité, dans votre poche.",
      lead: "Installez Relayqo sur votre téléphone comme une app. L’assistant répond à vos clients ; quand l’un d’eux a besoin de vous, votre téléphone vibre et vous répondez en un geste.",
      pillAlerts: "Alerte « un client a besoin de vous »", pillInstall: "S’installe comme une app", pillLang: "Darija · العربية · Français", pillTheme: "Mode sombre et clair",
      inboxTitle: "Tous les messages, une seule boîte", inboxText: "Vos conversations WhatsApp dans une liste. Celles qui vous attendent sont signalées.",
      chatTitle: "Reprenez la main en un geste", chatText: "Voyez ce que l’assistant a répondu, puis répondez vous-même quand le client a besoin d’une personne.",
      requestsTitle: "Aucune demande oubliée", requestsText: "Qui a demandé quoi, et quand. Répondez tout de suite ou programmez un rappel.",
      calendarTitle: "Les rendez-vous, jour par jour", calendarText: "L’assistant ne réserve que les créneaux libres. Appelez ou écrivez au client depuis le rendez-vous.",
      ordersTitle: "Commandes prêtes à confirmer", ordersText: "Les commandes prises sur WhatsApp, avec le total. Confirmez, appelez, puis suivez la livraison.",
      ctaTry: "Essayer sur WhatsApp", ctaOpen: "Ouvrir l’app", ctaNote: "Écrans de l’app Relayqo avec des données d’exemple."
    },
    ar: {
      navApp: "التطبيق", newBadge: "جديد", kicker: "تطبيق Relayqo",
      title: "الخدمة ديالك كاملة، فجيبك.",
      lead: "ثبّت Relayqo فالتيليفون بحال شي تطبيق. المساعد كيجاوب الكليان ديالك، وملي شي واحد يحتاجك، التيليفون كيعلمك وكتجاوب بضغطة وحدة.",
      pillAlerts: "تنبيه «كليان محتاجك» فالحين", pillInstall: "كيتثبت بحال تطبيق", pillLang: "الدارجة · العربية · Français", pillTheme: "الوضع الليلي والنهاري",
      inboxTitle: "كاع الميساجات، فبلاصة وحدة", inboxText: "محادثات الواتساب فليستة وحدة، واللي محتاجينك باينين.",
      chatTitle: "خود المحادثة بضغطة", chatText: "شوف أشنو جاوب المساعد، ومن بعد جاوب نتا ملي الكليان يحتاج شي واحد.",
      requestsTitle: "حتى طلب ما كيضيع", requestsText: "شكون سول على أشنو، وفوقاش. جاوب دابا ولا دير تذكير من بعد.",
      calendarTitle: "المواعيد، نهار بنهار", calendarText: "المساعد كيحجز غير الأوقات الخاوية. عيّط ولا صيفط واتساب للكليان من الموعد.",
      ordersTitle: "الطلبيات واجدة للتأكيد", ordersText: "الطلبيات اللي تاخدات فالواتساب، مع المجموع. أكّد، عيّط، وتبّع التوصيل.",
      ctaTry: "جرّب على واتساب", ctaOpen: "فتح التطبيق", ctaNote: "صور من تطبيق Relayqo بمعطيات تجريبية."
    }
  };
  const root = document.documentElement;
  const apply = () => {
    const text = copy[root.lang] || copy.en;
    document.querySelectorAll("[data-sc]").forEach((element) => { const value = text[element.dataset.sc]; if (value) element.textContent = value; });
  };
  apply();
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["lang"] });
})();
