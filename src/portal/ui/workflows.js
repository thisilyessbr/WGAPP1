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
      start:{name:'Product',type:'collect',prompt:{en:'Which product would you like to order?',fr:'Quel produit souhaitez-vous commander ?',darija:'Achmen produit bghiti tcommandi?'},field:{name:'product',type:'string',required:true},next:'quantity'},
      quantity:{name:'Quantity',type:'collect',prompt:{en:'How many would you like?',fr:'Quelle quantité souhaitez-vous ?',darija:'Chhal mn wahed bghiti?'},field:{name:'quantity',type:'number',required:true,min:1},next:'customer_name'},
      customer_name:{name:'Customer name',type:'collect',prompt:{en:'What name should we put on the order?',fr:'Quel nom mettre sur la commande ?',darija:'Chno smiya dyalk f commande?'},field:{name:'customer_name',type:'string',required:true},next:'phone'},
      phone:{name:'Phone',type:'collect',prompt:{en:'What phone number can our team reach?',fr:'À quel numéro pouvons-nous vous joindre ?',darija:'Chno raqm téléphone bach ntwaslo m3ak?'},field:{name:'phone',type:'phone',required:true},next:'city'},
      city:{name:'Delivery city',type:'collect',prompt:{en:'Which city should we deliver to?',fr:'Dans quelle ville faut-il livrer ?',darija:'Lachmen mdina nsifto livraison?'},field:{name:'city',type:'string',required:true},next:'address'},
      address:{name:'Delivery address',type:'collect',prompt:{en:'What is your full delivery address?',fr:'Quelle est votre adresse complète de livraison ?',darija:'Chno l3onwan kamel dyal livraison?'},field:{name:'address',type:'string',required:true},next:'confirm'},
      confirm:{name:'Review order',type:'confirm',prompt:{en:'Please confirm these order details for cash on delivery:\n{{summary}}',fr:'Confirmez ces détails pour le paiement à la livraison :\n{{summary}}',darija:'3afak 2akked had tafasil dyal paiement 3nd livraison:\n{{summary}}'},confirmKeywords:['yes','oui','نعم','ah'],cancelKeywords:['no','non','لا'],transitions:[{target:'done'}]},
      done:{name:'Request received',type:'end',prompt:{en:'Thank you. Our team will review your order and contact you to confirm it.',fr:'Merci. Notre équipe vérifiera votre commande et vous contactera pour la confirmer.',darija:'Chokran. Lfar9 ghayraja3 commande o ghaytwasel m3ak bach y2akkedha.'}}
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
      if(type==='textarea')input=`<textarea id="${id}" dir="auto">${esc(value)}</textarea>`;
      else if(type==='select')input=`<select id="${id}">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===value?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
      else if(type==='checkbox')input=`<input id="${id}" type="checkbox" ${value?'checked':''}>`;
      else input=`<input id="${id}" type="${type}" value="${esc(value)}" ${type==='number'?'step="any"':''}>`;
      return `<div class="field ${full?'full':''} ${type==='checkbox'?'workflow-check':''}"><label for="${id}">${esc(label)}</label>${input}${hint?`<span class="hint">${esc(hint)}</span>`:''}</div>`;
    }
    function button(label,fn,kind='secondary') {
      const id='wf-action-'+serial++;bindings.push(()=>host.querySelector('#'+id).onclick=fn);
      return `<button type="button" class="btn ${kind}" id="${id}">${esc(label)}</button>`;
    }
    function localized(label,value,update) {
      const obj=typeof value==='string'?{en:value}:value||{};
      return `<div class="field full"><h3>${esc(label)}</h3><div class="form-grid">${['en','fr','ar','darija'].map(lang=>field(label+' · '+lang,obj[lang]||'',v=>{obj[lang]=v;update({...obj});},{type:'textarea'})).join('')}</div></div>`;
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
        const targets=orderedSteps(wf).map(id=>[id,wf.states[id]]).map(([id,s])=>({value:id,label:(s.name||id)+' ('+id+')'}));
        html+=`<div class="workflow-picker">${field('Workflow',selected,v=>{selected=v;step=null;render();},{type:'select',options:keys.map(key=>({value:key,label:workflows[key].name||key}))})}<div class="actions">${button('Duplicate',()=>change(w=>{const id='workflow_'+crypto.randomUUID().slice(0,8);w[id]={...copy(w[selected]),id,name:(w[selected].name||selected)+' copy'};selected=id;},true))}${button('Delete workflow',()=>{if(confirm('Remove this workflow from the account configuration? Linked intents will use normal answers.'))change((w,i)=>{delete w[selected];i.forEach(intent=>{if(intent.workflowId===selected)delete intent.workflowId;});selected=null;},true);},'danger')}</div></div>`;
        html+=`<div class="form-grid">${field('Workflow name',wf.name,v=>update(w=>w.name=v))}${field('Workflow description',wf.description,v=>update(w=>w.description=v))}${field('Starting step',wf.initialState,v=>update(w=>w.initialState=v,true),{type:'select',options:targets})}${field('Activation',wf.activation?.mode||'explicit_intent',v=>update(w=>w.activation={...w.activation,mode:v}),{type:'select',options:[{value:'explicit_intent',label:'Start on matching intent or phrase'},{value:'auto_start',label:'Start automatically'}]})}${field('Trigger phrases — one per line',(wf.activation?.keywords||[]).join('\n'),v=>update(w=>w.activation={...w.activation,keywords:phrases(v)}),{type:'textarea',hint:'Examples: bghit ncommandi, commander, place an order.'})}${field('Trigger intent IDs — one per line',(wf.activation?.intents||[]).join('\n'),v=>update(w=>w.activation={...w.activation,intents:phrases(v)}),{type:'textarea',hint:'Create or edit these intents below.'})}${field('Allow manual start',wf.activation?.allowManualStart!==false,v=>update(w=>w.activation={...w.activation,allowManualStart:v}),{type:'checkbox'})}${field('Allow interruption',wf.allowInterruption!==false,v=>update(w=>w.allowInterruption=v),{type:'checkbox'})}${field('Execution limit',wf.executionLimit?.mode||'unlimited',v=>update(w=>w.executionLimit={...w.executionLimit,mode:v,...(v==='custom'&&!w.executionLimit?.maxExecutions?{maxExecutions:2}:{})},true),{type:'select',options:[{value:'unlimited',label:'Unlimited'},{value:'once',label:'Once per conversation'},{value:'custom',label:'Custom limit'}]})}${wf.executionLimit?.mode==='custom'?field('Maximum executions',wf.executionLimit.maxExecutions,v=>update(w=>w.executionLimit.maxExecutions=v),{type:'number'}):''}${wf.executionLimit?.mode&&wf.executionLimit.mode!=='unlimited'?localized('Limit reached message',wf.executionLimit?.limitReachedMessage,v=>update(w=>w.executionLimit={...w.executionLimit,limitReachedMessage:v})):''}</div>`;
        const st=wf.states[step];
        html+=`<div class="workflow-workspace"><section class="workflow-steps"><div class="section-heading"><h3>Conversation steps</h3>${button('Add step',()=>update(w=>{const id='step_'+crypto.randomUUID().slice(0,8);w.states[id]={name:'New step',type:'end',prompt:''};step=id;},true))}</div><div class="workflow-step-list">${orderedSteps(wf).map(id=>[id,wf.states[id]]).map(([id,state])=>button((id===wf.initialState?'Start · ':'')+(state.name||id)+' · '+state.type,()=>{step=id;render();},id===step?'lime':'secondary')).join('')}</div>`;
        if(st){
          const edit=(fn,redraw=false)=>update(w=>fn(w.states[step],w),redraw);
          html+=`<div class="form-grid workflow-step-editor">${field('Step name',st.name||st.label||step,v=>edit(s=>s.name=v))}${field('Step type',st.type,v=>edit((s,w)=>{s.type=v;if(v==='choice'&&!s.options?.length)s.options=[{label:'Continue',next:Object.keys(w.states).find(k=>k!==step)||step}];if(v==='collect'&&!s.field)s.field={name:'customerInput',type:'string',required:true};},true),{type:'select',options:['choice','collect','confirm','message','rag','handoff','end'].map(value=>({value,label:{choice:'Customer choices',collect:'Collect information',confirm:'Confirmation',message:'Message',rag:'Knowledge answer',handoff:'Human handoff',end:'End workflow'}[value]}))})}${localized('Bot message',st.prompt,v=>edit(s=>s.prompt=v))}`;
          if(st.type==='collect'){
            const f=typeof st.field==='string'?{name:st.field,type:'string',required:true}:st.field||{};
            const setField=(key,value)=>edit(s=>{s.field={...(typeof s.field==='string'?{name:s.field,type:'string',required:true}:s.field),[key]:value};});
            html+=field('Data field name',f.name,v=>setField('name',v),{hint:'Use a stable name, for example fullName or phone.'})+field('Input type',f.type||'string',v=>setField('type',v),{type:'select',options:['string','email','phone','number','boolean','date','time','datetime','enum'].map(value=>({value,label:value}))})+field('Required',f.required!==false,v=>setField('required',v),{type:'checkbox'})+field('Allowed values — one per line',(f.options||[]).join('\n'),v=>setField('options',phrases(v)),{type:'textarea',hint:'Used for enum fields.'});
            html+=`<details class="field full"><summary>Input validation and extraction</summary><div class="form-grid">${['minLength','maxLength','min','max'].map(key=>field(key,f[key],v=>setField(key,v),{type:'number'})).join('')}${field('Validation pattern',f.pattern||f.validationRegex||'',v=>setField('pattern',v))}${field('Extraction instructions',f.extractionPrompt||'',v=>setField('extractionPrompt',v),{type:'textarea'})}</div></details>`;
          }
          if(st.type==='choice')html+=`<div class="field full"><div class="section-heading"><h3>Customer choices</h3>${button('Add choice',()=>edit((s,w)=>{s.options??=[];s.options.push({label:'New choice',next:Object.keys(w.states).find(k=>k!==step)||step});},true))}</div>${(st.options||[]).map((o,i)=>`<div class="workflow-branch">${field('Choice '+(i+1)+' label',o.label,v=>edit(s=>s.options[i].label=v))}${field('Choice '+(i+1)+' next step',o.next,v=>edit(s=>s.options[i].next=v),{type:'select',options:[{value:'',label:'Choose a step'},...targets]})}${button('Remove choice '+(i+1),()=>edit(s=>s.options.splice(i,1),true),'danger')}</div>`).join('')}</div>`;
          if(st.type==='confirm')html+=field('Confirmation words — one per line',(st.confirmKeywords||[]).join('\n'),v=>edit(s=>s.confirmKeywords=phrases(v)),{type:'textarea'})+field('Cancellation words — one per line',(st.cancelKeywords||[]).join('\n'),v=>edit(s=>s.cancelKeywords=phrases(v)),{type:'textarea'})+localized('Cancellation message',st.cancellationPrompt,v=>edit(s=>s.cancellationPrompt=v));
          if(!['end','handoff','choice'].includes(st.type))html+=field('Next step',st.next||'',v=>edit(s=>{if(v)s.next=v;else delete s.next;}),{type:'select',options:[{value:'',label:st.transitions?.length?'Use transition rules below':'End here'},...targets],full:true});
          html+=`<details class="field full" ${st.transitions?.length?'open':''}><summary>Conditional transitions (${st.transitions?.length||0})</summary><p class="small muted">Preserves existing intent and condition rules. A direct next step can take precedence for linear steps.</p>${(st.transitions||[]).map((t,i)=>`<div class="form-item form-grid">${field('Transition '+(i+1)+' intent',t.intent,v=>edit(s=>s.transitions[i].intent=v))}${field('Transition '+(i+1)+' condition',t.condition,v=>edit(s=>s.transitions[i].condition=v))}${field('Transition '+(i+1)+' target',t.target,v=>edit(s=>s.transitions[i].target=v),{type:'select',options:[{value:'',label:'Choose a step'},...targets]})}${field('Default transition '+(i+1),t.default===true,v=>edit(s=>s.transitions[i].default=v),{type:'checkbox'})}${button('Remove transition '+(i+1),()=>edit(s=>s.transitions.splice(i,1),true),'danger')}</div>`).join('')}${button('Add transition',()=>edit((s,w)=>{s.transitions??=[];s.transitions.push({target:Object.keys(w.states).find(k=>k!==step)||step});},true))}</details>`;
          html+=`<details class="field full"><summary>Step identifier</summary><p class="small muted">${esc(step)}</p>${button('Rename step ID',()=>{const id=prompt('New step ID',step);if(id)update(w=>{renameState(w,step,id);step=id;},true);})}</details><div class="actions full">${button('Set as starting step',()=>update(w=>w.initialState=step,true))}${button('Delete step',()=>{const refs=Object.entries(wf.states).filter(([id,s])=>id!==step&&edges(s).some(e=>e.target===step));if(wf.initialState===step||refs.length){notify('Change the starting step and incoming paths before deleting this step.',true);return;}update(w=>{delete w.states[step];step=w.initialState;},true);},'danger')}</div></div>`;
        }
        html+='</section><aside class="workflow-preview"><h3>Live flow preview</h3><p class="small muted">Select a step in the diagram to edit it.</p><div id="workflow-graph"></div></aside></div>';
      }else html+='<p class="empty">No workflows yet. Add one or start from a template.</p>';
      html+=`<section class="workflow-intents"><div class="section-heading"><div><h2>Intents & routing</h2><p>Connect what the customer asks to the right workflow.</p></div>${button('Add intent',()=>change((_w,i)=>i.push({id:'INTENT_'+crypto.randomUUID().slice(0,8),description:'',keywords:[]}),true))}</div>${intents.map((intent,i)=>`<div class="form-item form-grid">${field('Intent '+(i+1)+' ID',intent.id,v=>change((w,list)=>{const old=list[i].id;list[i].id=v;Object.values(w).forEach(wf=>{if(wf.activation?.intents)wf.activation.intents=wf.activation.intents.map(x=>x===old?v:x);Object.values(wf.states).forEach(s=>(s.transitions||[]).forEach(t=>{if(t.intent===old)t.intent=v;}));});}))}${field('Intent '+(i+1)+' description',intent.description,v=>change((_w,list)=>list[i].description=v))}${field('Intent '+(i+1)+' keywords — one per line',(intent.keywords||[]).join('\n'),v=>change((_w,list)=>list[i].keywords=phrases(v)),{type:'textarea'})}${field('Intent '+(i+1)+' workflow',intent.workflowId||'',v=>change((_w,list)=>{if(v)list[i].workflowId=v;else delete list[i].workflowId;}),{type:'select',options:[{value:'',label:'Normal chatbot answer'},...keys.map(value=>({value,label:workflows[value].name||value}))]})}${button('Delete intent '+(i+1),()=>change((w,list)=>removeIntent(w,list,i),true),'danger')}</div>`).join('')||'<p class="empty">No custom intents configured.</p>'}</section>`;
      host.innerHTML=html;bindings.forEach(bind=>bind());preview();
    }
    function preview() {
      const {workflows,intents}=effective(read()),wf=workflows[selected];
      const result=diagnostics(workflows,intents),notice=host.querySelector('#workflow-diagnostics');
      if(notice)notice.innerHTML=result.errors.map(e=>`<p class="notice error">${esc(e)}</p>`).join('')+result.warnings.map(e=>`<p class="notice warning">${esc(e)}</p>`).join('');
      const graph=host.querySelector('#workflow-graph');if(!graph||!wf)return;
      const ids=orderedSteps(wf),positions=Object.fromEntries(ids.map((id,i)=>[id,{x:20+(i%2)*260,y:40+Math.floor(i/2)*150}]));
      const height=Math.max(180,Math.ceil(ids.length/2)*150);
      graph.innerHTML=`<svg viewBox="0 0 530 ${height}" role="group" aria-label="Workflow steps and connections"><defs><marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="currentColor"/></marker></defs>${ids.flatMap(id=>edges(wf.states[id]).filter(e=>positions[e.target]).map(e=>{const a=positions[id],b=positions[e.target];return `<path class="workflow-edge" d="M${a.x+105} ${a.y+60} C${a.x+105} ${a.y+100},${b.x+105} ${b.y-35},${b.x+105} ${b.y}" marker-end="url(#wf-arrow)"/>`;})).join('')}${ids.map(id=>{const p=positions[id],state=wf.states[id];return `<g tabindex="0" role="button" aria-label="Edit ${esc(state.name||id)}" data-node="${esc(id)}" class="workflow-node ${id===step?'selected':''}" transform="translate(${p.x},${p.y})"><rect width="210" height="60" rx="10"/><text x="12" y="23">${esc((state.name||id).slice(0,26))}</text><text x="12" y="44" class="workflow-node-type">${id===wf.initialState?'START · ':''}${esc(state.type)}</text></g>`;}).join('')}</svg><div class="workflow-paths">${ids.map(id=>`<div><strong>${esc(wf.states[id].name||id)}</strong>${edges(wf.states[id]).map(e=>`<p>${esc(e.label)} → ${esc(wf.states[e.target]?.name||e.target||'Missing step')}</p>`).join('')||'<p>Ends here</p>'}</div>`).join('')}</div>`;
      graph.querySelectorAll('[data-node]').forEach(node=>{const choose=()=>{step=node.dataset.node;render();};node.onclick=choose;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};});
    }
    area.addEventListener('change',render);
    render();
    return {validate(){const {workflows,intents}=effective(read());const result=diagnostics(workflows,intents);if(result.errors.length)throw Error(result.errors[0]);},refresh:render};
  }
  window.RelayqoWorkflows={mount,diagnostics,renameState,template,orderedSteps,removeIntent};
})();
