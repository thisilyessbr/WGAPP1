// Client self-test: chat with your own chatbot (saved data) without sending WhatsApp messages.
(() => {
  const newSession = () => crypto.randomUUID().replaceAll('-', '');
  const state = { session: newSession(), messages: [] };

  function mount(host, { api, toast, escape, beforeSend }) {
    if (!host) return;
    const thread = host.querySelector('.client-test-thread'), input = host.querySelector('#client-test-message'), send = host.querySelector('#client-test-send');
    const render = () => {
      thread.innerHTML = state.messages.length ? state.messages.map(m => {
        const media = (Array.isArray(m.media) ? m.media : []).filter(item => item?.type === 'image' && /^https?:\/\//i.test(String(item.url || ''))).slice(0, 3);
        return `<div class="preview-message ${m.role}"><span>${m.role === 'user' ? 'You (as a customer)' : m.role === 'error' ? 'Error' : m.role === 'system' ? 'Status' : 'Chatbot'}</span><p dir="auto">${escape(m.content)}</p>${media.map(item => `<a class="preview-product-image" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer"><img src="${escape(item.url)}" alt="${escape(item.alt || item.title || 'Product photo')}" loading="lazy"></a>`).join('')}</div>`;
      }).join('') : '<p class="empty compact">Write a message the way a customer would, for example “ch7al taman?” or “wach kayn livraison?”.</p>';
      thread.scrollTop = thread.scrollHeight;
    };
    const submit = async () => {
      const message = input.value.trim(); if (!message) return;
      send.disabled = input.disabled = true;
      state.messages.push({ role: 'user', content: message }); input.value = ''; render();
      try {
        await beforeSend?.();
        const r = await api('/client/preview', { method: 'POST', body: JSON.stringify({ message, sessionId: state.session, mode: 'draft' }) });
        state.messages.push(r.response ? { role: 'assistant', content: r.response, media: r.media }
          : { role: 'system', content: r.automationState === 'waiting_for_team' ? 'The chatbot handed this conversation to your team, so it stopped replying.' : 'No automatic reply was sent.' });
      } catch (e) { state.messages.push({ role: 'error', content: e.message }); toast(e.message, true); }
      finally { send.disabled = input.disabled = false; render(); input.focus(); }
    };
    send.onclick = submit;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    host.querySelector('#client-test-new').onclick = () => { state.session = newSession(); state.messages = []; render(); input.focus(); };
    render();
  }
  window.RelayqoClientTest = { mount };
})();
