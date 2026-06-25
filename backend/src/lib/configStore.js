'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/wdp-config.json';
const DATA_DIR = path.dirname(CONFIG_PATH);

function ensureDataDir() {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

async function readConfig() {
  ensureDataDir();
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

async function writeConfig(data) {
  ensureDataDir();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { readConfig, writeConfig };
