(() => {
  const stages = ['ALL', 'NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'];
  const labels = { ALL: 'All', NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', WON: 'Won', LOST: 'Lost', DONE: 'Handled' };
  const signalLabels = { COMPLETED_SALES_WORKFLOW: 'Completed sales request', EXPLICIT_SALES_INTENT: 'Sales request', EXPLICIT_PURCHASE_MESSAGE: 'Purchase request', EXPLICIT_BOOKING_OR_QUOTE: 'Booking or quote request' };
  const date = value => value ? new Date(value).toLocaleString() : '—';
  const toLocalDateTimeValue = value => {
    if (!value) return '';
    const dateValue = new Date(value);
    if (!Number.isFinite(dateValue.getTime())) return '';
    return new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const nameOf = lead => lead.customerMetadata?.name || lead.customerMetadata?.pushName || lead.customerPhone || 'Customer';

  async function renderServiceRequests(ctx, id) {
    const { root, shell, header, escape: esc, toast, api, bind, go } = ctx;
    const requestOf = lead => lead.details?.request || lead.interest || lead.sourceRequest || 'Customer asked about a service';
    const isHandled = lead => ['DONE', 'WON', 'LOST'].includes(lead.status);
    const isPlanned = lead => !isHandled(lead) && lead.followUpAt && new Date(lead.followUpAt) > new Date();
    const labelOf = lead => isHandled(lead) ? 'Handled' : isPlanned(lead) ? 'Planned' : 'Needs reply';
    const save = async (leadId, changes) => {
      await api('/client/leads/' + encodeURIComponent(leadId), { method: 'PATCH', body: JSON.stringify(changes) });
      toast('Request saved.');
      await renderServiceRequests(ctx, id);
    };
    if (id) {
      const { lead } = await api('/client/leads/' + encodeURIComponent(id));
      const request = requestOf(lead);
      const details = lead.details && typeof lead.details === 'object' && !Array.isArray(lead.details) ? lead.details : {};
      root.innerHTML = shell(header('Customer request', 'See what the customer needs, then choose the next step.', '<a class="btn secondary" href="/app/leads" data-route>All requests</a>') +
        `<div class="service-request-detail"><article class="card service-request-main"><div class="service-request-head"><span class="badge ${isHandled(lead) ? 'green' : isPlanned(lead) ? 'blue' : 'orange'}">${labelOf(lead)}</span><span class="small muted">Received ${esc(date(lead.createdAt))}</span></div><p class="eyebrow">Customer</p><h2>${esc(nameOf(lead))}</h2><p class="service-request-quote">${esc(request)}</p>${lead.conversationId ? `<a class="btn" href="/app/inbox/${encodeURIComponent(lead.conversationId)}" data-route>Open conversation ›</a>` : ''}<p class="small muted">This request returns to Needs reply on the chosen date. No notification or WhatsApp message is sent automatically.</p></article>
        <article class="card service-request-next"><h2>What happens next?</h2>${isPlanned(lead) ? `<p class="service-reminder-current">Back in Needs reply on <strong>${esc(date(lead.followUpAt))}</strong></p>` : isHandled(lead) ? '<p>This request is marked handled. Reopen it if you still need to respond.</p>' : '<p>Reply to the customer now, or set a time to come back to this request.</p>'}<form id="service-request-form"><div class="field"><label for="service-reminder">Return to Needs reply on</label><input id="service-reminder" type="datetime-local" value="${esc(toLocalDateTimeValue(lead.followUpAt))}"></div><div class="field"><label for="service-note">Private note <span class="muted">(optional)</span></label><textarea id="service-note" maxlength="2000" rows="3" placeholder="What should you check before replying?">${esc(lead.note || '')}</textarea></div><div class="service-request-actions"><button class="btn" type="submit">Save follow-up</button>${isHandled(lead) ? '<button class="btn secondary" type="button" id="service-reopen">Reopen request</button>' : '<button class="btn secondary" type="button" id="service-done">Mark handled</button>'}</div></form><details class="service-request-more"><summary>More details</summary><p>Use these only if they help your team. A request is not a confirmed booking.</p><div class="field"><label for="service-customer-name">Customer name</label><input id="service-customer-name" maxlength="150" value="${esc(details.customerName || '')}"></div><div class="field"><label for="service-service">Service or course</label><input id="service-service" maxlength="150" value="${esc(details.service || '')}"></div><div class="field"><label for="service-preferred">Customer's preferred time</label><input id="service-preferred" maxlength="150" value="${esc(details.preferredTime || '')}"></div></details></article></div>`, false, 'Requests');
      const form = document.querySelector('#service-request-form');
      const payload = () => ({
        note: document.querySelector('#service-note').value,
        followUpAt: document.querySelector('#service-reminder').value ? new Date(document.querySelector('#service-reminder').value).toISOString() : null,
        details: { ...details, customerName: document.querySelector('#service-customer-name').value.trim(), request: details.request || request, service: document.querySelector('#service-service').value.trim(), preferredTime: document.querySelector('#service-preferred').value.trim() }
      });
      form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('button[type=submit]'); button.disabled = true; try { await save(id, payload()); } catch (error) { toast(error.message, true); button.disabled = false; } };
      const action = document.querySelector(isHandled(lead) ? '#service-reopen' : '#service-done');
      action.onclick = async () => { action.disabled = true; try { await save(id, { ...payload(), status: isHandled(lead) ? 'NEW' : 'DONE', followUpAt: null }); } catch (error) { toast(error.message, true); action.disabled = false; } };
      bind(); return;
    }
    const params = new URLSearchParams(location.search);
    const view = ['ACTION', 'LATER', 'DONE'].includes(params.get('view')) ? params.get('view') : 'ACTION';
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const [{ leads, pagination }, summary] = await Promise.all([
      api('/client/leads?view=' + view + '&limit=20&offset=' + offset), api('/client/leads/summary')
    ]);
    const filters = [['ACTION', 'Needs reply', summary.needsAction], ['LATER', 'Planned', summary.scheduled], ['DONE', 'Handled', summary.done]];
    const rows = leads.map(lead => `<article class="service-request-row"><div class="service-request-row-main"><span class="badge ${isHandled(lead) ? 'green' : isPlanned(lead) ? 'blue' : 'orange'}">${labelOf(lead)}</span><h3>${esc(nameOf(lead))}</h3><p>${esc(requestOf(lead))}</p>${isPlanned(lead) ? `<small>Follow up ${esc(date(lead.followUpAt))}</small>` : `<small>Received ${esc(date(lead.createdAt))}</small>`}</div><div class="service-request-row-actions">${lead.conversationId && !isHandled(lead) ? `<a class="btn" href="/app/inbox/${encodeURIComponent(lead.conversationId)}" data-route>Reply in chat</a>` : ''}<a class="btn secondary" href="/app/leads/${encodeURIComponent(lead.id)}" data-route>${isHandled(lead) ? 'View request' : 'Manage request'}</a></div></article>`).join('');
    root.innerHTML = shell(header('Customer requests', 'Customers who asked about a service or booking. Decide who needs a reply and when.', '<button class="btn secondary" id="export-leads" type="button">Export CSV</button>') +
      `<div class="service-request-overview"><div><span>Needs reply</span><strong>${Number(summary.needsAction || 0)}</strong></div><div><span>Planned</span><strong>${Number(summary.scheduled || 0)}</strong></div><div><span>Handled</span><strong>${Number(summary.done || 0)}</strong></div></div><article class="card service-request-list"><div class="card-title"><div><h2>${filters.find(item => item[0] === view)[1]}</h2><p>${view === 'ACTION' ? 'Open the chat to answer, or choose a reminder.' : view === 'LATER' ? 'Requests return to Needs reply when their reminder is due.' : 'Requests you have finished handling.'}</p></div></div><div class="service-request-tabs">${filters.map(([key, label, count]) => `<button class="service-request-tab ${view === key ? 'is-active' : ''}" type="button" data-view="${key}">${label} <span>${Number(count || 0)}</span></button>`).join('')}</div><div class="service-request-rows">${rows || `<p class="empty compact">${view === 'ACTION' ? 'No customers need a reply right now.' : view === 'LATER' ? 'No reminders planned.' : 'No handled requests yet.'}</p>`}</div><div class="lead-pagination">${offset > 0 ? '<button class="btn secondary" data-page="previous">Previous</button>' : ''}${pagination.hasMore ? '<button class="btn secondary" data-page="next">Next</button>' : ''}</div></article>`, false, 'Requests');
    document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => go('/app/leads?view=' + button.dataset.view));
    document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => go('/app/leads?view=' + view + '&offset=' + (button.dataset.page === 'next' ? offset + 20 : Math.max(0, offset - 20))));
    document.querySelector('#export-leads').onclick = () => exportLeads(toast);
    bind();
  }

  async function exportLeads(toast) {
    try {
      const response = await fetch('/api/client/leads/export.csv', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not export requests.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'relayqo-requests.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast(error.message, true); }
  }

  async function renderLeads(ctx) {
    const { root, shell, header, escape: esc, toast, api, bind, go, path } = ctx;
    const { profile } = await api('/client/profile');
    const commerce = profile.commerceActive === true;
    const id = path.startsWith('/app/leads/') ? path.slice('/app/leads/'.length) : null;
    if (!commerce) return renderServiceRequests(ctx, id);
    const noun = commerce ? 'Lead' : 'Inquiry';
    const plural = commerce ? 'Leads' : 'Inquiries';
    const stageLabels = commerce ? labels : { ...labels, WON: 'Confirmed', LOST: 'Closed' };
    if (id) {
      const { lead } = await api('/client/leads/' + encodeURIComponent(id));
      const followUpValue = toLocalDateTimeValue(lead.followUpAt);
      const workflow = lead.workflowDetails && typeof lead.workflowDetails === 'object' && !Array.isArray(lead.workflowDetails) ? lead.workflowDetails : {};
      const saved = lead.details && typeof lead.details === 'object' && !Array.isArray(lead.details) ? lead.details : {};
      const fields = [
        ['customerName', 'Customer name', workflow.customer_name || workflow.name],
        ['request', 'Customer request', lead.interest || lead.sourceRequest],
        ['service', 'Service or course', workflow.service],
        ['preferredTime', 'Preferred date or time', workflow.preferred_time || workflow.date]
      ];
      if (commerce) fields.splice(3, 0, ['product', 'Product', workflow.product || workflow.product_name], ['quantity', 'Quantity', workflow.quantity], ['city', 'Delivery city', workflow.city || workflow.ville], ['address', 'Delivery address', workflow.address || workflow.adresse]);
      const ticket = `<div class="lead-ticket"><h3>${commerce ? 'Order details' : 'Inquiry details'}</h3><p class="small muted">${commerce ? 'Check order details with the customer before marking the sale complete.' : 'Use the conversation to confirm the service and preferred time. This is not a confirmed booking.'}</p><div class="lead-ticket-fields">${fields.map(([key,label,detected]) => `<div class="field"><label for="lead-detail-${key}">${label}</label><input id="lead-detail-${key}" data-ticket-field="${key}" maxlength="${key === 'address' || key === 'request' ? 500 : 150}" value="${esc(saved[key] || detected || '')}"></div>`).join('')}</div></div>`;
      root.innerHTML = shell(header(`${noun} details`, 'Follow up with this customer and record the result.', `<a class="btn secondary" href="/app/leads" data-route>All ${plural.toLowerCase()}</a>`) +
        `<div class="lead-detail-grid"><article class="card lead-profile"><p class="eyebrow">Customer</p><h2>${esc(nameOf(lead))}</h2>${nameOf(lead) !== lead.customerPhone ? `<p>${esc(lead.customerPhone || '')}</p>` : ''}<div class="lead-facts"><div><span>${commerce ? 'Interest' : 'Request'}</span><strong>${esc(lead.interest || lead.sourceRequest || 'Not recorded')}</strong></div><div><span>Detected from</span><strong>${esc(signalLabels[lead.signalReason] || (commerce ? 'Sales conversation' : 'Customer conversation'))}</strong></div><div><span>First seen</span><strong>${esc(date(lead.createdAt))}</strong></div></div>${lead.conversationId ? `<a class="btn" href="/app/inbox/${encodeURIComponent(lead.conversationId)}" data-route>Open conversation ›</a>` : '<p class="small muted">Conversation unavailable.</p>'}</article>
        <article class="card lead-action"><h2>Next action</h2><p>${commerce ? 'Update the stage after speaking with the customer. Mark Won only when the order is confirmed.' : 'Track the request and follow up. Mark Confirmed only when the service or booking is agreed.'}</p><form id="lead-form">${ticket}<div class="lead-action-fields"><div class="field"><label for="lead-stage">Stage</label><select id="lead-stage">${stages.filter(s => s !== 'ALL').map(s => `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${stageLabels[s]}</option>`).join('')}</select></div><div class="field"><label for="lead-followup">Follow up at</label><input id="lead-followup" type="datetime-local" value="${esc(followUpValue)}"></div></div><div class="field"><label for="lead-note">Internal note</label><textarea id="lead-note" maxlength="2000" rows="4">${esc(lead.note || '')}</textarea></div><button class="btn" type="submit">Save ${noun.toLowerCase()}</button></form><p class="small muted">Last updated ${esc(date(lead.updatedAt))}</p></article></div>`, false, plural);
      document.querySelector('#lead-form').onsubmit = async event => {
        event.preventDefault();
        const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
        try {
          const rawFollowUp = document.querySelector('#lead-followup').value;
          await api('/client/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({
            status: document.querySelector('#lead-stage').value,
            note: document.querySelector('#lead-note').value,
            followUpAt: rawFollowUp ? new Date(rawFollowUp).toISOString() : null,
            details: Object.fromEntries([...document.querySelectorAll('[data-ticket-field]')].map(input => [input.dataset.ticketField, input.value.trim()]))
          }) });
          toast('Lead updated.'); await renderLeads(ctx);
        } catch (error) { toast(error.message, true); button.disabled = false; }
      };
      bind(); return;
    }

    const selected = new URLSearchParams(location.search).get('stage') || 'ALL';
    const status = stages.includes(selected) ? selected : 'ALL';
    const offset = Math.max(0, Number(new URLSearchParams(location.search).get('offset') || 0) || 0);
    const [{ leads, pagination }, summary] = await Promise.all([
      api('/client/leads?status=' + status + '&limit=20&offset=' + offset),
      api('/client/leads/summary')
    ]);
    const filters = stages.map(stage => `<button type="button" class="lead-filter ${status === stage ? 'is-active' : ''}" data-stage="${stage}">${stageLabels[stage]}</button>`).join('');
    const rows = leads.map(lead => `<a class="lead-row" href="/app/leads/${encodeURIComponent(lead.id)}" data-route><span class="lead-avatar">${esc(nameOf(lead).slice(0, 2).toUpperCase())}</span><span class="lead-row-main"><strong>${esc(nameOf(lead))}</strong><small>${esc(lead.interest || lead.sourceRequest || (commerce ? 'Sales inquiry' : 'Service inquiry'))}</small></span><span class="lead-row-meta"><span class="badge ${lead.status === 'WON' ? 'green' : lead.status === 'LOST' ? 'red' : lead.status === 'NEW' ? 'orange' : 'blue'}">${stageLabels[lead.status] || esc(lead.status)}</span><small>${lead.followUpAt ? 'Follow up ' + esc(date(lead.followUpAt)) : esc(date(lead.updatedAt))}</small></span><b aria-hidden="true">›</b></a>`).join('');
    root.innerHTML = shell(header(plural, commerce ? 'Sales opportunities found in customer conversations.' : 'Service requests and booking inquiries from customer conversations.', '<button class="btn secondary" id="export-leads" type="button">Export CSV</button>') +
      `<div class="lead-stat-grid"><article class="card"><p>New</p><strong>${Number(summary.new || 0)}</strong></article><article class="card"><p>Follow-ups due</p><strong>${Number(summary.dueFollowUps || 0)}</strong></article><article class="card"><p>Qualified</p><strong>${Number(summary.qualified || 0)}</strong></article><article class="card"><p>${stageLabels.WON}</p><strong>${Number(summary.won || 0)}</strong></article></div>
      <article class="card lead-list-card"><div class="card-title"><div><h2>${commerce ? 'Lead queue' : 'Inquiry queue'}</h2><p>New requests and upcoming follow-ups appear here.</p></div><span class="badge blue">${pagination.total} ${pagination.total === 1 ? noun.toLowerCase() : plural.toLowerCase()}</span></div><div class="lead-filters" aria-label="Filter ${noun.toLowerCase()} stage">${filters}</div><div class="lead-rows">${rows || `<p class="empty compact">No ${plural.toLowerCase()} in this stage yet.</p>`}</div><div class="lead-pagination">${offset > 0 ? '<button class="btn secondary" data-page="previous">Previous</button>' : ''}${pagination.hasMore ? '<button class="btn secondary" data-page="next">Next</button>' : ''}</div></article>`, false, plural);
    document.querySelectorAll('[data-stage]').forEach(button => button.onclick = () => go('/app/leads?stage=' + button.dataset.stage));
    document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => go('/app/leads?stage=' + status + '&offset=' + (button.dataset.page === 'next' ? offset + 20 : Math.max(0, offset - 20))));
    document.querySelector('#export-leads').onclick = async () => {
      try {
        const response = await fetch('/api/client/leads/export.csv', {credentials:'same-origin'});
        if (!response.ok) throw new Error('Could not export leads.');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a'); link.href = url; link.download = 'relayqo-leads.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { toast(error.message, true); }
    };
    bind();
  }

  window.RelayqoLeads = { renderLeads, toLocalDateTimeValue };
})();
