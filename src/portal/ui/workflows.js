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
  function diagnostics(workflows, intents=[]) {
    const errors=[],warnings=[];
    for(const [key,wf] of Object.entries(workflows)) {
      if(!wf.states || !own(wf.states,wf.initialState)) { errors.push(`${key}: choose an existing starting step.`); continue; }
      const used=new Set();
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
    if(kind==='feedback') Object.assign(wf,{name:'Feedback',description:'Collect customer feedback.',states:{
      start:{name:'Feedback',type:'collect',prompt:{en:'What could we improve?',fr:'Que pouvons-nous améliorer ?'},field:{name:'feedback',type:'string',required:true},next:'done'},
      done:{name:'Thank you',type:'end',prompt:{en:'Thank you for your feedback.',fr:'Merci pour votre retour.'}}
    }});
    return wf;
  }
  function mount({area,template:base={},notify=()=>{}}) {
    let selected,step,bindings=[],serial=0;
    const host=document.createElement('article');host.id='workflow-editor';host.className='card workflow-editor';
    document.querySelector('#technical').after(host);
    const read=()=>JSON.parse(area.value);
    const effective=cfg=>({workflows:cfg.workflows??base.workflows??{},intents:cfg.capabilities?.intents??base.capabilities?.intents??[]});
    function change(fn,redraw=false) {
      try {
        const cfg=read(),e=effective(cfg);
        cfg.workflows=copy(e.workflows);
        cfg.capabilities={...cfg.capabilities,intents:copy(e.intents)};
        fn(cfg.workflows,cfg.capabilities.intents,cfg);
        area.value=JSON.stringify(cfg,null,2);area.dispatchEvent(new Event('input',{bubbles:true}));
        if(redraw)render();else preview();
      } catch(e){notify(e.message,true);}
    }
    function field(label,value,update,{type='text',options,full=false,hint=''}={}) {
      const id='wf-control-'+serial++;
      bindings.push(()=>{const el=host.querySelector('#'+id);el[type==='select'?'onchange':'oninput']=()=>update(type==='checkbox'?el.checked:type==='number'?(el.value===''?undefined:Number(el.value)):el.value);});
      let input;
      if(type==='checkbox')return `<label class="admin-setting-toggle workflow-check ${full?'full':''}" for="${id}"><input id="${id}" type="checkbox" ${value?'checked':''}><span><strong>${esc(label)}</strong>${hint?`<small>${esc(hint)}</small>`:''}</span></label>`;
      if(type==='textarea')input=`<textarea id="${id}" dir="auto">${esc(value)}</textarea>`;
      else if(type==='select')input=`<select id="${id}">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===value?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
      else if(type==='checkbox')input=`<input id="${id}" type="checkbox" ${value?'checked':''}>`;
      else input=`<input id="${id}" type="${type}" value="${esc(value)}" ${type==='number'?'step="any"':'dir="auto"'}>`;
      return `<div class="field ${full?'full':''} ${type==='checkbox'?'workflow-check':''}"><label for="${id}">${esc(label)}</label>${input}${hint?`<span class="hint">${esc(hint)}</span>`:''}</div>`;
    }
    function button(label,fn,kind='secondary',html='') {
      const id='wf-action-'+serial++;bindings.push(()=>host.querySelector('#'+id).onclick=fn);
      return `<button type="button" class="btn ${kind}" id="${id}" ${html?`aria-label="${esc(label)}"`:''}>${html||esc(label)}</button>`;
    }
    function choices(label,options,selected,update,hint='') {
      const name='wf-choice-'+serial++;
      bindings.push(()=>{const boxes=[...host.querySelectorAll(`input[name="${name}"]`)];boxes.forEach(b=>b.onchange=()=>update(boxes.filter(x=>x.checked).map(x=>x.value)));});
      return `<fieldset class="field full workflow-choices"><legend>${esc(label)}</legend><div class="check-options">${options.map(o=>`<label><input type="checkbox" name="${name}" value="${esc(o.value)}" ${selected.includes(o.value)?'checked':''}><span dir="auto">${esc(o.label)}</span></label>`).join('')||'<span class="hint">Nothing to choose yet.</span>'}</div>${hint?`<span class="hint">${esc(hint)}</span>`:''}</fieldset>`;
    }
    function localized(label,value,update) {
      const obj=typeof value==='string'?{en:value}:value||{};
      const langs=['en','fr','ar','darija'],filled=langs.filter(lang=>obj[lang]).length;
      return `<details class="field full workflow-localized" ${filled?'open':''}><summary><span>${esc(label)}</span><small>${filled?`${filled}/4 languages`:'Optional · default text is used'}</small></summary><div class="form-grid">${langs.map(lang=>field(label+' · '+{en:'English',fr:'French',ar:'Arabic',darija:'Darija'}[lang],obj[lang]||'',v=>{obj[lang]=v;update({...obj});},{type:'textarea'})).join('')}</div></details>`;
    }
    function render() {
      let cfg;try{cfg=read();}catch{host.innerHTML='<p class="notice error">Correct the advanced JSON before editing workflows.</p>';return;}
      const {workflows,intents}=effective(cfg),keys=Object.keys(workflows);
      selected=keys.includes(selected)?selected:keys[0];
      const wf=workflows[selected];step=wf&&own(wf.states,step)?step:wf?.initialState;
      bindings=[];serial=0;
      const add=kind=>{const id=(kind==='cod'?'checkout_':'workflow_')+crypto.randomUUID().slice(0,8);change(w=>{w[id]=template(kind,id);selected=id;step='start';},true);};
      let html=`<div class="section-heading"><div><h2>Guided workflows</h2><p>Build conversation steps, branching choices and customer information forms.</p></div>${button('Add workflow',()=>add('blank'))}</div><div class="workflow-templates"><span class="small muted">Start from a template</span>${button('Sales & support',()=>add('triage'))}${button('Contact request',()=>add('lead'))}${button('Cash on delivery',()=>add('cod'))}${button('Feedback',()=>add('feedback'))}</div>`;
      html+=`<div id="workflow-diagnostics" aria-live="polite"></div>`;
      if(wf){
        const update=(fn,redraw=false)=>change(w=>fn(w[selected]),redraw);
        const stepNames=Object.values(wf.states).map(s=>s.name),targets=orderedSteps(wf).map(id=>[id,wf.states[id]]).map(([id,s])=>({value:id,label:(s.name||id)+(id===wf.initialState?' · start':'')+(s.name&&stepNames.filter(n=>n===s.name).length>1?' ('+id+')':'')}));
        html+=`<div class="workflow-picker">${field('Workflow',selected,v=>{selected=v;step=null;render();},{type:'select',options:keys.map(key=>({value:key,label:workflows[key].name||key}))})}<div class="actions">${button('Duplicate',()=>change(w=>{const id='workflow_'+crypto.randomUUID().slice(0,8);w[id]={...copy(w[selected]),id,name:(w[selected].name||selected)+' copy'};selected=id;},true))}${button('Delete workflow',()=>{if(confirm('Remove this workflow from the account configuration? Linked intents will use normal answers.'))change((w,i)=>{delete w[selected];i.forEach(intent=>{if(intent.workflowId===selected)delete intent.workflowId;});selected=null;},true);},'danger')}</div></div>`;
        const collectedFields = Object.values(wf.states).filter(s=>s.type==='collect').map(s=>typeof s.field==='string'?s.field:s.field?.name).filter(Boolean);
        const fieldOptions = [{value:'',label:'Select collected field'},...collectedFields.map(f=>({value:f,label:f}))];
        const currencyOptions = [{value:'',label:'Default business currency'},...collectedFields.map(f=>({value:f,label:f}))];
        const wfOutcomeType = wf.outcome?.type || 'none';
        let outcomeControls = field('Track business result', wfOutcomeType, v=>update(w=>{
          // Keep the CRM/handoff settings that share the outcome object.
          const {type:_type,valueField:_value,currencyField:_currency,...rest}=w.outcome||{};
          if(v==='none'||!v){ if(Object.keys(rest).length) w.outcome=rest; else delete w.outcome; }
          else if(v==='BOOKING_CONFIRMED') w.outcome={...rest,type:'BOOKING_CONFIRMED'};
          else if(v==='ORDER_CONFIRMED') w.outcome={...rest,type:'ORDER_CONFIRMED',valueField:collectedFields[0]||''};
        }, true), {type:'select', options:[{value:'none',label:'No business result'},{value:'BOOKING_CONFIRMED',label:'Booking confirmed'},{value:'ORDER_CONFIRMED',label:'Order confirmed'}]});
        if(wfOutcomeType==='ORDER_CONFIRMED') {
          outcomeControls += field('Order value field', wf.outcome?.valueField||'', v=>update(w=>{if(!w.outcome)w.outcome={type:'ORDER_CONFIRMED'};w.outcome.valueField=v;}), {type:'select',options:fieldOptions,hint:'Field representing order total amount.'});
          outcomeControls += field('Order currency field', wf.outcome?.currencyField||'', v=>update(w=>{if(!w.outcome)w.outcome={type:'ORDER_CONFIRMED'};if(v)w.outcome.currencyField=v;else delete w.outcome.currencyField;}), {type:'select',options:currencyOptions,hint:'Defaults to business currency if omitted.'});
        }
        html+=`<section class="workflow-group"><div class="workflow-group-head"><h3>Basics</h3><p>Name, purpose and first step of this workflow.</p></div><div class="form-grid">${field('Workflow name',wf.name,v=>update(w=>w.name=v))}${field('Starting step',wf.initialState,v=>update(w=>w.initialState=v,true),{type:'select',options:targets})}${field('Workflow description',wf.description,v=>update(w=>w.description=v),{type:'textarea',full:true})}</div></section><section class="workflow-group"><div class="workflow-group-head"><h3>When it starts</h3><p>What the customer says to open this workflow.</p></div><div class="form-grid">${field('Activation',wf.activation?.mode||'explicit_intent',v=>update(w=>w.activation={...w.activation,mode:v}),{type:'select',options:[{value:'explicit_intent',label:'Start on a trigger phrase or customer goal'},{value:'auto_start',label:'Start automatically'}]})}<span class="field workflow-spacer"></span>${field('Trigger phrases — one per line',(wf.activation?.keywords||[]).join('\n'),v=>update(w=>w.activation={...w.activation,keywords:phrases(v)}),{type:'textarea',hint:'Examples: bghit ncommandi, commander, place an order.'})}${choices('Also start when the AI recognises',intents.map(x=>({value:x.id,label:(x.description||x.id).length>70?(x.description||x.id).slice(0,68)+'…':(x.description||x.id)})),wf.activation?.intents||[],v=>update(w=>{const known=intents.map(x=>x.id);w.activation={...w.activation,intents:[...v,...(w.activation?.intents||[]).filter(x=>!known.includes(x))]};}),'Add or edit customer goals at the bottom of this page.')}${field('Allow manual start',wf.activation?.allowManualStart!==false,v=>update(w=>w.activation={...w.activation,allowManualStart:v}),{type:'checkbox',hint:'The team can start it from the inbox.'})}${field('Allow interruption',wf.allowInterruption!==false,v=>update(w=>w.allowInterruption=v),{type:'checkbox',hint:'Customers can ask a question mid-form, then continue.'})}</div></section><section class="workflow-group"><div class="workflow-group-head"><h3>When it finishes</h3><p>What happens with the collected request.</p></div><div class="form-grid">${outcomeControls}${field('Create CRM follow-up on completion',wf.outcome?.createLead===true,v=>update(w=>w.outcome={...w.outcome,createLead:v}),{type:'checkbox',hint:'Saves the collected request in Today and Follow-ups in the same transaction.'})}${wf.outcome?.createLead===true?field('Allow another request while one is open',wf.outcome?.allowConcurrentOpenRequests===true,v=>update(w=>w.outcome={...w.outcome,allowConcurrentOpenRequests:v}),{type:'checkbox',hint:'Leave off to prevent duplicate forms until the team marks the existing request done.'}):''}${wf.outcome?.createLead===true&&wf.outcome?.allowConcurrentOpenRequests!==true?localized('Existing open request message',wf.outcome?.openRequestMessage,v=>update(w=>w.outcome={...w.outcome,openRequestMessage:v})):''}${field('Move completed conversation to team',wf.outcome?.requestHumanHandoff===true,v=>update(w=>w.outcome={...w.outcome,requestHumanHandoff:v}),{type:'checkbox',hint:'Stops automatic replies and places the conversation in Needs reply.'})}${wf.outcome?.requestHumanHandoff===true?field('Pause bot for hours',wf.outcome?.pauseBotHours||24,v=>update(w=>w.outcome={...w.outcome,pauseBotHours:v}),{type:'number'}):''}</div></section><section class="workflow-group"><div class="workflow-group-head"><h3>Limits</h3><p>How often one customer can run this workflow.</p></div><div class="form-grid">${field('Execution limit',wf.executionLimit?.mode||'unlimited',v=>update(w=>w.executionLimit={...w.executionLimit,mode:v,...(v==='custom'&&!w.executionLimit?.maxExecutions?{maxExecutions:2}:{})},true),{type:'select',options:[{value:'unlimited',label:'Unlimited'},{value:'once',label:'Once per conversation'},{value:'custom',label:'Custom limit'}]})}${wf.executionLimit?.mode==='custom'?field('Maximum executions',wf.executionLimit.maxExecutions,v=>update(w=>w.executionLimit.maxExecutions=v),{type:'number'}):''}${wf.executionLimit?.mode&&wf.executionLimit.mode!=='unlimited'?localized('Limit reached message',wf.executionLimit?.limitReachedMessage,v=>update(w=>w.executionLimit={...w.executionLimit,limitReachedMessage:v})):''}</div></section>`;
        const st=wf.states[step];
        html+=`<div class="workflow-workspace"><section class="workflow-steps"><div class="section-heading"><h3>Conversation steps</h3>${button('Add step',()=>update(w=>{const id='step_'+crypto.randomUUID().slice(0,8);w.states[id]={name:'New step',type:'end',prompt:''};step=id;},true))}</div><div class="workflow-step-list">${orderedSteps(wf).map(id=>[id,wf.states[id]]).map(([id,state],n)=>button((state.name||id)+' · '+state.type,()=>{step=id;render();},(id===step?'lime':'secondary')+' workflow-step-chip',`<span class="workflow-step-number">${n+1}</span><bdi>${esc(state.name||id)}</bdi><small>${id===wf.initialState?'start · ':''}${esc(state.type)}</small>`)).join('')}</div>`;
        if(st){
          const edit=(fn,redraw=false)=>update(w=>fn(w.states[step],w),redraw);
          html+=`<div class="form-grid workflow-step-editor">${field('Step name',st.name||st.label||step,v=>edit(s=>s.name=v))}${field('Step type',st.type,v=>edit((s,w)=>{s.type=v;if(v==='choice'&&!s.options?.length)s.options=[{label:'Continue',next:Object.keys(w.states).find(k=>k!==step)||step}];if(v==='collect'&&!s.field)s.field={name:'customerInput',type:'string',required:true};},true),{type:'select',options:['choice','collect','confirm','message','rag','handoff','end'].map(value=>({value,label:{choice:'Customer choices',collect:'Collect information',confirm:'Confirmation',message:'Message',rag:'Knowledge answer',handoff:'Human handoff',end:'End workflow'}[value]}))})}${localized('Bot message',st.prompt,v=>edit(s=>s.prompt=v))}`;
          if(st.type==='collect'){
            const f=typeof st.field==='string'?{name:st.field,type:'string',required:true}:st.field||{};
            const setField=(key,value)=>edit(s=>{s.field={...(typeof s.field==='string'?{name:s.field,type:'string',required:true}:s.field),[key]:value};});
            html+=field('Save answer as',f.name,v=>setField('name',v),{hint:'Short name shown in Follow-ups, for example fullName or phone.'})+field('Answer type',f.type||'string',v=>setField('type',v),{type:'select',options:[['string','Text'],['email','Email'],['phone','Phone number'],['number','Number'],['boolean','Yes / no'],['date','Date'],['time','Time'],['datetime','Date and time'],['enum','Choice from a list']].map(([value,label])=>({value,label}))})+(f.type==='string'?field('Text answer meaning',f.semanticType||(/^(?:fullname|name|customername|contactname)$/i.test(f.name||'')?'person_name':'free_text'),v=>setField('semanticType',v),{type:'select',options:[{value:'free_text',label:'Open text answer'},{value:'person_name',label:'Person name'}],hint:'Use Person name when the bot asks for a customer name; unrelated questions will not be saved as a name.'}):'')+field('Required',f.required!==false,v=>setField('required',v),{type:'checkbox'})+(f.type==='enum'?field('List choices — one per line',(f.options||[]).join('\n'),v=>setField('options',phrases(v)),{type:'textarea',full:true}):'');
            html+=`<details class="field full"><summary>Input validation and extraction</summary><div class="form-grid">${[['minLength','Minimum length'],['maxLength','Maximum length'],['min','Lowest value'],['max','Highest value']].map(([key,label])=>field(label,f[key],v=>setField(key,v),{type:'number'})).join('')}${field('Validation pattern',f.pattern||f.validationRegex||'',v=>setField('pattern',v))}${field('Extraction instructions',f.extractionPrompt||'',v=>setField('extractionPrompt',v),{type:'textarea'})}</div></details>`;
          }
          if(st.type==='choice')html+=`<div class="field full"><div class="section-heading"><h3>Customer choices</h3>${button('Add choice',()=>edit((s,w)=>{s.options??=[];s.options.push({label:'New choice',next:Object.keys(w.states).find(k=>k!==step)||step});},true))}</div>${(st.options||[]).map((o,i)=>`<div class="workflow-branch">${field('Choice '+(i+1)+' label',o.label,v=>edit(s=>s.options[i].label=v))}${field('Choice '+(i+1)+' next step',o.next,v=>edit(s=>s.options[i].next=v),{type:'select',options:[{value:'',label:'Choose a step'},...targets]})}${button('Remove choice '+(i+1),()=>edit(s=>s.options.splice(i,1),true),'danger')}</div>`).join('')}</div>`;
          if(st.type==='confirm')html+=field('Confirmation words — one per line',(st.confirmKeywords||[]).join('\n'),v=>edit(s=>s.confirmKeywords=phrases(v)),{type:'textarea'})+field('Cancellation words — one per line',(st.cancelKeywords||[]).join('\n'),v=>edit(s=>s.cancelKeywords=phrases(v)),{type:'textarea'})+localized('Cancellation message',st.cancellationPrompt,v=>edit(s=>s.cancellationPrompt=v));
          if(st.type==='handoff')html+=field('Pause bot for (hours)',st.pauseBotHours||24,v=>edit(s=>s.pauseBotHours=Math.max(1,Number(v)||24)),{type:'number',hint:'The conversation moves to Needs reply. If nobody resolves it, bot automation resumes after this time.',full:true});
          if(!['end','handoff','choice'].includes(st.type))html+=field('Next step',st.next||'',v=>edit(s=>{if(v)s.next=v;else delete s.next;}),{type:'select',options:[{value:'',label:st.transitions?.length?'Use transition rules below':'End here'},...targets],full:true});
          html+=`<details class="field full" ${st.transitions?.length?'open':''}><summary>Conditional transitions (${st.transitions?.length||0})</summary><p class="small muted">Preserves existing intent and condition rules. A direct next step can take precedence for linear steps.</p>${(st.transitions||[]).map((t,i)=>`<div class="form-item form-grid">${field('Transition '+(i+1)+' intent',t.intent,v=>edit(s=>s.transitions[i].intent=v))}${field('Transition '+(i+1)+' condition',t.condition,v=>edit(s=>s.transitions[i].condition=v))}${field('Transition '+(i+1)+' target',t.target,v=>edit(s=>s.transitions[i].target=v),{type:'select',options:[{value:'',label:'Choose a step'},...targets]})}${field('Default transition '+(i+1),t.default===true,v=>edit(s=>s.transitions[i].default=v),{type:'checkbox'})}${button('Remove transition '+(i+1),()=>edit(s=>s.transitions.splice(i,1),true),'danger')}</div>`).join('')}${button('Add transition',()=>edit((s,w)=>{s.transitions??=[];s.transitions.push({target:Object.keys(w.states).find(k=>k!==step)||step});},true))}</details>`;
          if(st.type==='end'){
            const stepOutcomeType = st.outcome===undefined ? 'inherit' : (st.outcome?.type || 'none');
            let stepOutcomeHtml = field('Terminal outcome override', stepOutcomeType, v=>edit(s=>{
              if(v==='inherit') delete s.outcome;
              else if(v==='none') s.outcome={type:'none'};
              else if(v==='BOOKING_CONFIRMED') s.outcome={type:'BOOKING_CONFIRMED'};
              else if(v==='ORDER_CONFIRMED') s.outcome={type:'ORDER_CONFIRMED',valueField:collectedFields[0]||''};
            }, true), {type:'select',options:[{value:'inherit',label:'Inherit from workflow'},{value:'none',label:'None (suppress outcome)'},{value:'BOOKING_CONFIRMED',label:'Booking confirmed'},{value:'ORDER_CONFIRMED',label:'Order confirmed'}],hint:'Override the outcome when this specific terminal step is reached.'});
            if(stepOutcomeType==='ORDER_CONFIRMED'){
              stepOutcomeHtml += field('Step order value field', st.outcome?.valueField||'', v=>edit(s=>{if(!s.outcome)s.outcome={type:'ORDER_CONFIRMED'};s.outcome.valueField=v;}), {type:'select',options:fieldOptions});
              stepOutcomeHtml += field('Step order currency field', st.outcome?.currencyField||'', v=>edit(s=>{if(!s.outcome)s.outcome={type:'ORDER_CONFIRMED'};if(v)s.outcome.currencyField=v;else delete s.outcome.currencyField;}), {type:'select',options:currencyOptions});
            }
            html += `<details class="field full" ${st.outcome!==undefined?'open':''}><summary>Outcome tracking override</summary><div class="form-grid">${stepOutcomeHtml}</div></details>`;
          }
          html+=`<details class="field full"><summary>Step identifier</summary><p class="small muted">${esc(step)}</p>${button('Rename step ID',()=>{const id=prompt('New step ID',step);if(id)update(w=>{renameState(w,step,id);step=id;},true);})}</details><div class="actions full">${button('Set as starting step',()=>update(w=>w.initialState=step,true))}${button('Delete step',()=>{const refs=Object.entries(wf.states).filter(([id,s])=>id!==step&&edges(s).some(e=>e.target===step));if(wf.initialState===step||refs.length){notify('Change the starting step and incoming paths before deleting this step.',true);return;}update(w=>{delete w.states[step];step=w.initialState;},true);},'danger')}</div></div>`;
        }
        html+='</section><aside class="workflow-preview"><h3>Live flow preview</h3><p class="small muted">Select a step in the diagram to edit it.</p><div id="workflow-graph"></div></aside></div>';
      }else html+='<p class="empty">No workflows yet. Add one or start from a template.</p>';
      html+=`<section class="workflow-intents"><div class="section-heading"><div><h2>Customer goals</h2><p>Customer goals the AI recognises, and the workflow each one opens.</p></div>${button('Add customer goal',()=>change((_w,i)=>i.push({id:'INTENT_'+crypto.randomUUID().slice(0,8),description:'',keywords:[]}),true))}</div>${intents.map((intent,i)=>`<div class="form-item form-grid"><h3 class="workflow-intent-title full">Customer goal ${i+1}</h3>${field('Internal name',intent.id,v=>change((w,list)=>{const old=list[i].id;list[i].id=v;Object.values(w).forEach(wf=>{if(wf.activation?.intents)wf.activation.intents=wf.activation.intents.map(x=>x===old?v:x);Object.values(wf.states).forEach(s=>(s.transitions||[]).forEach(t=>{if(t.intent===old)t.intent=v;}));});}),{hint:'Used by the system; letters, numbers and _ only.'})}${field('What the customer wants',intent.description,v=>change((_w,list)=>list[i].description=v),{type:'textarea',hint:'Plain words. The AI reads this to recognise the goal.'})}${choices('Purpose',[['PURCHASE','Buying'],['DEMO','Demo'],['BOOKING','Booking'],['HUMAN_SUPPORT','Talk to a person']].map(([value,label])=>({value,label})),intent.useCases||[],v=>change((_w,list)=>{if(v.length)list[i].useCases=[...new Set(v)];else delete list[i].useCases;}))}${field('Extra phrases — one per line',(intent.keywords||[]).join('\n'),v=>change((_w,list)=>list[i].keywords=phrases(v)),{type:'textarea'})}${field('Opens workflow',intent.workflowId||'',v=>change((_w,list)=>{if(v)list[i].workflowId=v;else delete list[i].workflowId;}),{type:'select',options:[{value:'',label:'Normal chatbot answer'},...keys.map(value=>({value,label:workflows[value].name||value}))]})}<div class="workflow-intent-actions">${button('Remove goal',()=>change((w,list)=>removeIntent(w,list,i),true),'danger')}</div></div>`).join('')||'<p class="empty">No custom intents configured.</p>'}</section>`;
      host.innerHTML=html;bindings.forEach(bind=>bind());preview();
    }
    function preview() {
      const {workflows,intents}=effective(read()),wf=workflows[selected];
      const result=diagnostics(workflows,intents),notice=host.querySelector('#workflow-diagnostics');
      if(notice)notice.innerHTML=result.errors.map(e=>`<p class="notice error">${esc(e)}</p>`).join('')+result.warnings.map(e=>`<p class="notice warning">${esc(e)}</p>`).join('');
      const graph=host.querySelector('#workflow-graph');if(!graph||!wf)return;
      const ids=orderedSteps(wf),positions=Object.fromEntries(ids.map((id,i)=>[id,{x:20+(i%2)*260,y:40+Math.floor(i/2)*150}]));
      const height=Math.max(180,Math.ceil(ids.length/2)*150);
      const outcomeBadge = state => {
        if(state.type!=='end') return '';
        const t = state.outcome!==undefined ? state.outcome?.type : wf.outcome?.type;
        return t==='BOOKING_CONFIRMED'?' [BOOKING]':t==='ORDER_CONFIRMED'?' [ORDER]':'';
      };
      graph.innerHTML=`<svg viewBox="0 0 530 ${height}" role="group" aria-label="Workflow steps and connections"><defs><marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="currentColor"/></marker></defs>${ids.flatMap(id=>edges(wf.states[id]).filter(e=>positions[e.target]).map(e=>{const a=positions[id],b=positions[e.target];return `<path class="workflow-edge" d="M${a.x+105} ${a.y+60} C${a.x+105} ${a.y+100},${b.x+105} ${b.y-35},${b.x+105} ${b.y}" marker-end="url(#wf-arrow)"/>`;})).join('')}${ids.map(id=>{const p=positions[id],state=wf.states[id];return `<g tabindex="0" role="button" aria-label="Edit ${esc(state.name||id)}" data-node="${esc(id)}" class="workflow-node ${id===step?'selected':''}" transform="translate(${p.x},${p.y})"><rect width="210" height="60" rx="10"/><text x="12" y="23">${esc((state.name||id).slice(0,26))}</text><text x="12" y="44" class="workflow-node-type">${id===wf.initialState?'START · ':''}${esc(state.type)}${esc(outcomeBadge(state))}</text></g>`;}).join('')}</svg><div class="workflow-paths">${ids.map(id=>`<div><strong>${esc(wf.states[id].name||id)}</strong>${edges(wf.states[id]).map(e=>`<p>${esc(e.label)} → ${esc(wf.states[e.target]?.name||e.target||'Missing step')}</p>`).join('')||('<p>Ends here'+(outcomeBadge(wf.states[id]) ? ' · Emits ' + outcomeBadge(wf.states[id]).trim().slice(1, -1) : '')+'</p>')}</div>`).join('')}</div>`;
      graph.querySelectorAll('[data-node]').forEach(node=>{const choose=()=>{step=node.dataset.node;render();};node.onclick=choose;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};});
    }
    area.addEventListener('change',render);
    render();
    return {validate(){const {workflows,intents}=effective(read());const result=diagnostics(workflows,intents);if(result.errors.length)throw Error(result.errors[0]);},refresh:render};
  }
  window.RelayqoWorkflows={mount,diagnostics,renameState,template,orderedSteps,removeIntent};
})();
