(() => {
  // Administrator card on a client's account page: the customer wording the
  // chatbot learned for this client. Admins approve, correct or reject it;
  // clients never see this.
  const TABS = { REVIEW: 'To review', APPROVED: 'Approved', REJECTED: 'Rejected' };
  let tab = 'REVIEW';

  async function renderAdminCard(ctx) {
    const { id, escape: esc, toast, api } = ctx;
    const anchor = document.querySelector('#technical');
    if (!anchor) return;
    let card = document.querySelector('#admin-wording-card');
    if (!card) {
      card = document.createElement('article');
      card.className = 'card';
      card.id = 'admin-wording-card';
      anchor.before(card);
    }
    const base = '/admin/accounts/' + encodeURIComponent(id) + '/learned-wording';
    let data;
    try { data = await api(base); }
    catch (error) { card.innerHTML = '<h2>Customer wording</h2><p class="small muted">Learned wording could not be loaded.</p>'; return; }
    const { phrases, items } = data;
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
    const row = p => `<div class="connection-card wording-row" data-id="${esc(p.id)}">
      <div>
        <strong>“${esc(p.example)}”</strong>
        <p class="small muted">${p.itemKey ? `${p.kind === 'service' ? 'Service' : 'Product'}: ${esc(p.itemLabel)} · ` : 'Customers asked for this and the chatbot could not tell which item it is. · '}${seen(p)} ${state(p)}</p>
        <div class="field wording-change" ${p.itemKey ? 'hidden' : ''}><label>This wording means</label><select>${options(p)}</select></div>
      </div>
      <div class="actions">
        ${p.itemKey
          ? `${p.status !== 'APPROVED' ? '<button type="button" class="btn" data-action="APPROVED">Approve</button>' : ''}<button type="button" class="btn secondary" data-action="change">Change</button>${p.status !== 'REJECTED' ? '<button type="button" class="btn secondary" data-action="REJECTED">Reject</button>' : ''}`
          : `<button type="button" class="btn" data-action="meaning">Save meaning</button>${p.status !== 'REJECTED' ? '<button type="button" class="btn secondary" data-action="REJECTED">Not sold here</button>' : ''}`}
      </div>
    </div>`;
    card.innerHTML = `<div class="card-title"><div><h2>Customer wording</h2><p>Words this client's customers use for their products and services, learned by the chatbot. Only administrators see this. "Learning" wording is used once understood the same way twice; approved wording is always used; rejected wording never is.</p></div></div>
      <div class="actions">${Object.entries(TABS).map(([key, label]) => `<button type="button" class="btn ${key === tab ? '' : 'secondary'}" data-tab="${key}">${label} (${count(key)})</button>`).join('')}</div>
      ${rows.length ? rows.map(row).join('') : '<p class="empty compact">Nothing here yet. New wording appears as customers chat with this chatbot.</p>'}`;
    card.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab; renderAdminCard(ctx); });
    card.querySelectorAll('.wording-row').forEach(el => {
      const phraseId = el.dataset.id;
      const phrase = phrases.find(p => p.id === phraseId);
      const box = el.querySelector('.wording-change');
      const save = async (status, itemKey) => {
        try {
          await api(base + '/' + encodeURIComponent(phraseId), { method: 'PATCH', body: JSON.stringify(itemKey ? { status, itemKey } : { status }) });
          toast(status === 'REJECTED' ? 'Wording rejected.' : 'Wording saved.');
          await renderAdminCard(ctx);
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

  window.RelayqoWording = { renderAdminCard };
})();
