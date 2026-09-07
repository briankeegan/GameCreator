// Regression test for the two real-engine behaviors this session found
// attack_file_harness.js getting wrong -- twice, independently (FINDINGS.md
// Rounds 1 and 4). Both bugs were silent: the harness ran, produced
// plausible-looking numbers, and every benchmark result in this
// directory was wrong until someone happened to re-read the Lua source
// closely enough to notice. Nothing caught either one automatically.
// This is the gate, run by hand (`node harness_fidelity.test.js`) --
// wire it into a CI step if/when this directory's tooling gets one; it
// isn't yet, since none of ai/experiments/ is (these are dev-research
// tools, not shipped game code, so there's no pages.yml step to attach
// it to the way the standard describes for shipped-code checks).
//
// Tests attack_schedule.js directly (the module attack_file_harness.js
// actually runs), not a reimplementation -- see attack_schedule.js's own
// header for why a duplicate would be exactly the kind of drift this
// exists to catch.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
var PanelEngine = global.PanelEngine;
var attackSchedule = require('./attack_schedule.js');

var failures = [];
function assertEqual(actual, expected, label) {
  if (actual !== expected) failures.push(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// --- Fixture: a small hand-built attack file, one flat block and one
// 3-link chain, no repeat gap (easiest to reason about by hand). ---
var FIXTURE = {
  delayBeforeStart: 100,
  delayBeforeRepeat: 50,
  attackPatterns: [
    { width: 4, height: 1, startTime: 200, metal: false },
    { chainEndTime: 500, chain: [400, 450, 480] }
  ]
};

// 1. GARBAGE_FLIGHT must be the real engine's own constant (151 =
// TRANSIT 45 + TELEGRAPH 45 + 1 + LAND 60), not a hardcoded guess that
// could silently drift from panel-engine.js if that constant ever
// changes. Cross-checking against the exported value, not re-deriving
// the arithmetic, is the point -- a copy-pasted 151 here would pass even
// if panel-engine.js's own constant changed underneath it.
assertEqual(PanelEngine.GARBAGE_FLIGHT, 151, 'PanelEngine.GARBAGE_FLIGHT stayed 151');
var FLIGHT = PanelEngine.GARBAGE_FLIGHT;

var schedule = attackSchedule.buildEventSchedule(FIXTURE, FLIGHT);

// 2. Exactly two events -- the flat block and ONE combined chain block,
// never one event per chain link (the Round 1 bug: GarbageQueue's
// currentChain stays staged and grows by a row per link, only landing
// once, at chainEndTime).
assertEqual(schedule.events.length, 2, 'event count (1 flat + 1 combined chain, not 1 flat + 3 links)');

var flat = schedule.events.filter(function (e) { return !e.isChain; })[0];
var chain = schedule.events.filter(function (e) { return e.isChain; })[0];

// 3. The chain block is sized 6 wide x (link count) tall -- 3 links here
// -- not 1 tall, not sized off any individual link.
assertEqual(chain.width, 6, 'chain event width (always 6, full board width)');
assertEqual(chain.height, 3, 'chain event height (link count, 3 here)');

// 4. Every delivery frame is (delayBeforeStart + recorded time) +
// GARBAGE_FLIGHT -- the Round 4 bug: this used to land at the raw
// recorded time, delivering ~2.5 real seconds faster than the real
// engine's staging+transit+telegraph+land pipeline ever does.
assertEqual(flat.frame, FIXTURE.delayBeforeStart + 200 + FLIGHT, 'flat block delivery frame includes GARBAGE_FLIGHT');
assertEqual(chain.frame, FIXTURE.delayBeforeStart + 500 + FLIGHT, 'chain delivery frame is chainEndTime + GARBAGE_FLIGHT, not a link time');

// 5. cyclePeriod must NOT include GARBAGE_FLIGHT -- it's a property of
// the sender's own repeating schedule (AttackEngine.lua's
// totalAttackTimeBeforeRepeat), and folding a uniform per-delivery delay
// into it would shift the whole cycle later on every repeat instead of
// just delaying the very first pass once.
// Expected: delayBeforeRepeat + maxStart - delayBeforeStart, where
// maxStart is the highest RAW (undelayed) time seen across every
// pattern's own start/chainEndTime/link times -- here chainEndTime
// (500) dominates the chain's own link times (400/450/480), so it's the
// chain's delayBeforeStart+chainEndTime that sets maxStart, not the
// flat block's 200 or the last link's 480.
var expectedMaxStart = FIXTURE.delayBeforeStart + 500;
var expectedCycle = FIXTURE.delayBeforeRepeat + expectedMaxStart - FIXTURE.delayBeforeStart;
assertEqual(schedule.cyclePeriod, expectedCycle, 'cyclePeriod excludes GARBAGE_FLIGHT');

// 6. eventsAt() must find each event on its own repeat, and not before
// its first (delayed) occurrence.
assertEqual(attackSchedule.eventsAt(schedule, flat.frame).length, 1, 'flat event fires at its own frame');
assertEqual(attackSchedule.eventsAt(schedule, flat.frame - 1).length, 0, 'flat event does not fire one frame early');
assertEqual(attackSchedule.eventsAt(schedule, flat.frame + schedule.cyclePeriod).length, 1, 'flat event repeats one cycle later');

if (failures.length) {
  console.error('FAIL (' + failures.length + '):');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('PASS: attack_schedule.js matches real-engine chain/flight semantics (' + (6) + ' checks)');
