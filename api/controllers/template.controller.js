// controllers/templateMasters.controller.js
const {TemplateMasters} = require('../models/event.Model');

// Get all templates
exports.getAllTemplates = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      category, 
      languageCode, 
      instanceId,
      currentEventId 
    } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (languageCode) filter.languageCode = languageCode;
    if (instanceId) filter.instanceId = instanceId;
    if (currentEventId) filter.currentEventId = currentEventId;

    const skip = (page - 1) * limit;

    const templates = await TemplateMasters.find(filter)
      .limit(parseInt(limit))
      .skip(skip)
      .sort({ createdAt: -1 });

    const total = await TemplateMasters.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: templates,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching templates',
      error: error.message
    });
  }
};

// Get template by ID
exports.getTemplateById = async (req, res) => {
  try {
    const template = await TemplateMasters.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    res.status(200).json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching template',
      error: error.message
    });
  }
};

// Create new template
exports.createTemplate = async (req, res) => {
  try {
    const template = new TemplateMasters(req.body);
    const savedTemplate = await template.save();

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: savedTemplate
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating template',
      error: error.message
    });
  }
};

// Update template
exports.updateTemplate = async (req, res) => {
  try {
    const template = await TemplateMasters.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Template updated successfully',
      data: template
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating template',
      error: error.message
    });
  }
};

// Delete template
exports.deleteTemplate = async (req, res) => {
  try {
    const template = await TemplateMasters.findByIdAndDelete(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Template deleted successfully',
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting template',
      error: error.message
    });
  }
};