const axios = require('axios');
const Instance = require('../models/instanceModel')
const mongoose = require('mongoose');
const {Message, Contact, ChatLogs} = require('../models/chatModel');


exports.createQr = async (req, res) => {
  try {
      const url = process.env.LOGIN_CB_API
      const access_token = process.env.ACCESS_TOKEN_CB
      const createInstanceResponse = await axios.get(`${url}/create_instance`, {params:
      {access_token}
    })

    const instanceId = createInstanceResponse.data.instance_id;
     if(createInstanceResponse.data.status==='error'){
      return res.status(400).json({
        message:'error',
        data: createInstanceResponse.data,
      })
    }
    if (!instanceId) {
      throw new Error('Instance ID not found in the create instance response');
    }

    // Call the second API to get the QR Code, using the instanceId from the first call's response
    const getQrCodeResponse = await axios.get(`${url}/get_qrcode?instance_id=${instanceId}&access_token=${access_token}`);
    if(getQrCodeResponse.data.status==='error'){
      return res.status(400).json({
        message:'error',
        data: getQrCodeResponse.data,
      })
    }
    return res.status(200).json({
      message:'success',
      data: getQrCodeResponse.data,
      instance_id: instanceId,
      access_token: process.env.ACCESS_TOKEN_CB
    })

    } catch (error) {
      console.log(error)
      
      return res.status(500).json({ status:'error', error });
    }
  };

exports.setWebhook = async (req, res)=>{
  try {
    const url = process.env.LOGIN_CB_API;
    const instance_id = req.params.id;
    let enable = true;
    let webhook_url = process.env.WEBHOOK_API;
    const access_token = process.env.ACCESS_TOKEN_CB
    const result = await axios.get(`${url}/set_webhook`, {params:{
      webhook_url, enable, instance_id, access_token
    }})
    return res.status(200).json(result.data)
    
  } catch (error) {
    console.log(error)
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

exports.createInstance = async (req, res)=>{
  try {

    req.body['isActive'] = true;
    req.body['isVerified'] = true;
    
    req.body['createdBy'] = req.user.userId;

    const instance = new Instance(req.body);
    await instance.save();
    return res.status(201).send(instance);
    
  } catch (error) {
    console.log(error)
    return res.status(500).json({error: 'Internal Server Error'});
  }
};

exports.listAll = async (req, res)=>{
  try {

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const items = await Instance.find()
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(limit);

    const totalItems = await Instance.countDocuments();

    res.send({
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
      totalItems,
      data: items,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).send(error);
  }
};
 
exports.getByNumber = async (req, res)=>{
  try {

    const {instance_id} = req.params
    
    const items = await Instance.findOne({instance_id})

    res.send({
      data: items,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).send(error);
  }
};
  

exports.getQr = async (req, res)=>{
  try {
    
    const url = process.env.LOGIN_CB_API
    const access_token = process.env.ACCESS_TOKEN_CB
    const { instanceId } = req.params;

    const getQrCodeResponse = await axios.get(`${url}/get_qrcode?instance_id=${instanceId}&access_token=${access_token}`);

    return res.status(200).json({
      message:'success',
      data: getQrCodeResponse.data,
      instance_id: instanceId
    })

  } catch (error) {
    console.log(error)
    return res.status(400).send(error);

  }
};

exports.updateInstance = async (req, res)=>{
  try {
    const { instanceId } = req.params; // this is _id of Instance

    // Step 1: Fetch the old instance first
    const oldInstance = await Instance.findById(instanceId);
    if (!oldInstance) {
      return res.status(404).send({ message: 'Instance not found' });
    }
    const oldInstanceId = oldInstance.instance_id;

    // Step 2: Update instance with new data
    const item = await Instance.findByIdAndUpdate(
      instanceId,
      req.body,
      { new: true }
    );


    if (Object.keys(updateFields).length > 0) {
      await Instance.findByIdAndUpdate(item._id, { $set: updateFields });
      Object.assign(item, updateFields); // merge for response
    }

    // Step 5: If instance_id changed, propagate to related collections
    if (req.body.instance_id && req.body.instance_id !== oldInstanceId) {
      const newInstanceId = req.body.instance_id;

      const [contactsRes, chatLogsRes, messagesRes] = await Promise.all([
        Participation.updateMany({ instanceId: oldInstanceId }, { $set: { instanceId: newInstanceId, instanceNumber: item.number } }),
        ChatLogs.updateMany({ instanceId: oldInstanceId }, { $set: { instanceId: newInstanceId } }),
        Message.updateMany({ instanceId: oldInstanceId }, { $set: { instanceId: newInstanceId } })
      ]);

      return res.send({
        ...item.toObject(),
        propagation: {
          contactsUpdated: contactsRes.modifiedCount,
          chatLogsUpdated: chatLogsRes.modifiedCount,
          messagesUpdated: messagesRes.modifiedCount
        }
      });
    }

    return res.send(item);
  } catch (error) {
    console.error(error);
    return res.status(400).send(error);
  }

};

exports.deleteInstance = async (req, res)=>{
  const id = req.params.id;

  // Validate the ID format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  try {
    // Find the document by ID and delete it
    const deletedDoc = await Instance.findByIdAndDelete(id);

    // If the document does not exist
    if (!deletedDoc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Send a success response
    res.status(200).json({ message: 'Document deleted successfully', deletedDoc });
  } catch (error) {
    // Handle any errors
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}