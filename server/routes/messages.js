const express = require('express');
const router  = express.Router();
const Message = require('../models/Message');
const User    = require('../models/User');

function adminCheck(req, res) {
  const key = req.query.adminKey || (req.body && req.body.adminKey);
  if (key !== process.env.ADMIN_KEY) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// Admin login
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME &&
      password === process.env.ADMIN_PASSWORD) {
    return res.json({ success: true, adminKey: process.env.ADMIN_KEY });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// Get conversation between two users
router.get('/conversation/:a/:b', async (req, res) => {
  try {
    const { a, b } = req.params;
    const msgs = await Message.find({
      $or: [
        { sender: a, receiver: b },
        { sender: b, receiver: a }
      ]
    }).sort({ createdAt: 1 });
    res.json(msgs);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: all messages
router.get('/admin/all', async (req, res) => {
  if (!adminCheck(req, res)) return;
  try {
    const msgs = await Message.find({}).sort({ createdAt: -1 }).limit(1000);
    res.json(msgs);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: all users
router.get('/admin/users', async (req, res) => {
  if (!adminCheck(req, res)) return;
  try {
    const users = await User.find({}, '-secretKey').sort({ online: -1, createdAt: -1 });
    res.json(users);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: conversations summary
router.get('/admin/conversations', async (req, res) => {
  if (!adminCheck(req, res)) return;
  try {
    const convos = await Message.aggregate([
      {
        $group: {
          _id: {
            $cond: [
              { $lt: ['$sender', '$receiver'] },
              { a: '$sender', b: '$receiver' },
              { a: '$receiver', b: '$sender' }
            ]
          },
          count:       { $sum: 1 },
          lastMessage: { $max: '$createdAt' }
        }
      },
      { $sort: { lastMessage: -1 } }
    ]);
    res.json(convos);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: edit message
router.put('/admin/:id', async (req, res) => {
  if (!adminCheck(req, res)) return;
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Empty message' });
    const updated = await Message.findByIdAndUpdate(
      req.params.id,
      { message: message.trim().slice(0, 500), edited: true },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: delete message
router.delete('/admin/msg/:id', async (req, res) => {
  if (!adminCheck(req, res)) return;
  try {
    await Message.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: delete conversation
router.delete('/admin/conversation/:a/:b', async (req, res) => {
  if (!adminCheck(req, res)) return;
  try {
    const { a, b } = req.params;
    await Message.deleteMany({
      $or: [{ sender: a, receiver: b }, { sender: b, receiver: a }]
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;