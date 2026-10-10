(() => {
  // Inbox Module State
  let ctx = null; // { root, shell, header, escape, toast, api, bind, go, path }
  let conversations = [];
  let pagination = { total: 0, limit: 20, offset: 0, hasMore: false };
  let currentFilter = 'all'; // 'all' | 'open' | 'needs_human' | 'human_active' | 'resolved' | 'unread'
  let searchQuery = '';
  let sourceNumber = '';
  let searchTimer = null;
  let activeConversationId = null;
  let activeConversation = null;
  let activeMessages = [];
  let transcriptLimit = 50;
  let olderCursor = null;
  let hasOlderMessages = false;
  let olderPageLoaded = false;
  let isSending = false;
  let listPollingTimer = null;
  let detailPollingTimer = null;
  let listFetchInProgress = false;
  let detailFetchInProgress = false;
  let pendingListReload = false;
  let pendingDetailReload = null;
  let failedSendDraft = '';
  let renderVersion = 0;

  const esc = (s) => (ctx ? ctx.escape(s) : String(s ?? ''));

  function getStatusBadge(ownershipState) {
    switch (ownershipState) {
      case 'AI_ACTIVE':
        return '<span class="badge status-ai-active">AI active</span>';
      case 'HUMAN_REQUIRED':
        return '<span class="badge status-needs-human">Needs you</span>';
      case 'HUMAN_ACTIVE':
        return '<span class="badge status-human-active">You’re handling this</span>';
      case 'RESOLVED':
        return '<span class="badge status-resolved">Resolved</span>';
      default:
        return `<span class="badge status-ai-active">${esc(ownershipState || 'AI active')}</span>`;
    }
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      if (diffDays === 0) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      if (diffDays < 7) {
        return d.toLocaleDateString([], { weekday: 'short' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  async function loadConversationList(silent = false) {
    if (listFetchInProgress) {
      if (!silent) pendingListReload = true;
      return;
    }
    listFetchInProgress = true;
    try {
      let url = '/client/conversations?limit=' + pagination.limit + '&offset=0';
      if (currentFilter === 'unread') {
        url += '&unread=true';
      } else if (currentFilter !== 'all') {
        url += '&status=' + encodeURIComponent(currentFilter);
      }
      if (searchQuery) {
        url += '&search=' + encodeURIComponent(searchQuery);
      }
      if (sourceNumber) url += '&phoneNumberId=' + encodeURIComponent(sourceNumber);

      const res = await ctx.api(url);
      conversations = res.conversations || [];
      pagination = res.pagination || { total: conversations.length, limit: 20, offset: 0, hasMore: false };
      renderConversationList();
    } catch (err) {
      if (!silent) ctx.toast(err.message || 'Failed to load conversations', true);
    } finally {
      listFetchInProgress = false;
      if (pendingListReload) {
        pendingListReload = false;
        loadConversationList(false);
      }
    }
  }

  async function loadMoreConversations() {
    if (listFetchInProgress || !pagination.hasMore) return;
    listFetchInProgress = true;
    const btn = document.querySelector('#inbox-load-more-btn');
    if (btn) btn.disabled = true;
    try {
      const nextOffset = pagination.offset + pagination.limit;
      let url = '/client/conversations?limit=' + pagination.limit + '&offset=' + nextOffset;
      if (currentFilter === 'unread') {
        url += '&unread=true';
      } else if (currentFilter !== 'all') {
        url += '&status=' + encodeURIComponent(currentFilter);
      }
      if (searchQuery) {
        url += '&search=' + encodeURIComponent(searchQuery);
      }
      if (sourceNumber) url += '&phoneNumberId=' + encodeURIComponent(sourceNumber);

      const res = await ctx.api(url);
      const newConvs = res.conversations || [];
      conversations = conversations.concat(newConvs);
      pagination = res.pagination || { total: conversations.length, limit: 20, offset: nextOffset, hasMore: false };
      renderConversationList();
    } catch (err) {
      ctx.toast(err.message || 'Failed to load more conversations', true);
    } finally {
      listFetchInProgress = false;
    }
  }

  async function loadConversation(id, silent = false, preserveScroll = false) {
    if (!id) return;
    if (detailFetchInProgress) {
      if (!silent) pendingDetailReload = { id, preserveScroll };
      return;
    }
    detailFetchInProgress = true;
    try {
      const res = await ctx.api('/client/conversations/' + id + '?limit=' + transcriptLimit);
      if (id !== activeConversationId) return;
      const prevOwnerState = activeConversation?.ownership?.state;
      activeConversation = res.conversation;
      const combined = new Map([...activeMessages, ...(res.messages || [])].map(message => [message.id, message]));
      activeMessages = [...combined.values()].sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt) || a.id.localeCompare(b.id));
      if (!olderPageLoaded) { olderCursor = res.nextBefore; hasOlderMessages = Boolean(res.hasOlderMessages); }

      // If unread, mark it read locally in the conversations list
      const itemInList = conversations.find((c) => c.id === id);
      if (itemInList && itemInList.isUnread) {
        itemInList.isUnread = false;
        renderConversationList();
      }

      // Update detail UI
      renderDetail(preserveScroll);

      // Check if ownership changed during polling
      if (silent && prevOwnerState && prevOwnerState !== activeConversation.ownership?.state) {
        // Sync conversation state in list as well
        if (itemInList) {
          itemInList.status = activeConversation.status;
          itemInList.ownership = activeConversation.ownership;
          renderConversationList();
        }
      }
    } catch (err) {
      if (!silent) {
        ctx.toast(err.message || 'Failed to load conversation', true);
        const container = document.querySelector('#inbox-detail-container');
        if (container) {
          container.innerHTML = `
            <div class="inbox-empty-view">
              <p>${esc(err.message || 'Error loading conversation')}</p>
              <button class="btn secondary" id="inbox-retry-conv-btn">Try again</button>
            </div>
          `;
          const retryBtn = document.querySelector('#inbox-retry-conv-btn');
          if (retryBtn) retryBtn.onclick = () => loadConversation(id);
        }
      }
    } finally {
      detailFetchInProgress = false;
      if (pendingDetailReload) {
        const next = pendingDetailReload;
        pendingDetailReload = null;
        loadConversation(next.id, false, next.preserveScroll);
      }
    }
  }

  function renderConversationList() {
    const listEl = document.querySelector('#inbox-conversations-list');
    if (!listEl) return;

    if (!conversations.length) {
      listEl.innerHTML = `
        <div class="inbox-empty-view">
          <p>No conversations found.</p>
        </div>
      `;
      return;
    }

    const itemsHtml = conversations
      .map((c) => {
        const isActive = c.id === activeConversationId;
        const displayName = c.customer?.name || c.customer?.phone || 'Customer';
        const preview = c.lastMessage?.content || 'No messages yet';
        const timeStr = formatTime(c.updatedAt || c.lastMessage?.createdAt);
        const state = c.ownership?.state || c.status;
        const initials = (c.customer?.name ? c.customer.name.slice(0, 2) : (c.customer?.phone || 'WA').slice(-2)).toUpperCase();

        return `
          <div class="inbox-item ${isActive ? 'active' : ''} ${c.isUnread ? 'unread' : ''}" data-conv-id="${c.id}" role="button" tabindex="0">
            <div class="inbox-item-avatar">
              ${c.isUnread ? '<span class="inbox-unread-dot" aria-label="Unread"></span>' : ''}
              <span>${esc(initials)}</span>
            </div>
            <div class="inbox-item-body">
              <div class="inbox-item-header">
                <span class="inbox-item-name">${esc(displayName)}</span>
                <span class="inbox-item-time">${esc(timeStr)}</span>
              </div>
              <div class="inbox-item-preview">${esc(preview)}</div>
              <div class="inbox-item-footer">
                <span class="badge ${c.channel === 'INSTAGRAM' ? 'blue' : ''}">${c.channel === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp'}</span>
                ${c.sourcePhoneNumberId ? `<span class="badge">To ${esc(c.sourceDisplayPhoneNumber || c.sourcePhoneNumberId)}</span>` : ''}
                ${getStatusBadge(state)}
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    const loadMoreHtml = pagination.hasMore
      ? `<div style="padding:12px;text-align:center"><button class="btn secondary small" id="inbox-load-more-btn">Load more</button></div>`
      : '';

    listEl.innerHTML = itemsHtml + loadMoreHtml;

    // Attach click listeners to conversation items
    listEl.querySelectorAll('.inbox-item').forEach((el) => {
      el.onclick = () => selectConversation(el.dataset.convId);
      el.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectConversation(el.dataset.convId);
        }
      };
    });

    const loadMoreBtn = listEl.querySelector('#inbox-load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.onclick = loadMoreConversations;
    }
  }

  function selectConversation(id) {
    if (!id) return;
    activeConversationId = id;
    failedSendDraft = '';
    transcriptLimit = 50;
    activeMessages = [];
    olderCursor = null;
    hasOlderMessages = false;
    olderPageLoaded = false;

    // Update URL without full reload
    history.replaceState({}, '', '/app/inbox/' + id);

    const layout = document.querySelector('.inbox-layout');
    if (layout) layout.classList.add('has-active');

    renderConversationList();

    const detailContainer = document.querySelector('#inbox-detail-container');
    if (detailContainer) {
      detailContainer.innerHTML = `
        <div class="inbox-empty-view">
          <span class="spinner"></span>
          <p>Loading conversation…</p>
        </div>
      `;
    }

    loadConversation(id);
  }

  function renderDetail(preserveScroll = false) {
    const container = document.querySelector('#inbox-detail-container');
    if (!container || !activeConversation) return;

    const transcriptEl = container.querySelector('.inbox-transcript');
    const scrollBottom = transcriptEl ? transcriptEl.scrollHeight - transcriptEl.scrollTop : 0;
    const reportDrafts = [...container.querySelectorAll('[data-flag-form]')].map(form => {
      const input=form.querySelector('textarea');
      return {id:form.dataset.flagForm,hidden:form.hidden,note:input.value,busy:form.querySelector('button').disabled,
        focused:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd};
    });

    const conv = activeConversation;
    const displayName = conv.customer?.name || conv.customer?.phone || 'Customer';
    const phone = conv.customer?.phone || '';
    const state = conv.ownership?.state || conv.status;
    const canSendFreeform = Boolean(conv.customerServiceWindow?.canSendFreeform);
    const isHumanActive = state === 'HUMAN_ACTIVE';

    // Actions in topbar: Take over, Resolve, Reopen
    let actionButtons = '';
    if (state === 'HUMAN_REQUIRED' || state === 'AI_ACTIVE') {
      actionButtons += `<button class="btn small" id="inbox-takeover-btn">Take over</button>`;
    }
    if (isHumanActive) {
      actionButtons += `<button class="btn secondary small" id="inbox-resolve-btn">Resolve</button>`;
    } else if (state === 'RESOLVED') {
      actionButtons += `<button class="btn secondary small" id="inbox-reopen-btn">Reopen</button>`;
    }

    // Customer Service Window expired banner
    let cswBanner = '';
    if (!canSendFreeform) {
      cswBanner = `
        <div class="inbox-csw-banner" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex:none"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span>The WhatsApp customer-service window has expired. A free-form reply can't be sent.</span>
        </div>
      `;
    }

    // Unconfirmed delivery banner
    const hasUnconfirmed = activeMessages.some((m) => m.metadata?.deliveryStatus === 'DELIVERY_UNKNOWN');
    let unconfirmedBanner = '';
    if (hasUnconfirmed) {
      unconfirmedBanner = `
        <div class="inbox-csw-banner" role="alert" style="background:#f9bc5920;border-bottom:1px solid #f9bc5950;color:#e7bd7b">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex:none"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>A recent outbound message outcome is unconfirmed. Reconciling delivery status with WhatsApp…</span>
        </div>
      `;
    }

    // Render Transcript Messages
    let transcriptHtml = '';
    if (hasOlderMessages) {
      transcriptHtml += `
        <div class="inbox-load-older-wrap">
          <button class="btn secondary small inbox-load-older" id="inbox-load-older-btn">Load older messages</button>
        </div>
      `;
    }

    if (!activeMessages.length) {
      transcriptHtml += `<div class="inbox-empty-view"><p>No messages in this conversation.</p></div>`;
    } else {
      transcriptHtml += activeMessages
        .map((m) => {
          const isCustomer = m.role === 'USER';
          const isManualHuman = m.role === 'ASSISTANT' && Boolean(m.metadata?.manual);
          const isAi = m.role === 'ASSISTANT' && !isManualHuman;

          let roleClass = 'msg-customer';
          let senderLabel = 'Customer';
          if (isAi) {
            roleClass = 'msg-ai';
            senderLabel = 'AI';
          } else if (isManualHuman) {
            roleClass = 'msg-human';
            senderLabel = 'You';
          }

          let deliveryHtml = '';
          if (m.role === 'ASSISTANT' && m.metadata?.deliveryStatus) {
            const status = m.metadata.deliveryStatus;
            if (status === 'PENDING') {
              deliveryHtml = `<span class="delivery-status delivery-pending">⏳ Sending…</span>`;
            } else if (status === 'SENT') {
              deliveryHtml = `<span class="delivery-status delivery-sent">✓ Sent</span>`;
            } else if (status === 'DELIVERED') {
              deliveryHtml = `<span class="delivery-status delivery-delivered">✓✓ Delivered</span>`;
            } else if (status === 'READ') {
              deliveryHtml = `<span class="delivery-status delivery-read">✓✓ Read</span>`;
            } else if (status === 'DELIVERY_UNKNOWN') {
              deliveryHtml = `
                <span class="delivery-status delivery-unknown" title="${esc(m.metadata?.error || 'Outcome unconfirmed; reconciling with WhatsApp…')}">⚠️ Unconfirmed</span>
              `;
            } else if (status === 'FAILED') {
              deliveryHtml = `
                <span class="delivery-status delivery-failed" title="${esc(m.metadata?.error || '')}">✕ Failed to send</span>
                ${isManualHuman ? `<button class="delivery-retry-btn" data-retry-text="${esc(m.content)}">Retry</button>` : ''}
              `;
            }
          }

          const timeStr = formatTime(m.createdAt);

          return `
            <div class="inbox-msg ${roleClass}" data-msg-id="${m.id}">
              <div class="inbox-msg-sender">
                <span>${esc(senderLabel)}</span>
              </div>
              <div class="inbox-msg-content" dir="auto" data-no-translate>${esc(m.content)}</div>
              <div class="inbox-msg-meta">
                <span>${esc(timeStr)}</span>
                ${deliveryHtml}
                ${isAi && m.feedbackStatus ? `<span class="answer-report-status">${m.feedbackStatus === 'RESOLVED' ? 'Problem resolved' : 'Reported · Under review'}</span>` : isAi ? `<button class="answer-flag-toggle" type="button" data-flag-answer="${esc(m.id)}" aria-label="Report a problem">Report a problem</button>` : ''}
              </div>
              ${isAi && !m.feedbackStatus ? `<form class="answer-flag-form" data-flag-form="${esc(m.id)}" hidden><label>What was wrong with this answer?<textarea maxlength="1000" rows="2" required placeholder="Wrong fact, missed question, wrong language…"></textarea></label><button class="btn secondary" type="submit">Report a problem</button></form>` : ''}
            </div>
          `;
        })
        .join('');
    }

    // Composer
    let composerHtml = '';
    if (!isHumanActive) {
      composerHtml = `
        <div class="inbox-composer-box">
          <div class="inbox-composer-disabled-note">
            Take over this conversation to reply manually.
          </div>
        </div>
      `;
    } else if (!canSendFreeform) {
      composerHtml = `
        <div class="inbox-composer-box">
          <div class="inbox-composer-disabled-note">
            The WhatsApp customer-service window has expired. A free-form reply can't be sent.
          </div>
        </div>
      `;
    } else {
      composerHtml = `
        <div class="inbox-composer-box">
          <form class="inbox-composer-form" id="inbox-composer-form">
            <textarea
              id="inbox-composer-input"
              class="inbox-composer-input"
              rows="2"
              placeholder="Type a reply…"
              aria-label="Type a reply"
              required
            >${esc(failedSendDraft)}</textarea>
            <button class="btn" type="submit" id="inbox-send-btn">
              Send
            </button>
          </form>
        </div>
      `;
    }

    container.innerHTML = `
      <header class="inbox-detail-topbar">
        <div class="inbox-detail-info">
          <button class="inbox-back-btn" id="inbox-back-btn" aria-label="Back to conversations">
            ‹ Back
          </button>
          <div>
            <strong>${esc(displayName)}</strong>
            ${phone && phone !== displayName ? `<small> · ${esc(phone)}</small>` : ''}
            ${conv.sourcePhoneNumberId ? `<small> · To ${esc(conv.sourceDisplayPhoneNumber || conv.sourcePhoneNumberId)}</small>` : ''}
          </div>
          ${getStatusBadge(state)}
        </div>
        <div class="inbox-actions-bar">
          ${actionButtons}
        </div>
      </header>
      ${cswBanner}
      ${unconfirmedBanner}
      <div class="inbox-transcript" role="log" aria-live="polite">
        ${transcriptHtml}
      </div>
      ${composerHtml}
    `;

    // Wire listeners
    const backBtn = container.querySelector('#inbox-back-btn');
    if (backBtn) {
      backBtn.onclick = () => {
        activeConversationId = null;
        activeConversation = null;
        activeMessages = [];
        history.replaceState({}, '', '/app/inbox');
        const layout = document.querySelector('.inbox-layout');
        if (layout) layout.classList.remove('has-active');
        renderConversationList();
        renderDetail();
      };
    }

    const takeoverBtn = container.querySelector('#inbox-takeover-btn');
    if (takeoverBtn) takeoverBtn.onclick = takeoverConversation;

    const resolveBtn = container.querySelector('#inbox-resolve-btn');
    if (resolveBtn) resolveBtn.onclick = resolveConversation;

    const reopenBtn = container.querySelector('#inbox-reopen-btn');
    if (reopenBtn) reopenBtn.onclick = reopenConversation;

    const loadOlderBtn = container.querySelector('#inbox-load-older-btn');
    if (loadOlderBtn) {
      loadOlderBtn.onclick = async () => {
        if (!olderCursor || detailFetchInProgress) return;
        const id = activeConversationId;
        loadOlderBtn.disabled = true;
        detailFetchInProgress = true;
        try {
          const res = await ctx.api('/client/conversations/' + encodeURIComponent(id) + '?limit=50&before=' + encodeURIComponent(olderCursor));
          if (id !== activeConversationId) return;
          const combined = new Map([...(res.messages || []), ...activeMessages].map(message => [message.id,message]));
          activeMessages = [...combined.values()].sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt) || a.id.localeCompare(b.id));
          olderCursor = res.nextBefore; hasOlderMessages = Boolean(res.hasOlderMessages); olderPageLoaded = true;
          renderDetail(true);
        } catch(error) { ctx.toast(error.message,true); loadOlderBtn.disabled=false; }
        finally {
          detailFetchInProgress=false;
          if (pendingDetailReload) {
            const next=pendingDetailReload; pendingDetailReload=null;
            void loadConversation(next.id,false,next.preserveScroll);
          }
        }
      };
    }

    const composerForm = container.querySelector('#inbox-composer-form');
    if (composerForm) {
      composerForm.onsubmit = (e) => {
        e.preventDefault();
        sendMerchantMessage();
      };
      const input = container.querySelector('#inbox-composer-input');
      if (input) {
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMerchantMessage();
          }
        };
      }
    }

    container.querySelectorAll('.delivery-retry-btn').forEach((btn) => {
      btn.onclick = () => {
        const text = btn.dataset.retryText;
        const input = container.querySelector('#inbox-composer-input');
        if (input) {
          input.value = text;
          input.focus();
        }
      };
    });

    container.querySelectorAll('[data-flag-answer]').forEach(button => {
      button.onclick = () => {
        const form = container.querySelector(`[data-flag-form="${button.dataset.flagAnswer}"]`);
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('textarea').focus();
      };
    });
    container.querySelectorAll('[data-flag-form]').forEach(form => {
      const draft=reportDrafts.find(item=>item.id===form.dataset.flagForm);
      if (draft) {
        const input=form.querySelector('textarea');
        form.hidden=draft.hidden; input.value=draft.note; form.querySelector('button').disabled=draft.busy;
        if (draft.focused) {input.focus({preventScroll:true});input.setSelectionRange(draft.start,draft.end);}
      }
      form.onsubmit = async event => {
        event.preventDefault();
        const conversationId=activeConversation.id,messageId=form.dataset.flagForm;
        const currentForm=()=>activeConversationId===conversationId ? container.querySelector(`[data-flag-form="${messageId}"]`) : null;
        const button = form.querySelector('button'); button.disabled = true;
        try {
          const result = await ctx.api('/client/conversations/' + encodeURIComponent(conversationId) + '/answer-feedback', {
            method: 'POST', body: JSON.stringify({ messageId, note: form.querySelector('textarea').value.trim() })
          });
          if (activeConversationId === conversationId) {
            const message = activeMessages.find(item => item.id === messageId);
            if (message) message.feedbackStatus = result.feedback?.status || 'OPEN';
            renderDetail(true);
          }
          const visibleForm=currentForm();
          if (visibleForm) {visibleForm.hidden=true;visibleForm.querySelector('textarea').value='';}
          ctx.toast('Problem reported to your administrator.');
        } catch (error) { ctx.toast(error.message || 'Could not report answer', true); }
        finally { button.disabled = false; const visibleForm=currentForm(); if (visibleForm) visibleForm.querySelector('button').disabled=false; }
      };
    });

    // Handle scroll position
    const newTranscriptEl = container.querySelector('.inbox-transcript');
    if (newTranscriptEl) {
      if (preserveScroll) {
        newTranscriptEl.scrollTop = newTranscriptEl.scrollHeight - scrollBottom;
      } else {
        newTranscriptEl.scrollTop = newTranscriptEl.scrollHeight;
      }
    }
  }

  async function takeoverConversation() {
    if (!activeConversation) return;
    const btn = document.querySelector('#inbox-takeover-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await ctx.api('/client/conversations/' + activeConversation.id + '/takeover', {
        method: 'POST'
      });
      if (res.conversation) {
        activeConversation.status = res.conversation.status;
        activeConversation.ownership = res.conversation.ownership;

        // Sync with conversations list
        const item = conversations.find((c) => c.id === activeConversation.id);
        if (item) {
          item.status = res.conversation.status;
          item.ownership = res.conversation.ownership;
          renderConversationList();
        }

        ctx.toast('Conversation claimed.');
        renderDetail(true);
      }
    } catch (err) {
      ctx.toast(err.message || 'Takeover failed', true);
      if (btn) btn.disabled = false;
    }
  }

  async function resolveConversation() {
    if (!activeConversation) return;
    const btn = document.querySelector('#inbox-resolve-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await ctx.api('/client/conversations/' + activeConversation.id + '/resolve', {
        method: 'POST'
      });
      if (res.conversation) {
        activeConversation.status = res.conversation.status;
        activeConversation.ownership = res.conversation.ownership;

        const item = conversations.find((c) => c.id === activeConversation.id);
        if (item) {
          item.status = res.conversation.status;
          item.ownership = res.conversation.ownership;
          renderConversationList();
        }

        ctx.toast('Conversation resolved.');
        renderDetail(true);
      }
    } catch (err) {
      ctx.toast(err.message || 'Resolve failed', true);
      if (btn) btn.disabled = false;
    }
  }

  async function reopenConversation() {
    if (!activeConversation) return;
    const btn = document.querySelector('#inbox-reopen-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await ctx.api('/client/conversations/' + activeConversation.id + '/reopen', {
        method: 'POST'
      });
      if (res.conversation) {
        activeConversation.status = res.conversation.status;
        activeConversation.ownership = res.conversation.ownership;

        const item = conversations.find((c) => c.id === activeConversation.id);
        if (item) {
          item.status = res.conversation.status;
          item.ownership = res.conversation.ownership;
          renderConversationList();
        }

        ctx.toast('Conversation reopened. AI automation active.');
        renderDetail(true);
      }
    } catch (err) {
      ctx.toast(err.message || 'Reopen failed', true);
      if (btn) btn.disabled = false;
    }
  }

  async function sendMerchantMessage() {
    if (isSending || !activeConversation) return;
    const input = document.querySelector('#inbox-composer-input');
    const sendBtn = document.querySelector('#inbox-send-btn');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    isSending = true;
    if (sendBtn) sendBtn.disabled = true;
    input.disabled = true;

    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await ctx.api('/client/conversations/' + activeConversation.id + '/messages', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          text,
          idempotencyKey
        })
      });

      failedSendDraft = '';
      input.value = '';

      if (res.message) {
        activeMessages.push(res.message);
      }

      // Refresh transcript from server
      await loadConversation(activeConversation.id, true, false);
    } catch (err) {
      failedSendDraft = text;
      ctx.toast(err.message || 'Failed to send message', true);
      // Re-enable composer
      if (sendBtn) sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    } finally {
      isSending = false;
    }
  }

  function startInboxPolling() {
    stopInboxPolling();

    // Active conversation poll (~4s)
    detailPollingTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && activeConversationId) {
        loadConversation(activeConversationId, true, true);
      }
    }, 4000);

    // List poll (~12s)
    listPollingTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadConversationList(true);
      }
    }, 12000);
  }

  function stopInboxPolling() {
    if (detailPollingTimer) {
      clearInterval(detailPollingTimer);
      detailPollingTimer = null;
    }
    if (listPollingTimer) {
      clearInterval(listPollingTimer);
      listPollingTimer = null;
    }
  }

  function cleanup() {
    renderVersion++;
    stopInboxPolling();
    clearTimeout(searchTimer);
    activeConversationId = null;
    activeConversation = null;
    activeMessages = [];
    olderCursor = null;
    hasOlderMessages = false;
    olderPageLoaded = false;
    conversations = [];
    sourceNumber = '';
  }

  async function renderInbox(context) {
    ctx = context;
    cleanup();
    const version = renderVersion;

    // Determine initial conversation ID from path if present: /app/inbox/:id
    const parts = location.pathname.split('/');
    if (parts[2] === 'inbox' && parts[3]) {
      activeConversationId = parts[3];
    }

    const filters = [
      { key: 'all', label: 'All' },
      { key: 'open', label: 'Open' },
      { key: 'needs_human', label: 'Needs you' },
      { key: 'human_active', label: 'Human active' },
      { key: 'resolved', label: 'Resolved' },
      { key: 'unread', label: 'Unread' }
    ];

    const filtersHtml = filters
      .map(
        (f) => `
        <button
          type="button"
          class="inbox-filter-btn ${currentFilter === f.key ? 'active' : ''}"
          data-filter="${f.key}">
          ${esc(f.label)}
        </button>
      `
      )
      .join('');

    const contentHtml = `
      <div class="inbox-layout ${activeConversationId ? 'has-active' : ''}">
        <div class="inbox-list-col">
          <div class="inbox-header-row">
            <input
              type="search"
              class="inbox-search"
              id="inbox-search-input"
              placeholder="Search conversations…"
              aria-label="Search conversations"
              value="${esc(searchQuery)}"
            />
            <div class="inbox-filter-bar" role="tablist" aria-label="Conversation filters">
              ${filtersHtml}
            </div>
            <select id="inbox-number-filter" aria-label="Filter by WhatsApp number"><option value="">All WhatsApp numbers</option></select>
          </div>
          <div class="inbox-conversations" id="inbox-conversations-list" role="navigation" aria-label="Conversations list">
            <div class="inbox-empty-view"><span class="spinner"></span></div>
          </div>
        </div>

        <div class="inbox-detail-col" id="inbox-detail-container">
          <div class="inbox-empty-view">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;opacity:0.3;margin-bottom:8px">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p>Select a conversation to read the transcript.</p>
          </div>
        </div>
      </div>
    `;

    ctx.root.innerHTML = ctx.shell(contentHtml, false, 'Inbox');

    const numberFilter = document.querySelector('#inbox-number-filter');
    if (numberFilter) {
      numberFilter.onchange = () => { sourceNumber = numberFilter.value; loadConversationList(); };
      try {
        const dashboard = await ctx.api('/client/dashboard');
        if (version !== renderVersion || !numberFilter.isConnected) return;
        (dashboard.metrics?.numbers || []).filter(n => n.phoneNumberId).forEach(n => {
          const option = document.createElement('option');
          option.value = n.phoneNumberId;
          option.textContent = n.displayPhoneNumber || n.phoneNumberId;
          numberFilter.appendChild(option);
        });
        numberFilter.value = sourceNumber;
      } catch { /* The inbox remains usable when number options cannot load. */ }
    }

    // Wire filters
    document.querySelectorAll('.inbox-filter-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.inbox-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        loadConversationList();
      };
    });

    // Wire search with debounce
    const searchInput = document.querySelector('#inbox-search-input');
    if (searchInput) {
      searchInput.oninput = (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          searchQuery = e.target.value.trim();
          loadConversationList();
        }, 300);
      };
    }

    ctx.bind();

    // Load initial data
    await loadConversationList();
    if (version !== renderVersion) return;

    if (activeConversationId) {
      await loadConversation(activeConversationId);
      if (version !== renderVersion) return;
    }

    // Start background polling
    startInboxPolling();
  }

  // Export to window
  window.RelayqoInbox = {
    renderInbox,
    cleanup,
    loadConversationList,
    loadConversation,
    renderConversationList,
    renderDetail,
    takeoverConversation,
    resolveConversation,
    reopenConversation,
    sendMerchantMessage,
    startInboxPolling,
    stopInboxPolling
  };
})();
