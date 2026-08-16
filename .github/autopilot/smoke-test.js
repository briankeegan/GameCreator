// Pre-ship smoke test for the Clubhouse autopilot.
//
// The autopilot auto-merges the model's edits straight to live, so this is the
// gate that stops a broken game from shipping: it loads each changed game (and
// the landing page, if shared code changed) in a headless browser and fails if
// the page throws an uncaught error, logs a console error, or renders nothing.
// A failure here blocks the merge — the workflow posts the errors to the thread
// instead of deploying a dead game.
//
// Usage: node smoke-test.js <index.html path> [<index.html path> ...]
// Loads over file:// (no server needed). Exits 0 if all pass, 1 if any fail,
// 2 on harness error. On failure it also writes a human-readable summary to
// .autopilot/failure.md for the workflow to post.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const targets = process.argv.slice(2);
if (!targets.length) { console.log('No runtime targets — skipping smoke test.'); process.exit(0); }

// Loading over file:// legitimately 404s the service worker / manifest / icons
// (relative fetches, no server). Those are not game bugs — ignore them.
const IGNORE = /service ?worker|sw\.js|manifest|favicon|icon|Failed to (load|register)|status of 404/i;

(async () => {
  const browser = await chromium.launch();
  const failures = [];

  for (const t of targets) {
    const errs = [];
    const page = await browser.newPage();
    page.on('pageerror', (e) => errs.push('uncaught: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push('console: ' + m.text()); });

    try {
      await page.goto('file://' + path.resolve(t), { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(1500); // let init / first paint run
      // "Something actually rendered": a sized canvas, or non-empty body text.
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
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
