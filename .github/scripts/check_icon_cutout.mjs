// A SPRITE CARRIES NO BACKGROUND.
//
// An icon is dropped straight onto the game's own UI or playfield, so the
// only thing in the file is the subject, cut out to its silhouette. The
// background behind it belongs to whatever it is dropped on.
//
// This is checked because it already shipped broken, twice, for the same
// reason both times: nothing said what an icon was SUPPOSED to look like, so
// nothing could catch one that drifted. Trebor had 200 card icons on
// transparent and 8 that were not. Hypergolic Hull had 18 of 53 with a dark
// navy tile baked in — ten of them ships that draw on the board — because
// the game's own art-style.json asked for "a radial gradient from dark navy
// to near-black" and generate-game-asset.yml faithfully applied it to every
// sprite.
//
// THE TEST is the border. A cut-out subject touches the frame only where it
// genuinely runs off the edge; a baked backdrop fills the frame by
// definition, so it fills the border too.
//
// Run: node .github/scripts/check_icon_cutout.mjs

import { readdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// More than half the border showing means a backdrop is still attached.
// Deliberately loose: a wide ship really can run off two opposite edges, and
// this exists to catch a filled frame, not to police composition.
const BORDER_LIMIT = 0.5;

// Minimal PNG reader — enough for RGBA/palette icons, and it avoids putting a
// native image dependency in the gate path.
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, depth = 0, colorType = 0, idat = [], palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8) return null; // 16-bit icons are not a thing here
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  const alphaAt = (x, y) => {
    const i = y * stride + x * channels;
    if (colorType === 6) return out[i + 3];
    if (colorType === 4) return out[i + 1];
    if (colorType === 3 && trns) { const idx = out[i]; return idx < trns.length ? trns[idx] : 255; }
    return 255; // no alpha channel at all: the whole frame is opaque
  };
  return { width, height, alphaAt };
}

function borderVisible(img) {
  const { width: w, height: h, alphaAt } = img;
  let seen = 0, total = 0;
  for (let x = 0; x < w; x++) { for (const y of [0, h - 1]) { total++; if (alphaAt(x, y) > 20) seen++; } }
  for (let y = 0; y < h; y++) { for (const x of [0, w - 1]) { total++; if (alphaAt(x, y) > 20) seen++; } }
  return seen / total;
}

let failures = 0, checked = 0;
for (const game of readdirSync("games", { withFileTypes: true })) {
  if (!game.isDirectory()) continue;
  const dir = path.join("games", game.name, "icons");
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".png")) continue;
    const full = path.join(dir, file);
    const img = decodePng(readFileSync(full));
    if (!img) { console.log(`skip ${full}: unsupported PNG form`); continue; }
    checked++;
    const border = borderVisible(img);
    if (border > BORDER_LIMIT) {
      console.log(`FAIL ${full}: ${(border * 100).toFixed(0)}% of the border is filled — a backdrop is baked into this sprite`);
      failures++;
    }
  }
}
console.log(`${checked} icons checked, ${failures} carrying a backdrop`);
if (failures) {
  console.log("\nRegenerate them. An icon is generated with a transparent background");
  console.log("(.github/art/profiles.py, kind \"icon\"); if they came through");
  console.log("generate-game-asset.yml, check that game's art-style.json is not asking");
  console.log("for a background of its own.");
  process.exit(1);
}
