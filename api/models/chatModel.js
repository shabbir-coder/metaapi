const mongoose = require('mongoose');

// ─────────────────────────────────────────────
// Contact
// ─────────────────────────────────────────────
const contactSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  number:    { type: String, required: true },
  createdBy: { type: mongoose.Types.ObjectId },
}, { timestamps: true });

contactSchema.index({ number:    1 });
contactSchema.index({ createdBy: 1 });
contactSchema.index({ createdAt: 1 });

// ─────────────────────────────────────────────
// Participation
// ─────────────────────────────────────────────
const participationSchema = new mongoose.Schema({
  contactName:          { type: String, required: true },
  contactId:            { type: String },
  number:               { type: String },
  invites:              { type: String, required: true },
  male:                 { type: String },
  female:               { type: String },
  child:                { type: String },
  param1:               { type: String },
  param2:               { type: String },
  param3:               { type: String },
  isVerified:           { type: Boolean, default: false },
  lastResponse:         { type: String, default: '' },
  lastResponseUpdatedAt:{ type: Date },
  inviteStatus:         { type: String, default: '' },
  isAdmin:              { type: Boolean, default: false },
  createdBy:            { type: mongoose.Types.ObjectId },
  instanceId:           { type: String },
  eventId:              { type: String },
  attendeesCount:       { type: String, default: 0 },
  chatLogId:            { type: String },
  isNewMessages:        { type: Boolean, default: false },
  isChatsOpened:        { type: Boolean, default: false },
}, { timestamps: true });

participationSchema.index({ number:       1 });
participationSchema.index({ contactId:    1 });
participationSchema.index({ eventId:      1 });
participationSchema.index({ instanceId:   1 });
participationSchema.index({ createdBy:    1 });
participationSchema.index({ inviteStatus: 1 });
participationSchema.index({ isVerified:   1 });
participationSchema.index({ createdAt:    1 });
participationSchema.index({ updatedAt:    1 });
// Common compound queries
participationSchema.index({ eventId: 1, inviteStatus: 1 });
participationSchema.index({ eventId: 1, number:       1 });
participationSchema.index({ instanceId: 1, eventId:   1 });

// ─────────────────────────────────────────────
// ChatLogs
// ─────────────────────────────────────────────
const chatLogsSchema = new mongoose.Schema({
  senderNumber:  { type: String },
  isValid:       { type: Boolean, default: false },
  finalResponse: { type: String },
  inviteStatus:  { type: String, default: 'Pending' },
  instanceId:    { type: String },
  eventId:       { type: String },
  messageTrack:  { type: Number, default: null },
}, { timestamps: true });

chatLogsSchema.index({ senderNumber: 1 });
chatLogsSchema.index({ instanceId:   1 });
chatLogsSchema.index({ eventId:      1 });
chatLogsSchema.index({ inviteStatus: 1 });
chatLogsSchema.index({ createdAt:    1 });
chatLogsSchema.index({ instanceId: 1, eventId: 1 });

// ─────────────────────────────────────────────
// Message (chat)
// ─────────────────────────────────────────────
const chatSchema = new mongoose.Schema({
  number:           { type: String },
  fromMe:           { type: Boolean },
  instanceId:       { type: String },
  messageStatus: [{
    status: { type: String },
    time:   { type: Date },
  }],
  message:           { type: String },
  type:              { type: String },
  templateName:      { type: String },
  mediaUrl:          { type: String },
  mediaOriginalName: { type: String },
  jpegThumbnail:     { type: String },
  fileType:          { type: String },
  fileSize:          { type: String },
  fileLength:        { type: String },
  mimetype:          { type: String },
  fileId:            { type: mongoose.Schema.Types.ObjectId, ref: 'file' },
  messageId:         { type: String },
  timeStamp:         { type: String },
  sentBy:            { type: String },
  sendByName:        { type: String },
  sentById:          { type: mongoose.Schema.Types.ObjectId },
  eventId:           { type: String },
  reaction:          { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

chatSchema.index({ number:     1 });
chatSchema.index({ instanceId: 1 });
chatSchema.index({ eventId:    1 });
chatSchema.index({ messageId:  1 });
chatSchema.index({ fromMe:     1 });
chatSchema.index({ createdAt:  1 });
chatSchema.index({ timeStamp:  1 });
// Common compound queries
chatSchema.index({ instanceId: 1, number:  1 });
chatSchema.index({ instanceId: 1, eventId: 1 });
chatSchema.index({ eventId: 1, createdAt:  1 });

// ─────────────────────────────────────────────
// File (chat attachments)
// ─────────────────────────────────────────────
const fileSchema = new mongoose.Schema({
  url:               { type: String },
  mediaName:         { type: String },
  mimetype:          { type: String },
  filetype:          { type: String },
  caption:           { type: String },
  fileSha256:        { type: String },
  fileLength:        { type: String },
  height:            { type: String },
  width:             { type: String },
  mediaKey:          { type: String },
  fileEncSha256:     { type: String },
  path:              { type: String },
  mediaKeyTimestamp: { type: String },
  jpegThumbnail:     { type: String },
  seconds:           { type: String },
  contextInfo:       { type: mongoose.Schema.Types.Mixed },
  streamingSidecar:  { type: String },
  whatsappMediaId:   { type: String },
}, { timestamps: true });

fileSchema.index({ whatsappMediaId: 1 });
fileSchema.index({ createdAt:       1 });

// ─────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────
const Message      = mongoose.model('message',       chatSchema);
const File         = mongoose.model('file',          fileSchema);
const Participation= mongoose.model('participation', participationSchema);
const ChatLogs     = mongoose.model('chatLogs',      chatLogsSchema);
const Contact      = mongoose.model('contact',       contactSchema);

module.exports = { Contact, Message, ChatLogs, File, Participation };