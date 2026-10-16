// THE CLAIM AUDIT: what a chosen line said it would make, against what the game then made. Gambit's decision hands the line it chose
// with its claim ({ play, chain, combo, broke, done }); the frame loop opens it when the first swap is pressed and reads the board the
// game shows every frame after, until the line should have settled. A line replaced before then is counted as cut and not scored --
// whatever it made is mixed with what replaced it. A line carried on keeps the claim it was begun with.
//
// Scored per play kind, each right / over (claimed more than was made) / under (made more than was claimed):
//   chain  -- the longest chain seen (a single clear is no chain)      combo -- the largest match of 4 or more in one frame
//   broke  -- whether any garbage was broken                          and the line's frames: when it settled against when it said
// stats.audit: { <play>: { n, cut, chain: [right, over, under], combo: [...], broke: [...] } }
function Audit(stats) { this.stats = stats; this.open = null; this.seen = {}; this.seenG = {}; }
Audit.prototype.tally = function (play) {
  var a = this.stats.audit || (this.stats.audit = {});
  return a[play] || (a[play] = { n: 0, cut: 0, chain: [0, 0, 0], combo: [0, 0, 0], broke: [0, 0, 0] });
};
function score(row, claimed, made) { row[claimed === made ? 0 : claimed > made ? 1 : 2]++; }
Audit.prototype.resolve = function (cut) {
  var c = this.open, t = this.tally(c.play);
  this.open = null;
  t.n++;
  if (cut) { t.cut++; return; }
  var cc = c.chain >= 2 ? c.chain : 0, mc = c.got.chain >= 2 ? c.got.chain : 0;
  var co = c.combo >= 4 ? c.combo : 0, mo = c.got.combo >= 4 ? c.got.combo : 0;
  score(t.chain, cc, mc); score(t.combo, co, mo); score(t.broke, c.broke > 0 ? 1 : 0, c.got.broke > 0 ? 1 : 0);
};
// a line chosen and its first swap pressed at frame `at`: { play, chain, combo, broke, done (frames from `at` to its settle) }
Audit.prototype.claim = function (claim, at) {
  // (the line carried on -- named so, or a new decision whose first swap is one of the open line's swaps still to come (the frame loop
  // may have pressed the ones between): still the claim it was begun with)
  var o = this.open, first = claim.seq && claim.seq[0], k = -1;
  if (o && o.seq && first) for (var q = o.step + 1; q < o.seq.length && k < 0; q++) if (o.seq[q][0] === first[0] && o.seq[q][1] === first[1]) k = q;
  if (o && (claim.play === 'carry' || k > 0)) { if (k > 0) o.step = k; return; }
  if (this.open) this.resolve(true);
  this.open = { play: claim.play, chain: claim.chain || 0, combo: claim.combo || 0, broke: claim.broke || 0, at: at, seq: claim.seq || null, step: 0,
                until: at + Math.max(30, claim.done || 0) + 30, got: { chain: 0, combo: 0, broke: 0 } };
};
// every frame the game shows: the panels newly matched (a combo when 4 or more), the chain counter, the garbage newly matched (broken)
Audit.prototype.frame = function (truth) {
  if (!truth || !truth.panels) return;
  var now = {}, nowG = {}, fresh = 0, freshG = 0, r, c, p;
  for (r = 1; r < truth.panels.length; r++) for (c = 1; c <= 6; c++) {
    p = truth.panels[r] && truth.panels[r][c];
    if (!p || p.state !== 'matched') continue;
    if (p.isGarbage) { nowG[p.id] = 1; if (!this.seenG[p.id]) freshG++; }
    else if (p.color > 0) { now[p.id] = 1; if (!this.seen[p.id]) fresh++; }
  }
  this.seen = now; this.seenG = nowG;
  var o = this.open;
  if (!o || truth.clock < o.at) return;
  if ((truth.chainCounter || 0) > o.got.chain) o.got.chain = truth.chainCounter;
  if (fresh > o.got.combo) o.got.combo = fresh;
  o.got.broke += freshG;
  if (truth.clock >= o.until) this.resolve(false);
};
// the match is over: a line still open is scored on what it made so far
Audit.prototype.end = function () { if (this.open) this.resolve(false); };
module.exports = { Audit: Audit };
