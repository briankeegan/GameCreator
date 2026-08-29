// Flattens a real attack file (client/assets/default_data/training/
// challenge-<difficulty>-<stage>.json in the source game,
// briankeegan/panel-game) into a schedule of {frame, width, height,
// isChain} delivery events. Extracted out of attack_file_harness.js so
// the exact logic the harness runs is the one thing harness_fidelity.test.js
// checks against real engine behavior -- a duplicate reimplementation in
// the test file could drift from the harness the same way the harness
// itself drifted from the real engine twice already this session (see
// FINDINGS.md Rounds 1 and 4).
//
// Two things this must stay faithful to (both bit for bit, per
// AttackEngine.lua/GarbageQueue.lua in the source game):
//   1. A chain ({chain:[...], chainEndTime}) delivers ONE block, width 6,
//      height = link count, at chainEndTime -- not one delivery per link.
//   2. Every delivery sits GARBAGE_FLIGHT frames after its recorded time
//      before it reaches the receiver (duel.js's takeDeliverableGarbage
//      already gates on this for real gameplay; this harness has to
//      apply it manually since it bypasses the outgoing-queue pipeline).
function buildEventSchedule(raw, garbageFlight) {
  var delayBeforeStart = raw.delayBeforeStart || 0;
  var delayBeforeRepeat = raw.delayBeforeRepeat || 0;
  var events = [], maxStart = 0;
  (raw.attackPatterns || []).forEach(function (p) {
    if (p.chain) {
      var times = Array.isArray(p.chain) ? p.chain : null;
      var endTime = p.chainEndTime;
      if (times && endTime !== undefined) {
        var start = delayBeforeStart + endTime;
        events.push({ frame: start + garbageFlight, width: 6, height: times.length, isChain: true });
        maxStart = Math.max(maxStart, start);
        times.forEach(function (t) { maxStart = Math.max(maxStart, delayBeforeStart + t); });
      }
    } else {
      var start = delayBeforeStart + p.startTime;
      events.push({ frame: start + garbageFlight, width: p.width, height: p.height || 1, isChain: false });
      maxStart = Math.max(maxStart, start);
    }
  });
  var cyclePeriod = delayBeforeRepeat + maxStart - delayBeforeStart;
  events.sort(function (a, b) { return a.frame - b.frame; });
  return { events: events, cyclePeriod: cyclePeriod };
}

function eventsAt(schedule, f) {
  if (schedule.cyclePeriod <= 0) return [];
  var out = [];
  for (var i = 0; i < schedule.events.length; i++) {
    var e = schedule.events[i];
    if (f < e.frame) continue;
    if ((f - e.frame) % schedule.cyclePeriod === 0) out.push(e);
  }
  return out;
}

module.exports = { buildEventSchedule: buildEventSchedule, eventsAt: eventsAt };
