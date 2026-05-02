/* ── Phantom Chat — Frontend App ── */
(function () {
  'use strict';

  let socket = null;
  let myUsername = null;
  let activePeer = null;
  let allUsers = [];
  const messageTimers = {};
  let ctxTargetId = null;
  let ctxMsgText = null;

  // ── DOM ──
  const joinScreen   = document.getElementById('join-screen');
  const appScreen    = document.getElementById('app');
  const usernameInput= document.getElementById('username-input');
  const joinBtn      = document.getElementById('join-btn');
  const joinError    = document.getElementById('join-error');
  const meBadge      = document.getElementById('me-badge');
  const searchInput  = document.getElementById('search-input');
  const usersList    = document.getElementById('users-list');
  const sidebar      = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const emptyState   = document.getElementById('empty-state');
  const chatView     = document.getElementById('chat-view');
  const peerName     = document.getElementById('peer-name');
  const peerDot      = document.getElementById('peer-dot');
  const peerStatus   = document.getElementById('peer-status');
  const messagesContainer = document.getElementById('messages-container');
  const msgInput     = document.getElementById('msg-input');
  const sendBtn      = document.getElementById('send-btn');
  const logoutBtn    = document.getElementById('logout-btn');
  const clearChatBtn = document.getElementById('clear-chat-btn');
  const backBtn      = document.getElementById('back-btn');
  const ctxMenu      = document.getElementById('ctx-menu');
  const ctxDelete    = document.getElementById('ctx-delete');
  const ctxCopy      = document.getElementById('ctx-copy');
  const mobileMenuBtn= document.getElementById('mobile-menu-btn');

  // ── UTILS ──
  function sanitize(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str || '')));
    return d.innerHTML;
  }
  function formatTime(date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function isMobile() { return window.innerWidth <= 640; }

  // ── JOIN ──
  joinBtn.addEventListener('click', doJoin);
  usernameInput.addEventListener('keydown', e => e.key === 'Enter' && doJoin());

  async function doJoin() {
    const raw = usernameInput.value.trim();
    joinError.textContent = '';
    if (!raw || raw.length < 2) { joinError.textContent = 'Username must be at least 2 characters'; return; }
    joinBtn.disabled = true; joinBtn.textContent = 'Joining...';
    try {
      const res = await fetch('/api/users/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: raw })
      });
      const data = await res.json();
      if (!res.ok) { joinError.textContent = data.error || 'Failed to join'; return; }
      myUsername = data.username;
      localStorage.setItem('phantomUsername', myUsername);
      initApp();
    } catch {
      joinError.textContent = 'Connection failed. Is the server running?';
    } finally {
      joinBtn.disabled = false; joinBtn.textContent = 'Enter →';
    }
  }

  // ── INIT ──
  function initApp() {
    joinScreen.classList.remove('active');
    appScreen.classList.add('active');
    meBadge.textContent = myUsername;

    // Show mobile menu button when in chat list mode
    if (isMobile()) mobileMenuBtn.classList.remove('hidden');

    socket = io();
    socket.emit('user:join', { username: myUsername });

    // ── SOCKET EVENTS ──
    socket.on('user:online', ({ username, online }) => {
      const u = allUsers.find(x => x.username === username);
      if (u) { u.online = online; renderUsersList(); }
      else if (online) loadUsers();
      if (username === activePeer) {
        peerDot.className = 'peer-dot' + (online ? ' online' : '');
        peerStatus.textContent = online ? 'online' : 'offline';
      }
    });

    socket.on('message:new', (msg) => {
      const inConvo = (msg.sender === activePeer && msg.receiver === myUsername) ||
                      (msg.sender === myUsername && msg.receiver === activePeer);
      if (inConvo) {
        appendMessage(msg);
        // If I'm the receiver, mark seen immediately (chat is open)
        if (msg.receiver === myUsername && !msg.seen) {
          setTimeout(() => socket.emit('message:seen', { messageId: msg._id, viewer: myUsername }), 200);
        }
      }
    });

    socket.on('message:seenAck', ({ messageId }) => {
      const bubble = document.querySelector(`[data-id="${messageId}"]`);
      if (!bubble) return;
      if (!bubble.querySelector('.msg-seen')) {
        const meta = bubble.querySelector('.msg-meta');
        if (meta) {
          const s = document.createElement('span');
          s.className = 'msg-seen'; s.textContent = '✓ seen';
          meta.appendChild(s);
        }
      }
    });

    socket.on('message:countdown', ({ messageId, timer }) => {
      startCountdown(messageId, timer);
    });

    socket.on('message:destroyed', ({ messageId }) => {
      destroyMessage(messageId);
    });

    socket.on('message:edited', ({ messageId, message }) => {
      const bubble = document.querySelector(`[data-id="${messageId}"]`);
      if (!bubble) return;
      const t = bubble.querySelector('.msg-text');
      if (t) t.textContent = message;
      if (!bubble.querySelector('.msg-edited')) {
        const meta = bubble.querySelector('.msg-meta');
        if (meta) {
          const b = document.createElement('span');
          b.className = 'msg-edited'; b.textContent = 'edited';
          meta.appendChild(b);
        }
      }
    });

    socket.on('chat:cleared', ({ peer }) => {
      if (peer === activePeer || peer === myUsername) {
        Object.keys(messageTimers).forEach(id => { clearInterval(messageTimers[id].interval); delete messageTimers[id]; });
        messagesContainer.innerHTML = '';
      }
    });

    loadUsers();
  }

  // ── LOAD USERS ──
  async function loadUsers() {
    try {
      const res = await fetch('/api/users');
      allUsers = await res.json();
      renderUsersList();
    } catch (e) { console.error('Failed to load users', e); }
  }

  function renderUsersList() {
    const query = searchInput.value.toLowerCase();
    const filtered = allUsers
      .filter(u => u.username !== myUsername && u.username.toLowerCase().includes(query))
      .sort((a, b) => b.online - a.online || a.username.localeCompare(b.username));

    usersList.innerHTML = '';
    if (!filtered.length) {
      usersList.innerHTML = '<li style="padding:16px;color:var(--text-muted);font-family:var(--font-mono);font-size:12px;text-align:center;">No users found</li>';
      return;
    }
    filtered.forEach(u => {
      const li = document.createElement('li');
      li.className = 'user-item' + (u.username === activePeer ? ' active' : '');
      li.innerHTML = `
        <div class="user-avatar">${sanitize(u.username[0].toUpperCase())}${u.online ? '<div class="online-dot"></div>' : ''}</div>
        <div class="user-info">
          <div class="user-name">${sanitize(u.username)}</div>
          <div class="user-status ${u.online ? 'online' : ''}">${u.online ? 'online' : 'offline'}</div>
        </div>`;
      li.addEventListener('click', () => {
        openChat(u.username);
        // On mobile, close sidebar after selecting user
        if (isMobile()) closeSidebar();
      });
      usersList.appendChild(li);
    });
  }

  searchInput.addEventListener('input', renderUsersList);

  // ── MOBILE SIDEBAR ──
  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('visible');
    mobileMenuBtn.classList.add('hidden');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
    mobileMenuBtn.classList.remove('hidden');
  }

  mobileMenuBtn.addEventListener('click', openSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  // Back button in chat header → close chat, show sidebar on mobile
  backBtn.addEventListener('click', () => {
    activePeer = null;
    chatView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    renderUsersList();
    if (isMobile()) openSidebar();
  });

  // ── OPEN CHAT ──
  async function openChat(peer) {
    activePeer = peer;
    renderUsersList();

    emptyState.classList.add('hidden');
    chatView.classList.remove('hidden');
    peerName.textContent = peer;

    const pu = allUsers.find(u => u.username === peer);
    peerDot.className = 'peer-dot' + (pu?.online ? ' online' : '');
    peerStatus.textContent = pu?.online ? 'online' : 'offline';

    messagesContainer.innerHTML = '';
    Object.keys(messageTimers).forEach(id => { clearInterval(messageTimers[id].interval); delete messageTimers[id]; });

    try {
      const res = await fetch(`/api/messages/conversation/${myUsername}/${peer}`);
      const msgs = await res.json();
      msgs.forEach(m => {
        appendMessage(m);
        if (m.receiver === myUsername && !m.seen) {
          setTimeout(() => socket.emit('message:seen', { messageId: m._id, viewer: myUsername }), 300);
        } else if (m.seen && m.deleteAt) {
          const left = new Date(m.deleteAt).getTime() - Date.now();
          if (left > 0) startCountdown(m._id, Math.ceil(left / 1000));
          else destroyMessage(m._id);
        }
      });
    } catch (e) { console.error('Load convo failed', e); }

    scrollBottom();
    if (!isMobile()) msgInput.focus();
  }

  // ── APPEND MESSAGE ──
  function appendMessage(msg) {
    if (document.querySelector(`[data-id="${msg._id}"]`)) return;

    const isSent = msg.sender === myUsername;
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper ' + (isSent ? 'sent' : 'received');

    // Timer display
    let timerHTML = '';
    if (msg.timer) {
      if (msg.seen && msg.deleteAt) {
        timerHTML = `<div class="msg-timer ticking" data-timer="${msg._id}">⏱ ...</div>`;
      } else {
        timerHTML = `<div class="msg-timer waiting" data-timer="${msg._id}">⏱ ${msg.timer}s after opened</div>`;
      }
    }

    const seenHTML = (isSent && msg.seen) ? '<span class="msg-seen">✓ seen</span>' : '';

    // Delete button — shown for own messages
    const delBtnHTML = isSent
      ? `<button class="msg-delete-btn" title="Delete">✕</button>`
      : '';

    wrapper.innerHTML = `
      ${delBtnHTML}
      <div class="msg-bubble" data-id="${msg._id}">
        <div class="msg-text">${sanitize(msg.message)}</div>
        <div class="msg-meta">
          <span class="msg-time">${formatTime(msg.createdAt)}</span>
          ${msg.edited ? '<span class="msg-edited">edited</span>' : ''}
          ${seenHTML}
        </div>
        ${timerHTML}
      </div>
    `;

    const bubble = wrapper.querySelector('.msg-bubble');

    // Right-click / long-press context menu
    bubble.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ctxTargetId = msg._id;
      ctxMsgText  = msg.message;
      ctxDelete.style.display = isSent ? 'flex' : 'none';
      showCtxMenu(e.clientX, e.clientY);
    });

    // Long press for mobile
    let pressTimer;
    bubble.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        ctxTargetId = msg._id;
        ctxMsgText  = msg.message;
        ctxDelete.style.display = isSent ? 'flex' : 'none';
        const rect = bubble.getBoundingClientRect();
        showCtxMenu(rect.left + rect.width / 2, rect.top);
      }, 500);
    }, { passive: true });
    bubble.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
    bubble.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });

    // Delete button click
    const delBtn = wrapper.querySelector('.msg-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteMsg(msg._id);
      });
    }

    messagesContainer.appendChild(wrapper);

    // Kick off countdown if already ticking
    if (msg.seen && msg.deleteAt) {
      const left = new Date(msg.deleteAt).getTime() - Date.now();
      if (left > 0) startCountdown(msg._id, Math.ceil(left / 1000));
    }

    scrollBottom();
  }

  function confirmDeleteMsg(messageId) {
    socket.emit('message:delete', { messageId, requester: myUsername });
  }

  // ── CONTEXT MENU ──
  function showCtxMenu(x, y) {
    ctxMenu.classList.remove('hidden');
    const mw = ctxMenu.offsetWidth || 150;
    const mh = ctxMenu.offsetHeight || 80;
    ctxMenu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
    ctxMenu.style.top  = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + 'px';
  }
  function hideCtxMenu() { ctxMenu.classList.add('hidden'); ctxTargetId = null; ctxMsgText = null; }

  ctxDelete.addEventListener('click', () => { if (ctxTargetId) confirmDeleteMsg(ctxTargetId); hideCtxMenu(); });
  ctxCopy.addEventListener('click', () => {
    if (ctxMsgText) navigator.clipboard.writeText(ctxMsgText).catch(() => {
      // Fallback for older mobile browsers
      const ta = document.createElement('textarea');
      ta.value = ctxMsgText; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    });
    hideCtxMenu();
  });

  document.addEventListener('click', hideCtxMenu);
  document.addEventListener('keydown', e => e.key === 'Escape' && hideCtxMenu());

  // ── CLEAR CHAT ──
  clearChatBtn.addEventListener('click', () => {
    if (!activePeer || !socket) return;
    if (!confirm(`Clear all messages with ${activePeer}?\n\nThis cannot be undone.`)) return;
    socket.emit('chat:clear', { requester: myUsername, peer: activePeer });
  });

  // ── COUNTDOWN ──
  function startCountdown(messageId, seconds) {
    if (messageTimers[messageId]) return;
    const timerEl = document.querySelector(`[data-timer="${messageId}"]`);
    if (timerEl) timerEl.className = 'msg-timer ticking';

    let remaining = Math.max(1, Math.round(seconds));

    function tick() {
      const el = document.querySelector(`[data-timer="${messageId}"]`);
      if (el) el.textContent = `⏱ ${remaining}s`;
      if (remaining <= 0) { clearInterval(messageTimers[messageId]?.interval); delete messageTimers[messageId]; return; }
      remaining--;
    }
    tick();
    const interval = setInterval(tick, 1000);
    messageTimers[messageId] = { interval };
  }

  // ── DESTROY ──
  function destroyMessage(messageId) {
    if (messageTimers[messageId]) { clearInterval(messageTimers[messageId].interval); delete messageTimers[messageId]; }
    const bubble = document.querySelector(`[data-id="${messageId}"]`);
    if (!bubble) return;
    bubble.classList.add('dying');
    setTimeout(() => { const w = bubble.parentElement; if (w) w.remove(); }, 700);
  }

  // ── SEND ──
  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !activePeer || !socket) return;
    if (text.length > 500) { alert('Message too long (max 500 chars)'); return; }

    const timerRaw = document.querySelector('input[name="timer"]:checked')?.value;
    const timerVal = (!timerRaw || timerRaw === 'none') ? null : Number(timerRaw);

    socket.emit('message:send', { sender: myUsername, receiver: activePeer, message: text, timer: timerVal });
    msgInput.value = '';
    if (!isMobile()) msgInput.focus();
  }

  // ── LOGOUT ──
  logoutBtn.addEventListener('click', () => { localStorage.removeItem('phantomUsername'); location.reload(); });

  // ── SCROLL ──
  function scrollBottom() {
    requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  // ── AUTO-REJOIN ──
  const saved = localStorage.getItem('phantomUsername');
  if (saved) { usernameInput.value = saved; doJoin(); }

  // ── PWA SERVICE WORKER ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
