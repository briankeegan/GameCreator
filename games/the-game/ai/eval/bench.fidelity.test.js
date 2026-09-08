// IS THE TRAINER PLAYING THE SAME GAME THE BENCHMARK REPORTS?
// Run: node bench.fidelity.test.js
//
// THE RULE. Every scenario the GA trains on must be, frame for frame, the
// drill full_report.js runs under the same name. Not similar to it — the
// same. A fitness that has drifted from the benchmark is not a rough guide,
// it is a different question, and optimising it hard produces a confident
// answer to something nobody asked.
//
// WHY. bench.js's original `build` and `siege` were invented drills that
// RESEMBLED full_report's. Two training rounds then ranked in the opposite
// order on the two: round 1 beat round 2 on build's held-out seeds and lost
// to it on endless by 54% of sent garbage. Forty generations had been spent
// improving a number nobody reads. See FINDINGS.md.
//
// It has already caught one. A second `var LEAD_IN = 150` in bench.js
// shared its binding with an existing `var LEAD_IN` further down the file,
// so the later assignment won at load and every burst drill silently ran on
// a 120-frame lead-in. factory came out 1317 frames against full_report's
// 1329: no error, nothing thrown, twelve frames of difference in a number
// with four digits. Only an EXACT comparison finds that — a tolerance of
// even 1% passes it, and so does anyone eyeballing the two.
//
// The reference implementations below are full_report.js's runners, kept
// here deliberately rather than imported, because that file is a CLI that
// runs an entire report on require. This test is what stops the copy
// drifting, which is the only thing that makes a copy acceptable.
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var GAME = path.join(__dirname, '..', '..');
require(path.join(GAME, 'panel-engine.js'));
require(path.join(GAME, 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PanelCpu = globalThis.PanelCpu;
var attackSchedule = require(path.join(__dirname, '..', 'experiments', 'attack_schedule.js'));
var bench = require('./bench.js');

var TRAINING_DIR = '/home/user/briankeegan/panel-game/client/assets/default_data/training';
var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// --- full_report.js's makeCpu, for 'nightmare' with no cfg overrides ---
function makeCpu(seed) {
    var stack = new PanelEngine.Stack({ level: 3, seed: seed, countdown: false });
    var cpu = new PanelCpu.SearchCpu(stack, {
        difficulty: 'nightmare', seed: seed + 55, mistake: 0, chainExtend: true
    });
    return { stack: stack, cpu: cpu };
}

// --- full_report.js's runTrainingMode ---
var TRAINING_MODES = {
    comboStorm: { width: 4, height: 1 },
    factory: { width: 6, height: 2 },
    bigBlocks: { width: 6, height: 12 }
};
var LEAD_IN = 150, BURST_LEN = 50, GAP = 900;
var CYCLE = GAP + (LEAD_IN + BURST_LEN) - LEAD_IN;
function refTrainingMode(modeName, seed) {
    var mode = TRAINING_MODES[modeName];
    var made = makeCpu(seed), stack = made.stack, cpu = made.cpu;
    function fires(f) {
        if (f < LEAD_IN + 1) return false;
        return ((f - LEAD_IN - 1) % CYCLE) < BURST_LEN;
    }
    var sent = 0, f;
    for (f = 0; f < 120000; f++) {
        if (fires(f)) stack.receiveGarbage([{ width: mode.width, height: mode.height, isChain: false }]);
        cpu.update();
        stack.run();
        var out = stack.takeDeliverableGarbage();
        for (var s = 0; s < out.length; s++) sent += out[s].width * out[s].height;
        stack.drainEvents();
        if (stack.gameOver) break;
    }
    return { frames: f, sent: sent };
}

// --- full_report.js's runEndlessFile ---
function endlessFiles() {
    return fs.readdirSync(TRAINING_DIR)
        .filter(function (f) { return /^challenge-8-\d+\.json$/.test(f); }).sort();
}
function refEndlessFile(fname, seed) {
    var raw = JSON.parse(fs.readFileSync(path.join(TRAINING_DIR, fname), 'utf8'));
    var schedule = attackSchedule.buildEventSchedule(raw, PanelEngine.GARBAGE_FLIGHT);
    var made = makeCpu(seed), stack = made.stack, cpu = made.cpu;
    var sent = 0, f;
    for (f = 0; f < 36000; f++) {
        var fired = attackSchedule.eventsAt(schedule, f);
        for (var i = 0; i < fired.length; i++) {
            stack.receiveGarbage([{ width: fired[i].width, height: fired[i].height, isChain: fired[i].isChain }]);
        }
        cpu.update();
        stack.run();
        var out = stack.takeDeliverableGarbage();
        for (var s = 0; s < out.length; s++) sent += out[s].width * out[s].height;
        stack.drainEvents();
        if (stack.gameOver) break;
    }
    return { frames: f, sent: sent };
}

var SEEDS = [1, 2, 3, 4];

test('the burst drills are full_report.js\'s, frame for frame', function () {
    // COLLECTED, not thrown one at a time: this file is minutes long and
    // "which drills are wrong?" must not cost one run per drill.
    var wrong = [];
    ['comboStorm', 'factory', 'bigBlocks'].forEach(function (name) {
        SEEDS.forEach(function (seed) {
            var ref = refTrainingMode(name, seed);
            var got = bench.run(null, seed, { scenario: name, checkTiming: false });
            if (ref.frames !== got.frames || ref.sent !== got.sent) {
                wrong.push(name + ' seed ' + seed + ': full_report ' + ref.frames + 'f/' +
                           ref.sent + 'c, bench ' + got.frames + 'f/' + got.sent + 'c');
            }
        });
    });
    assert.deepStrictEqual(wrong, [],
        'the trainer is not playing the benchmark\'s drill:\n  ' + wrong.join('\n  ') +
        '\nEXACT equality is the point — the last divergence here was twelve ' +
        'frames out of 1329 and came from a shadowed constant.');
});

test('endless replays the real attack files exactly', function () {
    var files = endlessFiles();
    assert.ok(files.length >= 12, 'expected the 12 challenge-8 files, found ' + files.length);
    assert.strictEqual(bench.endlessFileCount(), files.length,
        'bench.js and this test disagree about how many attack files exist');
    var wrong = [];
    SEEDS.forEach(function (seed) {
        // bench picks the file from the seed; mirror that mapping here, and
        // if it ever changes this test fails rather than quietly comparing
        // two different files and passing.
        var fname = files[(seed - 1 + files.length * 100) % files.length];
        var ref = refEndlessFile(fname, seed);
        var got = bench.run(null, seed, { scenario: 'endless', checkTiming: false });
        if (ref.frames !== got.frames || ref.sent !== got.sent) {
            wrong.push('seed ' + seed + ' (' + fname + '): full_report ' + ref.frames + 'f/' +
                       ref.sent + 'c, bench ' + got.frames + 'f/' + got.sent + 'c');
        }
    });
    assert.deepStrictEqual(wrong, [],
        'endless in the trainer is not the endless in the report:\n  ' + wrong.join('\n  '));
});

test('the drills are not all the same game (coverage)', function () {
    // Four scenarios that happened to agree would pass everything above
    // while telling the GA nothing. They have to actually differ.
    var got = {};
    ['comboStorm', 'factory', 'bigBlocks', 'endless'].forEach(function (name) {
        got[name] = bench.run(null, 1, { scenario: name, checkTiming: false }).frames;
    });
    var distinct = Object.keys(got).map(function (k) { return got[k]; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
    assert.strictEqual(distinct.length, 4,
        'the four drills produced ' + distinct.length + ' distinct results: ' +
        JSON.stringify(got) + '. They are meant to pose different problems.');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
