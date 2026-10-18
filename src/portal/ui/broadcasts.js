(() => {
  // Broadcasts: one approved WhatsApp template sent to the customers who agreed to receive messages.
  // Labels are kept as separate text nodes (numbers in their own elements) so i18n.js can translate them.
  const LABELS = { PENDING_APPROVAL: 'Awaiting approval', SENDING: 'Sending', COMPLETED: 'Sent', CANCELLED: 'Cancelled', REJECTED: 'Not approved' };
  const BADGE = { PENDING_APPROVAL: 'orange', SENDING: 'blue', COMPLETED: 'green', CANCELLED: 'red', REJECTED: 'red' };
  const LEAD_STATUSES = [['NEW', 'New requests'], ['CONTACTED', 'Contacted'], ['QUALIFIED', 'Qualified'], ['WON', 'Customers who bought'], ['LOST', 'Lost']];
  const t = text => window.RelayqoI18n?.t ? window.RelayqoI18n.t(text) : text;
  const lang = () => document.documentElement.lang || 'en';
  const when = value => value ? new Date(value).toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const usd = value => `$${Number(value || 0).toFixed(2)}`;
  const n = value => `<strong class="num">${new Intl.NumberFormat(lang()).format(Number(value || 0))}</strong>`;

  async function render(ctx) {
    const { root, shell, header, escape: esc, toast, api, bind } = ctx;
    const data = await api('/client/broadcasts');
    const approved = data.templates.filter(x => x.status === 'APPROVED');
    const hasNumber = data.numbers.length > 0;
    const a = data.allowance;
    const history = data.broadcasts.map(b => `<article class="card broadcast-row">
      <div class="card-title"><div><h3><bdi>${esc(b.templateName)}</bdi> <small class="muted">${esc(b.language)}</small></h3>
        <p class="broadcast-meta"><span>${esc(when(b.createdAt))}</span> · ${n(b.recipientCount)} <span>recipients</span> · <span>Meta fee ≈</span> <bdi>${esc(usd(b.estimatedCostUsd))}</bdi></p></div>
        <span class="badge ${BADGE[b.status] || ''}">${esc(LABELS[b.status] || b.status)}</span></div>
      <p class="broadcast-counts">${n(b.sent)} <span>sent</span> · ${n(b.failed)} <span>failed</span> · ${n(b.skipped)} <span>skipped</span>${b.pending ? ` · ${n(b.pending)} <span>waiting</span>` : ''}</p>
      ${b.reviewNote ? `<p class="muted"><span>Note:</span> <bdi>${esc(b.reviewNote)}</bdi></p>` : ''}
      ${['PENDING_APPROVAL', 'SENDING'].includes(b.status) ? `<button class="btn secondary" type="button" data-cancel="${esc(b.id)}">Cancel</button>` : ''}
    </article>`).join('');

    const allowanceRow = `<div class="broadcast-allowance">
      <div><span>Broadcasts left this month</span><p>${n(a.remaining.broadcasts)} <small>/</small> ${n(a.limit.broadcasts)}</p></div>
      <div><span>Recipients left this month</span><p>${n(a.remaining.recipients)} <small>/</small> ${n(a.limit.recipients)}</p></div></div>`;

    const compose = !hasNumber
      ? `<p class="empty compact">Broadcasts need a WhatsApp number connected through Meta. The QR connection cannot send broadcasts (WhatsApp would block the number).</p>`
      : !approved.length
        ? `<p class="empty compact">No approved template yet. Create one in Meta WhatsApp Manager, wait for approval, then press “Sync templates”.</p>`
        : `<form id="broadcast-form" class="broadcast-form">
          <label><span>Template</span><select id="bc-template">${approved.map(x => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.language)} · ${esc(x.category)}</option>`).join('')}</select></label>
          <blockquote id="bc-preview" class="broadcast-preview" data-no-translate dir="auto"></blockquote>
          <div id="bc-variables"></div>
          <label><span>Send from</span><select id="bc-number">${data.numbers.map(x => `<option value="${esc(x.phoneNumberId)}">${esc(x.displayPhoneNumber || x.phoneNumberId)}</option>`).join('')}</select></label>
          <fieldset><legend>Audience: opted-in customers</legend>
            <label><span>Active in the last</span><select id="bc-days"><option value="">Any time</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></label>
            <div class="broadcast-statuses">${LEAD_STATUSES.map(([value, label]) => `<label class="check"><input type="checkbox" value="${value}" data-lead-status> <span>${label}</span></label>`).join('')}</div>
            <small class="muted">Leave the request types empty to include every opted-in customer.</small>
          </fieldset>
          <div id="bc-estimate" class="broadcast-estimate" aria-live="polite"></div>
          <button class="btn" type="submit" id="bc-send">${data.requiresApproval ? 'Send for approval' : 'Send broadcast'}</button>
        </form>`;

    root.innerHTML = shell(header('Broadcasts', 'Send an approved WhatsApp template to customers who agreed to hear from you.',
      `<button class="btn secondary" type="button" id="bc-sync" ${hasNumber ? '' : 'disabled'}>Sync templates</button>`) +
      allowanceRow +
      `<div class="grid-2 broadcast-grid">
        <article class="card"><h2>New broadcast</h2>${compose}</article>
        <article class="card"><h2>Customers who agreed</h2>
          <div class="broadcast-consent"><div><span>Opted in</span>${n(data.consent?.optedIn)}</div><div><span>Opted out</span>${n(data.consent?.optedOut)}</div></div>
          <p class="muted">Customers who reply STOP, وقف or nlghi are removed automatically and never re-added by an import.</p>
          <form id="consent-form" class="broadcast-form">
            <label><span>Phone numbers, one per line</span><textarea id="consent-phones" rows="5" dir="ltr" placeholder="0612345678&#10;+212 7 00 00 00 01"></textarea></label>
            <label><span>How did they agree?</span><input id="consent-evidence" maxlength="500" placeholder="Ticked “send me offers” at checkout"></label>
            <label class="check"><input type="checkbox" id="consent-confirm"> <span>Every customer on this list agreed to receive WhatsApp messages from my business.</span></label>
            <button class="btn secondary" type="submit">Add customers</button>
          </form>
        </article>
      </div>
      <h2 class="section-title">History</h2>${history || '<p class="empty compact">No broadcasts yet.</p>'}`, false, 'Broadcasts');

    root.querySelector('#bc-sync')?.addEventListener('click', async event => {
      event.target.disabled = true;
      try { await api('/client/broadcasts/templates/sync', { method: 'POST', body: '{}' }); toast('Templates synced from Meta.'); await render(ctx); }
      catch (error) { event.target.disabled = false; toast(error.message, true); }
    });
    root.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm(t('Cancel this broadcast? Messages already sent cannot be recalled.'))) return;
      try { await api(`/client/broadcasts/${encodeURIComponent(button.dataset.cancel)}/cancel`, { method: 'POST', body: '{}' }); toast('Broadcast cancelled.'); await render(ctx); }
      catch (error) { toast(error.message, true); }
    }));
    root.querySelector('#consent-form').onsubmit = async event => {
      event.preventDefault();
      const phones = root.querySelector('#consent-phones').value.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
      try {
        const r = await api('/client/broadcasts/consent', { method: 'POST', body: JSON.stringify({ phones,
          evidence: root.querySelector('#consent-evidence').value, confirmed: root.querySelector('#consent-confirm').checked }) });
        toast(r.skippedOptOut || r.invalid.length ? 'Customers added. Some numbers were skipped (opted out or invalid).' : 'Customers added.');
        await render(ctx);
      } catch (error) { toast(error.message, true); }
    };

    const form = root.querySelector('#broadcast-form');
    if (form) {
      const template = () => approved.find(x => x.id === root.querySelector('#bc-template').value);
      const segment = () => ({ lastActiveDays: Number(root.querySelector('#bc-days').value) || undefined,
        leadStatuses: [...root.querySelectorAll('[data-lead-status]:checked')].map(box => box.value) });
      let estimateVersion = 0;
      const estimate = async () => {
        const version = ++estimateVersion, out = root.querySelector('#bc-estimate'), send = root.querySelector('#bc-send');
        try {
          const e = await api('/client/broadcasts/estimate', { method: 'POST', body: JSON.stringify({ templateId: template().id, segment: segment() }) });
          if (version !== estimateVersion) return;
          out.innerHTML = `<p>${n(e.recipients)} <span>customers</span> · <span>Meta fee ≈</span> <strong><bdi>${esc(usd(e.estimatedCostUsd))}</bdi></strong></p>
            <small class="muted"><bdi>$${esc(String(Number(e.unitPriceUsd)))}</bdi> <span>per message, estimate. Meta bills your WhatsApp Business account directly.</span></small>
            ${e.capped ? `<small class="muted"><span>Limited per broadcast to</span> ${n(e.maxRecipients)}</small>` : ''}
            ${e.overAllowance === 'broadcasts' ? '<p class="broadcast-warning">This month’s broadcasts are used. Ask your administrator for a larger plan.</p>'
              : e.overAllowance === 'recipients' ? '<p class="broadcast-warning">This audience is larger than the recipients left this month. Narrow the audience or ask for a larger plan.</p>' : ''}`;
          send.disabled = !e.recipients || Boolean(e.overAllowance);
        } catch (error) { if (version === estimateVersion) { out.textContent = error.message; send.disabled = true; } }
      };
      const showTemplate = () => {
        const x = template();
        root.querySelector('#bc-preview').textContent = x.body || '—';
        root.querySelector('#bc-variables').innerHTML = Array.from({ length: Number(x.variableCount) }, (_, i) =>
          `<label><span>Template value</span> <bdi>{{${i + 1}}}</bdi><input data-variable maxlength="200" required dir="auto"></label>`).join('');
        void estimate();
      };
      root.querySelector('#bc-template').onchange = showTemplate;
      root.querySelector('#bc-days').onchange = estimate;
      root.querySelectorAll('[data-lead-status]').forEach(box => box.onchange = estimate);
      form.onsubmit = async event => {
        event.preventDefault();
        const variables = [...root.querySelectorAll('[data-variable]')].map(input => input.value.trim());
        if (!confirm(t(data.requiresApproval ? 'Send this broadcast for approval? It starts once Relayqo approves it.' : 'Send this broadcast now?'))) return;
        const button = root.querySelector('#bc-send'); button.disabled = true;
        try {
          await api('/client/broadcasts', { method: 'POST', body: JSON.stringify({ templateId: template().id,
            phoneNumberId: root.querySelector('#bc-number').value, variables, segment: segment() }) });
          toast(data.requiresApproval ? 'Sent for approval.' : 'Broadcast started.'); await render(ctx);
        } catch (error) { button.disabled = false; toast(error.message, true); }
      };
      showTemplate();
    }
    bind();
  }

  // Admin: broadcasts waiting for a decision during the pilot.
  function adminCard(items, esc) {
    if (!items?.length) return '';
    return `<article class="card admin-attention broadcast-review"><div class="card-title"><div><h2>Broadcasts awaiting approval</h2>
      <p>Check the text and audience size before customers receive it.</p></div><span class="badge orange">${items.length}</span></div>
      ${items.map(b => `<div class="attention-row"><span><strong>${esc(b.accountName)}</strong> · <bdi>${esc(b.templateName)}</bdi> (${esc(b.language)}) · ${n(b.recipientCount)} <span>recipients</span> · ≈ <bdi>${esc(usd(b.estimatedCostUsd))}</bdi><br>
        <small dir="auto" data-no-translate>${esc(b.body)}</small><br><small class="muted"><span>Values:</span> <bdi>${esc((b.variables || []).join(' · ') || '—')}</bdi></small></span>
        <span><button class="btn" type="button" data-review="${esc(b.id)}" data-approve="true">Approve</button>
        <button class="btn secondary" type="button" data-review="${esc(b.id)}" data-approve="false">Reject</button></span></div>`).join('')}</article>`;
  }
  function bindAdmin(root, api, toast, reload) {
    root.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', async () => {
      const approve = button.dataset.approve === 'true';
      const note = approve ? '' : (prompt(t('Why is it not approved? The client sees this note.')) || '');
      if (approve && !confirm(t('Approve and start sending now?'))) return;
      try { await api(`/admin/broadcasts/${encodeURIComponent(button.dataset.review)}/review`, { method: 'POST', body: JSON.stringify({ approve, note }) });
        toast(approve ? 'Broadcast approved.' : 'Broadcast rejected.'); await reload(); }
      catch (error) { toast(error.message, true); }
    }));
  }
  window.RelayqoBroadcasts = { render, adminCard, bindAdmin };
})();
