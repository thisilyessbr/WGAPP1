(() => {
  // Client calendar: a month grid and a week timeline of the bookings the chatbot made, times the business blocked,
  // the selected day's details, the times customers can book, and (only when offered) an optional Google sync.
  const DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];
  const ERRORS = {
    CALENDAR_LOGIN_CANCELLED: 'Google sign-in was cancelled.',
    CALENDAR_PERMISSION_MISSING: 'Please allow Relayqo to see and add events to your calendar, then try again.',
    CALENDAR_NO_REFRESH_TOKEN: 'Google did not give lasting access. Remove Relayqo from your Google account permissions, then connect again.',
    CALENDAR_STATE_EXPIRED: 'The sign-in took too long. Please try again.',
    CALENDAR_SESSION_MISMATCH: 'Sign in to Relayqo with the same account, then try again.'
  };
  const HOUR_PX = 64;
  // Day keys are "YYYY-MM-DD" handled as UTC dates, so the grid never shifts with the viewer's time zone.
  const ms = key => Date.parse(key + 'T12:00:00Z');
  const add = (key, n) => new Date(ms(key) + n * 86400000).toISOString().slice(0, 10);
  const weekday = key => new Date(ms(key)).getUTCDay();
  const weekStart = key => add(key, -((weekday(key) + 6) % 7));
  const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const lang = () => document.documentElement.lang || 'en';
  const fmt = (key, options) => new Intl.DateTimeFormat(lang(), { timeZone: 'UTC', ...options }).format(new Date(ms(key)));
  const remember = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { return null; } };

  async function render(ctx) {
    const { root, shell, header, escape, toast, api, bind } = ctx;
    const data = await api('/client/calendar');
    const s = data.settings || {}, g = data.google || {}, today = data.today;
    const slotTimes = s.slotTimes || ['10:00', '12:00', '14:00', '16:00', '18:00'], working = s.workingDays || [1, 2, 3, 4, 5, 6], duration = s.durationMinutes || 30;
    let view = remember('relayqo.calendar.view') === 'week' ? 'week' : 'month', cursor = today, selected = today, bookings = [], drawVersion = 0;
    const notice = new URLSearchParams(location.search);

    const num = (id, label, value, hint) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" value="${escape(value)}"><span class="hint">${hint}</span></div>`;
    const availability = `<details class="card cal-settings"><summary><span><strong>When customers can book</strong><small>${escape(slotTimes.join(' · '))} · ${escape(DAYS.filter(([d]) => working.includes(d)).map(([d]) => fmt(add('2026-10-12', (d + 6) % 7), { weekday: 'short' })).join(', '))}${s.enabled === false ? ' · paused' : ''}</small></span></summary>
      <p class="small muted">The chatbot offers only these times, and never a time that is already booked or blocked.</p><form id="cal-form" class="form-grid">
      <label class="admin-setting-toggle full"><input id="cal-enabled" type="checkbox" ${s.enabled !== false ? 'checked' : ''}><span><strong>Let the chatbot book</strong><small>Turn off to pause bookings; the chatbot then asks the day and time and your team confirms.</small></span></label>
      <div class="field"><label for="cal-times">Times offered — one per line</label><textarea id="cal-times" dir="ltr">${escape(slotTimes.join('\n'))}</textarea><span class="hint">Start times, 24-hour, for example 10:00.</span></div>
      <fieldset class="field workflow-choices"><legend>Working days</legend><div class="check-options">${DAYS.map(([d, label]) => `<label><input type="checkbox" name="cal-day" value="${d}" ${working.includes(d) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>
      ${num('cal-duration', 'Duration (minutes)', duration, '10 to 240.')}
      ${num('cal-max', 'Times shown per day', s.maxSlots ?? 3, '1 to 6.')}
      ${num('cal-notice', 'Minimum notice (minutes)', s.minNoticeMinutes ?? 120, 'No bookings sooner than this.')}
      ${num('cal-ahead', 'Book up to (days ahead)', s.daysAhead ?? 21, '1 to 90.')}
      <div class="field"><label for="cal-title">Booking title</label><input id="cal-title" value="${escape(s.eventTitle || '')}" placeholder="Demo"><span class="hint">The customer’s name is added.</span></div>
      <div class="field"><label for="cal-tz">Time zone</label><input id="cal-tz" value="${escape(s.timezone || 'Africa/Casablanca')}" dir="ltr"></div>
      <div class="actions full"><button class="btn" type="submit">Save</button></div></form></details>`;
    const c = g.connection, reconnect = c && c.status !== 'CONNECTED';
    const googleCard = !g.configured ? '' : `<article class="card"><div class="card-title"><div><h2>Google Calendar (optional)</h2><p>Also respect your Google Calendar: busy times there are not offered, and each booking is copied to it.</p></div></div>
      ${c ? `<p class="small muted">Connected as <strong>${escape(c.email || 'your Google account')}</strong></p>
        ${reconnect ? '<p class="notice error">Google access was removed. Connect again to keep syncing.</p>' : ''}
        ${!reconnect ? `<div class="field"><label for="g-cal">Calendar to sync with</label><select id="g-cal"><option value="">Choose a calendar</option>${(g.calendars || []).map(x => `<option value="${escape(x.id)}" ${x.id === c.calendarId ? 'selected' : ''}>${escape(x.name)}${x.primary ? ' (main)' : ''}</option>`).join('')}</select></div>` : ''}
        <div class="actions"><button type="button" class="btn secondary" id="g-connect">${reconnect ? 'Connect again' : 'Use another Google account'}</button><button type="button" class="btn secondary" id="g-disconnect">Disconnect</button></div>`
        : '<button type="button" class="btn secondary" id="g-connect">Connect Google Calendar</button>'}</article>`;
    root.innerHTML = shell(header('Calendar', 'Your chatbot books demos and appointments here, only at times you are free.') +
      `<section class="cal-overview" aria-label="Calendar overview">
        <div class="cal-overview-status ${s.enabled === false ? 'paused' : ''}"><span class="cal-status-dot" aria-hidden="true"></span><div><small>Booking status</small><strong>${s.enabled === false ? 'Bookings paused' : 'Open for bookings'}</strong></div></div>
        <div><small>Bookings in view</small><strong id="cal-booking-count">—</strong></div>
        <div><small>Blocked times</small><strong id="cal-block-count">—</strong></div>
        <div class="cal-next-booking"><small>Next booking</small><strong id="cal-next-booking">—</strong></div>
      </section><article class="card cal-card"><div class="cal-toolbar"><div class="cal-nav"><button type="button" class="btn secondary" id="cal-today">Today</button><button type="button" class="btn secondary cal-arrow" id="cal-prev" aria-label="Previous period">‹</button><button type="button" class="btn secondary cal-arrow" id="cal-next" aria-label="Next period">›</button><h2 id="cal-title-label"></h2></div>
        <div class="section-tabs cal-views" role="tablist"><button type="button" role="tab" data-view="month">Month</button><button type="button" role="tab" data-view="week">Week</button></div></div>
        <div id="cal-view" class="cal-view" aria-live="polite"></div></article><article class="card" id="cal-day"></article>` + availability + googleCard, false, 'Calendar');
    bind();
    if (notice.has('connected')) { toast('Google Calendar connected. Choose the calendar to sync with.'); history.replaceState({}, '', '/app/calendar'); }
    if (notice.has('error')) { toast(ERRORS[notice.get('error')] || 'Google Calendar could not connect. Please try again.', true); history.replaceState({}, '', '/app/calendar'); }
    const $ = id => root.querySelector('#' + id);

    const label = b => b.kind === 'BLOCKED' ? b.title : (b.customerName || b.title);
    const isClosed = key => !working.includes(weekday(key));
    const dayItems = key => bookings.filter(b => b.day === key);
    const range = () => {
      if (view === 'week') { const from = weekStart(cursor); return [from, add(from, 6)]; }
      const from = weekStart(cursor.slice(0, 8) + '01'); return [from, add(from, 41)];
    };

    function month() {
      const [from] = range(), monthKey = cursor.slice(0, 7);
      const heads = Array.from({ length: 7 }, (_, i) => `<div class="cal-head">${escape(fmt(add(from, i), { weekday: 'short' }))}</div>`).join('');
      const cells = Array.from({ length: 42 }, (_, i) => {
        const key = add(from, i), items = dayItems(key);
        const chips = items.slice(0, 3).map(b => `<span class="cal-chip ${b.kind === 'BLOCKED' ? 'blocked' : ''}"><b dir="ltr">${b.startTime === '00:00' && b.endTime === '24:00' ? '' : escape(b.startTime)}</b> <bdi>${escape(label(b))}</bdi></span>`).join('');
        const classes = ['cal-cell', key.slice(0, 7) !== monthKey ? 'outside' : '', key === today ? 'today' : '', key === selected ? 'selected' : '', isClosed(key) ? 'closed' : '', key < today ? 'past' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-day="${key}" aria-label="${escape(fmt(key, { weekday: 'long', day: 'numeric', month: 'long' }))}${items.length ? ', ' + items.length : ''}"><span class="cal-num">${Number(key.slice(8))}</span><span class="cal-chips">${chips}${items.length > 3 ? `<span class="cal-more">+${items.length - 3}</span>` : ''}</span>${items.length ? `<span class="cal-dots">${items.slice(0, 4).map(b => `<i class="${b.kind === 'BLOCKED' ? 'blocked' : ''}"></i>`).join('')}</span>` : ''}</button>`;
      }).join('');
      return `<div class="cal-month">${heads}${cells}</div>`;
    }

    function week() {
      const [from] = range(), days = Array.from({ length: 7 }, (_, i) => add(from, i));
      const items = bookings.filter(b => days.includes(b.day));
      const startHour = Math.min(8, ...slotTimes.map(t => Math.floor(minutes(t) / 60)), ...items.filter(b => b.startTime !== '00:00').map(b => Math.floor(minutes(b.startTime) / 60)));
      const endHour = Math.max(19, ...slotTimes.map(t => Math.ceil((minutes(t) + duration) / 60)), ...items.filter(b => b.endTime !== '24:00').map(b => Math.ceil(minutes(b.endTime) / 60)));
      const top = m => (m - startHour * 60) / 60 * HOUR_PX, height = (endHour - startHour) * HOUR_PX;
      const hours = Array.from({ length: endHour - startHour }, (_, i) => `<div class="cal-hour" style="height:${HOUR_PX}px"><span dir="ltr">${String(startHour + i).padStart(2, '0')}:00</span></div>`).join('');
      const col = key => {
        const free = !isClosed(key) && key >= today && s.enabled !== false ? slotTimes.filter(t => !dayItems(key).some(b => minutes(b.startTime) < minutes(t) + duration && (b.endTime === '24:00' ? 1440 : minutes(b.endTime)) > minutes(t)))
          .map(t => `<div class="cal-slot" style="top:${top(minutes(t))}px;height:${duration / 60 * HOUR_PX}px"></div>`).join('') : '';
        const events = dayItems(key).map(b => {
          const start = Math.max(minutes(b.startTime), startHour * 60), end = Math.min(b.endTime === '24:00' ? 1440 : minutes(b.endTime), endHour * 60);
          const h = Math.max(24, top(end) - top(start)), short = h < 44;
          return `<button type="button" class="cal-event ${b.kind === 'BLOCKED' ? 'blocked' : ''} ${short ? 'short' : ''}" data-day="${key}" title="${escape(b.startTime + '–' + b.endTime + ' · ' + label(b))}" style="top:${top(start)}px;height:${h}px"><b dir="ltr">${escape(b.startTime)}${short ? '' : '–' + escape(b.endTime)}</b><bdi>${escape(label(b))}</bdi></button>`;
        }).join('');
        return `<div class="cal-col ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''} ${isClosed(key) ? 'closed' : ''}" data-day="${key}" style="height:${height}px">${free}${events}</div>`;
      };
      const heads = days.map(key => `<button type="button" class="cal-week-head ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''}" data-day="${key}"><small>${escape(fmt(key, { weekday: 'short' }))}</small><strong>${Number(key.slice(8))}</strong></button>`).join('');
      return `<div class="cal-week"><div class="cal-week-grid"><div></div>${heads}<div class="cal-hours">${hours}</div>${days.map(col).join('')}</div></div><p class="small muted cal-legend"><span class="cal-slot-key"></span> Times customers can book · <span class="cal-blocked-key"></span> Blocked</p>`;
    }

    function dayPanel() {
      const items = dayItems(selected), closed = isClosed(selected);
      const row = b => `<div class="connection-card booking-row"><div><strong dir="ltr">${b.startTime === '00:00' && b.endTime === '24:00' ? 'All day' : `${escape(b.startTime)}–${escape(b.endTime)}`}</strong>
        ${b.kind === 'BLOCKED' ? `<p class="small muted">${escape(b.title)} · <span>Blocked</span></p>`
          : `<p><bdi>${escape(b.customerName || b.title)}</bdi>${b.contact ? ` · <span class="small muted" dir="ltr">${escape(b.contact)}</span>` : ''}</p><p class="small muted">${escape(b.title)}</p>
            ${Object.entries(b.details || {}).filter(([k]) => !['fullName', 'name', 'email', 'phone', 'demoDay', 'demoSlot'].includes(k)).slice(0, 6).map(([k, v]) => `<p class="small muted cal-detail"><span>${escape(k)}:</span> <bdi>${escape(v)}</bdi></p>`).join('')}`}</div>
        <button type="button" class="btn secondary" data-cancel="${escape(b.id)}" data-kind="${escape(b.kind)}">${b.kind === 'BLOCKED' ? 'Remove' : 'Cancel booking'}</button></div>`;
      $('cal-day').innerHTML = `<div class="card-title cal-day-title"><div><p class="eyebrow">Selected day</p><h2>${escape(fmt(selected, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2><p>${closed ? 'Not a working day: the chatbot does not offer times.' : selected < today ? 'Past day.' : `Times customers can book: ${escape(slotTimes.join(', '))}`}</p></div><span class="cal-day-count"><strong>${items.length}</strong><small>Calendar items</small></span></div>
        ${items.map(row).join('') || `<div class="cal-empty"><span aria-hidden="true">✓</span><div><strong>No bookings on this day</strong><p>${closed ? 'This is outside your working days.' : selected < today ? 'There were no calendar items.' : 'This day is clear and ready for bookings.'}</p></div></div>`}
        ${selected >= today ? `<details class="booking-block"><summary>Block time on this day</summary><form id="cal-block" class="form-grid">
          <div class="field"><label for="block-from">From</label><input id="block-from" type="time"></div>
          <div class="field"><label for="block-to">To</label><input id="block-to" type="time"><span class="hint">Leave both times empty to block the whole day.</span></div>
          <div class="field full"><label for="block-note">Reason (optional)</label><input id="block-note" placeholder="Not available"></div>
          <div class="actions full"><button class="btn secondary" type="submit">Block this time</button></div></form></details>` : ''}`;
      $('cal-day').querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => {
        if (b.dataset.kind !== 'BLOCKED' && !confirm('Cancel this booking? The time becomes free again. Tell the customer yourself.')) return;
        act(() => api('/client/calendar/bookings/' + encodeURIComponent(b.dataset.cancel), { method: 'DELETE' }), b.dataset.kind === 'BLOCKED' ? 'Time unblocked.' : 'Booking cancelled.');
      });
      const form = $('cal-block');
      if (form) form.onsubmit = event => { event.preventDefault();
        act(() => api('/client/calendar/blocks', { method: 'POST', body: JSON.stringify({ date: selected, from: $('block-from').value, to: $('block-to').value, note: $('block-note').value.trim() }) }), 'Time blocked.'); };
    }

    async function draw() {
      const version = ++drawVersion;
      const [from, to] = range();
      $('cal-title-label').textContent = view === 'week'
        ? `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : fmt(cursor, { month: 'long', year: 'numeric' });
      root.querySelectorAll('.cal-views [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
      $('cal-view').setAttribute('aria-busy', 'true');
      $('cal-view').innerHTML = '<div class="cal-loading"><span class="spinner"></span><span>Loading calendar…</span></div>';
      try {
        const result = await api(`/client/calendar/bookings?from=${from}&to=${to}`);
        if (version !== drawVersion) return;
        bookings = result.bookings;
      } catch (error) { toast(error.message || 'Bookings could not be loaded.', true); bookings = []; }
      if (version !== drawVersion) return;
      $('cal-view').setAttribute('aria-busy', 'false');
      const booked = bookings.filter(b => b.kind !== 'BLOCKED');
      const blocked = bookings.filter(b => b.kind === 'BLOCKED');
      const next = booked.filter(b => b.day >= today).sort((a, b) => `${a.day}${a.startTime}`.localeCompare(`${b.day}${b.startTime}`))[0];
      $('cal-booking-count').textContent = String(booked.length);
      $('cal-block-count').textContent = String(blocked.length);
      $('cal-next-booking').textContent = next ? `${fmt(next.day, { month: 'short', day: 'numeric' })} · ${next.startTime}` : 'None in view';
      $('cal-view').innerHTML = view === 'week' ? week() : month();
      $('cal-view').querySelectorAll('[data-day]').forEach(el => el.onclick = event => {
        if (el.classList.contains('cal-col') && event.target !== el) return;
        selected = el.dataset.day; if (view === 'month' && selected.slice(0, 7) !== cursor.slice(0, 7)) cursor = selected;
        draw();
      });
      dayPanel();
    }
    const act = async (fn, done) => { try { await fn(); if (done) toast(done); await draw(); } catch (error) { toast(error.message || 'Something went wrong.', true); } };
    const move = n => { cursor = view === 'week' ? add(cursor, 7 * n) : (() => { const [y, m] = cursor.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 10); })(); selected = view === 'week' ? add(selected, 7 * n) : cursor; draw(); };
    $('cal-prev').onclick = () => move(-1); $('cal-next').onclick = () => move(1);
    $('cal-today').onclick = () => { cursor = selected = today; draw(); };
    root.querySelectorAll('.cal-views [data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; remember('relayqo.calendar.view', view); cursor = selected; draw(); });

    $('cal-form').onsubmit = event => { event.preventDefault();
      const value = id => $(id).value.trim();
      const settings = { enabled: $('cal-enabled').checked, slotTimes: value('cal-times').split('\n').map(t => t.trim()).filter(Boolean),
        workingDays: [...root.querySelectorAll('input[name=cal-day]:checked')].map(b => Number(b.value)),
        durationMinutes: value('cal-duration'), maxSlots: value('cal-max'), minNoticeMinutes: value('cal-notice'), daysAhead: value('cal-ahead'), eventTitle: value('cal-title'), timezone: value('cal-tz') };
      api('/client/calendar/settings', { method: 'PUT', body: JSON.stringify({ settings }) }).then(() => { toast('Calendar settings saved.'); render(ctx); }).catch(error => toast(error.message || 'Could not save.', true)); };
    const reload = async (fn, done) => { try { await fn(); if (done) toast(done); await render(ctx); } catch (error) { toast(error.message || 'Something went wrong.', true); } };
    if ($('g-connect')) $('g-connect').onclick = () => reload(async () => location.assign((await api('/client/calendar/google/start', { method: 'POST' })).url));
    if ($('g-disconnect')) $('g-disconnect').onclick = () => { if (confirm('Stop syncing with Google Calendar? Your Relayqo bookings stay.')) reload(() => api('/client/calendar/google', { method: 'DELETE' }), 'Google Calendar disconnected.'); };
    if ($('g-cal')) $('g-cal').onchange = () => { if ($('g-cal').value) reload(() => api('/client/calendar/google', { method: 'PUT', body: JSON.stringify({ calendarId: $('g-cal').value }) }), 'Google Calendar sync saved.'); };
    await draw();
  }
  window.RelayqoCalendar = { render };
})();
