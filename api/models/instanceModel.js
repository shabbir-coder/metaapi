// models/instanceModel.js
const mongoose = require('mongoose');

const instanceSchema = new mongoose.Schema({
  instance_id:           String,
  number:                String,
  name:                  String,
  whatsappBusinessAccId: String,
  accessToken:           String,
  lastScannedAt:         Date,
  createdBy: { type: mongoose.Types.ObjectId },
  isActive: {
    type:    Boolean,
    default: false,
  },
  isVerified: {
    type:    Boolean,
    default: false,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ── CosmosDB: explicit indexes ──
instanceSchema.index({ instance_id: 1 });
instanceSchema.index({ createdBy:   1 });
instanceSchema.index({ number:      1 });
instanceSchema.index({ isActive:    1 });
instanceSchema.index({ createdAt:   1 });   // needed for any date-sorted queries
instanceSchema.index({ updatedAt:   1 });

const Instance = mongoose.model('instance', instanceSchema);

module.exports = Instance;