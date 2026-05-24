const mongoose = require('mongoose');

const ParameterSchema = new mongoose.Schema({
  key:       { type: String },
  bindValue: { type: String },
}, { _id: false });

const TemplateSchema = new mongoose.Schema({
  templateName:  { type: String },
  languageCode:  { type: String, default: 'en' },
  templateText:  { type: String },
  parameters:    [ParameterSchema],
});

const TemplateMastersSchema = new mongoose.Schema({
  templateName:      { type: String },
  languageCode:      { type: String, default: 'en' },
  templateText:      { type: String },
  parameters:        [ParameterSchema],
  isMediaRequired:   { type: Boolean },
  templateMediaMime: { type: String },
  category: {
    type: String,
    enum: ['rsvp', 'invitation', 'reminder', 'rsvp_reminder', 'thank_you', 'rejection', 'custom'],
    default: 'custom',
  },
  currentEventId: { type: String },
  instanceId:     { type: String },
  description:    { type: String },
}, { timestamps: true });

// ── CosmosDB indexes for TemplateMasters ──
// `timestamps:true` adds createdAt/updatedAt — both need indexes for sorting
TemplateMastersSchema.index({ currentEventId: 1 });
TemplateMastersSchema.index({ instanceId:     1 });
TemplateMastersSchema.index({ category:       1 });
TemplateMastersSchema.index({ templateName:   1 });
TemplateMastersSchema.index({ createdAt:      1 });   // ← fixes your "order-by" error
TemplateMastersSchema.index({ updatedAt:      1 });
TemplateMastersSchema.index({ instanceId: 1, category: 1 });

const EventSchema = new mongoose.Schema({
  eventName:  { type: String, required: true },
  hostName:   { type: String, required: true },

  startDate:   { type: Date, required: true },
  startHour:   { type: Number, required: true },
  startMinute: { type: Number, required: true },

  endDate:   { type: Date, required: true },
  endHour:   { type: Number, required: true },
  endMinute: { type: Number, required: true },

  englishDateText: { type: String, required: true },
  dayTimeText:     { type: String, required: true },
  hijriDateText:   { type: String, required: true },

  venueLine1:      { type: String },
  additionalText1: { type: String },
  additionalText2: { type: String },
  additionalText3: { type: String },

  startingKeyword:        { type: String, required: true },
  verifyNumberFirst:      { type: Boolean, default: false },
  numberVerificationFails:{ type: String },

  rsvpTemplate:    { type: TemplateSchema },
  rsvpMedia:       { type: String },
  rsvpMediaMime:   { type: String },

  invitationTemplate: { type: TemplateSchema },
  invitationMedia:    { type: String },
  invitationMediaMime:{ type: String },

  acceptanceKeyword:  { type: String },
  thankyouTemplate:   { type: TemplateSchema },
  thankYouMedia:      { type: String },
  thankYouMediaMime:  { type: String },

  reminderTemplate: { type: TemplateSchema },
  reminderMedia:    { type: String },
  reminderMediaMime:{ type: String },

  eventDetails:    { type: String },

  RejectionKeyword:   { type: String },
  messageForRejection:{ type: String },

  messageForMoreThanOneInvites:  { type: String, required: true },
  messageForClosedInvitations:   { type: String },

  RewriteKeyword: { type: String, required: true },
  ReportKeyword:  { type: String, required: true },
  StatsKeyword:   { type: String, required: true },

  eventUID:  { type: String },
  createdBy: { type: mongoose.Types.ObjectId },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  initialCode:    { type: String },
  inviteCode:     { type: String },
  acceptCode:     { type: String },
  rejectCode:     { type: String },
  newContactCode: { type: String },

  instanceId:  { type: String },
  eventStatus: { type: String },
});

// ── CosmosDB indexes for Event ──
EventSchema.index({ eventUID:   1 });
EventSchema.index({ createdBy:  1 });
EventSchema.index({ instanceId: 1 });
EventSchema.index({ eventStatus:1 });
EventSchema.index({ startDate:  1 });
EventSchema.index({ endDate:    1 });
EventSchema.index({ createdAt:  1 });
EventSchema.index({ updatedAt:  1 });
// Compound indexes for common query patterns
EventSchema.index({ createdBy: 1, startDate: 1 });
EventSchema.index({ instanceId: 1, eventStatus: 1 });

const TemplateMasters = mongoose.model('templateMasters', TemplateMastersSchema);
const Event           = mongoose.model('event', EventSchema);

module.exports = { Event, TemplateMasters };