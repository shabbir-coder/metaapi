const express = require('express');
const eventController = require('../controllers/event.controller');
const chatsController = require('../controllers/chats.controller');
const chatsV2Controller = require('../controllers/chatV2.controller');

const router = express.Router();

router.get('/event/:id', eventController.getEventById);
router.get('/getContacts', chatsV2Controller.getContact);
router.post('/getMessages', chatsV2Controller.getMessages);
router.post('/stats', chatsV2Controller.fetchDashBoardStats);

module.exports = router;
