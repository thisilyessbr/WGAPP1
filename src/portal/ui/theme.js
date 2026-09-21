(() => {
  let theme = 'dark';
  try { theme = localStorage.getItem('relayqo-theme') || 'dark'; } catch {}
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
})();
