/**
 * AI settings + chat proxy routes
 *
 * GET  /api/ai/settings          — returns { model, hasKey } (key never sent to client)
 * POST /api/ai/settings          — saves { apiKey?, model? } to wdp-config.json
 * DELETE /api/ai/settings/key    — clears the stored API key
 * POST /api/ai/chat              — proxies a chat request to OpenRouter, streams SSE
 *
 * All routes are requireAuth-protected (registered in server.js).
 */

const express  = require('express');
const https    = require('https');
const path     = require('path');
const fs       = require('fs');
const { readConfig, writeConfig } = require('../lib/configStore');

const router = express.Router();

const DEFAULT_MODEL   = 'minimax/minimax-m2.7';
const OPENROUTER_HOST = 'openrouter.ai';
const OPENROUTER_PATH = '/api/v1/chat/completions';

// ── Build the locked system prompt ───────────────────────────────────────────
function buildSystemPrompt(config, profile) {
  // Load knowledge.md for the profile if it exists
  let knowledgeContext = '';
  if (profile) {
    const pConfig = config.profiles?.[profile];
    if (pConfig?.projectPath) {
      const mdPath = path.join(pConfig.projectPath, 'wdp', profile, 'knowledge.md');
      if (fs.existsSync(mdPath)) {
        try { knowledgeContext = fs.readFileSync(mdPath, 'utf8'); } catch { /* skip */ }
      }
    }
  }

  const profileList = Object.keys(config.profiles || {}).join(', ') || 'none';

  return [
    `You are WDP Assistant — an AI assistant built into the Wappler Deployment Pipeline (WDP) tool.`,
    ``,
    `YOUR SOLE PURPOSE is to help the user with:`,
    `- Their WDP deployment profiles and configuration`,
    `- Docker, Docker Compose, and container deployment questions`,
    `- Traefik reverse proxy and SSL/TLS setup`,
    `- SSH connectivity and server provisioning`,
    `- Wappler project structure and how it relates to deployment`,
    `- Errors and logs shown in the WDP deploy panel`,
    `- The project described in the knowledge base below (if available)`,
    ``,
    `STRICT RULES — you MUST follow these without exception:`,
    `1. NEVER answer questions unrelated to this application, its deployments, or the project knowledge below.`,
    `2. If asked about anything outside this scope (general web searches, news, other products, personal advice, etc.), respond ONLY with: "I can only help with WDP deployments and your project configuration."`,
    `3. NEVER pretend to browse the web, search the internet, or retrieve external information.`,
    `4. Base all answers strictly on: the user's question, the profile config context, and the knowledge base below.`,
    `5. If you don't know something from the available context, say so — do not guess or invent facts.`,
    ``,
    `CURRENT WDP CONTEXT:`,
    `- Available profiles: ${profileList}`,
    profile ? `- Active profile: ${profile}` : `- No profile selected`,
    ``,
    knowledgeContext
      ? `PROJECT KNOWLEDGE BASE:\n${knowledgeContext}`
      : `(No knowledge base generated yet for this profile. User can generate one from the Knowledge tab.)`,
  ].join('\n');
}

// ── GET /api/ai/settings ──────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const config = await readConfig();
    const ai     = config.ai || {};
    res.json({
      model:  ai.model  || DEFAULT_MODEL,
      hasKey: !!ai.apiKey,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ai/settings ─────────────────────────────────────────────────────
router.post('/settings', async (req, res) => {
  try {
    const { apiKey, model } = req.body || {};
    const config = await readConfig();
    config.ai = config.ai || {};

    if (typeof apiKey === 'string') {
      config.ai.apiKey = apiKey.trim();
    }
    if (typeof model === 'string' && model.trim()) {
      config.ai.model = model.trim();
    }

    await writeConfig(config);
    res.json({ ok: true, model: config.ai.model || DEFAULT_MODEL, hasKey: !!config.ai.apiKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/ai/settings/key ───────────────────────────────────────────────
router.delete('/settings/key', async (req, res) => {
  try {
    const config = await readConfig();
    if (config.ai) delete config.ai.apiKey;
    await writeConfig(config);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
// Body: { messages: [{role, content}], profile?: string }
// Streams SSE: data: <json>\n\n  where json = { delta: string } | { done: true } | { error: string }
router.post('/chat', async (req, res) => {
  try {
    const config = await readConfig();
    const ai     = config.ai || {};

    if (!ai.apiKey) {
      return res.status(402).json({ error: 'No OpenRouter API key configured.' });
    }

    const model   = ai.model || DEFAULT_MODEL;
    const profile = req.body.profile || null;

    // Strip any system-role messages from the client — we control the system prompt entirely
    const userMessages = (req.body.messages || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 32000) }));

    if (!userMessages.length) {
      return res.status(400).json({ error: 'No messages provided.' });
    }

    // Always inject our locked system prompt as the first message
    const messages = [
      { role: 'system', content: buildSystemPrompt(config, profile) },
      ...userMessages,
    ];

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const body = JSON.stringify({
      model,
      messages,
      stream: true,
    });

    const options = {
      hostname: OPENROUTER_HOST,
      path:     OPENROUTER_PATH,
      method:   'POST',
      headers: {
        'Authorization':   `Bearer ${ai.apiKey}`,
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(body),
        'HTTP-Referer':    'https://wdp.local',
        'X-Title':         'Wappler Deployment Pipeline',
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let buffer = '';

      proxyRes.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            sendEvent({ done: true });
            return;
          }
          try {
            const parsed = JSON.parse(payload);
            const delta  = parsed.choices?.[0]?.delta?.content;
            if (delta) sendEvent({ delta });
          } catch { /* malformed SSE chunk — skip */ }
        }
      });

      proxyRes.on('end', () => {
        sendEvent({ done: true });
        res.end();
      });
    });

    proxyReq.on('error', (err) => {
      sendEvent({ error: err.message });
      res.end();
    });

    proxyReq.write(body);
    proxyReq.end();

    // If client disconnects, abort the upstream request
    req.on('close', () => proxyReq.destroy());

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

module.exports = router;
