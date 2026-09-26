window.RelayqoPlans = (() => {
  const base = {messages:1000,llmCalls:900,images:0,embeddings:300,monthlyUsd:5,numbers:1,products:0,documents:3,storageMb:25};
  const presets = {
    essential:{name:'Essential',description:'Answers questions from your business information, FAQs and PDFs on one WhatsApp number.',price:299,modules:['knowledge'],limits:{...base}},
    services:{name:'Services',description:'For appointments and enquiries, with service information and a lead follow-up workspace.',price:449,modules:['knowledge','services'],limits:{...base,messages:2000,llmCalls:1800,embeddings:600,monthlyUsd:10,documents:8,storageMb:75}},
    commerce:{name:'Commerce',description:'For shops with a product catalog, product images and lead follow-up.',price:649,modules:['knowledge','commerce','images'],limits:{...base,messages:3000,llmCalls:2500,images:100,embeddings:1000,monthlyUsd:18,products:300,documents:10,storageMb:150}},
    growth:{name:'Growth',description:'Higher capacity for established teams with up to two WhatsApp numbers.',price:1099,modules:['knowledge','services','commerce','images'],limits:{...base,messages:8000,llmCalls:6500,images:300,embeddings:3000,monthlyUsd:45,numbers:2,products:1000,documents:30,storageMb:400}}
  };
  const features = {knowledge:'FAQs and PDF knowledge',services:'Services and appointments',commerce:'Product catalog',images:'Product images',qr:'QR connection (experimental)'};
  const labels = {messages:'Customer messages',llmCalls:'AI replies',images:'Images',embeddings:'Document indexing',monthlyUsd:'AI spend ceiling (USD)',numbers:'WhatsApp numbers',products:'Products',documents:'PDF documents',storageMb:'Document storage (MB)'};
  async function renderClient({root,shell,header,escape,toast,api,bind}) {
    const [catalog, account] = await Promise.all([api('/portal/plans'),api('/client/profile')]);
    const plans = catalog.plans || [], profile = account.profile;
    root.innerHTML = shell(header('Choose a plan','Pick the features that fit your business. Your administrator confirms the final offer.') +
      `<div class="plan-grid">${plans.map(plan => {
        const current = profile.plan?.id === plan.id;
        return `<article class="card plan"><span class="badge ${current?'green':''}">${current?'Current plan':'Available'}</span><h2>${escape(plan.name)}</h2><p class="muted small">${escape(plan.description)}</p><div class="plan-price">${escape(plan.price)} <small>${escape(plan.currency)} / month</small></div><ul>${plan.modules.map(module => `<li>${escape(features[module] || module)}</li>`).join('') || '<li>Core chatbot</li>'}<li>Lead follow-up and CSV export</li></ul><button class="btn ${current?'secondary':''}" data-plan="${escape(plan.id)}" ${current?'disabled':''}>${current?'Assigned':'Request this plan'}</button></article>`;
      }).join('') || '<p class="empty">Plans will appear here when your administrator publishes them.</p>'}</div>`,false,'Plans');
    root.querySelectorAll('[data-plan]').forEach(button => button.onclick = async () => {
      try {await api('/client/plan-request',{method:'POST',body:JSON.stringify({planId:button.dataset.plan})});toast('Plan request sent to your administrator.');}
      catch(error) {toast(error.message,true);}
    });
    bind();
  }
  async function renderAdmin({root,shell,header,escape,toast,api,bind,go}) {
    const response = await api('/admin/plans');
    const plans = response.plans || [];
    const list = () => {
      const missing = Object.entries(presets).filter(([,preset]) => !plans.some(plan => plan.name.trim().toLowerCase() === preset.name.toLowerCase()));
      root.innerHTML = shell(header('Plans','Create clear offers for clients and keep provider costs under control.','<button class="btn" id="new-plan" type="button">Create plan</button>') +
        `<div class="notice">Saved plans appear below. Suggested offers are examples until you save them as drafts; only published plans are visible to clients. Existing accounts keep their assigned plan until you update them.</div><div class="section-heading"><div><h2>Saved plans</h2><p class="muted small">These are the actual offers in your account.</p></div></div><div class="plan-grid">${plans.map(plan => `<article class="card plan"><span class="badge ${plan.published?'green':''}">${plan.published?'Published':'Draft'}</span><h2>${escape(plan.name)}</h2><p class="muted small">${escape(plan.description)}</p><div class="plan-price">${escape(plan.price)} <small>${escape(plan.currency)} / month</small></div><p class="small muted">${plan.modules.map(m => escape(features[m] || m)).join(' · ') || 'Core chatbot'}</p><ul><li>${plan.limits.messages === -1 ? 'Unlimited inbound messages' : plan.limits.messages + ' customer messages'}</li><li>${plan.limits.numbers} WhatsApp number${plan.limits.numbers===1?'':'s'}</li><li>Internal AI ceiling: $${plan.limits.monthlyUsd}</li></ul><button class="btn secondary edit-plan" data-id="${escape(plan.id)}">Edit plan</button></article>`).join('') || '<p class="empty">No saved plans yet.</p>'}</div><div class="section-heading plan-suggestions-heading"><div><h2>Suggested offers</h2><p class="muted small">Review a template, or save the missing offers as unpublished drafts.</p></div>${missing.length?'<button class="btn secondary" id="save-suggested" type="button">Create '+missing.length+' draft plan'+(missing.length===1?'':'s')+'</button>':''}</div><div class="plan-grid">${Object.entries(presets).map(([key,preset]) => `<article class="card plan"><span class="badge">${missing.some(([id])=>id===key)?'Suggested · not saved':'Already saved'}</span><h2>${escape(preset.name)}</h2><p class="muted small">${escape(preset.description)}</p><div class="plan-price">${preset.price} <small>MAD / month · suggested</small></div><ul><li>${preset.limits.messages} customer messages</li><li>${preset.limits.numbers} WhatsApp number${preset.limits.numbers===1?'':'s'}</li>${preset.modules.includes('commerce')?'<li>COD order workflow can be added per client</li>':''}</ul><button class="btn secondary use-preset" data-preset="${key}" type="button">${missing.some(([id])=>id===key)?'Review & create draft':'Edit saved plan'}</button></article>`).join('')}</div><article class="card plan-cod-guide"><h2>Cash on delivery (COD)</h2><p class="muted small">COD order capture is a client chatbot workflow, not a separate plan. After assigning a Commerce or Growth plan, open that client’s Chatbot controls → Guided workflows → Cash on delivery. Review, test, save and publish the workflow for that client. No COD workflow is activated just by creating a plan.</p></article>`,true,'Plans');
      root.querySelector('#new-plan').onclick = () => editor();
      root.querySelectorAll('.edit-plan').forEach(button => button.onclick = () => editor(plans.find(plan => plan.id === button.dataset.id)));
      root.querySelectorAll('.use-preset').forEach(button => button.onclick = () => {
        const preset = presets[button.dataset.preset];
        const saved = plans.find(plan => plan.name.trim().toLowerCase() === preset.name.toLowerCase());
        if (saved) editor(saved);
        else editor(undefined, button.dataset.preset);
      });
      const saveSuggested = root.querySelector('#save-suggested');
      if (saveSuggested) saveSuggested.onclick = async () => {
        saveSuggested.disabled = true;
        try {
          for (const [,preset] of missing) await api('/admin/plans',{method:'POST',body:JSON.stringify({...preset,currency:'MAD',published:false,template:{}})});
          toast('Suggested plans saved as drafts. Review each plan before publishing.');
          go('/admin/plans');
        } catch (error) { toast(error.message,true); go('/admin/plans'); }
      };
      bind();
    };
    const editor = (existing, suggestedKey) => {
      let plan = existing ? structuredClone(existing) : suggestedKey ? {...presets[suggestedKey],currency:'MAD',published:false,template:{}} : {name:'',description:'',price:0,currency:'MAD',published:false,modules:[],limits:{...base},template:{}};
      root.innerHTML = shell(header(existing?'Edit plan':'Create plan','Choose customer features first, then set internal safeguards.') +
        `<form id="plan-form" class="plan-editor"><article class="card"><h2>Offer</h2>${existing?'':`<div class="field"><label for="plan-preset">Start from a suggested offer</label><select id="plan-preset"><option value="">Custom plan</option>${Object.entries(presets).map(([key,value]) => `<option value="${key}">${escape(value.name)} · suggested ${value.price} MAD</option>`).join('')}</select><span class="hint">Prices are suggestions. Review them before publishing.</span></div>`}<div class="form-grid"><div class="field"><label for="plan-name">Plan name</label><input id="plan-name" required maxlength="100"></div><div class="field"><label for="plan-price">Monthly price</label><input id="plan-price" type="number" min="0" step="0.01" required></div><div class="field"><label for="plan-currency">Currency</label><input id="plan-currency" maxlength="3" required></div><div class="field full"><label for="plan-description">What does the client get?</label><textarea id="plan-description" maxlength="1000"></textarea></div></div></article>`+
        `<article class="card"><h2>Included features</h2><p class="muted small">Only enable what this offer can actually provide.</p><div class="plan-feature-grid">${Object.entries(features).map(([key,label]) => `<label class="plan-feature"><input type="checkbox" data-module="${key}"><span>${escape(label)}</span></label>`).join('')}</div><p class="hint">QR sessions require separate infrastructure; leave off for normal Meta Cloud plans.</p></article>`+
        `<article class="card"><h2>Capacity</h2><div class="form-grid"><div class="field"><label><input id="plan-unlimited" type="checkbox"> Unlimited customer messages</label><span class="hint">AI reply and spend ceilings still apply. Do not market unlimited AI replies.</span></div>${Object.keys(base).map(key => `<div class="field"><label for="plan-${key}">${labels[key]}</label><input id="plan-${key}" type="number" min="0" step="${key==='monthlyUsd'?'0.01':'1'}" required></div>`).join('')}</div></article>`+
        `<details class="card"><summary>Advanced configuration</summary><div class="field"><label for="plan-template">Technical template (JSON)</label><textarea id="plan-template" class="code-editor"></textarea></div></details><article class="card"><label><input id="plan-published" type="checkbox"> Publish this plan so clients can request it</label><p class="hint">Saving does not change plans already assigned to clients.</p></article><div class="sticky-save"><button type="button" class="btn secondary" id="cancel-plan">Cancel</button><button class="btn" type="submit">Save plan</button></div></form>`,true,'Plan');
      const form = root.querySelector('#plan-form');
      const fill = item => {
        plan = {...plan,...item};
        for(const [id,value] of [['name',plan.name],['price',plan.price],['currency',plan.currency],['description',plan.description]]) form.querySelector('#plan-'+id).value = value;
        for(const key of Object.keys(base)) form.querySelector('#plan-'+key).value = plan.limits[key] === -1 ? '' : plan.limits[key];
        form.querySelector('#plan-unlimited').checked = plan.limits.messages === -1;
        form.querySelector('#plan-messages').disabled = plan.limits.messages === -1;
        form.querySelectorAll('[data-module]').forEach(box => box.checked = plan.modules.includes(box.dataset.module));
        form.querySelector('#plan-template').value = JSON.stringify(plan.template || {},null,2);
        form.querySelector('#plan-published').checked = !!plan.published;
      };
      fill(plan);
      if(suggestedKey)form.querySelector('#plan-preset').value=suggestedKey;
      if(!existing) form.querySelector('#plan-preset').onchange = event => {
        const preset = presets[event.target.value];
        if (preset) fill({...preset,currency:'MAD',published:false,template:{}});
      };
      form.querySelector('#plan-unlimited').onchange = event => {const field=form.querySelector('#plan-messages');field.disabled=event.target.checked;if(!event.target.checked&&!field.value)field.value='1000';};
      form.querySelector('#cancel-plan').onclick = list;
      form.onsubmit = async event => {
        event.preventDefault();
        try {
          const limits = Object.fromEntries(Object.keys(base).map(key => [key,Number(form.querySelector('#plan-'+key).value)]));
          if(form.querySelector('#plan-unlimited').checked)limits.messages=-1;
          const modules = [...form.querySelectorAll('[data-module]:checked')].map(box => box.dataset.module);
          if(modules.includes('commerce') && limits.products < 1)throw new Error('Commerce needs room for at least one product.');
          if(modules.includes('images') && limits.images < 1)throw new Error('Product images need a positive image allowance.');
          if(form.querySelector('#plan-published').checked && (limits.llmCalls < 1 || limits.monthlyUsd <= 0))throw new Error('Published AI plans need positive AI reply and spend limits.');
          const payload = {name:form.querySelector('#plan-name').value,description:form.querySelector('#plan-description').value,
            price:Number(form.querySelector('#plan-price').value),currency:form.querySelector('#plan-currency').value,
            published:form.querySelector('#plan-published').checked,modules,
            limits,template:JSON.parse(form.querySelector('#plan-template').value),revision:plan.revision};
          await api(existing ? '/admin/plans/'+encodeURIComponent(existing.id) : '/admin/plans',{method:existing?'PUT':'POST',body:JSON.stringify(payload)});
          toast('Plan saved.');go('/admin/plans');
        } catch(error) {toast(error.message,true);}
      };
      bind();
    };
    list();
  }
  return {renderAdmin,renderClient};
})();
