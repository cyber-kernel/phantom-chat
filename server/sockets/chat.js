const xss = require('xss');
const User = require('../models/User');
const Message = require('../models/Message');

const destroyTimers = new Map();

module.exports = (io) => {
  io.on('connection', async (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('user:join', async ({ username }) => {
      try {
        await User.findOneAndUpdate(
          { username },
          { online: true, socketId: socket.id, lastSeen: new Date() },
          { upsert: true, new: true }
        );
        socket.data.username = username;
        socket.join(`user:${username}`);

        const pendingDestroy = await Message.find({
          $or: [{ sender: username }, { receiver: username }],
          seen: true,
          deleteAt: { $ne: null }
        });
        for (const msg of pendingDestroy) {
          const timeLeft = new Date(msg.deleteAt).getTime() - Date.now();
          if (timeLeft <= 0) {
            await Message.findByIdAndDelete(msg._id);
            io.emit('message:destroyed', { messageId: msg._id.toString() });
          } else {
            scheduleDestroy(io, msg._id.toString(), timeLeft, msg.sender, msg.receiver);
          }
        }
        io.emit('user:online', { username, online: true });
        console.log('joined:', username);
      } catch (e) { console.error('Join error:', e); }
    });

    socket.on('message:send', async ({ sender, receiver, message, timer }) => {
      try {
        if (!sender || !receiver || !message) return;
        const clean = xss(message.trim()).substring(0, 500);
        if (!clean) return;
        const timerVal = (timer === null || timer === undefined || timer === 'null') ? null : Number(timer);
        if (timerVal !== null && ![15, 30, 45, 60].includes(timerVal)) return;

        const msg = new Message({ sender, receiver, message: clean, timer: timerVal, seen: false, edited: false });
        await msg.save();

        const payload = toPayload(msg);
        io.to(`user:${sender}`).emit('message:new', payload);
        io.to(`user:${receiver}`).emit('message:new', payload);
      } catch (e) { console.error('Send error:', e); }
    });

    socket.on('message:seen', async ({ messageId, viewer }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg || msg.seen) return;
        if (msg.receiver !== viewer) return;

        if (!msg.timer) {
          await Message.findByIdAndUpdate(messageId, { seen: true, seenAt: new Date() });
          io.to(`user:${msg.sender}`).emit('message:seenAck', { messageId });
          io.to(`user:${msg.receiver}`).emit('message:seenAck', { messageId });
          return;
        }

        const deleteAt = new Date(Date.now() + msg.timer * 1000);
        await Message.findByIdAndUpdate(messageId, { seen: true, seenAt: new Date(), deleteAt });
        const payload = { messageId, deleteAt: deleteAt.toISOString(), timer: msg.timer };
        io.to(`user:${msg.sender}`).emit('message:countdown', payload);
        io.to(`user:${msg.receiver}`).emit('message:countdown', payload);
        scheduleDestroy(io, messageId, msg.timer * 1000, msg.sender, msg.receiver);
      } catch (e) { console.error('Seen error:', e); }
    });

    socket.on('message:delete', async ({ messageId, requester }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (msg.sender !== requester) return;
        await Message.findByIdAndDelete(messageId);
        cancelTimer(messageId);
        io.to(`user:${msg.sender}`).emit('message:destroyed', { messageId });
        io.to(`user:${msg.receiver}`).emit('message:destroyed', { messageId });
      } catch (e) { console.error('User delete error:', e); }
    });

    socket.on('chat:clear', async ({ requester, peer }) => {
      try {
        const msgs = await Message.find({
          $or: [
            { sender: requester, receiver: peer },
            { sender: peer, receiver: requester }
          ]
        });
        for (const m of msgs) {
          cancelTimer(m._id.toString());
          io.to(`user:${requester}`).emit('message:destroyed', { messageId: m._id.toString() });
          io.to(`user:${peer}`).emit('message:destroyed', { messageId: m._id.toString() });
        }
        await Message.deleteMany({
          $or: [
            { sender: requester, receiver: peer },
            { sender: peer, receiver: requester }
          ]
        });
        io.to(`user:${requester}`).emit('chat:cleared', { peer });
        io.to(`user:${peer}`).emit('chat:cleared', { peer: requester });
      } catch (e) { console.error('Clear chat error:', e); }
    });

    socket.on('admin:edit', async ({ messageId, newMessage, adminKey }) => {
      try {
        if (adminKey !== process.env.ADMIN_KEY) return;
        const clean = xss(newMessage.trim()).substring(0, 500);
        if (!clean) return;
        const updated = await Message.findByIdAndUpdate(messageId, { message: clean, edited: true }, { new: true });
        if (!updated) return;
        io.emit('message:edited', { messageId, message: updated.message, edited: true });
      } catch (e) { console.error('Admin edit error:', e); }
    });

    socket.on('admin:delete', async ({ messageId, adminKey }) => {
      try {
        if (adminKey !== process.env.ADMIN_KEY) return;
        const msg = await Message.findByIdAndDelete(messageId);
        if (!msg) return;
        cancelTimer(messageId);
        io.to(`user:${msg.sender}`).emit('message:destroyed', { messageId });
        io.to(`user:${msg.receiver}`).emit('message:destroyed', { messageId });
        io.emit('message:destroyed', { messageId });
      } catch (e) { console.error('Admin delete error:', e); }
    });

    socket.on('admin:deleteConversation', async ({ user1, user2, adminKey }) => {
      try {
        if (adminKey !== process.env.ADMIN_KEY) return;
        const msgs = await Message.find({
          $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }]
        });
        for (const m of msgs) {
          cancelTimer(m._id.toString());
          io.emit('message:destroyed', { messageId: m._id.toString() });
        }
        await Message.deleteMany({
          $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }]
        });
        io.emit('conversation:deleted', { user1, user2 });
      } catch (e) { console.error('Admin delete convo error:', e); }
    });

    socket.on('disconnect', async () => {
      try {
        const username = socket.data.username;
        if (!username) return;
        await User.findOneAndUpdate({ username }, { online: false, lastSeen: new Date(), socketId: null });
        io.emit('user:online', { username, online: false });
        console.log('disconnected:', username);
      } catch (e) { console.error('Disconnect error:', e); }
    });
  });

  function scheduleDestroy(io, messageId, delayMs, sender, receiver) {
    if (destroyTimers.has(messageId)) return;
    const timerId = setTimeout(async () => {
      try {
        await Message.findByIdAndDelete(messageId);
        destroyTimers.delete(messageId);
        if (sender) io.to(`user:${sender}`).emit('message:destroyed', { messageId });
        if (receiver) io.to(`user:${receiver}`).emit('message:destroyed', { messageId });
        io.emit('message:destroyed', { messageId });
      } catch (e) { console.error('Destroy timer error:', e); }
    }, delayMs);
    destroyTimers.set(messageId, timerId);
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
