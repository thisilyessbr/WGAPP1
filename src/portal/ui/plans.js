window.RelayqoPlans = (() => {
  const base = {messages:1500,llmCalls:1200,images:0,embeddings:500,monthlyUsd:5,numbers:1,products:0,documents:5,storageMb:50,broadcasts:0,broadcastRecipients:0};
  const presets = {
    essentiel:{name:'Essentiel',description:'For service businesses, schools and agencies: answer FAQs and PDFs in Darija, Arabic, French and English, understand voice notes, and capture service inquiries in your team inbox.',price:199,modules:['knowledge','services'],limits:{...base,messages:1500,llmCalls:1200,images:0,embeddings:500,monthlyUsd:5,numbers:1,products:0,documents:5,storageMb:50,broadcasts:0,broadcastRecipients:0}},
    booking:{name:'Rendez-vous',description:'For salons, clinics, doctors and restaurants: everything in Essentiel plus a built-in booking calendar, available time slots and optional Google Calendar sync.',price:299,modules:['knowledge','services','calendar'],limits:{...base,messages:2500,llmCalls:2000,images:0,embeddings:800,monthlyUsd:8,numbers:1,products:0,documents:8,storageMb:75,broadcasts:0,broadcastRecipients:0}},
    commerce:{name:'Commerce',description:'For e-commerce and COD shops: product catalog with photos, sizes and stock, AI product image recognition, COD order capture and orders dashboard.',price:399,modules:['knowledge','commerce','images'],limits:{...base,messages:3500,llmCalls:3000,images:50,embeddings:1200,monthlyUsd:12,numbers:1,products:250,documents:10,storageMb:150,broadcasts:0,broadcastRecipients:0}},
    pro:{name:'Pro Omnicanal',description:'For growing brands: full catalog and COD orders, Instagram DM automation, WhatsApp marketing broadcasts to opted-in customers, and 2 WhatsApp numbers.',price:599,modules:['knowledge','commerce','images','instagram','broadcasts'],limits:{...base,messages:6000,llmCalls:5000,images:150,embeddings:2500,monthlyUsd:20,numbers:2,products:600,documents:20,storageMb:250,broadcasts:4,broadcastRecipients:2000}}
  };
  const presetNames = new Set(Object.values(presets).map(p => p.name.trim().toLowerCase()));
  const features = {knowledge:'FAQs and PDF knowledge',services:'Services and customer inquiries',calendar:'Booking calendar and appointments',commerce:'Product catalog',images:'Product images',instagram:'Instagram DM channel (admin enabled)',qr:'QR connection (experimental)',broadcasts:'Broadcasts to opted-in customers (admin enabled)'};
  const labels = {messages:'Customer messages',llmCalls:'AI replies',images:'Images',embeddings:'Document indexing',monthlyUsd:'AI spend ceiling (USD)',numbers:'WhatsApp numbers',products:'Products',documents:'PDF documents',storageMb:'Document storage (MB)',broadcasts:'Broadcasts per month',broadcastRecipients:'Broadcast recipients per month'};
  const outcomes = {
    services: ['Reply instantly, even after hours', 'Turn conversations into qualified requests'],
    calendar: ['Let customers book without back-and-forth', 'Keep availability and appointments organized'],
    commerce: ['Recommend products and answer buying questions', 'Capture purchase requests while interest is high'],
    broadcasts: ['Bring opted-in customers back with targeted offers', 'See the audience and Meta cost before sending'],
    instagram: ['Handle WhatsApp and Instagram from one assistant', 'Keep the same approved business knowledge everywhere'],
    knowledge: ['Give customers consistent answers from your approved content']
  };
  const number = value => new Intl.NumberFormat(document.documentElement.lang || 'en').format(value);
  // The capacity a client can compare between plans. Each value is its own element so the label stays translatable.
  function limitList(plan, escape) {
    const l = plan.limits || {}, rows = [];
    const row = (value, label) => rows.push(`<li><strong>${escape(value)}</strong> <span>${label}</span></li>`);
    if (l.messages !== undefined) row(l.messages === -1 ? '∞' : number(l.messages), 'customer messages per month');
    if (l.llmCalls !== undefined) row(number(l.llmCalls), 'AI replies per month');
    if (l.numbers !== undefined) row(number(l.numbers), 'WhatsApp numbers');
    if (plan.modules.includes('knowledge') && l.documents !== undefined) row(number(l.documents), 'PDF documents');
    if (plan.modules.includes('commerce') && l.products !== undefined) row(number(l.products), 'products');
    if (plan.modules.includes('images') && l.images !== undefined && l.images > 0) row(number(l.images), 'image analyses per month');
    if (plan.modules.includes('broadcasts') && l.broadcasts !== undefined) { row(number(l.broadcasts), 'broadcasts per month'); row(number(l.broadcastRecipients), 'broadcast recipients per month'); }
    return rows.length ? `<ul class="plan-limits">${rows.join('')}</ul>` : '';
  }
  function requestedNotice(plans, profile, escape) {
    const requested = profile.requestedPlanId && profile.requestedPlanId !== profile.plan?.id ? plans.find(plan => plan.id === profile.requestedPlanId) : null;
    if (!profile.requestedPlanId || profile.requestedPlanId === profile.plan?.id) return '';
    return `<div class="notice plan-request-notice"><strong>Plan request awaiting administrator approval</strong> <span>${escape(requested?.name || '')}</span><br><span>Nothing changes until your administrator approves it. You will see the new features here once it is assigned.</span></div>`;
  }
  function outcomeList(plan) {
    const selected = [];
    for (const module of ['commerce','calendar','services','broadcasts','instagram','knowledge']) {
      for (const item of outcomes[module] || []) if (!selected.includes(item) && selected.length < 3) selected.push(item);
    }
    return `<div class="plan-outcomes"><span class="plan-section-label">Built to help you</span><ul>${selected.map(item => `<li><span class="plan-check" aria-hidden="true">✓</span><span>${item}</span></li>`).join('')}</ul></div>`;
  }
  async function renderClient({root,shell,header,escape,toast,api,bind}) {
    const [catalog, account] = await Promise.all([api('/portal/plans'),api('/client/profile')]);
    const plans = catalog.plans || [], profile = account.profile;
    root.innerHTML = shell(header('Choose a plan','Pick the features that fit your business. Your administrator confirms the final offer.') +
      requestedNotice(plans, profile, escape) +
      `<div class="plan-value-strip"><div><strong>One assistant, ready when customers are.</strong><span>Choose the workflow that matches how your business converts conversations into revenue.</span></div><div><strong>Controlled by your plan.</strong><span>Every optional feature is activated by Relayqo after your request is approved.</span></div><div><strong>Clear monthly capacity.</strong><span>Know what is included before you commit.</span></div></div>`+
      `<div class="plan-grid plan-grid-market">${plans.map((plan, index) => {
        const current = profile.plan?.id === plan.id, requested = !current && profile.requestedPlanId === plan.id;
        const featured = !current && !requested && plans.length > 1 && index === 1;
        return `<article class="card plan plan-market ${current?'is-current':''} ${featured?'is-featured':''}"><div class="plan-card-top"><span class="badge ${current?'green':requested?'orange':''}">${current?'Current plan':requested?'Awaiting approval':featured?'Recommended':'Available'}</span><span class="plan-fit">${plan.modules.includes('commerce')?'For shops':plan.modules.includes('calendar')?'For bookings':'For service teams'}</span></div><h2>${escape(plan.name)}</h2><p class="muted plan-description">${escape(plan.description)}</p><div class="plan-price"><strong>${escape(plan.price)}</strong> <small>${escape(plan.currency)} / month</small></div>${outcomeList(plan)}<details class="plan-details"><summary>See everything included</summary><ul class="plan-feature-list">${plan.modules.map(module => `<li>${escape(features[module] || module)}</li>`).join('') || '<li>Core chatbot</li>'}${plan.modules.includes('commerce') ? '<li>Sales leads and CSV export</li>' : plan.modules.includes('services') ? '<li>Service inquiries and CSV export</li>' : ''}</ul>${limitList(plan, escape)}</details><div class="plan-action"><button class="btn ${current||requested?'secondary':''}" data-plan="${escape(plan.id)}" ${current||requested?'disabled':''}>${current?'Assigned to your workspace':requested?'Awaiting administrator approval':'Request this plan'}</button><small>${current?'Active now':requested?'We will notify you after review':'No feature changes until approval'}</small></div></article>`;
      }).join('') || '<p class="empty">Plans will appear here when your administrator publishes them.</p>'}</div>`+
      '<p class="muted small plan-fees-note">Prices do not include Meta’s WhatsApp fees for template and broadcast messages, which Meta bills to your WhatsApp Business account. Replies to customers who message you first are free.</p>',false,'Plans');
    root.querySelectorAll('[data-plan]').forEach(button => button.onclick = async () => {
      try {await api('/client/plan-request',{method:'POST',body:JSON.stringify({planId:button.dataset.plan})});toast('Plan request sent to your administrator.');await renderClient({root,shell,header,escape,toast,api,bind});}
      catch(error) {toast(error.message,true);}
    });
    bind();
  }
  // A feature page the account cannot use yet: why, which plans include it, and how to ask for it.
  const LOCKED = {
    orders: { module: 'commerce', title: 'Orders', text: 'Follow the cash-on-delivery orders your chatbot takes, from “to confirm” to delivered.' },
    products: { module: 'commerce', title: 'Products', text: 'Give your chatbot your catalog, prices, sizes and photos so it can sell for you.' },
    calendar: { module: 'calendar', title: 'Calendar', text: 'Let customers book appointments in free time slots, with optional Google Calendar sync.' },
    broadcasts: { module: 'broadcasts', title: 'Broadcasts', text: 'Send an approved WhatsApp message to the customers who agreed to hear from you.' }
  };
  async function renderLocked({root,shell,header,escape,toast,api,bind}, key) {
    const feature = LOCKED[key];
    const [catalog, account] = await Promise.all([api('/portal/plans').catch(() => ({ plans: [] })), api('/client/profile')]);
    const profile = account.profile, inPlan = Boolean(profile.plan?.modules?.includes(feature.module));
    const eligible = (catalog.plans || []).filter(plan => plan.modules.includes(feature.module) && plan.id !== profile.plan?.id);
    const requested = eligible.find(plan => plan.id === profile.requestedPlanId);
    const body = inPlan
      ? `<p><strong>Included in your plan, but not turned on yet.</strong></p><p class="muted">Your administrator activates this feature for each account. Contact Relayqo support to have it switched on.</p>`
      : requested
        ? `<p><strong>Plan request awaiting administrator approval</strong></p><p class="muted"><span>${escape(requested.name)}</span> · Nothing changes until your administrator approves it.</p>`
        : `<p><strong>Not included in your current plan.</strong></p>${eligible.length ? `<p class="muted">Plans that include it:</p><div class="locked-plans">${eligible.map(plan => `<div class="locked-plan"><span><strong>${escape(plan.name)}</strong> <small><bdi>${escape(plan.price)}</bdi> <span>${escape(plan.currency)} / month</span></small></span><button class="btn" type="button" data-plan="${escape(plan.id)}">Request this plan</button></div>`).join('')}</div>` : '<p class="muted">No published plan includes it yet. Contact Relayqo support.</p>'}`;
    root.innerHTML = shell(header(feature.title, feature.text) +
      `<article class="card locked-feature"><div class="locked-visual" aria-hidden="true"><span class="locked-orbit"></span><span class="locked-icon">${key==='calendar'?'◷':key==='products'?'◇':key==='orders'?'↗':'✦'}</span></div><div class="locked-content"><span class="plan-section-label">Optional growth feature</span><h2><span>${escape(feature.title)}</span> <span>can be added to your workspace</span></h2>${body}<a class="row-link" href="/app/plans" data-route>Compare plans ›</a></div></article>`, false, feature.title);
    root.querySelectorAll('[data-plan]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try { await api('/client/plan-request',{method:'POST',body:JSON.stringify({planId:button.dataset.plan})}); toast('Plan request sent to your administrator.'); await renderLocked({root,shell,header,escape,toast,api,bind}, key); }
      catch (error) { button.disabled = false; toast(error.message, true); }
    });
    bind();
  }
  async function renderAdmin({root,shell,header,escape,toast,api,bind,go}) {
    const response = await api('/admin/plans');
    let plans = response.plans || [];
    const usageCount = plan => typeof plan.accountsCount === 'number' ? plan.accountsCount : 0;
    const removePlan = async plan => {
      await api('/admin/plans/' + encodeURIComponent(plan.id), { method: 'DELETE' });
      plans = plans.filter(item => item.id !== plan.id);
    };
    const list = () => {
      const missing = Object.entries(presets).filter(([,preset]) => !plans.some(plan => plan.name.trim().toLowerCase() === preset.name.toLowerCase()));
      const unusedPlans = plans.filter(plan => usageCount(plan) === 0);
      root.innerHTML = shell(header('Plans','Create clear offers in MAD for clients and keep provider costs under control.','<button class="btn" id="new-plan" type="button">Create plan</button>') +
        `<div class="notice">Saved plans appear below. Only plans currently used in client accounts are kept; unused plans can be removed at any time.</div><div class="section-heading"><div><h2>Saved plans</h2><p class="muted small">Plans currently saved or assigned to client accounts.</p></div>${unusedPlans.length ? `<button class="btn secondary" id="prune-plans" type="button">Remove ${unusedPlans.length} unused plan${unusedPlans.length===1?'':'s'}</button>` : ''}</div><div class="plan-grid">${plans.map(plan => { const used = usageCount(plan); return `<article class="card plan"><div class="actions"><span class="badge ${plan.published?'green':''}">${plan.published?'Published':'Draft'}</span><span class="badge ${used?'blue':''}">${used?`Used in ${used} account${used===1?'':'s'}`:'Unused'}</span></div><h2>${escape(plan.name)}</h2><p class="muted small">${escape(plan.description)}</p><div class="plan-price">${escape(plan.price)} <small>${escape(plan.currency)} / month</small></div><p class="small muted">${plan.modules.map(m => escape(features[m] || m)).join(' · ') || 'Core chatbot'}</p><ul><li>${plan.limits.messages === -1 ? 'Unlimited inbound messages' : plan.limits.messages + ' customer messages'}</li><li>${plan.limits.llmCalls} AI replies</li><li>${plan.limits.numbers} WhatsApp number${plan.limits.numbers===1?'':'s'}</li><li>Internal AI ceiling: $${plan.limits.monthlyUsd}</li></ul><div class="actions"><button class="btn secondary edit-plan" data-id="${escape(plan.id)}" type="button">Edit plan</button>${used === 0 ? `<button class="btn secondary delete-plan" data-delete-id="${escape(plan.id)}" type="button">Remove</button>` : ''}</div></article>`; }).join('') || '<p class="empty">No saved plans yet. Save or publish the 4 MAD plans below.</p>'}</div><div class="section-heading plan-suggestions-heading"><div><h2>Relayqo MAD plans (4 offers)</h2><p class="muted small">Crafted in MAD for your platform features: Services, Booking Calendar, E-commerce COD, and Pro Omnichannel.</p></div>${missing.length?`<div class="actions"><button class="btn secondary" id="save-suggested" type="button">Create ${missing.length} draft plan${missing.length===1?'':'s'}</button><button class="btn" id="publish-suggested" type="button">Create & publish ${missing.length} plan${missing.length===1?'':'s'}</button></div>`:''}</div><div class="plan-grid">${Object.entries(presets).map(([key,preset]) => `<article class="card plan"><span class="badge">${missing.some(([id])=>id===key)?'Suggested · not saved':'Already saved'}</span><h2>${escape(preset.name)}</h2><p class="muted small">${escape(preset.description)}</p><div class="plan-price">${preset.price} <small>MAD / month</small></div><ul><li>${preset.limits.messages} customer messages · ${preset.limits.llmCalls} AI replies</li><li>${preset.limits.numbers} WhatsApp number${preset.limits.numbers===1?'':'s'} · ${preset.limits.documents} PDF documents</li>${preset.modules.includes('commerce')?`<li>Up to ${preset.limits.products} products · ${preset.limits.images} AI image checks</li><li>COD order workflow can be added per client</li>`:preset.modules.includes('calendar')?'<li>Appointment booking & time slots</li>':'<li>Service inquiries & team inbox</li>'}${preset.modules.includes('instagram')?'<li>Instagram DM + 4 broadcasts / month (2,000 recipients)</li>':''}</ul><button class="btn secondary use-preset" data-preset="${key}" type="button">${missing.some(([id])=>id===key)?'Review & create draft':'Edit saved plan'}</button></article>`).join('')}</div><article class="card plan-cod-guide"><h2>Cash on delivery (COD)</h2><p class="muted small">COD order capture is a client chatbot workflow, not a separate plan. After assigning a Commerce or Pro Omnicanal plan, open that client’s Chatbot controls → Guided workflows → Cash on delivery. Review, test, save and publish the workflow for that client. No COD workflow is activated just by creating a plan.</p></article>`,true,'Plans');
      root.querySelector('#new-plan').onclick = () => editor();
      root.querySelectorAll('.edit-plan').forEach(button => button.onclick = () => editor(plans.find(plan => plan.id === button.dataset.id)));
      root.querySelectorAll('.delete-plan').forEach(button => button.onclick = async () => {
        button.disabled = true;
        const plan = plans.find(item => item.id === button.dataset.deleteId);
        if (!plan) return;
        try { await removePlan(plan); toast('Unused plan removed.'); list(); }
        catch (error) { button.disabled = false; toast(error.message, true); }
      });
      const pruneButton = root.querySelector('#prune-plans');
      if (pruneButton) pruneButton.onclick = async () => {
        pruneButton.disabled = true;
        try {
          await api('/admin/plans/prune', { method: 'POST' });
          toast('Unused plans removed.');
          go('/admin/plans');
        } catch (error) { pruneButton.disabled = false; toast(error.message, true); }
      };
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
          toast('4 MAD plans saved as drafts. Review each plan before publishing.');
          go('/admin/plans');
        } catch (error) { toast(error.message,true); go('/admin/plans'); }
      };
      const publishSuggested = root.querySelector('#publish-suggested');
      if (publishSuggested) publishSuggested.onclick = async () => {
        publishSuggested.disabled = true;
        try {
          for (const [,preset] of missing) await api('/admin/plans',{method:'POST',body:JSON.stringify({...preset,currency:'MAD',published:true,template:{}})});
          toast('Plans created and published.');
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
        for(const key of Object.keys(base)) form.querySelector('#plan-'+key).value = plan.limits[key] === -1 ? '' : (plan.limits[key] ?? base[key]);
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
          if(!existing && modules.includes('commerce') && modules.includes('services'))throw new Error('Choose either a service assistant or a sales assistant for a new offer. Keep legacy mixed plans only for existing clients.');
          if(modules.includes('commerce') && limits.products < 1)throw new Error('Commerce needs room for at least one product.');
          if(modules.includes('images') && limits.images < 1)throw new Error('Product images need a positive image allowance.');
          if(modules.includes('broadcasts') && (limits.broadcasts < 1 || limits.broadcastRecipients < 1))throw new Error('Broadcasts need at least one broadcast and one recipient per month.');
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
  return {renderAdmin,renderClient,renderLocked};
})();
