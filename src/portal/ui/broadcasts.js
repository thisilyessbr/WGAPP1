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
      <div class="card-title"><div><span class="plan-section-label">WhatsApp campaign</span><h3><bdi>${esc(b.templateName)}</bdi> <small class="muted">${esc(b.language)}</small></h3>
        <p class="broadcast-meta"><span>${esc(when(b.createdAt))}</span> · ${n(b.recipientCount)} <span>recipients</span> · <span>Meta fee ≈</span> <bdi>${esc(usd(b.estimatedCostUsd))}</bdi></p></div>
        <span class="badge ${BADGE[b.status] || ''}">${esc(LABELS[b.status] || b.status)}</span></div>
      <div class="broadcast-row-foot">
        <p class="broadcast-counts">${n(b.sent)} <span>sent</span> · ${n(b.failed)} <span>failed</span> · ${n(b.skipped)} <span>skipped</span>${b.pending ? ` · ${n(b.pending)} <span>waiting</span>` : ''}</p>
        ${['PENDING_APPROVAL', 'SENDING'].includes(b.status) ? `<button class="btn secondary" type="button" data-cancel="${esc(b.id)}">Cancel</button>` : ''}
      </div>
      ${b.reviewNote ? `<p class="muted broadcast-review-note"><span>Note:</span> <bdi>${esc(b.reviewNote)}</bdi></p>` : ''}
    </article>`).join('');

    const optedInCount = Number(data.consent?.optedIn || 0);
    const launchBar = `<div class="admin-launch-bar">
      <span class="launch-step ${hasNumber ? 'is-done' : ''}"><i>${hasNumber ? '✓' : '1'}</i><strong>WhatsApp:</strong> <span>${hasNumber ? 'Official API linked' : 'Link official number'}</span></span>
      <span class="launch-step ${approved.length ? 'is-done' : ''}"><i>${approved.length ? '✓' : '2'}</i><strong>Templates:</strong> ${n(approved.length)} <span>approved</span></span>
      <span class="launch-step ${optedInCount > 0 ? 'is-done' : ''}"><i>${optedInCount > 0 ? '✓' : '3'}</i><strong>Opted in:</strong> ${n(optedInCount)} <span>customers</span></span>
    </div>`;

    const allowanceRow = `<div class="broadcast-allowance">
      <div><span class="broadcast-stat-icon" aria-hidden="true">↗</span><span>Broadcasts left this month</span><p>${n(a.remaining.broadcasts)} <small>/</small> ${n(a.limit.broadcasts)}</p><i style="--usage:${Math.min(100, Math.max(0, 100 - (a.remaining.broadcasts / Math.max(1, a.limit.broadcasts) * 100)))}%"></i></div>
      <div><span class="broadcast-stat-icon" aria-hidden="true">◎</span><span>Recipients left this month</span><p>${n(a.remaining.recipients)} <small>/</small> ${n(a.limit.recipients)}</p><i style="--usage:${Math.min(100, Math.max(0, 100 - (a.remaining.recipients / Math.max(1, a.limit.recipients) * 100)))}%"></i></div></div>`;

    const compose = !hasNumber
      ? `<div class="broadcast-empty-box"><p class="empty compact">Broadcasts need a WhatsApp number connected through Meta. The QR connection cannot send broadcasts (WhatsApp would block the number).</p><div class="actions"><a class="btn secondary" href="/app/whatsapp" data-route>Connect WhatsApp</a></div></div>`
      : !approved.length
        ? `<div class="broadcast-empty-box"><p class="empty compact">No approved template yet. Create one in Meta WhatsApp Manager, wait for approval, then press “Sync templates”.</p></div>`
        : `<form id="broadcast-form" class="broadcast-form">
          <div class="broadcast-form-row">
            <label class="field"><span>Template</span><select id="bc-template">${approved.map(x => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.language)} · ${esc(x.category)}</option>`).join('')}</select></label>
            <label class="field"><span>Send from</span><select id="bc-number">${data.numbers.map(x => `<option value="${esc(x.phoneNumberId)}">${esc(x.displayPhoneNumber || x.phoneNumberId)}</option>`).join('')}</select></label>
          </div>
          <div class="broadcast-preview-wrap">
            <span class="broadcast-preview-label">Message preview</span>
            <blockquote id="bc-preview" class="broadcast-preview" data-no-translate dir="auto"></blockquote>
          </div>
          <div id="bc-variables" class="broadcast-variables"></div>
          <fieldset><legend>Audience: opted-in customers</legend>
            <label class="field"><span>Active in the last</span><select id="bc-days"><option value="">Any time</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></label>
            <div class="broadcast-statuses">${LEAD_STATUSES.map(([value, label]) => `<label class="check"><input type="checkbox" value="${value}" data-lead-status> <span>${label}</span></label>`).join('')}</div>
            <small class="muted">Leave the request types empty to include every opted-in customer.</small>
          </fieldset>
          <div id="bc-estimate" class="broadcast-estimate" aria-live="polite"></div>
          <button class="btn" type="submit" id="bc-send">${data.requiresApproval ? 'Send for approval' : 'Send broadcast'}</button>
        </form>`;

    root.innerHTML = shell(header('Broadcasts', 'Turn customer consent into timely WhatsApp campaigns—and know the audience and Meta cost before anything is sent.',
      `<button class="btn secondary" type="button" id="bc-sync" ${hasNumber ? '' : 'disabled'}>Sync templates</button>`) +
      launchBar +
      `<section class="broadcast-hero"><div><span class="plan-section-label">Customer re-engagement</span><h2>Bring the right customers back at the right moment.</h2><p>Use Meta-approved templates, target only opted-in contacts and keep every send inside your monthly plan allowance.</p></div><ol class="broadcast-steps"><li><span>1</span><b>Choose a message</b><small>Sync an approved Meta template.</small></li><li><span>2</span><b>Refine the audience</b><small>Filter opted-in customers by activity and status.</small></li><li><span>3</span><b>Review and send</b><small>Confirm reach and estimated Meta fees.</small></li></ol></section>`+
      allowanceRow +
      `<div class="grid-2 broadcast-grid">
        <article class="card broadcast-compose-card"><div class="card-title"><div><span class="plan-section-label">Create campaign</span><h2>New broadcast</h2></div><span class="feature-chip">WhatsApp</span></div>${compose}</article>
        <article class="card broadcast-consent-card"><div class="card-title"><div><span class="plan-section-label">Permission first</span><h2>Customers who agreed</h2></div><span class="feature-chip safe">Opt-in only</span></div>
          <div class="broadcast-consent"><div class="is-opted-in"><span>Opted in</span>${n(data.consent?.optedIn)}</div><div><span>Opted out</span>${n(data.consent?.optedOut)}</div></div>
          <p class="muted small">Customers who reply STOP, وقف or nlghi are removed automatically and never re-added by an import.</p>
          <form id="consent-form" class="broadcast-form">
            <label class="field"><span>Phone numbers, one per line</span><textarea id="consent-phones" rows="4" dir="ltr" placeholder="0612345678&#10;+212 7 00 00 00 01"></textarea></label>
            <label class="field"><span>How did they agree?</span><input id="consent-evidence" maxlength="500" placeholder="Ticked “send me offers” at checkout"></label>
            <label class="check consent-check"><input type="checkbox" id="consent-confirm"> <span>Every customer on this list agreed to receive WhatsApp messages from my business.</span></label>
            <button class="btn secondary" type="submit">Add customers</button>
          </form>
        </article>
      </div>
      <div class="broadcast-history-section"><h2 class="section-title">History</h2>${history ? `<div class="broadcast-history-list">${history}</div>` : '<p class="empty compact">No broadcasts yet.</p>'}</div>`, false, 'Broadcasts');

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
          `<label class="field"><span><span>Template value</span> <bdi>{{${i + 1}}}</bdi></span><input data-variable maxlength="200" required dir="auto" placeholder="{{${i + 1}}}"></label>`).join('');
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
    return `<article class="card admin-attention broadcast-review"><div class="card-title"><div><span class="plan-section-label">Campaign review</span><h2>Broadcasts awaiting approval</h2>
      <p>Check the text and audience size before customers receive it.</p></div><span class="badge orange">${items.length}</span></div>
      ${items.map(b => `<div class="attention-row"><div class="broadcast-review-body"><strong>${esc(b.accountName)}</strong> · <bdi>${esc(b.templateName)}</bdi> (${esc(b.language)}) · ${n(b.recipientCount)} <span>recipients</span> · ≈ <bdi>${esc(usd(b.estimatedCostUsd))}</bdi>
        <small class="broadcast-review-text" dir="auto" data-no-translate>${esc(b.body)}</small><small class="muted"><span>Values:</span> <bdi>${esc((b.variables || []).join(' · ') || '—')}</bdi></small></div>
        <span class="broadcast-review-actions"><button class="btn" type="button" data-review="${esc(b.id)}" data-approve="true">Approve</button>
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
