const axios = require('axios');
const Instance = require('../models/instanceModel')
const {Message, Contact, ChatLogs, Participation, File} = require('../models/chatModel');
const Campaign = require('../models/campaignModel');
const Event = require('../models/event.Model');
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


const saveContact = async (req, res) => {
  try {
    const { name, invites, number, instanceId, eventId, host, param1, param2, param3 } = req.body;

    // 1️⃣ Check if contact exists globally (master table)
    let contact = await Contact.findOne({ number });

    // 2️⃣ If contact doesn't exist, create it
    if (!contact) {
      contact = new Contact({
        name,
        number,
        createdBy: req.user?.userId
      });
      await contact.save();
    }

    // 3️⃣ Check if participation already exists for this event and contact
    const existingParticipation = await Participation.findOne({
      contactId: contact._id,
      eventId
    });

    if (existingParticipation) {
      return res.status(400).json({ 
        error: 'Participation already exists for this contact in this event.' 
      });
    }

    // 4️⃣ Find related instance
    let instance = null;
    if (instanceId) {
      instance = await Instance.findOne({ _id: instanceId });
    } else if (host) {
      instance = await Instance.findOne({ number: String(host).trim() });
    }

    // 5️⃣ Create participation record
    const participationData = {
      contactId: contact._id.toString(),
      contactName: contact.name,
      number: number,
      invites,
      param1,
      param2,
      param3,
      eventId,
      createdBy: req.user?.userId,
      inviteStatus: 'Pending',
      instanceId: instance?.instance_id || null,
      instanceNumber: instance?.number || null
    };

    const participation = new Participation(participationData);
    await participation.save();

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
    const instance = await Instance.findOne({ instance_id: event.instanceId });
    
    const headers = sheet[0];
    const rows = sheet.slice(1);

    let contactsCreated = 0;
    let participationsCreated = 0;

    // Loop through each row in the sheet
    for (const row of rows) {
      let rowData = {};
      headers.forEach((header, index) => {
        rowData[header] = row[index];
      });

      const number = rowData.number ? String(rowData.number).trim() : null;
      const name = rowData.name || 'Unnamed';
      
      if (!number) continue;

      // 1️⃣ Check if contact exists
      let contact = await Contact.findOne({ number });

      // 2️⃣ If not found, create new contact
      if (!contact) {
        contact = await Contact.create({
          name,
          number,
          createdBy: req.user?.userId
        });
        
        console.log('contact', contact)
        contactsCreated++;
      }

      // 3️⃣ Check if participation already exists for this contact and event
      const existingParticipation = await Participation.findOne({
        contactId: contact._id.toString(),
        eventId
      });

      // Skip if participation already exists
      if (existingParticipation) continue;

      // 4️⃣ Prepare instance data
      const hostId = rowData.hostId ? String(rowData.hostId).trim() : null;
      let instanceData = {
        instanceId: instance?.instance_id || "717403984799613",
        instanceNumber: instance?.number || 971585320110
      };

      // 5️⃣ Create participation
      await Participation.create({
        contactId: contact._id.toString(),
        contactName: contact.name,
        number,
        invites: rowData.invites || '',
        param1: rowData.param1 || '',
        param2: rowData.param2 || '',
        param3: rowData.param3 || '',
        eventId: eventId,
        inviteStatus: 'Pending',
        createdBy: req.user?.userId,
        isVerified: false,
        ...instanceData
      });
      
      console.log({
        contactId: contact._id.toString(),
        contactName: contact.name,
        number,
        invites: rowData.invites || '',
        param1: rowData.param1 || '',
        param2: rowData.param2 || '',
        param3: rowData.param3 || '',
        eventId: eventId,
        inviteStatus: 'Pending',
        createdBy: req.user?.userId,
        isVerified: false,
        ...instanceData
      })
      
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

    // Apply filter
    if (filter && ['Accepted', 'Rejected', 'Pending', 'Failed'].includes(filter)) {
      query.inviteStatus = filter;
    }

    // Apply search
    if (searchtext) {
      query.$or = [
        { contactName: { $regex: searchtext, $options: 'i' } },
        { number: { $regex: searchtext, $options: 'i' } },
        { invites: { $regex: searchtext, $options: 'i' } }
      ];
    }

    // Get participations with pagination
    const participations = await Participation.find(query)
      .sort({ updatedAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
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
    const { id } = req.params; // participation id
    const { name, number, invites, eventId, instanceId, param1, param2, param3 } = req.body;

    // 1️⃣ Find the participation record
    const participation = await Participation.findById(id);
    if (!participation) {
      return res.status(404).json({ error: 'Participation not found.' });
    }

    // 2️⃣ Get the associated contact
    const contact = await Contact.findById(participation.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Linked contact not found.' });
    }

    // 3️⃣ If number is changing, check validations
    if (number && String(number).trim() !== contact.number) {
      const trimmedNumber = String(number).trim();
      
      // Check if another contact has this number
      const duplicateContact = await Contact.findOne({
        number: trimmedNumber,
        _id: { $ne: contact._id }
      });

      if (duplicateContact) {
        // Check if duplicate contact already has participation in this event
        const duplicateParticipation = await Participation.findOne({
          contactId: duplicateContact._id.toString(),
          eventId: participation.eventId,
          _id: { $ne: id }
        });

        if (duplicateParticipation) {
          return res.status(400).json({ 
            error: 'A participation with this number already exists for this event.' 
          });
        }

        // Reassign participation to existing contact
        participation.contactId = duplicateContact._id.toString();
        participation.contactName = duplicateContact.name;
      } else {
        // Update current contact's number
        contact.number = trimmedNumber;
        if (name) contact.name = name;
        await contact.save();
        participation.contactName = contact.name;
      }
    } else if (name && name !== contact.name) {
      // Only name is changing
      contact.name = name;
      await contact.save();
      participation.contactName = name;
    }

    // 4️⃣ Get instance details if instanceId provided
    if (instanceId) {
      const instance = await Instance.findOne({ _id: instanceId });
      if (instance) {
        participation.instanceId = instance.instance_id;
        participation.instanceNumber = instance.number;
      }
    }

    // 5️⃣ Update participation fields
    if (invites !== undefined) participation.invites = invites;
    if (param1 !== undefined) participation.param1 = param1;
    if (param2 !== undefined) participation.param2 = param2;
    if (param3 !== undefined) participation.param3 = param3;

    await participation.save();

    // 6️⃣ Get updated contact for response
    const updatedContact = await Contact.findById(participation.contactId);

    const response = {
      _id: participation._id,
      contactId: participation.contactId,
      name: updatedContact?.name || participation.contactName,
      number: updatedContact?.number || '',
      invites: participation.invites,
      param1: participation.param1,
      param2: participation.param2,
      param3: participation.param3,
      inviteStatus: participation.inviteStatus,
      eventId: participation.eventId,
      instanceId: participation.instanceId,
      instanceNumber: participation.instanceNumber,
      updatedAt: participation.updatedAt
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('updateContacts error:', error);
    res.status(500).json({ error: error.message });
  }
};

const getMessages = async (req, res)=>{
    try {
        const {senderNumber, instanceId, limit = 20, offset = 0 } = req.body;
        
        const instance = await Instance.findOne({_id:instanceId})

        const messages = await Message.find({ 
          senderNumber: ''+ senderNumber,
          instanceId: instance.instance_id     
         }).sort({ createdAt: -1 })
         .skip(offset * limit)
         .limit(limit);

         const count = await Message.countDocuments({
          senderNumber: ''+ senderNumber,
          instanceId: instance.instance_id 
         })
        // return res.status(200).send({messages:' here'});
        return res.status(200).send({messages,count});
      } catch (error) {
        // console.log(error)
        return res.status(500).send({ error: error.message });
      }
}

const processContact = async (contact, event, messageTrack, message, media, mime, messageType) => {
  try {
    const sendMessageObj = {
      number: contact?.number,
      instance_id: contact?.instanceId,
    };

    // 🟢 CASE 1: INVITATION TEMPLATE MESSAGE
    if (messageType === "invite") {
        if (!event?.invitationTemplate?.templateName) {
           console.error(`❌ No template found for event ${event?._id}`);
           return;
        }

        const bindValues = {};
    
        for (const param of event.invitationTemplate.parameters || []) {
          const key = param.key;           // e.g., "izan"
          const bindKey = param.bindValue; // e.g., "name" / "param1" / event field
        
          let value = "";
        
          // priority: contact → event → empty
          if (bindKey in (contact || {})) {
            value = contact[bindKey];
          } else if (bindKey in (event || {})) {
            value = event[bindKey];
          } else {
            value = ""; // fallback
          }
        
          bindValues[key] = value || "";
        }
        await sendTemplateFunc({
          instance_id: contact?.instanceId,
          number: contact?.number,
          template_name: event.invitationTemplate.templateName,
          language_code: event.invitationTemplate.languageCode || "en",
          bindValues,
          template:  event.invitationTemplate
        });
      // update contact invite status
      contact.inviteStatus = "Pending";
      contact.attendeesCount = "0";
    }

    // 🟢 CASE 2: REMINDER TEMPLATE MESSAGE
    if (messageType === "reminder") {
        if (!event?.reminderTemplate?.templateName) {
           console.error(`❌ No template found for event ${event?._id}`);
           return;
        }

        const bindValues = {};
    
        for (const param of event.reminderTemplate.parameters || []) {
          const key = param.key;           // e.g., "izan"
          const bindKey = param.bindValue; // e.g., "name" / "param1" / event field
        
          let value = "";
        
          // priority: contact → event → empty
          if (bindKey in (contact || {})) {
            value = contact[bindKey];
          } else if (bindKey in (event || {})) {
            value = event[bindKey];
          } else {
            value = ""; // fallback
          }
        
          bindValues[key] = value || "";
        }
        await sendTemplateFunc({
          instance_id: contact?.instanceId,
          number: contact?.number,
          template_name: event.reminderTemplate.templateName,
          language_code: event.reminderTemplate.languageCode || "en",
          bindValues,
          template: event.reminderTemplate
        });
      // update contact invite status
      contact.attendeesCount = "0";
    }

    // 🟢 CASE 3: NORMAL OR THANK-YOU MESSAGES
    else {
      const sendObj = { ...sendMessageObj, type: "text", message };

      if (media) {
        sendObj.filename = media.split("/").pop();
        sendObj.media_url = process.env.IMAGE_URL + media;
        sendObj.type = "media";
      }

      await sendMessageFunc(sendObj);

      // handle invite status update for follow-up replies
      if (messageType === "accept") contact.inviteStatus = "Accepted";
      else if (messageType === "rejection") contact.inviteStatus = "Rejected";
    }

    await contact.save();

    // 🟣 Update or create chat log
    await ChatLogs.findOneAndUpdate(
      {
        senderNumber: contact?.number,
        instanceId: contact?.instanceId,
        eventId: event._id,
      },
      {
        $set: {
          messageTrack,
          finalResponse: "",
          inviteStatus: contact.inviteStatus,
          updatedAt: Date.now(),
        },
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Message processed for ${contact.number} (${messageType})`);
  } catch (error) {
    console.error(`❌ Failed to process contact ${contact?.number}:`, error.message);
    if (contact) {
      contact.inviteStatus = "Failed";
      await contact.save();
    }
  }
};

const sendMessagesWithDelay = async (contacts, event, messageTrack, message, media, mime, messageType) => {
  for (let i = 0; i < contacts.length; i++) {
    await processContact(contacts[i], event, messageTrack, message, media, mime, messageType);
    await new Promise((resolve) => setTimeout(resolve, 2000)); // 2s delay between messages
  }
  console.log("🎯 All contacts processed for", messageType);
};

const sendBulkMessage = async (req, res) => {
  try {
    const { eventId, message, media, mime, number, filter, messageTrack, messageType } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    let contactQuery = { eventId };
    if (number?.length) {
      contactQuery.number = { $in: number };
    } else if (filter && ["Accepted", "Rejected", "Pending", "Failed"].includes(filter)) {
      contactQuery.inviteStatus = filter;
    }

    const contacts = await Participation.find(contactQuery);
    if (!contacts.length) return res.status(404).json({ message: "No contacts found" });

    console.log(`🚀 Starting bulk send: ${contacts.length} contacts, type=${messageType}`);

    sendMessagesWithDelay(contacts, event, messageTrack, message, media, mime, messageType)
      .then(() => console.log("✅ Bulk message job completed"))
      .catch((err) => console.error("❌ Bulk message job failed:", err));

    return res.status(201).send({ message: "Message sending job queued", count: contacts.length });
  } catch (error) {
    console.error("❌ sendBulkMessage Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

const sendMessages = async (req, res)=>{
  try {

    const { numbers, instance_id, eventId, message, messageTrack, messageType } = req.body;

    const senderId = req.user.userId
    const instance = await Instance.findOne({_id:instance_id})
    // Save the message to the database
    let start = new Date();
    start.setHours(0,0,0,0);

    let end = new Date();
    end.setHours(23,59,59,999);
    const campaign = await Event.findOne({_id: eventId})
    for(let number of numbers){
      console.log('number',number)
      const sendMessageObj={
        number: number,
        type: 'text',
        instance_id: instance?.instance_id,
      }

      const updateContact = await Contact.findOne({number, eventId })
      // console.log(updateContact)
  
      if(messageType==='invite'){
        updateContact.inviteStatus='Pending',
        updateContact.attendeesCount='0'
        updateContact.updatedAt = Date.now()
        await updateContact.save()
      }else if(messageType==='accept'){
        updateContact.updatedAt = Date.now()
        updateContact.inviteStatus='Accepted',
        await updateContact.save()
      }else if(messageType==='rejection'){
        updateContact.updatedAt = Date.now()
        updateContact.attendeesCount = '0'
        updateContact.inviteStatus='Rejected',
        await updateContact.save()
      }
  

      if(messageTrack==1){
  
        let reply = campaign?.invitationText
        if(campaign?.invitationMedia){              
          sendMessageObj.filename = campaign?.invitationMedia.split('/').pop();
          sendMessageObj.media_url= process.env.IMAGE_URL+campaign?.invitationMedia;
          sendMessageObj.type = 'media';
        }
        const response = await sendMessageFunc({...sendMessageObj,message: reply });
        if(response?.status==='error'){
            return res.status(400).json(response)
        }
        const NewChatLog = await ChatLogs.findOneAndUpdate(
          {
            senderNumber: number,
            instanceId: instance?.instance_id,
            eventId : campaign._id,
            messageTrack:  1
          },
          {
            $set: {
              updatedAt: Date.now(),
            }
          },
          {
            upsert: true, // Create if not found, update if found
            new: true // Return the modified document rather than the original
          }
        )
      }else{
        const response = await sendMessageFunc({...sendMessageObj,message });
        if(response?.status==='error'){
            return res.status(400).json(response)
        }
        const NewChatLog = await ChatLogs.findOneAndUpdate(
          {
            senderNumber: number,
            instanceId: instance?.instance_id,
            eventId : campaign._id,
          },
          {
            $set: {
              messageTrack:  messageTrack,
              inviteStatus : updateContact.inviteStatus,
              updatedAt: Date.now(),
            }
          },
          {
            upsert: true, // Create if not found, update if found
            new: true // Return the modified document rather than the original
          }
        )
       
      }
    }

    // console.log('response', response.data)
    
    return res.status(201).send({message:'mesg sent'});
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.data });
  }
}


const sendMessageFunc = async (message, data = {}) => {
  const instance = await Instance.findOne({ instance_id: message.instance_id }).sort({ updatedAt: -1 });
  const contact = await Contact.findOne({ number: message.number, eventId: instance?.eventId?.toString() });

  message.message = reformText(message?.message, { contact });

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const graphURL = `${process.env.FB_API}/${phoneNumberId}/messages`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const results = [];

  try {
    // 🟩 CASE 1: Send media if exists
    if (message.media_url) {
      const mediaType = detectMediaType(message.media_url);
      const mediaPayload = {
        messaging_product: "whatsapp",
        to: message.number,
        type: mediaType,
        [mediaType]: { link: message.media_url }
      };

      console.log("📤 Sending media:", mediaPayload);
      const mediaRes = await axios.post(graphURL, mediaPayload, { headers });
      const mediaMessageId = mediaRes?.data?.messages?.[0]?.id;

      await saveMessage({
        message,
        text: message.message,
        media_url: message.media_url,
        messageId: mediaMessageId,
        instance,
      });

      results.push(mediaRes.data);
    }

    // 🟩 CASE 2: Send plain text message (not template)
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
        media_url: message.media_url,
        messageId: textMessageId,
        instance,
      });

      results.push(textRes.data);
    }

    console.log("✅ Message(s) sent to:", message.number);
    return results;
  } catch (error) {
    console.error("❌ Meta API send failed:", error.response?.data || error.message);
    if (contact) {
      contact.inviteStatus = "Failed";
      await contact.save();
    }
    return null;
  }
};

const sendTemplateFunc = async (message) => {
  const instance = await Instance.findOne({ instance_id: message.instance_id }).sort({ updatedAt: -1 });
  const contact = await Contact.findOne({ number: message.number, eventId: instance?.eventId?.toString() });
  const event = await Event.findById(instance?.eventId);

    
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const graphURL = `${process.env.FB_API}/${phoneNumberId}/messages`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  

  try {
    // 🟨 Build template components (parameters)
    const components = [];
    if (message.bindValues && Object.keys(message.bindValues).length > 0) {
      const parameters = Object.entries(message.bindValues).map(([key, value]) => ({
        type: "text",
        parameter_name: key,
        text: value
      }));

      components.push({ type: "body", parameters });
    }

    // 🟩 Construct payload
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

    console.log("📤 Sending template message:", JSON.stringify(payload, null, 2));
    const res = await axios.post(graphURL, payload, { headers });
    const messageId = res?.data?.messages?.[0]?.id;

    // 🟨 Construct display message (human-readable)
    let renderedText = message.template.templateText || "";
    if (message.bindValues) {
      Object.entries(message.bindValues).forEach(([key, value]) => {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
        renderedText = renderedText.replace(regex, value);
      });
    }

    await saveMessage({
      message,
      text: renderedText,
      template_name: message.template_name,
      bindValues: message.bindValues,
      messageId,
      instance,
    });

    console.log("✅ Template sent successfully to:", message.number);
    return res.data;
  } catch (error) {
    console.error("❌ Template send failed:", error.response?.data || error.message);
    if (contact) {
      contact.inviteStatus = "Failed";
      await contact.save();
    }
    return null;
  }
};

function detectMediaType(url) {
  const ext = url.split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "avi"].includes(ext)) return "video";
  if (["pdf", "doc", "docx", "xls", "xlsx"].includes(ext)) return "document";
  return "image";
}

async function saveMessage({ message, text, media_url, messageId, instance }) {
    console.log('here in vecna')
    console.log({ message, text, media_url, messageId, instance })
  const newMessage = new Message({
    senderNumber: message.number,
    instanceId: message.instance_id,
    fromMe: true,
    message: text,
    media_url,
    eventId: instance?.eventId,
    messageId,
    timeStamp: new Date()
  });
  await newMessage.save();
}

const reformText = (message, data)=>{
  const {contact, chatLog} = data;
console.log('message', message)
console.log('contact', contact)
  let mergedContact = {};
  
  if(contact){
    mergedContact = {...contact?.toObject()};
  }

  if(chatLog?.otherMessages){
    Object.entries(chatLog?.otherMessages).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        if (value?.name !== undefined) {
          mergedContact[key] = value.name;
        } else if (value.value !== undefined) {
          mergedContact[key] = value.value;
        }
      }
    });
  }

  function replacePlaceholders(message, data) {
    return message.replace(/{(\w+)}/g, (_, key) => data[key] || `{${key}}`);
  }
  
  return replacePlaceholders(message, mergedContact);
  
}

const getReport = async (req, res) => {
  const { fromDate, toDate } = req.query;
  const { eventId } = req.params
  let startDate, endDate;

  if (fromDate && toDate) {
    startDate = new Date(fromDate);
    endDate = new Date(toDate);
  }

    let query = [
    {
      $match: { eventId: eventId.toString(), }
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
                  { $eq: ['$eventId', '$$eventId'] }
                ]
              }
            }
          },
          { $sort: { createdAt: -1 } }, // Sort by date in descending order
          { $limit: 1 } // Take only the latest chatlog
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
        Name: '$name',
        PhoneNumber: { $toString: '$number' },
        invites: '$invites',
        'UpdatedAt': { $ifNull: [{ $dateToString: { format: '%Y-%m-%d %H:%M:%S', date: '$updatedAt' } }, ''] },

        Status: '$inviteStatus',
        finalResponse: 1,
        instanceId: 1,
        attendeesCount: 1
      }
    }
  ];

  try {
    const formatDate = (date) => {
      if (!date || isNaN(new Date(date).getTime())) {
        return ''; // Return blank if date is invalid
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

    let data = await Contact.aggregate(query);

    // console.log(data)

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

async function getReportdataByTime(startDate, endDate, id, eventId, rejectregex) {
  let dateFilter = {};
  if (startDate && endDate) {
    dateFilter = {
      "updatedAt": {
        $gte: new Date(startDate),
        $lt: new Date(endDate)
      }
    };
  }

  // console.log('instance', id)
  let query = [
    {
      $match: { eventId: eventId.toString(), }
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
                  { $eq: ['$eventId', '$$eventId'] }
                ]
              }
            }
          },
          { $sort: { createdAt: -1 } }, // Sort by date in descending order
          { $limit: 1 } // Take only the latest chatlog
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
        Name: '$name',
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

  try {
    const formatDate = (date) => {
      if (!date || isNaN(new Date(date).getTime())) {
        return ''; // Return blank if date is invalid
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

    let data = await Contact.aggregate(query);

    // console.log(data)

    data = data.map(ele => ({
      Name: ele.Name,
      'Phone Number': ele.PhoneNumber,
      Invites: ele.invites,
      'Updated At': formatDate(ele['UpdatedAt']),
      Status: ele.Status,
      'Last Response': ele.finalResponse,
      'Guest Count': ele.attendeesCount,
      'Host': ele?.instanceNumber
    }));

    const fileName = `Report-${Date.now()}.xlsx`;
    const filePath = `uploads/reports/${fileName}`;
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Report');
    xlsx.writeFile(wb, filePath);

    console.log(`XLSX file created successfully at ${filePath}`);

    return filePath;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function getFullReport(startDate, endDate, id, eventId, rejectregex) {
  let dateFilter = {};
  if (startDate && endDate) {
    dateFilter = {
      "updatedAt": {
        $gte: new Date(startDate),
        $lt: new Date(endDate)
      }
    };
  }

  // console.log('instance', id)
  let query = [
    {
      $match: { eventId: eventId.toString(), }
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
                  { $eq: ['$eventId', '$$eventId'] }
                ]
              }
            }
          },
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
        Name: '$name',
        PhoneNumber: { $toString: '$number' },
        invites: '$invites',
        'UpdatedAt': { $ifNull: [{ $dateToString: { format: '%Y-%m-%d %H:%M:%S', date: '$updatedAt' } }, ''] },

        Status: '$inviteStatus',
        finalResponse: 1,
        attendeesCount: 1
      }
    }
  ];

  try {
    const formatDate = (date) => {
      if (!date || isNaN(new Date(date).getTime())) {
        return ''; // Return blank if date is invalid
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

    let data = await Contact.aggregate(query);

    // console.log(data)

    data = data.map(ele => ({
      Name: ele.Name,
      'Phone Number': ele.PhoneNumber,
      Invites: ele.invites,
      'Updated At': formatDate(ele['UpdatedAt']),
      Status: ele.Status,
      'Last Response': ele.finalResponse,
      'Guest Count': ele.attendeesCount
    }));

    const fileName = `Report-${Date.now()}.xlsx`;
    const filePath = `uploads/reports/${fileName}`;
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Report');
    xlsx.writeFile(wb, filePath);

    console.log(`XLSX file created successfully at ${filePath}`);

    return filePath;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function getStats1(eventId, startDate, endDate) {
  try {
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lt: new Date(endDate)
      };
    }

    const statsByInstance = await Contact.aggregate([
      {
        $match: {
          eventId: eventId.toString(),
          ...dateFilter
        }
      },
      {
        $group: {
          _id: "$instanceNumber",
          totalContacts: { $sum: 1 },
          yes: {
            $sum: { $cond: [{ $eq: ["$inviteStatus", "Accepted"] }, 1, 0] }
          },
          no: {
            $sum: { $cond: [{ $eq: ["$inviteStatus", "Rejected"] }, 1, 0] }
          },
          balance: {
            $sum: { $cond: [{ $eq: ["$inviteStatus", "Pending"] }, 1, 0] }
          },
          guestCount: { $sum: { $toInt: "$attendeesCount" } }
        }
      }
    ]);

    const result = {};
    statsByInstance.forEach(stat => {
      result[stat._id] = {
        totalContacts: stat.totalContacts,
        yes: stat.yes,
        no: stat.no,
        balance: stat.balance,
        guestCount: stat.guestCount
      };
    });

    return result;
  } catch (error) {
    console.error("Error getting stats:", error);
    throw error;
  }
}

const fetchDashBoardStats = async(req, res)=>{
  const {eventId, instance_id} = req.body
  const instance = await Instance.findOne({_id:instance_id})
  const statsBody = await getStats1(eventId, instance, '','')
  return res.send(statsBody)
}

async function getNumbers(eventId) {  

  const noRegex = /\bno\b/i;

  try {
    // Fetch unique contacts with chat logs matching the criteria
    const uniqueContacts = await Contact.aggregate([
      {
        $group: {
          _id: '$number',
          uniqueContacts: { $first: '$$ROOT' }
        }
      },
      {
        $lookup: {
          from: 'chatlogs',
          let: { contactNumber: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$senderNumber', '$$contactNumber'] },
                    { $eq: ['$eventId', eventId.toString()] },
                  ].filter(Boolean)
                }
              }
            }
          ],
          as: 'chatlog'
        }
      },
      { $match: { 'chatlog.0': { $exists: true } } }
    ]);

    // Filter contacts based on the final response
    const yesContacts = uniqueContacts.filter(c => 
      c.chatlog.some(cl => cl.inviteStatus === 'Accepted')
    ).map(c => c._id);

    const noContacts = uniqueContacts.filter(c => 
      c.chatlog.some(cl => cl.inviteStatus === 'Rejected')
    ).map(c => c._id);

    const unresponsiveContacts = uniqueContacts.filter(c => 
      !c.chatlog.some(cl => cl.inviteStatus === 'Pending')
    ).map(c => c._id);

    return {
      yesContacts,
      noContacts,
      unresponsiveContacts
    };
  } catch (error) {
    console.error('Error fetching contacts:', error);
    throw error;
  }
}

const getEventWebhook = async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WP_VERIFY_TOKEN;
  // Check if a token and mode were sent
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // Respond with the challenge token from the request
      console.log('Webhook verified successfully!');
      return res.status(200).send(challenge);
    } else {
      // Respond with '403 Forbidden' if verify tokens do not match
      return res.sendStatus(403);
    }
  }else{
      return res.status(400).send({message:'No token or mode found'})
  }
};

const postEventWebhook = async (req, res) => {
  try {
    const body = req.body;

    // Log the request body safely
    console.log("📩 Received webhook event:", JSON.stringify(body, null, 2));

    // Validate object type
    if (body?.object !== "whatsapp_business_account") {
      return res.status(400).json({ message: "Invalid webhook object type" });
    }

    // Process entries
    for (const entry of body.entry || []) {
      const changes = entry?.changes || [];

      for (const change of changes) {
        const value = change?.value || {};
        const messages = value?.messages || [];
        const statuses = value?.statuses || [];
        const number = value?.metadata?.display_phone_number;
        const numberId = value?.metadata?.phone_number_id;
        const contacts = value?.contacts || [];

        // Process incoming messages
        for (const message of messages) {
          const contact = contacts.find(c => c.wa_id === message.from) || null;
          console.log("💬 New message received:", message);
          try {
            await handleMessageUpsert({...message, ...contact}, numberId);
          } catch (err) {
            console.error("❌ Error handling message upsert:", err);
          }
        }

        // Process status updates
        for (const status of statuses) {
          console.log("📡 New status update received:", status);
          try {
            await handleMessageUpdate(status, number, numberId);
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

const handleMessageUpdate = async (statuses, number, numberId) => {
  if (!Array.isArray(statuses)) return;

  console.log("📡 Processing message status updates");

  for (const statusObj of statuses) {
    const messageId = statusObj.id;
    const status = statusObj.status;
    const recipient = statusObj.recipient_id;
    const timeStamp = new Date(parseInt(statusObj.timestamp) * 1000);
    
    const message = await Message.findOneAndUpdate(
      { messageId },
      { $push: { messageStatus: { status, time: timeStamp } } }
    );


    
    // emitToInstance(recipient, "messageStatus-" + recipient, {
    //   messageId,
    //   status,
    //   time: timeStamp,
    // });
  }
};

const saveFileData = async (message) => {
  try {
    const type = message.type; // image, video, audio, document, sticker
    const media = message[type];
    if (!media?.id) {
      console.warn("⚠️ No media ID found in message");
      return null;
    }

    console.log('file message', message)
    const mediaId = media.id;
    const accessToken = process.env.WHATSAPP_TOKEN;

    // Step 1: Fetch media metadata
    const metaRes = await axios.get(
      `${process.env.FB_API}/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const meta = metaRes.data;
    console.log("📂 Media metadata:", meta);

    // Step 2: Download actual media
    const fileRes = await axios.get(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(fileRes.data, "binary");

    // Step 3: Save buffer locally
    const fs = require("fs");
    const path = require("path");
    const uploadsDir = path.join(__dirname, "../../uploads/downloads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const extension = meta.mime_type.split("/")[1] || "bin";
    const fileName = `${mediaId}.${extension}`;
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, buffer);

    // Step 4: Build URL for serving
    const fileUrl = `${process.env.IMAGE_URL}uploads/downloads/${fileName}`;

    // Step 5: Map fileSchema fields properly
    const fileData = {
      url: fileUrl,
      mediaName: message?.document?.filename || 'file-'+fileName,
      mimetype: meta.mime_type,
      filetype: type,
      caption: media.caption || null,
      fileSha256: meta.sha256,
      fileLength: meta.file_size || buffer.length,
      path: filePath,
      jpegThumbnail: media?.jpeg_thumbnail || null, // if WhatsApp provides it
      mediaKey: media?.media_key || null,
      fileEncSha256: media?.file_enc_sha256 || null,
      mediaKeyTimestamp: media?.media_key_timestamp || null,
      height: media?.height || null,
      width: media?.width || null,
      seconds: media?.seconds || null,
      streamingSidecar: media?.streaming_sidecar || null,
      contextInfo: media?.context_info || null,
    };

    console.log("📝 fileData to save:", fileData);

    const savedFile = await File.create(fileData);
    console.log("✅ File saved:", savedFile);

    return savedFile;
  } catch (error) {
    console.error("❌ Error saving file data:", error?.response?.data || error);
    return null;
  }
};

const handleMessageUpsert = async (message, numberId) => {
  try {
    if (!message) return;

    console.log("➡️ Processing new message:", message);

    const number = message.from; // e.g. "918058909535"
    const messageId = message.id;
    const timeStamp = new Date(parseInt(message.timestamp) * 1000); // WhatsApp timestamp is in seconds
    const type = message.type;
    const fromMe = false; // all webhook messages are incoming from customer
    const textMessage = message?.text?.body || "";

    // Handle media if present
    let fileData = null;
    if (["image", "video", "audio", "document", "sticker"].includes(type)) {
      try {
        fileData = await saveFileData(message); // you will need to adapt saveFileData for WhatsApp Cloud API payload
        console.log('fileData', fileData)
      } catch (err) {
        console.error("❌ Error saving media file:", err);
      }
    }

    // Prepare contact update
    const pushName = message?.profile?.name || "Unknown"; // not always provided
    const updateFields = {
      lastMessage: textMessage || fileData?.caption || fileData?.filetype || "",
      lastMessageAt: timeStamp,
      pushName,
      numberId,
    };

    // Find or create contact
    const contact = await Contact.findOneAndUpdate(
      { number },
      { $set: updateFields },
      { new: true, upsert: true }
    );

    // Ensure at least one receiver is assigned
    let receivers = await Participation.find({ contactId: contact._id });

    // Store message in DB
    const newMessage = await Message.findOneAndUpdate(
      { messageId },
      {
        $set: {
          number,
          fromMe,
          numberId,
          message: textMessage || fileData?.caption || "",
          messageId,
          timeStamp,
          messageStatus: [{ status: fromMe ? "2" : "3", time: new Date() }],
          type: fileData ? "media" : "text",
          fileType: fileData?.filetype,
          mimetype: fileData?.mimetype,
          fileSize: fileData?.fileLength,
          fileLength: fileData?.seconds,
          fileId: fileData?._id,
          mediaUrl: fileData?.url,
          mediaOriginalName: fileData?.mediaName,
          sentBy: fromMe ? "admin" : "customer",
          sendByName: pushName,
          sentById: contact?._id,
        },
      },
      { new: true, upsert: true }
    );
    

    // Emit socket events
    // await Promise.all(
    //   receivers.map(async (receiver) => {
    //     emitToInstance(receiver?.eventId, "message-" + number, newMessage);
    //     emitToInstance(receiver?.eventId, "contactUpdated", contact);
    //   })
    // );
    
    const payload = {
        name: pushName,
        user_id: number,
        message: textMessage || fileData?.caption
    }
    
    if(fileData){
        payload['file'] = fileData?.url;
    }
    
    const aiResponse = await axios.post(
      `${process.env.LLM_API}/whatsapp_izan`, null,     
      {params: payload}
    );
    
    console.log('aiResponse', aiResponse)
    await sendMessage(number, aiResponse.data.output_message, numberId);
    
    return {message:'Message recieved'}
  } catch (err) {
    console.error("🔥 Error in handleMessageUpsert:", err);
  }
};

const handleContactUpdate = async (contacts, eventId) => {
    if (!Array.isArray(contacts)) return;
    console.log('contact.update')
    for (const contact of contacts) {
        const { id, notify } = contact;
        const number = id.replace('@s.whatsapp.net', ''); 

        const existingContact = await Contact.findOne({ number });

        if (!existingContact) {
            await Contact.create({
                pushName: notify || 'Unknown',
                number,
                instanceId
            });
        }
        // Emit event to update contact list in frontend
        emitToInstance(eventId, "contactUpdated", existingContact);
    }
};

function buildMessageObject(message) {
  const msg = {};

  // 🧩 Handle different types
  if (message.text) {
    msg.conversation = message.text.body;
  } else if (message.image) {
    msg.imageMessage = {
      caption: message.image.caption || "",
      mimetype: message.image.mime_type || "image/jpeg",
      url: message.image.url,
      fileLength: message.image.file_size || 0,
    };
  } else if (message.document) {
    msg.documentMessage = {
      caption: message.document.caption || "",
      mimetype: message.document.mime_type,
      url: message.document.url,
      fileName: message.document.filename,
    };
  } else if (message.video) {
    msg.videoMessage = {
      caption: message.video.caption || "",
      mimetype: message.video.mime_type,
      url: message.video.url,
      fileLength: message.video.file_size || 0,
    };
  } else if (message.audio) {
    msg.audioMessage = {
      mimetype: message.audio.mime_type,
      url: message.audio.url,
      fileLength: message.audio.file_size || 0,
    };
  } else if (message.button) {
      msg.conversation = message.button?.text
  } 
  else {
    msg.extendedTextMessage = {
      text: "[Unsupported message type]",
    };
  }

  return msg;
}

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
  postEventWebhook
};
