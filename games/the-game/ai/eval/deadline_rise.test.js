#!/usr/bin/env node
// THE DEADLINE IS THE NUMBER THE WHOLE BOT IS PRICED OFF, so it is checked against
// the ENGINE RUNNING, not against a second copy of the arithmetic.
//
// Two engine facts it has to honour, both read off panel-engine.js:
//
//   this.clock++ runs every frame and updateSpeed() fires on
//   `clock === nextSpeedIncreaseClock`           -- so SPEED RISES DURING STOP TIME
//   advancePassiveRaise() moves the board only while `stopTime === 0`
//                                               -- so THE BOARD DOES NOT
//
// Either one on its own is easy to get right. Together they say the deadline's first
// stretch is spent frozen at a speed the board will no longer be at when it starts
// moving, and that the rise must therefore be integrated from clock + stopTime. Both
// errors this guards against run in the same direction -- the bot believing it has
// longer than it has -- which is the only direction that kills it.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var E = globalThis.PanelEngine;

var pass = 0;
function check(name, fn) { fn(); pass++; console.log('  ok  ' + name); }

var DT = 15 * 60;            // panel-engine.js: DT_SPEED_INCREASE
var H = 12;

// THE ENGINE, ONE FRAME AT A TIME. Only the three things the deadline claims to
// know: the clock, the speed schedule, and that a frozen board does not rise.
function simulate(opts) {
    var clock = opts.clock, speed = opts.speed, nextUp = opts.nextSpeedUp;
    var stop = opts.stopTime || 0, rows = opts.rows;
    var riseTimer = E.riseTime(speed) * 16;   // a whole row to go
    var frames = 0;
    while (rows > 0 && frames < 500000) {
        frames++; clock++;
        if (clock === nextUp) { speed = Math.min(speed + 1, 99); nextUp += DT; }
        if (stop > 0) { stop--; continue; }   // advancePassiveRaise: no rise frozen
        riseTimer--;
        if (riseTimer <= 0) { rows--; riseTimer += E.riseTime(speed) * 16; }
    }
    return frames;
}

function infoFor(o) {
    return { speed: o.speed, nextSpeedUp: o.nextSpeedUp, startingSpeed: o.startingSpeed,
             clock: o.clock, stopTime: o.stopTime || 0, incoming: 0, toppedOut: false };
}

// The interval is DERIVED from nextSpeedUp and speed, so a case has to be
// self-consistent: nextSpeedUp = (speed - startingSpeed + 1) * DT.
function caseOf(startingSpeed, steps, into, stopTime, rows) {
    var speed = startingSpeed + steps;
    var nextSpeedUp = (steps + 1) * DT;
    return { startingSpeed: startingSpeed, speed: speed, nextSpeedUp: nextSpeedUp,
             clock: nextSpeedUp - into, stopTime: stopTime, rows: rows };
}

var CASES = [
    // level 10 starts at speed 32. `into` is how far off the next step-up the clock is.
    caseOf(32, 0, 900, 0, 4),      // fresh board, a step a whole interval away
    caseOf(32, 0, 100, 0, 8),      // a step-up 100 frames out, 8 rows to cross it
    caseOf(32, 5, 300, 0, 12),     // mid-game, the whole board
    caseOf(32, 10, 50, 0, 3),
    caseOf(32, 18, 600, 0, 6),     // past where the rise table flattens
    // AND THE SAME WITH STOP TIME, which is the case the deadline got wrong: the
    // step-up falls INSIDE the freeze, so the board starts moving already faster.
    caseOf(32, 0, 40, 90, 4),      // 90 frames frozen, a step-up 40 frames in
    caseOf(32, 3, 10, 98, 6),      // level 10's awardStopTime peaks at 98
    caseOf(32, 7, 95, 98, 5),      // step-up just after the freeze ends
    caseOf(32, 2, 500, 60, 9),     // freeze nowhere near a step-up: must not change
    caseOf(32, 12, 1, 95, 2)       // step-up on the next frame
];

// NEVER LONGER THAN THE ENGINE'S ANSWER, AND WITHIN A ROW OF IT.
//
// Not bit-exact, and the reason is the model and not a bug: framesToRise integrates
// FRACTIONAL rows (`canDo = until / fpr`) while the engine counts whole ones off an
// integer riseTimer, so the two part company by up to a row at each speed step. Both
// halves of the rule matter -- too long is the error that kills, and an answer a row
// short on every call would refuse moves the board has time for.
function agrees(label, got, real, fpr) {
    assert.ok(got <= real + 1,
              label + ': engine ' + real + ', bot ' + got +
              ' -- LONGER than the engine, which is the direction that kills');
    assert.ok(got >= real - fpr,
              label + ': engine ' + real + ', bot ' + got +
              ' -- more than a row of rise (' + fpr + ') short');
}

check('framesToRise is never longer than the engine, rise only', function () {
    CASES.forEach(function (c) {
        if (c.stopTime) return;
        var fpr = E.riseTime(c.speed) * 16;
        var real = simulate(c);
        var got = BitBot.framesToRiseOf(c.rows, infoFor(c), fpr, c.clock);
        agrees('rows ' + c.rows + ' speed ' + c.speed + ' clock ' + c.clock,
               got, real, fpr);
    });
});

check('framesToDeath counts the speed-ups that happen while frozen', function () {
    CASES.forEach(function (c) {
        var fpr = E.riseTime(c.speed) * 16;
        var real = simulate(c);
        var got = BitBot.framesToDeathOf(infoFor(c), H - c.rows, fpr);
        agrees('rows ' + c.rows + ' speed ' + c.speed + ' stop ' + c.stopTime +
               ' clock ' + c.clock, got, real, fpr);
    });
});

check('the error it fixes ran in the dangerous direction', function () {
    // The step-up inside the freeze is the case. Integrating from the clock as READ
    // uses the slower speed for rows the board crosses after it has already stepped
    // up, so the old answer is never SHORTER than the engine's.
    var c = caseOf(32, 0, 40, 90, 4);
    var info = infoFor(c);
    var fpr = E.riseTime(c.speed) * 16;
    var real = simulate(c);
    var fromRead = c.stopTime + BitBot.framesToRiseOf(c.rows, info, fpr, c.clock);
    var fromRise = BitBot.framesToDeathOf(info, H - c.rows, fpr);
    //
    // RELATIVE, NOT ABSOLUTE. The fractional-row model is already up to a row short
    // of the engine, so "the old answer was optimistic" is not true as an absolute
    // claim and asserting it would be an overclaim. What IS true is that it was
    // LONGER than the corrected one, by the rows the board crosses at a speed it had
    // already left -- and that the correction does not overshoot into optimism.
    assert.ok(fromRead > fromRise,
              'the step-up inside the freeze must make a difference: read ' +
              fromRead + ', rise ' + fromRise);
    assert.ok(fromRise <= real + 1,
              'and the correction must not become optimistic: ' + fromRise +
              ' against the engine\'s ' + real);
});

console.log('deadline_rise: ' + pass + ' checks, ' + CASES.length +
            ' cases against the engine running');
