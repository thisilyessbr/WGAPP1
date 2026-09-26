window.RelayqoLeads = (() => {
  const statuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'];
  const labels = {NEW:'New', CONTACTED:'Contacted', QUALIFIED:'Qualified', WON:'Won', LOST:'Lost'};
  async function render({root,shell,header,escape,toast,api,bind,go}) {
    const data = await api('/client/leads');
    const leads = data.leads || [];
    const counts = Object.fromEntries(statuses.map(status => [status, leads.filter(lead => lead.status === status).length]));
    root.innerHTML = shell(header('Leads', 'Follow up on people who showed buying or booking intent.', '<button class="btn secondary" id="export-leads" type="button">Export CSV</button>') +
      `<div class="lead-summary">${statuses.map(status => `<div class="card"><span>${labels[status]}</span><strong data-count="${status}">${counts[status]}</strong></div>`).join('')}</div>` +
      `<article class="card"><div class="section-heading"><div><h2>Lead pipeline</h2><p class="muted small">Lead detection does not confirm an order. Check the conversation before marking a sale.</p>${data.hasMore?'<p class="notice">Showing the latest 1,000 leads. CSV export includes the full history.</p>':''}</div><label class="lead-filter">Status <select id="lead-filter"><option value="">All (${leads.length})</option>${statuses.map(status => `<option value="${status}">${labels[status]} (${counts[status]})</option>`).join('')}</select></label></div><div id="lead-list"></div></article>`, false, 'Leads');
    const list = root.querySelector('#lead-list');
    const details = (d,lead) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return '';
      const fields = [
        ['Customer',d.customer_name || d.name || d.nom],
        ['Phone',d.phone || d.telephone],
        ['Product',d.product || d.produit || d.product_name],
        ['Quantity',d.quantity || d.quantite],
        ['City',d.city || d.ville || d.delivery_city],
        ['Address',d.address || d.adresse || d.delivery_address],
        ['Payment',d.payment || d.payment_method || (String(lead.workflowId || '').startsWith('checkout_') ? 'Cash on delivery' : '')],
        ['Notes',d.notes || d.note]
      ].filter(([,value]) => value !== undefined && value !== null && value !== '');
      return fields.length ? `<details class="lead-ticket"><summary>View captured details</summary><div>${fields.map(([label,value]) => `<span><b>${label}</b>${escape(value)}</span>`).join('')}</div><small>Review the chat before confirming this order.</small></details>` : '';
    };
    const show = () => {
      statuses.forEach(status => {
        const count = leads.filter(lead => lead.status === status).length;
        root.querySelector(`[data-count="${status}"]`).textContent = count;
        root.querySelector(`#lead-filter option[value="${status}"]`).textContent = `${labels[status]} (${count})`;
      });
      const filter = root.querySelector('#lead-filter').value;
      const rows = filter ? leads.filter(lead => lead.status === filter) : leads;
      list.innerHTML = rows.length ? `<div class="lead-table-wrap"><table class="lead-table"><thead><tr><th>Contact</th><th>Order / booking details</th><th>Updated</th><th>Status</th><th>Conversation</th></tr></thead><tbody>${rows.map(lead => `<tr><td><strong>${escape(lead.contact || 'Customer')}</strong></td><td>${details(lead.orderDetails,lead) || '<span class="muted">Not collected</span>'}</td><td>${escape(new Date(lead.updatedAt).toLocaleDateString())}</td><td><select class="lead-status" data-lead="${escape(lead.id)}" aria-label="Status for ${escape(lead.contact || 'customer')}">${statuses.map(status => `<option value="${status}" ${lead.status === status ? 'selected' : ''}>${labels[status]}</option>`).join('')}</select></td><td>${lead.conversationId ? `<a class="row-link" href="/app/inbox/${encodeURIComponent(lead.conversationId)}" data-route>Open chat ›</a>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No leads in this view yet.</p>';
      list.querySelectorAll('.lead-status').forEach(select => select.onchange = async () => {
        const lead = leads.find(item => item.id === select.dataset.lead);
        const previous = lead.status;
        select.disabled = true;
        try { await api('/client/leads/' + encodeURIComponent(lead.id), {method:'PATCH',body:JSON.stringify({status:select.value})}); lead.status = select.value; toast('Lead status updated.'); show(); }
        catch (error) { select.value = previous; select.disabled = false; toast(error.message, true); }
      });
      bind();
    };
    root.querySelector('#lead-filter').onchange = show;
    root.querySelector('#export-leads').onclick = async () => {
      try {
        const response = await fetch('/api/client/leads/export.csv', {credentials:'same-origin'});
        if (!response.ok) throw new Error('Could not export leads. Please try again.');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a'); link.href = url; link.download = 'relayqo-leads.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch(error) { toast(error.message, true); }
    };
    show();
  }
  return {render};
})();
