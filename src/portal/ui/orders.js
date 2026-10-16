(() => {
  // Orders for shops: cash-on-delivery orders taken by the chatbot, from "to confirm" to delivered or returned.
  const LABELS = { NEW: 'To confirm', CONFIRMED: 'Confirmed', SHIPPED: 'Shipped', DELIVERED: 'Delivered', RETURNED: 'Returned', CANCELLED: 'Cancelled', ALL: 'All orders' };
  const BADGE = { NEW: 'orange', CONFIRMED: 'blue', SHIPPED: 'blue', DELIVERED: 'green', RETURNED: 'red', CANCELLED: 'red' };
  // The next steps offered for each status, in the order a COD shop works.
  const NEXT = { NEW: [['CONFIRMED', 'Confirm'], ['CANCELLED', 'Cancel']], CONFIRMED: [['SHIPPED', 'Mark shipped'], ['CANCELLED', 'Cancel']],
    SHIPPED: [['DELIVERED', 'Delivered'], ['RETURNED', 'Returned']], DELIVERED: [['RETURNED', 'Returned']], RETURNED: [['NEW', 'Reopen']], CANCELLED: [['NEW', 'Reopen']] };
  const TABS = ['NEW', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED', 'ALL'];
  const lang = () => document.documentElement.lang || 'en';
  const money = (value, currency) => value === null || value === undefined ? '—' : `${new Intl.NumberFormat(lang(), { maximumFractionDigits: 2 }).format(value)} ${currency || 'MAD'}`;
  const when = value => new Date(value).toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const digits = phone => String(phone || '').replace(/[^\d]/g, '');

  async function render(ctx) {
    const { path } = ctx;
    const id = path.startsWith('/app/orders/') ? decodeURIComponent(path.slice('/app/orders/'.length)) : null;
    return id ? detail(ctx, id) : list(ctx);
  }

  const contactActions = (o, esc) => `${o.conversationId ? `<a class="btn secondary" href="/app/inbox/${encodeURIComponent(o.conversationId)}" data-route>Open chat</a>` : ''}${digits(o.phone).length >= 8 ? `<a class="btn secondary" href="tel:+${esc(digits(o.phone))}">Call</a>` : ''}`;

  async function list(ctx) {
    const { root, shell, header, escape: esc, toast, api, bind, go } = ctx;
    const params = new URLSearchParams(location.search);
    const status = TABS.includes(params.get('status')) ? params.get('status') : 'NEW';
    const [data, summary] = await Promise.all([api('/client/orders?status=' + status + '&limit=100'), api('/client/orders/summary')]);
    const row = o => `<article class="order-row" data-order="${esc(o.id)}">
      <div class="order-row-main"><div class="order-row-top"><span class="badge ${BADGE[o.status]}">${esc(LABELS[o.status])}</span><small>${esc(when(o.createdAt))}</small></div>
        <h3><bdi>${esc(o.customerName || o.phone || 'Customer')}</bdi>${o.city ? ` · <span class="muted">${esc(o.city)}</span>` : ''}</h3>
        <p><bdi>${esc(o.product || 'Product not given')}</bdi> × ${esc(o.quantity || '1')}</p></div>
      <div class="order-row-total"><strong>${esc(money(o.total, o.currency))}</strong>${o.total === null ? '<small>Price not found</small>' : ''}</div>
      <div class="order-row-actions">${(NEXT[o.status] || []).map(([next, label], i) => `<button type="button" class="btn ${i === 0 ? '' : 'secondary'}" data-set="${next}" data-id="${esc(o.id)}">${esc(label)}</button>`).join('')}
        ${contactActions(o, esc)}<a class="btn secondary" href="/app/orders/${encodeURIComponent(o.id)}" data-route>Details</a></div></article>`;
    const empty = status === 'NEW' ? 'No orders to confirm. New orders taken by your chatbot appear here.' : status === 'ALL' ? 'No orders yet. When a customer orders in WhatsApp, the order appears here.' : `No ${LABELS[status].toLowerCase()} orders.`;
    root.innerHTML = shell(header('Orders', 'Orders your chatbot took in WhatsApp. Call or message the customer to confirm, then follow the delivery.', '<a class="btn secondary" href="/api/client/leads/export.csv" download>Export CSV</a>') +
      `<div class="order-summary"><div><span>This week</span><strong>${Number(summary.weekOrders || 0)}</strong><small>orders</small></div>
        <div><span>Revenue this week</span><strong>${esc(money(summary.weekRevenue || 0, summary.currency))}</strong><small>${summary.weekWithoutPrice ? `${Number(summary.weekWithoutPrice)} without a catalog price` : 'cancelled and returned not counted'}</small></div>
        <div class="${summary.toConfirm ? 'is-urgent' : ''}"><span>To confirm</span><strong>${Number(summary.toConfirm || 0)}</strong><small>call before shipping</small></div></div>
      <article class="card order-list"><div class="section-tabs order-tabs" role="tablist">${TABS.map(s => `<button type="button" role="tab" data-status="${s}" aria-selected="${s === status}"><span>${esc(LABELS[s])}</span> <small>${Number(data.counts?.[s] || 0)}</small></button>`).join('')}</div>
      <div class="order-rows">${data.orders.map(row).join('') || `<p class="empty">${esc(empty)}</p>`}</div></article>`, false, 'Orders');
    root.querySelectorAll('[data-status]').forEach(b => b.onclick = () => go('/app/orders?status=' + b.dataset.status));
    root.querySelectorAll('[data-set]').forEach(b => b.onclick = async () => {
      if (b.dataset.set === 'CANCELLED' && !confirm('Cancel this order? The customer is not told automatically.')) return;
      b.disabled = true;
      try { await api('/client/orders/' + encodeURIComponent(b.dataset.id), { method: 'PATCH', body: JSON.stringify({ status: b.dataset.set }) }); toast(`Order: ${LABELS[b.dataset.set]}.`); await list(ctx); }
      catch (error) { b.disabled = false; toast(error.message, true); }
    });
    bind();
  }

  async function detail(ctx, id) {
    const { root, shell, header, escape: esc, toast, api, bind, go } = ctx;
    const { order: o } = await api('/client/orders/' + encodeURIComponent(id));
    const field = (key, label, value, attrs = '') => `<div class="field ${key === 'address' ? 'full' : ''}"><label for="order-${key}">${label}</label>${key === 'address' || key === 'note'
      ? `<textarea id="order-${key}" data-key="${key}" dir="auto" rows="3" ${attrs}>${esc(value || '')}</textarea>` : `<input id="order-${key}" data-key="${key}" dir="auto" value="${esc(value || '')}" ${attrs}>`}</div>`;
    root.innerHTML = shell(header('Order', `Received ${esc(when(o.createdAt))}`, '<a class="btn secondary" href="/app/orders" data-route>All orders</a>') +
      `<div class="order-detail"><article class="card order-detail-main"><div class="order-row-top"><span class="badge ${BADGE[o.status]}">${esc(LABELS[o.status])}</span></div>
        <h2><bdi>${esc(o.customerName || o.phone || 'Customer')}</bdi></h2>${o.phone ? `<p class="muted" dir="ltr">${esc(o.phone)}</p>` : ''}
        <p class="order-detail-product"><bdi>${esc(o.product || 'Product not given')}</bdi> × ${esc(o.quantity || '1')}</p>
        <p class="order-detail-total">${esc(money(o.total, o.currency))}${o.unitPrice !== null && !o.totalIsManual ? ` <small>(${esc(money(o.unitPrice, o.currency))} each)</small>` : ''}</p>
        <div class="actions">${(NEXT[o.status] || []).map(([next, label], i) => `<button type="button" class="btn ${i === 0 ? '' : 'secondary'}" data-set="${next}">${esc(label)}</button>`).join('')}${contactActions(o, esc)}</div></article>
      <article class="card"><h2>Order details</h2><form id="order-form" class="form-grid">
        ${field('customerName', 'Customer name', o.customerName)}${field('product', 'Product', o.product)}
        ${field('quantity', 'Quantity', o.quantity, 'inputmode="numeric"')}${field('total', `Total (${esc(o.currency)})`, o.totalIsManual ? o.total : '', `inputmode="decimal" placeholder="${esc(o.total === null ? 'Enter the total' : String(o.total) + ' from the catalog')}"`)}
        ${field('city', 'Delivery city', o.city)}${field('address', 'Delivery address', o.address)}
        <div class="field full"><label for="order-note">Private note <span class="muted">(optional)</span></label><textarea id="order-note" data-key="note" rows="3" maxlength="2000" placeholder="For example: customer asked for delivery after 18:00">${esc(o.note || '')}</textarea></div>
        <div class="actions full"><button class="btn" type="submit">Save</button></div></form></article></div>`, false, 'Orders');
    const update = async body => { await api('/client/orders/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }); await detail(ctx, id); };
    root.querySelectorAll('[data-set]').forEach(b => b.onclick = async () => {
      if (b.dataset.set === 'CANCELLED' && !confirm('Cancel this order? The customer is not told automatically.')) return;
      b.disabled = true; try { await update({ status: b.dataset.set }); toast(`Order: ${LABELS[b.dataset.set]}.`); } catch (error) { b.disabled = false; toast(error.message, true); }
    });
    root.querySelector('#order-form').onsubmit = async event => {
      event.preventDefault();
      const body = Object.fromEntries([...root.querySelectorAll('#order-form [data-key]')].map(el => [el.dataset.key, el.value.trim()]));
      try { await update(body); toast('Order saved.'); } catch (error) { toast(error.message, true); }
    };
    void go; bind();
  }
  window.RelayqoOrders = { render };
})();
