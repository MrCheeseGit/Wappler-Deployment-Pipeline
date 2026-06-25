'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { WebSocketServer } = require('ws');

const authRoutes      = require('./routes/auth');
const configRoutes    = require('./routes/config');
const generateRoutes  = require('./routes/generate');
const deployRoutes    = require('./routes/deploy');
const profilesRoutes  = require('./routes/profiles');
const gitRoutes       = require('./routes/git');
const fsRoutes        = require('./routes/fs');
const aiRoutes        = require('./routes/ai');
const knowledgeRoutes = require('./routes/knowledge');
const serverRoutes    = require('./routes/server');
const appRoutes       = require('./routes/app');
const helpRoutes      = require('./routes/help');
const webhookRoutes   = require('./routes/webhook');
const { requireAuth } = require('./middleware/auth');
const deployManager   = require('./lib/deployManager');
const terminalManager = require('./lib/terminalManager');

const {
  loadOrCreateSessionSecret,
  SESSION_MS_DEFAULT,
  SESSION_TTL_SECONDS,
} = require('./lib/sessionAuth');

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_SECRET = loadOrCreateSessionSecret();
const SESSION_DIR = process.env.SESSION_DIR || '/data/sessions';

// Ensure session directory exists before FileStore initialises
fs.mkdirSync(SESSION_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);

app.use(express.json());

const sessionMiddleware = session({
  store: new FileStore({ path: SESSION_DIR, ttl: SESSION_TTL_SECONDS, retries: 0, logFn: () => {} }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'wdp.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    maxAge: SESSION_MS_DEFAULT,
  },
});

app.use(sessionMiddleware);

// Public routes — no authentication required
app.use('/api/auth',    authRoutes);
app.use('/api/webhook', webhookRoutes); // webhook auth is token-based, not session

// Protected API routes
app.use('/api/config',    requireAuth, configRoutes);
app.use('/api/generate',  requireAuth, generateRoutes);
app.use('/api/deploy',    requireAuth, deployRoutes);
app.use('/api/profiles',  requireAuth, profilesRoutes);
app.use('/api/git',       requireAuth, gitRoutes);
app.use('/api/fs',        requireAuth, fsRoutes);
app.use('/api/ai',        requireAuth, aiRoutes);
app.use('/api/knowledge', requireAuth, knowledgeRoutes);
app.use('/api/server',    requireAuth, serverRoutes);
app.use('/api/app',       requireAuth, appRoutes);
app.use('/api/help',      requireAuth, helpRoutes);

// Serve built SvelteKit frontend (production / Docker only)
const FRONTEND_BUILD = process.env.FRONTEND_BUILD || path.join(__dirname, '../frontend/build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_BUILD, 'index.html'));
  });
}

// WebSocket upgrade — validate session before accepting the connection
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  sessionMiddleware(req, {}, () => {
    if (!req.session || !req.session.userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
});

wss.on('connection', (ws, req) => {
  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'deploy_subscribe':
        deployManager.subscribe(msg.deployId, ws);
        break;

      case 'terminal_open':
        terminalManager.open(ws, msg.profile, msg.cols, msg.rows);
        break;

      case 'terminal_input':
        terminalManager.input(ws, msg.data);
        break;

      case 'terminal_resize':
        terminalManager.resize(ws, msg.cols, msg.rows);
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    deployManager.unsubscribe(ws);
    terminalManager.close(ws);
  });
});

const { initDockerConnectivity, wapplerCoexistenceHint, describeDockerMode } = require('./lib/dockerHost');

server.listen(PORT, HOST, async () => {
  console.log(`[WDP] Backend listening on ${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.warn(
      '[WDP] WARNING: Bound to 0.0.0.0 — ensure port is firewalled or placed behind a ' +
      'reverse proxy with access controls. The UI must never be publicly reachable without authentication.'
    );
  }
  try {
    await initDockerConnectivity();
    const mode = describeDockerMode();
    console.log(`[WDP] Docker: ${mode.dockerHost} (${mode.mode})`);
  } catch (err) {
    console.warn('[WDP] Docker init:', err.message || err);
  }
  const hint = wapplerCoexistenceHint();
  if (hint) console.log(`[WDP] ${hint}`);
});
