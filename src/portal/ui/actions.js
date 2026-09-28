(() => {
  const when = value => value ? new Date(value).toLocaleString() : 'Now';

  async function renderToday(ctx) {
    const { root, shell, header, escape: esc, api, bind } = ctx;
    const actions = await api('/client/actions');
    const handoffs = actions.handoffs || [], requests = actions.requests || [], feedback = actions.feedback || [];
    const row = (item, label, detail) => `<a class="staff-action-row" href="${esc(item.url)}" data-route>
      <span class="staff-action-dot"></span><span><strong>${esc(label)}</strong><small>${detail.split(' · ').map(part=>`<span>${esc(part)}</span>`).join(' · ')}</small></span><span class="staff-action-time">${esc(when(item.at))}</span><b aria-hidden="true">›</b></a>`;
    root.innerHTML = shell(header('Today', 'Everything that needs a person, in one place.') +
      `<div class="staff-action-summary"><div><span>Needs a person</span><strong>${handoffs.length}</strong></div><div><span>Customer requests due</span><strong>${requests.length}</strong></div><div><span>Answers to review</span><strong>${feedback.length}</strong></div></div>
      <article class="card staff-action-card"><h2>Conversations waiting for you</h2><p>Claim the chat to take over. Open chats are shared with your account team.</p>${handoffs.map(item => row(item, item.customer || 'Customer', 'Handoff requested')).join('') || '<p class="empty compact">No handoffs waiting.</p>'}</article>
      <article class="card staff-action-card"><h2>Requests to follow up</h2><p>Open the request, reply to the customer, or choose a later follow-up time.</p>${requests.map(item => row(item, item.customer || 'Customer', (item.at ? 'Follow-up due' : 'New request') + ' · ' + (item.assigneeName || 'Unassigned'))).join('') || '<p class="empty compact">No requests due now.</p>'}</article>
      <article class="card staff-action-card"><h2>Chatbot answers to improve</h2>${feedback.map(item => row(item, 'Answer review', 'Reported issue')).join('') || '<p class="empty compact">No answers flagged.</p>'}</article>`, false, 'Today');
    bind();
  }

  async function renderReviews(ctx, accountId) {
    const { root, shell, header, escape: esc, api, toast, bind } = ctx;
    const admin = Boolean(accountId);
    const base = admin ? `/admin/accounts/${encodeURIComponent(accountId)}` : '/client';
    const { feedback } = await api(base + '/answer-feedback');
    const open = feedback.filter(item => item.status === 'OPEN');
    const history = feedback.filter(item => item.status !== 'OPEN');
    const card = item => `<article class="card answer-review-card" data-review="${esc(item.id)}">
      <div class="card-title"><div><span class="badge ${item.status === 'OPEN' ? 'orange' : 'green'}">${item.status === 'OPEN' ? 'Needs correction' : 'Reviewed'}</span><small>${esc(when(item.createdAt))}</small></div><a class="btn secondary" href="${admin ? `/admin/client/${encodeURIComponent(accountId)}` : `/app/inbox/${encodeURIComponent(item.conversationId)}`}" data-route>${admin ? 'Open client' : 'Open conversation'}</a></div>
      <div class="answer-review-pair"><div><span>Customer asked</span><p>${esc(item.question || 'Question unavailable')}</p></div><div><span>Chatbot replied</span><p>${esc(item.answer)}</p></div></div>
      <p><strong>Why it was flagged:</strong> ${esc(item.note)}</p>
      ${item.retestAt ? `<div class="answer-retest-result"><strong>${esc(item.retestMode)} retest · ${esc(when(item.retestAt))}</strong><p>${esc(item.retestAnswer)}</p></div>` : ''}
      ${item.status === 'OPEN' && admin ? `<div class="answer-review-actions"><a class="btn secondary" href="/admin/business/${encodeURIComponent(accountId)}" data-route>Edit business knowledge</a><button class="btn secondary" type="button" data-retest="draft">Retest draft</button><button class="btn secondary" type="button" data-retest="published">Retest published</button></div><div class="field"><label>What changed?</label><textarea data-resolution maxlength="1000" rows="2" placeholder="Describe the correction and confirm the published retest answer is right."></textarea></div><button class="btn" data-resolve type="button" ${item.retestMode === 'published' ? '' : 'disabled'}>Mark reviewed</button>` : ''}
      ${item.resolutionNote ? `<p class="small muted">Resolution: ${esc(item.resolutionNote)}</p>` : ''}</article>`;
    root.innerHTML = shell(header('Answer reviews', admin ? 'Correct approved knowledge, retest the original question, publish, then confirm the live answer.' : 'Answers reported from your customer conversations. Your administrator can correct and retest them.', admin ? `<a class="btn secondary" href="/admin/client/${encodeURIComponent(accountId)}" data-route>Back to client</a>` : '') +
      `<div class="answer-review-stack"><h2>Open · ${open.length}</h2>${open.map(card).join('') || '<p class="empty">No answers need review.</p>'}<h2>Reviewed · ${history.length}</h2>${history.map(card).join('') || '<p class="empty">No completed reviews yet.</p>'}</div>`, admin, 'Answer reviews');
    if (admin) {
      root.querySelectorAll('[data-retest]').forEach(button => button.onclick = async () => {
        const id = button.closest('[data-review]').dataset.review;
        button.disabled = true;
        try { await api(base + '/answer-feedback/' + encodeURIComponent(id) + '/retest', { method: 'POST', body: JSON.stringify({ mode: button.dataset.retest }) });
          toast('Retest complete. Review the answer before closing.'); await renderReviews(ctx, accountId);
        } catch (error) { toast(error.message, true); button.disabled = false; }
      });
      root.querySelectorAll('[data-resolve]').forEach(button => button.onclick = async () => {
        const article = button.closest('[data-review]'), note = article.querySelector('[data-resolution]').value.trim();
        button.disabled = true;
        try { await api(base + '/answer-feedback/' + encodeURIComponent(article.dataset.review) + '/resolve', { method: 'POST', body: JSON.stringify({ resolutionNote: note }) });
          toast('Review completed.'); await renderReviews(ctx, accountId);
        } catch (error) { toast(error.message, true); button.disabled = false; }
      });
    }
    bind();
  }

  window.RelayqoActions = { renderToday, renderReviews };
})();
