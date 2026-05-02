const express = require('express');
const router = express.Router();
const Message = require('../models/Message');


// Get conversation between two users
router.get('/conversation/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all messages
router.get('/admin/all', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    const messages = await Message.find({}).sort({ createdAt: -1 }).limit(500);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all conversations summary
router.get('/admin/conversations', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
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
          count: { $sum: 1 },
          lastMessage: { $max: '$createdAt' }
        }
      },
      { $sort: { lastMessage: -1 } }
    ]);
    res.json(convos);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete message
router.delete('/admin/:id', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    await Message.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete conversation
router.delete('/admin/conversation/:user1/:user2', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    const { user1, user2 } = req.params;
    await Message.deleteMany({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Edit message
router.put('/admin/:id', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    const { message } = req.body;
    if (!message || message.trim().length === 0) return res.status(400).json({ error: 'Empty message' });
    const updated = await Message.findByIdAndUpdate(
      req.params.id,
      { message: message.trim().substring(0, 500), edited: true },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all users
router.get('/admin/users', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    const User = require('../models/User');
    const users = await User.find({}).sort({ online: -1, createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin login verification
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    res.json({ success: true, adminKey: process.env.ADMIN_KEY });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

module.exports = router;
