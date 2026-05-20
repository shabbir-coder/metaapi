// routes/userRoutes.js
const express = require('express');
const chatsController = require('../controllers/chats.controller');

const chatsV2Controller = require('../controllers/chatV2.controller');
const { authenticateToken } = require('../middlewares/auth');
const multer = require('multer');


const router = express.Router();

// Set up storage strategy for Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, './uploads/') // make sure this folder exists
    },
    filename: function (req, file, cb) {
      // You can use the original name or add a timestamp for uniqueness
      cb(null, Date.now() + '-' + file.originalname.trim().replaceAll(' ',''))
    }
  });
  const upload = multer({ storage: storage });


// Get user by ID route
router.post('/saveContact', authenticateToken, chatsV2Controller.saveContact);

router.post('/saveBulk', authenticateToken, upload.single('file'), chatsV2Controller.saveContactsInBulk);

router.post('/updateContact/:id', chatsV2Controller.updateContacts);

router.get('/getContacts', chatsV2Controller.getContact);

router.post('/getMessages', chatsV2Controller.getMessages);

router.post('/sendMessage', authenticateToken, chatsV2Controller.sendMessages);

router.post('/sendBulkMessage', authenticateToken, chatsV2Controller.sendBulkMessage);

router.get('/getreport/:eventId', chatsV2Controller.getReport);

// ==================== REPORT ROUTES ====================

// Report 1: Invite Status Summary (Accepted, Rejected, Pending, Failed)
router.get('/reports/:eventId/invite-status', chatsV2Controller.getInviteStatusReport);

// Report 2: Message Status Report (Sent, Delivered, Read, Unanswered)
// Optional query param: ?template=template_name (to filter by specific template)
router.get('/reports/:eventId/message-status', chatsV2Controller.getMessageStatusReport);

// Report 3: Template Message Report (Template-specific stats)
router.get('/reports/:eventId/template-messages', chatsV2Controller.getTemplateMessageReport);

// Report 4: Detailed Contact Report (All contact details with message info)
router.get('/reports/:eventId/detailed-contacts', chatsV2Controller.getDetailedContactReport);

// Report 5: Detailed fetch dashboard stats)
router.post('/stats', authenticateToken, chatsV2Controller.fetchDashBoardStats);


router.get('/webhookEvent', chatsV2Controller.getEventWebhook);
router.post('/webhookEvent', chatsV2Controller.postEventWebhook);

router.post('/uploadPicture', upload.single('picture'), (req, res) => {
    if (!req.file) {
      return res.status(400).send({ message: 'Please upload a file.' });
    }

    res.status(200).send({
      message: 'File uploaded successfully.',
      filePath: req.file.path
    });
  });

module.exports = router;
