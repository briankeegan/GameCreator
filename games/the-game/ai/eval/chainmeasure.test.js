#!/usr/bin/env node
// THE CHAINS-FIRED MEASURE, TESTED IN BOTH DIRECTIONS.
//
// It has to ACCEPT a real run of the real 84 chain puzzles, and it has to
// REJECT a run that came back short. The second half is the one that needs a
// test: a truncated run reports a smaller `fired`, which reads exactly like a
// bot that chains less, and the assertion that catches it is invisible until
// something has watched it fire. This repo has shipped a checker that could
// never fail before ("A GATE THAT CANNOT FAIL IS WORSE THAN NO GATE").
//
//   node chainmeasure.test.js
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var os = require('os');
var cm = require('./chainmeasure.js');

var fails = [];
function check(name, fn) {
    try { fn(); console.log('  ok    ' + name); }
    catch (e) { fails.push(name + ': ' + e.message); console.log('  FAIL  ' + name); }
}

// A stand-in for puzzles.play.js that writes whatever result we hand it.
// Beside this test, never os.tmpdir(): a parent writing to the system temp
// dir and a child reading an empty file is a failure this repo has had.
var dir = fs.mkdtempSync(path.join(__dirname, '.chainmeasure-test-'));
function stubPlay(body) {
    var f = path.join(dir, 'stub' + Math.random().toString(36).slice(2) + '.js');
    fs.writeFileSync(f,
        'var fs = require("fs");\n' +
        'if (process.env.GC_PLAY_JSON) fs.writeFileSync(process.env.GC_PLAY_JSON, ' +
        JSON.stringify(body === null ? '' : JSON.stringify(body)) + ');\n');
    return f;
}

console.log('\nTHE CHAINS-FIRED MEASURE\n');

// --- ACCEPTS a whole run -----------------------------------------------
check('accepts a complete run and returns its counts', function () {
    var r = cm.measure(null, { play: stubPlay({ attempted: 84, played: 84, fired: 9 }) });
    assert.strictEqual(r.played, 84);
    assert.strictEqual(r.fired, 9);
});

// --- REJECTS the defect it exists for -----------------------------------
check('REJECTS a run that played fewer puzzles than it found', function () {
    assert.throws(function () {
        cm.measure(null, { play: stubPlay({ attempted: 84, played: 40, fired: 3 }) });
    }, /played 40 of 84/);
});

check('REJECTS a run that wrote no result file at all', function () {
    var f = path.join(dir, 'silent.js');
    fs.writeFileSync(f, '// writes nothing\n');
    assert.throws(function () { cm.measure(null, { play: f }); }, /reported nothing/);
});

check('REJECTS a result file that is not valid JSON', function () {
    assert.throws(function () { cm.measure(null, { play: stubPlay(null) }); });
});

check('leaves no scratch files behind, on success or on failure', function () {
    try { cm.measure(null, { play: stubPlay({ attempted: 84, played: 1, fired: 0 }) }); }
    catch (e) {}
    cm.measure(null, { play: stubPlay({ attempted: 84, played: 84, fired: 1 }) });
    var left = fs.readdirSync(__dirname).filter(function (f) {
        return f.indexOf('.chainmeasure.') === 0;
    });
    assert.deepStrictEqual(left, [], 'left behind: ' + left.join(', '));
});

// --- AND THE REAL THING, because a test that only ever runs stubs proves
// the assertion works and says nothing about whether the tool it guards
// still emits what it reads.
check('the real puzzles.play.js emits a whole run for the shipped weights', function () {
    var r = cm.measure(null, { timeout: 300000 });
    assert.strictEqual(r.attempted, 84, 'Panel Attack ships 84 chain puzzles');
    assert.strictEqual(r.played, r.attempted);
    assert.ok(typeof r.fired === 'number' && r.fired >= 0 && r.fired <= r.played,
              'fired out of range: ' + r.fired);
    assert.strictEqual(r.puzzles.length, r.played, 'one row per puzzle played');
    var firedRows = r.puzzles.filter(function (p) { return p.deepest >= 2; }).length;
    assert.strictEqual(firedRows, r.fired, 'summary disagrees with its own rows');
    console.log('        shipped weights: ' + r.fired + ' / ' + r.played + ' chains fired');
});

fs.rmSync(dir, { recursive: true, force: true });

console.log('');
if (fails.length) {
    fails.forEach(function (f) { console.log('  ' + f); });
    console.log('\n' + fails.length + ' FAILED\n');
    process.exit(1);
}
console.log('  all good\n');
