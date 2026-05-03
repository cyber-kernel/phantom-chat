const xss = require('xss');
const User = require('../models/User');
const Message = require('../models/Message');

const destroyTimers = new Map(); // msgId -> timeoutId

module.exports = (io) => {

  io.on('connection', (socket) => {

    // ── JOIN ──
    socket.on('user:join', async ({ username, secretKey }) => {
      try {
        if (!username) return;

        if (username !== '__admin__') {
          const user = await User.findOne({ username });
          if (!user || user.secretKey !== secretKey) {
            socket.emit('auth:error', { error: 'Authentication failed' });
            return;
          }
        }

        await User.findOneAndUpdate(
          { username },
          { online: true, socketId: socket.id, lastSeen: new Date() },
          { new: true }
        );

        socket.data.username = username;
        socket.data.secretKey = secretKey;
        socket.join(`user:${username}`);

        // Resume any pending self-destruct timers
        if (username !== '__admin__') {
          const pending = await Message.find({
            $or: [{ sender: username }, { receiver: username }],
            seen: true,
            deleteAt: { $ne: null }
          });

          for (const msg of pending) {
            const left = new Date(msg.deleteAt).getTime() - Date.now();
            if (left <= 0) {
              await Message.findByIdAndDelete(msg._id);
              io.emit('message:destroyed', { messageId: msg._id.toString() });
            } else {
              scheduleDestroy(msg._id.toString(), left, msg.sender, msg.receiver);
            }
          }
        }

        io.emit('user:online', { username, online: true });

      } catch (e) { console.error('user:join:', e.message); }
    });

    // ── SEND MESSAGE ──
    socket.on('message:send', async ({ sender, receiver, message, timer }) => {
      try {
        if (!sender || !receiver || !message) return;
        if (socket.data.username !== sender) return;

        const clean = xss(String(message).trim()).slice(0, 500);
        if (!clean) return;

        const timerVal = (timer == null || timer === 'none' || timer === 'null' || timer === '')
          ? null : Number(timer);
        if (timerVal !== null && ![15, 30, 45, 60].includes(timerVal)) return;

        const msg = new Message({ sender, receiver, message: clean, timer: timerVal });
        await msg.save();

        const payload = toPayload(msg);
        io.to(`user:${sender}`).emit('message:new', payload);
        io.to(`user:${receiver}`).emit('message:new', payload);

      } catch (e) { console.error('message:send:', e.message); }
    });

    // ── MARK SEEN ──
    socket.on('message:seen', async ({ messageId, viewer }) => {
      try {
        if (socket.data.username !== viewer) return;
        const msg = await Message.findById(messageId);
        if (!msg || msg.seen || msg.receiver !== viewer) return;

        if (!msg.timer) {
          // ── Non-timed message: just mark seen, notify sender with ✓✓ ──
          await Message.findByIdAndUpdate(messageId, { seen: true, seenAt: new Date() });

          // Only sender needs seenAck (to show ✓✓ on their bubble)
          io.to(`user:${msg.sender}`).emit('message:seenAck', { messageId });
          return;
        }

        // ── Timed message: start countdown AND notify sender with ✓✓ ──
        const deleteAt = new Date(Date.now() + msg.timer * 1000);
        await Message.findByIdAndUpdate(messageId, {
          seen: true, seenAt: new Date(), deleteAt
        });

        // Tell sender their message was seen (✓✓)
        io.to(`user:${msg.sender}`).emit('message:seenAck', { messageId });

        // Tell both sides to start the countdown timer UI
        const countdownPayload = { messageId, deleteAt: deleteAt.toISOString(), timer: msg.timer };
        io.to(`user:${msg.sender}`).emit('message:countdown', countdownPayload);
        io.to(`user:${msg.receiver}`).emit('message:countdown', countdownPayload);

        scheduleDestroy(messageId, msg.timer * 1000, msg.sender, msg.receiver);

      } catch (e) { console.error('message:seen:', e.message); }
    });

    // ── DELETE OWN MESSAGE ──
    socket.on('message:delete', async ({ messageId, requester }) => {
      try {
        if (socket.data.username !== requester) return;
        const msg = await Message.findById(messageId);
        if (!msg || msg.sender !== requester) return;
        await Message.findByIdAndDelete(messageId);
        cancelTimer(messageId);
        io.to(`user:${msg.sender}`).emit('message:destroyed', { messageId });
        io.to(`user:${msg.receiver}`).emit('message:destroyed', { messageId });
      } catch (e) { console.error('message:delete:', e.message); }
    });

    // ── CLEAR CHAT ──
    socket.on('chat:clear', async ({ requester, peer }) => {
      try {
        if (socket.data.username !== requester) return;
        const msgs = await Message.find({
          $or: [
            { sender: requester, receiver: peer },
            { sender: peer, receiver: requester }
          ]
        });
        for (const m of msgs) cancelTimer(m._id.toString());
        await Message.deleteMany({
          $or: [
            { sender: requester, receiver: peer },
            { sender: peer, receiver: requester }
          ]
        });
        io.to(`user:${requester}`).emit('chat:cleared', { peer });
        io.to(`user:${peer}`).emit('chat:cleared', { peer: requester });
      } catch (e) { console.error('chat:clear:', e.message); }
    });

    // ── TYPING ──
    socket.on('user:typing', ({ sender, receiver, isTyping }) => {
      if (socket.data.username !== sender) return;
      io.to(`user:${receiver}`).emit('user:typing', { sender, isTyping });
    });

    // ── ADMIN: EDIT ──
    socket.on('admin:edit', async ({ messageId, newMessage, adminKey }) => {
      try {
        if (adminKey !== process.env.ADMIN_KEY) return;
        const clean = xss(String(newMessage || '').trim()).slice(0, 500);
        if (!clean) return;
        const updated = await Message.findByIdAndUpdate(
          messageId, { message: clean, edited: true }, { new: true }
        );
        if (!updated) return;
        io.emit('message:edited', { messageId, message: updated.message });
      } catch (e) { console.error('admin:edit:', e.message); }
    });

    // ── ADMIN: DELETE MESSAGE ──
    socket.on('admin:delete', async ({ messageId, adminKey }) => {
      try {
        if (adminKey !== process.env.ADMIN_KEY) return;
        const msg = await Message.findByIdAndDelete(messageId);
        if (!msg) return;
        cancelTimer(messageId);
        io.to(`user:${msg.sender}`).emit('message:destroyed', { messageId });
        io.to(`user:${msg.receiver}`).emit('message:destroyed', { messageId });
      } catch (e) { console.error('admin:delete:', e.message); }
    });

    // ── ADMIN: DELETE CONVERSATION ──
    socket.on('admin:deleteConversation', async ({ user1, user2, adminKey }) => {
      try {
        if (adminKey !== process.env.ADMIN_KEY) return;
        const msgs = await Message.find({
          $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }]
        });
        for (const m of msgs) {
          cancelTimer(m._id.toString());
          io.to(`user:${m.sender}`).emit('message:destroyed', { messageId: m._id.toString() });
          io.to(`user:${m.receiver}`).emit('message:destroyed', { messageId: m._id.toString() });
        }
        await Message.deleteMany({
          $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }]
        });
        io.emit('conversation:deleted', { user1, user2 });
      } catch (e) { console.error('admin:deleteConversation:', e.message); }
    });

    // ── DISCONNECT ──
    socket.on('disconnect', async () => {
      try {
        const { username } = socket.data;
        if (!username || username === '__admin__') return;
        await User.findOneAndUpdate(
          { username },
          { online: false, lastSeen: new Date(), socketId: null }
        );
        io.emit('user:online', { username, online: false });
      } catch (e) { console.error('disconnect:', e.message); }
    });

  }); // end io.on connection

  // ── HELPERS ──
  function scheduleDestroy(messageId, delayMs, sender, receiver) {
    if (destroyTimers.has(messageId)) return;
    const t = setTimeout(async () => {
      try {
        await Message.findByIdAndDelete(messageId);
        destroyTimers.delete(messageId);
        if (sender) io.to(`user:${sender}`).emit('message:destroyed', { messageId });
        if (receiver) io.to(`user:${receiver}`).emit('message:destroyed', { messageId });
      } catch (e) { console.error('scheduleDestroy:', e.message); }
    }, delayMs);
    destroyTimers.set(messageId, t);
  }

  function cancelTimer(messageId) {
    if (destroyTimers.has(messageId)) {
      clearTimeout(destroyTimers.get(messageId));
      destroyTimers.delete(messageId);
    }
  }

  function toPayload(msg) {
    return {
      _id: msg._id.toString(),
      sender: msg.sender,
      receiver: msg.receiver,
      message: msg.message,
      timer: msg.timer,
      seen: msg.seen,
      edited: msg.edited,
      deleteAt: msg.deleteAt ? msg.deleteAt.toISOString() : null,
      createdAt: msg.createdAt
    };
  }
};