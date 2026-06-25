'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const { readConfig }    = require('../lib/configStore');
const { triggerDeploy } = require('./deploy');

// ── POST /api/webhook/deploy/:profile ─────────────────────────────────────────
// Triggers a deployment for the named profile. Authenticated with a per-profile
// Bearer token set via POST /api/profiles/:profile/webhook-token.
//
// Example GitHub Actions usage:
//   curl -X POST https://your-wdp-host/api/webhook/deploy/production \
//        -H "Authorization: Bearer ${{ secrets.WDP_TOKEN }}"
router.post('/deploy/:profile', async (req, res) => {
  const { profile } = req.params;

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing Bearer token.' });

  try {
    const config      = await readConfig();
    const profileData = config.profiles?.[profile];
    if (!profileData) return res.status(404).json({ error: 'Profile not found.' });

    if (!profileData.webhookToken) {
      return res.status(403).json({ error: 'Webhook not configured for this profile. Generate a token first.' });
    }

    // Constant-time comparison — prevents timing-based token enumeration
    const supplied = Buffer.from(token);
    const expected = Buffer.from(profileData.webhookToken);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(403).json({ error: 'Invalid token.' });
    }

    const deployId = await triggerDeploy(profile);
    res.json({ success: true, deployId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
