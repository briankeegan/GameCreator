// Decodes a full PvP match replay from the source game's legacy format
// (common/tests/engine/replays/*.txt|*.json in briankeegan/panel-game --
// {"engineVersion":"046","vs":{...}}). These are REAL recorded human
// matches (real level-10-vs-level-10 games among them), richer than the
// challenge-*.json attack-timing extracts used elsewhere in this
// directory: they carry the actual raw per-frame controller input for
// BOTH players, not just when garbage arrived.
//
// Format, reverse-engineered from the actual decoder in the source game
// (common/data/InputCompression.lua's decompressInputString2, called
// from common/compatibility/ReplayV2.lua:220/249):
//   vs.in_buf -- P1's compressed input string
//   vs.I      -- P2's compressed input string
// (Not the other way around, and not obvious from the field names alone
// -- ReplayV2.lua is the only place that says which is which.)
//
// Compression (InputCompression.lua): each frame's input is one
// character from the 64-symbol alphabet "ABCDEFGHIJKLMNOPQRSTUVWXYZ
// abcdefghijklmnopqrstuvwxyz1234567890+/", its 6 bits mapping to
// [raise,swap,up,down,left,right] via KeyDataEncoding.lua (bit weights
// 32,16,8,4,2,1 in that order). A run of N identical frames compresses
// to "<symbol><N>" (e.g. "A38" = 38 idle frames) UNLESS the symbol
// itself is a digit (positions 53-62 in the alphabet, i.e. '0'-'9' are
// themselves valid single-frame inputs) -- digit runs are wrapped
// "(11111)" instead, since a bare digit run would be ambiguous with a
// count. This IS in the real replays (StreamMod test fixtures) even
// though it never showed up in the first ~100 chars of a real match,
// which is why an initial from-scratch parser choked on the first "("
// it hit deeper in the file.
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890+/";
var SYMBOL_TO_VAL = {};
for (var i = 0; i < ALPHABET.length; i++) SYMBOL_TO_VAL[ALPHABET[i]] = i;

function isDigit(ch) { return ch >= '0' && ch <= '9'; }

// Faithful port of InputCompression.decompressInputString2.
function decompressInputString2(inputs) {
  var STATE = { UNINIT: 0, CHAR: 1, COUNT: 2, UNCOMPRESSED: 3 };
  var state = STATE.UNINIT;
  var chunks = [];
  var count = 0;
  for (var idx = 0; idx < inputs.length; idx++) {
    var ch = inputs[idx];
    if (state === STATE.UNINIT) {
      if (ch === '(') { state = STATE.UNCOMPRESSED; }
      else { state = STATE.CHAR; chunks.push(ch); }
    } else if (state === STATE.CHAR) {
      if (isDigit(ch)) { state = STATE.COUNT; count = parseInt(ch, 10); }
      else { throw new Error('malformed replay input at index ' + idx + ': expected digit after character'); }
    } else if (state === STATE.COUNT) {
      if (isDigit(ch)) { count = count * 10 + parseInt(ch, 10); }
      else {
        chunks.push(chunks[chunks.length - 1].repeat(count - 1));
        if (ch === '(') { state = STATE.UNCOMPRESSED; }
        else { state = STATE.CHAR; chunks.push(ch); }
      }
    } else if (state === STATE.UNCOMPRESSED) {
      if (ch === ')') { state = STATE.UNINIT; }
      else { chunks.push(ch); }
    }
  }
  if (state === STATE.COUNT) chunks.push(chunks[chunks.length - 1].repeat(count - 1));
  return chunks.join('');
}

function decodeSymbol(ch) {
  var val = SYMBOL_TO_VAL[ch];
  if (val === undefined) throw new Error('unknown input symbol: ' + JSON.stringify(ch));
  return {
    raise: (val & 32) !== 0, swap: (val & 16) !== 0,
    up: (val & 8) !== 0, down: (val & 4) !== 0,
    left: (val & 2) !== 0, right: (val & 1) !== 0
  };
}

// Returns { p1: [{raise,swap,up,down,left,right}, ...], p2: [...], seed, p1Level, p2Level }.
// p2 may be an empty array for a one-player (vs-self/endless) replay.
function decodeReplay(raw) {
  var vs = raw.vs;
  if (!vs) throw new Error('not a "vs" replay (no vs field)');
  var p1raw = decompressInputString2(vs.in_buf || '');
  var p2raw = decompressInputString2(vs.I || '');
  return {
    p1: p1raw.split('').map(decodeSymbol),
    p2: p2raw.split('').map(decodeSymbol),
    seed: vs.seed,
    p1Level: vs.P1_level,
    p2Level: vs.P2_level,
    p1Name: vs.P1_name,
    p2Name: vs.P2_name
  };
}

module.exports = { decompressInputString2: decompressInputString2, decodeSymbol: decodeSymbol, decodeReplay: decodeReplay };
