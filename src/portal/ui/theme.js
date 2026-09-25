(() => {
  const requested = new URLSearchParams(location.search).get('theme');
  let theme = 'dark';
  try { theme = localStorage.getItem('relayqo-theme') || 'dark'; } catch {}
  if (requested === 'light' || requested === 'dark') {
    theme = requested;
    try { localStorage.setItem('relayqo-theme', theme); } catch {}
    try {
      const url = new URL(location.href);
      url.searchParams.delete('theme');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch {}
  }
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
})();
