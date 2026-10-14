(() => {
  // Customer wording the chatbot learned for this business. The owner decides:
  // approve (use it), reject (never use it) or say what it means.
  const TABS = { REVIEW: 'To review', APPROVED: 'Approved', REJECTED: 'Rejected' };
  let tab = 'REVIEW';

  async function render(ctx) {
    const { root, shell, header, escape: esc, toast, api, bind } = ctx;
    const { phrases, items } = await api('/client/learned-wording');
    const inTab = p => tab === 'REVIEW' ? p.status === 'AUTO' : p.status === tab;
    // Unmatched wording first: it is what the chatbot cannot answer yet.
    const rows = phrases.filter(inTab).sort((a, b) => Number(Boolean(a.itemKey)) - Number(Boolean(b.itemKey)) || b.hits - a.hits);
    const count = key => phrases.filter(p => key === 'REVIEW' ? p.status === 'AUTO' : p.status === key).length;
    const state = p => p.status === 'APPROVED' ? '<span class="badge green">Approved</span>'
      : p.status === 'REJECTED' ? '<span class="badge">Rejected</span>'
      : !p.itemKey ? '<span class="badge orange">Not matched yet</span>'
      : p.active ? '<span class="badge blue">In use</span>' : '<span class="badge">Learning</span>';
    const options = p => (p.itemKey ? '' : '<option value="">Choose…</option>') + items.filter(i => i.kind === p.kind)
      .map(i => `<option value="${esc(i.key)}" ${i.key === p.itemKey ? 'selected' : ''}>${esc(i.label)}</option>`).join('');
    const seen = p => `Seen ${Number(p.hits) || 1} ${Number(p.hits) === 1 ? 'time' : 'times'}`;
    const row = p => `<article class="service-request-row" data-id="${esc(p.id)}">
      <div class="service-request-row-main">
        <p class="service-request-quote">“${esc(p.example)}”</p>
        <p class="small muted">${p.itemKey ? `${p.kind === 'service' ? 'Service' : 'Product'}: <strong>${esc(p.itemLabel)}</strong> · ` : 'Customers asked for this and your chatbot could not tell which item it is. · '}${seen(p)} ${state(p)}</p>
        <div class="field wording-change" ${p.itemKey ? 'hidden' : ''}><label>This wording means</label><select>${options(p)}</select></div>
      </div>
      <div class="service-request-row-actions">
        ${p.itemKey
          ? `${p.status !== 'APPROVED' ? '<button type="button" class="btn" data-action="APPROVED">Approve</button>' : ''}<button type="button" class="btn secondary" data-action="change">Change</button>${p.status !== 'REJECTED' ? '<button type="button" class="btn secondary" data-action="REJECTED">Reject</button>' : ''}`
          : `<button type="button" class="btn" data-action="meaning">Save meaning</button>${p.status !== 'REJECTED' ? '<button type="button" class="btn secondary" data-action="REJECTED">Not sold here</button>' : ''}`}
      </div>
    </article>`;
    root.innerHTML = shell(header('Customer wording', 'Words your customers use for your products and services, learned by your chatbot. Approve what is right, correct or reject the rest.') +
      `<article class="card service-request-list">
        <div class="service-request-tabs">${Object.entries(TABS).map(([key, label]) => `<button type="button" class="btn ${key === tab ? '' : 'secondary'}" data-tab="${key}">${label} (${count(key)})</button>`).join('')}</div>
        <p class="small muted">"Learning" wording is used once it has been understood the same way twice. Approved wording is always used; rejected wording never is.</p>
        <div class="service-request-rows">${rows.length ? rows.map(row).join('') : '<div class="empty compact">Nothing here yet. New wording appears as customers chat with your chatbot.</div>'}</div>
      </article>`, false, 'Customer wording');
    bind();
    root.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab; render(ctx); });
    root.querySelectorAll('.service-request-row').forEach(el => {
      const id = el.dataset.id;
      const phrase = phrases.find(p => p.id === id);
      const box = el.querySelector('.wording-change');
      const save = async (status, itemKey) => {
        try {
          await api('/client/learned-wording/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(itemKey ? { status, itemKey } : { status }) });
          toast(status === 'REJECTED' ? 'Wording rejected.' : 'Wording saved.');
          await render(ctx);
        } catch (error) { toast(error.message || 'This change could not be saved.', true); }
      };
      el.querySelectorAll('[data-action]').forEach(button => button.onclick = () => {
        const action = button.dataset.action;
        if (action === 'meaning') {
          const value = box.querySelector('select').value;
          if (!value) return toast('Choose what this wording means first.', true);
          return save('APPROVED', value);
        }
        if (action !== 'change') return save(action);
        if (box.hidden) { box.hidden = false; button.textContent = 'Save'; return; }
        save('APPROVED', box.querySelector('select').value || phrase.itemKey);
      });
    });
  }

  window.RelayqoWording = { render };
})();
