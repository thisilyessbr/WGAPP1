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
    Home: icon('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>'),
    Orders: icon('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
    Products: icon('<path d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z"/><circle cx="7" cy="8" r="1.4"/>'),
    'Bot knowledge': icon('<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h13"/><path d="M9 7h6M9 11h4"/>'),
    Settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    Requests: icon('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    Calendar: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>'),
    Inbox: icon('<path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
    'Chatbot & limits': icon('<path d="M12 3v3m0 12v3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M3 12h3m12 0h3M4.9 19.1 7 17m10-10 2.1-2.1"/><circle cx="12" cy="12" r="4"/>'),
    Workflows: icon('<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M9 6h6M7.5 8.5 11 15.5m5.5-7L13 15.5"/>'),
    'Test chatbot': icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m9 10 2 2 4-4"/>'),
    Channels: icon('<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19"/><circle cx="12" cy="12" r="2"/>'),
    'Permissions & advanced': icon('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    Statistics: icon('<path d="M3 3v18h18"/><path d="m7 14 4-4 4 3 5-6"/>'),
    Documents: icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>'),
    Conversations: icon('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 10h8M8 14h5"/>'),
    History: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/>'),
    Profile: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2m-2 4h2M7 16h10"/>'),
    Policies: icon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
    Services: icon('<path d="m12 3 1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z"/>'),
    FAQs: icon('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01"/>')
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
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id);
      const svg = icons[group.name] || '';
      const badge = group.badge ? `<small class="tab-badge" aria-hidden="true" data-no-translate>${group.badge}</small>` : '';
      button.innerHTML = `${svg}<span>${group.name}</span>${badge}`;
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
    if (documents && !form.dataset.adminReview) { form.insertBefore(documents, form.querySelector('.sticky-save')); articles.push(documents); }
    if (articles.length > 1) tabs(form, articles.map(node => { const title = node.querySelector('h2').textContent; const count = node.querySelectorAll('.collection-item').length; return { name: names[title] || title, badge: count || '', nodes: [node] }; }), 'business');
    form.querySelectorAll('[data-path]').forEach(el => { if (/description|address|hours|policies/.test(el.dataset.path)) el.closest('.field').classList.add('full'); });
  }
  function accountSections() {
    const technical = document.querySelector('#technical'); if (!technical || technical.dataset.sections) return; technical.dataset.sections = 'true';
    const content = document.querySelector('.content'), oldTabs = content.querySelector(':scope > .tabs');
    const settings = document.querySelector('#everyday-settings'), overview = content.querySelector(':scope > .grid-2');
    const readiness = content.querySelector(':scope > .admin-launch-bar');
    const editing = document.querySelector('#editing-freeze')?.closest('article');
    const clientMeta = document.querySelector('#client-owned-meta');
    const channelNodes = [document.querySelector('#admin-qr-connection'), document.querySelector('#admin-broadcasts-card'), document.querySelector('#admin-voice-notes-card'), document.querySelector('#admin-instagram-card'), clientMeta].filter(Boolean);
    const historyCount = document.querySelectorAll('#history .connection-card').length;
    const lockedCount = document.querySelectorAll('#technical input[type=checkbox]:checked:not(#auto)').length;
    const groups = [
      { name: 'Overview', nodes: [readiness, overview] },
      { name: 'Chatbot & limits', nodes: [settings] },
      { name: 'Workflows', nodes: [document.querySelector('#workflow-editor')] },
      { name: 'Test chatbot', nodes: [document.querySelector('#preview-form')?.closest('article'), document.querySelector('#admin-wording-card')] },
      { name: 'Channels', badge: channelNodes.length || '', nodes: channelNodes },
      { name: 'Permissions & advanced', badge: lockedCount || '', nodes: [editing, technical] },
      { name: 'Statistics', nodes: [document.querySelector('#usage')] },
      { name: 'Documents', nodes: [document.querySelector('#documents-list')?.closest('article')] },
      { name: 'Conversations', nodes: [document.querySelector('#conversation-list')?.closest('article')] },
      { name: 'History', badge: historyCount || '', nodes: [document.querySelector('#history')] }
    ].map(g => ({ ...g, nodes: g.nodes.filter(Boolean) })).filter(g => g.nodes.length);
    tabs(content, groups, 'account', oldTabs || readiness || overview); oldTabs?.remove();
    content.classList.add('admin-account-page');
    ready(content);
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
  function ready(content) { content?.classList.remove('is-preparing'); content?.querySelector(':scope > .account-preparing')?.remove(); }
  window.RelayqoDesign = { decorate, ready };
})();
