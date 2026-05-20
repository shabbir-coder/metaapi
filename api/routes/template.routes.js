const express = require('express');
const router = express.Router();
const templateMastersController = require('../controllers/template.controller');

// Get all templates
router.get('/', templateMastersController.getAllTemplates);

// Get template by ID
router.get('/:id', templateMastersController.getTemplateById);

// Create new template
router.post('/', templateMastersController.createTemplate);

// Update template
router.put('/:id', templateMastersController.updateTemplate);

// Delete template
router.delete('/:id', templateMastersController.deleteTemplate);

module.exports = router;