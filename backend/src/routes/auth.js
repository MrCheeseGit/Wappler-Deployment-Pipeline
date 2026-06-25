'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { readConfig, writeConfig } = require('../lib/configStore');
const { applySessionDuration } = require('../lib/sessionAuth');

// GET /api/auth/status
// Returns setup state, auth state, and whether the server is on a public binding.
router.get('/status', async (req, res) => {
  try {
    const config = await readConfig();
    const needsSetup = !config.auth || !config.auth.passwordHash;
    const isAuthenticated = !!req.session.userId;
    const isPublicBinding = (process.env.HOST || '0.0.0.0') === '0.0.0.0';
    res.json({ needsSetup, isAuthenticated, isPublicBinding });
  } catch (err) {
    res.status(500).json({ message: 'Failed to read configuration.' });
  }
});

// POST /api/auth/setup
// First-run only — creates the admin account. Rejected if setup is already done.
router.post('/setup', async (req, res) => {
  try {
    const config = await readConfig();
    if (config.auth && config.auth.passwordHash) {
      return res.status(400).json({ message: 'Setup has already been completed.' });
    }

    const { username, password } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters.' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    config.auth = { username: username.trim(), passwordHash };
    await writeConfig(config);

    applySessionDuration(req, req.body?.rememberMe === true);
    req.session.userId = username.trim();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Setup failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const config = await readConfig();
    if (!config.auth || !config.auth.passwordHash) {
      return res.status(400).json({ message: 'Setup has not been completed.' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    // Always run bcrypt compare to equalise timing and prevent username enumeration
    const hashToCompare = config.auth.username === username
      ? config.auth.passwordHash
      : '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123a';

    const valid = await bcrypt.compare(password, hashToCompare);

    if (!valid || config.auth.username !== username) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    applySessionDuration(req, req.body?.rememberMe === true);
    req.session.userId = username;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed.' });
    }
    res.clearCookie('wdp.sid');
    res.json({ ok: true });
  });
});

// ── User profile ──────────────────────────────────────────────────────────────

// GET /api/auth/profile
router.get('/profile', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'Not authenticated.' });
  try {
    const config = await readConfig();
    const {
      username,
      email = '',
      mobile = '',
      dialingCode = '+44',
      locale = 'en',
    } = config.auth || {};
    res.json({ username, email, mobile, dialingCode, locale });
  } catch (err) {
    res.status(500).json({ message: 'Failed to read profile.' });
  }
});

// POST /api/auth/locale — persist UI language for SMS and future localised messages
router.post('/locale', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'Not authenticated.' });
  const { locale } = req.body || {};
  if (!locale || !['en', 'pt', 'es', 'de', 'nl'].includes(locale)) {
    return res.status(400).json({ message: 'Unsupported locale.' });
  }
  try {
    const config = await readConfig();
    config.auth = config.auth || {};
    config.auth.locale = locale;
    await writeConfig(config);
    res.json({ ok: true, locale });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save locale.' });
  }
});

// POST /api/auth/profile
// Updates contact details (email, mobile, dialingCode). Username is immutable.
router.post('/profile', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'Not authenticated.' });
  try {
    const { email = '', mobile = '', dialingCode = '+44', locale } = req.body;

    if (email && typeof email === 'string') {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(email.trim())) {
        return res.status(400).json({ message: 'Invalid email address.' });
      }
    }
    if (mobile && typeof mobile === 'string' && !/^\d{0,15}$/.test(mobile.trim())) {
      return res.status(400).json({ message: 'Mobile number must contain digits only (max 15).' });
    }

    const config = await readConfig();
    config.auth.email       = typeof email      === 'string' ? email.trim()       : '';
    config.auth.mobile      = typeof mobile     === 'string' ? mobile.trim()      : '';
    config.auth.dialingCode = typeof dialingCode === 'string' ? dialingCode.trim() : '+44';
    if (typeof locale === 'string' && ['en', 'pt', 'es', 'de', 'nl'].includes(locale)) {
      config.auth.locale = locale;
    }
    await writeConfig(config);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save profile.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'Not authenticated.' });
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new passwords are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    const config = await readConfig();
    const valid = await bcrypt.compare(currentPassword, config.auth.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    config.auth.passwordHash = await bcrypt.hash(newPassword, 12);
    await writeConfig(config);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to change password.' });
  }
});

module.exports = router;
