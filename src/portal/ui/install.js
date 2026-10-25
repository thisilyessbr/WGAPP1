(() => {
  // Chrome and Android offer the install prompt once the page qualifies; keep it for the "Install app" button.
  let deferred = null;
  const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; decorate(); });
  window.addEventListener('appinstalled', () => { deferred = null; document.querySelector('#install-app')?.remove(); });

  // iPhone has no install prompt: say where Safari's "Add to Home Screen" is.
  function showIosHint(button) {
    document.querySelector('.install-hint')?.remove();
    const hint = document.createElement('div');
    hint.className = 'install-hint'; hint.setAttribute('role', 'status');
    hint.innerHTML = '<span>In Safari, tap Share, then Add to Home Screen.</span><button type="button" aria-label="Close">×</button>';
    hint.querySelector('button').onclick = () => hint.remove();
    button.after(hint);
  }

  function decorate() {
    const actions = document.querySelector('.top-actions');
    if (!actions || standalone() || document.querySelector('#install-app')) return;
    if (!deferred && !ios()) return;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'install-app'; button.className = 'notification-toggle install-app';
    button.setAttribute('aria-label', 'Install app');
    button.innerHTML = '<span aria-hidden="true">⤓</span><span>Install app</span>';
    button.onclick = async () => {
      if (!deferred) { if (ios()) showIosHint(button); else button.remove(); return; }
      const prompt = deferred; deferred = null;
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') button.remove();
    };
    actions.prepend(button);
  }

  window.RelayqoInstall = { decorate };
})();
