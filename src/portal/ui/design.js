(() => {
  const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icons = {
    Overview: icon('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>'),
    'Business data': icon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>'),
    WhatsApp: icon('<path d="M21 11.5a9 9 0 0 1-13.4 7.9L3 21l1.6-4.6A9 9 0 1 1 21 11.5Z"/><path d="M8 8c0 4 4 8 8 8l1-3-3-1-1 1-2-2 1-1-1-3z"/>'),
    Plans: icon('<path d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z"/><circle cx="7" cy="8" r="1"/>'),
    Clients: icon('<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/>'),
    Users: icon('<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>'),
    'Usage & costs': icon('<path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4"/>'),
    sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'),
    moon: icon('<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>'),
    logout: icon('<path d="M9 3H4v18h5m5-14 5 5-5 5m-6-5h11"/>'),
    Inbox: icon('<path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>')
  };
  function themeButtons() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.innerHTML = (dark ? icons.sun : icons.moon) + `<span>${dark ? 'Light mode' : 'Dark mode'}</span>`;
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.onclick = () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('relayqo-theme', next); } catch {}
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0c1210' : '#f4f6f1');
        themeButtons();
      };
    });
  }
  function tabs(host, groups, key, before) {
    const tablist = document.createElement('div'); tablist.className = 'section-tabs'; tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', key === 'business' ? 'Business sections' : 'Account sections');
    let active = groups[0]?.name;
    try { active = sessionStorage.getItem('relayqo-section:' + location.pathname) || active; } catch {}
    const choose = (name, focus = false) => {
      active = name;
      groups.forEach((group, i) => {
        const selected = group.name === name;
        group.panel.hidden = !selected;
        const button = tablist.children[i]; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      });
      try { sessionStorage.setItem('relayqo-section:' + location.pathname, name); } catch {}
    };
    groups.forEach((group, i) => {
      const panel = document.createElement('section'); panel.className = 'section-panel'; panel.id = `${key}-panel-${i}`;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `${key}-tab-${i}`);
      const first = group.nodes[0]; first.before(panel); group.nodes.forEach(node => panel.append(node)); group.panel = panel;
      const button = document.createElement('button'); button.type = 'button'; button.id = `${key}-tab-${i}`;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id); button.textContent = group.name;
      button.onclick = () => choose(group.name);
      button.onkeydown = event => { const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (delta) { event.preventDefault(); choose(groups[(i + delta + groups.length) % groups.length].name, true); }
      };
      tablist.append(button);
    });
    if (before) before.before(tablist); else host.prepend(tablist);
    choose(groups.some(g => g.name === active) ? active : groups[0].name);
  }
  function businessSections() {
    const form = document.querySelector('#business-form'); if (!form || form.dataset.sections) return; form.dataset.sections = 'true';
    const names = { 'Business profile': 'Profile', 'Customer policies': 'Policies', 'Knowledge documents': 'Documents' };
    const articles = [...form.querySelectorAll(':scope > article')];
    const documents = document.querySelector('#documents');
    if (documents) { form.insertBefore(documents, form.querySelector('.sticky-save')); articles.push(documents); }
    tabs(form, articles.map(node => { const title = node.querySelector('h2').textContent; return { name: names[title] || title, nodes: [node] }; }), 'business');
    form.querySelectorAll('[data-path]').forEach(el => { if (/description|address|hours|policies/.test(el.dataset.path)) el.closest('.field').classList.add('full'); });
  }
  function accountSections() {
    const technical = document.querySelector('#technical'); if (!technical || technical.dataset.sections) return; technical.dataset.sections = 'true';
    const content = document.querySelector('.content'), oldTabs = content.querySelector(':scope > .tabs');
    const settings = document.querySelector('#everyday-settings'), overview = content.querySelector(':scope > .grid-2');
    const editing = document.querySelector('#editing-freeze')?.closest('article');
    const clientMeta = document.querySelector('#client-owned-meta');
    const groups = [
      { name: 'Overview', nodes: [overview, editing] },
      { name: 'Chatbot & limits', nodes: [settings] },
      { name: 'Permissions & advanced', nodes: [technical, clientMeta] },
      { name: 'Workflows & intents', nodes: [document.querySelector('#workflow-editor')] },
      { name: 'Statistics', nodes: [document.querySelector('#usage')] },
      { name: 'Documents', nodes: [document.querySelector('#documents-list')?.closest('article')] },
      { name: 'Conversations', nodes: [document.querySelector('#conversation-list')?.closest('article'), document.querySelector('#preview-form')?.closest('article')] },
      { name: 'History', nodes: [document.querySelector('#history')] }
    ].map(g => ({ ...g, nodes: g.nodes.filter(Boolean) })).filter(g => g.nodes.length);
    tabs(content, groups, 'account', oldTabs || overview); oldTabs?.remove();
  }
  function decorate() {
    document.querySelectorAll('.brand').forEach(el => {
      if (!el.dataset.logo) { el.innerHTML = '<span class="brand-mark" aria-hidden="true"><span></span></span><span>Relayqo</span>'; el.dataset.logo = 'true'; el.setAttribute('aria-label', 'Relayqo home'); }
    });
    document.querySelectorAll('.nav a').forEach(a => {
      const label = a.textContent.trim().replace(/^[^A-Za-z]+/, '');
      if (icons[label]) a.innerHTML = icons[label] + `<span>${label}</span>`;
      let active = location.pathname === a.getAttribute('href');
      if (a.getAttribute('href') === '/admin/clients') active ||= /^\/admin\/(client|business)\//.test(location.pathname);
      if (a.getAttribute('href') === '/app/inbox') active ||= /^\/app\/inbox(\/|$)/.test(location.pathname);
      a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('.logout').forEach(b => { b.innerHTML = icons.logout; b.setAttribute('aria-label', 'Log out'); });
    const top = document.querySelector('.top-actions');
    if (top && !top.querySelector('.theme-toggle')) top.insertAdjacentHTML('afterbegin', '<button type="button" class="theme-toggle"></button>');
    const auth = document.querySelector('.auth-pane');
    if (auth && !auth.querySelector('.theme-toggle')) auth.insertAdjacentHTML('afterbegin', '<button type="button" class="theme-toggle auth-theme"></button>');
    themeButtons(); businessSections(); accountSections(); window.RelayqoI18n?.decorate();
    const config = document.querySelector('#config')?.closest('.field');
    if (config && !config.closest('details')) {
      const advanced = document.createElement('details'); advanced.className = 'field full';
      advanced.innerHTML = '<summary>Advanced configuration</summary>'; config.before(advanced); advanced.append(config);
    }
    document.querySelectorAll('.field').forEach(field => { const input = field.querySelector('input,textarea,select'), label = field.querySelector('label'); if(input?.id && label && !label.htmlFor) label.htmlFor=input.id; });
    document.querySelectorAll('.content > .card').forEach(c => c.classList.add('standalone-card'));
  }
  window.RelayqoDesign = { decorate };
})();
