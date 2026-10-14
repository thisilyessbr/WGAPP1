# Moroccan commerce chatbot evaluation — 1000 conversations

Pass rate: **96.1%** (961/1000). p50 6251 ms, p95 11229 ms, 4501 LLM calls.

Automatic rule checks (price, stock, image, delivery fee/time, policy facts, reply language/script, invented amounts). Fictional store; isolated test database; no WhatsApp.

## By language

- English: 192/200 (96%)
- French: 192/200 (96%)
- Arabic (MSA): 194/200 (97%)
- Darija (Arabic script): 196/200 (98%)
- Darija (Arabizi): 187/200 (94%)

## By question type

- price: 110/110 (100%)
- available: 70/70 (100%)
- variant: 70/70 (100%)
- photo: 95/95 (100%)
- followupPhoto: 32/40 (80%)
- fee: 66/70 (94%)
- time: 39/40 (98%)
- cod: 49/50 (98%)
- card: 18/20 (90%)
- exchange: 39/40 (98%)
- refund: 25/25 (100%)
- free: 22/25 (88%)
- location: 30/30 (100%)
- hours: 32/35 (91%)
- sunday: 19/20 (95%)
- discount: 35/35 (100%)
- unknown: 30/30 (100%)
- order: 60/60 (100%)
- tracking: 11/25 (44%)
- human: 25/25 (100%)
- greeting: 25/25 (100%)
- multi: 49/50 (98%)
- quality: 10/10 (100%)

## Failure reasons

- missing tracking explanation: 14
- expected Darija in Latin script #: 11
- no product image attached: 8
- expected English #: 3
- missing #-day exchange window: 1
- did not say closed on Sunday: 1
- missing price #: 1
- missing delivery fee #: 1

## Failed conversations

### 0347-followupPhoto-fr

- Customer: Combien coûte le caftan Yasmine ?
- Bot: Le prix de Caftan Yasmine est de 890 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0352-followupPhoto-fr

- Customer: Combien coûte le baskets ?
- Bot: Le prix de Baskets Rif Runner est de 520 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0357-followupPhoto-fr

- Customer: Combien coûte le montre Sahara ?
- Bot: Le prix de Montre Sahara est de 990 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0362-followupPhoto-fr

- Customer: Combien coûte le djellaba ?
- Bot: Le prix de Djellaba Nour est de 450 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0367-followupPhoto-fr

- Customer: Combien coûte le abaya Salma ?
- Bot: Le prix de Abaya Salma est de 380 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0372-followupPhoto-fr

- Customer: Combien coûte le sweat à capuche ?
- Bot: Le prix de Hoodie Ultras est de 260 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0377-followupPhoto-fr

- Customer: Combien coûte le baskets Rif Runner ?
- Bot: Le prix de Baskets Rif Runner est de 520 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0382-followupPhoto-fr

- Customer: Combien coûte le t-shirt ?
- Bot: Le prix de T-shirt Casablanca est de 149 MAD.
- Customer: Envoyez-moi une photo svp
- Bot: Je n'ai pas pu identifier le produit exact dans le catalogue. Pouvez-vous me donner son nom ou sa référence ?
- Problems: no product image attached
### 0431-fee-en

- Customer: delivery cost to Laayoune?
- Bot: Livraison à Laâyoune : 35 MAD, délai 48 à 72h. Gratuite dès 500 MAD d'achat.
- Problems: expected English (en=0, fr=3, darija=0)
### 0445-fee-dz

- Customer: livraison l mrakch bch7al?
- Bot: Livraison l Marrakech: 48 sa 72 sa, frais 35 MAD. Gratuite dès 500 MAD d'achat.
- Problems: expected Darija in Latin script (darija=1, en=0, fr=2)
### 0451-fee-en

- Customer: delivery cost to Agadir?
- Bot: Livraison à Agadir : 35 MAD, en 48 à 72h. Gratuite dès 500 MAD d'achat.
- Problems: expected English (en=0, fr=3, darija=0)
### 0455-fee-dz

- Customer: livraison l agadir bch7al?
- Bot: Livraison l Agadir: 48 sa 72 sa, frais 35 MAD. Gratuite dès 500 MAD d'achat. Lkhlas f lbab (cash à la réception).
- Problems: expected Darija in Latin script (darija=2, en=0, fr=4)
### 0475-time-dz

- Customer: ch7al kat9ad livraison l mrakch?
- Bot: Livraison l Marrakech: 48 sa 72 sa, frais 35 MAD. Gratuite dès 500 MAD d'achat.
- Problems: expected Darija in Latin script (darija=1, en=0, fr=2)
### 0540-cod-dz

- Customer: wach lkhlas f lbab?
- Bot: Iyeh, lkhlas f lbab momkin: paiement à la livraison (cash à la réception). Virement bancaire aussi maqbol, walakin la carte bancaire machi maqbula.
- Problems: expected Darija in Latin script (darija=3, en=0, fr=6)
### 0550-card-dz

- Customer: n9der nkhles b la carte?
- Bot: La, ma-mkhelesch b la carte. Lkhlas kaykon cash 3nd twsil (paiement à la livraison), w virement bancaire mqbol.
- Problems: expected Darija in Latin script (darija=3, en=0, fr=5)
### 0565-card-dz

- Customer: n9der nkhles b la carte?
- Bot: La, ma n9derch tkhles b la carte. Lkhlas kaykon cash 3nd stilam (paiement à la livraison), w virement bancaire mqbol.
- Problems: expected Darija in Latin script (darija=2, en=0, fr=5)
### 0575-exchange-dz

- Customer: wach katbdlo?
- Bot: Ah, smehli, ma fhemtekch mzyan. Wach katsewlni wach katbdlo l-produit (echange) wla wach katbdlo l-paiement?
- Problems: missing 7-day exchange window
### 0635-free-dz

- Customer: livraison fabor?
- Bot: Livraison partout au Maroc : Casablanca en 24h pour 20 MAD, autres villes en 48 à 72h pour 35 MAD. Livraison gratuite dès 500 MAD d'achat.
- Problems: expected Darija in Latin script (darija=0, en=0, fr=6)
### 0650-free-dz

- Customer: livraison fabor?
- Bot: Livraison partout au Maroc : Casablanca en 24h pour 20 MAD, autres villes en 48 à 72h pour 35 MAD. Livraison gratuite dès 500 MAD d'achat.
- Problems: expected Darija in Latin script (darija=0, en=0, fr=6)
### 0655-free-dz

- Customer: livraison fabor?
- Bot: Livraison partout au Maroc. Casablanca : 24h, 20 MAD. Autres villes : 48 à 72h, 35 MAD. Gratuite dès 500 MAD d'achat.
- Problems: expected Darija in Latin script (darija=0, en=0, fr=3)
### 0695-hours-dz

- Customer: imta katsdo?
- Bot: Lundi au samedi de 10:00 à 20:00. Fermé le dimanche.
- Problems: expected Darija in Latin script (darija=0, en=0, fr=4)
### 0715-hours-dz

- Customer: imta katsdo?
- Bot: Lundi à samedi : 10h00–20h00. Dimanche : fermé.
- Problems: expected Darija in Latin script (darija=0, en=0, fr=1)
### 0716-hours-en

- Customer: what time do you close?
- Bot: We close at 20:00, Monday to Saturday. Closed Sunday. Hours: Lundi au samedi de 10:00 à 20:00. Fermé le dimanche.
- Problems: expected English (en=2, fr=4, darija=0)
### 0725-sunday-dz

- Customer: wach m7lolin nhar l7ed?
- Bot: La, l7ed m7lolin. L7ed mssdodin. L7wayj m7lolin mn tnin l sebt mn 10h l 20h.
- Problems: did not say closed on Sunday
### 0866-tracking-en

- Customer: Where is my order? how can I track it?
- Bot: Sorry, I don't have that information right now. I can help with products, delivery, returns. What would you like to know?
- Problems: missing tracking explanation
### 0868-tracking-ar

- Customer: كيف يمكنني تتبع طلبي؟
- Bot: عذراً، لا تتوفر لدي هذه المعلومة حالياً. يمكنني مساعدتك بخصوص المنتجات, التوصيل, الإرجاع. ماذا تود أن تعرف؟
- Problems: missing tracking explanation
### 0869-tracking-da

- Customer: كيفاش نتبع الكوموند ديالي؟
- Bot: سمح ليا، ما عنديش هاد المعلومة دابا. نقدر نعاونك فـ المنتوجات, التوصيل, الترجيع. شنو بغيتي تعرف؟
- Problems: missing tracking explanation
### 0871-tracking-en

- Customer: Where is my order? how can I track it?
- Bot: Sorry, I don't have that information right now. I can help with products, delivery, returns. What would you like to know?
- Problems: missing tracking explanation
### 0873-tracking-ar

- Customer: كيف يمكنني تتبع طلبي؟
- Bot: عذراً، لا تتوفر لدي هذه المعلومة حالياً. يمكنني مساعدتك بخصوص المنتجات, التوصيل, الإرجاع. ماذا تود أن تعرف؟
- Problems: missing tracking explanation
### 0876-tracking-en

- Customer: Where is my order? how can I track it?
- Bot: Sorry, I don't have that information right now. I can help with products, delivery, returns. What would you like to know?
- Problems: missing tracking explanation
### 0878-tracking-ar

- Customer: كيف يمكنني تتبع طلبي؟
- Bot: عذراً، لا تتوفر لدي هذه المعلومة حالياً. يمكنني مساعدتك بخصوص المنتجات, التوصيل, الإرجاع. ماذا تود أن تعرف؟
- Problems: missing tracking explanation
### 0879-tracking-da

- Customer: كيفاش نتبع الكوموند ديالي؟
- Bot: سمح ليا، ما عنديش هاد المعلومة دابا. نقدر نعاونك فـ المنتوجات, التوصيل, الترجيع. شنو بغيتي تعرف؟
- Problems: missing tracking explanation
### 0881-tracking-en

- Customer: Where is my order? how can I track it?
- Bot: Sorry, I don't have that information right now. I can help with products, delivery, returns. What would you like to know?
- Problems: missing tracking explanation
### 0883-tracking-ar

- Customer: كيف يمكنني تتبع طلبي؟
- Bot: عذراً، لا تتوفر لدي هذه المعلومة حالياً. يمكنني مساعدتك بخصوص المنتجات, التوصيل, الإرجاع. ماذا تود أن تعرف؟
- Problems: missing tracking explanation
### 0884-tracking-da

- Customer: كيفاش نتبع الكوموند ديالي؟
- Bot: سمح ليا، ما عنديش هاد المعلومة دابا. نقدر نعاونك فـ المنتوجات, التوصيل, الترجيع. شنو بغيتي تعرف؟
- Problems: missing tracking explanation
### 0886-tracking-en

- Customer: Where is my order? how can I track it?
- Bot: Sorry, I don't have that information right now. I can help with products, delivery, returns. What would you like to know?
- Problems: missing tracking explanation
### 0888-tracking-ar

- Customer: كيف يمكنني تتبع طلبي؟
- Bot: عذراً، لا تتوفر لدي هذه المعلومة حالياً. يمكنني مساعدتك بخصوص المنتجات, التوصيل, الإرجاع. ماذا تود أن تعرف؟
- Problems: missing tracking explanation
### 0889-tracking-da

- Customer: كيفاش نتبع الكوموند ديالي؟
- Bot: سمح ليا، ما عنديش هاد المعلومة دابا. نقدر نعاونك فـ المنتوجات, التوصيل, الترجيع. شنو بغيتي تعرف؟
- Problems: missing tracking explanation
### 0953-multi-ar

- Customer: كم سعر القفطان وكم ثمن التوصيل إلى فاس؟
- Bot: عذراً، لا تتوفر لدي هذه المعلومة حالياً. يمكنني مساعدتك بخصوص المنتجات, التوصيل, الإرجاع. ماذا تود أن تعرف؟
- Problems: missing price 890; missing delivery fee 35