/**
 * Knowledge generation routes
 *
 * GET  /api/knowledge/:profile        — returns existing knowledge files (if any)
 * POST /api/knowledge/:profile/generate — walk project files, call LLM, stream SSE progress,
 *                                         write knowledge.md + knowledge.json
 * DELETE /api/knowledge/:profile       — removes knowledge files
 *
 * All routes are requireAuth-protected.
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const { readConfig, writeConfig } = require('../lib/configStore');

const router = express.Router();

// ── File walker ───────────────────────────────────────────────────────────────

const INCLUDE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.yaml', '.yml', '.env', '.env.example',
  '.md', '.txt', '.sh',
  '.svelte', '.vue', '.html', '.css',
  '.sql', '.prisma',
]);

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.svelte-kit', 'dist', 'build',
  'coverage', '.nyc_output', '__pycache__', '.next', '.nuxt',
  'out', 'tmp', '.turbo', 'wdp',
]);

const MAX_FILE_BYTES = 64 * 1024;   // 64 KB per file
const MAX_TOTAL_CHARS = 400_000;    // ~100k tokens

function walkDir(dir, base, extraDirs = []) {
  const results = [];

  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!INCLUDE_EXTS.has(ext) && !INCLUDE_EXTS.has(entry.name)) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_BYTES) return;
          results.push({ path: path.relative(base, fullPath), fullPath });
        } catch { /* skip */ }
      }
    }
  }

  walk(dir);
  for (const extra of extraDirs) {
    if (fs.existsSync(extra) && fs.statSync(extra).isDirectory()) walk(extra);
  }

  return results;
}

function buildContext(files, base) {
  let total = 0;
  const parts = [];

  for (const file of files) {
    if (total >= MAX_TOTAL_CHARS) break;
    try {
      const content = fs.readFileSync(file.fullPath, 'utf8');
      const chunk   = `\n\n### File: ${file.path}\n\`\`\`\n${content}\n\`\`\``;
      if (total + chunk.length > MAX_TOTAL_CHARS) continue;
      parts.push(chunk);
      total += chunk.length;
    } catch { /* skip unreadable */ }
  }

  return { context: parts.join(''), fileCount: parts.length, charCount: total };
}

// ── GET /api/knowledge/:profile ───────────────────────────────────────────────
router.get('/:profile', async (req, res) => {
  const profile = path.basename(req.params.profile);
  try {
    const config  = await readConfig();
    const pConfig = config.profiles?.[profile];
    if (!pConfig?.projectPath) return res.status(404).json({ error: 'Profile not found.' });

    const outDir  = path.join(pConfig.projectPath, 'wdp', profile);
    const mdPath  = path.join(outDir, 'knowledge.md');
    const jsonPath = path.join(outDir, 'knowledge.json');

    const result = { exists: false };

    if (fs.existsSync(mdPath)) {
      result.exists        = true;
      result.knowledgeMd   = fs.readFileSync(mdPath, 'utf8');
      result.generatedAt   = fs.statSync(mdPath).mtime.toISOString();
    }
    if (fs.existsSync(jsonPath)) {
      result.knowledgeJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/knowledge/:profile/generate ─────────────────────────────────────
// Body: { additionalDirs?: string[] }
// Streams SSE: { log: string } | { done: true, files: { md, json } } | { error: string }
router.post('/:profile/generate', async (req, res) => {
  const profile = path.basename(req.params.profile);

  try {
    const config  = await readConfig();
    const pConfig = config.profiles?.[profile];
    if (!pConfig?.projectPath) return res.status(404).json({ error: 'Profile not found.' });

    const ai = config.ai || {};
    if (!ai.apiKey) return res.status(402).json({ error: 'No OpenRouter API key configured.' });

    const projectPath = pConfig.projectPath;
    const extraDirs   = (req.body.additionalDirs || [])
      .map(d => path.resolve(d))
      .filter(d => fs.existsSync(d) && fs.statSync(d).isDirectory());

    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

    send({ log: `Scanning project at ${projectPath}…` });

    const files = walkDir(projectPath, projectPath, extraDirs);
    send({ log: `Found ${files.length} candidate files.` });

    const { context, fileCount, charCount } = buildContext(files, projectPath);
    send({ log: `Packed ${fileCount} files (${Math.round(charCount / 1000)}k chars). Calling LLM…` });

    const systemPrompt = `You are a senior developer analysing a web application project.
Produce a thorough, structured knowledge document that will help an AI assistant understand
this codebase deeply enough to answer questions and assist with deployment, debugging, and features.

Produce a Markdown document with EXACTLY these sections:

1. **What This App Does** — describe the application from a USER perspective: what problem it solves,
   who uses it, and what they can do with it. Be specific about the purpose and audience.

2. **Pages & Features** — for EVERY route/page/view found in the codebase, describe:
   - The URL path or route pattern
   - What the user sees and can do on that page
   - Key data it reads or writes
   List ALL pages, not just a few examples.

3. **Tech Stack & Architecture** — framework, database, key libraries, notable patterns.

4. **Data Models & Database** — tables/collections, key fields, relationships.

5. **API Endpoints** — all backend routes grouped by resource, with HTTP method and purpose.

6. **Environment Variables** — every env var referenced, with what it controls.

7. **Deployment Notes** — anything relevant to the deployment pipeline (ports, volumes, migrations).

8. **Known Issues / Technical Debt** — anything unusual, risky, or incomplete.

Be specific and concrete — name actual route paths, model fields, and feature names from the code.
Use bullet points. Do not reproduce source code verbatim.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Here is the project source:\n${context}\n\nGenerate the knowledge document.` },
    ];

    const model = ai.model || 'minimax/minimax-m2.7';
    const body  = JSON.stringify({ model, messages, stream: true });

    const options = {
      hostname: 'openrouter.ai',
      path:     '/api/v1/chat/completions',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${ai.apiKey}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'HTTP-Referer':   'https://wdp.local',
        'X-Title':        'Wappler Deployment Pipeline',
      },
    };

    let knowledgeMd = '';

    await new Promise((resolve, reject) => {
      const proxyReq = https.request(options, (proxyRes) => {
        let buf = '';
        proxyRes.on('data', (chunk) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return;
            try {
              const parsed = JSON.parse(payload);
              const delta  = parsed.choices?.[0]?.delta?.content;
              if (delta) knowledgeMd += delta;
            } catch { /* skip */ }
          }
        });
        proxyRes.on('end', resolve);
        proxyRes.on('error', reject);
      });
      proxyReq.on('error', reject);
      proxyReq.write(body);
      proxyReq.end();
    });

    if (!knowledgeMd.trim()) {
      send({ error: 'LLM returned an empty response.' });
      return res.end();
    }

    send({ log: 'Writing knowledge files…' });

    const outDir  = path.join(projectPath, 'wdp', profile);
    fs.mkdirSync(outDir, { recursive: true });

    const mdPath   = path.join(outDir, 'knowledge.md');
    const jsonPath = path.join(outDir, 'knowledge.json');

    fs.writeFileSync(mdPath, knowledgeMd, 'utf8');

    // knowledge.json — Repomix-style packed context with metadata
    const knowledgeJson = {
      generatedAt:  new Date().toISOString(),
      profile,
      projectPath,
      model,
      fileCount,
      charCount,
      files: files.slice(0, fileCount).map(f => f.path),
      knowledgeMd,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(knowledgeJson, null, 2), 'utf8');

    send({ log: 'Done.', done: true, generatedAt: new Date().toISOString(), fileCount });
    res.end();

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── DELETE /api/knowledge/:profile ────────────────────────────────────────────
router.delete('/:profile', async (req, res) => {
  const profile = path.basename(req.params.profile);
  try {
    const config  = await readConfig();
    const pConfig = config.profiles?.[profile];
    if (!pConfig?.projectPath) return res.status(404).json({ error: 'Profile not found.' });

    const outDir   = path.join(pConfig.projectPath, 'wdp', profile);
    const mdPath   = path.join(outDir, 'knowledge.md');
    const jsonPath = path.join(outDir, 'knowledge.json');

    if (fs.existsSync(mdPath))   fs.unlinkSync(mdPath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
