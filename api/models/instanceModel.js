// models/user.js
const mongoose = require('mongoose');

const instanceSchema = new mongoose.Schema({
  instance_id: String,
  number: String,
  name: String,
  whatsappBusinessAccId: String,
  accessToken: String,
  lastScannedAt: Date,
  createdBy: { type: mongoose.Types.ObjectId },
  isActive: {
    type: Boolean,
    default: false,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Instance = mongoose.model('instance', instanceSchema);

module.exports = Instance;
