const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, required: true },
  message: { type: String, required: true, maxlength: 500 },
  timer: {
    type: Number,
    default: null,
    validate: {
      validator: function (v) { return v === null || [15, 30, 45, 60].includes(v); },
      message: 'Timer must be 15, 30, 45, or 60'
    }
  },
  seen: { type: Boolean, default: false },
  edited: { type: Boolean, default: false },
  seenAt: { type: Date, default: null },
  deleteAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
