const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');

function generateKey() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char hex key
}

// List all users (no secret keys)
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}, 'username online lastSeen')
      .sort({ online: -1, username: 1 });
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Join / authenticate
// Flow:
//   1. Username only (no secretKey)  → new user: 200 + isNew:true + secretKey
//                                    → existing user: 401 + exists:true  (ask for key)
//   2. Username + secretKey          → verify key → 200 + isNew:false
router.post('/join', async (req, res) => {
  try {
    const { username, secretKey } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }

    const clean = username.trim().replace(/[^a-zA-Z0-9_\-]/g, '');

    if (clean.length < 2) {
      return res.status(400).json({ error: 'Min 2 characters. Use letters, numbers, _ or -' });
    }
    if (clean.length > 30) {
      return res.status(400).json({ error: 'Max 30 characters' });
    }

    const existing = await User.findOne({ username: clean });

    if (!existing) {
      // ── NEW USER ──
      // If they somehow passed a key anyway (shouldn't happen from UI), ignore it.
      const newKey = generateKey();
      const user = new User({ username: clean, secretKey: newKey });
      await user.save();
      return res.json({ username: clean, secretKey: newKey, isNew: true });
    }

    // ── EXISTING USER ──
    if (!secretKey) {
      // Step 1 probe — no key supplied, tell client to ask for it
      return res.status(401).json({ error: 'Key required', exists: true });
    }

    if (existing.secretKey !== secretKey.trim().toUpperCase()) {
      return res.status(401).json({ error: 'Wrong secret key for this username' });
    }

    // Key correct — log them in
    res.json({ username: existing.username, secretKey: existing.secretKey, isNew: false });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Username taken, try another' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;