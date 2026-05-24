const mongoose = require('mongoose');

const sequenceSchema = new mongoose.Schema({
  sequence:       { type: Number, required: true },
  messageText:    { type: String, required: true },
  type:           { type: String, required: true, enum: ['simple', 'options'] },
  options:        { type: String },
  saveInReport:   { type: Boolean, default: false },
  reportVariable: { type: String },
});

const campaignSchema = new mongoose.Schema({
  campaignName:             { type: String, required: true },
  campaignUID:              { type: String },
  startDate:                { type: Date, required: true },
  endDate:                  { type: Date, required: true },
  startHour:                { type: String, required: true },
  startMinute:              { type: String, required: true },
  endHour:                  { type: String, required: true },
  endMinute:                { type: String, required: true },
  startingKeyword:          { type: String, required: true },
  verifyNumberFirst:        { type: Boolean, default: false },
  numberVerificationPasses: { type: String, default: '' },
  numberVerificationFails:  { type: String, default: '' },
  verifyUserCode:           { type: Boolean, default: false },
  codeType:                 { type: String, enum: ['Alphabets', 'Alphanumerical', 'Numbers'] },
  codeLength:               { type: Number },
  codeVerificationFails:    { type: String, default: '' },
  sequences:                [sequenceSchema],
  createdBy:                { type: mongoose.Types.ObjectId },
  entryRewriteKeyword:      { type: String },
  entryReportKeyword:       { type: String },
  entryStatsKeyword:        { type: String },
  createdAt:                { type: Date, default: Date.now },
  updatedAt:                { type: Date, default: Date.now },
});

// ── CosmosDB: explicit indexes ──
campaignSchema.index({ campaignUID:      1 });
campaignSchema.index({ createdBy:        1 });
campaignSchema.index({ startDate:        1 });
campaignSchema.index({ endDate:          1 });
campaignSchema.index({ startingKeyword:  1 });
campaignSchema.index({ createdAt:        1 });
campaignSchema.index({ updatedAt:        1 });
// Compound index for common date-range queries
campaignSchema.index({ createdBy: 1, startDate: 1 });

const Campaign = mongoose.model('Campaign', campaignSchema);

module.exports = Campaign;