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
// A SECOND cap, GEN_TIME_BUDGET_MIN, bounds wall-clock instead of count. The
// model step that talks to this broker has its own hard timeout (currently
// 30 min) and gets SIGKILLed at it — which used to mean a run doing real,
// correct work (several characters generated and verified) lost all of it,
// because the kill happens mid-operation with no chance to commit or even
// write a reply. MAX_GENERATIONS alone doesn't prevent that: a real run
// (2026-08-21, Dog Punk drone+brute) used only 9 of its 12 generations and
// still got killed by the clock — verification, re-generation on a failed
// check, and git bookkeeping all cost time without touching the counter.
// This broker is the one deterministic checkpoint every unit of art work
// passes through, so it's where the wall-clock budget is enforced too: once
// GEN_TIME_BUDGET_MIN has elapsed since the broker started (which happens
// right before the model step), every /generate call gets refused with a
// 429 telling the model to stop and wrap up — same mechanism, same message
// shape, as the existing MAX_GENERATIONS cap. That leaves the remaining
// minutes of the model step's own timeout for the fast stuff (verify,
// commit, write the reply) so a run finishes on its own terms instead of
// being killed mid-write. This is enforcement, not a prompt asking the
// model to watch the clock — the same reason MAX_GENERATIONS is a counter
// in code and not an instruction to "please don't overdo it".
//
// Env: OPENAI_API_KEY (required), MAX_GENERATIONS (default 6),
//      GEN_TIME_BUDGET_MIN (default 20), BROKER_PORT (default 8791).
//      Node 22+ (uses global fetch).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = parseInt(process.env.BROKER_PORT || '8791', 10);
const MAX = parseInt(process.env.MAX_GENERATIONS || '6', 10);
const TIME_BUDGET_MS = parseInt(process.env.GEN_TIME_BUDGET_MIN || '20', 10) * 60000;
const START = Date.now();
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
// THE MODEL COMES FROM THE CALLER, NOT FROM HERE. It was hardcoded to
// gpt-image-1 while .github/art/profiles.py had moved every front door to
// gpt-image-2 — so an Action generated on one model and a Clubhouse run, going
// through this broker, generated on the other. Same profile, different image,
// depending on who asked. That is the exact divergence the shared transport
// exists to prevent, and it survived the change that was supposed to end it
// because this file builds its own payload.
//
// Callers send the settings; this adds only the credential and the cap.
async function generate({ prompt, size, quality, transparent, model, background,
                          output_format, moderation }) {
  const payload = { model: model || 'gpt-image-1', prompt, size, quality, n: 1 };
  if (background) payload.background = background;
  else if (transparent) payload.background = 'transparent';
  if (output_format) payload.output_format = output_format;
  if (moderation) payload.moderation = moderation;
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
  // ImageMagick 7 ships only `magick`; 6 ships `convert`. Runner images have
  // varied on which is present, so pick whichever exists.
  const args = [file, '-trim', '+repage', '-resize', '512x512>', '-background', 'none', '-gravity', 'center', '-extent', '512x512', file];
  try {
    execFileSync('convert', args);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    execFileSync('magick', args);
  }
}

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return reply(res, 200, {
      ok: true, used, remaining: Math.max(0, MAX - used), max: MAX,
      time_remaining_min: Math.max(0, Math.round((TIME_BUDGET_MS - (Date.now() - START)) / 60000)),
    });
  }
  if (req.method !== 'POST' || req.url !== '/generate') return reply(res, 404, { ok: false, error: 'not found' });

  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw); } catch (_) { return reply(res, 400, { ok: false, error: 'invalid JSON body' }); }

    let { prompt, output_path, game, kind } = body;

    // KIND, NOT RAW FLAGS. This endpoint used to take size/quality/background
    // straight off the request body — any prompt, any settings, decided by
    // whoever wrote the curl call. That is how Trebor got 200 transparent
    // card icons and 8 opaque ones: nothing said what a "card icon" was
    // SUPPOSED to be, so nothing could hold a stray one to the standard the
    // other 200 already set. profiles.py is the one place that decides size,
    // quality, background and model now — for the CLI (imagegen.py) and for
    // this endpoint alike, so a run cannot get different settings depending
    // on which door it called through.
    if (!kind) {
      return reply(res, 400, { ok: false, error:
        'kind is required — which entry in .github/art/profiles.py PROFILES this is. ' +
        'Ask for a new one to be added there before treating this as a generic bucket.' });
    }
    let prof;
    try {
      const out = execFileSync('python3', ['-c',
        'import sys,json; sys.path.insert(0,".github/art"); import profiles; ' +
        'print(json.dumps(profiles.get(sys.argv[1]) if sys.argv[1] in profiles.FREEFORM_KINDS ' +
        'else {"_error": "not a freeform kind"}))', kind],
        { cwd: ROOT, encoding: 'utf8' });
      prof = JSON.parse(out);
    } catch (e) {
      return reply(res, 400, { ok: false, error: `could not resolve kind "${kind}": ${e.message}` });
    }
    if (prof._error) {
      return reply(res, 400, { ok: false, error:
        `"${kind}" is not a freeform kind (profiles.py FREEFORM_KINDS). A character row, ` +
        'room pass or tile sheet has its own front door and must not come through here.' });
    }
    const { size, quality, background, model } = prof;
    const transparent = background === 'transparent';

    // Path safety: only inside the repo, under games/, no traversal.
    if (!output_path || output_path.includes('..') || path.isAbsolute(output_path) || !output_path.startsWith('games/') || !output_path.endsWith('.png')) {
      return reply(res, 400, { ok: false, error: 'output_path must be a games/**/<name>.png path inside the repo' });
    }
    // SAME GUARD AS THE FREEFORM CLI (imagegen.py), for the same reason: this
    // is the raw one-off escape hatch, reachable by a plain curl from inside a
    // run, and art-src/ is exclusively the three front doors' territory. A
    // curl straight to this endpoint with an art-src/ path would produce a
    // file that looks like a properly generated row — no verification, no
    // retry, no character-spec check, invisible to the gates that only look
    // inside sheets built through the real pipeline.
    if (output_path.split('/').includes('art-src')) {
      return reply(res, 400, { ok: false, error:
        `${output_path} is inside art-src/, which belongs to the front doors, not a ` +
        'direct broker call: generate_row.py for a character row, room.py generate for ' +
        'a room pass, tileset.py generate for a tile sheet. Use this endpoint only for ' +
        'art with no front door (an icon, a title screen).' });
    }

    // A game id means: match that game's art style.
    if (game) {
      const sp = styledPrompt(game, prompt || '');
      if (!sp) return reply(res, 400, { ok: false, error: `games/${game}/art-style.json not found — create it first or omit "game" for a freeform image` });
      prompt = sp;
    }
    if (!prompt) return reply(res, 400, { ok: false, error: 'prompt is required' });

    if (used >= MAX) {
      return reply(res, 429, { ok: false, error: `generation cap reached (${MAX} per run) — keep the best image you already have and note it in your reply`, remaining: 0 });
    }
    const elapsed = Date.now() - START;
    if (elapsed >= TIME_BUDGET_MS) {
      const budgetMin = Math.round(TIME_BUDGET_MS / 60000);
      return reply(res, 429, { ok: false, error:
        `time budget for this run is used up (${budgetMin} min of art generation) — stop generating ` +
        'new art now. Finish verifying and committing what you already have, and describe what shipped ' +
        '(and what is still outstanding) in your reply.', remaining: 0, time_remaining_min: 0 });
    }

    try {
      const buf = await generate({ prompt, size, quality, transparent, model, background });
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
