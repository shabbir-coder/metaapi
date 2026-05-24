const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  filename:    String,
  contentType: String,
  url:         String,
  status: {
    type:    String,
    enum:    ['active', 'pending', 'rejected', 'draft'],
    default: 'pending',
  },
  json:      [],
  isDeleted: {
    type:    Boolean,
    default: false,
  },
}, { timestamps: true });

// ── CosmosDB: explicit indexes ──
fileSchema.index({ status:    1 });
fileSchema.index({ isDeleted: 1 });
fileSchema.index({ createdAt: 1 });
fileSchema.index({ updatedAt: 1 });
// Common filter: active, non-deleted files sorted by date
fileSchema.index({ status: 1, isDeleted: 1 });

module.exports = mongoose.model('File', fileSchema);