(() => {
  // Install Relayqo as a phone app, the way big apps do it on the web:
  //  - phones: a slim banner at the top (icon, name, Install, ×); closing it hides it for 14 days;
  //  - iPhone (no browser prompt): Install opens a 3-step sheet for Safari's "Add to Home Screen";
  //  - desktop: the small "Install app" button in the title bar;
  //  - Settings › App: an "Install the app" row while the app is not installed.
  let deferred = null;
  const DISMISS_KEY = 'relayqo-install-dismissed-at', DISMISS_DAYS = 14;
  const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const phone = () => window.matchMedia?.('(max-width:760px)').matches;
  const installable = () => !standalone() && (deferred || ios());
  const forced = () => /[?&]install=1\b/.test(location.search);
  const dismissed = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 86400000; } catch { return false; } };
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {} };

  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; decorate(); });
  window.addEventListener('appinstalled', () => { deferred = null; removeAll(); });

  function removeAll() { document.querySelectorAll('#install-app,.install-banner,.install-pref-row').forEach(el => el.remove()); }

  async function install() {
    if (deferred) {
      const prompt = deferred; deferred = null;
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') removeAll(); else decorate();
      return;
    }
    if (ios()) showIosSheet();
  }

  const shareIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const addIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  const bellIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  function showIosSheet() {
    document.querySelector('.install-sheet')?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'install-sheet';
    sheet.innerHTML = `<div class="install-sheet-backdrop" data-close></div>
      <section class="install-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="install-sheet-title">
        <span class="install-sheet-grip" aria-hidden="true"></span>
        <img class="install-sheet-icon" src="/portal-assets/app-icon-192.png" alt="" width="64" height="64">
        <h2 id="install-sheet-title">Install Relayqo on your iPhone</h2>
        <p>Three taps in Safari. Relayqo then opens from your home screen, full screen, with alerts.</p>
        <ol class="install-steps">
          <li><span class="install-step-icon">${shareIcon}</span><span>Tap Share in Safari’s toolbar</span></li>
          <li><span class="install-step-icon">${addIcon}</span><span>Choose Add to Home Screen, then Add</span></li>
          <li><span class="install-step-icon">${bellIcon}</span><span>Open Relayqo from your home screen and turn on alerts</span></li>
        </ol>
        <button type="button" class="btn install-sheet-done" data-close>Got it</button>
      </section>`;
    sheet.querySelectorAll('[data-close]').forEach(el => el.onclick = () => sheet.remove());
    document.body.append(sheet);
    sheet.querySelector('.install-sheet-done').focus();
  }

  function banner() {
    if (!phone() || !installable() || (dismissed() && !forced()) || document.querySelector('.install-banner')) return;
    const bar = document.createElement('aside');
    bar.className = 'install-banner'; bar.setAttribute('aria-label', 'Install the app');
    bar.innerHTML = `<button type="button" class="install-banner-close" aria-label="Close">×</button>
      <img class="install-banner-icon" src="/portal-assets/app-icon-192.png" alt="" width="44" height="44">
      <span class="install-banner-text"><strong>Relayqo</strong><small>Install the app · alerts and one-tap replies</small></span>
      <button type="button" class="install-banner-cta">Install</button>`;
    bar.querySelector('.install-banner-close').onclick = () => { dismiss(); bar.remove(); };
    bar.querySelector('.install-banner-cta').onclick = install;
    document.body.prepend(bar);
  }

  function titleBarButton() {
    const actions = document.querySelector('.top-actions');
    if (!actions || phone() || !installable() || document.querySelector('#install-app')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'install-app'; button.className = 'notification-toggle install-app';
    button.innerHTML = '<span aria-hidden="true">⤓</span><span>Install app</span>';
    button.onclick = install;
    actions.prepend(button);
  }

  function settingsRow() {
    const prefs = document.querySelector('.mobile-prefs');
    if (!prefs || !installable() || prefs.querySelector('.install-pref-row')) return;
    const row = document.createElement('div');
    row.className = 'mobile-pref-row install-pref-row';
    row.innerHTML = '<span>Install the app</span><button type="button" class="btn install-pref-button">Install</button>';
    row.querySelector('button').onclick = install;
    prefs.querySelector('h2')?.after(row);
  }

  function decorate() {
    if (standalone()) { removeAll(); return; }
    banner(); titleBarButton(); settingsRow();
    window.RelayqoI18n?.decorate?.();
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(decorate, 0));
  window.RelayqoInstall = { decorate, install };
})();
