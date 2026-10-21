(() => {
  let ctx, timer, lastMessageId, lastUnread = 0, audioReady = false, accountKey = '';

  const base64UrlToUint8Array = value => {
    const padded = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  };

  function unlockAudio() {
    if (audioReady) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audio = new AudioCtx();
      audio.resume().then(() => { audioReady = true; audio.close(); }).catch(() => {});
    } catch {}
  }

  function chime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audio = new AudioCtx(), gain = audio.createGain(), oscillator = audio.createOscillator();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(660, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, audio.currentTime + .12);
      gain.gain.setValueAtTime(.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.12, audio.currentTime + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .28);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .3);
      oscillator.onended = () => audio.close();
    } catch {}
  }

  function updateBadge(unread) {
    lastUnread = unread;
    document.querySelectorAll('a[href="/app/inbox"]').forEach(link => {
      let badge = link.querySelector('.nav-unread-badge');
      if (!unread) { badge?.remove(); return; }
      if (!badge) { badge = document.createElement('span'); badge.className = 'nav-unread-badge'; link.append(badge); }
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.setAttribute('aria-label', `${unread} unread conversations`);
    });
  }

  async function poll(initial = false) {
    if (!ctx) return;
    try {
      const summary = await ctx.api('/client/notifications/summary');
      updateBadge(Number(summary.unread || 0));
      const stored = localStorage.getItem(accountKey);
      if (initial && stored) lastMessageId = stored;
      if (!lastMessageId) lastMessageId = summary.latestMessageId;
      else if (summary.latestMessageId && summary.latestMessageId !== lastMessageId) {
        lastMessageId = summary.latestMessageId;
        if (audioReady) chime();
      }
      if (summary.latestMessageId) localStorage.setItem(accountKey, summary.latestMessageId);
    } catch {}
  }

  async function currentSubscription() {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.register('/portal-push-sw.js', { scope: '/' });
    return { registration, subscription: await registration.pushManager.getSubscription() };
  }

  async function toggle(button) {
    button.disabled = true;
    try {
      const config = await ctx.api('/client/notifications/config');
      if (!config.supported) throw new Error('Push notifications are not configured yet.');
      const current = await currentSubscription();
      if (current.subscription) {
        await ctx.api('/client/notifications/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: current.subscription.endpoint }) });
        await current.subscription.unsubscribe();
        ctx.toast('Browser notifications turned off.');
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission was not allowed.');
        const subscription = await current.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(config.publicKey) });
        await ctx.api('/client/notifications/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
        ctx.toast('Inbox notifications are on.');
      }
      await decorate();
    } catch (error) { ctx.toast(error.message || 'Could not update notifications.', true); }
    finally { button.disabled = false; }
  }

  async function decorate() {
    if (!ctx) return;
    updateBadge(lastUnread);
    const actions = document.querySelector('.top-actions');
    if (!actions || document.querySelector('#inbox-notification-toggle')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'inbox-notification-toggle'; button.className = 'notification-toggle';
    button.setAttribute('aria-label', 'Inbox notifications');
    let active = false;
    try { active = Boolean((await currentSubscription())?.subscription); } catch {}
    button.innerHTML = `<span aria-hidden="true">${active ? '🔔' : '♢'}</span><span>${active ? 'Alerts on' : 'Enable alerts'}</span>`;
    button.onclick = () => toggle(button);
    actions.prepend(button);
  }

  function start(context) {
    ctx = context; accountKey = `relayqo:last-inbox:${context.accountId || 'default'}`;
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    clearInterval(timer); void poll(true); timer = setInterval(() => void poll(false), 12000); void decorate();
  }

  function stop() { clearInterval(timer); timer = null; ctx = null; }
  window.RelayqoNotifications = { start, stop, decorate, poll };
})();
