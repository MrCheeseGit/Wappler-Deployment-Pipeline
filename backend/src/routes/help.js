'use strict';

const express = require('express');
const { listHelpDocs, readHelpDoc } = require('../lib/helpDocs');

const router = express.Router();

// GET /api/help/docs
router.get('/docs', (_req, res) => {
  res.json({ docs: listHelpDocs() });
});

// GET /api/help/docs/:slug
router.get('/docs/:slug', (req, res) => {
  try {
    const doc = readHelpDoc(req.params.slug);
    res.json(doc);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
