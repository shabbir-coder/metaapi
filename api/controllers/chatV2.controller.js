
const axios = require('axios');
const FormData = require("form-data");
const Instance = require('../models/instanceModel')
const {Message, Contact, ChatLogs, Participation, File} = require('../models/chatModel');
const {Event} = require('../models/event.Model');
const User = require('../models/user');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs')
const { getCachedData } = require('../middlewares/cache');
const moment = require('moment-timezone');
const handlebars = require('handlebars');
const csv = require('csvtojson');
const dataKey = 'activeSet';
const xlsx = require('xlsx');
const pdf = require('html-pdf');
const path = require('path');
const { emitToInstance } = require('../middlewares/socket');


// ==================== UTILITIES ====================

const reformText = (message, data = {}) => {
  const { bindValue = {}, contact = {}, chatLog = {} } = data;

  let mergedContact = {};

  if (contact) {
    mergedContact = { ...contact?.toObject?.() };
  }
  if (bindValue){
    mergedContact = { ...mergedContact, ...bindValue };
  }

    
  if (chatLog.otherMessages) {
    Object.entries(chatLog.otherMessages).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        if (value.name !== undefined) {
          mergedContact[key] = value.name;
        } else if (value.value !== undefined) {
          mergedContact[key] = value.value;
        }
      }
    });
  }
  

  function replacePlaceholders(message, data) {
    return message.replace(/{(\w+)}/g, (_, key) => data[key] ?? `{${key}}`);
  }

  return replacePlaceholders(message, mergedContact);
};

const detectMediaType = (url) => {
  const ext = url.split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "avi"].includes(ext)) return "video";
  if (["pdf", "doc", "docx", "xls", "xlsx"].includes(ext)) return "document";
  return "image";
};

const saveFileData = async (message, numberId) => {
  try {
    const type = message.type;
    const media = message[type];
    if (!media?.id) {
      console.warn("⚠️ No media ID found in message");
      return null;
    }
    
    const instance = await Instance.findOne({instance_id: numberId})

    const mediaId = media.id;
    const accessToken = instance.accessToken;

    // Fetch media metadata
    const metaRes = await axios.get(
      `${process.env.FB_API}/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const meta = metaRes.data;

    // Download media
    const fileRes = await axios.get(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(fileRes.data, "binary");

    // Save locally
    const uploadsDir = path.join(__dirname, "../../uploads/downloads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const extension = meta.mime_type.split("/")[1] || "bin";
    const fileName = `${mediaId}.${extension}`;
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, buffer);

    const fileUrl = `${process.env.IMAGE_URL}uploads/downloads/${fileName}`;

    // Save to database
    const fileData = {
      url: fileUrl,
      mediaName: message?.document?.filename || 'file-' + fileName,
      mimetype: meta.mime_type,
      filetype: type,
      caption: media.caption || null,
      fileSha256: meta.sha256,
      fileLength: meta.file_size || buffer.length,
      path: filePath,
      jpegThumbnail: media?.jpeg_thumbnail || null,
      mediaKey: media?.media_key || null,
      fileEncSha256: media?.file_enc_sha256 || null,
      mediaKeyTimestamp: media?.media_key_timestamp || null,
      height: media?.height || null,
      width: media?.width || null,
      seconds: media?.seconds || null,
      streamingSidecar: media?.streaming_sidecar || null,
      contextInfo: media?.context_info || null,
    };

    const savedFile = await File.create(fileData);
    console.log("✅ File saved:", savedFile._id);

    return savedFile;
  } catch (error) {
    console.error("❌ Error saving file data:", error?.response?.data || error);
    return null;
  }
};

async function getOrUploadMedia(mediaUrl, phoneNumberId, token) {
  try {
    // check DB cache first
    let fileDoc = await File.findOne({ url: mediaUrl });

    if (fileDoc?.whatsappMediaId) {
      console.log("⚡ Using cached mediaId");
      return fileDoc.whatsappMediaId;
    }

    // convert URL → local path
    const relativePath = mediaUrl.replace(process.env.IMAGE_URL, "");
    const filePath = path.join(process.cwd(), relativePath);

    if (!fs.existsSync(filePath)) {
      console.log("⚠ File missing locally → fallback URL send");
      return null;
    }

    // upload to WhatsApp
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("messaging_product", "whatsapp");

    const res = await axios.post(
      `${process.env.FB_API}/${phoneNumberId}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...form.getHeaders()
        }
      }
    );

    const mediaId = res.data.id;

    console.log("📤 Uploaded to WhatsApp:", mediaId);

    // save or update cache
    if (fileDoc) {
      fileDoc.whatsappMediaId = mediaId;
      await fileDoc.save();
    } else {
      await File.create({
        url: mediaUrl,
        mediaName: mediaUrl.split("/").pop(),
        mimetype: detectMediaType(mediaUrl),
        filetype: detectMediaType(mediaUrl),
        whatsappMediaId: mediaId
      });
    }

    return mediaId;

  } catch (err) {
    console.error("Media upload failed:", err.response?.data || err.message);
    return null;
  }
}

const saveMessage = async ({ message, text, media_url, messageId, instance, fileId, templateName }) => {
  try {
      const newMessage = new Message({
      number: message.number,
      instanceId: message.instance_id,
      fromMe: true,
      message: text,
      mediaUrl: media_url,
      templateName: templateName || null,
      messageId,
      fileId: fileId || null,
      type: media_url ? "media" : (templateName ? "template" : "text"),
      timeStamp: new Date(),
      messageStatus: [{ status: "0", time: new Date() }],
      sentBy: "admin",
      sendByName: "System",
      eventId: message.eventId
    });
    
    await newMessage.save();
    console.log("✅ Message saved to DB:", messageId);
    return newMessage;
  } catch (error) {
    console.error("❌ Error saving message:", error);
    return null;
  }
};

const sendMessageFunc = async (message, data = {}) => {
  try {
    const instance = await Instance.findOne({ instance_id: message.instance_id }).sort({ updatedAt: -1 });
    const contact = await Participation.findOne({ number: message.number, eventId: message.eventId  });

    // Reform text with contact data
    if (message.message) {
      message.message = reformText(message.message, { contact });
    }

    const phoneNumberId = instance.instance_id;
    const token = instance.accessToken;
    const graphURL = `${process.env.FB_API}/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };

    const results = [];
    let fileId = null;

    // Send media if exists
    if (message.media_url) {
     const mediaType = detectMediaType(message.media_url);

    const mediaId = await getOrUploadMedia(
      message.media_url,
      phoneNumberId,
      token
    );
    
    const mediaPayload = {
      messaging_product: "whatsapp",
      to: message.number,
      type: mediaType,
      [mediaType]: mediaId
        ? { id: mediaId }
        : { link: message.media_url }
    };

      console.log("📤 Sending media:", mediaPayload);
      const mediaRes = await axios.post(graphURL, mediaPayload, { headers });
      const mediaMessageId = mediaRes?.data?.messages?.[0]?.id;
        
      // Save file reference
      const savedFile = await File.create({
        url: message.media_url,
        mediaName: message.filename || message.media_url.split('/').pop(),
        mimetype: message.mime || detectMediaType(message.media_url),
        filetype: mediaType
      });
      fileId = savedFile._id;

      await saveMessage({
        message,
        text: message.message || '',
        media_url: message.media_url,
        messageId: mediaMessageId,
        instance,
        fileId
      });

      results.push(mediaRes.data);
    }

    // Send text message
    if (message.message) {
      const textPayload = {
        messaging_product: "whatsapp",
        to: message.number,
        type: "text",
        text: { body: message.message }
      };

      console.log("📤 Sending text:", textPayload);
      const textRes = await axios.post(graphURL, textPayload, { headers });
      const textMessageId = textRes?.data?.messages?.[0]?.id;

      await saveMessage({
        message,
        text: message.message,
        media_url: message?.media_url || null,
        messageId: textMessageId,
        instance,
        fileId
      });

      results.push(textRes.data);
    }
    
    await addMessageToAiSystem({
            phone_number: message.number,
            instance_id: phoneNumberId,
            message: message.message
        })
    
    await Participation.updateMany({ number: message.number , instanceId : phoneNumberId},
        [
          {
            $set: {
              lastResponse: message.message,
              lastResponseUpdatedAt: new Date(),
              updatedAt: new Date(),
            }
          }
        ]
      );

    console.log("✅ Message(s) sent to:", message.number);
    return results;
  } catch (error) {
    console.error("❌ Meta API send failed:", error.response?.data || error.message);
    
    // Update participation status to Failed
    const participation = await Participation.findOne({ 
      number: message.number
    });
    if (participation) {
        participation.inviteStatus = "Failed";
      await participation.save();
    }
    
    return null;
  }
};

const sendTemplateFunc = async (message) => {
  try {
    const instance = await Instance.findOne({ instance_id: message.instance_id }).sort({ updatedAt: -1 });
    const contact = await Participation.findOne({ number: message.number, eventId: message.eventId });
    
    const phoneNumberId = instance.instance_id;
    const token = instance.accessToken;
    const graphURL = `${process.env.FB_API}/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };

    // Build template components
    const components = [];
    
    console.log('message', message);
    
    // 🔴 HANDLE HEADER COMPONENT (Media)
    if (message.media_url || message.headerMedia) {
      const mediaUrl = message.media_url || message.headerMedia;
      const mediaType = message.mediaType || detectMediaType(mediaUrl);
      
      // Map media type to WhatsApp format
      let whatsappMediaType = mediaType;
      if (mediaType === 'media') {
        whatsappMediaType = detectMediaType(mediaUrl);
      }
      
      const headerParameter = {
          type: whatsappMediaType,
          [whatsappMediaType]: message.mediaId
            ? { id: message.mediaId }
            : { link: mediaUrl }
        };
      
      components.push({
        type: "header",
        parameters: [headerParameter]
      });
      
      console.log("📸 Adding header media:", whatsappMediaType, mediaUrl);
    }

    // 🟢 HANDLE BODY COMPONENT (Text Parameters)
    
    if (message.bindValues && Object.keys(message.bindValues).length > 0) {
      const parameters = Object.entries(message.bindValues).map(([key, value]) => ({
        type: "text",
        parameter_name: key,
        text: value
      }));

      components.push({ type: "body", parameters });
    }

    // Construct payload
    const payload = {
      messaging_product: "whatsapp",
      to: message.number,
      type: "template",
      template: {
        name: message.template_name,
        language: { code: message.language_code || "en_US" },
        components
      }
    };
    
    console.log('header', JSON.stringify(headers));
    console.log('payload', JSON.stringify(payload));
    console.log('graphURL', graphURL)

    const res = await axios.post(graphURL, payload, { headers });
    const messageId = res?.data?.messages?.[0]?.id;
    let renderedText = reformText(message.template?.templateText, { bindValue: message.bindValues });
    // Save file reference if media was sent
    let fileId = null;
    if (message.media_url || message.headerMedia) {
      const mediaUrl = message.media_url || message.headerMedia;
      const savedFile = await File.create({
        url: mediaUrl,
        mediaName: mediaUrl.split('/').pop(),
        mimetype: message.mime || message.mediaMime || detectMediaType(mediaUrl),
        filetype: message.mediaType || detectMediaType(mediaUrl)
      });
      fileId = savedFile._id;
    }


    await saveMessage({
      message,
      text: renderedText,
      media_url: message.media_url || message.headerMedia || null,
      messageId,
      instance,
      templateName: message.template_name,
      fileId
    });
       

    await addMessageToAiSystem({
        phone_number: message.number,
        instance_id: phoneNumberId,
        message: renderedText
    })
    
    await Participation.updateMany({ number: message.number , instanceId : phoneNumberId},
        [
          {
            $set: {
              lastResponse: renderedText,
              lastResponseUpdatedAt: new Date(),
            }
          }
        ]
      );
    console.log("✅ Template sent successfully to:", message.number);
    
    return res.data;
  } catch (error) {
    console.error("❌ Template send failed:", error.response?.data || error.message);
    
    const participation = await Participation.findOne({ 
      number: message.number
    });
    if (participation && !['Accepted', 'Rejected'].includes(participation.inviteStatus)) {
      participation.inviteStatus = "Failed";
      await participation.save();
    }
  // Extract readable WhatsApp error message
  let errorMsg = "Template sending failed";

  if (error.response?.data?.error?.message) {
    errorMsg = error.response.data.error.message;
  } 
  else if (error.response?.data) {
    errorMsg = JSON.stringify(error.response.data);
  }
  else if (error.message) {
    errorMsg = error.message;
  }

  // Throw clear error for sendBulkMessage to catch
    throw new Error(errorMsg);
  }
};



// ==================== CONTACT MANAGEMENT ====================

const saveContact = async (req, res) => {
  try {
    const { contactName, invites, number, instanceId, eventId, host, param1, param2, param3 , male, female, child} = req.body;

    // Find or create contact
    let contact = await Contact.findOne({ number });
    if (!contact) {
      contact = await Contact.create({
        name: contactName,
        number,
        createdBy: req.user?.userId
      });
    }

    // Check for existing participation
    const existingParticipation = await Participation.findOne({
      contactId: contact._id,
      eventId
    });

    if (existingParticipation) {
      return res.status(400).json({ 
        error: 'Participation already exists for this contact in this event.' 
      });
    }

    // Find instance
    let instance = null;
    if (instanceId) {
      instance = await Instance.findOne({ instance_id: instanceId });
    }

    // Create participation
    const participation = await Participation.create({
      contactId: contact._id.toString(),
      contactName: contactName,
      number,
      invites,
      male, 
      female, 
      child,
      param1,
      param2,
      param3,
      eventId,
      createdBy: req.user?.userId,
      inviteStatus: 'Pending',
      instanceId: instance?.instance_id,
    });

    return res.status(201).json({
      message: 'Contact and participation saved successfully',
      contact,
      participation
    });
  } catch (error) {
    console.error('Error saving contact:', error);
    return res.status(500).json({ error: 'An error occurred while saving contact' });
  }
};

const saveContactsInBulk = async (req, res) => {
  try {
    const filePath = req.file.path;
    const { eventId } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required.' });
    }

    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    const event = await Event.findOne({ _id: eventId });

    const headers = sheet[0];
    const rows = sheet.slice(1);

    let contactsCreated = 0;
    let participationsCreated = 0;

    for (const row of rows) {
      let rowData = {};
      headers.forEach((header, index) => {
        rowData[header] = row[index];
      });

      const number = rowData.number ? String(rowData.number).trim() : null;
      const name = rowData.name || 'Unnamed';
      
      if (!number) continue;

      // Find or create contact
      let contact = await Contact.findOne({ number });
      if (!contact) {
        contact = await Contact.create({
          name,
          number,
          createdBy: req.user?.userId
        });
        contactsCreated++;
      }

      // Skip if participation exists
      const existingParticipation = await Participation.findOne({
        contactId: contact._id.toString(),
        eventId
      });
      if (existingParticipation) continue;

      // Create participation
      await Participation.create({
        contactId: contact._id.toString(),
        contactName: rowData.name,
        number,
        invites: rowData.invites || '',

        male: rowData.male || '',
        female: rowData.female || '',
        child: rowData.child || '',
        
        param1: rowData.param1 || '',
        param2: rowData.param2 || '',
        param3: rowData.param3 || '',
        eventId,
        inviteStatus: 'Pending',
        createdBy: req.user?.userId,
        isVerified: false,
        instanceId: event.instanceId,
      });
      
      participationsCreated++;
    }

    res.status(201).json({ 
      message: 'Contacts and participations saved successfully',
      contactsCreated,
      participationsCreated
    });
  } catch (error) {
    console.error('saveContactsInBulk error:', error);
    res.status(500).json({ error: 'Failed to save contacts in bulk.' });
  }
};

const getContact = async (req, res) => {
  try {
    const { page = 1, limit = 20, searchtext, eventId, filter } = req.query;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required.' });
    }

    let query = { eventId };

    if (filter && ['Accepted', 'Rejected', 'Pending', 'Failed'].includes(filter)) {
      query.inviteStatus = filter;
    }

    if (searchtext) {
      query.$or = [
        { contactName: { $regex: searchtext, $options: 'i' } },
        { number: { $regex: searchtext, $options: 'i' } },
        { invites: { $regex: searchtext, $options: 'i' } }
      ];
    }

    const participations = await Participation.find(query)
      .sort({ updatedAt: -1 })
    //   .skip((parseInt(page) - 1) * parseInt(limit))
    //   .limit(parseInt(limit))
      .lean();

    const total = await Participation.countDocuments(query);

    return res.status(200).json({ 
      data: participations, 
      total 
    });
  } catch (error) {
    console.error('getContact error:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateContacts = async (req, res) => {
  try {
    const { id } = req.params;
    const { contactName, number, invites, eventId, instanceId, param1, param2, param3 , attendeesCount, inviteStatus, male, female, child} = req.body;

    const participation = await Participation.findById(id);
    if (!participation) {
      return res.status(404).json({ error: 'Participation not found.' });
    }

    // Update participation fields
    if (invites !== undefined) participation.invites = invites;
    
    if (male !== undefined) participation.male = male;
    if (female !== undefined) participation.female = female;
    if (child !== undefined) participation.child = child;
    
    if (param1 !== undefined) participation.param1 = param1;
    if (param2 !== undefined) participation.param2 = param2;
    if (param3 !== undefined) participation.param3 = param3;
    if (attendeesCount !== undefined) participation.attendeesCount = attendeesCount;
    if (inviteStatus !== undefined) participation.inviteStatus = inviteStatus;
    if (number !== undefined) participation.number = number;
    if (contactName !== undefined) participation.contactName = contactName;
    if (instanceId !== undefined) participation.instanceId = instanceId;

    console.log('participation', participation);
    
    await participation.save();

    const updatedContact = await Contact.findById(participation.contactId);

    const response = participation

    res.status(200).json(response);
  } catch (error) {
    console.error('updateContacts error:', error);
    res.status(500).json({ error: error.message });
  }
};

const activeChatsMap = new Map();

const switchActiveChat = async ({ instanceId, senderNumber }) => {
  const currentActive = activeChatsMap.get(instanceId);

  // ✅ Chat already active → do NOTHING (polling case)
  if (currentActive === senderNumber) {
    return;
  }

  // 🔁 Close previously opened chat (only once)
  if (currentActive) {
    await Participation.updateMany(
      { number: currentActive, instanceId },
      {
        $set: {
          isChatsOpened: false,
          isNewMessages: false
        }
      }
    );
  }

  // ✅ Open newly accessed chat
  await Participation.updateMany(
    { number: senderNumber, instanceId },
    {
      $set: {
        isChatsOpened: true,
        isNewMessages: false
      }
    }
  );

  // 🧠 Update memory
  activeChatsMap.set(instanceId, senderNumber);
};

// const getMessages = async (req, res) => {
//   try {
//     const { senderNumber, instanceId, limit = 20, offset = 0 } = req.body;
    
//     const instance = await Instance.findOne({ _id: instanceId });

//     const messages = await Message.find({ 
//       number: '' + senderNumber,
//       instanceId: instance.instance_id     
//     })
//     .populate('fileId')
//     .sort({ createdAt: -1 })
//     .skip(offset * limit)
//     .limit(limit);

//     const count = await Message.countDocuments({
//       number: '' + senderNumber,
//       instanceId: instance.instance_id 
//     });

//     return res.status(200).send({ messages, count });
//   } catch (error) {
//     return res.status(500).send({ error: error.message });
//   }
// };

const getMessages = async (req, res) => {
  try {
    const {
      senderNumber,
      instanceId,
      limit = 20,
      offset = 0,
      eventId
    } = req.body;

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).send({ error: 'Event not found' });
    }

    const instance = await Instance.findById(instanceId);
    if (!instance) {
      return res.status(404).send({ error: 'Instance not found' });
    }

    // 🔥 Poll-safe active chat handling
    await switchActiveChat({
      instanceId: instance.instance_id,
      senderNumber: '' + senderNumber
    });

    /**
     * 🕒 Build event time range
     */
    const eventStart = new Date(event.startDate);
    eventStart.setHours(
      event.startHour ?? 0,
      event.startMinute ?? 0,
      0,
      0
    );

    const eventEnd = new Date(event.endDate);
    eventEnd.setHours(
      event.endHour ?? 23,
      event.endMinute ?? 59,
      59,
      999
    );
    
    eventEnd.setDate(eventEnd.getDate() + 1);

    const filter = {
      number: '' + senderNumber,
      instanceId: instance.instance_id,
      createdAt: {
        $gte: eventStart,
        $lte: eventEnd
      }
    };

    const messages = await Message.find(filter)
      .populate('fileId')
      .sort({ createdAt: -1 })
      .skip(offset * limit)
      .limit(limit);

    const count = await Message.countDocuments(filter);

    return res.status(200).send({
      messages,
      count,
      eventWindow: {
        from: eventStart,
        to: eventEnd
      }
    });

  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};



// ==================== BULK MESSAGING ====================

const processContact = async (contact, event, messageTrack, message, media, mime, messageType, globalMediaId = null) => {
  try {
    const participation = await Participation.findOne({
      number: contact.number,
      eventId: event._id.toString()
    });

    if (!participation) {
      console.error(`❌ No participation found for ${contact.number}`);
      return;
    }

    // CASE 1: INVITATION TEMPLATE
    if (messageType === "invite") {
      if (!event?.invitationTemplate?.templateName) {
        console.error(`❌ No invitation template found for event ${event?._id}`);
        return;
      }

      const bindValues = {};
      for (const param of event.invitationTemplate.parameters || []) {
        const key = param.key;
        const bindKey = param.bindValue;
        
        let value = "";
        if (bindKey in (participation.toObject() || {})) {
          value = participation[bindKey];
        } else if (bindKey in (event.toObject() || {})) {
          value = event[bindKey];
        }
        
        bindValues[key] = value || "";
      }
      
      const templatePayload = {
        instance_id: participation.instanceId,
        number: participation.number,
        template_name: event.invitationTemplate.templateName,
        language_code: event.invitationTemplate.languageCode || "en",
        bindValues,
        template: event.invitationTemplate,
        eventId: event._id,
        mediaId: globalMediaId
      };

      // Add invitation media if exists
      if (event.invitationMedia) {
        templatePayload.headerMedia = process.env.IMAGE_URL + event.invitationMedia;
        templatePayload.mediaMime = event.invitationMediaMime;
        templatePayload.mediaType = detectMediaType(event.invitationMedia);
      }

      await sendTemplateFunc(templatePayload);

      participation.inviteStatus = "Pending";
      participation.attendeesCount = "0";
    }
    // CASE 2: REMINDER TEMPLATE
    else if (messageType === "reminder") {
      if (!event?.reminderTemplate?.templateName) {
        console.error(`❌ No reminder template found for event ${event?._id}`);
        return;
      }

      const bindValues = {};
      for (const param of event.reminderTemplate.parameters || []) {
        const key = param.key;
        const bindKey = param.bindValue;
        
        let value = "";
        if (bindKey in (participation.toObject() || {})) {
          value = participation[bindKey];
        } else if (bindKey in (event.toObject() || {})) {
          value = event[bindKey];
        }
        
        bindValues[key] = value || "";
      }
      
      const templatePayload = {
        instance_id: participation.instanceId,
        number: participation.number,
        template_name: event.reminderTemplate.templateName,
        language_code: event.reminderTemplate.languageCode || "en",
        bindValues,
        template: event.reminderTemplate,
        eventId: event._id,
        mediaId: globalMediaId
      };

      // Add invitation media if exists
      if (event.reminderMedia) {
        templatePayload.headerMedia = process.env.IMAGE_URL + event.reminderMedia;
        templatePayload.mediaMime = event.reminderMediaMime;
        templatePayload.mediaType = detectMediaType(event.reminderMedia);
      }

      await sendTemplateFunc(templatePayload);

    }
    // CASE 3: RSVP TEAMPLATE
    else if (messageType === "rsvp") {
      if (!event?.rsvpTemplate?.templateName) {
        console.error(`❌ No reminder template found for event ${event?._id}`);
        return;
      }

      const bindValues = {};
      for (const param of event.rsvpTemplate.parameters || []) {
        const key = param.key;
        const bindKey = param.bindValue;
        
        let value = "";
        if (bindKey in (participation.toObject() || {})) {
          value = participation[bindKey];
        } else if (bindKey in (event.toObject() || {})) {
          value = event[bindKey];
        }
        
        bindValues[key] = value || "";
      }

      const templatePayload = {
        instance_id: participation.instanceId,
        number: participation.number,
        template_name: event.rsvpTemplate.templateName,
        language_code: event.rsvpTemplate.languageCode || "en",
        bindValues,
        template: event.rsvpTemplate,
        eventId: event._id,
        mediaId: globalMediaId
      };

      // Add invitation media if exists
      if (event.rsvpMedia) {
        templatePayload.headerMedia = process.env.IMAGE_URL + event.rsvpMedia;
        templatePayload.mediaMime = event.rsvpMediaMime;
        templatePayload.mediaType = detectMediaType(event.rsvpMedia);
      }

      await sendTemplateFunc(templatePayload);
      
    }
    // CASE 4: THANK YOU TEAMPLATE
    else if (messageType === "accept") {
      if (!event?.rsvpTemplate?.templateName) {
        console.error(`❌ No reminder template found for event ${event?._id}`);
        return;
      }

      const bindValues = {};
      for (const param of event.thankYouTemplate.parameters || []) {
        const key = param.key;
        const bindKey = param.bindValue;
        
        let value = "";
        if (bindKey in (participation.toObject() || {})) {
          value = participation[bindKey];
        } else if (bindKey in (event.toObject() || {})) {
          value = event[bindKey];
        }
        
        bindValues[key] = value || "";
      }

        const templatePayload = {
        instance_id: participation.instanceId,
        number: participation.number,
        template_name: event.thankYouTemplate.templateName,
        language_code: event.thankYouTemplate.languageCode || "en",
        bindValues,
        template: event.thankYouTemplate,
        eventId: event._id,
        mediaId: globalMediaId
      };

      // Add invitation media if exists
      if (event.thankYouMedia) {
        templatePayload.headerMedia = process.env.IMAGE_URL + event.thankYouMedia;
        templatePayload.mediaMime = event.thankYouTemplate;
        templatePayload.mediaType = detectMediaType(event.thankYouMedia);
      }

      await sendTemplateFunc(templatePayload);
    }
    // CASE 5: NORMAL MESSAGES
    else {
      const sendObj = {
        number: participation.number,
        instance_id: participation.instanceId,
        eventId: participation.eventId,
        type: "text",
        message
      };

      if (media) {
        sendObj.filename = media.split("/").pop();
        sendObj.media_url = process.env.IMAGE_URL + media;
        sendObj.type = "media";
      }

      await sendMessageFunc(sendObj);

      if (messageType === "accept") {
        participation.inviteStatus = "Accepted";
      } else if (messageType === "rejection") {
        participation.inviteStatus = "Rejected";
      }
    }

    await participation.save();

    // Update chat log
    await ChatLogs.findOneAndUpdate(
      {
        senderNumber: participation.number,
        instanceId: participation.instanceId,
        eventId: event._id.toString(),
      },
      {
        $set: {
          messageTrack,
          finalResponse: "",
          inviteStatus: participation.inviteStatus,
          updatedAt: Date.now(),
        },
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Message processed for ${participation.number} (${messageType})`);
  } catch (error) {
    console.error(`❌ Failed to process contact ${contact?.number}:`, error.message);
    
    const participation = await Participation.findOne({
      number: contact.number,
      eventId: event._id.toString()
    });
    
    if (participation) {
      participation.inviteStatus = "Failed";
      await participation.save();
    }
    throw new Error(error.message);

  }
};

const sendMessagesWithDelay = async (contacts, event, messageTrack, message, media, mime, messageType) => {
  for (let i = 0; i < contacts.length; i++) {
    await processContact(contacts[i], event, messageTrack, message, media, mime, messageType);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log("🎯 All contacts processed for", messageType);
};

const sendBulkMessage = async (req, res) => {
  try {
    const { eventId, message, media, mime, number, filter, messageTrack, messageType, totalContacts } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    let contactQuery = { eventId };

    // REVERSE LOGIC
    if (Array.isArray(number)) {
      if (number.length === 0 && totalContacts > 0) {
        contactQuery.number = { $nin: [] };   // All
      } else if (number.length > 0) {
        contactQuery.number = { $in: number };
      }
    }
    

    if (filter && ["Accepted", "Rejected", "Pending", "Failed"].includes(filter)) {
      contactQuery.inviteStatus = filter;
    }

    const contacts = await Participation.find(contactQuery);
    if (!contacts.length) {
      return res.status(404).json({ message: "No contacts found" });
    }

    console.log(`🚀 Starting bulk send: ${contacts.length} contacts`);

    let globalMediaId = null;
    
    if (media) {
      const instance = await Instance.findOne({instance_id:event.instanceId});
    
      globalMediaId = await getOrUploadMedia(
        process.env.IMAGE_URL + media,
        instance.instance_id,
        instance.accessToken
      );
    
      console.log("🌍 Global mediaId:", globalMediaId);
    }
    try {
      await processContact(contacts[0], event, messageTrack, message, media, mime, messageType, globalMediaId);
      console.log("✅ First message sent successfully.");
    } catch (err) {
      console.error("❌ First message failed:", err.message);
      return res.status(400).json({
        error: "Template / Message Error",
        details: err.message
      });
    }

    const remaining = contacts.slice(1);

    (async () => {
      for (let i = 0; i < remaining.length; i++) {
        try {
          await processContact(remaining[i], event, messageTrack, message, media, mime, messageType, globalMediaId);
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          console.error(`❌ Error processing contact ${remaining[i].number}:`, e.message);
        }
      }

      if(messageType==='invite'){
        event.eventStatus = 'invitation';    
      }else if(messageType==='rsvp'){
        event.eventStatus = 'rsvp';
      }
      
      await event.save();
      console.log("🎯 Background bulk send completed");
    })();


    return res.status(200).json({
      message: "Bulk message job queued",
      firstMessage: "Sent successfully",
      contacts: contacts.length
    });

  } catch (error) {
    console.error("❌ sendBulkMessage Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

const sendMessages = async (req, res) => {
  try {
    const { numbers, instance_id, eventId, message, messageTrack, messageType } = req.body;

    const instance = await Instance.findOne({ _id: instance_id });
    const event = await Event.findOne({ _id: eventId });

    for (let number of numbers) {
      console.log('Processing number:', number);
      
      const participation = await Participation.findOne({ number, eventId });
      if (!participation) {
        console.error(`No participation found for ${number}`);
        continue;
      }

      const sendMessageObj = {
        number,
        type: 'text',
        instance_id: instance?.instance_id,
      };

      // Update participation status
      if (messageType === 'invite') {
        participation.inviteStatus = 'Pending';
        participation.attendeesCount = '0';
      } else if (messageType === 'accept') {
        participation.inviteStatus = 'Accepted';
      } else if (messageType === 'rejection') {
        participation.attendeesCount = '0';
        participation.inviteStatus = 'Rejected';
      }

      await participation.save();

      // Send invitation template
      if (messageTrack === 1 && event?.invitationTemplate) {
        const bindValues = {};
        for (const param of event.invitationTemplate.parameters || []) {
          const key = param.key;
          const bindKey = param.bindValue;
          
          let value = "";
          if (bindKey in (participation.toObject() || {})) {
            value = participation[bindKey];
          } else if (bindKey in (event.toObject() || {})) {
            value = event[bindKey];
          }
          
          bindValues[key] = value || "";
        }

        await sendTemplateFunc({
          instance_id: instance?.instance_id,
          number,
          template_name: event.invitationTemplate.templateName,
          language_code: event.invitationTemplate.languageCode || "en",
          bindValues,
          template: event.invitationTemplate
        });
      } else {
        await sendMessageFunc({ ...sendMessageObj, message });
      }

      // Update chat log
      await ChatLogs.findOneAndUpdate(
        {
          senderNumber: number,
          instanceId: instance?.instance_id,
          eventId: event._id.toString(),
        },
        {
          $set: {
            messageTrack: messageTrack,
            inviteStatus: participation.inviteStatus,
            updatedAt: Date.now(),
          }
        },
        { upsert: true, new: true }
      );
    }

    return res.status(201).json({ message: 'Messages sent successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};


// ==================== REPORTS ====================

const getReport = async (req, res) => {
  const { fromDate, toDate } = req.query;
  const { eventId } = req.params

  try {
    let query = [
      {
        $match: { eventId: eventId.toString() }
      },
      {
        $lookup: {
          from: 'chatlogs',
          let: { contactNumber: '$number', eventId: '$eventId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$senderNumber', '$$contactNumber'] },
                    { $eq: ['$eventId', '$eventId'] }
                  ]
                }
              }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: 'chatlog'
        }
      },
      { $unwind: { path: '$chatlog', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          finalResponse: { $ifNull: ['$chatlog.finalResponse', ''] },
        }
      },
      {
        $project: {
          _id: 0,
          Name: '$contactName',
          PhoneNumber: { $toString: '$number' },
          invites: '$invites',
          'UpdatedAt': { $ifNull: [{ $dateToString: { format: '%Y-%m-%d %H:%M:%S', date: '$updatedAt' } }, ''] },
          Status: '$inviteStatus',
          finalResponse: 1,
          instanceNumber: 1,
          attendeesCount: 1
        }
      }
    ];

    const formatDate = (date) => {
      if (!date || isNaN(new Date(date).getTime())) {
        return '';
      }
      const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      };
      return new Date(date).toLocaleString('en-US', options).replace(',', '');
    };

    let data = await Participation.aggregate(query);

    data = data.map(ele => ({
      Name: ele.Name,
      'PhoneNumber': ele.PhoneNumber,
      Invites: ele.invites,
      'UpdatedAt': formatDate(ele['UpdatedAt']),
      Status: ele.Status,
      'Response': ele.finalResponse,
      'GuestCount': ele.attendeesCount,
      'Host': ele?.instanceNumber
    }));

    const fileName = `Report-${Date.now()}.csv`;
    const filePath = `uploads/reports/${fileName}`;
    const csvWriter = createCsvWriter({
      path: filePath,
      header: [
        { id: 'Name', title: 'Name' },
        { id: 'PhoneNumber', title: 'Phone Number' },
        { id: 'Invites', title: 'Invites'},
        { id: 'UpdatedAt', title: 'Updated At' },
        { id: 'Response', title: 'Last Response' },
        { id: 'Status', title: 'Status' },
        { id: 'GuestCount', title: 'Guest Count'},
        { id: 'Host', title: 'Host' }
      ]
    });

    await csvWriter.writeRecords(data);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
};

// ==================== NEW REPORT APIs ====================

const getInviteStatusReport = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { fromDate, toDate } = req.query;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required.' });
    }

    let dateFilter = {};
    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
    
      from.setDate(from.getDate() - 1);
    
      to.setDate(to.getDate() + 1);
    
      dateFilter.updatedAt = {
        $gte: from,
        $lte: to
      };
    }
    
    const stats = await Participation.aggregate([
      {
        $match: {
          eventId: eventId.toString(),
          ...dateFilter
        }
      },
      {
        $group: {
          _id: "$inviteStatus",
          count: { $sum: 1 },
          totalGuests: { $sum: { $toInt: "$attendeesCount" } },
          contacts: {
            $push: {
              name: "$contactName",
              number: "$number",
              invites: "$invites",
              updatedAt: "$updatedAt"
            }
          }
        }
      }
    ]);

    console.log('stats', stats)
    const summaryData = stats.map(stat => ({
      'Invite Status': stat._id || 'Unknown',
      'Total Contacts': stat.count,
      'Total Guests': stat.totalGuests
    }));

    const detailedData = [];
    stats.forEach(stat => {
      stat.contacts.forEach(contact => {
        detailedData.push({
          'Name': contact.name,
          'Number': contact.number,
          'Invites': contact.invites,
          'Gents': contact?.male || '-',
          'Ladies': contact?.female || '-',
          'Childs': contact?.child || '-',
          'Param1': contact?.param1 || '-',
          'Param2': contact?.param2 || '-',
          'Param3': contact?.param3 || '-',
          'Invites Accepted': contact.attendeesCount,
          'Status': stat._id || 'Unknown',
          'Updated At': new Date(contact.updatedAt).toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })
        });
      });
    });
    

    const fileName = `InviteStatusReport-${eventId}-${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, '../../uploads/reports', fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const wb = xlsx.utils.book_new();
    
    const wsSummary = xlsx.utils.json_to_sheet(summaryData);
    xlsx.utils.book_append_sheet(wb, wsSummary, 'Summary');
    
    const wsDetailed = xlsx.utils.json_to_sheet(detailedData);
    xlsx.utils.book_append_sheet(wb, wsDetailed, 'Detailed');

    xlsx.writeFile(wb, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }
      fs.unlinkSync(filePath);
    });

  } catch (error) {
    console.error('getInviteStatusReport error:', error);
    res.status(500).json({ error: error.message });
  }
};

const getMessageStatusReport = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { fromDate, toDate , template} = req.query;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required.' });
    }

    let dateFilter = {};
    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
    
      from.setDate(from.getDate() - 1);
    
      to.setDate(to.getDate() + 1);
    
      dateFilter.createdAt = {
        $gte: from,
        $lte: to
      };
    }

    const messages = await Message.find({
        templateName: template,
      eventId: eventId.toString(),
      fromMe: true,
      ...dateFilter
    }).sort({ createdAt: -1 });

    const reportData = messages.map(msg => {
      const latestStatus = msg.messageStatus && msg.messageStatus.length > 0 
        ? msg.messageStatus[msg.messageStatus.length - 1]
        : { status: 'unknown', time: null };

      const statusMap = {
        '1': 'Sent',
        '2': 'Delivered',
        '3': 'Read',
        'sent': 'Sent',
        'delivered': 'Delivered',
        'read': 'Read',
        'failed': 'Failed'
      };

      return {
        'Number': msg.number,
        'Message Type': msg.type || 'text',
        'Template Name': msg.templateName || '-',
        'Message': msg.message ? msg.message.substring(0, 100) : '-',
        'Status': statusMap[latestStatus.status] || latestStatus.status || 'Unknown',
        'Status Time': latestStatus.time 
          ? new Date(latestStatus.time).toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          : '-',
        'Sent At': new Date(msg.createdAt).toLocaleString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      };
    });

    const summary = {
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      unanswered: 0
    };

    messages.forEach(msg => {
      const latestStatus = msg.messageStatus && msg.messageStatus.length > 0 
        ? msg.messageStatus[msg.messageStatus.length - 1].status
        : 'unknown';

      if (latestStatus === '1' || latestStatus === 'sent') summary.sent++;
      else if (latestStatus === '2' || latestStatus === 'delivered') summary.delivered++;
      else if (latestStatus === '3' || latestStatus === 'read') summary.read++;
      else if (latestStatus === 'failed') summary.failed++;
      else summary.unanswered++;
    });

    const summaryData = [{
      'Total Messages': messages.length,
      'Sent': summary.sent,
      'Delivered': summary.delivered,
      'Read': summary.read,
      'Failed': summary.failed,
      'Unanswered': summary.unanswered
    }];

    const fileName = `MessageStatusReport-${eventId}-${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, '../../uploads/reports', fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const wb = xlsx.utils.book_new();
    
    const wsSummary = xlsx.utils.json_to_sheet(summaryData);
    xlsx.utils.book_append_sheet(wb, wsSummary, 'Summary');
    
    const wsDetailed = xlsx.utils.json_to_sheet(reportData);
    xlsx.utils.book_append_sheet(wb, wsDetailed, 'Message Details');

    xlsx.writeFile(wb, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }
      fs.unlinkSync(filePath);
    });

  } catch (error) {
    console.error('getMessageStatusReport error:', error);
    res.status(500).json({ error: error.message });
  }
};

const getTemplateMessageReport = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { fromDate, toDate, template } = req.query;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required.' });
    }

    let dateFilter = {};
     if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
    
      from.setDate(from.getDate() - 1);
    
      to.setDate(to.getDate() + 1);
    
      dateFilter.createdAt = {
        $gte: from,
        $lte: to
      };
    }

    const templateMessages = await Message.find({
      eventId: eventId.toString(),
      fromMe: true,
      templateName: template,
      ...dateFilter
    }).sort({ createdAt: -1 });


    const reportData = templateMessages.map(msg => {
      const latestStatus = msg.messageStatus && msg.messageStatus.length > 0 
        ? msg.messageStatus[msg.messageStatus.length - 1]
        : { status: 'unknown', time: null };

      const statusMap = {
        '1': 'Sent',
        '2': 'Delivered',
        '3': 'Read',
        'sent': 'Sent',
        'delivered': 'Delivered',
        'read': 'Read',
        'failed': 'Failed'
      };

      return {
        'Number': msg.number,
        'Template Name': msg.templateName || '-',
        'Message Preview': msg.message ? msg.message.substring(0, 150) : '-',
        'Status': statusMap[latestStatus.status] || latestStatus.status || 'Unknown',
        'Sent At': new Date(msg.createdAt).toLocaleString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        'Delivered At': latestStatus.status === '2' || latestStatus.status === 'delivered'
          ? new Date(latestStatus.time).toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          : '-',
        'Read At': latestStatus.status === '3' || latestStatus.status === 'read'
          ? new Date(latestStatus.time).toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          : '-'
      };
    });

    const templateStats = {};
    templateMessages.forEach(msg => {
      const templateName = msg.templateName || 'Unknown';
      if (!templateStats[templateName]) {
        templateStats[templateName] = {
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0
        };
      }

      const latestStatus = msg.messageStatus && msg.messageStatus.length > 0 
        ? msg.messageStatus[msg.messageStatus.length - 1].status
        : 'unknown';

      templateStats[templateName].sent++;
      if (latestStatus === '2' || latestStatus === 'delivered') {
        templateStats[templateName].delivered++;
      }
      if (latestStatus === '3' || latestStatus === 'read') {
        templateStats[templateName].read++;
      }
      if (latestStatus === 'failed') {
        templateStats[templateName].failed++;
      }
    });

    const summaryData = Object.entries(templateStats).map(([name, stats]) => ({
      'Template Name': name,
      'Total Sent': stats.sent,
      'Delivered': stats.delivered,
      'Read': stats.read,
      'Failed': stats.failed,
      'Delivery Rate': ((stats.delivered / stats.sent) * 100).toFixed(2) + '%',
      'Read Rate': ((stats.read / stats.sent) * 100).toFixed(2) + '%'
    }));

    const fileName = `TemplateMessageReport-${eventId}-${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, '../../uploads/reports', fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const wb = xlsx.utils.book_new();
    
    const wsSummary = xlsx.utils.json_to_sheet(summaryData);
    xlsx.utils.book_append_sheet(wb, wsSummary, 'Template Summary');
    
    const wsDetailed = xlsx.utils.json_to_sheet(reportData);
    xlsx.utils.book_append_sheet(wb, wsDetailed, 'Message Details');

    xlsx.writeFile(wb, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }
      fs.unlinkSync(filePath);
    });

  } catch (error) {
    console.error('getTemplateMessageReport error:', error);
    res.status(500).json({ error: error.message });
  }
};

const getDetailedContactReport = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { fromDate, toDate, filter } = req.query;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required.' });
    }

    let dateFilter = {};
     if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
    
      from.setDate(from.getDate() - 1);
    
      to.setDate(to.getDate() + 1);
    
      dateFilter.updatedAt = {
        $gte: from,
        $lte: to
      };
    }

    let statusFilter = {};
    if (filter && ['Accepted', 'Rejected', 'Pending', 'Failed'].includes(filter)) {
      statusFilter.inviteStatus = filter;
    }
      
    const participations = await Participation.aggregate([
      {
        $match: {
          eventId: eventId.toString(),
          ...dateFilter,
          ...statusFilter
        }
      },
      {
        $lookup: {
          from: 'messages',
          let: { number: '$number', instanceId: '$instanceId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$number', '$$number'] },
                    { $eq: ['$instanceId', '$$instanceId'] },
                  ]
                }
              }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: 'lastMessage'
        }
      },
      { $unwind: { path: '$lastMessage', preserveNullAndEmptyArrays: true } }
    ]);

    const reportData = participations.map(p => {
      const lastMsg = p.lastMessage;
      const lastStatus = lastMsg?.messageStatus && lastMsg.messageStatus.length > 0
        ? lastMsg.messageStatus[lastMsg.messageStatus.length - 1]
        : null;

      const statusMap = {
        '1': 'Sent',
        '2': 'Delivered',
        '3': 'Read',
        'sent': 'Sent',
        'delivered': 'Delivered',
        'read': 'Read'
      };

      return {
        'Name': p.contactName,
        'Number': p.number,
        'Invites': p.invites,
        'Invite Status': p.inviteStatus || 'Pending',
        'Guest Count': p.attendeesCount || '0',
        'Gents': p?.male || '-',
        'Ladies': p?.female || '-',
        'Childs': p?.child || '-',
        'Param1': p?.param1 || '-',
        'Param2': p?.param2 || '-',
        'Param3': p?.param3 || '-',
        'Last Message': lastMsg?.message ? lastMsg.message.substring(0, 100) : '-',
        'Last Message At': lastMsg?.createdAt
          ? new Date(lastMsg.createdAt).toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          : '-',
        'Message Status': lastStatus ? (statusMap[lastStatus.status] || lastStatus.status) : '-',
        'Delivered At': lastStatus?.status === '2' || lastStatus?.status === 'delivered'
          ? new Date(lastStatus.time).toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          : '-',
        'Read At': lastStatus?.status === '3' || lastStatus?.status === 'read'
          ? new Date(lastStatus.time).toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          : '-',
        'Updated At': new Date(p.updatedAt).toLocaleString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      };
    });

    const fileName = `DetailedContactReport-${eventId}-${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, '../../uploads/reports', fileName);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(reportData);
    xlsx.utils.book_append_sheet(wb, ws, 'Contact Report');

    xlsx.writeFile(wb, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }
      fs.unlinkSync(filePath);
    });

  } catch (error) {
    console.error('getDetailedContactReport error:', error);
    res.status(500).json({ error: error.message });
  }
};

const fetchDashBoardStats = async (req, res) => {
  const { eventId } = req.body;
  
  console.log('eventId', eventId)
  try {
    const stats = await Participation.aggregate([
      { $match: { eventId: eventId.toString() } },
      {
        $group: {
          _id: "$instanceId",
          totalContacts: { $sum: 1 },
          accepted: { $sum: { $cond: [{ $eq: ["$inviteStatus", "Accepted"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$inviteStatus", "Rejected"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$inviteStatus", "Pending"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$inviteStatus", "Failed"] }, 1, 0] } },
          guestCount: { $sum: { $toInt: "$attendeesCount" } }
        }
      },
      {
        $lookup: {
          from: "instances",
          localField: "_id",
          foreignField: "instance_id",
          as: "instanceData"
        }
      },
      {
        $unwind: {
          path: "$instanceData",
          preserveNullAndEmptyArrays: true
        }
      }
    ]);

    const result = {};
    stats.forEach(stat => {
      result[stat._id] = {
        totalContacts: stat.totalContacts,
        accepted: stat.accepted,
        rejected: stat.rejected,
        pending: stat.pending,
        failed: stat.failed,
        guestCount: stat.guestCount,
        instanceName: stat.instanceData.name,
        instanceNumber: stat.instanceData.number,
        instanceId: stat.instanceData.instance_id
      };
      
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error getting stats:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ==================== WEBHOOK HANDLERS ====================

const getEventWebhook = async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.WP_VERIFY_TOKEN;
    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified successfully!');
        return res.status(200).send(challenge);
      } else {
        return res.sendStatus(403);
      }
    } else {
      return res.status(400).json({ message: 'No token or mode found' });
    }
  } catch (error) {
    console.error('Webhook verification error:', error);
    return res.status(500).json({ error: error.message });
  }
};

const postEventWebhook = async (req, res) => {
  try {
    const body = req.body;

    console.log("📩 Received webhook event:", JSON.stringify(body, null, 2));

    if (body?.object !== "whatsapp_business_account") {
      return res.status(400).json({ message: "Invalid webhook object type" });
    }

    for (const entry of body.entry || []) {
      const changes = entry?.changes || [];

      for (const change of changes) {
        const value = change?.value || {};
        const messages = value?.messages || [];
        const statuses = value?.statuses || [];
        const numberId = value?.metadata?.phone_number_id;
        if(numberId === '922845364256214') {
            return axios.post("https://minicom.whats-now.com/api/chats/webhookEvent", body)
        }
        if(numberId === '970022249532499') {
            return axios.post("https://alsaada.whats-now.com/api/chats/webhookEvent", body)
        }
        const contacts = value?.contacts || [];

        for (const message of messages) {
          const contact = contacts.find(c => c.wa_id === message.from) || null;
          console.log("💬 New message received:", message);
          
          try {
            await handleMessageUpsert({ ...message, ...contact }, numberId);
          } catch (err) {
            console.error("❌ Error handling message upsert:", err);
          }
        }

        for (const status of statuses) {
          console.log("📡 New status update received:", status);
          
          try {
            await handleMessageUpdate(status, numberId);
          } catch (err) {
            console.error("❌ Error handling status update:", err);
          }
        }
      }
    }

    return res.status(200).json({ message: "Event processed successfully" });
  } catch (error) {
    console.error("🔥 Webhook processing failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const handleMessageUpdate = async (status, numberId) => {
  try {
    const messageId = status.id;
    const statusValue = status.status;
    const timeStamp = new Date(parseInt(status.timestamp) * 1000);

    const statusMap = {
      'sent': '1',
      'delivered': '2',
      'read': '3',
      'failed': 'failed'
    };

    const mappedStatus = statusMap[statusValue] || statusValue;

    const message = await Message.findOneAndUpdate(
      { messageId },
      { 
        $push: { 
          messageStatus: { 
            status: mappedStatus, 
            time: timeStamp 
          } 
        } 
      },
      { new: true }
    );

    if (message) {
      console.log(`✅ Message status updated: ${messageId} -> ${statusValue}`);
    }

    return message;
  } catch (error) {
    console.error("❌ Error updating message status:", error);
    return null;
  }
};

const handleMessageUpsert = async (message, numberId) => {
  try {
    if (!message) return;

    console.log("➡️ Processing new message:", message);

    const number = message.from;
    const messageId = message.id;
    const timeStamp = new Date(parseInt(message.timestamp) * 1000);
    const type = message.type;
    const fromMe = false;
    const textMessage = message?.text?.body || message?.button?.text || "";

    // Handle media if present
    let fileData = null;
    let fileId = null;
    if (["image", "video", "audio", "document", "sticker"].includes(type)) {
      try {
        fileData = await saveFileData(message, numberId);
        if (fileData) {
          fileId = fileData._id;
          console.log('✅ File saved:', fileId);
        }
      } catch (err) {
        console.error("❌ Error saving media file:", err);
      }
    }

    // Find or create contact
    const pushName = message?.profile?.name || "Unknown";
    const contact = await Contact.findOne({ number });

    // Find participation to get event details
    const participation = await Participation.findOne({ 
      number,
      instanceId: numberId
    }).sort({ updatedAt: -1 });


    // Store message in DB
    const newMessage = await Message.findOneAndUpdate(
      { messageId },
      {
        $set: {
          number,
          fromMe,
          instanceId: numberId,
          message: textMessage || fileData?.caption || "", 
          messageId,
          timeStamp,
          messageStatus: [{ status: "3", time: new Date() }],
          type: fileData ? "media" : message?.type === "reaction" ? "reaction":"text",
          fileType: fileData?.filetype,
          mimetype: fileData?.mimetype,
          fileSize: fileData?.fileLength,
          fileLength: fileData?.fileLength,
          fileId: fileId,
          mediaUrl: fileData?.url,
          sentBy: "customer",
          sendByName: participation.contactName,
          sentById: contact?._id,
          createdAt: timeStamp,
          reaction: {
              messageId: message?.reaction?.message_id,
              emoji: message?.reaction?.emoji
          }
        },
      },
      { new: true, upsert: true }
    );

    console.log("✅ Incoming message saved:", messageId);

    // Optional: Trigger AI response
    const payload = {
      name: participation.contactName,
      phone_number: number,
      message: textMessage || fileData?.caption || "",
      instance_id: numberId
    };
    
    if (fileData) {
      payload['file'] = fileData?.url;
    }
    
    console.log('payload', payload)
    
    const aiResponse = await axios.post(
      `${process.env.LLM_API}/api/izzan_rsvp/message`,
      payload,
    );
    
    console.log('aiResponse', aiResponse.data.response)
    
    const sendObj = {
        number: number,
        name: participation.contactName, 
        instance_id: numberId,
        type: "text",
        message: aiResponse?.data?.response
      };
    
    await updateParticipationsForMessage({
      number: sendObj.number,
      instanceId: numberId,
      message: payload.message || fileData?.filetype
    });
    
    await sendResponseFunc(sendObj);

    return { message: 'Message received and processed' };
  } catch (err) {
    console.error("🔥 Error in handleMessageUpsert:", err);
    return null;
  }
};

const sendResponseFunc = async(data)=>{
    console.log(data)
    const instance = await Instance.findOne({instance_id: data.instance_id})
    const participation = await Participation.find({number: data.number, instanceId: data.instance_id });
    
    const phoneNumberId = data.instance_id;
    const token = instance.accessToken;
    const graphURL = `${process.env.FB_API}/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    
    const textPayload = {
        messaging_product: "whatsapp",
        to: data.number,
        type: "text",
        text: { body: data.message }
      };

    
    const textRes = await axios.post(graphURL, textPayload, { headers });
    const textMessageId = textRes?.data?.messages?.[0]?.id;
    
     const newMessage = new Message({
      number: data.number,
      instanceId: phoneNumberId,
      fromMe: true,
      message: textPayload.text.body,
      messageId: textMessageId,
      type: "text",
      timeStamp: new Date(),
      messageStatus: [{ status: "0", time: new Date() }],
      sentBy: "admin",
      sendByName: "System",
    });
    
    await newMessage.save();

    await updateParticipationsForMessage({
      number: newMessage.number,
      instanceId: phoneNumberId,
      message: newMessage.message
    });
    
}

const addMessageToAiSystem = async (payload) => {
    const result = await axios.post(
      `${process.env.LLM_API}/api/izzan_rsvp/include_message`,
      payload,
    );
    return result;
}

const updateParticipationsForMessage = async (
    {
  number,
  instanceId,
  message}) => {
  return Participation.updateMany(
    { number, instanceId },
    [
      {
        $set: {
          lastResponse: message,
          lastResponseUpdatedAt: new Date(),
          updatedAt: new Date(),
          isNewMessages: {
            $cond: {
              if: '$isChatsOpened',
              then: '$isNewMessages', // keep existing value
              else: true              // mark as new message
            }
          }
        }
      }
    ]
  );
};


module.exports = {
  saveContact,
  getContact,
  updateContacts,
  getMessages,
  sendMessages,
  getReport,
  saveContactsInBulk,
  sendBulkMessage,
  fetchDashBoardStats,
  getEventWebhook,
  postEventWebhook,
  getInviteStatusReport,
  getMessageStatusReport,
  getTemplateMessageReport,
  getDetailedContactReport
};


