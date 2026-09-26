// THE SCRATCH FLOOR MOVES ONLY WHEN THE REAL FLOOR MOVES.
// Run: node shakehold.test.js
//
// THE BUG THIS EXISTS FOR. _resolveCandidate copies the live stack's rise
// state onto the scratch so the board ages at the speed and phase the match
// is actually at -- riseTimer, displacement, speed, stopTime, preStopTime.
// shakeTime was not in that list, and paint() zeroes it. The engine holds the
// floor while a slab is shaking (updateRiseLock: shakeTime > 0 -> riseLock),
// so the scratch rose through a window the game spends standing still and the
// resolve handed back the live board SHIFTED UP A ROW.
//
// Read off the boards at frame 785 of seed 970: live rows 9/10/11 full and
// row 12 empty, shakeTime 38, riseTimer 2.5, displacement 16, riseLock true.
// The candidate came back with those same panels in rows 10/11/12 and read
// topped out. All 28 candidates read topped out, so _survivors saw no
// survivor, lifted -- it lifts by design when nothing helps -- and the bot
// chose unfiltered for three consecutive decisions with two empty rows in
// hand. Across four seeds: 182 decisions where every move read fatal, 99% of
// them condemned by the topped-out test.
//
// WHAT BINDS HERE is the displacement pair and the _copyRiseState check: both
// halves at the SAME walk delay, so shakeTime is the only thing that differs.
// The topped-out assertion above them guards the consequence rather than
// catching the cause -- a walk is far short of the 120 frames a whole row
// takes, so in this fixture the uncopied floor slips one pixel and the top row
// reads the same either way. In the match the walk and the settle together
// spanned the row, which is how it became a shift the bot could see.
//
// A scratch that never rises is the opposite defect and just as wrong; the
// free half requires the floor to give ground.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var PuyoCpu = require('./puyocpu.js');

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures.push(name); }
}

var W = 6, H = 12;
// Long enough for a rise due in 2.5 frames to land, so "it did not rise" is
// a decision and not just a walk too short to reach one.
var WALK = 10;

// A board filled from row 1 to row 11, leaving row 12 -- the lid -- empty.
// Colours are laid so nothing matches: the resolve must change nothing, and
// any movement in the answer is the floor, not the panels.
function tallBoard() {
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    for (var row = 1; row <= 11; row++) {
        for (var c2 = 1; c2 <= W; c2++) grid[row][c2] = ((row + c2) % 4) + 1;
    }
    return new LogicalBoard(W, H, 6, grid, {});
}

function topRowOf(board) {
    for (var r = board.height; r >= 1; r--)
        for (var c = 1; c <= board.width; c++) if (board.grid[r][c] !== 0) return r;
    return 0;
}

// A live stack poised on a row boundary with the rise about to fire, which is
// the state the death was read in: displacement at a full row, riseTimer
// nearly spent. shakeTime is the only thing that differs between the two
// tests below.
function poisedStack(shakeTime) {
    var stack = new PanelEngine.Stack({ width: W, height: H, level: 10 });
    stack.displacement = 16;
    stack.riseTimer = 2.5;
    stack.stopTime = 0;
    stack.preStopTime = 0;
    stack.shakeTime = shakeTime;
    stack.peakShakeTime = shakeTime;
    stack.incoming = [];
    return stack;
}

function cpuOn(stack) {
    // PuyoCpu(stack, opts) -- two arguments. Built with the engine off, every
    // assertion below passes for the wrong reason: the LogicalBoard path never
    // touches the scratch stack and so can never rise at all.
    var cpu = new PuyoCpu(stack, { engine: true, level: 10 });
    assert.ok(cpu.engine, 'fixture built a CPU with the engine path off');
    return cpu;
}

// THE CONSEQUENCE, on the board the bot actually reads. A board with an
// empty lid must not come back topped out.
check('a shaking floor leaves the board readable, not topped out', function () {
    var cpu = cpuOn(poisedStack(38));
    var board = tallBoard();
    assert.strictEqual(topRowOf(board), 11, 'fixture should start under the lid');
    cpu._resolveCandidate(board, null, WALK);
    assert.strictEqual(topRowOf(board), 11,
        'the resolve rose a board the engine was holding still: top went 11 -> ' +
        topRowOf(board));
    assert.ok(!cpu._boardToppedOut(board),
        'a board with an empty lid resolved to a topped-out board, which is ' +
        'what emptied _survivors and left the bot choosing unfiltered');
});

// THE OTHER HALF, MEASURED ON THE FLOOR ITSELF. A row is 16 pixels and a
// pixel is 7.5 frames at level 10, so a whole row is 120 frames -- far longer
// than a settle, which ends the moment the board is still. What separates
// "held" from "free" is therefore displacement, not the top row: free, the
// floor gives ground during the walk; shaking, it does not move at all.
check('the floor gives ground when nothing is holding it', function () {
    var cpu = cpuOn(poisedStack(0));
    cpu._resolveCandidate(tallBoard(), null, WALK);
    assert.ok(cpu._scratch.displacement < 16,
        'the scratch floor never moved with nothing holding it -- the rise ' +
        'is real and the search has to age the board with it');
});

check('and gives none while the slab is shaking', function () {
    var cpu = cpuOn(poisedStack(38));
    cpu._resolveCandidate(tallBoard(), null, WALK);
    assert.strictEqual(cpu._scratch.displacement, 16,
        'the scratch floor moved through a window the engine spends standing ' +
        'still; that is the row the bot was shown and the game never dealt');
});

check('shakeTime reaches the scratch at all', function () {
    var cpu = cpuOn(poisedStack(38));
    var st = { riseLock: false, riseTimer: 0, displacement: 0, speed: 0,
               stopTime: 0, preStopTime: 0, shakeTime: 0, peakShakeTime: 0 };
    cpu._copyRiseState(st);
    assert.strictEqual(st.shakeTime, 38,
        '_copyRiseState dropped shakeTime, which is the whole defect');
});

console.log(failures.length ? '\nFAILED: ' + failures.join(', ')
                            : '\nall ok');
process.exit(failures.length ? 1 : 0);
