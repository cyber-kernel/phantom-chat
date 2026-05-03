/* Phantom Chat — App JS v3 FIXED */
(function () {
  'use strict';

  /* ── state ── */
  let socket, myUser, myKey, activePeer;
  const pendingSeenAcks = new Set(); // messageIds where seenAck arrived before bubble
  let allUsers = [];
  const unreadCounts = {};       // peer → unread count
  const timers = {};             // msgId → intervalId
  let ctxTarget = null;
  let typingOut = null;
  let prevSender = null;
  let prevDate = null;

  /* ── shortcuts ── */
  const $ = id => document.getElementById(id);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  /* ── elements ── */
  const scrAuth = $('screen-auth'), scrApp = $('screen-app');
  const s1 = $('s1'), s2 = $('s2'), s3 = $('s3');
  const inpUser = $('inp-username'), btnCont = $('btn-continue'), errS1 = $('err-s1');
  const btnBackS2 = $('btn-back-s2'), lblUser = $('lbl-username'), inpKey = $('inp-key');
  const btnEnter = $('btn-enterkey'), errS2 = $('err-s2');
  const lblNewKey = $('lbl-newkey'), btnCopyK = $('btn-copykey'), btnGoApp = $('btn-goapp');
  const sbDim = $('sidebar-dim'), sidebar = $('sidebar'), fab = $('fab');
  const sbMePill = $('sb-me-pill'), sbMyName = $('sb-my-name'), sbMyAva = $('sb-my-avatar');
  const inpSearch = $('inp-search'), usersList = $('users-list');
  const btnLogout = $('btn-logout');
  const emptyState = $('empty-state'), chatView = $('chat-view');
  const btnMBack = $('btn-mobile-back');
  const peerAva = $('peer-ava'), peerName = $('peer-name'), peerStatus = $('peer-status');
  const btnClear = $('btn-clear');
  const msgsWrap = $('msgs-wrap'), msgsInner = $('msgs-inner');
  const typBar = $('typing-bar'), typWho = $('typing-who');
  const msgInp = $('msg-inp'), btnSend = $('btn-send');
  const ctx = $('ctx'), ctxCopy = $('ctx-copy'), ctxDel = $('ctx-del');
  const toastEl = $('toast');

  /* ════════════════════════════════
     UTILS
  ════════════════════════════════ */
  function esc(s) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s || '')));
    return d.innerHTML;
  }
  function ava(n) { return (n || '?')[0].toUpperCase(); }
  function fmtTime(d) {
    return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(d) {
    const dt = new Date(d), now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (dt.toDateString() === now.toDateString()) return 'Today';
    if (dt.toDateString() === yest.toDateString()) return 'Yesterday';
    return dt.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function isMobile() { return window.innerWidth <= 640; }
  function toast(msg, ms = 2400) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
  }
  function showCard(id) {
    [s1, s2, s3].forEach(c => c.classList.add('hidden'));
    $(id).classList.remove('hidden');
  }
  function setBtn(btn, text, disabled) {
    btn.textContent = text; btn.disabled = disabled;
  }

  /* ════════════════════════════════
     AUTH FLOW
  ════════════════════════════════ */
  on(btnCont, 'click', handleStep1);
  on(inpUser, 'keydown', e => e.key === 'Enter' && handleStep1());

  on(btnBackS2, 'click', () => {
    showCard('s1'); errS1.textContent = ''; errS2.textContent = ''; inpKey.value = '';
  });

  on(btnEnter, 'click', handleStep2);
  on(inpKey, 'keydown', e => e.key === 'Enter' && handleStep2());

  on(btnCopyK, 'click', () => {
    navigator.clipboard.writeText(lblNewKey.textContent)
      .then(() => { btnCopyK.classList.add('copied'); toast('✓ Key copied!'); setTimeout(() => btnCopyK.classList.remove('copied'), 2000); })
      .catch(() => toast('Copy failed — screenshot instead'));
  });

  on(btnGoApp, 'click', () => initApp());

  /* Step 1 — just the username.
     Hit server with no key:
     - 200 + isNew:true  → new user, key auto-generated, show key screen
     - 401 + exists:true → existing user, ask for key
     - other error       → show error */
  async function handleStep1() {
    errS1.textContent = '';
    const raw = inpUser.value.trim();
    if (!raw || raw.length < 2) { errS1.textContent = 'Min 2 characters'; return; }

    setBtn(btnCont, '...', true);
    try {
      const res = await fetch('/api/users/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: raw })
      });
      const data = await res.json();

      if (res.ok && data.isNew) {
        // Brand-new user — server generated the key, show it
        myUser = data.username;
        myKey = data.secretKey;
        localStorage.setItem('pu', myUser);
        localStorage.setItem('pk_' + myUser.toLowerCase(), myKey);
        lblNewKey.textContent = myKey;
        showCard('s3');
        return;
      }

      if (res.status === 401 && data.exists) {
        // Existing user — ask for their key
        lblUser.textContent = raw;
        showCard('s2');
        inpKey.value = '';
        setTimeout(() => inpKey.focus(), 50);
        return;
      }

      // Any other error (validation, server error etc.)
      errS1.textContent = data.error || 'Something went wrong';
    } catch {
      errS1.textContent = 'Connection failed. Is the server running?';
    } finally {
      setBtn(btnCont, 'Continue →', false);
    }
  }

  /* Step 2 — existing user enters their secret key */
  async function handleStep2() {
    errS2.textContent = '';
    const raw = inpUser.value.trim();
    const key = inpKey.value.trim().toUpperCase();
    if (!key) { errS2.textContent = 'Enter your secret key'; return; }
    if (key.length !== 6) { errS2.textContent = 'Key is exactly 6 characters'; return; }
    await doJoin(raw, key);
  }

  async function doJoin(username, secretKey) {
    setBtn(btnCont, '...', true);
    setBtn(btnEnter, '...', true);
    errS1.textContent = ''; errS2.textContent = '';
    try {
      const res = await fetch('/api/users/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, secretKey })
      });
      const data = await res.json();
      if (!res.ok) {
        // Show error on whichever card is visible
        const target = s2.classList.contains('hidden') ? errS1 : errS2;
        target.textContent = data.error || 'Login failed';
        return;
      }
      myUser = data.username;
      myKey = data.secretKey;
      localStorage.setItem('pu', myUser);
      localStorage.setItem('pk_' + myUser.toLowerCase(), myKey);

      if (data.isNew) {
        lblNewKey.textContent = myKey;
        showCard('s3');
      } else {
        initApp();
      }
    } catch {
      const target = s2.classList.contains('hidden') ? errS1 : errS2;
      target.textContent = 'Connection failed. Is server running?';
    } finally {
      setBtn(btnCont, 'Continue →', false);
      setBtn(btnEnter, 'Enter Chat →', false);
    }
  }

  /* ════════════════════════════════
     APP INIT
  ════════════════════════════════ */
  function initApp() {
    showScreen('screen-app');
    sbMePill.textContent = myUser;
    sbMyName.textContent = myUser;
    sbMyAva.textContent = ava(myUser);
    if (isMobile()) { fab.classList.remove('hidden'); openSidebar(); }
    connectSocket();
    loadUsers();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
  }

  /* ════════════════════════════════
     SOCKET
  ════════════════════════════════ */
  function applySeenTick(messageId) {
    const bubble = document.querySelector(`[data-id="${messageId}"]`);
    if (!bubble) return;
    const wrap = bubble.closest('.msg-wrap');
    if (!wrap || !wrap.classList.contains('out')) return;
    if (!bubble.querySelector('.bubble-seen')) {
      const foot = bubble.querySelector('.bubble-foot');
      if (foot) {
        const s = document.createElement('span');
        s.className = 'bubble-seen';
        s.textContent = '✓✓';
        foot.appendChild(s);
      }
    }
  }
  function connectSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      socket.emit('user:join', { username: myUser, secretKey: myKey });
    });

    socket.on('auth:error', ({ error }) => {
      toast('Auth error: ' + error);
      setTimeout(() => { localStorage.clear(); location.reload(); }, 2000);
    });

    socket.on('user:online', ({ username, online }) => {
      const u = allUsers.find(x => x.username === username);
      if (u) { u.online = online; renderUsers(); }
      else if (online) loadUsers();
      if (username === activePeer) setPeerStatus(online);
    });

    /* ── Incoming / outgoing message ── */
    socket.on('message:new', msg => {
      // Remove any optimistic temp bubble from the sender side
      if (msg.sender === myUser) {
        document.querySelectorAll('[data-id^="tmp_"]').forEach(el => {
          el.closest('.msg-wrap')?.remove();
        });
      }

      const inActiveChatSent = msg.sender === myUser && msg.receiver === activePeer;
      const inActiveChatReceived = msg.sender === activePeer && msg.receiver === myUser;

      if (inActiveChatSent || inActiveChatReceived) {
        appendMsg(msg);
        // Apply any seenAck that arrived before this bubble was rendered
        if (pendingSeenAcks.has(msg._id)) {
          applySeenTick(msg._id);
          pendingSeenAcks.delete(msg._id);
        }
        if (inActiveChatReceived && !msg.seen) {
          setTimeout(() => socket.emit('message:seen', { messageId: msg._id, viewer: myUser }), 200);
        }
      } else if (msg.receiver === myUser) {
        unreadCounts[msg.sender] = (unreadCounts[msg.sender] || 0) + 1;
        renderUsers();
      }
    });

    /* ── Seen acknowledgement — ONLY update sender's outgoing bubble ── */
    socket.on('message:seenAck', ({ messageId }) => {
      applySeenTick(messageId);
      // Store it — bubble might not exist yet (race with message:new)
      pendingSeenAcks.add(messageId);
    });

    socket.on('message:countdown', ({ messageId, timer }) => startCountdown(messageId, timer));
    socket.on('message:destroyed', ({ messageId }) => destroyMsg(messageId));

    socket.on('message:edited', ({ messageId, message }) => {
      const b = document.querySelector(`[data-id="${messageId}"]`);
      if (!b) return;
      const t = b.querySelector('.bubble-text'); if (t) t.textContent = message;
      if (!b.querySelector('.bubble-edited')) {
        const foot = b.querySelector('.bubble-foot');
        if (foot) { const e = document.createElement('span'); e.className = 'bubble-edited'; e.textContent = '(edited)'; foot.appendChild(e); }
      }
    });

    socket.on('chat:cleared', ({ peer }) => {
      if (peer === activePeer || peer === myUser) {
        clearAllTimers(); msgsInner.innerHTML = ''; prevSender = null; prevDate = null;
        toast('Chat cleared');
      }
    });

    socket.on('user:typing', ({ sender, isTyping }) => {
      if (sender !== activePeer) return;
      typWho.textContent = sender;
      typBar.classList.toggle('hidden', !isTyping);
      if (isTyping) scrollBottom();
    });
  }

  /* ════════════════════════════════
     USERS
  ════════════════════════════════ */
  async function loadUsers() {
    try {
      const res = await fetch('/api/users');
      allUsers = await res.json();
      renderUsers();
    } catch { /* silent */ }
  }

  function renderUsers() {
    const q = inpSearch.value.toLowerCase();
    const list = allUsers
      .filter(u => u.username !== myUser && u.username.toLowerCase().includes(q))
      .sort((a, b) => b.online - a.online || a.username.localeCompare(b.username));

    usersList.innerHTML = '';
    if (!list.length) {
      usersList.innerHTML = `<li style="padding:20px;text-align:center;color:var(--t3);font-size:13px">${inpSearch.value ? 'No users found' : 'No other users yet'}</li>`;
      return;
    }
    list.forEach(u => {
      const li = document.createElement('li');
      li.className = 'u-item' + (u.username === activePeer ? ' active' : '');
      const unread = unreadCounts[u.username] || 0;
      const badgeHTML = unread > 0
        ? `<div class="u-badge">${unread > 99 ? '99+' : unread}</div>`
        : '';
      li.innerHTML = `
      <div class="u-ava">${esc(ava(u.username))}${u.online ? '<div class="u-dot"></div>' : ''}</div>
      <div class="u-info">
        <div class="u-name">${esc(u.username)}</div>
        <div class="u-sub ${u.online ? 'on' : ''}">${u.online ? '● online' : 'offline'}</div>
      </div>
      ${badgeHTML}`;
      on(li, 'click', () => { openChat(u.username); if (isMobile()) closeSidebar(); });
      usersList.appendChild(li);
    });
  }

  on(inpSearch, 'input', renderUsers);

  /* ════════════════════════════════
     SIDEBAR (mobile)
  ════════════════════════════════ */
  function openSidebar() { sidebar.classList.add('open'); sbDim.classList.add('on'); fab.classList.add('hidden'); }
  function closeSidebar() { sidebar.classList.remove('open'); sbDim.classList.remove('on'); if (isMobile()) fab.classList.remove('hidden'); }

  on(fab, 'click', openSidebar);
  on(sbDim, 'click', closeSidebar);
  on(btnMBack, 'click', () => {
    activePeer = null;
    chatView.classList.add('hidden'); emptyState.classList.remove('hidden');
    renderUsers(); clearAllTimers(); if (isMobile()) openSidebar();
  });

  /* ════════════════════════════════
     OPEN CHAT
  ════════════════════════════════ */
  async function openChat(peer) {
    if (peer === activePeer) return;
    activePeer = peer;
    prevSender = null; prevDate = null;

    // Clear unread badge for this peer
    unreadCounts[peer] = 0;
    renderUsers();

    clearAllTimers();

    emptyState.classList.add('hidden'); chatView.classList.remove('hidden');
    peerAva.textContent = ava(peer);
    peerName.textContent = peer;
    const pu = allUsers.find(u => u.username === peer);
    setPeerStatus(pu?.online);
    msgsInner.innerHTML = '';
    typBar.classList.add('hidden');

    try {
      const res = await fetch(`/api/messages/conversation/${myUser}/${peer}`);
      const msgs = await res.json();
      msgs.forEach(m => {
        appendMsg(m, true);
        if (m.receiver === myUser && !m.seen) {
          socket.emit('message:seen', { messageId: m._id, viewer: myUser });
        } else if (m.seen && m.deleteAt) {
          const left = new Date(m.deleteAt).getTime() - Date.now();
          if (left > 0) startCountdown(m._id, Math.ceil(left / 1000));
          else destroyMsg(m._id);
        }
      });
    } catch { toast('Failed to load messages'); }

    scrollBottom(true);
    if (!isMobile()) msgInp.focus();
  }

  function setPeerStatus(online) {
    peerStatus.textContent = online ? 'online' : 'offline';
    peerStatus.className = 'peer-status' + (online ? ' on' : '');
  }

  /* ════════════════════════════════
     APPEND MESSAGE
  ════════════════════════════════ */
  function appendMsg(msg, noAnim = false) {
    if (document.querySelector(`[data-id="${msg._id}"]`)) return;

    const mine = msg.sender === myUser;
    const dStr = fmtDate(msg.createdAt);

    // date separator
    if (dStr !== prevDate) {
      prevDate = dStr;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.innerHTML = `<span>${esc(dStr)}</span>`;
      msgsInner.appendChild(sep);
      prevSender = null;
    }

    const grouped = prevSender === msg.sender;
    prevSender = msg.sender;

    // timer badge
    let timerHTML = '';
    if (msg.timer) {
      if (msg.seen && msg.deleteAt) {
        timerHTML = `<div class="timer-badge ticking" data-timer="${msg._id}">⏱ ...</div>`;
      } else {
        timerHTML = `<div class="timer-badge waiting" data-timer="${msg._id}">⏱ ${msg.timer}s after opened</div>`;
      }
    }

    // ✓✓ only on outgoing messages that are already seen
    const seenHTML = (mine && msg.seen) ? '<span class="bubble-seen">✓✓</span>' : '';

    const wrap = document.createElement('div');
    wrap.className = `msg-wrap ${mine ? 'out' : 'in'} ${grouped ? 'grouped' : ''}`;
    if (noAnim) wrap.style.animation = 'none';

    const delHTML = mine
      ? `<button class="del-btn" data-id="${msg._id}" title="Delete">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg></button>`
      : '';

    const senderLabel = (!mine && !grouped)
      ? `<div class="bubble-sender">${esc(msg.sender)}</div>` : '';

    wrap.innerHTML = `
    ${delHTML}
    <div class="msg-row">
      <div class="bubble" data-id="${msg._id}">
        ${senderLabel}
        <div class="bubble-text">${esc(msg.message)}</div>
        <div class="bubble-foot">
          <span class="bubble-time">${fmtTime(msg.createdAt)}</span>
          ${msg.edited ? '<span class="bubble-edited">(edited)</span>' : ''}
          ${seenHTML}
        </div>
        ${timerHTML}
      </div>
    </div>`;

    const bubble = wrap.querySelector('.bubble');
    attachBubbleEvents(bubble, msg, mine);

    const delBtn = wrap.querySelector('.del-btn');
    if (delBtn) on(delBtn, 'click', e => { e.stopPropagation(); socket.emit('message:delete', { messageId: msg._id, requester: myUser }); });

    msgsInner.appendChild(wrap);

    if (msg.seen && msg.deleteAt) {
      const left = new Date(msg.deleteAt).getTime() - Date.now();
      if (left > 0) startCountdown(msg._id, Math.ceil(left / 1000));
    }

    if (!noAnim) scrollBottom();
  }

  function attachBubbleEvents(bubble, msg, mine) {
    on(bubble, 'contextmenu', e => {
      e.preventDefault();
      ctxTarget = { id: msg._id, text: msg.message, mine };
      ctxDel.style.display = mine ? 'flex' : 'none';
      showCtx(e.clientX, e.clientY);
    });
    let pt;
    on(bubble, 'touchstart', () => {
      pt = setTimeout(() => {
        ctxTarget = { id: msg._id, text: msg.message, mine };
        ctxDel.style.display = mine ? 'flex' : 'none';
        const r = bubble.getBoundingClientRect();
        showCtx(r.left + r.width / 2, r.top + r.height / 2);
      }, 550);
    }, { passive: true });
    on(bubble, 'touchend', () => clearTimeout(pt), { passive: true });
    on(bubble, 'touchmove', () => clearTimeout(pt), { passive: true });
  }

  /* ════════════════════════════════
     CONTEXT MENU
  ════════════════════════════════ */
  function showCtx(x, y) {
    ctx.classList.remove('hidden');
    const w = 155, h = 88;
    ctx.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    ctx.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  }
  function hideCtx() { ctx.classList.add('hidden'); ctxTarget = null; }

  on(ctxCopy, 'click', () => {
    if (!ctxTarget) return;
    navigator.clipboard.writeText(ctxTarget.text)
      .then(() => toast('✓ Copied'))
      .catch(() => toast('Copy failed'));
    hideCtx();
  });
  on(ctxDel, 'click', () => {
    if (!ctxTarget || !ctxTarget.mine) return;
    socket.emit('message:delete', { messageId: ctxTarget.id, requester: myUser });
    hideCtx();
  });
  on(document, 'click', hideCtx);
  on(document, 'keydown', e => e.key === 'Escape' && hideCtx());

  /* ════════════════════════════════
     TIMER / DESTROY
  ════════════════════════════════ */
  function startCountdown(messageId, seconds) {
    if (timers[messageId]) return;
    const el = document.querySelector(`[data-timer="${messageId}"]`);
    if (el) el.className = 'timer-badge ticking';
    let rem = Math.max(1, Math.round(seconds));
    function tick() {
      const e = document.querySelector(`[data-timer="${messageId}"]`);
      if (e) e.textContent = `⏱ ${rem}s`;
      if (rem <= 0) { clearInterval(timers[messageId]); delete timers[messageId]; return; }
      rem--;
    }
    tick();
    timers[messageId] = setInterval(tick, 1000);
  }

  function destroyMsg(messageId) {
    if (timers[messageId]) { clearInterval(timers[messageId]); delete timers[messageId]; }
    const bubble = document.querySelector(`[data-id="${messageId}"]`);
    if (!bubble) return;
    bubble.classList.add('dying');
    setTimeout(() => { const w = bubble.closest('.msg-wrap'); if (w) w.remove(); }, 560);
  }

  function clearAllTimers() {
    Object.keys(timers).forEach(id => { clearInterval(timers[id]); delete timers[id]; });
  }

  /* ════════════════════════════════
     SEND MESSAGE
  ════════════════════════════════ */
  on(btnSend, 'click', sendMsg);
  on(msgInp, 'keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });

  on(msgInp, 'input', () => {
    if (!socket || !activePeer) return;
    socket.emit('user:typing', { sender: myUser, receiver: activePeer, isTyping: true });
    clearTimeout(typingOut);
    typingOut = setTimeout(() => {
      socket.emit('user:typing', { sender: myUser, receiver: activePeer, isTyping: false });
    }, 1500);
  });

  function sendMsg() {
    const text = msgInp.value.trim();
    if (!text || !activePeer || !socket) return;
    if (text.length > 500) { toast('Max 500 characters'); return; }

    const timerEl = document.querySelector('input[name="tmr"]:checked');
    const timerRaw = timerEl ? timerEl.value : 'none';
    const timer = (timerRaw === 'none') ? null : Number(timerRaw);

    // Optimistic instant render so the sender sees the message immediately
    const tempId = 'tmp_' + Date.now();
    appendMsg({
      _id: tempId,
      sender: myUser,
      receiver: activePeer,
      message: text,
      timer,
      seen: false,
      edited: false,
      createdAt: new Date().toISOString()
    });

    socket.emit('message:send', { sender: myUser, receiver: activePeer, message: text, timer });
    msgInp.value = '';
    clearTimeout(typingOut);
    socket.emit('user:typing', { sender: myUser, receiver: activePeer, isTyping: false });
    if (!isMobile()) msgInp.focus();
  }

  /* ════════════════════════════════
     CLEAR CHAT
  ════════════════════════════════ */
  on(btnClear, 'click', () => {
    if (!activePeer || !socket) return;
    if (!confirm(`Clear all messages with ${activePeer}?\nThis cannot be undone.`)) return;
    socket.emit('chat:clear', { requester: myUser, peer: activePeer });
  });

  /* ════════════════════════════════
     LOGOUT
  ════════════════════════════════ */
  on(btnLogout, 'click', () => {
    if (!confirm('Leave Phantom Chat?')) return;
    localStorage.removeItem('pu');
    location.reload();
  });

  /* ════════════════════════════════
     SCROLL
  ════════════════════════════════ */
  function scrollBottom(instant = false) {
    if (instant) { msgsWrap.scrollTop = msgsWrap.scrollHeight; return; }
    requestAnimationFrame(() => { msgsWrap.scrollTop = msgsWrap.scrollHeight; });
  }

  new MutationObserver(() => {
    const { scrollTop, scrollHeight, clientHeight } = msgsWrap;
    if (scrollHeight - scrollTop - clientHeight < 130) scrollBottom();
  }).observe(msgsInner, { childList: true, subtree: true });

  /* ════════════════════════════════
     AUTO LOGIN
  ════════════════════════════════ */
  const savedUser = localStorage.getItem('pu');
  if (savedUser) {
    const savedKey = localStorage.getItem('pk_' + savedUser.toLowerCase());
    if (savedKey) { inpUser.value = savedUser; doJoin(savedUser, savedKey); }
  }

})();
