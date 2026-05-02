/* ── Phantom Admin Panel ── */
(function () {
  'use strict';

  // Hardcoded admin credentials (frontend check + ADMIN_KEY for API)
  let ADMIN_KEY = null;

  let socket = null;
  let editingMessageId = null;
  let allMessages = []; // cache for filter

  // ── DOM ──
  const loginScreen = document.getElementById('admin-login');
  const panelScreen = document.getElementById('admin-panel');
  const adminUserEl = document.getElementById('admin-user');
  const adminPassEl = document.getElementById('admin-pass');
  const adminLoginBtn = document.getElementById('admin-login-btn');
  const adminError = document.getElementById('admin-error');
  const adminLogout = document.getElementById('admin-logout');
  const editModal = document.getElementById('edit-modal');
  const editTextarea = document.getElementById('edit-textarea');
  const editSave = document.getElementById('edit-save');
  const editCancel = document.getElementById('edit-cancel');
  const msgSearch = document.getElementById('msg-search');
  const convoViewer = document.getElementById('convo-viewer');
  const convoListWrap = document.getElementById('convo-list-wrap');
  const convoBackBtn = document.getElementById('convo-back-btn');
  const convoViewerTitle = document.getElementById('convo-viewer-title');
  const convoMsgsList = document.getElementById('convo-messages-list');

  // ── LOGIN ──
  adminLoginBtn.addEventListener('click', doLogin);
  adminPassEl.addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  adminUserEl.addEventListener('keydown', e => e.key === 'Enter' && adminPassEl.focus());

  async function doLogin() {
    const u = adminUserEl.value.trim();
    const p = adminPassEl.value;
    adminError.textContent = '';
    adminLoginBtn.disabled = true;
    adminLoginBtn.textContent = 'Checking...';
    try {
      const res = await fetch('/api/messages/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if (!res.ok) {
        adminError.textContent = data.error || 'Invalid credentials';
        adminPassEl.value = '';
        adminPassEl.focus();
        return;
      }
      ADMIN_KEY = data.adminKey;
      loginScreen.classList.remove('active');
      panelScreen.classList.add('active');
      initAdmin();
    } catch {
      adminError.textContent = 'Connection error. Try again.';
    } finally {
      adminLoginBtn.disabled = false;
      adminLoginBtn.textContent = 'Authenticate';
    }
  }

  adminLogout.addEventListener('click', () => location.reload());

  // ── TABS ──
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ── INIT ──
  function initAdmin() {
    socket = io();
    socket.emit('user:join', { username: '__admin__' });

    // Live real-time updates
    socket.on('message:edited', () => { loadMessages(); updateStats(); });
    socket.on('message:destroyed', () => { loadMessages(); updateStats(); });
    socket.on('conversation:deleted', () => { loadMessages(); loadConversations(); updateStats(); });
    socket.on('user:online', () => { loadUsers(); updateStats(); });

    loadUsers();
    loadMessages();
    loadConversations();
    updateStats();
  }

  // ── API HELPER ──
  async function apiFetch(url) {
    const res = await fetch(url);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'API error'); }
    return res.json();
  }

  // ── STATS ──
  async function updateStats() {
    try {
      const [users, messages, convos] = await Promise.all([
        apiFetch(`/api/messages/admin/users?adminKey=${ADMIN_KEY}`),
        apiFetch(`/api/messages/admin/all?adminKey=${ADMIN_KEY}`),
        apiFetch(`/api/messages/admin/conversations?adminKey=${ADMIN_KEY}`)
      ]);
      document.getElementById('stat-users').textContent = users.length;
      document.getElementById('stat-online').textContent = users.filter(u => u.online && u.username !== '__admin__').length;
      document.getElementById('stat-messages').textContent = messages.length;
      document.getElementById('stat-convos').textContent = convos.length;
    } catch (e) { console.error('Stats error', e); }
  }

  // ── USERS ──
  window.loadUsers = async function () {
    try {
      const users = await apiFetch(`/api/messages/admin/users?adminKey=${ADMIN_KEY}`);
      const realUsers = users.filter(u => u.username !== '__admin__');
      const tbody = document.getElementById('users-tbody');
      tbody.innerHTML = '';

      if (!realUsers.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No users yet</td></tr>';
        return;
      }
      realUsers.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${esc(u.username)}</strong></td>
          <td><span class="badge ${u.online ? 'online' : 'offline'}">${u.online ? '● ONLINE' : 'OFFLINE'}</span></td>
          <td class="mono">${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : '—'}</td>
          <td class="mono">${u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</td>
        `;
        tbody.appendChild(tr);
      });
      document.getElementById('stat-users').textContent = realUsers.length;
      document.getElementById('stat-online').textContent = realUsers.filter(u => u.online).length;
    } catch (e) { console.error('loadUsers error', e); }
  };

  // ── MESSAGES ──
  if (msgSearch) msgSearch.addEventListener('input', filterMessages);

  function filterMessages() {
    const q = (msgSearch?.value || '').toLowerCase();
    const filtered = q ? allMessages.filter(m =>
      m.sender.toLowerCase().includes(q) ||
      m.receiver.toLowerCase().includes(q) ||
      m.message.toLowerCase().includes(q)
    ) : allMessages;
    renderMessagesTable(filtered);
  }

  window.loadMessages = async function () {
    try {
      allMessages = await apiFetch(`/api/messages/admin/all?adminKey=${ADMIN_KEY}`);
      filterMessages();
      document.getElementById('stat-messages').textContent = allMessages.length;
    } catch (e) { console.error('loadMessages error', e); }
  };

  function renderMessagesTable(messages) {
    const tbody = document.getElementById('messages-tbody');
    tbody.innerHTML = '';
    if (!messages.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No messages found</td></tr>';
      return;
    }
    messages.forEach(m => {
      const tr = document.createElement('tr');
      const timerBadge = m.timer
        ? `<span class="badge timed">⏱ ${m.timer}s</span>`
        : `<span class="badge permanent">∞ Permanent</span>`;
      const statusBadge = m.seen
        ? `<span class="badge seen">SEEN</span>`
        : `<span class="badge unseen">UNSEEN</span>`;

      tr.innerHTML = `
        <td><strong>${esc(m.sender)}</strong></td>
        <td>${esc(m.receiver)}</td>
        <td class="msg-cell" title="${esc(m.message)}">${esc(m.message)}</td>
        <td>${timerBadge}</td>
        <td>${statusBadge} ${m.edited ? '<span class="badge edited">EDITED</span>' : ''}</td>
        <td class="mono">${new Date(m.createdAt).toLocaleString()}</td>
        <td>
          <div class="action-btns">
            <button class="btn-edit"   data-id="${m._id}" data-msg="${esc(m.message)}">Edit</button>
            <button class="btn-delete" data-id="${m._id}">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit').forEach(b =>
      b.addEventListener('click', () => openEditModal(b.dataset.id, b.dataset.msg)));
    tbody.querySelectorAll('.btn-delete').forEach(b =>
      b.addEventListener('click', () => deleteMessage(b.dataset.id)));
  }

  // ── CONVERSATIONS ──
  window.loadConversations = async function () {
    try {
      const convos = await apiFetch(`/api/messages/admin/conversations?adminKey=${ADMIN_KEY}`);
      const tbody = document.getElementById('convos-tbody');
      tbody.innerHTML = '';
      if (!convos.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No conversations yet</td></tr>';
        document.getElementById('stat-convos').textContent = 0;
        return;
      }
      convos.forEach(c => {
        const userA = c._id?.a || '?';
        const userB = c._id?.b || '?';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${esc(userA)}</strong> ↔ <strong>${esc(userB)}</strong></td>
          <td class="mono">${c.count} msg${c.count !== 1 ? 's' : ''}</td>
          <td class="mono">${c.lastMessage ? new Date(c.lastMessage).toLocaleString() : '—'}</td>
          <td>
            <div class="action-btns">
              <button class="btn-view-convo"   data-a="${esc(userA)}" data-b="${esc(userB)}">View</button>
              <button class="btn-delete-convo" data-a="${esc(userA)}" data-b="${esc(userB)}">Delete All</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
      document.getElementById('stat-convos').textContent = convos.length;

      tbody.querySelectorAll('.btn-view-convo').forEach(b =>
        b.addEventListener('click', () => viewConversation(b.dataset.a, b.dataset.b)));
      tbody.querySelectorAll('.btn-delete-convo').forEach(b =>
        b.addEventListener('click', () => deleteConversation(b.dataset.a, b.dataset.b)));
    } catch (e) { console.error('loadConversations error', e); }
  };

  // View a specific conversation inline
  async function viewConversation(userA, userB) {
    try {
      const msgs = await apiFetch(`/api/messages/conversation/${userA}/${userB}`);
      convoViewerTitle.textContent = `${userA} ↔ ${userB}`;
      convoMsgsList.innerHTML = '';

      if (!msgs.length) {
        convoMsgsList.innerHTML = '<div style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px;padding:16px;">No messages</div>';
      } else {
        msgs.forEach(m => {
          const div = document.createElement('div');
          div.className = 'convo-msg-item';
          const timerText = m.timer ? `⏱${m.timer}s` : '∞';
          div.innerHTML = `
            <span class="convo-msg-sender">${esc(m.sender)}</span>
            <span class="convo-msg-text">${esc(m.message)}${m.edited ? ' <span style="color:var(--accent);font-size:10px">[edited]</span>' : ''}</span>
            <div class="convo-msg-meta">
              <span class="badge ${m.timer ? 'timed' : 'permanent'}">${timerText}</span>
              <span class="badge ${m.seen ? 'seen' : 'unseen'}">${m.seen ? '✓' : '○'}</span>
            </div>
            <div class="convo-msg-actions">
              <button class="btn-edit" data-id="${m._id}" data-msg="${esc(m.message)}" style="padding:3px 7px;font-size:10px">Edit</button>
              <button class="btn-delete" data-id="${m._id}" style="padding:3px 7px;font-size:10px">✕</button>
            </div>
          `;
          div.querySelectorAll('.btn-edit').forEach(b =>
            b.addEventListener('click', () => openEditModal(b.dataset.id, b.dataset.msg)));
          div.querySelectorAll('.btn-delete').forEach(b =>
            b.addEventListener('click', () => { deleteMessage(b.dataset.id); div.remove(); }));
          convoMsgsList.appendChild(div);
        });
      }

      convoListWrap.classList.add('hidden');
      convoViewer.classList.remove('hidden');
    } catch (e) { console.error('viewConversation error', e); }
  }

  convoBackBtn.addEventListener('click', () => {
    convoViewer.classList.add('hidden');
    convoListWrap.classList.remove('hidden');
  });

  // ── EDIT MODAL ──
  function openEditModal(id, currentMsg) {
    editingMessageId = id;
    editTextarea.value = currentMsg;
    editModal.classList.remove('hidden');
    editTextarea.focus();
  }

  editCancel.addEventListener('click', () => { editModal.classList.add('hidden'); editingMessageId = null; });

  // Close modal on backdrop click
  editModal.addEventListener('click', (e) => { if (e.target === editModal) { editModal.classList.add('hidden'); editingMessageId = null; } });

  editSave.addEventListener('click', () => {
    if (!editingMessageId) return;
    const newMsg = editTextarea.value.trim();
    if (!newMsg) { alert('Message cannot be empty'); return; }

    socket.emit('admin:edit', { messageId: editingMessageId, newMessage: newMsg, adminKey: ADMIN_KEY });
    editModal.classList.add('hidden');
    editingMessageId = null;
    setTimeout(() => { loadMessages(); updateStats(); }, 400);
  });

  // ── DELETE MESSAGE ──
  async function deleteMessage(id) {
    if (!confirm('Permanently delete this message?\n\nThis will remove it from both users\' screens in real-time.')) return;
    socket.emit('admin:delete', { messageId: id, adminKey: ADMIN_KEY });
    setTimeout(() => { loadMessages(); updateStats(); }, 400);
  }

  // ── DELETE CONVERSATION ──
  async function deleteConversation(user1, user2) {
    if (!confirm(`Delete ALL messages between "${user1}" and "${user2}"?\n\nThis cannot be undone.`)) return;
    socket.emit('admin:deleteConversation', { user1, user2, adminKey: ADMIN_KEY });
    setTimeout(() => { loadMessages(); loadConversations(); updateStats(); }, 400);
  }

  // ── ESCAPE HTML ──
  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

})();
