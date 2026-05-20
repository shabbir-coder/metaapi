const mongoose = require('mongoose');


const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  number: { type: String, required: true },
  createdBy: {type: mongoose.Types.ObjectId},
},{timestamps: true});

const participationSchema = new mongoose.Schema({
  contactName: { type: String, required: true },
  contactId : {type: String},
  number: {type: String},
  invites: { type: String, required: true },
  male: { type: String, required: false },
  female: { type: String, required: false },
  child: { type: String, required: false },
  param1: { type: String, required: false },
  param2: { type: String, required: false },
  param3: { type: String, required: false },
  isVerified : {type: Boolean, default: false},
  lastResponse: {type: String, default:''},
  lastResponseUpdatedAt: {type: Date},
  inviteStatus: {type: String, default:''},
  isAdmin: {type: Boolean, default: false},
  createdBy: {type: mongoose.Types.ObjectId},
  instanceId: {type: String},
  eventId: {type: String},
  attendeesCount: {type: String, default:0},  
  chatLogId: {type: String},
  isNewMessages : {type: Boolean , default: false},
  isChatsOpened : {type: Boolean , default: false}
},{timestamps: true});

const chatLogs = new mongoose.Schema({
  senderNumber: { type: String },
  isValid: {type: Boolean, default: false},
  finalResponse: {type: String},
  inviteStatus: {type: String, default: 'Pending'},
  instanceId: {type: String},
  eventId: {type: String},
  messageTrack: {type: Number , default: null},
}, { timestamps: true }
);

const chatSchema = new mongoose.Schema({
  number: { type: String },
  fromMe: {type: Boolean},
  instanceId: {type: String},
  messageStatus: [{
    status: {type: String},
    time: {type: Date}
  }],  
  message: { type: String},
  type: {type: String},
  templateName: { type: String},
  mediaUrl: {type: String},
  mediaOriginalName: {type: String},
  jpegThumbnail: {type: String},
  fileType: { type: String},
  fileSize: {type: String},
  fileLength: {type: String},
  mimetype: {type: String},
  fileId: {type: mongoose.Schema.Types.ObjectId, ref: 'file' },
  messageId: {type: String},
  timeStamp: {type: String},
  sentBy: {type: String},
  sendByName: {type: String},
  sentById: {type: mongoose.Schema.Types.ObjectId},
  eventId: {type: String},
  reaction: {type: mongoose.Schema.Types.Mixed}
}, { timestamps: true }
);

  const fileSchema = new mongoose.Schema({
    url: {type: String},
    mediaName: {type: String},
    mimetype: {type: String},
    filetype: {type: String},
    caption : {type: String},
    fileSha256: {type: String},
    fileLength: {type: String},
    height: {type: String},
    width: {type: String},
    mediaKey: {type: String},
    fileEncSha256: {type: String},
    path: {type: String},
    mediaKeyTimestamp: {type: String},
    jpegThumbnail: {type: String},
    seconds: {type: String},
    contextInfo: { type: mongoose.Schema.Types.Mixed }, 
    streamingSidecar: { type: String},
    whatsappMediaId: { type: String, index: true}
  },{timestamps: true})

const Message = mongoose.model('message', chatSchema);
const File = mongoose.model('file', fileSchema)
const Participation = mongoose.model('participation', participationSchema);
const ChatLogs = mongoose.model('chatLogs', chatLogs);
const Contact = mongoose.model('contact', contactSchema);

module.exports = { Contact, Message, ChatLogs, File, Participation };
