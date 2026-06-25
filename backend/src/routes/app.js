'use strict';

const express = require('express');
const { checkForUpdates, dismissUpdateReminder, readCurrentVersion } = require('../lib/appVersion');

const router = express.Router();

// GET /api/app/version?force=1
router.get('/version', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const info = await checkForUpdates({ force });
    res.json(info);
  } catch (err) {
    res.status(500).json({
      current: readCurrentVersion(),
      updateAvailable: false,
      checkError: err.message,
    });
  }
});

// POST /api/app/dismiss-update  body: { days?: number }
router.post('/dismiss-update', async (req, res) => {
  try {
    const days = req.body?.days;
    const result = await dismissUpdateReminder(days);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
