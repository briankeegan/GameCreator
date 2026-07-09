// Local image-generation broker for the Clubhouse autopilot.
//
// WHY THIS EXISTS: the autopilot lets the headless Claude *review* generated
// art (generate -> Read the PNG -> judge -> regenerate if bad) all within one
// run. For that, generation has to happen in-run. But the model must NOT hold
// the OpenAI key — a prompt-injection in a chat message could otherwise spend
// it or leak it into a reply. So the shell starts THIS process with the key in
// its own environment (never the model's), and the model triggers a generation
// by POSTing to http://127.0.0.1:<port>/generate with no credential at all.
//
// The broker also enforces a HARD CAP (MAX_GENERATIONS) on how many images a
// single run may produce, so a stuck review loop — or an injected "generate
// 1000 images" — can't run up a bill. A rejected/failed request is not billed
// and does not count against the cap.
//
// Env: OPENAI_API_KEY (required), MAX_GENERATIONS (default 6),
//      BROKER_PORT (default 8791). Node 22+ (uses global fetch).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = parseInt(process.env.BROKER_PORT || '8791', 10);
const MAX = parseInt(process.env.MAX_GENERATIONS || '6', 10);
const KEY = process.env.OPENAI_API_KEY;
const ROOT = process.cwd();

if (!KEY) { console.error('[broker] OPENAI_API_KEY not set — refusing to start'); process.exit(1); }

let used = 0; // successful generations so far (only successes count)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Compose a styled prompt from a game's art-style.json (same fields the
// generate-game-asset.yml action uses), so in-run art matches the game's set.
function styledPrompt(game, asset) {
  const f = path.join(ROOT, 'games', game, 'art-style.json');
  if (!fs.existsSync(f)) return null;
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  return `${s.camera || ''} ${asset}. ${s.style || ''} Color palette: ${s.palette || ''} Background: ${s.background || ''} ${s.constraints || ''}`.trim();
}

// One OpenAI image call, with retry on 429 (per-minute image cap) / transient
// 5xx. Returns the decoded PNG buffer, or throws on a non-retryable error.
async function generate({ prompt, size, quality, transparent }) {
  const payload = { model: 'gpt-image-1', prompt, size, quality, n: 1 };
  if (transparent) payload.background = 'transparent';
  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      lastErr = 'network: ' + e.message;
      await sleep(attempt * 15000);
      continue;
    }
    if (res.status === 200) {
      const j = await res.json();
      const b64 = j.data && j.data[0] && j.data[0].b64_json;
      if (!b64) throw new Error('OpenAI returned no image data');
      return Buffer.from(b64, 'base64');
    }
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (_) {}
    lastErr = msg;
    if (res.status === 429 || res.status >= 500) {
      const wait = attempt * 15000 + Math.floor(Math.random() * 8000);
      console.error(`[broker] retryable (${res.status}) attempt ${attempt}: ${msg} — waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(msg); // non-retryable (e.g. 400 bad prompt)
  }
  throw new Error(`still failing after retries: ${lastErr}`);
}

// -trim + downscale to a web-friendly 512px sprite (same as the game-asset
// action) so a set of assets doesn't bloat the PWA. Only for cut-out assets.
function trimAndResize(file) {
  execFileSync('convert', [file, '-trim', '+repage', '-resize', '512x512>', '-background', 'none', '-gravity', 'center', '-extent', '512x512', file]);
}

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return reply(res, 200, { ok: true, used, remaining: Math.max(0, MAX - used), max: MAX });
  }
  if (req.method !== 'POST' || req.url !== '/generate') return reply(res, 404, { ok: false, error: 'not found' });

  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw); } catch (_) { return reply(res, 400, { ok: false, error: 'invalid JSON body' }); }

    let { prompt, output_path, size, quality, transparent, game } = body;
    size = size || '1024x1024';
    quality = quality || 'medium';

    // Path safety: only inside the repo, under games/, no traversal.
    if (!output_path || output_path.includes('..') || path.isAbsolute(output_path) || !output_path.startsWith('games/') || !output_path.endsWith('.png')) {
      return reply(res, 400, { ok: false, error: 'output_path must be a games/**/<name>.png path inside the repo' });
    }

    // A game id means: match that game's art style and cut out on transparent.
    if (game) {
      const sp = styledPrompt(game, prompt || '');
      if (!sp) return reply(res, 400, { ok: false, error: `games/${game}/art-style.json not found — create it first or omit "game" for a freeform image` });
      prompt = sp;
      if (transparent === undefined) transparent = true;
    }
    if (!prompt) return reply(res, 400, { ok: false, error: 'prompt is required' });

    if (used >= MAX) {
      return reply(res, 429, { ok: false, error: `generation cap reached (${MAX} per run) — keep the best image you already have and note it in your reply`, remaining: 0 });
    }

    try {
      const buf = await generate({ prompt, size, quality, transparent: !!transparent });
      const abs = path.join(ROOT, output_path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
      if (transparent) { try { trimAndResize(abs); } catch (e) { console.error('[broker] resize failed (keeping full-size):', e.message); } }
      used += 1;
      console.error(`[broker] wrote ${output_path} (${used}/${MAX} used)`);
      return reply(res, 200, { ok: true, output_path, remaining: Math.max(0, MAX - used) });
    } catch (e) {
      // A failed generation is not billed and does not consume the cap.
      console.error('[broker] generation failed:', e.message);
      return reply(res, 502, { ok: false, error: e.message, remaining: Math.max(0, MAX - used) });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.error(`[broker] listening on 127.0.0.1:${PORT}, cap ${MAX}`));
