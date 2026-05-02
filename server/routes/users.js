const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}, 'username online lastSeen').sort({ online: -1, username: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if username exists
router.get('/check/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    res.json({ exists: !!user });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Register/login user
router.post('/join', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || username.trim().length < 2 || username.trim().length > 30) {
      return res.status(400).json({ error: 'Username must be 2-30 characters' });
    }

    const clean = username.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    if (clean.length < 2) return res.status(400).json({ error: 'Invalid username characters' });

    let user = await User.findOne({ username: clean });
    if (!user) {
      user = new User({ username: clean });
      await user.save();
    }

    res.json({ username: user.username });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
