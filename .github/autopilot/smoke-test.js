// Pre-ship smoke test for the Clubhouse autopilot.
//
// The autopilot auto-merges the model's edits straight to live, so this is the
// gate that stops a broken game from shipping: it loads each changed game (and
// the landing page, if shared code changed) in a headless browser and fails if
// the page throws an uncaught error, logs a console error, or renders nothing.
// A failure here blocks the merge — the workflow posts the errors to the thread
// instead of deploying a dead game.
//
// Pages are served over a real local HTTP server (NOT file://): the landing
// page and games do `fetch()` for JSON/assets, and fetch() cannot read file://
// URLs — loading over file:// produced false failures. http://127.0.0.1 mirrors
// how the site actually runs.
//
// Usage: node smoke-test.js <index.html path> [<index.html path> ...]
// Exits 0 if all pass, 1 if any fail, 2 on harness error. On failure it also
// writes a human-readable summary to .autopilot/failure.md for the workflow.

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const targets = process.argv.slice(2);
if (!targets.length) { console.log('No runtime targets — skipping smoke test.'); process.exit(0); }

const ROOT = process.cwd();
// PORT 0 = let the OS pick a free one. It used to be hardcoded to 8123, and
// that threw away a complete, successful run: the model had spent 18 minutes
// rebuilding a level, and had left its own little HTTP server on 8123 from
// testing the game (which the instructions actively encourage — looking at the
// result is the point). The smoke test then died with EADDRINUSE, the job
// failed, and every file the run had produced was discarded. The port a
// previous process happens to hold must never be able to bin someone's work.
const PORT = 0;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Genuinely-irrelevant noise when loading a game in isolation (service worker /
// manifest / icon fetches that 404 without the full site). Not game bugs.
const IGNORE = /service ?worker|sw\.js|manifest|favicon|\.webmanifest|apple-touch|register|icon/i;

// A missing image (art/*.png etc.) is EXPECTED and not a bug: every game in
// this framework references generated art with a graceful in-code fallback
// (canvas draw / tinted placeholder) specifically so it plays before any art
// exists — see CLAUDE.md's "reference-with-fallback" pattern. A missing
// script/stylesheet/html file is a real, fatal problem. Chromium's own
// "Failed to load resource" console message carries no URL to pattern-match
// against, so this is checked via the actual network response instead.
const EXPECTED_MISSING_EXT = /\.(png|jpe?g|gif|webp|ico)$/i;

function serve() {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rel = urlPath.replace(/^\/+/, '');
    const abs = path.join(ROOT, rel);
    // Contain to repo root.
    if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}

(async () => {
  const server = serve();
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch();
  const failures = [];

  for (const t of targets) {
    const errs = [];
    const page = await browser.newPage();
    page.on('pageerror', (e) => errs.push('uncaught: ' + e.message));
    // The browser's generic "Failed to load resource" text carries no URL, so
    // it's never treated as fatal here — the response listener below inspects
    // the actual failed URL and decides whether it's an expected missing
    // image (ignored) or a genuinely broken asset (fatal).
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (IGNORE.test(m.text())) return;
      if (/^Failed to load resource/i.test(m.text())) return;
      errs.push('console: ' + m.text());
    });
    page.on('response', (res) => {
      if (res.status() < 400) return;
      let pathname;
      try { pathname = new URL(res.url()).pathname; } catch (_) { return; }
      if (IGNORE.test(pathname)) return;
      if (EXPECTED_MISSING_EXT.test(pathname)) return; // missing art — has a fallback, not a bug
      errs.push(`HTTP ${res.status()} loading ${pathname}`);
    });

    try {
      await page.goto(`http://127.0.0.1:${port}/${t}`, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(1800); // let init / first paint / fetches run
      const rendered = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        if (c && c.width > 0 && c.height > 0) return true;
        return !!(document.body && document.body.innerText.trim().length > 0);
      });
      if (!rendered) errs.push('nothing rendered (no sized canvas and empty body)');
    } catch (e) {
      errs.push('load failed: ' + e.message);
    }
    await page.close();

    const real = errs.filter((e) => !IGNORE.test(e));
    console.log((real.length ? 'FAIL  ' : 'PASS  ') + t + (real.length ? ' — ' + real.join(' | ') : ''));
    if (real.length) failures.push({ target: t, errors: real });
  }

  await browser.close();
  server.close();

  if (failures.length) {
    const md =
      'I made the change, but it **failed a pre-ship check** so I did **not** deploy it — ' +
      'nothing broken went live. What broke:\n\n' +
      failures.map((f) => `- \`${f.target}\`: ${f.errors.join('; ')}`).join('\n') +
      '\n\nSend me another message and I\'ll take a fresh pass at fixing it.';
    try { fs.mkdirSync('.autopilot', { recursive: true }); fs.writeFileSync('.autopilot/failure.md', md); } catch (_) {}
    console.error(`\nSmoke test FAILED for ${failures.length}/${targets.length} target(s).`);
    process.exit(1);
  }

  console.log(`\nSmoke test passed for ${targets.length} target(s).`);
  process.exit(0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
