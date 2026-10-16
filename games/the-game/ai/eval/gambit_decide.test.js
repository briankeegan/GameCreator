// GAMBIT'S DECISION, end to end (gambit_decide.js, plans/decision.md): on real boards of every mode, the judge counts what a line makes
// as it is pressed, and every line the decision ranks fits the mode's list, in rank order. Run: node gambit_decide.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var ATTACK = require('./survivor_attack.js'), GAMBIT = require('./gambit.js'), DECIDE = require('./gambit_decide.js'), JUDGE = require('./gambit_judge.js');
var at = ATTACK({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), hold = { left: 0, started: false };
var rules = GAMBIT.rulesFor({ gambit: { rules: 'survivor-profiles/gambit-rules.json' } }, __dirname);

// THE JUDGE: a planned line judged settle by settle makes what the planner said; the ok check stops it at the step that breaks it
var judged = 0;
for (var seed = 1; seed <= 30 && judged < 3; seed++) {
  var b = PA.game({ level: 10, seed: seed, countdown: false });
  for (var f = 0; f < 200; f++) b.run();
  var pa = at.plan(b, hold, { ms: 300, width: 30, depth: 4, pool: 120, aims: [function (mk) { return mk.chain >= 2; }] }).perAim[0];
  if (!pa) continue;
  judged++;
  var j = at.judge(b, hold, pa.seq, [], { settled: true });
  assert.ok(!j.dead && j.made.chain >= pa.chain, 'seed ' + seed + ': the judge sees the chain of ' + pa.chain + ' the planner made, got ' + JSON.stringify(j.made));
  var stop = at.judge(b, hold, pa.seq, [], { settled: true, ok: function (mk) { return mk.chain < 2; } });
  assert.strictEqual(stop.cut, pa.seq.length - 1, 'seed ' + seed + ': cut at the step that makes the chain');
  assert.strictEqual(at.judge(b, hold, pa.seq, [], { settled: true, ok: function () { return true; } }).cut, pa.seq.length, 'nothing outside: no cut');
}
assert.ok(judged >= 2, 'boards with a chain line to judge');

// THE CHAIN AS THE GAME COUNTS IT: a planned chain's swaps pressed on the engine at the frames the judge presses them, then the board
// left to fall -- the judge's chainAll on it, mid-chain, is the chain counter the game reaches (a continuation goes up, it is not a new one)
var counted = 0, listChecked = 0, moveChecked = 0, cutFound = 0;
for (var cs = 1; cs <= 40 && counted < 3; cs++) {
  var cb = PA.game({ level: 10, seed: cs, countdown: false });
  for (var cf = 0; cf < 200; cf++) cb.run();
  var cp = at.plan(cb, hold, { ms: 300, width: 30, depth: 4, pool: 120, aims: [function (mk) { return mk.chain >= 2; }] }).perAim[0];
  if (!cp) continue;
  var jj = at.judge(cb, hold, cp.seq, [], { settled: true });
  if (jj.dead || jj.ats.length !== cp.seq.length) continue;
  var gb = cb.copy(), clock0 = gb.clock, pressed = 0;
  for (var t = 0; t < 900 && pressed < cp.seq.length; t++) {
    if (gb.clock - clock0 >= jj.ats[pressed] + 1) { var mv = cp.seq[pressed]; gb.curRow = mv[0]; gb.curCol = mv[1]; if (gb.tryQueueSwap(mv[0], mv[1])) pressed++; else break; }
    gb.run();
  }
  if (pressed < cp.seq.length) continue;
  for (t = 0; t < 300 && !(gb.chainCounter >= 2); t++) gb.run();
  if (!(gb.chainCounter >= 2)) continue;
  var mid = at.judge(gb, hold, [], [], {}).chainAll, run = gb.copy(), most = run.chainCounter;
  for (t = 0; t < 600; t++) { run.run(); if (run.chainCounter > most) most = run.chainCounter; }
  assert.strictEqual(mid, most, 'seed ' + cs + ': mid-chain, the judge counts ' + mid + ', the game reaches ' + most);
  // (and the list check reads that chain: with a list that stops below it, a move made now that leaves the chain running is dropped as
  // outside the list -- JUDGE.judge, as the decision asks it)
  gb.legalSwaps().slice(0, 12).forEach(function (mv0) {
    var jm = at.judge(gb, hold, [mv0], [], {});
    // (the move's own chain, against the game: the swap pressed on the engine at the frame the judge presses it)
    if (!jm.dead) {
      var pb = gb.copy(), p0 = pb.clock, done0 = false, top = pb.chainCounter;
      for (var q = 0; q < 700; q++) { if (!done0 && pb.clock - p0 >= jm.ats[0] + 1) { pb.curRow = mv0[0]; pb.curCol = mv0[1]; done0 = pb.tryQueueSwap(mv0[0], mv0[1]); } pb.run(); if (pb.chainCounter > top) top = pb.chainCounter; }
      if (done0) { assert.strictEqual(jm.chainAll, top, 'seed ' + cs + ': swap ' + mv0 + ' mid-chain: the judge counts ' + jm.chainAll + ', the game reaches ' + top); moveChecked++; if (top < most) cutFound++; }
    }
    if (jm.dead || jm.chainAll < most) return;
    var cj = { bot: {}, board: gb, m: { hold: hold, at: gb.clock }, arrivals: [], attacker: at, judged: {}, dropped: {}, tight: false };
    var Rj = { list: [{ chain: '<' + most }], aims: [{ chain: '<' + most }], keep: null, by: null, under: false, F: { us: { material: 99, topped: false, breakWaits: false }, enemy: { topped: false } } };
    assert.strictEqual(JUDGE.judge(cj, Rj, { play: 'entry', seq: [mv0], x: {}, aim: -1 }), null, 'seed ' + cs + ': swap ' + mv0 + ' leaves the chain of ' + most + ' running, past the list');
    assert.strictEqual(cj.dropped.entry.list, 1, 'dropped as outside the list');
    // (a clear of its own the list does not allow is outside it too, whatever chain is falling beside it)
    assert.ok(!JUDGE.fitsList([{ chain: '==' + most }], { combo: 4, chain: 0 }, { chainAll: most }), 'a combo of 4 made beside a chain is no link of it');
    assert.ok(!JUDGE.fitsList([{ combo: '==6' }, { chain: '==' + most }], { combo: 6, chain: 0 }, { chainAll: 0, singles: [6, 4] }), 'a combo of 4 the board makes beside the line\'s own 6 is outside the list');
    assert.ok(JUDGE.fitsList([{ combo: '==6' }], { combo: 6, chain: 0 }, { chainAll: 0, singles: [6] }), 'the line\'s own 6, alone, fits');
    listChecked++;
  });
  counted++;
}
assert.ok(counted >= 2 && listChecked > 0 && moveChecked > 0, 'boards caught mid-chain: ' + counted + ', moves held to the list there: ' + listChecked + ', moves held to the game: ' + moveChecked);
console.log('ok: mid-chain -- ' + moveChecked + ' swaps judged as the game counts them, ' + cutFound + ' of them cut the chain short');

// THE DECISION: every mode, on boards a few seconds in -- it runs, ranks in order, and every line ranked fits the list
var modes = ['finish them', 'pressure', 'big chain', 'build'], decided = 0;
modes.forEach(function (mode) {
  for (var seed = 1; seed <= 4; seed++) {
    var b = PA.game({ level: 10, seed: seed, countdown: false });
    for (var f = 0; f < 240; f++) b.run();
    var bot = { _canRaise: function () { return true; } };
    var c = { bot: bot, m: { at: b.clock, hold: hold, topped: false, opp: null }, board: b, arrivals: [], br: null, brMs: 0, attacker: at, rules: rules,
              GP: { mode: mode, ms: 60, width: 30, depth: 5, pool: 120 }, pace: null, canRaise: function () { return false; }, left: function () { return 200; } };
    var R = DECIDE.read(c);
    assert.ok(R && R.pick.rule.name === mode, mode + ': the mode read');
    var cands = DECIDE.ranked(c, R, require('./gambit_propose.js').search(c, R));
    for (var i = 1; i < cands.length; i++) assert.ok(JUDGE.compare(cands[i - 1], cands[i]) <= 0, mode + ': ranked in order');
    cands.forEach(function (k) {
      var mk = at.judge(b, hold, k.seq, [], { settled: JUDGE.settled(k.play) }).made;
      assert.ok(GAMBIT.fits(R.list, mk), mode + ' seed ' + seed + ': ' + k.play + ' ' + JSON.stringify(k.seq) + ' makes ' + JSON.stringify(mk) + ', outside the list');
    });
    var D = DECIDE.decide(c);
    assert.ok(D && D.order.length, mode + ': a decision');
    decided++;
  }
});
// TOPPED OUT BY ITS OWN PANELS, NO GARBAGE ON THE BOARD: nothing to break, so the entries are the list as written (none asks for a break)
// and the deadline is the board's
var tb = PA.game({ level: 10, seed: 3, countdown: false });
for (var tf = 0; tf < 3000 && !(tb.isToppedOut && tb.isToppedOut()); tf++) tb.run();
assert.ok(tb.isToppedOut(), 'the stack has risen to the top');
var tc = { bot: { _canRaise: function () { return false; }, _gambitHit: true }, m: { at: tb.clock, hold: hold, topped: true, opp: null }, board: tb, arrivals: [], br: null, brMs: 0, attacker: at, rules: rules,
           GP: { mode: 'finish them', ms: 60, width: 30, depth: 5, pool: 120 }, pace: null, canRaise: function () { return false; }, left: function () { return 200; } };
var TR = DECIDE.read(tc);
assert.ok(TR.F.us.topped && TR.F.us.contact === null, 'topped, no garbage');
assert.ok(!TR.under && TR.aims.every(function (a) { return !a.break; }), 'no entry asks for a break with no garbage to break');
assert.ok(TR.by !== undefined, 'a deadline is read');
// THE PRESS AS THE FRAME LOOP MAKES IT: with the input budget tight the frame loop walks held from two cells, and the judge presses
// each swap on the very frame that walk does -- not the search's own walk
var SHK = require('./survivor_shared.js'), KEYSK = require('./survivor_keys.js'), INK = PA.IN, slowed = 0;
process.env.GC_SURVIVOR_PROFILE = path.join(__dirname, 'survivor-profiles', 'gambit-finish.json');
var hands = new SHK.Hands(SHK.profile());
var kb = PA.game({ level: 10, seed: 2, countdown: false });
for (var kf = 0; kf < 300; kf++) kb.run();
kb.legalSwaps().forEach(function (mv) {
  var k = hands.keys(kb, hold, 'swap', mv, []);
  if (!k) return;
  var idx = function (ins) { return ins.findIndex(function (x) { return x & INK.swap; }); };
  var later = idx(KEYSK.slowWalks(k.inputs, k.holds, 2).inputs) - idx(k.inputs);
  var free = at.judge(kb, hold, [mv], [], {}), tightJ = at.judge(kb, hold, [mv], [], { tight: true });
  assert.strictEqual(tightJ.ats[0] - free.ats[0], later, 'swap ' + mv + ': judged ' + (tightJ.ats[0] - free.ats[0]) + ' frames later, the frame loop presses ' + later + ' later');
  if (later > 0) slowed++;
});
assert.ok(slowed > 0, 'some swaps walk slower with the budget tight');
// THE MATERIAL FLOOR: with the floor above every board's panels, no move ranked clears panels without breaking garbage
var fs = require('fs'), rulesFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles', 'gambit-rules.json'), 'utf8'));
rulesFile.keep = { material: '>=99' };
var high = GAMBIT.rulesFor({ gambit: { rules: rulesFile } }, __dirname), floored = 0;
for (var fseed = 1; fseed <= 4; fseed++) {
  var fb = PA.game({ level: 10, seed: fseed, countdown: false });
  for (var ff = 0; ff < 240; ff++) fb.run();
  var fc = { bot: { _canRaise: function () { return true; } }, m: { at: fb.clock, hold: hold, topped: false, opp: null }, board: fb, arrivals: [], br: null, brMs: 0, attacker: at, rules: high,
             GP: { mode: 'finish them', ms: 60, width: 30, depth: 5, pool: 120 }, pace: null, canRaise: function () { return false; }, left: function () { return 200; } };
  var FR = DECIDE.read(fc);
  var fr = DECIDE.ranked(fc, FR, require('./gambit_propose.js').search(fc, FR));
  floored += fr.length;
  fr.forEach(function (k) {
    var mk = at.judge(fb, hold, k.seq, [], { settled: JUDGE.settled(k.play) }).made;
    assert.ok(!((mk.combo > 0 || mk.chain > 0) && !(mk.broke > 0)), 'below the floor: ' + k.play + ' clears without breaking, ' + JSON.stringify(mk));
  });
}
assert.ok(floored > 0, 'moves were ranked below the floor: the check above is not empty');
// EVERY MOVE IS HELD TO THE SAME CHECKS, whoever offered it (plans/decision.md, every move first): on boards with a block on its way
var PROPOSE = require('./gambit_propose.js'), SHD = require('./survivor_shared.js'), kinds = {}, lateDropped = 0, readyKept = 0, carriedN = 0, aloneReady = 0, readyFirst = 0;
var BSD = new (require('./native.js').server.Search)({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 });
// (these checks hold whatever the mode's list is: run on a list of their own, so a change to the shipped list leaves them the boards to check)
var wideFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles', 'gambit-rules.json'), 'utf8'));
wideFile.attack.forEach(function (r) { if (r.name === 'finish them') r.aims = [{ combo: '>=8' }, { combo: '==5' }, { combo: '==6' }, { combo: '==7' }, { chain: '==2' }, { chain: '==3' }, { chain: '==1' }, { combo: '==4' }]; });
var wide = GAMBIT.rulesFor({ gambit: { rules: wideFile } }, __dirname);
for (var eseed = 1; eseed <= 10; eseed++) {
  var eb = PA.game({ level: 10, seed: eseed, countdown: false });
  for (var ef = 0; ef < 260; ef++) eb.run();
  if (eseed % 2) { eb.receiveGarbage([{ width: 6, height: 1, isChain: false, isMetal: false }]); for (ef = 0; ef < 260; ef++) eb.run(); }
  var arr = [{ at: 90, width: 6, height: 1 }];
  var ebr = SHD.breakMoves(BSD, eb, hold, arr, 1, 0, Date.now() + 200, null, null, { touchInPop: true });
  var ec = { bot: { _canRaise: function () { return false; } }, m: { at: eb.clock, hold: hold, topped: false, opp: null }, board: eb, arrivals: arr, br: ebr, brMs: 0, attacker: at, rules: wide,
             GP: { mode: 'finish them', ms: 60, width: 30, depth: 5, pool: 120 }, pace: null, canRaise: function () { return false; }, left: function () { return 200; } };
  var ER = DECIDE.read(ec), ES = PROPOSE.search(ec, ER), offered = PROPOSE.all(ec, ER, ES);
  // (1) THE DEADLINE, from the judge, for every move: with one frame to begin the last swap, a line the judge presses later is dropped
  ec.judged = {}; ec.dropped = {};
  var tight = Object.assign({}, ER, { by: 1 });
  offered.forEach(function (k) {
    kinds[k.play] = true;
    var settledK = JUDGE.settled(k.play), jj = at.judge(eb, hold, k.seq, arr, { settled: settledK });
    var got = JUDGE.judge(ec, tight, k);
    if (!jj.dead && jj.fire > 1) { assert.strictEqual(got, null, k.play + ': begun at frame ' + jj.fire + ', after the deadline, and kept'); lateDropped++; }
  });
  // (2) READINESS, for every move that breaks nothing: when the board left alone has a break in reach once the next block lands, each
  // move ranked still leaves one; when it has none, no move is held to it
  ec.judged = {}; ec.dropped = {};
  var alone = at.judge(eb, hold, [], arr, { readyAt: ER.F.us.nextLands });
  if (alone.ready === true) aloneReady++;
  // (the board left alone not ready: a move that leaves a plan ranks first -- the first move ranked breaks, or is ready, whenever any is)
  if (alone.ready !== true) {
    var rk = DECIDE.ranked(ec, ER, ES), rdy = function (k) { return (k.ap.broke || 0) > 0 || at.judge(eb, hold, k.seq, arr, { settled: k.settled, readyAt: ER.F.us.nextLands }).ready === true; };
    if (rk.some(rdy)) { assert.ok(rdy(rk[0]), 'seed ' + eseed + ': a move that leaves a plan is ranked first, not ' + rk[0].play); readyFirst++; }
    ec.judged = {}; ec.dropped = {};
  }
  DECIDE.ranked(ec, ER, ES).forEach(function (k) {
    if ((k.ap.broke || 0) > 0 || alone.ready !== true) return;
    var jr = at.judge(eb, hold, k.seq, arr, { settled: k.settled, readyAt: ER.F.us.nextLands });
    assert.ok(jr.dead || jr.ready === true, k.play + ': ranked, but the next block cannot be broken when it lands');
    readyKept++;
  });
  // (3) THE LINE IN PROGRESS, for every line of more than one swap: kept, its first swap pressed and the board run on, then found again
  // by its bottom-row panel -- the rest of the same line, its rows moved by as far as the stack rose
  DECIDE.ranked(ec, ER, ES).filter(function (k) { return k.seq.length > 1 && k.tier <= 4; }).forEach(function (k) {
    var keep = DECIDE.carryOf(ec, ER, k);
    if (!keep) return;
    var nb = eb.copy(), mv = k.seq[0];
    nb.curRow = mv[0]; nb.curCol = mv[1];
    if (!nb.tryQueueSwap(mv[0], mv[1])) return;
    for (var q = 0; q < 40; q++) nb.run();
    var dr = null;
    for (var r = 1; r < nb.panels.length && dr === null; r++) { var p0 = nb.panels[r] && nb.panels[r][keep.anchor.col]; if (p0 && p0.id === keep.anchor.id) dr = r - keep.anchor.row; }
    assert.ok(dr !== null, k.play + ': the anchor panel is found again');
    var nc = Object.assign({}, ec, { board: nb, bot: { _gambitCarry: keep, _canRaise: function () { return false; } }, judged: {}, dropped: {} });
    var back = PROPOSE.carried(nc, ER);
    if (back && back.cand) {
      assert.deepStrictEqual(back.cand.seq, keep.rest.map(function (m0) { return [m0[0] + dr, m0[1]]; }), k.play + ': the rest of the same line, moved by the rise');
      assert.strictEqual(back.cand.settled, k.settled, k.play + ': carried on as it is pressed');
      carriedN++;
    }
  });
  ec.bot._gambitCarry = null;
}
assert.ok(lateDropped > 0 && readyKept > 0 && carriedN > 0 && aloneReady > 0, 'every check ran: ' + lateDropped + ' late, ' + readyKept + ' ready (' + aloneReady + ' boards ready alone), ' + carriedN + ' carried');
assert.ok(kinds['break search'] || kinds.toward, 'the break search\'s moves were among those checked');
console.log('ok: every move held to the deadline, readiness (' + readyFirst + ' boards not ready alone, a ready move first) and the line in progress -- ' + Object.keys(kinds).sort().join(', '));
console.log('ok: gambit decision -- the judge on ' + judged + ' planned lines, ' + decided + ' decisions over ' + modes.length + ' modes');
