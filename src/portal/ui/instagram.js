(() => {
  async function render({ root, shell, header, escape, toast, api, bind }) {
    const data = await api('/instagram/connections');
    const connection = data.connection;
    const notice = new URLSearchParams(location.search);
    const igBar = `<div class="admin-launch-bar"><span class="launch-step ${data.planIncluded ? 'is-done' : ''}"><i>${data.planIncluded ? '✓' : '1'}</i><strong>Plan:</strong> ${data.planIncluded ? 'Instagram included' : 'Upgrade required'}</span><span class="launch-step ${connection ? 'is-done' : ''}"><i>${connection ? '✓' : '2'}</i><strong>Account:</strong> ${connection ? '@' + escape(connection.username || connection.instagramUserId) : 'Not linked'}</span><span class="launch-step ${connection && data.allowed && connection.enabled ? 'is-done' : ''}"><i>${connection && data.allowed && connection.enabled ? '✓' : '3'}</i><strong>Replies:</strong> ${connection && data.allowed && connection.enabled ? 'Active 24/7' : 'Paused'}</span></div>`;
    root.innerHTML = shell(header('Instagram DMs', 'Let your chatbot answer private messages sent to your Instagram professional account.') + igBar +
      `<div class="grid-2"><article class="card"><span class="plan-section-label">Social DM channel</span><h2>Your Instagram account</h2>` +
      (connection ? `<p class="small muted">Connected as <strong>@${escape(connection.username || connection.instagramUserId)}</strong></p>
        <p class="small muted">${data.allowed && connection.enabled ? 'AI replies are enabled.' : 'Instagram replies are currently paused by your administrator or plan.'}</p>
        <div class="actions"><button type="button" class="btn secondary" id="ig-reconnect" ${data.allowed ? '' : 'disabled'}>Reconnect account</button>
        <button type="button" class="btn secondary" id="ig-disconnect">Disconnect</button></div>`
        : `<p class="small muted">No Instagram account connected yet.</p><button type="button" class="btn" id="ig-connect" ${data.configured && data.allowed ? '' : 'disabled'}>Connect Instagram</button>` ) +
      (!data.planIncluded ? '<p class="small muted">Instagram DMs require an Instagram-enabled plan.</p>' : data.allowed ? '' : '<p class="small muted">Your administrator has not enabled Instagram for this account.</p>') +
      (!data.configured ? '<p class="small muted">Instagram setup is not ready yet. Ask your administrator to configure Meta access.</p>' : '') +
      '</article><article class="card"><span class="plan-section-label">Unified knowledge</span><h2>How it works</h2><p>Your chatbot uses the same published business information as WhatsApp. It answers incoming Instagram DMs only. Comments and unsolicited messages are not included.</p><p>A customer must message your professional account first. Human handoff and replies appear in your Inbox with an Instagram label.</p></article></div>', false, 'Instagram');
    bind();
    if (notice.has('connected')) { toast('Instagram connected. Send a DM from another account to test it.'); history.replaceState({}, '', '/app/instagram'); }
    if (notice.has('error')) { toast('Instagram could not connect. Check Meta permissions and try again.', true); history.replaceState({}, '', '/app/instagram'); }
    const connect = async () => {
      try { const result = await api('/instagram/connect/start', { method: 'POST' }); location.assign(result.url); }
      catch (error) { toast(error.message || 'Instagram connection could not start.', true); }
    };
    const start = root.querySelector('#ig-connect') || root.querySelector('#ig-reconnect');
    if (start) start.onclick = connect;
    const disconnect = root.querySelector('#ig-disconnect');
    if (disconnect) disconnect.onclick = async () => {
      if (!confirm('Disconnect this Instagram account? Automatic replies will stop.')) return;
      try { await api('/instagram/disconnect', { method: 'POST' }); await render({ root, shell, header, escape, toast, api, bind }); }
      catch (error) { toast(error.message || 'Instagram could not disconnect.', true); }
    };
  }
  window.RelayqoInstagram = { render };
})();
