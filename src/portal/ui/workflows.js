(() => {
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
  const safeId = key => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) && !['constructor','prototype','__proto__'].includes(key);
  const phrases = value => value.split('\n').map(v=>v.trim()).filter(Boolean);
  const edges = state => [
    ...(state.next ? [{target:state.next,label:'Next'}] : []),
    ...(state.options || []).map(o=>({target:o.next,label:o.label || 'Choice'})),
    ...(state.transitions || []).map(t=>({target:t.target,label:t.intent || t.condition || (t.default?'Default':'Continue')}))
  ];
  function orderedSteps(wf) {
    const seen=new Set(),pending=[wf.initialState];
    for(let i=0;i<pending.length;i++){
      const id=pending[i];if(seen.has(id)||!own(wf.states,id))continue;
      seen.add(id);edges(wf.states[id]).forEach(edge=>pending.push(edge.target));
    }
    return [...seen,...Object.keys(wf.states).filter(id=>!seen.has(id))];
  }
  function removeIntent(workflows,intents,index) {
    const id=intents[index].id;
    if(Object.values(workflows).some(wf=>Object.values(wf.states).some(s=>(s.transitions||[]).some(t=>t.intent===id))))
      throw Error('Update conditional transitions using this intent before deleting it.');
    intents.splice(index,1);
    Object.values(workflows).forEach(wf=>{if(wf.activation?.intents)wf.activation.intents=wf.activation.intents.filter(value=>value!==id);});
  }
  function diagnostics(workflows, intents=[], calendar) {
    const errors=[],warnings=[];
    for(const [key,wf] of Object.entries(workflows)) {
      if(!wf.states || !own(wf.states,wf.initialState)) { errors.push(`${key}: choose an existing starting step.`); continue; }
      const used=new Set();
      const calendarSteps=Object.entries(wf.states).filter(([,st])=>st.calendar);
      for(const [id,st] of calendarSteps) {
        if(st.type!=='collect') errors.push(`${key} / ${id}: calendar day and time steps must collect information.`);
        if(st.calendar==='slots'&&!Object.values(wf.states).some(s=>s.calendar==='day'&&s.next===id)) errors.push(`${key} / ${id}: a calendar time step must come right after a calendar day step.`);
        if(st.calendar==='day'&&wf.states[st.next]?.calendar!=='slots') errors.push(`${key} / ${id}: the step after a calendar day step must be a calendar time step.`);
      }
      if(calendarSteps.length&&calendar!==undefined&&!(calendar?.enabled&&calendar?.calendarId)) warnings.push(`${key}: calendar bookings are paused for this client, so the day and time are asked as plain questions and the team confirms later.`);
      if(wf.calendarBooking&&!calendarSteps.some(([,st])=>st.calendar==='slots')) warnings.push(`${key}: calendar booking is on, but no step offers calendar times.`);
      for(const [id,st] of Object.entries(wf.states)) {
        if(!['choice','collect','confirm','message','rag','handoff','end'].includes(st.type)) errors.push(`${key} / ${id}: unknown step type.`);
        if(st.type==='choice' && !st.options?.length) errors.push(`${key} / ${id}: add at least one customer choice.`);
        for(const edge of edges(st)) if(!edge.target || !own(wf.states,edge.target)) errors.push(`${key} / ${id}: a path points to a missing step.`);
        if(st.type==='collect') {
          const field=typeof st.field==='string'?st.field:st.field?.name;
          if(!field || !safeId(field)) errors.push(`${key} / ${id}: enter a valid data field name.`);
          if(used.has(field)) warnings.push(`${key} / ${id}: the field ${field} is collected more than once.`);
          used.add(field);
        }
      }
      const reached=new Set(),pending=[wf.initialState];
      while(pending.length){const id=pending.pop();if(reached.has(id)||!own(wf.states,id))continue;reached.add(id);edges(wf.states[id]).forEach(e=>pending.push(e.target));}
      for(const id of Object.keys(wf.states)) if(!reached.has(id)) warnings.push(`${key} / ${id}: this step cannot be reached from the start.`);
      if(wf.executionLimit?.mode==='custom' && !(Number.isInteger(wf.executionLimit.maxExecutions)&&wf.executionLimit.maxExecutions>0)) errors.push(`${key}: the execution limit must be a positive whole number.`);
      if(wf.outcome&&wf.outcome.type!==undefined) {
        if(!['BOOKING_CONFIRMED','ORDER_CONFIRMED','none'].includes(wf.outcome.type)) errors.push(`${key}: unknown outcome type.`);
        if(wf.outcome.type==='ORDER_CONFIRMED'&&wf.outcome.valueField&&!used.has(wf.outcome.valueField))
          warnings.push(`${key}: the order value field "${wf.outcome.valueField}" is not collected in any step.`);
      }
      for(const [id,st] of Object.entries(wf.states)) {
        if(st.outcome) {
          if(st.type!=='end') errors.push(`${key} / ${id}: outcome overrides are only allowed on end steps.`);
          if(!['BOOKING_CONFIRMED','ORDER_CONFIRMED','none'].includes(st.outcome.type)) errors.push(`${key} / ${id}: unknown outcome type.`);
          if(st.outcome.type==='ORDER_CONFIRMED'&&st.outcome.valueField&&!used.has(st.outcome.valueField))
            warnings.push(`${key} / ${id}: the order value field "${st.outcome.valueField}" is not collected in any step.`);
        }
      }
    }
    const ids=new Set();
    for(const intent of intents) {
      if(!intent.id?.trim() || ids.has(intent.id)) errors.push('Intent IDs must be nonempty and unique.');
      ids.add(intent.id);
      if(intent.workflowId&&!own(workflows,intent.workflowId)) errors.push(`${intent.id}: linked workflow is missing.`);
    }
    return {errors,warnings};
  }
  function renameState(wf,from,to) {
    if(from===to)return;
    if(!safeId(to)||own(wf.states,to)) throw Error('Choose a unique step ID using letters, numbers, underscores or hyphens.');
    wf.states=Object.fromEntries(Object.entries(wf.states).map(([id,state])=>[id===from?to:id,id===from?{...state,id:to}:state]));
    if(wf.initialState===from)wf.initialState=to;
    for(const state of Object.values(wf.states)) {
      if(state.next===from)state.next=to;
      for(const option of state.options||[])if(option.next===from)option.next=to;
      for(const transition of state.transitions||[])if(transition.target===from)transition.target=to;
    }
  }
  function template(kind,id) {
    const wf={id,name:'New workflow',description:'',initialState:'start',activation:{mode:'explicit_intent',keywords:[],allowManualStart:true},allowInterruption:true,executionLimit:{mode:'unlimited'},states:{start:{type:'end',name:'Finish',prompt:'How can we help?'}}};
    if(kind==='triage') Object.assign(wf,{name:'Sales and support',description:'Route customers to product answers or human assistance.',states:{
      start:{name:'Choose a topic',type:'choice',prompt:{en:'How can we help?',fr:'Comment pouvons-nous vous aider ?',darija:'Kifach n9dro n3awnok?'},options:[{label:'Products / Produits',next:'products'},{label:'Support',next:'support'}]},
      products:{name:'Product questions',type:'rag',prompt:'Answer the customer using the business catalog and knowledge.'},
      support:{name:'Human assistance',type:'handoff',prompt:{en:'I will pass your request to our team.',fr:'Je transmets votre demande à notre équipe.'}}
    }});
    if(kind==='lead') Object.assign(wf,{name:'Contact request',description:'Collect a name and phone number, then confirm the request.',states:{
      start:{name:'Customer name',type:'collect',prompt:{en:'What is your name?',fr:'Quel est votre nom ?',darija:'Chno smitek?'},field:{name:'fullName',type:'string',required:true},next:'phone'},
      phone:{name:'Phone number',type:'collect',prompt:{en:'What phone number can we reach you on?',fr:'Quel est votre numéro de téléphone ?'},field:{name:'phone',type:'phone',required:true},next:'confirm'},
      confirm:{name:'Confirm details',type:'confirm',prompt:{en:'Please confirm:\n{{summary}}',fr:'Confirmez ces informations :\n{{summary}}'},confirmKeywords:['yes','oui','ah'],cancelKeywords:['no','non','la'],transitions:[{target:'done'}]},
      done:{name:'Complete',type:'end',prompt:{en:'Thank you for your request.',fr:'Merci pour votre demande.'}}
    }});
    if(kind==='cod') Object.assign(wf,{name:'Cash on delivery order',description:'Starts on a buying signal; collect the details, test, then publish.',activation:{mode:'explicit_intent',intents:['BUY_INTENT'],keywords:[],allowManualStart:true},states:{
      start:{name:'Product',type:'collect',prompt:{en:'Which product would you like to order?',fr:'Quel produit souhaitez-vous commander ?',ar:'ما المنتج الذي تريد طلبه؟',darija:'Achmen produit bghiti tcommandi?',darija_arabic:'أشنو المنتوج اللي بغيتي تكوموندي؟'},field:{name:'product',type:'string',required:true},next:'quantity'},
      quantity:{name:'Quantity',type:'collect',prompt:{en:'How many would you like?',fr:'Quelle quantité souhaitez-vous ?',ar:'كم قطعة تريد؟',darija:'Chhal mn wahed bghiti?',darija_arabic:'شحال من وحدة بغيتي؟'},field:{name:'quantity',type:'number',required:true,min:1},next:'customer_name'},
      customer_name:{name:'Customer name',type:'collect',prompt:{en:'What name should we put on the order?',fr:'Quel nom mettre sur la commande ?',ar:'ما الاسم الذي نضعه على الطلب؟',darija:'Chno smiya dyalk f commande?',darija_arabic:'شنو السمية ديالك فالكوموند؟'},field:{name:'customer_name',type:'string',required:true},next:'phone'},
      phone:{name:'Phone',type:'collect',prompt:{en:'What phone number can our team reach?',fr:'À quel numéro pouvons-nous vous joindre ?',ar:'ما رقم الهاتف الذي يمكن لفريقنا التواصل معك عبره؟',darija:'Chno raqm téléphone bach ntwaslo m3ak?',darija_arabic:'شنو النمرة اللي نقدروا نتواصلوا معاك فيها؟'},field:{name:'phone',type:'phone',required:true},next:'city'},
      city:{name:'Delivery city',type:'collect',prompt:{en:'Which city should we deliver to?',fr:'Dans quelle ville faut-il livrer ?',ar:'إلى أي مدينة تريد التوصيل؟',darija:'Lachmen mdina nsifto livraison?',darija_arabic:'لأشمن مدينة بغيتي نوصلوا الكوموند؟'},field:{name:'city',type:'string',required:true},next:'address'},
      address:{name:'Delivery address',type:'collect',prompt:{en:'What is your full delivery address?',fr:'Quelle est votre adresse complète de livraison ?',ar:'ما عنوان التوصيل الكامل؟',darija:'Chno l3onwan kamel dyal livraison?',darija_arabic:'شنو العنوان كامل ديال التوصيل؟'},field:{name:'address',type:'string',required:true},next:'confirm'},
      confirm:{name:'Review order',type:'confirm',prompt:{en:'Please confirm these order details for cash on delivery:\n{{summary}}',fr:'Confirmez ces détails pour le paiement à la livraison :\n{{summary}}',ar:'يرجى تأكيد تفاصيل الطلب للدفع عند الاستلام:\n{{summary}}',darija:'3afak 2akked had tafasil dyal paiement 3nd livraison:\n{{summary}}',darija_arabic:'عفاك أكد تفاصيل الكوموند ديال الخلاص عند التوصيل:\n{{summary}}'},confirmKeywords:['yes','oui','نعم','ah','wakha','واخا','ايه','إيه'],cancelKeywords:['no','non','لا','la','lla'],transitions:[{target:'done'}]},
      done:{name:'Request received',type:'end',prompt:{en:'Thank you. Our team will review your order and contact you to confirm it.',fr:'Merci. Notre équipe vérifiera votre commande et vous contactera pour la confirmer.',ar:'شكراً. سيراجع فريقنا طلبك ويتواصل معك لتأكيده.',darija:'Chokran. Lfar9 ghayraja3 commande o ghaytwasel m3ak bach y2akkedha.',darija_arabic:'شكراً. الفريق غادي يراجع الكوموند ويتواصل معاك باش يأكدها.'}}
    }});
    if(kind==='sales'){
      const ask=(name,next,prompt,extra={})=>({name,type:'collect',prompt,next,...extra});
      const open=field=>({field:{name:field,type:'string',required:true,acceptAnyReply:true}});
      Object.assign(wf,{name:'Sales conversation & demo booking',description:'Gets to know the customer, explains how the business helps, then books a demo in the calendar.',initialState:'start',calendarBooking:true,
        activation:{mode:'explicit_intent',keywords:['demo','book a demo','je veux une démo','bghit demo','بغيت ديمو','أريد ديمو'],allowManualStart:true},outcome:{createLead:true},states:{
        start:ask('Customer name','business',{en:'Hi and welcome! 👋😊\nTo understand how we can help you, what’s your name?',fr:'Bonjour et bienvenue ! 👋😊\nPour comprendre comment vous aider, quel est votre prénom ?',ar:'مرحباً بك! 👋😊\nلنفهم كيف يمكننا مساعدتك، ما اسمك؟',darija:'سلام ومرحبا بيك! 👋😊\nباش نفهم كيفاش نقدرو نعاونوك، ممكن نعرف شنو سميتك؟'},{field:{name:'fullName',type:'string',semanticType:'person_name',required:true}}),
        business:ask('Business','channels',{en:'Nice to meet you, {{fullName}}! 🙌\nWhat does your business do? What exactly do you sell?',fr:'Enchanté {{fullName}} ! 🙌\nQuelle est votre activité ? Que vendez-vous exactement ?',ar:'أهلاً {{fullName}}! تشرفنا 🙌\nما هو نشاطك التجاري؟ ماذا تبيع بالضبط؟',darija:'مرحبا بيك {{fullName}}! تشرفنا 🙌\nقولي، شنو هو النشاط التجاري ديالك؟ شنو كتبيع بالضبط؟'},open('businessType')),
        channels:ask('Channels','problem',{en:'Great! 👌\nWhere do most of your customers’ messages come in? WhatsApp, Instagram, or both?',fr:'Très bien ! 👌\nOù recevez-vous la plupart des messages de vos clients ? WhatsApp, Instagram, ou les deux ?',ar:'رائع! 👌\nأين تصلك معظم رسائل عملائك؟ في واتساب، إنستغرام، أم في الاثنين؟',darija:'زوين بزاف! 👌\nوفين كيوصلوك أغلب الميساجات ديال الكليان ديالك؟ فالواتساب، الإنستغرام، ولا بجوج؟'},open('channels')),
        problem:ask('Main problem','volume',{en:'Got it, {{fullName}} 👍\nRight now, can you answer everyone on time, or do some messages wait too long?',fr:'Je vois, {{fullName}} 👍\nAujourd’hui, arrivez-vous à répondre à tout le monde à temps, ou certains messages attendent ?',ar:'فهمتك يا {{fullName}} 👍\nهل تستطيع الرد على الجميع في الوقت المناسب، أم أن بعض الرسائل يتأخر الرد عليها؟',darija:'فهمتك {{fullName}} 👍\nدابا ملي كيوصلوك الميساجات، واش كتقدر تجاوب على الجميع فوقتهم، ولا كاينين شي ميساجات كيتأخرو؟'},open('mainProblem')),
        volume:ask('Messages per day','demo_day',{en:'To give you a fitting idea, roughly how many messages do you get per day?',fr:'Pour vous donner une idée adaptée, combien de messages recevez-vous à peu près par jour ?',ar:'لنعطيك فكرة مناسبة، كم رسالة تصلك تقريباً في اليوم؟',darija:'باش نعطيك فكرة مناسبة للبيزنس ديالك، تقريباً شحال من ميساج كيوصلك فالنهار؟'},open('dailyMessages')),
        demo_day:ask('Demo day','demo_time',{en:'How about a short call with our team to show you a demo, explain the price and how you’d benefit?\nWhich day suits you? Today, tomorrow, or another day?',fr:'Que diriez-vous d’un court rendez-vous avec notre équipe pour une démo, le prix et comment en profiter ?\nQuel jour vous convient ? Aujourd’hui, demain, ou un autre jour ?',ar:'ما رأيك أن نحجز لك موعداً قصيراً مع فريقنا، يعرض عليك فيه Demo ويشرح لك السعر وكيف تستفيد؟\nما اليوم المناسب لك؟ اليوم، غداً، أم يوم آخر؟',darija:'شنو رأيك نحجزو ليك واحد الموعد قصير مع الفريق ديالنا، يوريك فيه Demo ويشرح ليك الثمن وكيفاش تقدر تستافد؟\nشنو النهار اللي يناسبك؟ اليوم، غدا، ولا نهار آخر؟'},{calendar:'day',pitch:true,field:{name:'demoDay',type:'string',required:true}}),
        demo_time:ask('Demo time','email',{en:'What time suits you?',fr:'Quelle heure vous convient ?',ar:'ما الوقت المناسب لك؟',darija:'شنو الوقت اللي يناسبك؟'},{calendar:'slots',field:{name:'demoSlot',type:'string',required:true}}),
        email:ask('Email','done',{en:'Perfect! 👌\nCould you share your email so we can send you the confirmation?',fr:'Parfait ! 👌\nPouvez-vous me donner votre e-mail pour vous envoyer la confirmation ?',ar:'ممتاز! 👌\nهل يمكنك إعطائي بريدك الإلكتروني لنرسل لك تأكيد الموعد؟',darija:'ممتاز! 👌\nممكن تعطيني الإيميل ديالك باش نصيفطو ليك تأكيد الموعد؟'},{field:{name:'email',type:'email',required:true}}),
        // Shown when the calendar did not book the time itself: it never says "confirmed".
        done:{name:'Thank you',type:'end',prompt:{en:'Thanks for your trust, {{fullName}}! 🚀\nYour demo request is noted. Our team will contact you to confirm.',fr:'Merci pour votre confiance, {{fullName}} ! 🚀\nVotre demande de démo est notée. Notre équipe vous contacte pour confirmer.',ar:'شكراً على ثقتك يا {{fullName}}! 🚀\nسجلنا طلب العرض. سيتواصل معك فريقنا لتأكيد الموعد.',darija:'شكراً على الثقة ديالك، {{fullName}}! 🚀\nسجلنا طلب الديمو ديالك. الفريق غادي يتواصل معاك باش يأكد الموعد.'}}
      }});
    }
    if(kind==='feedback') Object.assign(wf,{name:'Feedback',description:'Collect customer feedback.',states:{
      start:{name:'Feedback',type:'collect',prompt:{en:'What could we improve?',fr:'Que pouvons-nous améliorer ?'},field:{name:'feedback',type:'string',required:true},next:'done'},
      done:{name:'Thank you',type:'end',prompt:{en:'Thank you for your feedback.',fr:'Merci pour votre retour.'}}
    }});
    return wf;
  }
  const TYPE_LABELS={collect:'Ask a question',choice:'Offer choices',confirm:'Confirm details',message:'Send a message',rag:'Answer from knowledge',handoff:'Pass to the team',end:'Finish'};
  const firstText=prompt=>{const p=typeof prompt==='string'?prompt:prompt?.en||prompt?.darija||prompt?.fr||prompt?.ar||Object.values(prompt||{})[0]||'';return String(p).split('\n').find(line=>line.trim())||'';};
  function mount({area,template:base={},notify=()=>{},calendarStatus=null}) {
    let selected,step,bindings=[],serial=0,tab='steps',linked=calendarStatus;
    const host=document.createElement('article');host.id='workflow-editor';host.className='card workflow-editor';
    document.querySelector('#technical').after(host);
    const read=()=>JSON.parse(area.value);
    const effective=cfg=>({workflows:cfg.workflows??base.workflows??{},intents:cfg.capabilities?.intents??base.capabilities?.intents??[],calendar:cfg.calendar??base.calendar??{}});
    // Every account has the built-in calendar; it only stops booking when the client pauses it.
    const calendarFor=cfg=>linked?{enabled:linked.enabled!==false,calendarId:'relayqo'}:effective(cfg).calendar;
    function change(fn,redraw=false) {
      try {
        const cfg=read(),e=effective(cfg);
        cfg.workflows=copy(e.workflows);
        cfg.capabilities={...cfg.capabilities,intents:copy(e.intents)};
        fn(cfg.workflows,cfg.capabilities.intents,cfg);
        area.value=JSON.stringify(cfg,null,2);area.dispatchEvent(new Event('input',{bubbles:true}));
        if(redraw)render();else check();
      } catch(e){notify(e.message,true);}
    }
    function field(label,value,update,{type='text',options,full=false,hint=''}={}) {
      const id='wf-control-'+serial++;
      bindings.push(()=>{const el=host.querySelector('#'+id);el[type==='select'||type==='checkbox'?'onchange':'oninput']=()=>update(type==='checkbox'?el.checked:type==='number'?(el.value===''?undefined:Number(el.value)):el.value);});
      let input;
      if(type==='checkbox')return `<label class="admin-setting-toggle workflow-check ${full?'full':''}" for="${id}"><input id="${id}" type="checkbox" ${value?'checked':''}><span><strong>${esc(label)}</strong>${hint?`<small>${esc(hint)}</small>`:''}</span></label>`;
      if(type==='textarea')input=`<textarea id="${id}" dir="auto">${esc(value)}</textarea>`;
      else if(type==='select')input=`<select id="${id}">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===value?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
      else input=`<input id="${id}" type="${type}" value="${esc(value)}" ${type==='number'?'step="any"':'dir="auto"'}>`;
      return `<div class="field ${full?'full':''}"><label for="${id}">${esc(label)}</label>${input}${hint?`<span class="hint">${esc(hint)}</span>`:''}</div>`;
    }
    function button(label,fn,kind='secondary',html='') {
      const id='wf-action-'+serial++;bindings.push(()=>host.querySelector('#'+id).onclick=fn);
      return `<button type="button" class="btn ${kind}" id="${id}" ${html?`aria-label="${esc(label)}"`:''}>${html||esc(label)}</button>`;
    }
    function choices(label,options,selectedValues,update,hint='') {
      const name='wf-choice-'+serial++;
      bindings.push(()=>{const boxes=[...host.querySelectorAll(`input[name="${name}"]`)];boxes.forEach(b=>b.onchange=()=>update(boxes.filter(x=>x.checked).map(x=>x.value)));});
      return `<fieldset class="field full workflow-choices"><legend>${esc(label)}</legend><div class="check-options">${options.map(o=>`<label><input type="checkbox" name="${name}" value="${esc(o.value)}" ${selectedValues.includes(o.value)?'checked':''}><span dir="auto">${esc(o.label)}</span></label>`).join('')||'<span class="hint">Nothing to choose yet.</span>'}</div>${hint?`<span class="hint">${esc(hint)}</span>`:''}</fieldset>`;
    }
    function localized(label,value,update,open=false) {
      const obj=typeof value==='string'?{en:value}:value||{};
      const langs=['en','fr','ar','darija'],filled=langs.filter(lang=>obj[lang]).length;
      return `<details class="field full workflow-localized" ${filled||open?'open':''}><summary><span>${esc(label)}</span><small>${filled?`${filled}/4 languages`:'Optional · default text is used'}</small></summary><div class="form-grid">${langs.map(lang=>field({en:'English',fr:'French',ar:'Arabic',darija:'Darija'}[lang],obj[lang]||'',v=>{obj[lang]=v;update({...obj});},{type:'textarea'})).join('')}</div></details>`;
    }
    const more=(label,body)=>body?`<details class="field full workflow-more"><summary>${esc(label)}</summary><div class="form-grid">${body}</div></details>`:'';
    const group=(title,text,body)=>`<section class="workflow-group"><div class="workflow-group-head"><h3>${esc(title)}</h3><p>${esc(text)}</p></div><div class="form-grid">${body}</div></section>`;

    function stepEditor(wf,id,st,targets,collectedFields,update) {
      const edit=(fn,redraw=false)=>update(w=>fn(w.states[id],w),redraw);
      const fieldOptions=[{value:'',label:'Select collected field'},...collectedFields.map(f=>({value:f,label:f}))];
      let main=field('Step name',st.name||st.label||id,v=>edit(s=>s.name=v))+field('What the bot does',st.type,v=>edit((s,w)=>{s.type=v;if(v==='choice'&&!s.options?.length)s.options=[{label:'Continue',next:Object.keys(w.states).find(k=>k!==id)||id}];if(v==='collect'&&!s.field)s.field={name:'customerInput',type:'string',required:true};},true),{type:'select',options:Object.entries(TYPE_LABELS).map(([value,label])=>({value,label}))})+localized('Bot message',st.prompt,v=>edit(s=>s.prompt=v),true);
      let extra='';
      if(st.type==='collect'){
        const f=typeof st.field==='string'?{name:st.field,type:'string',required:true}:st.field||{};
        const setField=(key,value,redraw=false)=>edit(s=>{s.field={...(typeof s.field==='string'?{name:s.field,type:'string',required:true}:s.field),[key]:value};},redraw);
        const meaning=f.semanticType||(/^(?:fullname|name|customername|contactname)$/i.test(f.name||'')?'person_name':'free_text');
        main+=field('Answer type',f.type||'string',v=>setField('type',v,true),{type:'select',options:[['string','Text'],['email','Email'],['phone','Phone number'],['number','Number'],['boolean','Yes / no'],['date','Date'],['time','Time'],['datetime','Date and time'],['enum','Choice from a list']].map(([value,label])=>({value,label}))})
          +field('Save answer as',f.name,v=>setField('name',v),{hint:'Short name shown in Follow-ups, for example fullName or phone.'})
          +(f.type==='string'||!f.type?field('Calendar',st.calendar||'',v=>edit(s=>{if(v){s.calendar=v;if(s.field&&typeof s.field==='object')delete s.field.acceptAnyReply;}else delete s.calendar;},true),{type:'select',options:[{value:'',label:'Not a calendar step'},{value:'day',label:'Ask the day, then offer free times'},{value:'slots',label:'Take the chosen time'}],hint:'A day step must lead straight to a time step. Times come from the client’s calendar.'}):'')
          +((f.type||'string')==='string'&&!st.calendar&&meaning!=='person_name'?field('Accept any answer',f.acceptAnyReply===true,v=>setField('acceptAnyReply',v||undefined),{type:'checkbox',hint:'For open questions (business, main problem…): any reply without a question mark is saved as the answer.'}):'')
          +(f.type==='enum'?field('List choices — one per line',(f.options||[]).join('\n'),v=>setField('options',phrases(v)),{type:'textarea',full:true}):'');
        extra+=((f.type||'string')==='string'?field('Text answer meaning',meaning,v=>setField('semanticType',v,true),{type:'select',options:[{value:'free_text',label:'Open text answer'},{value:'person_name',label:'Person name'}],hint:'Use Person name when the bot asks for a customer name; unrelated questions will not be saved as a name.'}):'')
          +field('Required',f.required!==false,v=>setField('required',v),{type:'checkbox'})
          +[['minLength','Minimum length'],['maxLength','Maximum length'],['min','Lowest value'],['max','Highest value']].map(([key,label])=>field(label,f[key],v=>setField(key,v),{type:'number'})).join('')
          +field('Validation pattern',f.pattern||f.validationRegex||'',v=>setField('pattern',v))+field('Extraction instructions',f.extractionPrompt||'',v=>setField('extractionPrompt',v),{type:'textarea'});
      }
      if(st.type==='choice')main+=`<div class="field full"><div class="section-heading"><h3>Customer choices</h3>${button('Add choice',()=>edit((s,w)=>{s.options??=[];s.options.push({label:'New choice',next:Object.keys(w.states).find(k=>k!==id)||id});},true))}</div>${(st.options||[]).map((o,i)=>`<div class="workflow-branch">${field('Choice '+(i+1)+' label',o.label,v=>edit(s=>s.options[i].label=v))}${field('Choice '+(i+1)+' next step',o.next,v=>edit(s=>s.options[i].next=v,true),{type:'select',options:[{value:'',label:'Choose a step'},...targets]})}${button('Remove choice '+(i+1),()=>edit(s=>s.options.splice(i,1),true),'danger')}</div>`).join('')}</div>`;
      if(st.type==='confirm'){main+=field('Confirmation words — one per line',(st.confirmKeywords||[]).join('\n'),v=>edit(s=>s.confirmKeywords=phrases(v)),{type:'textarea'})+field('Cancellation words — one per line',(st.cancelKeywords||[]).join('\n'),v=>edit(s=>s.cancelKeywords=phrases(v)),{type:'textarea'});extra+=localized('Cancellation message',st.cancellationPrompt,v=>edit(s=>s.cancellationPrompt=v));}
      if(st.type==='handoff')main+=field('Pause bot for (hours)',st.pauseBotHours||24,v=>edit(s=>s.pauseBotHours=Math.max(1,Number(v)||24)),{type:'number',hint:'The conversation moves to Needs reply. If nobody resolves it, bot automation resumes after this time.',full:true});
      if(!['end','handoff'].includes(st.type))main+=field('Start this step with a personalised pitch',Boolean(st.pitch),v=>edit(s=>{if(v)s.pitch=s.pitch||true;else delete s.pitch;},true),{type:'checkbox',full:true,hint:'Before this step’s message, the bot writes 2 short sentences from the customer’s answers and the business facts.'})+(st.pitch?field('Pitch instructions (optional)',typeof st.pitch==='string'?st.pitch:'',v=>edit(s=>{s.pitch=v.trim()||true;}),{type:'textarea',full:true,hint:'Example: mention that replies are 24/7 and in Darija.'}):'');
      if(!['end','handoff','choice'].includes(st.type))main+=field('Then go to',st.next||'',v=>edit(s=>{if(v)s.next=v;else delete s.next;},true),{type:'select',options:[{value:'',label:st.transitions?.length?'Use the conditional paths':'End here'},...targets],full:true});
      extra+=`<div class="field full"><span class="hint">Conditional paths (${st.transitions?.length||0}) · used for intent or condition rules; a direct “Then go to” step takes precedence for simple steps.</span>${(st.transitions||[]).map((t,i)=>`<div class="form-item form-grid">${field('Path '+(i+1)+' intent',t.intent,v=>edit(s=>s.transitions[i].intent=v))}${field('Path '+(i+1)+' condition',t.condition,v=>edit(s=>s.transitions[i].condition=v))}${field('Path '+(i+1)+' goes to',t.target,v=>edit(s=>s.transitions[i].target=v,true),{type:'select',options:[{value:'',label:'Choose a step'},...targets]})}${field('Default path '+(i+1),t.default===true,v=>edit(s=>s.transitions[i].default=v),{type:'checkbox'})}${button('Remove path '+(i+1),()=>edit(s=>s.transitions.splice(i,1),true),'danger')}</div>`).join('')}${button('Add conditional path',()=>edit((s,w)=>{s.transitions??=[];s.transitions.push({target:Object.keys(w.states).find(k=>k!==id)||id});},true))}</div>`;
      if(st.type==='end'){
        const t=st.outcome===undefined?'inherit':(st.outcome?.type||'none');
        extra+=field('Result recorded at this end',t,v=>edit(s=>{if(v==='inherit')delete s.outcome;else if(v==='none')s.outcome={type:'none'};else if(v==='BOOKING_CONFIRMED')s.outcome={type:'BOOKING_CONFIRMED'};else s.outcome={type:'ORDER_CONFIRMED',valueField:collectedFields[0]||''};},true),{type:'select',options:[{value:'inherit',label:'Same as the workflow'},{value:'none',label:'None'},{value:'BOOKING_CONFIRMED',label:'Booking confirmed'},{value:'ORDER_CONFIRMED',label:'Order confirmed'}]})
          +(t==='ORDER_CONFIRMED'?field('Order value field',st.outcome?.valueField||'',v=>edit(s=>{s.outcome.valueField=v;}),{type:'select',options:fieldOptions})+field('Order currency field',st.outcome?.currencyField||'',v=>edit(s=>{if(v)s.outcome.currencyField=v;else delete s.outcome.currencyField;}),{type:'select',options:[{value:'',label:'Default business currency'},...collectedFields.map(f=>({value:f,label:f}))]}):'');
      }
      extra+=`<div class="field full"><span class="hint">Step ID: ${esc(id)}</span>${button('Rename step ID',()=>{const next=prompt('New step ID',id);if(next)update(w=>{renameState(w,id,next);step=next;},true);})}</div>`;
      const actions=`<div class="collection-item-actions">${id===wf.initialState?'':button('Make this the first step',()=>update(w=>w.initialState=id,true))}${button('Delete step',()=>{const refs=Object.entries(wf.states).filter(([other,s])=>other!==id&&edges(s).some(e=>e.target===id));if(wf.initialState===id||refs.length){notify('Change the first step and the steps that lead here before deleting this step.',true);return;}update(w=>{delete w.states[id];step=null;},true);},'danger')}</div>`;
      return `<div class="form-grid">${main}${more('More options',extra)}</div>${actions}`;
    }

    function stepsTab(wf,targets,collectedFields,update) {
      const ids=orderedSteps(wf);
      const cards=ids.map((id,n)=>{
        const st=wf.states[id],open=id===step;
        const nextNames=edges(st).map(e=>wf.states[e.target]?.name||e.target).filter(Boolean);
        const badges=[id===wf.initialState?'First step':'',st.calendar==='day'?'Calendar · day':st.calendar==='slots'?'Calendar · time':'',st.pitch?'Pitch':'',st.type==='collect'&&st.field?.acceptAnyReply?'Any answer':''].filter(Boolean);
        const toggle='wf-step-'+serial++;
        bindings.push(()=>{const el=host.querySelector('#'+toggle);el.ontoggle=()=>{if(el.open&&step!==id){step=id;render();}else if(!el.open&&step===id){step=null;}};});
        return `<details class="card collection-item workflow-step-card" id="${toggle}" ${open?'open':''}><summary><span class="collection-index">${n+1}</span><strong dir="auto">${esc(st.name||id)}</strong><span class="workflow-step-badges"><small>${esc(TYPE_LABELS[st.type]||st.type)}</small>${badges.map(b=>`<small>${esc(b)}</small>`).join('')}</span>${open?'':`<span class="workflow-step-summary" dir="auto">${esc(firstText(st.prompt).slice(0,140))}${nextNames.length?` <em>→ ${esc(nextNames.join(', '))}</em>`:''}</span>`}</summary>${open?stepEditor(wf,id,st,targets,collectedFields,update):''}</details>`;
      }).join('');
      return `<div class="collection-list workflow-step-cards">${cards}</div><div class="actions">${button('Add step',()=>update(w=>{const id='step_'+crypto.randomUUID().slice(0,8);const last=orderedSteps(w).filter(k=>w.states[k].type!=='end').pop();w.states[id]={name:'New step',type:'collect',prompt:'',field:{name:'answer_'+id.slice(5),type:'string',required:true},next:last?w.states[last].next:undefined};if(!w.states[id].next)delete w.states[id].next;if(last&&w.states[last].next!==undefined&&!['choice'].includes(w.states[last].type))w.states[last].next=id;step=id;},true))}</div>`;
    }

    function startFinishTab(wf,intents,collectedFields,targets,update) {
      const outcomeType=wf.outcome?.type||'none';
      const basics=field('Workflow name',wf.name,v=>update(w=>w.name=v))+field('First step',wf.initialState,v=>update(w=>w.initialState=v,true),{type:'select',options:targets})+field('Description',wf.description,v=>update(w=>w.description=v),{type:'textarea',full:true});
      const starts=field('Starts',wf.activation?.mode||'explicit_intent',v=>update(w=>w.activation={...w.activation,mode:v}),{type:'select',options:[{value:'explicit_intent',label:'When the customer says a trigger phrase or goal'},{value:'auto_start',label:'Automatically, on the first message'}]})+'<span class="field workflow-spacer"></span>'
        +field('Trigger phrases — one per line',(wf.activation?.keywords||[]).join('\n'),v=>update(w=>w.activation={...w.activation,keywords:phrases(v)}),{type:'textarea',hint:'Examples: bghit ncommandi, commander, book a demo.'})
        +choices('Also start when the AI recognises',intents.map(x=>({value:x.id,label:(x.description||x.id).length>70?(x.description||x.id).slice(0,68)+'…':(x.description||x.id)})),wf.activation?.intents||[],v=>update(w=>{const known=intents.map(x=>x.id);w.activation={...w.activation,intents:[...v,...(w.activation?.intents||[]).filter(x=>!known.includes(x))]};}),'Customer goals are managed in the Customer goals tab.');
      const finishes=field('Create a follow-up in the CRM',wf.outcome?.createLead===true,v=>update(w=>w.outcome={...w.outcome,createLead:v},true),{type:'checkbox',hint:'Saves the collected answers in Today and Follow-ups.'})
        +field('Book the chosen time in the calendar',wf.calendarBooking===true,v=>update(w=>{if(v)w.calendarBooking=true;else delete w.calendarBooking;},true),{type:'checkbox',hint:'Uses the calendar day and time steps. The bot says the booking is confirmed only after it is in the client’s calendar.'})
        +field('Pass the conversation to the team',wf.outcome?.requestHumanHandoff===true,v=>update(w=>w.outcome={...w.outcome,requestHumanHandoff:v},true),{type:'checkbox',hint:'Stops automatic replies and places the conversation in Needs reply.'})
        +(wf.outcome?.requestHumanHandoff===true?field('Pause bot for (hours)',wf.outcome?.pauseBotHours||24,v=>update(w=>w.outcome={...w.outcome,pauseBotHours:v}),{type:'number'}):'');
      const advanced=field('The team can start it from the inbox',wf.activation?.allowManualStart!==false,v=>update(w=>w.activation={...w.activation,allowManualStart:v}),{type:'checkbox'})
        +field('Customers can ask questions mid-way',wf.allowInterruption!==false,v=>update(w=>w.allowInterruption=v),{type:'checkbox',hint:'The bot answers, then goes back to the current step.'})
        +field('Result to track',outcomeType,v=>update(w=>{const {type:_t,valueField:_v,currencyField:_c,...rest}=w.outcome||{};if(v==='none'){if(Object.keys(rest).length)w.outcome=rest;else delete w.outcome;}else if(v==='BOOKING_CONFIRMED')w.outcome={...rest,type:v};else w.outcome={...rest,type:v,valueField:collectedFields[0]||''};},true),{type:'select',options:[{value:'none',label:'No business result'},{value:'BOOKING_CONFIRMED',label:'Booking confirmed'},{value:'ORDER_CONFIRMED',label:'Order confirmed'}]})
        +(outcomeType==='ORDER_CONFIRMED'?field('Order value field',wf.outcome?.valueField||'',v=>update(w=>{w.outcome.valueField=v;}),{type:'select',options:[{value:'',label:'Select collected field'},...collectedFields.map(f=>({value:f,label:f}))]})+field('Order currency field',wf.outcome?.currencyField||'',v=>update(w=>{if(v)w.outcome.currencyField=v;else delete w.outcome.currencyField;}),{type:'select',options:[{value:'',label:'Default business currency'},...collectedFields.map(f=>({value:f,label:f}))]}):'')
        +(wf.outcome?.createLead===true?field('Allow another request while one is open',wf.outcome?.allowConcurrentOpenRequests===true,v=>update(w=>w.outcome={...w.outcome,allowConcurrentOpenRequests:v},true),{type:'checkbox',hint:'Leave off to avoid duplicate requests until the team marks the first one done.'}):'')
        +(wf.outcome?.createLead===true&&wf.outcome?.allowConcurrentOpenRequests!==true?localized('Message when a request is already open',wf.outcome?.openRequestMessage,v=>update(w=>w.outcome={...w.outcome,openRequestMessage:v})):'')
        +field('How often it can run',wf.executionLimit?.mode||'unlimited',v=>update(w=>w.executionLimit={...w.executionLimit,mode:v,...(v==='custom'&&!w.executionLimit?.maxExecutions?{maxExecutions:2}:{})},true),{type:'select',options:[{value:'unlimited',label:'Unlimited'},{value:'once',label:'Once per conversation'},{value:'custom',label:'Custom limit'}]})
        +(wf.executionLimit?.mode==='custom'?field('Maximum runs',wf.executionLimit.maxExecutions,v=>update(w=>w.executionLimit.maxExecutions=v),{type:'number'}):'')
        +(wf.executionLimit?.mode&&wf.executionLimit.mode!=='unlimited'?localized('Message when the limit is reached',wf.executionLimit?.limitReachedMessage,v=>update(w=>w.executionLimit={...w.executionLimit,limitReachedMessage:v})):'');
      return group('Basics','Name, purpose and first step.',basics)+group('When it starts','What opens this workflow.',starts)+group('When it finishes','What happens with the answers.',finishes)+`<div class="workflow-group">${more('More options',advanced)}</div>`;
    }

    function calendarTab() {
      const st=linked,set=st?.settings||{},g=st?.google;
      const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const state=!st?'<p class="notice">Calendar status could not be loaded.</p>'
        :st.enabled===false?'<p class="notice warning">The client paused bookings. Calendar steps ask the day and time as plain questions and the team confirms.</p>'
        :`<p class="notice">Bookings go to this client’s Relayqo calendar. ${st.upcomingBookings} upcoming ${st.upcomingBookings===1?'booking':'bookings'}.</p>`;
      const summary=`<p class="small muted">Times offered: ${esc((set.slotTimes||['10:00','12:00','14:00','16:00','18:00']).join(', '))} · ${esc((set.workingDays||[1,2,3,4,5,6]).map(d=>days[d]).join(', '))} · ${esc(set.durationMinutes||30)} min.</p>`;
      const sync=g?.configured&&g.connection?`<p class="small muted">Also synced with Google Calendar: ${esc(g.connection.calendarName||'calendar not chosen yet')} (${esc(g.connection.email||'')})${g.connection.status!=='CONNECTED'?' · needs to be reconnected':''}.</p>`:'';
      return group('Calendar','Every client has a built-in calendar. The client sets the times customers can book, and sees and cancels bookings, on the Calendar page of their portal. You only add calendar day and time steps to the workflow.',`<div class="field full">${state}${st?summary+sync:''}</div>`);
    }

    function goalsTab(workflows,intents,keys) {
      return `<div class="section-heading"><div><h3>Customer goals</h3><p>Goals the AI recognises, and the workflow each one opens.</p></div>${button('Add customer goal',()=>change((_w,i)=>i.push({id:'INTENT_'+crypto.randomUUID().slice(0,8),description:'',keywords:[]}),true))}</div><div class="collection-list">${intents.map((intent,i)=>`<details class="card collection-item"><summary><span class="collection-index">${i+1}</span><strong dir="auto">${esc(intent.description||intent.id)}</strong><small>${esc(intent.workflowId?(workflows[intent.workflowId]?.name||intent.workflowId):'Normal answer')}</small></summary><div class="form-grid">${field('What the customer wants',intent.description,v=>change((_w,list)=>list[i].description=v),{type:'textarea',hint:'Plain words. The AI reads this to recognise the goal.'})}${field('Opens workflow',intent.workflowId||'',v=>change((_w,list)=>{if(v)list[i].workflowId=v;else delete list[i].workflowId;},true),{type:'select',options:[{value:'',label:'Normal chatbot answer'},...keys.map(value=>({value,label:workflows[value].name||value}))]})}${choices('Purpose',[['PURCHASE','Buying'],['DEMO','Demo'],['BOOKING','Booking'],['HUMAN_SUPPORT','Talk to a person']].map(([value,label])=>({value,label})),intent.useCases||[],v=>change((_w,list)=>{if(v.length)list[i].useCases=[...new Set(v)];else delete list[i].useCases;}))}${more('More options',field('Extra phrases — one per line',(intent.keywords||[]).join('\n'),v=>change((_w,list)=>list[i].keywords=phrases(v)),{type:'textarea'})+field('Internal name',intent.id,v=>change((w,list)=>{const old=list[i].id;list[i].id=v;Object.values(w).forEach(wf=>{if(wf.activation?.intents)wf.activation.intents=wf.activation.intents.map(x=>x===old?v:x);Object.values(wf.states).forEach(s=>(s.transitions||[]).forEach(t=>{if(t.intent===old)t.intent=v;}));});}),{hint:'Used by the system; letters, numbers and _ only.'}))}</div><div class="collection-item-actions">${button('Remove goal',()=>change((w,list)=>removeIntent(w,list,i),true),'danger')}</div></details>`).join('')||'<p class="empty">No customer goals yet.</p>'}</div>`;
    }

    function render() {
      let cfg;try{cfg=read();}catch{host.innerHTML='<p class="notice error">Correct the advanced JSON before editing workflows.</p>';return;}
      const {workflows,intents}=effective(cfg),keys=Object.keys(workflows);
      selected=keys.includes(selected)?selected:keys[0];
      const wf=workflows[selected];if(wf&&step&&!own(wf.states,step))step=null;
      bindings=[];serial=0;
      const add=kind=>{const id=(kind==='cod'?'checkout_':'workflow_')+crypto.randomUUID().slice(0,8);change(w=>{w[id]=template(kind,id);selected=id;step=null;tab='steps';},true);};
      const templateSelect='wf-template-'+serial++;
      bindings.push(()=>{const el=host.querySelector('#'+templateSelect);el.onchange=()=>{if(el.value)add(el.value);};});
      let html=`<div class="section-heading"><div><h2>Guided workflows</h2><p>Conversations the chatbot leads step by step: questions, choices, bookings and forms.</p></div><div class="actions"><select id="${templateSelect}" class="workflow-template-select" aria-label="Add from a template"><option value="">Add from a template…</option><option value="sales">Sales & demo booking</option><option value="lead">Contact request</option><option value="cod">Cash on delivery</option><option value="triage">Sales & support</option><option value="feedback">Feedback</option></select>${button('Add empty workflow',()=>add('blank'))}</div></div><div id="workflow-diagnostics" aria-live="polite"></div>`;
      if(wf){
        const update=(fn,redraw=false)=>change(w=>fn(w[selected]),redraw);
        const stepNames=Object.values(wf.states).map(s=>s.name);
        const targets=orderedSteps(wf).map(id=>[id,wf.states[id]]).map(([id,s])=>({value:id,label:(s.name||id)+(s.name&&stepNames.filter(n=>n===s.name).length>1?' ('+id+')':'')}));
        const collectedFields=Object.values(wf.states).filter(s=>s.type==='collect').map(s=>typeof s.field==='string'?s.field:s.field?.name).filter(Boolean);
        html+=`<div class="workflow-picker">${field('Workflow',selected,v=>{selected=v;step=null;render();},{type:'select',options:keys.map(key=>({value:key,label:workflows[key].name||key}))})}<div class="actions">${button('Duplicate',()=>change(w=>{const id='workflow_'+crypto.randomUUID().slice(0,8);w[id]={...copy(w[selected]),id,name:(w[selected].name||selected)+' copy'};selected=id;},true))}${button('Delete workflow',()=>{if(confirm('Remove this workflow from the account configuration? Linked goals will use normal answers.'))change((w,i)=>{delete w[selected];i.forEach(intent=>{if(intent.workflowId===selected)delete intent.workflowId;});selected=null;},true);},'danger')}</div></div>`;
        const tabs=[['steps','Steps',Object.keys(wf.states).length],['start','Start & finish'],['calendar','Calendar'],['goals','Customer goals',intents.length]];
        html+=`<div class="section-tabs workflow-tabs" role="tablist">${tabs.map(([key,label,count])=>{const id='wf-tab-'+serial++;bindings.push(()=>host.querySelector('#'+id).onclick=()=>{tab=key;render();});return `<button type="button" role="tab" id="${id}" aria-selected="${tab===key}"><span>${esc(label)}</span>${count===undefined?'':` <small>${count}</small>`}</button>`;}).join('')}</div>`;
        html+=`<div class="section-panel" role="tabpanel">${tab==='steps'?stepsTab(wf,targets,collectedFields,update):tab==='start'?startFinishTab(wf,intents,collectedFields,targets,update):tab==='calendar'?calendarTab():goalsTab(workflows,intents,keys)}</div>`;
      }else html+=`<p class="empty">No workflows yet. Add one from a template.</p>${goalsTab(workflows,intents,keys)}`;
      host.innerHTML=html;bindings.forEach(bind=>bind());check();
    }
    function check() {
      const cfg=read(),{workflows,intents}=effective(cfg);
      const result=diagnostics(workflows,intents,calendarFor(cfg)),notice=host.querySelector('#workflow-diagnostics');
      if(notice)notice.innerHTML=result.errors.map(e=>`<p class="notice error">${esc(e)}</p>`).join('')+result.warnings.map(e=>`<p class="notice warning">${esc(e)}</p>`).join('');
    }
    area.addEventListener('change',render);
    render();
    return {validate(){const cfg=read(),{workflows,intents}=effective(cfg);const result=diagnostics(workflows,intents,calendarFor(cfg));if(result.errors.length)throw Error(result.errors[0]);},refresh:render,setCalendarStatus(status){linked=status;render();}};
  }
  window.RelayqoWorkflows={mount,diagnostics,renameState,template,orderedSteps,removeIntent};
})();
