// A SCREENSHOT YOU CAN TRUST, OR NONE AT ALL.
//
// The trap this exists to close: a screenshot script whose locator was wrong
// timed out, wrote nothing, and left the PREVIOUS run's images on disk. They
// were then read as if they were fresh, and three rounds were spent concluding
// a marker "wasn't rendering" when it had been rendering the whole time. A
// screenshot that fails silently is worse than no screenshot, because it does
// not look like a failure — it looks like evidence.
//
// Three things, and the third is the one that actually saves you:
//   1. DELETE the target first, so a stale file cannot survive a failed run.
//   2. THROW if nothing was written, so a failure is a failure.
//   3. STAMP the image with the time and the commit it was taken at. The other
//      two protect this script; the stamp protects the person reading the
//      picture, which is where the deception actually happens. An unstamped or
//      stale-stamped image is visibly wrong at a glance.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let SHA = "unknown";
try {
  SHA = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch (e) { /* not a repo; the stamp still carries the time */ }

async function shoot(target, outPath, label) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // 1. no stale file may survive this call
  try { fs.unlinkSync(outPath); } catch (e) { /* wasn't there */ }

  await target.screenshot({ path: outPath });

  // 2. present and non-empty, or it did not happen
  let size = 0;
  try { size = fs.statSync(outPath).size; } catch (e) { size = 0; }
  if (!size) throw new Error(`shoot: nothing was written to ${outPath}`);

  // 3. stamp it, so the picture itself says when it is from
  const stamp = `${new Date().toISOString().replace("T", " ").slice(0, 19)}  ${SHA}` +
                (label ? `  ${label}` : "");
  await stampPng(outPath, stamp);
  return outPath;
}

// Burned in with the same browser that took the shot — no extra dependency.
async function stampPng(file, text) {
  const { chromium } = require(path.join(__dirname, "..", "..", "node_modules", "playwright"));
  const b64 = fs.readFileSync(file).toString("base64");
  const br = await chromium.launch();
  try {
    const pg = await br.newPage();
    const out = await pg.evaluate(async ([b64, text]) => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = "data:image/png;base64," + b64; });
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height + 16;
      const x = c.getContext("2d");
      x.fillStyle = "#101018"; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 16);
      x.font = "11px monospace"; x.fillStyle = "#7fe3a0";
      x.fillText(text, 5, 12);
      return c.toDataURL("image/png").split(",")[1];
    }, [b64, text]);
    fs.writeFileSync(file, Buffer.from(out, "base64"));
  } finally { await br.close(); }
}

module.exports = { shoot };
