#!/usr/bin/env node
// EVERY FIELD AN OPTION CARRIES HAS TO BE READ BY EVERY RANKER THAT RANKS OPTIONS.
//
// Eleven times in one session the same defect: a quantity added to the option
// list and priced in one place, while the route that actually picked the move
// ranked by something else and never saw it. digGain, slabWorth, the material
// floor, the sealed void -- each fixed the board it was written for only once it
// reached BOTH rankers, and each wasted a measurement round before that.
//
// A rule needs three pieces: a plain-English rule where someone would be editing,
// a script that decides it mechanically, and a gate that runs the script. This is
// the script. The rule is in bitoptions.js beside optionOf.
//
// It reads the source rather than running the bot, because the defect is that a
// field is never read -- there is no board on which that shows up as a wrong
// answer, only as a term that does nothing.
import { readFileSync } from 'node:fs';

const OPTS = readFileSync(new URL('./bitoptions.js', import.meta.url), 'utf8');
const BOT = readFileSync(new URL('./bitbot.js', import.meta.url), 'utf8');

// FIELDS DELIBERATELY NOT SYMMETRIC, each with the reason it is not. A name here
// is a claim that one ranker has no use for it -- not that nobody got round to it.
const EXEMPT = new Map([
    ['voidRows', 'the absolute void; only the voidGain delta is ranked, as with dig'],
    ['slabGap', 'the absolute setup distance; only the slabGain delta is ranked, and only while the clock affords it'],
    ['mat', 'read through shortfallOf, which both rankers call'],
    ['matNow', 'a gate on digGain and starving, not a price'],
    ['low', 'read through ruinsShape, which both rankers call'],
    ['opensHole', 'read through ruinsShape, which both rankers call'],
    ['closesBreak', 'read through ruinsShape, which both rankers call'],
    ['breakReady', 'a transition input to closesBreak, and the ceiling rule'],
    ['levels', 'shape bookkeeping, not priced'],
    ['ready', 'the failsafe asks it of the board, not of the option'],
    ['garbLeft', 'reported, not priced'],
    ['spread', 'superseded by voidGain, which prices the same seal per panel'],
    ['breaks', 'a tier, read by tierOf'],
    ['tall', 'the ceiling rule, which is bestPlan-only by design'],
    ['voidAfter', 'orders breaks among themselves, in the break routes; not a price against other options'],
]);

function fieldsAssigned(src) {
    const out = new Set();
    for (const m of src.matchAll(/\bopt\.([A-Za-z][A-Za-z0-9]*)\s*=/g)) out.add(m[1]);
    // and the literal optionOf returns
    const at = src.indexOf('function optionOf');
    if (at >= 0) {
        const body = src.slice(at, src.indexOf('\n    }', at));
        for (const m of body.matchAll(/^\s{17,}([A-Za-z][A-Za-z0-9]*)\s*:/gm)) out.add(m[1]);
    }
    return out;
}

function bodyOf(src, decl) {
    const at = src.indexOf(decl);
    if (at < 0) throw new Error('cannot find ' + decl);
    // to the next top-level `    function ` or `    BitBot.prototype`
    const rest = src.slice(at + decl.length);
    const end = rest.search(/\n    (function |BitBot\.prototype)/);
    return rest.slice(0, end < 0 ? rest.length : end);
}

const declared = fieldsAssigned(OPTS);
const attack = bodyOf(BOT, 'function bestAttack(');
const plan = bodyOf(BOT, 'function bestPlan(');
const reads = (body) => new Set(
    [...body.matchAll(/\bo\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]));
const inAttack = reads(attack), inPlan = reads(plan);

let bad = 0;
const say = (m) => { console.log('FAIL: ' + m); bad++; };

for (const f of [...declared].sort()) {
    if (EXEMPT.has(f)) continue;
    const a = inAttack.has(f), p = inPlan.has(f);
    if (a && p) continue;
    if (!a && !p) {
        say('`' + f + '` is carried on every option and read by neither ranker. ' +
            'A term no ranker reads cannot change a decision -- it is dead weight ' +
            'that looks like a feature. Price it in both, or name it in EXEMPT ' +
            'with the reason it does not belong in a ranking.');
        continue;
    }
    say('`' + f + '` is priced by ' + (a ? 'bestAttack' : 'bestPlan') + ' and not by ' +
        (a ? 'bestPlan' : 'bestAttack') + '. Whichever route picks the move on a ' +
        'dying board is the one that will not see it, which is how the same defect ' +
        'came back eleven times in a session. Price it in both, or name it in EXEMPT.');
}

if (bad) { console.log(bad + ' FAILURES'); process.exit(1); }
console.log('option pricing: ' + declared.size + ' option fields, ' +
            (declared.size - EXEMPT.size) + ' ranked, each read by both rankers');
