(() => {
  const labels = { ALL: 'All', NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', WON: 'Won', LOST: 'Lost', DONE: 'Done' };

  const date = value => value ? new Date(value).toLocaleString() : '—';
  const toLocalDateTimeValue = value => {
    if (!value) return '';
    const dateValue = new Date(value);
    if (!Number.isFinite(dateValue.getTime())) return '';
    return new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const nameOf = lead => lead.customerMetadata?.name || lead.customerMetadata?.pushName || lead.customerPhone || 'Customer';

  async function renderServiceRequests(ctx, id, commerce = false) {
    const { root, shell, header, escape: esc, toast, api, bind, go } = ctx;
    const requestOf = lead => lead.details?.request || lead.interest || lead.sourceRequest || (commerce ? 'Customer asked about a product' : 'Customer asked about a service');
    const isHandled = lead => ['DONE', 'WON', 'LOST'].includes(lead.status);
    const isPlanned = lead => !isHandled(lead) && lead.followUpAt && new Date(lead.followUpAt) > new Date();
    const labelOf = lead => isHandled(lead) ? 'Done' : isPlanned(lead) ? 'Later' : 'Needs reply';
    const save = async (leadId, changes) => {
      await api('/client/leads/' + encodeURIComponent(leadId), { method: 'PATCH', body: JSON.stringify(changes) });
      toast('Request saved.');
      await renderServiceRequests(ctx, id, commerce);
    };
    if (id) {
      const { lead } = await api('/client/leads/' + encodeURIComponent(id));
      const request = requestOf(lead);
      const details = lead.details && typeof lead.details === 'object' && !Array.isArray(lead.details) ? lead.details : {};
      root.innerHTML = shell(header('Customer request', 'See what the customer needs, then choose the next step.', '<a class="btn secondary" href="/app/leads" data-route>All requests</a>') +
        `<div class="service-request-detail"><article class="card service-request-main"><div class="service-request-head"><span class="badge ${isHandled(lead) ? 'green' : isPlanned(lead) ? 'blue' : 'orange'}">${labelOf(lead)}</span><span class="small muted">Received ${esc(date(lead.createdAt))}</span></div><p class="eyebrow">Customer</p><h2>${esc(nameOf(lead))}</h2><p class="service-request-quote">${esc(request)}</p>${lead.conversationId ? `<a class="btn" href="/app/inbox/${encodeURIComponent(lead.conversationId)}" data-route>Reply</a>` : ''}<p class="small muted">A reminder brings this customer back to Needs reply. It does not send them a message.</p></article>
        <article class="card service-request-next"><h2>What happens next?</h2>${isPlanned(lead) ? `<p class="service-reminder-current">Back in Needs reply on <strong>${esc(date(lead.followUpAt))}</strong></p>` : isHandled(lead) ? '<p>Done. Reopen if this customer needs more help.</p>' : '<p>Reply to the customer now, or set a time to come back to this request.</p>'}<form id="service-request-form"><div class="field"><label for="service-reminder">Remind me on</label><input id="service-reminder" type="datetime-local" value="${esc(toLocalDateTimeValue(lead.followUpAt))}"></div><div class="field"><label for="service-note">Private note <span class="muted">(optional)</span></label><textarea id="service-note" maxlength="2000" rows="3" placeholder="What should you check before replying?">${esc(lead.note || '')}</textarea></div><div class="service-request-actions"><button class="btn" type="button" id="service-remind">Remind me later</button><button class="btn secondary" type="submit">Save changes</button>${isHandled(lead) ? '<button class="btn secondary" type="button" id="service-reopen">Reopen</button>' : '<button class="btn secondary" type="button" id="service-done">Done</button>'}</div></form><details class="service-request-more"><summary>More details</summary><p>${commerce ? 'Sales details are optional. A request is not a confirmed order.' : 'Details are optional. A request is not a confirmed booking.'}</p><div class="field"><label for="service-customer-name">Customer name</label><input id="service-customer-name" maxlength="150" value="${esc(details.customerName || '')}"></div>${commerce ? `<div class="field"><label for="sales-stage">Sales stage</label><select id="sales-stage">${['NEW','CONTACTED','QUALIFIED','WON','LOST','DONE'].map(stage => `<option value="${stage}" ${lead.status === stage ? 'selected' : ''}>${stage === 'DONE' ? 'Done' : labels[stage]}</option>`).join('')}</select></div>${[['product','Product'],['quantity','Quantity'],['city','Delivery city'],['address','Delivery address']].map(([key,label]) => `<div class="field"><label for="sales-${key}">${label}</label><input id="sales-${key}" data-sales-field="${key}" maxlength="${key === 'address' ? 500 : 150}" value="${esc(details[key] ?? lead.workflowDetails?.[key] ?? (key === 'product' ? lead.workflowDetails?.product_name : undefined) ?? '')}"></div>`).join('')}` : `<div class="field"><label for="service-service">Service or course</label><input id="service-service" maxlength="150" value="${esc(details.service || '')}"></div><div class="field"><label for="service-preferred">Customer's preferred time</label><input id="service-preferred" maxlength="150" value="${esc(details.preferredTime || '')}"></div>`}</details></article></div>`, false, 'Follow-ups');
      const form = document.querySelector('#service-request-form');
      const team = (await api('/client/team')).members || [];
      form.querySelector('#service-reminder').closest('.field').insertAdjacentHTML('afterend', `<div class="field"><label for="request-assignee">Who will handle this?</label><select id="request-assignee"><option value="">Unassigned · account team</option>${team.map(member => `<option value="${esc(member.id)}" ${lead.assignedToUserId === member.id ? 'selected' : ''}>${esc(member.name)}</option>`).join('')}</select></div>`);
      const payload = () => ({
        note: document.querySelector('#service-note').value,
        assignedToUserId: document.querySelector('#request-assignee').value || null,
        followUpAt: document.querySelector('#service-reminder').value ? new Date(document.querySelector('#service-reminder').value).toISOString() : null,
        ...(commerce ? { status: document.querySelector('#sales-stage').value } : {}),
        details: { ...details, customerName: document.querySelector('#service-customer-name').value.trim(), request: details.request || request, ...(commerce ? Object.fromEntries([...document.querySelectorAll('[data-sales-field]')].map(input => [input.dataset.salesField, input.value.trim()])) : {service: document.querySelector('#service-service').value.trim(), preferredTime: document.querySelector('#service-preferred').value.trim()}) }
      });
      document.querySelector('#service-remind').onclick = () => { const input = document.querySelector('#service-reminder'); input.focus(); if (input.showPicker) { try { input.showPicker(); } catch (_) {} } };
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
    const filters = [['ACTION', 'Needs reply', summary.needsAction], ['LATER', 'Later', summary.scheduled], ['DONE', 'Done', summary.done]];
    const rows = leads.map(lead => `<article class="service-request-row"><div class="service-request-row-main"><span class="badge ${isHandled(lead) ? 'green' : isPlanned(lead) ? 'blue' : 'orange'}">${labelOf(lead)}</span><h3>${esc(nameOf(lead))}</h3><p>${esc(requestOf(lead))}</p>${isPlanned(lead) ? `<small>Follow up ${esc(date(lead.followUpAt))}</small>` : `<small>Received ${esc(date(lead.createdAt))}</small>`}</div><div class="service-request-row-actions">${lead.conversationId && !isHandled(lead) ? `<a class="btn" href="/app/inbox/${encodeURIComponent(lead.conversationId)}" data-route>Reply</a>` : ''}<a class="btn secondary" href="/app/leads/${encodeURIComponent(lead.id)}" data-route>${isHandled(lead) ? 'View details' : 'Reminder & details'}</a></div></article>`).join('');
    root.innerHTML = shell(header('Follow-ups', commerce ? 'Customers asking about products. Reply, set a reminder, or mark done.' : 'Customers asking about your services. Reply, set a reminder, or mark done.', '<button class="btn secondary" id="export-leads" type="button">Export CSV</button>') +
      `<div class="service-request-overview"><div><span>Needs reply</span><strong>${Number(summary.needsAction || 0)}</strong></div><div><span>Later</span><strong>${Number(summary.scheduled || 0)}</strong></div><div><span>Done</span><strong>${Number(summary.done || 0)}</strong></div></div><article class="card service-request-list"><div class="card-title"><div><h2>${filters.find(item => item[0] === view)[1]}</h2><p>${view === 'ACTION' ? 'Open the chat to answer, or choose a reminder.' : view === 'LATER' ? 'Requests return to Needs reply when their reminder is due.' : 'Customers you have finished helping.'}</p></div></div><div class="service-request-tabs">${filters.map(([key, label, count]) => `<button class="service-request-tab ${view === key ? 'is-active' : ''}" type="button" data-view="${key}">${label} <span>${Number(count || 0)}</span></button>`).join('')}</div><div class="service-request-rows">${rows || `<p class="empty compact">${view === 'ACTION' ? 'No customers need a reply right now.' : view === 'LATER' ? 'No reminders planned.' : 'No completed follow-ups yet.'}</p>`}</div><div class="lead-pagination">${offset > 0 ? '<button class="btn secondary" data-page="previous">Previous</button>' : ''}${pagination.hasMore ? '<button class="btn secondary" data-page="next">Next</button>' : ''}</div></article>`, false, 'Follow-ups');
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
    return renderServiceRequests(ctx, id, commerce);
  }

  window.RelayqoLeads = { renderLeads, toLocalDateTimeValue };
})();
