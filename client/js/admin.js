/* ── Phantom Admin Panel ── */
(function () {
  'use strict';

  let ADMIN_KEY = null;
  let socket = null;
  let editingMessageId = null;
  let allMessages = [];

  /* ── DOM — IDs match admin.html exactly ── */
  const screenLogin = document.getElementById('screen-login');
  const screenPanel = document.getElementById('screen-panel');
  const inpUser = document.getElementById('inp-admin-user');
  const inpPass = document.getElementById('inp-admin-pass');
  const btnLogin = document.getElementById('btn-admin-login');
  const loginError = document.getElementById('login-error');
  const btnLogout = document.getElementById('btn-logout');
  const editModal = document.getElementById('edit-modal');
  const editTextarea = document.getElementById('edit-textarea');
  const editSave = document.getElementById('edit-save');
  const editCancel = document.getElementById('edit-cancel');
  const msgSearch = document.getElementById('msg-search');
  const convoViewer = document.getElementById('convo-viewer');
  const convoListWrap = document.getElementById('convo-list-wrap');
  const convoBackBtn = document.getElementById('convo-back-btn');
  const convoTitle = document.getElementById('convo-viewer-title');
  const convoMsgs = document.getElementById('convo-messages-list');

  /* ════════════════════════════════
     LOGIN
  ════════════════════════════════ */
  btnLogin.addEventListener('click', doLogin);
  inpPass.addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  inpUser.addEventListener('keydown', e => e.key === 'Enter' && inpPass.focus());

  async function doLogin() {
    const u = inpUser.value.trim();
    const p = inpPass.value;
    loginError.textContent = '';

    if (!u || !p) { loginError.textContent = 'Enter username and password'; return; }

    btnLogin.disabled = true;
    btnLogin.textContent = 'Checking…';

    try {
      const res = await fetch('/api/messages/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();

      if (!res.ok) {
        loginError.textContent = data.error || 'Invalid credentials';
        inpPass.value = '';
        inpPass.focus();
        return;
      }

      ADMIN_KEY = data.adminKey;
      screenLogin.classList.remove('active');
      screenPanel.classList.add('active');
      initAdmin();

    } catch (err) {
      loginError.textContent = 'Connection error — is the server running?';
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Authenticate';
    }
  }

  btnLogout.addEventListener('click', () => location.reload());

  /* ════════════════════════════════
     TABS
  ════════════════════════════════ */
  document.querySelectorAll('.a-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.a-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.a-tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });

  /* ════════════════════════════════
     INIT (after login)
  ════════════════════════════════ */
  function initAdmin() {
    socket = io();
    socket.emit('user:join', { username: '__admin__' });

    socket.on('message:edited', () => { loadMessages(); updateStats(); });
    socket.on('message:destroyed', () => { loadMessages(); updateStats(); });
    socket.on('conversation:deleted', () => { loadMessages(); loadConversations(); updateStats(); });
    socket.on('user:online', () => { loadUsers(); updateStats(); });

    loadUsers();
    loadMessages();
    loadConversations();
    updateStats();
  }

  /* ════════════════════════════════
     API HELPER
  ════════════════════════════════ */
  async function api(url) {
    const res = await fetch(url);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'API error'); }
    return res.json();
  }

  /* ════════════════════════════════
     STATS
  ════════════════════════════════ */
  async function updateStats() {
    try {
      const [users, messages, convos] = await Promise.all([
        api(`/api/messages/admin/users?adminKey=${ADMIN_KEY}`),
        api(`/api/messages/admin/all?adminKey=${ADMIN_KEY}`),
        api(`/api/messages/admin/conversations?adminKey=${ADMIN_KEY}`)
      ]);
      const realUsers = users.filter(u => u.username !== '__admin__');
      document.getElementById('stat-users').textContent = realUsers.length;
      document.getElementById('stat-online').textContent = realUsers.filter(u => u.online).length;
      document.getElementById('stat-messages').textContent = messages.length;
      document.getElementById('stat-convos').textContent = convos.length;
    } catch (e) { console.error('Stats:', e); }
  }

  /* ════════════════════════════════
     USERS
  ════════════════════════════════ */
  window.loadUsers = async function () {
    try {
      const users = await api(`/api/messages/admin/users?adminKey=${ADMIN_KEY}`);
      const realUsers = users.filter(u => u.username !== '__admin__');
      const tbody = document.getElementById('users-tbody');
      tbody.innerHTML = '';

      if (!realUsers.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="td-empty">No users yet</td></tr>';
        return;
      }

      realUsers.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${esc(u.username)}</strong></td>
          <td>
            <span class="bdg ${u.online ? 'bdg-on' : 'bdg-off'}">
              ${u.online ? '● ONLINE' : 'OFFLINE'}
            </span>
          </td>
          <td class="td-mono">${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : '—'}</td>
          <td class="td-mono">${u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</td>`;
        tbody.appendChild(tr);
      });

      document.getElementById('stat-users').textContent = realUsers.length;
      document.getElementById('stat-online').textContent = realUsers.filter(u => u.online).length;
    } catch (e) { console.error('loadUsers:', e); }
  };

  /* ════════════════════════════════
     MESSAGES
  ════════════════════════════════ */
  if (msgSearch) msgSearch.addEventListener('input', filterMessages);

  function filterMessages() {
    const q = (msgSearch?.value || '').toLowerCase();
    const filtered = q
      ? allMessages.filter(m =>
        m.sender.toLowerCase().includes(q) ||
        m.receiver.toLowerCase().includes(q) ||
        m.message.toLowerCase().includes(q))
      : allMessages;
    renderMessages(filtered);
  }

  window.loadMessages = async function () {
    try {
      allMessages = await api(`/api/messages/admin/all?adminKey=${ADMIN_KEY}`);
      filterMessages();
      document.getElementById('stat-messages').textContent = allMessages.length;
    } catch (e) { console.error('loadMessages:', e); }
  };

  function renderMessages(messages) {
    const tbody = document.getElementById('messages-tbody');
    tbody.innerHTML = '';

    if (!messages.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="td-empty">No messages found</td></tr>';
      return;
    }

    messages.forEach(m => {
      const tr = document.createElement('tr');
      const timerBadge = m.timer
        ? `<span class="bdg bdg-timed">⏱ ${m.timer}s</span>`
        : `<span class="bdg bdg-perm">∞ Perm</span>`;
      const statusBadge = m.seen
        ? `<span class="bdg bdg-seen">SEEN</span>`
        : `<span class="bdg bdg-unseen">UNSEEN</span>`;

      tr.innerHTML = `
        <td><strong>${esc(m.sender)}</strong></td>
        <td>${esc(m.receiver)}</td>
        <td class="td-trunc" title="${esc(m.message)}">${esc(m.message)}</td>
        <td>${timerBadge}</td>
        <td>${statusBadge}${m.edited ? ' <span class="bdg bdg-edit">EDITED</span>' : ''}</td>
        <td class="td-mono">${new Date(m.createdAt).toLocaleString()}</td>
        <td>
          <div class="act-btns">
            <button class="act-btn act-edit"  data-id="${m._id}" data-msg="${esc(m.message)}">Edit</button>
            <button class="act-btn act-del"   data-id="${m._id}">Delete</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.act-edit').forEach(b =>
      b.addEventListener('click', () => openEditModal(b.dataset.id, b.dataset.msg)));
    tbody.querySelectorAll('.act-del').forEach(b =>
      b.addEventListener('click', () => deleteMessage(b.dataset.id)));
  }

  /* ════════════════════════════════
     CONVERSATIONS
  ════════════════════════════════ */
  window.loadConversations = async function () {
    try {
      const convos = await api(`/api/messages/admin/conversations?adminKey=${ADMIN_KEY}`);
      const tbody = document.getElementById('convos-tbody');
      tbody.innerHTML = '';

      if (!convos.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="td-empty">No conversations yet</td></tr>';
        document.getElementById('stat-convos').textContent = 0;
        return;
      }

      convos.forEach(c => {
        const userA = c._id?.a || '?';
        const userB = c._id?.b || '?';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${esc(userA)}</strong> ↔ <strong>${esc(userB)}</strong></td>
          <td class="td-mono">${c.count} msg${c.count !== 1 ? 's' : ''}</td>
          <td class="td-mono">${c.lastMessage ? new Date(c.lastMessage).toLocaleString() : '—'}</td>
          <td>
            <div class="act-btns">
              <button class="act-btn act-view" data-a="${esc(userA)}" data-b="${esc(userB)}">View</button>
              <button class="act-btn act-del"  data-a="${esc(userA)}" data-b="${esc(userB)}">Delete All</button>
            </div>
          </td>`;
        tbody.appendChild(tr);
      });

      document.getElementById('stat-convos').textContent = convos.length;

      tbody.querySelectorAll('.act-view').forEach(b =>
        b.addEventListener('click', () => viewConvo(b.dataset.a, b.dataset.b)));
      tbody.querySelectorAll('.act-del').forEach(b =>
        b.addEventListener('click', () => deleteConvo(b.dataset.a, b.dataset.b)));
    } catch (e) { console.error('loadConversations:', e); }
  };

  async function viewConvo(a, b) {
    try {
      const msgs = await api(`/api/messages/conversation/${a}/${b}`);
      convoTitle.textContent = `${a} ↔ ${b}`;
      convoMsgs.innerHTML = '';

      if (!msgs.length) {
        convoMsgs.innerHTML = '<div class="td-empty">No messages</div>';
      } else {
        msgs.forEach(m => {
          const div = document.createElement('div');
          div.className = 'cv-msg';
          div.innerHTML = `
            <span class="cv-msg-sender">${esc(m.sender)}</span>
            <span class="cv-msg-text">${esc(m.message)}${m.edited ? ' <span style="color:var(--accent);font-size:10px">[edited]</span>' : ''}</span>
            <div class="cv-msg-meta">
              <span class="bdg ${m.timer ? 'bdg-timed' : 'bdg-perm'}">${m.timer ? `⏱${m.timer}s` : '∞'}</span>
              <span class="bdg ${m.seen ? 'bdg-seen' : 'bdg-unseen'}">${m.seen ? '✓' : '○'}</span>
            </div>
            <div class="cv-msg-acts">
              <button class="act-btn act-edit" data-id="${m._id}" data-msg="${esc(m.message)}" style="padding:3px 8px;font-size:10px">Edit</button>
              <button class="act-btn act-del"  data-id="${m._id}" style="padding:3px 8px;font-size:10px">✕</button>
            </div>`;

          div.querySelector('.act-edit').addEventListener('click', () =>
            openEditModal(m._id, m.message));
          div.querySelector('.act-del').addEventListener('click', () => {
            deleteMessage(m._id);
            div.remove();
          });
          convoMsgs.appendChild(div);
        });
      }

      convoListWrap.classList.add('hidden');
      convoViewer.classList.remove('hidden');
    } catch (e) { console.error('viewConvo:', e); }
  }

  convoBackBtn.addEventListener('click', () => {
    convoViewer.classList.add('hidden');
    convoListWrap.classList.remove('hidden');
  });

  /* ════════════════════════════════
     EDIT MODAL
  ════════════════════════════════ */
  function openEditModal(id, currentMsg) {
    editingMessageId = id;
    editTextarea.value = currentMsg;
    editModal.classList.remove('hidden');
    setTimeout(() => editTextarea.focus(), 50);
  }

  editCancel.addEventListener('click', closeEditModal);
  editModal.addEventListener('click', e => { if (e.target === editModal) closeEditModal(); });

  function closeEditModal() {
    editModal.classList.add('hidden');
    editingMessageId = null;
  }

  editSave.addEventListener('click', () => {
    if (!editingMessageId) return;
    const newMsg = editTextarea.value.trim();
    if (!newMsg) { alert('Message cannot be empty'); return; }
    socket.emit('admin:edit', { messageId: editingMessageId, newMessage: newMsg, adminKey: ADMIN_KEY });
    closeEditModal();
    setTimeout(() => { loadMessages(); updateStats(); }, 400);
  });

  /* ════════════════════════════════
     DELETE
  ════════════════════════════════ */
  function deleteMessage(id) {
    if (!confirm('Permanently delete this message?\nThis removes it from both users in real-time.')) return;
    socket.emit('admin:delete', { messageId: id, adminKey: ADMIN_KEY });
    setTimeout(() => { loadMessages(); updateStats(); }, 400);
  }

  function deleteConvo(a, b) {
    if (!confirm(`Delete ALL messages between "${a}" and "${b}"?\nThis cannot be undone.`)) return;
    socket.emit('admin:deleteConversation', { user1: a, user2: b, adminKey: ADMIN_KEY });
    setTimeout(() => { loadMessages(); loadConversations(); updateStats(); }, 400);
  }

  /* ════════════════════════════════
     ESCAPE HTML
  ════════════════════════════════ */
  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

})();