const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 30
  },
  secretKey: {
    type: String,
    required: true
  },
  online: {
    type: Boolean,
    default: false
  },
  socketId: {
    type: String,
    default: null
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);